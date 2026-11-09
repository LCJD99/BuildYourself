import { randomUUID } from 'node:crypto';
import { openDatabase } from './store';

export type GoalDomain = 'learning' | 'fitness' | 'project' | 'general';
export type GoalPlanStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived' | 'abandoned';
export type MilestoneStage = 'near' | 'future';
export type StandardAssessment = 'reasonable' | 'provisional' | 'needs_revision';
export type EvidenceAvailability = 'available' | 'future' | 'uncertain' | 'unavailable';
export type BaselineStatus = 'known' | 'unknown' | 'to_measure' | 'not_applicable';
export type EvidenceLevel = 'E1' | 'E2' | 'E3';

export type GoalMilestone = {
  id: string;
  title: string | null;
  stage: MilestoneStage;
  successCriteria: string | null;
  standardAssessment: StandardAssessment;
  evidenceAvailability: EvidenceAvailability;
  reviewNote: string | null;
  evidenceRequirement: string | null;
};

export type GoalActionDraft = {
  id: string;
  title: string | null;
  details: string | null;
  estimateMinutes: number | null;
  specificity: 'concrete' | 'draft';
};

export type GoalPlanDraft = {
  sourceIntent: string | null;
  title: string | null;
  domain: GoalDomain;
  context: string | null;
  successDescription: string | null;
  observableResult: string | null;
  baselineStatus: BaselineStatus;
  baselineAction: string | null;
  milestones: GoalMilestone[];
  nextActions: GoalActionDraft[];
  constraints: { status: 'confirmed' | 'needs_clarification'; items: string[] };
  evidenceRequirements: Array<{ id: string; item: string | null; description: string | null; minimumLevel: EvidenceLevel | null }>;
  reviewCycleDays: number | null;
};

export type GoalPlanValidation = { ready: boolean; issues: string[] };
export type CompletionEvidence = { requirementId: string; description: string; level: EvidenceLevel };
export type GoalPlanEventAction = 'created' | 'activated' | 'paused' | 'resumed' | 'completion_requested' | 'completion_cancelled' | 'completion_confirmed' | 'archived' | 'abandoned' | 'imported';
type GoalPlanLifecycleAction = 'pause' | 'resume' | 'archive' | 'abandon' | 'request_completion' | 'cancel_completion' | 'confirm_completion';
export type GoalPlanEvent = {
  id: string;
  goalPlanId: string;
  fromStatus: GoalPlanStatus | null;
  toStatus: GoalPlanStatus | null;
  action: GoalPlanEventAction;
  reason: string | null;
  evidence: CompletionEvidence[] | null;
  createdAt: string;
};
export type PendingGoalCompletion = { evidence: CompletionEvidence[]; requestedAt: string };
export type GoalPlan = GoalPlanDraft & {
  id: string;
  status: GoalPlanStatus;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  completedAt: string | null;
  lifecycleReason: string | null;
  lifecycleEvents: GoalPlanEvent[];
  pendingCompletion: PendingGoalCompletion | null;
  validation: GoalPlanValidation;
};

export type PendingGoalAction = {
  id: string;
  goalPlanId: string;
  goalTitle: string;
  title: string;
  details: string | null;
  estimateMinutes: number | null;
  status: 'pending_schedule';
  createdAt: string;
};

const domains = new Set<GoalDomain>(['learning', 'fitness', 'project', 'general']);
const baselineStatuses = new Set<BaselineStatus>(['known', 'unknown', 'to_measure', 'not_applicable']);
const standardAssessments = new Set<StandardAssessment>(['reasonable', 'provisional', 'needs_revision']);
const evidenceAvailabilities = new Set<EvidenceAvailability>(['available', 'future', 'uncertain', 'unavailable']);
const evidenceLevels = new Set<EvidenceLevel>(['E1', 'E2', 'E3']);

function nullableText(value: unknown, field: string, limit = 2000): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${field} 必须是文本`);
  const trimmed = value.trim();
  if (trimmed.length > limit) throw new Error(`${field} 不能超过 ${limit} 个字符`);
  return trimmed || null;
}

function choice<T extends string>(value: unknown, options: Set<T>, fallback: T, field: string): T {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !options.has(value as T)) throw new Error(`${field} 无效`);
  return value as T;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} 格式无效`);
  return value as Record<string, unknown>;
}

