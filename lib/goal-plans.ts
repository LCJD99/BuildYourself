import { randomUUID } from 'node:crypto';
import { openDatabase } from './store';

export type GoalDomain = 'learning' | 'fitness' | 'project' | 'general';
export type GoalPlanStatus = 'draft' | 'active';
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
export type GoalPlan = GoalPlanDraft & {
  id: string;
  status: GoalPlanStatus;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
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

function ensureSchema() {
  const database = openDatabase();
  database.exec(`
    CREATE TABLE IF NOT EXISTS goal_plans (
      id TEXT PRIMARY KEY,
      source_intent TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('draft', 'active')),
      plan_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      activated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS goal_plan_actions (
      id TEXT PRIMARY KEY,
      goal_plan_id TEXT NOT NULL REFERENCES goal_plans(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      details TEXT,
      estimate_minutes INTEGER,
      status TEXT NOT NULL CHECK (status IN ('pending_schedule', 'scheduled', 'done')),
      created_at TEXT NOT NULL
    );
  `);
  return database;
}

type GoalPlanRow = { id: string; status: GoalPlanStatus; plan_json: string; created_at: string; updated_at: string; activated_at: string | null };

function toGoalPlan(row: GoalPlanRow): GoalPlan {
  const plan = JSON.parse(row.plan_json) as GoalPlanDraft;
  return { ...plan, id: row.id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, activatedAt: row.activated_at, validation: validateGoalPlan(plan) };
}

export function saveGoalPlanDraft(input: unknown): GoalPlan {
  const plan = normalizeDraft(input);
  const id = randomUUID();
  const now = new Date().toISOString();
  const database = ensureSchema();
  try {
    database.prepare('INSERT INTO goal_plans (id, source_intent, status, plan_json, created_at, updated_at, activated_at) VALUES (?, ?, \'draft\', ?, ?, ?, NULL)')
      .run(id, plan.sourceIntent ?? '', JSON.stringify(plan), now, now);
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
    return row ? toGoalPlan(row) : null;
  } finally {
    database.close();
  }
}

export function listGoalPlans(): GoalPlan[] {
  const database = ensureSchema();
  try {
    return (database.prepare('SELECT * FROM goal_plans ORDER BY updated_at DESC, created_at DESC').all() as GoalPlanRow[]).map(toGoalPlan);
  } finally {
    database.close();
  }
}

export function listPendingGoalActions(): PendingGoalAction[] {
  const database = ensureSchema();
  try {
    const rows = database.prepare(`SELECT a.id, a.goal_plan_id, p.plan_json, a.title, a.details, a.estimate_minutes, a.status, a.created_at
      FROM goal_plan_actions a JOIN goal_plans p ON p.id=a.goal_plan_id
      WHERE a.status='pending_schedule' ORDER BY a.created_at, a.id`).all() as Array<Record<string, unknown>>;
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
      return toGoalPlan(row);
    }
    const plan = JSON.parse(row.plan_json) as GoalPlanDraft;
    const validation = validateGoalPlan(plan);
    if (!validation.ready) throw new Error(`目标契约尚未通过校验：${validation.issues.join(' ')}`);
    const activeCount = database.prepare("SELECT COUNT(*) AS count FROM goal_plans WHERE status='active'").get() as { count: number };
    if (Number(activeCount.count) >= 10) throw new Error('活跃目标已达到 10 个，请先暂停、完成或归档一个目标。');

    const activatedAt = new Date().toISOString();
    database.prepare("UPDATE goal_plans SET status='active', updated_at=?, activated_at=? WHERE id=?")
      .run(activatedAt, activatedAt, id);
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
