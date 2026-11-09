import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { evaluate, nodes, type Evidence, type EvidenceNodeId, type Result } from './model';
import { evaluateMilestone, type MilestoneConfirmation } from './milestone-review';
import { openDatabase, readEvidence, validateEvidenceInput, type EvidenceInput } from './store';

export type ResultChange = {
  nodeId: EvidenceNodeId;
  title: string;
  beforeStatus: string;
  afterStatus: string;
  beforeGap: string;
  afterGap: string;
  beforeDetail: string;
  afterDetail: string;
};

export type ChangeEvent = {
  id: string;
  eventType: 'milestone.confirmed' | 'evidence.corrected' | 'task.created' | 'task.updated';
  entityId: string;
  summary: string;
  createdAt: string;
  evidenceIds: string[];
  resultChanges: ResultChange[];
  confirmationInvalidated: boolean;
  details: Record<string, unknown>;
};
export type MilestoneChangeEvent = ChangeEvent & { eventType: 'milestone.confirmed'; entityId: 'milestone' };
export type TaskChangeEvent = ChangeEvent & {
  eventType: 'task.created' | 'task.updated';
  details: {
    goalPlanId: string;
    taskTitle: string;
    projectName: string | null;
    changedFields: string[];
    fieldChanges?: Array<{ field: string; before: unknown; after: unknown }>;
  };
};
type EvidenceOutcome = Pick<Result, 'title' | 'status' | 'gap' | 'detail'> & { nodeId: EvidenceNodeId };
export type EvidenceCorrection = { evidence: Evidence; changed: boolean; resultChanges: ResultChange[]; confirmationInvalidated: boolean };

function ensureChangeEventSchema(database: DatabaseSync) {
  database.exec(`CREATE TABLE IF NOT EXISTS change_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      evidence_ids TEXT NOT NULL
    );`);
  const eventColumns = database.prepare('PRAGMA table_info(change_events)').all() as { name: string }[];
  if (!eventColumns.some(column => column.name === 'details')) database.exec("ALTER TABLE change_events ADD COLUMN details TEXT NOT NULL DEFAULT '{}'");
}

function db() {
  const database = openDatabase();
  database.exec(`CREATE TABLE IF NOT EXISTS milestone_confirmations (
      node_id TEXT PRIMARY KEY,
      confirmed_at TEXT NOT NULL,
      evidence_ids TEXT NOT NULL
    );`);
  ensureChangeEventSchema(database);
  return database;
}

export function recordTaskChange(
  database: DatabaseSync,
  eventType: TaskChangeEvent['eventType'],
  task: { id: string; goalPlanId: string; title: string; projectName: string | null },
  changedFields: string[],
  createdAt: string,
  fieldChanges: Array<{ field: string; before: unknown; after: unknown }>,
) {
  ensureChangeEventSchema(database);
  const verb = eventType === 'task.created' ? '新增' : '修改';
  const fieldSummary = changedFields.length ? `：${changedFields.join('、')}` : '';
  const summary = `${verb}任务「${task.title}」${fieldSummary}`;
  const details = JSON.stringify({
    goalPlanId: task.goalPlanId,
    taskTitle: task.title,
    projectName: task.projectName,
    changedFields,
    fieldChanges,
  });
  database.prepare(`INSERT INTO change_events(id,event_type,entity_id,summary,created_at,evidence_ids,details)
    VALUES (?,?,?,?,?,'[]',?)`)
    .run(randomUUID(), eventType, task.id, summary, createdAt, details);
}

function readConfirmation(database: DatabaseSync): MilestoneConfirmation | null {
  const row = database.prepare("SELECT confirmed_at, evidence_ids FROM milestone_confirmations WHERE node_id='milestone'").get() as { confirmed_at: string; evidence_ids: string } | undefined;
  if (!row) return null;
  try {
    const evidenceIds: unknown = JSON.parse(row.evidence_ids);
    if (!Array.isArray(evidenceIds) || !evidenceIds.every(id => typeof id === 'string')) return null;
    return { nodeId: 'milestone', confirmedAt: row.confirmed_at, evidenceIds };
  } catch {
    return null;
  }
}

export function getMilestoneConfirmation(): MilestoneConfirmation | null {
  const database = db();
  try {
    return readConfirmation(database);
  } finally {
    database.close();
  }
}

