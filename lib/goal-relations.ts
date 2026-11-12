import { randomUUID } from 'node:crypto';
import { listEvidence, openDatabase } from './store';
import { listGoalPlanActions, listGoalProjects } from './goal-plans';

export type GoalRelationType = 'prerequisite' | 'time_conflict' | 'recovery_conflict' | 'shared_activity' | 'shared_material';
export type GoalRelationStatus = 'candidate' | 'confirmed' | 'verified' | 'rejected';
export type GoalRelationSourceType = 'user' | 'rule' | 'professional' | 'ai_inference';
export type GoalRelationConfidence = 'low' | 'medium' | 'high';
export type GoalRelationEndpoint = { actionId: string; goalPlanId: string; goalTitle: string; actionTitle: string };
export type GoalRelationEvidenceReference = { kind: 'action' | 'evidence' | 'project' | 'reference'; id: string; label: string };
export type GoalRelationSnapshot = {
  id: string;
  version: number;
  type: GoalRelationType;
  sourceAction: GoalRelationEndpoint;
  targetAction: GoalRelationEndpoint;
  sourceType: GoalRelationSourceType;
  sourceLabel: string;
  sourceReference: string | null;
  confidence: GoalRelationConfidence;
  evidenceReferences: GoalRelationEvidenceReference[];
  impact: string;
  minimumRestDays: number | null;
  status: GoalRelationStatus;
  createdAt: string;
  updatedAt: string;
};
export type GoalRelationEvent = {
  id: string;
  version: number;
  action: 'candidate_created' | 'confirmed' | 'rejected' | 'corrected';
  reason: string;
  before: GoalRelationSnapshot | null;
  after: GoalRelationSnapshot;
  createdAt: string;
};
export type GoalRelation = GoalRelationSnapshot & { events: GoalRelationEvent[] };

