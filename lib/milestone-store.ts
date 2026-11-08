import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { nodes } from './model';
import { evaluateMilestone, type MilestoneConfirmation } from './milestone-review';
import { openDatabase, readEvidence } from './store';

export type MilestoneChangeEvent = {
  id: string;
  eventType: 'milestone.confirmed';
  entityId: 'milestone';
  summary: string;
  createdAt: string;
  evidenceIds: string[];
};

function db() {
  const database = openDatabase();
  database.exec(`CREATE TABLE IF NOT EXISTS milestone_confirmations (
      node_id TEXT PRIMARY KEY,
      confirmed_at TEXT NOT NULL,
      evidence_ids TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS change_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      evidence_ids TEXT NOT NULL
    );`);
  return database;
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

export function listMilestoneChanges(): MilestoneChangeEvent[] {
  const database = db();
  try {
    const rows = database.prepare("SELECT * FROM change_events WHERE event_type='milestone.confirmed' ORDER BY created_at DESC").all() as Record<string, unknown>[];
    return rows.map(row => ({
      id: String(row.id),
      eventType: 'milestone.confirmed',
      entityId: 'milestone',
      summary: String(row.summary),
      createdAt: String(row.created_at),
      evidenceIds: JSON.parse(String(row.evidence_ids)) as string[],
    }));
  } finally {
    database.close();
  }
}