export function confirmMilestone(id: unknown): { confirmation: MilestoneConfirmation; created: boolean } {
  if (id !== 'milestone') throw new Error('请选择有效的里程碑');
  const database = db();
  let inTransaction = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    const confirmation = readConfirmation(database);
    const review = evaluateMilestone(readEvidence(database), confirmation);
    if (review.status === '已确认达成' && confirmation) {
      database.exec('COMMIT');
      inTransaction = false;
      return { confirmation, created: false };
    }
    if (!review.canConfirm || review.evidenceIds.length === 0) {
      throw new Error('该里程碑当前不满足确认条件，请先核对证据和实测结果。');
    }

    const confirmedAt = new Date().toISOString();
    const next: MilestoneConfirmation = { nodeId: 'milestone', confirmedAt, evidenceIds: review.evidenceIds };
    const title = nodes.find(node => node.id === 'milestone')!.title;
    const summary = `用户确认里程碑「${title}」达成。`;
    database.prepare(`INSERT INTO milestone_confirmations(node_id, confirmed_at, evidence_ids)
      VALUES ('milestone', ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET confirmed_at=excluded.confirmed_at, evidence_ids=excluded.evidence_ids`)
      .run(confirmedAt, JSON.stringify(next.evidenceIds));
    database.prepare(`INSERT INTO change_events(id, event_type, entity_id, summary, created_at, evidence_ids)
      VALUES (?, 'milestone.confirmed', 'milestone', ?, ?, ?)`)
      .run(randomUUID(), summary, confirmedAt, JSON.stringify(next.evidenceIds));
    database.exec('COMMIT');
    inTransaction = false;
    return { confirmation: next, created: true };
  } catch (error) {
    if (inTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

function outcomes(evidence: Evidence[], confirmation: MilestoneConfirmation | null): EvidenceOutcome[] {
  const task = evaluate(evidence)[0];
  const milestone = evaluateMilestone(evidence, confirmation);
  return [
    { nodeId: 'task', title: task.title, status: task.status, gap: task.gap, detail: task.detail },
    { nodeId: 'milestone', title: milestone.title, status: milestone.status, gap: milestone.gap, detail: milestone.detail },
  ];
}

function changedOutcomes(before: EvidenceOutcome[], after: EvidenceOutcome[]): ResultChange[] {
  return before.flatMap((oldOutcome, index) => {
    const next = after[index];
    if (oldOutcome.status === next.status && oldOutcome.gap === next.gap && oldOutcome.detail === next.detail) return [];
    return [{
      nodeId: oldOutcome.nodeId,
      title: oldOutcome.title,
      beforeStatus: oldOutcome.status,
      afterStatus: next.status,
      beforeGap: oldOutcome.gap,
      afterGap: next.gap,
      beforeDetail: oldOutcome.detail,
      afterDetail: next.detail,
    }];
  });
}

function snapshot(evidence: Evidence) {
  return {
    id: evidence.id,
    text: evidence.text,
    source: evidence.source,
    reference: evidence.reference,
    observedAt: evidence.observedAt,
    createdAt: evidence.createdAt,
    links: nodes.filter(node => evidence.links.includes(node.id)).map(node => node.id),
    level: evidence.level,
    reportSubmitted: evidence.reportSubmitted,
    latencyMs: evidence.latencyMs,
    benchmarkComplete: evidence.benchmarkComplete,
  };
}

function sameEvidence(current: Evidence, next: EvidenceInput) {
  const sameLinks = [...current.links].sort().join(',') === [...next.links].sort().join(',');
  return current.text === next.text
    && current.source === next.source
    && current.reference === next.reference
    && current.observedAt === next.observedAt
    && sameLinks
    && current.level === next.level
    && current.reportSubmitted === next.reportSubmitted
    && current.latencyMs === next.latencyMs
    && current.benchmarkComplete === next.benchmarkComplete;
}

export function correctEvidence(id: unknown, input: unknown): EvidenceCorrection {
  if (typeof id !== 'string' || !id) throw new Error('请选择有效的证据');
  const nextInput = validateEvidenceInput(input);
  const database = db();
  let inTransaction = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    const beforeEvidence = readEvidence(database);
    const current = beforeEvidence.find(item => item.id === id);
    if (!current) throw new Error('证据不存在或已被删除');
    if (sameEvidence(current, nextInput)) {
      database.exec('COMMIT');
      inTransaction = false;
      return { evidence: current, changed: false, resultChanges: [], confirmationInvalidated: false };
    }

    const confirmationBefore = readConfirmation(database);
    const beforeOutcomes = outcomes(beforeEvidence, confirmationBefore);
    const changedAt = new Date().toISOString();
    const beforeSnapshot = snapshot(current);
    database.prepare(`UPDATE evidence SET text=?, source=?, reference=?, observed_at=?, report_submitted=?, latency_ms=?, benchmark_complete=?, level=? WHERE id=?`)
      .run(nextInput.text, nextInput.source, nextInput.reference, nextInput.observedAt, nextInput.reportSubmitted === null ? null : Number(nextInput.reportSubmitted), nextInput.latencyMs, nextInput.benchmarkComplete === null ? null : Number(nextInput.benchmarkComplete), nextInput.level, id);
    database.prepare('DELETE FROM evidence_links WHERE evidence_id=?').run(id);
    const insertLink = database.prepare('INSERT INTO evidence_links(evidence_id,node_id) VALUES (?,?)');
    for (const link of nextInput.links) insertLink.run(id, link);

    const confirmationInvalidated = Boolean(confirmationBefore?.evidenceIds.includes(id));
    if (confirmationInvalidated) database.prepare("DELETE FROM milestone_confirmations WHERE node_id='milestone'").run();
    const afterEvidence = readEvidence(database);
    const updated = afterEvidence.find(item => item.id === id)!;
    const confirmationAfter = confirmationInvalidated ? null : confirmationBefore;
    const resultChanges = changedOutcomes(beforeOutcomes, outcomes(afterEvidence, confirmationAfter));
    const afterSnapshot = snapshot(updated);
    database.prepare('INSERT INTO evidence_revisions(id,evidence_id,changed_at,before_json,after_json) VALUES (?,?,?,?,?)')
      .run(randomUUID(), id, changedAt, JSON.stringify(beforeSnapshot), JSON.stringify(afterSnapshot));
    const summary = `证据「${current.reference}」已更正，记录身份保持不变。`;
    const details = JSON.stringify({ resultChanges, confirmationInvalidated });
    database.prepare(`INSERT INTO change_events(id,event_type,entity_id,summary,created_at,evidence_ids,details)
      VALUES (?,'evidence.corrected',?,?,?,?,?)`)
      .run(randomUUID(), id, summary, changedAt, JSON.stringify([id]), details);
    database.exec('COMMIT');
    inTransaction = false;
    return { evidence: readEvidence(database).find(item => item.id === id)!, changed: true, resultChanges, confirmationInvalidated };
  } catch (error) {
    if (inTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

export function listChangeEvents(): ChangeEvent[] {
  const database = db();
  try {
    const rows = database.prepare('SELECT * FROM change_events ORDER BY created_at DESC, rowid DESC').all() as Record<string, unknown>[];
    return rows.map(row => {
      let details: { resultChanges?: ResultChange[]; confirmationInvalidated?: boolean } = {};
      let fullDetails: Record<string, unknown> = {};
      try {
        fullDetails = JSON.parse(String(row.details ?? '{}')) as Record<string, unknown>;
        details = fullDetails as typeof details;
      } catch {
        details = {};
        fullDetails = {};
      }
      const eventType = row.event_type === 'evidence.corrected' || row.event_type === 'task.created' || row.event_type === 'task.updated'
        ? row.event_type
        : 'milestone.confirmed';
      return {
      id: String(row.id),
      eventType,
      entityId: String(row.entity_id),
      summary: String(row.summary),
      createdAt: String(row.created_at),
      evidenceIds: JSON.parse(String(row.evidence_ids)) as string[],
      resultChanges: details.resultChanges ?? [],
      confirmationInvalidated: details.confirmationInvalidated ?? false,
      details: fullDetails,
    };
    });
  } finally {
    database.close();
  }
}

export function listMilestoneChanges(): MilestoneChangeEvent[] {
  return listChangeEvents().filter((event): event is MilestoneChangeEvent => event.eventType === 'milestone.confirmed');
}