function list(value: unknown, field: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} 必须是列表`);
  return value;
}

function normalizeDraft(input: unknown): GoalPlanDraft {
  const value = object(input, '目标计划');
  const milestones = list(value.milestones, '里程碑').map((entry, index): GoalMilestone => {
    const item = object(entry, `里程碑 ${index + 1}`);
    return {
      id: nullableText(item.id, '里程碑 ID', 100) ?? randomUUID(),
      title: nullableText(item.title, '里程碑名称', 240),
      stage: choice(item.stage, new Set<MilestoneStage>(['near', 'future']), 'future', '里程碑阶段'),
      successCriteria: nullableText(item.successCriteria, '里程碑标准'),
      standardAssessment: choice(item.standardAssessment, standardAssessments, 'needs_revision', '里程碑标准评估'),
      evidenceAvailability: choice(item.evidenceAvailability, evidenceAvailabilities, 'uncertain', '里程碑证据可获得性'),
      reviewNote: nullableText(item.reviewNote, '里程碑评估说明'),
      evidenceRequirement: nullableText(item.evidenceRequirement, '里程碑证据要求'),
    };
  });
  const nextActions = list(value.nextActions, '近期行动').map((entry, index): GoalActionDraft => {
    const item = object(entry, `近期行动 ${index + 1}`);
    const estimate = item.estimateMinutes;
    if (estimate !== undefined && estimate !== null && (typeof estimate !== 'number' || !Number.isInteger(estimate) || estimate < 1 || estimate > 10080)) {
      throw new Error('行动预计时长必须是 1 到 10080 分钟的整数');
    }
    return {
      id: nullableText(item.id, '行动 ID', 100) ?? randomUUID(),
      title: nullableText(item.title, '行动名称', 240),
      details: nullableText(item.details, '行动说明'),
      estimateMinutes: typeof estimate === 'number' ? estimate : null,
      specificity: choice(item.specificity, new Set<'concrete' | 'draft'>(['concrete', 'draft']), 'draft', '行动具体程度'),
    };
  });
  const constraintsInput = value.constraints === undefined ? {} : object(value.constraints, '约束');
  const constraintsStatus = choice(constraintsInput.status, new Set<'confirmed' | 'needs_clarification'>(['confirmed', 'needs_clarification']), 'needs_clarification', '约束确认状态');
  const constraints = list(constraintsInput.items, '约束事项').map((entry, index) => {
    if (typeof entry !== 'string') throw new Error(`约束 ${index + 1} 必须是文本`);
    return entry.trim();
  }).filter(Boolean);
  const evidenceRequirements = list(value.evidenceRequirements, '证据要求').map((entry, index) => {
    const item = object(entry, `证据要求 ${index + 1}`);
    return {
      id: nullableText(item.id, '证据要求 ID', 100) ?? randomUUID(),
      item: nullableText(item.item, '证据对象', 240),
      description: nullableText(item.description, '证据说明'),
      minimumLevel: item.minimumLevel === undefined || item.minimumLevel === null
        ? null
        : choice(item.minimumLevel, evidenceLevels, 'E1', '最低证据等级'),
    };
  });
  const reviewCycleDays = value.reviewCycleDays;
  if (reviewCycleDays !== undefined && reviewCycleDays !== null && (typeof reviewCycleDays !== 'number' || !Number.isInteger(reviewCycleDays) || reviewCycleDays < 1 || reviewCycleDays > 3650)) {
    throw new Error('复盘周期必须是 1 到 3650 天的整数');
  }

  return {
    sourceIntent: nullableText(value.sourceIntent, '原始意图', 1000),
    title: nullableText(value.title, '目标名称', 240),
    domain: choice(value.domain, domains, 'general', '目标模板'),
    context: nullableText(value.context, '使用场景'),
    successDescription: nullableText(value.successDescription, '成功描述'),
    observableResult: nullableText(value.observableResult, '可观察结果'),
    baselineStatus: choice(value.baselineStatus, baselineStatuses, 'unknown', '当前基础状态'),
    baselineAction: nullableText(value.baselineAction, '基线行动'),
    milestones,
    nextActions,
    constraints: { status: constraintsStatus, items: constraints },
    evidenceRequirements,
    reviewCycleDays: typeof reviewCycleDays === 'number' ? reviewCycleDays : null,
  };
}

export function validateGoalPlan(plan: GoalPlanDraft): GoalPlanValidation {
  const issues: string[] = [];
  if (!plan.sourceIntent) issues.push('需要保留用户的原始目标意图。');
  if (!plan.title) issues.push('需要填写目标名称。');
  if (!plan.successDescription) issues.push('需要说明怎样算达到目标。');
  if (!plan.observableResult) issues.push('需要写明可观察的结果或能力表现。');
  if ((plan.baselineStatus === 'unknown' || plan.baselineStatus === 'to_measure') && !plan.baselineAction) {
    issues.push('当前水平未知，需要提出一次可执行的基线行动。');
  }
  if (plan.constraints.status !== 'confirmed') issues.push('需要确认是否存在会改变计划的关键限制。');
  if (plan.reviewCycleDays === null) issues.push('需要设置复盘周期。');
  if (plan.milestones.length === 0) issues.push('至少需要一个里程碑；远期里程碑可以先保留待细化。');
  for (const milestone of plan.milestones) {
    const label = milestone.title ?? '未命名里程碑';
    if (!milestone.title) issues.push('需要填写里程碑名称。');
    if (milestone.standardAssessment === 'needs_revision') issues.push(`里程碑「${label}」仍需调整标准。`);
    if (milestone.stage === 'near') {
      if (!milestone.successCriteria) issues.push(`近期里程碑「${label}」需要可核对的成功标准。`);
      if (milestone.standardAssessment !== 'reasonable') issues.push(`近期里程碑「${label}」的标准尚未确认合理。`);
      if (milestone.evidenceAvailability !== 'available') issues.push(`近期里程碑「${label}」需要可获得的证据。`);
      if (!milestone.evidenceRequirement) issues.push(`近期里程碑「${label}」需要说明证据要求。`);
      if (!milestone.reviewNote) issues.push(`近期里程碑「${label}」需要记录标准和证据评估理由。`);
    } else {
      if (!milestone.reviewNote) issues.push(`远期里程碑「${label}」需要说明评估结果或暂缓细化的理由。`);
      if (milestone.standardAssessment === 'reasonable' && !milestone.successCriteria) {
        issues.push(`远期里程碑「${label}」标为合理时需要填写可核对标准。`);
      }
      if (milestone.evidenceAvailability === 'unavailable') issues.push(`里程碑「${label}」的证据当前无法获得，需要调整证据要求。`);
    }
  }
  if (!plan.nextActions.some(action => action.title && action.specificity === 'concrete')) {
    issues.push('至少需要一项具体、可执行的近期行动。');
  }
  if (plan.evidenceRequirements.length === 0 || !plan.evidenceRequirements.some(item => item.item && item.description && item.minimumLevel)) {
    issues.push('需要至少一项写明对象、内容和最低等级的证据要求。');
  }
  return { ready: issues.length === 0, issues };
}

const goalPlanStatuses = "'draft', 'active', 'paused', 'completed', 'archived', 'abandoned'";

function createGoalPlansTable(database: ReturnType<typeof openDatabase>, tableName = 'goal_plans') {
  database.exec(`CREATE TABLE ${tableName} (
    id TEXT PRIMARY KEY,
    source_intent TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN (${goalPlanStatuses})),
    plan_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    activated_at TEXT,
    completed_at TEXT,
    lifecycle_reason TEXT
  )`);
}

function ensureSchema() {
  const database = openDatabase();
  let migrated = false;
  const existing = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='goal_plans'").get() as { sql: string } | undefined;
  if (!existing) {
    createGoalPlansTable(database);
  } else {
    const columns = database.prepare('PRAGMA table_info(goal_plans)').all() as { name: string }[];
    const hasLifecycleColumns = columns.some(column => column.name === 'completed_at') && columns.some(column => column.name === 'lifecycle_reason');
    if (!existing.sql.includes("'paused'") || !hasLifecycleColumns) {
      database.exec('PRAGMA foreign_keys=OFF');
      try {
        database.exec('BEGIN IMMEDIATE');
        createGoalPlansTable(database, 'goal_plans_next');
        database.exec(`INSERT INTO goal_plans_next (id, source_intent, status, plan_json, created_at, updated_at, activated_at)
          SELECT id, source_intent, status, plan_json, created_at, updated_at, activated_at FROM goal_plans`);
        database.exec('DROP TABLE goal_plans; ALTER TABLE goal_plans_next RENAME TO goal_plans; COMMIT');
        migrated = true;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      } finally {
        database.exec('PRAGMA foreign_keys=ON');
      }
    }
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS goal_plan_actions (
      id TEXT PRIMARY KEY,
      goal_plan_id TEXT NOT NULL REFERENCES goal_plans(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      details TEXT,
      estimate_minutes INTEGER,
      status TEXT NOT NULL CHECK (status IN ('pending_schedule', 'scheduled', 'done')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS goal_plan_events (
      id TEXT PRIMARY KEY,
      goal_plan_id TEXT NOT NULL REFERENCES goal_plans(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      evidence_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS goal_plan_completion_requests (
      goal_plan_id TEXT PRIMARY KEY REFERENCES goal_plans(id) ON DELETE CASCADE,
      evidence_json TEXT NOT NULL,
      requested_at TEXT NOT NULL
    );
  `);
  if (migrated) {
    const legacyPlans = database.prepare('SELECT id, status, updated_at FROM goal_plans').all() as { id: string; status: GoalPlanStatus; updated_at: string }[];
    const insertEvent = database.prepare(`INSERT INTO goal_plan_events (id, goal_plan_id, from_status, to_status, action, reason, evidence_json, created_at)
      VALUES (?, ?, NULL, ?, 'imported', '生命周期记录迁移时已有的状态', NULL, ?)`);
    for (const plan of legacyPlans) insertEvent.run(randomUUID(), plan.id, plan.status, plan.updated_at);
  }
  return database;
}