const relationTypes = new Set<GoalRelationType>(['prerequisite', 'time_conflict', 'recovery_conflict', 'shared_activity', 'shared_material']);
const sourceTypes = new Set<GoalRelationSourceType>(['user', 'rule', 'professional', 'ai_inference']);
const confidenceLevels = new Set<GoalRelationConfidence>(['low', 'medium', 'high']);
const referenceKinds = new Set<GoalRelationEvidenceReference['kind']>(['action', 'evidence', 'project', 'reference']);

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field}格式无效。`);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, limit: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) throw new Error(`${field}必须填写且不能超过 ${limit} 个字符。`);
  return value.trim();
}

function nullableText(value: unknown, field: string, limit: number) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field, limit);
}

export function ensureGoalRelationsSchema(database: ReturnType<typeof openDatabase>) {
  database.exec(`CREATE TABLE IF NOT EXISTS goal_relations (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    type TEXT NOT NULL,
    source_action_json TEXT NOT NULL,
    target_action_json TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_label TEXT NOT NULL,
    source_reference TEXT,
    confidence TEXT NOT NULL,
    evidence_references_json TEXT NOT NULL,
    impact TEXT NOT NULL,
    minimum_rest_days INTEGER,
    status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'verified', 'rejected')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS goal_relations_status ON goal_relations(status, updated_at DESC);
  CREATE TABLE IF NOT EXISTS goal_relation_events (
    id TEXT PRIMARY KEY,
    relation_id TEXT NOT NULL REFERENCES goal_relations(id),
    version INTEGER NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS goal_relation_events_relation ON goal_relation_events(relation_id, version);`);
}

function snapshotFromRow(row: Record<string, unknown>): GoalRelationSnapshot {
  return {
    id: String(row.id), version: Number(row.version), type: String(row.type) as GoalRelationType,
    sourceAction: JSON.parse(String(row.source_action_json)) as GoalRelationEndpoint,
    targetAction: JSON.parse(String(row.target_action_json)) as GoalRelationEndpoint,
    sourceType: String(row.source_type) as GoalRelationSourceType, sourceLabel: String(row.source_label),
    sourceReference: row.source_reference === null ? null : String(row.source_reference),
    confidence: String(row.confidence) as GoalRelationConfidence,
    evidenceReferences: JSON.parse(String(row.evidence_references_json)) as GoalRelationEvidenceReference[],
    impact: String(row.impact), minimumRestDays: row.minimum_rest_days === null ? null : Number(row.minimum_rest_days),
    status: String(row.status) as GoalRelationStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function relationFromRow(database: ReturnType<typeof openDatabase>, row: Record<string, unknown>): GoalRelation {
  const relation = snapshotFromRow(row);
  const events = (database.prepare('SELECT * FROM goal_relation_events WHERE relation_id=? ORDER BY version,rowid').all(relation.id) as Array<Record<string, unknown>>).map(event => ({
    id: String(event.id), version: Number(event.version), action: String(event.action) as GoalRelationEvent['action'], reason: String(event.reason),
    before: event.before_json === null ? null : JSON.parse(String(event.before_json)) as GoalRelationSnapshot,
    after: JSON.parse(String(event.after_json)) as GoalRelationSnapshot, createdAt: String(event.created_at),
  }));
  return { ...relation, events };
}

function readRelation(database: ReturnType<typeof openDatabase>, id: string) {
  const row = database.prepare('SELECT * FROM goal_relations WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error('找不到这条跨目标关系。');
  return relationFromRow(database, row);
}

function normalizeRelation(input: unknown): Omit<GoalRelationSnapshot, 'id' | 'version' | 'status' | 'createdAt' | 'updatedAt'> {
  const value = object(input, '关系');
  if (typeof value.type !== 'string' || !relationTypes.has(value.type as GoalRelationType)) throw new Error('关系类型无效。');
  if (typeof value.sourceType !== 'string' || !sourceTypes.has(value.sourceType as GoalRelationSourceType)) throw new Error('关系来源类型无效。');
  if (typeof value.confidence !== 'string' || !confidenceLevels.has(value.confidence as GoalRelationConfidence)) throw new Error('关系可信度无效。');
  const sourceActionId = requiredText(value.sourceActionId, '起始行动', 100);
  const targetActionId = requiredText(value.targetActionId, '关联行动', 100);
  if (sourceActionId === targetActionId) throw new Error('关系的两个行动必须不同。');
  const actions = listGoalPlanActions().filter(action => action.status !== 'done');
  const actionsById = new Map(actions.map(action => [action.id, action]));
  const sourceAction = actions.find(action => action.id === sourceActionId);
  const targetAction = actions.find(action => action.id === targetActionId);
  if (!sourceAction || !targetAction) throw new Error('关系两端必须是当前活跃目标中的行动。');
  if (sourceAction.goalPlanId === targetAction.goalPlanId) throw new Error('此工作区只处理跨目标行动关系。');
  const minimumRestDays = value.type === 'recovery_conflict'
    ? Number.isInteger(value.minimumRestDays) && Number(value.minimumRestDays) >= 1 && Number(value.minimumRestDays) <= 7
      ? Number(value.minimumRestDays) : (() => { throw new Error('恢复冲突需要设置 1 到 7 天的完整恢复间隔。'); })()
    : null;
  if (value.evidenceReferences !== undefined && (!Array.isArray(value.evidenceReferences) || value.evidenceReferences.length > 20)) throw new Error('证据引用最多可包含 20 项。');
  const evidenceReferences: GoalRelationEvidenceReference[] = [sourceAction, targetAction].map(action => ({
    kind: 'action', id: action.id, label: `${action.goalTitle} · ${action.title}`,
  }));
  for (const candidate of (value.evidenceReferences ?? []) as unknown[]) {
    const reference = object(candidate, '证据引用');
    if (typeof reference.kind !== 'string' || !referenceKinds.has(reference.kind as GoalRelationEvidenceReference['kind'])) throw new Error('证据引用类型无效。');
    const id = requiredText(reference.id, '证据引用 ID', 300);
    let label = requiredText(reference.label, '证据引用说明', 300);
    if (reference.kind === 'action') {
      const referencedAction = actionsById.get(id);
      if (!referencedAction) throw new Error('证据行动引用必须指向当前活跃目标中的行动。');
      label = `${referencedAction.goalTitle} · ${referencedAction.title}`;
    } else if (reference.kind === 'evidence') {
      const evidence = listEvidence().find(item => item.id === id);
      if (!evidence) throw new Error('证据引用必须指向已保存的证据。');
      label = `${evidence.source} · ${evidence.reference}`;
    } else if (reference.kind === 'project') {
      const project = listGoalProjects().find(item => item.id === id);
      if (!project) throw new Error('项目引用必须指向已保存的项目。');
      label = project.title;
    }
    if (!evidenceReferences.some(item => item.kind === reference.kind && item.id === id)) {
      evidenceReferences.push({ kind: reference.kind as GoalRelationEvidenceReference['kind'], id, label });
    }
  }
  return {
    type: value.type as GoalRelationType,
    sourceAction: { actionId: sourceAction.id, goalPlanId: sourceAction.goalPlanId, goalTitle: sourceAction.goalTitle, actionTitle: sourceAction.title },
    targetAction: { actionId: targetAction.id, goalPlanId: targetAction.goalPlanId, goalTitle: targetAction.goalTitle, actionTitle: targetAction.title },
    sourceType: value.sourceType as GoalRelationSourceType,
    sourceLabel: requiredText(value.sourceLabel, '关系来源', 200),
    sourceReference: nullableText(value.sourceReference, '来源引用', 500),
    confidence: value.confidence as GoalRelationConfidence,
    evidenceReferences,
    impact: requiredText(value.impact, '对计划的影响', 1000),
    minimumRestDays,
  };
}

function appendEvent(database: ReturnType<typeof openDatabase>, relationId: string, version: number, action: GoalRelationEvent['action'], reason: string, before: GoalRelationSnapshot | null, after: GoalRelationSnapshot, createdAt: string) {
  database.prepare(`INSERT INTO goal_relation_events (id,relation_id,version,action,reason,before_json,after_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), relationId, version, action, reason, before ? JSON.stringify(before) : null, JSON.stringify(after), createdAt);
}

