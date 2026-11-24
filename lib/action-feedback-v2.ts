import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { GoalDraftError, getEnabledGoal, listEnabledGoals, type GoalV2 } from './goal-drafts-v2';
import { openDatabase } from './store';
import { proposeActionAssessment, type ActionAssessmentResult } from './action-feedback-agent';
import { findConfirmedPlannedActionInDatabase, getConfirmedPlannedAction, type ConfirmedPlannedAction } from './weekly-plans-v2';

export type ActionFeedback = {
  id: string;
  actionId: string;
  message: string;
  performedOn: string | null;
  submittedAt: string;
  assessment: Pick<ActionAssessmentResult, 'completion' | 'confidence' | 'reply'>;
  contributions: Array<{
    id: string;
    goalId: string;
    attributeId: string;
    amount: number;
    cumulativeAmount: number;
  }>;
};

type StoredActionContext = {
  action: ConfirmedPlannedAction;
  goals: GoalV2[];
};

function ensureSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS v2_action_feedback (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_fingerprint TEXT NOT NULL,
      action_id TEXT NOT NULL,
      action_snapshot_json TEXT NOT NULL,
      message TEXT NOT NULL,
      performed_on TEXT,
      completion REAL NOT NULL CHECK (completion >= 0 AND completion <= 1),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      reply TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS v2_action_feedback_action_created
      ON v2_action_feedback(action_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS v2_attribute_contributions (
      id TEXT PRIMARY KEY,
      feedback_id TEXT NOT NULL REFERENCES v2_action_feedback(id) ON DELETE CASCADE,
      action_id TEXT NOT NULL,
      goal_id TEXT NOT NULL,
      attribute_id TEXT NOT NULL REFERENCES v2_goal_attributes(id),
      amount REAL NOT NULL CHECK (amount > 0),
      cumulative_amount REAL NOT NULL CHECK (cumulative_amount > 0),
      created_at TEXT NOT NULL,
      UNIQUE(feedback_id, attribute_id)
    );
    CREATE INDEX IF NOT EXISTS v2_attribute_contributions_action_attribute
      ON v2_attribute_contributions(action_id, attribute_id);
    CREATE INDEX IF NOT EXISTS v2_attribute_contributions_goal_attribute
      ON v2_attribute_contributions(goal_id, attribute_id, created_at DESC);
  `);
}

function withDatabase<T>(operation: (database: DatabaseSync) => T): T {
  const database = openDatabase();
  try {
    ensureSchema(database);
    return operation(database);
  } finally {
    database.close();
  }
}

function mapFeedback(database: DatabaseSync, row: Record<string, unknown>): ActionFeedback {
  const contributions = database.prepare(`SELECT id,goal_id,attribute_id,amount,cumulative_amount
    FROM v2_attribute_contributions WHERE feedback_id=? ORDER BY rowid`).all(String(row.id)) as Array<Record<string, unknown>>;
  return {
    id: String(row.id),
    actionId: String(row.action_id),
    message: String(row.message),
    performedOn: row.performed_on === null ? null : String(row.performed_on),
    submittedAt: String(row.created_at),
    assessment: {
      completion: Number(row.completion),
      confidence: Number(row.confidence),
      reply: String(row.reply),
    },
    contributions: contributions.map(contribution => ({
      id: String(contribution.id),
      goalId: String(contribution.goal_id),
      attributeId: String(contribution.attribute_id),
      amount: Number(contribution.amount),
      cumulativeAmount: Number(contribution.cumulative_amount),
    })),
  };
}

function readFeedbackByKey(database: DatabaseSync, idempotencyKey: string) {
  const row = database.prepare('SELECT * FROM v2_action_feedback WHERE idempotency_key=?').get(idempotencyKey) as Record<string, unknown> | undefined;
  return row ? mapFeedback(database, row) : null;
}

export function getActionFeedback(id: string): ActionFeedback {
  return withDatabase(database => {
    const row = database.prepare('SELECT * FROM v2_action_feedback WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new GoalDraftError('找不到行动反馈', 404);
    return mapFeedback(database, row);
  });
}

export function getActionFeedbackForAction(actionId: string): ActionFeedback[] {
  return withDatabase(database => (database.prepare('SELECT * FROM v2_action_feedback WHERE action_id=? ORDER BY created_at,id').all(actionId) as Array<Record<string, unknown>>)
    .map(row => mapFeedback(database, row)));
}

export function getGoalAttributeContributions(goalId: string, attributeId: string) {
  const goal = getEnabledGoal(goalId);
  if (!goal.attributes.some(attribute => attribute.id === attributeId)) throw new GoalDraftError('找不到该目标属性', 404);
  return withDatabase(database => {
    const rows = database.prepare(`SELECT c.id AS contribution_id,c.action_id,c.goal_id,c.attribute_id,c.amount,c.cumulative_amount,
        f.id AS feedback_id,f.message,f.performed_on,f.completion,f.confidence,f.reply,f.created_at
      FROM v2_attribute_contributions c JOIN v2_action_feedback f ON f.id=c.feedback_id
      WHERE c.goal_id=? AND c.attribute_id=? ORDER BY c.created_at,c.id`).all(goalId, attributeId) as Array<Record<string, unknown>>;
    return rows.map(row => ({
      id: String(row.contribution_id),
      actionId: String(row.action_id),
      goalId: String(row.goal_id),
      attributeId: String(row.attribute_id),
      amount: Number(row.amount),
      cumulativeAmount: Number(row.cumulative_amount),
      feedbackId: String(row.feedback_id),
      message: String(row.message),
      performedOn: row.performed_on === null ? null : String(row.performed_on),
      submittedAt: String(row.created_at),
      assessment: { completion: Number(row.completion), confidence: Number(row.confidence), reply: String(row.reply) },
    }));
  });
}

export function getLatestActionCompletionByIds(actionIds: string[]): Record<string, number | null> {
  const uniqueIds = [...new Set(actionIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))];
  if (!uniqueIds.length) return {};
  return withDatabase(database => {
    const placeholders = uniqueIds.map(() => '?').join(',');
    const rows = database.prepare(`SELECT action_id,completion FROM v2_action_feedback
      WHERE action_id IN (${placeholders}) ORDER BY created_at DESC,rowid DESC`).all(...uniqueIds) as Array<{ action_id: string; completion: number }>;
    const latest = new Map<string, number>();
    for (const row of rows) if (!latest.has(row.action_id)) latest.set(row.action_id, Number(row.completion));
    return Object.fromEntries(uniqueIds.map(id => [id, latest.get(id) ?? null]));
  });
}

export function getActionRecord(actionId: string) {
  const feedback = getActionFeedbackForAction(actionId);
  if (!feedback.length) {
    const action = getConfirmedPlannedAction(actionId);
    if (!action) throw new GoalDraftError('找不到已确认规划中的行动', 404);
    return { action, feedback };
  }
  return withDatabase(database => {
    const row = database.prepare('SELECT action_snapshot_json FROM v2_action_feedback WHERE action_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(actionId) as { action_snapshot_json: string } | undefined;
    const current = findConfirmedPlannedActionInDatabase(database, actionId);
    return { action: current ?? (row ? JSON.parse(row.action_snapshot_json) as ConfirmedPlannedAction : null), feedback };
  });
}

function ensureUnplannedSchema(database: DatabaseSync) {
  ensureSchema(database);
  database.exec(`CREATE TABLE IF NOT EXISTS v2_unplanned_action_kinds (
    feedback_id TEXT PRIMARY KEY REFERENCES v2_action_feedback(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('action','misc'))
  )`);
}

export function listUnplannedActionsForCalendar(startDate: string, endDate: string): ConfirmedPlannedAction[] {
  return withDatabase(database => {
    ensureUnplannedSchema(database);
    const rows = database.prepare(`SELECT f.action_snapshot_json FROM v2_action_feedback f
      JOIN v2_unplanned_action_kinds k ON k.feedback_id=f.id
      WHERE k.kind='action' AND f.performed_on>=? AND f.performed_on<=?
      ORDER BY f.performed_on,f.created_at`).all(startDate, endDate) as Array<{ action_snapshot_json: string }>;
    return rows.map(row => JSON.parse(row.action_snapshot_json) as ConfirmedPlannedAction);
  });
}

export function listUnplannedMiscellaneous() {
  return withDatabase(database => {
    ensureUnplannedSchema(database);
    return (database.prepare(`SELECT f.id,f.message,f.performed_on,f.completion,f.confidence,f.reply,f.created_at
      FROM v2_action_feedback f JOIN v2_unplanned_action_kinds k ON k.feedback_id=f.id
      WHERE k.kind='misc' ORDER BY f.created_at DESC`).all() as Array<Record<string, unknown>>).map(row => ({
      id: String(row.id), message: String(row.message), performedOn: String(row.performed_on),
      submittedAt: String(row.created_at),
      assessment: { completion: Number(row.completion), confidence: Number(row.confidence), reply: String(row.reply) },
    }));
  });
}

/** Returns unplanned actions and miscellaneous records that actually occurred in a given review week. */
export function listUnplannedItemsForReview(startDate: string, endDate: string) {
  return withDatabase(database => {
    ensureUnplannedSchema(database);
    const rows = database.prepare(`SELECT f.id,f.action_id,f.action_snapshot_json,f.message,f.performed_on,f.completion,f.confidence,f.reply,f.created_at,k.kind
      FROM v2_action_feedback f JOIN v2_unplanned_action_kinds k ON k.feedback_id=f.id
      WHERE f.performed_on>=? AND f.performed_on<=? ORDER BY f.performed_on,f.created_at,f.id`).all(startDate, endDate) as Array<Record<string, unknown>>;
    return rows.map(row => ({
      kind: String(row.kind) as 'action' | 'misc',
      action: row.kind === 'action' ? JSON.parse(String(row.action_snapshot_json)) as ConfirmedPlannedAction : null,
      feedback: { id: String(row.id), actionId: String(row.action_id), message: String(row.message), performedOn: String(row.performed_on),
        submittedAt: String(row.created_at), assessment: { completion: Number(row.completion), confidence: Number(row.confidence), reply: String(row.reply) } },
    }));
  });
}

export async function submitUnplannedActionFeedback(input: {
  message: unknown; idempotencyKey: unknown; performedOn: unknown;
}) {
  if (typeof input.message !== 'string' || !input.message.trim()) throw new GoalDraftError('请填写计划外反馈。', 400);
  if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim()) throw new GoalDraftError('请提供有效的重试标识。', 400);
  const performedOn = validPerformedOn(input.performedOn);
  if (!performedOn) throw new GoalDraftError('请提供实际发生日期。', 400);
  const message = input.message;
  const idempotencyKey = input.idempotencyKey.trim();
  const actionId = randomUUID();
  const goals = listEnabledGoals();
  const candidate: ConfirmedPlannedAction = {
    id: actionId, title: message.trim().slice(0, 100), description: message,
    date: performedOn, goalIds: goals.map(goal => goal.id),
    attributeIds: goals.flatMap(goal => goal.attributes.map(attribute => attribute.id)), weekStarts: [],
  };
  const fingerprint = requestFingerprint(actionId, message, performedOn);
  const cached = withDatabase(database => {
    ensureUnplannedSchema(database);
    const row = database.prepare('SELECT * FROM v2_action_feedback WHERE idempotency_key=?').get(idempotencyKey) as Record<string, unknown> | undefined;
    if (!row) return null;
    const kindRow = database.prepare('SELECT kind FROM v2_unplanned_action_kinds WHERE feedback_id=?').get(String(row.id)) as { kind: string } | undefined;
    if (!kindRow) throw new GoalDraftError('重试标识已用于其他行动反馈。', 409);
    return { feedback: mapFeedback(database, row), kind: kindRow.kind, snapshot: String(row.action_snapshot_json) };
  });
  if (cached) {
    const feedback = withDatabase(database => {
      const row = database.prepare('SELECT request_fingerprint FROM v2_action_feedback WHERE idempotency_key=?').get(idempotencyKey) as { request_fingerprint: string };
      if (row.request_fingerprint !== requestFingerprint(String((JSON.parse(cached.snapshot) as ConfirmedPlannedAction).id), message, performedOn)) throw new GoalDraftError('重试标识已用于不同的反馈内容。', 409);
      return cached.feedback;
    });
    return { kind: cached.kind, feedback, idempotent: true };
  }
  const assessment = await proposeActionAssessment({ action: candidate, goals, message, performedOn, priorCumulativeContributions: {}, unplanned: true });
  const contributingAssessments = assessment.contributions.filter(item =>
    item.amount * assessment.completion * assessment.confidence > 0);
  const kind = contributingAssessments.length ? 'action' : 'misc';
  return withDatabase(database => {
    ensureUnplannedSchema(database);
    database.exec('BEGIN IMMEDIATE');
    try {
      const concurrent = database.prepare(`SELECT f.*,k.kind FROM v2_action_feedback f JOIN v2_unplanned_action_kinds k ON k.feedback_id=f.id WHERE f.idempotency_key=?`).get(idempotencyKey) as (Record<string, unknown> & {kind:string}) | undefined;
      if (concurrent) {
        if (String(concurrent.message) !== message || String(concurrent.performed_on) !== performedOn) throw new GoalDraftError('重试标识已用于不同的反馈内容。', 409);
        database.exec('COMMIT'); return { kind: concurrent.kind, feedback: mapFeedback(database, concurrent), idempotent: true };
      }
      const keyCollision = database.prepare('SELECT 1 AS present FROM v2_action_feedback WHERE idempotency_key=?').get(idempotencyKey);
      if (keyCollision) throw new GoalDraftError('重试标识已用于其他行动反馈。', 409);
      const id = randomUUID(); const createdAt = new Date().toISOString();
      const contributedAttributeIds = contributingAssessments.map(item => item.attributeId);
      const action: ConfirmedPlannedAction = { ...candidate,
        goalIds: goals.filter(goal => goal.attributes.some(attribute => contributedAttributeIds.includes(attribute.id))).map(goal => goal.id),
        attributeIds: contributedAttributeIds };
      database.prepare(`INSERT INTO v2_action_feedback
        (id,idempotency_key,request_fingerprint,action_id,action_snapshot_json,message,performed_on,completion,confidence,reply,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id,idempotencyKey,requestFingerprint(actionId,message,performedOn),actionId,JSON.stringify(action),message,performedOn,assessment.completion,assessment.confidence,assessment.reply,createdAt);
      database.prepare('INSERT INTO v2_unplanned_action_kinds(feedback_id,kind) VALUES (?,?)').run(id,kind);
      if (kind === 'action') for (const contribution of contributingAssessments) {
        const owner = goals.find(goal => goal.attributes.some(attribute => attribute.id === contribution.attributeId));
        if (!owner) throw new GoalDraftError('Agent 返回了无效的目标属性。', 502);
        const amount = contribution.amount * assessment.completion * assessment.confidence;
        if (amount <= 0) continue;
        database.prepare(`INSERT INTO v2_attribute_contributions(id,feedback_id,action_id,goal_id,attribute_id,amount,cumulative_amount,created_at) VALUES (?,?,?,?,?,?,?,?)`)
          .run(randomUUID(),id,actionId,owner.id,contribution.attributeId,amount,amount,createdAt);
        database.prepare('UPDATE v2_goal_attributes SET progress=progress+? WHERE id=? AND goal_id=?').run(amount,contribution.attributeId,owner.id);
      }
      const row = database.prepare('SELECT * FROM v2_action_feedback WHERE id=?').get(id) as Record<string,unknown>;
      const feedback = mapFeedback(database,row); database.exec('COMMIT'); return {kind,feedback,idempotent:false};
    } catch(error) { database.exec('ROLLBACK'); throw error; }
  });
}