type GoalPlanRow = { id: string; status: GoalPlanStatus; plan_json: string; created_at: string; updated_at: string; activated_at: string | null; completed_at: string | null; lifecycle_reason: string | null };
type GoalPlanEventRow = { id: string; goal_plan_id: string; from_status: GoalPlanStatus | null; to_status: GoalPlanStatus; action: GoalPlanEventAction; reason: string | null; evidence_json: string | null; created_at: string };

function readEvents(database: ReturnType<typeof openDatabase>, id: string): GoalPlanEvent[] {
  const rows = database.prepare('SELECT * FROM goal_plan_events WHERE goal_plan_id=? ORDER BY created_at, rowid').all(id) as GoalPlanEventRow[];
  return rows.map(row => ({
    id: row.id,
    goalPlanId: row.goal_plan_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    action: row.action,
    reason: row.reason,
    evidence: row.evidence_json ? JSON.parse(row.evidence_json) as CompletionEvidence[] : null,
    createdAt: row.created_at,
  }));
}

function readPendingCompletion(database: ReturnType<typeof openDatabase>, id: string): PendingGoalCompletion | null {
  const row = database.prepare('SELECT evidence_json, requested_at FROM goal_plan_completion_requests WHERE goal_plan_id=?').get(id) as { evidence_json: string; requested_at: string } | undefined;
  return row ? { evidence: JSON.parse(row.evidence_json) as CompletionEvidence[], requestedAt: row.requested_at } : null;
}