export function listGoalRelations(): GoalRelation[] {
  const database = openDatabase();
  try {
    ensureGoalRelationsSchema(database);
    return (database.prepare('SELECT * FROM goal_relations ORDER BY updated_at DESC,id').all() as Array<Record<string, unknown>>).map(row => relationFromRow(database, row));
  } finally { database.close(); }
}

export function listPlanningGoalRelations(): GoalRelation[] {
  return listGoalRelations().filter(relation => relation.status === 'confirmed' || relation.status === 'verified');
}

export function createGoalRelation(input: unknown): GoalRelation {
  const normalized = normalizeRelation(input);
  const database = openDatabase();
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    ensureGoalRelationsSchema(database);
    database.exec('BEGIN IMMEDIATE');
    const snapshot: GoalRelationSnapshot = { id, version: 1, ...normalized, status: 'candidate', createdAt: now, updatedAt: now };
    database.prepare(`INSERT INTO goal_relations (id,version,type,source_action_json,target_action_json,source_type,source_label,source_reference,confidence,evidence_references_json,impact,minimum_rest_days,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, 1, normalized.type, JSON.stringify(normalized.sourceAction), JSON.stringify(normalized.targetAction), normalized.sourceType,
      normalized.sourceLabel, normalized.sourceReference, normalized.confidence, JSON.stringify(normalized.evidenceReferences), normalized.impact, normalized.minimumRestDays, 'candidate', now, now);
    appendEvent(database, id, 1, 'candidate_created', '候选关系已保存，尚未作为事实用于重排。', null, snapshot, now);
    database.exec('COMMIT');
    return readRelation(database, id);
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* transaction already ended */ }
    throw error;
  } finally { database.close(); }
}

export function resolveGoalRelation(id: string, input: unknown): GoalRelation {
  const value = object(input, '关系处理');
  const action = value.action;
  if (!['confirm', 'reject', 'correct'].includes(String(action))) throw new Error('关系处理方式无效。');
  const reason = requiredText(value.reason, action === 'confirm' ? '确认依据' : action === 'reject' ? '否定原因' : '修正原因', 500);
  if (!Number.isInteger(value.version) || Number(value.version) < 1) throw new Error('关系版本无效，请刷新后重试。');
  if (action === 'confirm' && value.confirmed !== true) throw new Error('确认关系需要单独确认。');
  const normalized = action === 'correct' ? normalizeRelation(value.relation) : null;
  const database = openDatabase();
  try {
    ensureGoalRelationsSchema(database);
    database.exec('BEGIN IMMEDIATE');
    const row = database.prepare('SELECT * FROM goal_relations WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error('找不到这条跨目标关系。');
    const before = snapshotFromRow(row);
    if (before.version !== Number(value.version)) throw new Error('关系已更新，请刷新后再处理。');
    if (action !== 'correct' && before.status !== 'candidate') throw new Error('只有待核对的候选关系可以确认或否定。');
    const now = new Date().toISOString();
    const version = before.version + 1;
    const status: GoalRelationStatus = action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'candidate';
    const after: GoalRelationSnapshot = { ...before, ...(normalized ?? {}), version, status, updatedAt: now };
    database.prepare(`UPDATE goal_relations SET version=?,type=?,source_action_json=?,target_action_json=?,source_type=?,source_label=?,source_reference=?,confidence=?,evidence_references_json=?,impact=?,minimum_rest_days=?,status=?,updated_at=? WHERE id=?`)
      .run(version, after.type, JSON.stringify(after.sourceAction), JSON.stringify(after.targetAction), after.sourceType, after.sourceLabel, after.sourceReference,
        after.confidence, JSON.stringify(after.evidenceReferences), after.impact, after.minimumRestDays, status, now, id);
    appendEvent(database, id, version, action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'corrected', reason, before, after, now);
    database.exec('COMMIT');
    return readRelation(database, id);
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* transaction already ended */ }
    throw error;
  } finally { database.close(); }
}