function validPerformedOn(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new GoalDraftError('实际发生日期必须使用 YYYY-MM-DD。', 400);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new GoalDraftError('实际发生日期无效。', 400);
  return value;
}

function validateActionContext(action: ConfirmedPlannedAction): StoredActionContext {
  const goals = action.goalIds.map(goalId => getEnabledGoal(goalId));
  const attributeOwner = new Map(goals.flatMap(goal => goal.attributes.map(attribute => [attribute.id, goal.id] as const)));
  if (!action.attributeIds.length || action.attributeIds.some(attributeId => !attributeOwner.has(attributeId)
    || !action.goalIds.includes(attributeOwner.get(attributeId)!))) {
    throw new GoalDraftError('规划行动的目标属性关联无效，无法安全评估。', 409);
  }
  return { action, goals };
}

function requestFingerprint(actionId: string, message: string, performedOn: string | null) {
  return createHash('sha256').update(JSON.stringify({ actionId, message, performedOn })).digest('hex');
}

function currentCumulative(database: DatabaseSync, actionId: string, attributeId: string): number {
  const row = database.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM v2_attribute_contributions WHERE action_id=? AND attribute_id=?')
    .get(actionId, attributeId) as { total: number };
  return Number(row.total);
}

export async function submitPlannedActionFeedback(input: {
  actionId: unknown;
  message: unknown;
  idempotencyKey: unknown;
  performedOn?: unknown;
}) {
  if (typeof input.actionId !== 'string' || !input.actionId.trim()) throw new GoalDraftError('请选择一项已安排的行动。', 400);
  if (typeof input.message !== 'string' || !input.message.trim()) throw new GoalDraftError('请填写行动反馈。', 400);
  if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.trim().length > 200) {
    throw new GoalDraftError('请提供有效的重试标识。', 400);
  }
  const actionId = input.actionId.trim();
  const message = input.message;
  const idempotencyKey = input.idempotencyKey.trim();
  const performedOn = validPerformedOn(input.performedOn);
  const fingerprint = requestFingerprint(actionId, message, performedOn);

  const cached = withDatabase(database => readFeedbackByKey(database, idempotencyKey));
  if (cached) {
    const existingFingerprint = withDatabase(database => {
      const row = database.prepare('SELECT request_fingerprint FROM v2_action_feedback WHERE idempotency_key=?').get(idempotencyKey) as { request_fingerprint: string };
      return row.request_fingerprint;
    });
    if (existingFingerprint !== fingerprint) throw new GoalDraftError('重试标识已用于不同的反馈内容。', 409);
    return { feedback: cached, idempotent: true };
  }

  const action = getConfirmedPlannedAction(actionId);
  if (!action) throw new GoalDraftError('只能反馈已确认每周规划中的行动。', 404);
  const context = validateActionContext(action);
  const priorCumulativeContributions = withDatabase(database => Object.fromEntries(action.attributeIds.map(attributeId => [
    attributeId, currentCumulative(database, actionId, attributeId),
  ])));
  const assessment = await proposeActionAssessment({ action, goals: context.goals, message, performedOn, priorCumulativeContributions });

  return withDatabase(database => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const concurrent = readFeedbackByKey(database, idempotencyKey);
      if (concurrent) {
        const row = database.prepare('SELECT request_fingerprint FROM v2_action_feedback WHERE idempotency_key=?').get(idempotencyKey) as { request_fingerprint: string };
        if (row.request_fingerprint !== fingerprint) throw new GoalDraftError('重试标识已用于不同的反馈内容。', 409);
        database.exec('COMMIT');
        return { feedback: concurrent, idempotent: true };
      }
      const latestAction = findConfirmedPlannedActionInDatabase(database, actionId);
      if (!latestAction || JSON.stringify(latestAction) !== JSON.stringify(action)) {
        throw new GoalDraftError('行动规划已变化，请重新读取后提交反馈。', 409);
      }
      const staleContributionContext = action.attributeIds.some(attributeId =>
        currentCumulative(database, actionId, attributeId) !== priorCumulativeContributions[attributeId]);
      if (staleContributionContext) {
        throw new GoalDraftError('行动贡献在评估期间已更新，请重试以重新评估。', 409);
      }
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      database.prepare(`INSERT INTO v2_action_feedback
        (id,idempotency_key,request_fingerprint,action_id,action_snapshot_json,message,performed_on,completion,confidence,reply,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, idempotencyKey, fingerprint, actionId, JSON.stringify(action), message,
        performedOn, assessment.completion, assessment.confidence, assessment.reply, createdAt);

      const contributionByAttribute = new Map(assessment.contributions.map(item => [item.attributeId, item.amount]));
      for (const [attributeId, baseAmount] of contributionByAttribute) {
        const goalId = context.goals.find(goal => goal.attributes.some(attribute => attribute.id === attributeId))?.id;
        if (!goalId || !action.attributeIds.includes(attributeId)) throw new GoalDraftError('Agent 返回了不属于该行动的目标属性贡献。', 502);
        const prior = currentCumulative(database, actionId, attributeId);
        const cumulativeTarget = baseAmount * assessment.completion * assessment.confidence;
        const amount = Math.max(0, cumulativeTarget - prior);
        if (amount <= 0) continue;
        const cumulativeAmount = prior + amount;
        database.prepare(`INSERT INTO v2_attribute_contributions
          (id,feedback_id,action_id,goal_id,attribute_id,amount,cumulative_amount,created_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), id, actionId, goalId, attributeId, amount, cumulativeAmount, createdAt);
        database.prepare('UPDATE v2_goal_attributes SET progress=progress+? WHERE id=? AND goal_id=?').run(amount, attributeId, goalId);
      }
      const row = database.prepare('SELECT * FROM v2_action_feedback WHERE id=?').get(id) as Record<string, unknown>;
      const feedback = mapFeedback(database, row);
      database.exec('COMMIT');
      return { feedback, idempotent: false };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
}