function appendEvent(database: ReturnType<typeof openDatabase>, goalPlanId: string, fromStatus: GoalPlanStatus | null, toStatus: GoalPlanStatus, action: GoalPlanEventAction, reason: string | null = null, evidence: CompletionEvidence[] | null = null, createdAt = new Date().toISOString()) {
  database.prepare(`INSERT INTO goal_plan_events (id, goal_plan_id, from_status, to_status, action, reason, evidence_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), goalPlanId, fromStatus, toStatus, action, reason, evidence ? JSON.stringify(evidence) : null, createdAt);
}

function toGoalPlan(row: GoalPlanRow, lifecycleEvents: GoalPlanEvent[] = [], pendingCompletion: PendingGoalCompletion | null = null): GoalPlan {
  const plan = JSON.parse(row.plan_json) as GoalPlanDraft;
  return { ...plan, id: row.id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, activatedAt: row.activated_at, completedAt: row.completed_at, lifecycleReason: row.lifecycle_reason, lifecycleEvents, pendingCompletion, validation: validateGoalPlan(plan) };
}

export function saveGoalPlanDraft(input: unknown): GoalPlan {
  const plan = normalizeDraft(input);
  const id = randomUUID();
  const now = new Date().toISOString();
  const database = ensureSchema();
  try {
    database.exec('BEGIN IMMEDIATE');
    database.prepare('INSERT INTO goal_plans (id, source_intent, status, plan_json, created_at, updated_at, activated_at) VALUES (?, ?, \'draft\', ?, ?, ?, NULL)')
      .run(id, plan.sourceIntent ?? '', JSON.stringify(plan), now, now);
    appendEvent(database, id, null, 'draft', 'created', null, null, now);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
  return getGoalPlan(id)!;
}

export function updateGoalPlanDraft(id: string, input: unknown): GoalPlan {
  const now = new Date().toISOString();
  const database = ensureSchema();
  try {
    const current = database.prepare("SELECT plan_json FROM goal_plans WHERE id=? AND status='draft'").get(id) as { plan_json: string } | undefined;
    if (!current) throw new Error('找不到可编辑的目标草稿');
    const patch = object(input, '目标计划');
    const previous = JSON.parse(current.plan_json) as GoalPlanDraft;
    const merged = {
      ...previous,
      ...patch,
      constraints: patch.constraints === undefined
        ? previous.constraints
        : { ...previous.constraints, ...object(patch.constraints, '约束') },
    };
    const plan = normalizeDraft(merged);
    const result = database.prepare("UPDATE goal_plans SET source_intent=?, plan_json=?, updated_at=? WHERE id=? AND status='draft'")
      .run(plan.sourceIntent ?? '', JSON.stringify(plan), now, id);
    if (Number(result.changes) !== 1) throw new Error('找不到可编辑的目标草稿');
  } finally {
    database.close();
  }
  return getGoalPlan(id)!;
}

export function getGoalPlan(id: string): GoalPlan | null {
  const database = ensureSchema();
  try {
    const row = database.prepare('SELECT * FROM goal_plans WHERE id=?').get(id) as GoalPlanRow | undefined;
    return row ? toGoalPlan(row, readEvents(database, id), readPendingCompletion(database, id)) : null;
  } finally {
    database.close();
  }
}

export function listGoalPlans(): GoalPlan[] {
  const database = ensureSchema();
  try {
    const rows = database.prepare('SELECT * FROM goal_plans ORDER BY updated_at DESC, created_at DESC').all() as GoalPlanRow[];
    const events = database.prepare('SELECT * FROM goal_plan_events ORDER BY created_at, rowid').all() as GoalPlanEventRow[];
    const pending = database.prepare('SELECT * FROM goal_plan_completion_requests').all() as { goal_plan_id: string; evidence_json: string; requested_at: string }[];
    const eventsByPlan = new Map<string, GoalPlanEvent[]>();
    for (const row of events) {
      const list = eventsByPlan.get(row.goal_plan_id) ?? [];
      list.push({ id: row.id, goalPlanId: row.goal_plan_id, fromStatus: row.from_status, toStatus: row.to_status, action: row.action, reason: row.reason, evidence: row.evidence_json ? JSON.parse(row.evidence_json) as CompletionEvidence[] : null, createdAt: row.created_at });
      eventsByPlan.set(row.goal_plan_id, list);
    }
    const pendingByPlan = new Map(pending.map(row => [row.goal_plan_id, { evidence: JSON.parse(row.evidence_json) as CompletionEvidence[], requestedAt: row.requested_at }]));
    return rows.map(row => toGoalPlan(row, eventsByPlan.get(row.id) ?? [], pendingByPlan.get(row.id) ?? null));
  } finally {
    database.close();
  }
}

export function listPendingGoalActions(): PendingGoalAction[] {
  const database = ensureSchema();
  try {
    const rows = database.prepare(`SELECT a.id, a.goal_plan_id, p.plan_json, a.title, a.details, a.estimate_minutes, a.status, a.created_at
      FROM goal_plan_actions a JOIN goal_plans p ON p.id=a.goal_plan_id
      WHERE a.status='pending_schedule' AND p.status='active' ORDER BY a.created_at, a.id`).all() as Array<Record<string, unknown>>;
    return rows.map(row => {
      const plan = JSON.parse(String(row.plan_json)) as GoalPlanDraft;
      return {
        id: String(row.id),
        goalPlanId: String(row.goal_plan_id),
        goalTitle: plan.title ?? '未命名目标',
        title: String(row.title),
        details: row.details === null ? null : String(row.details),
        estimateMinutes: row.estimate_minutes === null ? null : Number(row.estimate_minutes),
        status: 'pending_schedule',
        createdAt: String(row.created_at),
      };
    });
  } finally {
    database.close();
  }
}

export function activateGoalPlan(id: string): GoalPlan {
  const database = ensureSchema();
  let inTransaction = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    const row = database.prepare('SELECT * FROM goal_plans WHERE id=?').get(id) as GoalPlanRow | undefined;
    if (!row) throw new Error('找不到目标草稿');
    if (row.status === 'active') {
      database.exec('COMMIT');
      inTransaction = false;
      return getGoalPlan(id)!;
    }
    if (row.status !== 'draft') throw new Error('只能启用目标草稿。');
    const plan = JSON.parse(row.plan_json) as GoalPlanDraft;
    const validation = validateGoalPlan(plan);
    if (!validation.ready) throw new Error(`目标契约尚未通过校验：${validation.issues.join(' ')}`);
    const activeCount = database.prepare("SELECT COUNT(*) AS count FROM goal_plans WHERE status='active'").get() as { count: number };
    if (Number(activeCount.count) >= 10) throw new Error('活跃目标已达到 10 个，请先暂停、完成或归档一个目标。');

    const activatedAt = new Date().toISOString();
    database.prepare("UPDATE goal_plans SET status='active', updated_at=?, activated_at=?, lifecycle_reason=NULL WHERE id=?")
      .run(activatedAt, activatedAt, id);
    appendEvent(database, id, 'draft', 'active', 'activated', null, null, activatedAt);
    const insertAction = database.prepare("INSERT INTO goal_plan_actions (id, goal_plan_id, title, details, estimate_minutes, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending_schedule', ?)");
    for (const action of plan.nextActions.filter(item => item.title && item.specificity === 'concrete')) {
      insertAction.run(randomUUID(), id, action.title, action.details, action.estimateMinutes, activatedAt);
    }
    database.exec('COMMIT');
    inTransaction = false;
  } catch (error) {
    if (inTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
  return getGoalPlan(id)!;
}

const evidenceRanks: Record<EvidenceLevel, number> = { E1: 1, E2: 2, E3: 3 };

function normalizeCompletionEvidence(plan: GoalPlanDraft, input: unknown): CompletionEvidence[] {
  const items = list(input, '完成证据');
  const evidence = items.map((entry, index): CompletionEvidence => {
    const item = object(entry, `完成证据 ${index + 1}`);
    const requirementId = nullableText(item.requirementId, '证据要求 ID', 100);
    const description = nullableText(item.description, '证据内容或位置', 2000);
    const level = choice(item.level, evidenceLevels, 'E1', '证据等级');
    if (!requirementId || !description) throw new Error(`第 ${index + 1} 项证据需要填写内容或位置。`);
    return { requirementId, description, level };
  });
  if (!plan.evidenceRequirements.length || plan.evidenceRequirements.some(requirement => !requirement.id || !requirement.minimumLevel)) {
    throw new Error('目标尚未设置完整的完成证据条件。');
  }
  if (evidence.length !== plan.evidenceRequirements.length || new Set(evidence.map(item => item.requirementId)).size !== evidence.length) {
    throw new Error('每项证据要求都需要提交证据，且不能重复。');
  }
  for (const requirement of plan.evidenceRequirements) {
    const submitted = evidence.find(item => item.requirementId === requirement.id);
    if (!submitted) throw new Error('每项证据要求都需要提交证据。');
    if (evidenceRanks[submitted.level] < evidenceRanks[requirement.minimumLevel!]) {
      throw new Error(`证据等级未达到要求：「${requirement.item || '未命名对象'}」需要 ${requirement.minimumLevel}。`);
    }
  }
  return evidence;
}

export function transitionGoalPlan(id: string, input: unknown): GoalPlan {
  const request = object(input, '目标状态变更');
  const lifecycleActions = new Set<GoalPlanLifecycleAction>(['pause', 'resume', 'archive', 'abandon', 'request_completion', 'cancel_completion', 'confirm_completion']);
  if (typeof request.action !== 'string' || !lifecycleActions.has(request.action as GoalPlanLifecycleAction)) throw new Error('目标状态变更无效。');
  const normalizedAction = request.action as GoalPlanLifecycleAction;
  const reason = nullableText(request.reason, '状态变更原因', 1000);
  if ((normalizedAction === 'archive' || normalizedAction === 'abandon') && !reason) throw new Error('请填写归档原因或放弃原因。');
  if (normalizedAction === 'confirm_completion' && request.confirmed !== true) throw new Error('需要单独确认完成。');

  const database = ensureSchema();
  let inTransaction = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    const row = database.prepare('SELECT * FROM goal_plans WHERE id=?').get(id) as GoalPlanRow | undefined;
    if (!row) throw new Error('找不到目标。');
    const plan = JSON.parse(row.plan_json) as GoalPlanDraft;
    const now = new Date().toISOString();
    const update = (status: GoalPlanStatus, lifecycleReason: string | null, completedAt: string | null = row.completed_at) => {
      database.prepare('UPDATE goal_plans SET status=?, updated_at=?, lifecycle_reason=?, completed_at=? WHERE id=?')
        .run(status, now, lifecycleReason, completedAt, id);
    };

    switch (normalizedAction) {
      case 'pause':
        if (row.status !== 'active') throw new Error('只有活跃目标可以暂停。');
        update('paused', reason);
        appendEvent(database, id, 'active', 'paused', 'paused', reason, null, now);
        break;
      case 'resume': {
        if (row.status !== 'paused') throw new Error('只有暂停目标可以恢复。');
        const activeCount = database.prepare("SELECT COUNT(*) AS count FROM goal_plans WHERE status='active'").get() as { count: number };
        if (Number(activeCount.count) >= 10) throw new Error('活跃目标已达到 10 个，请先暂停、完成或归档一个目标。');
        update('active', null);
        appendEvent(database, id, 'paused', 'active', 'resumed', null, null, now);
        break;
      }
      case 'archive':
      case 'abandon': {
        if (!['draft', 'active', 'paused'].includes(row.status)) throw new Error('已结束的目标不能再次归档。');
        const pending = readPendingCompletion(database, id);
        if (pending) {
          database.prepare('DELETE FROM goal_plan_completion_requests WHERE goal_plan_id=?').run(id);
          appendEvent(database, id, row.status, row.status, 'completion_cancelled', '目标已归档，完成申请已撤回。', pending.evidence, now);
        }
        const status = normalizedAction === 'archive' ? 'archived' : 'abandoned';
        const eventAction = normalizedAction === 'archive' ? 'archived' : 'abandoned';
        update(status, reason);
        appendEvent(database, id, row.status, status, eventAction, reason, null, now);
        break;
      }
      case 'request_completion': {
        if (!['active', 'paused'].includes(row.status)) throw new Error('只有活跃或暂停目标可以申请完成。');
        if (readPendingCompletion(database, id)) throw new Error('已有待确认的完成申请。');
        const evidence = normalizeCompletionEvidence(plan, request.evidence);
        database.prepare('INSERT INTO goal_plan_completion_requests (goal_plan_id, evidence_json, requested_at) VALUES (?, ?, ?)')
          .run(id, JSON.stringify(evidence), now);
        update(row.status, row.lifecycle_reason);
        appendEvent(database, id, row.status, row.status, 'completion_requested', null, evidence, now);
        break;
      }
      case 'cancel_completion': {
        const pending = readPendingCompletion(database, id);
        if (!pending) throw new Error('没有待撤回的完成申请。');
        database.prepare('DELETE FROM goal_plan_completion_requests WHERE goal_plan_id=?').run(id);
        update(row.status, row.lifecycle_reason);
        appendEvent(database, id, row.status, row.status, 'completion_cancelled', null, pending.evidence, now);
        break;
      }
      case 'confirm_completion': {
        if (!['active', 'paused'].includes(row.status)) throw new Error('只有活跃或暂停目标可以确认完成。');
        const pending = readPendingCompletion(database, id);
        if (!pending) throw new Error('没有待确认的完成申请。');
        const evidence = normalizeCompletionEvidence(plan, pending.evidence);
        database.prepare('DELETE FROM goal_plan_completion_requests WHERE goal_plan_id=?').run(id);
        update('completed', null, now);
        appendEvent(database, id, row.status, 'completed', 'completion_confirmed', null, evidence, now);
        break;
      }
    }
    database.exec('COMMIT');
    inTransaction = false;
  } catch (error) {
    if (inTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
  return getGoalPlan(id)!;
}
