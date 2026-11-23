import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { GoalDraftError, getEnabledGoal, listEnabledGoals, type GoalV2 } from './goal-drafts-v2';
import { openDatabase } from './store';
import { proposeWeeklyPlan, type WeeklyPlanAction } from './weekly-plan-agent';

export type V2WeeklyPlan = {
  id: string;
  weekStart: string;
  revision: number;
  activeRevision: number | null;
  status: 'draft' | 'confirmed' | 'superseded';
  actions: WeeklyPlanAction[];
  reply?: string;
  userMessage: string | null;
  createdAt: string;
};

export type WeeklyPlanGeneration = {
  status: 'not_started' | 'generating' | 'ready' | 'failed';
  goalId: string;
  weekStart: string;
  attempts: number;
  error: string | null;
  planId: string | null;
  updatedAt: string | null;
};

function ensureSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS v2_weekly_plans (
      id TEXT PRIMARY KEY,
      week_start TEXT NOT NULL UNIQUE,
      current_revision INTEGER NOT NULL DEFAULT 0,
      active_revision INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS v2_weekly_plan_versions (
      plan_id TEXT NOT NULL REFERENCES v2_weekly_plans(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed', 'superseded')),
      actions_json TEXT NOT NULL,
      goal_ids_json TEXT NOT NULL,
      reply TEXT NOT NULL,
      user_message TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      PRIMARY KEY(plan_id, revision)
    );
    CREATE TABLE IF NOT EXISTS v2_weekly_plan_generation (
      goal_id TEXT NOT NULL REFERENCES v2_goals(id) ON DELETE CASCADE,
      week_start TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
      attempts INTEGER NOT NULL,
      error TEXT,
      plan_id TEXT REFERENCES v2_weekly_plans(id),
      request_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(goal_id, week_start)
    );
  `);
  const versionColumns = database.prepare('PRAGMA table_info(v2_weekly_plan_versions)').all() as Array<{ name: string }>;
  if (!versionColumns.some(column => column.name === 'user_message')) database.exec('ALTER TABLE v2_weekly_plan_versions ADD COLUMN user_message TEXT');
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

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function currentWeekStart(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const dateValue = `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}-${parts.find(part => part.type === 'day')!.value}`;
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function assertWeekStart(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !validDate(value) || new Date(`${value}T00:00:00.000Z`).getUTCDay() !== 1) {
    throw new GoalDraftError('周起始日期必须是有效的星期一。', 400);
  }
}

function readGeneration(database: DatabaseSync, goalId: string, weekStart: string): WeeklyPlanGeneration {
  const row = database.prepare('SELECT * FROM v2_weekly_plan_generation WHERE goal_id=? AND week_start=?').get(goalId, weekStart) as Record<string, unknown> | undefined;
  if (!row) return { status: 'not_started', goalId, weekStart, attempts: 0, error: null, planId: null, updatedAt: null };
  return {
    status: row.status as WeeklyPlanGeneration['status'], goalId, weekStart,
    attempts: Number(row.attempts), error: row.error === null ? null : String(row.error),
    planId: row.plan_id === null ? null : String(row.plan_id), updatedAt: String(row.updated_at),
  };
}

export function getWeeklyPlanGeneration(goalId: string, weekStart = currentWeekStart()) {
  assertWeekStart(weekStart);
  return withDatabase(database => readGeneration(database, goalId, weekStart));
}

function mapPlan(database: DatabaseSync, row: Record<string, unknown>, revision: number): V2WeeklyPlan {
  const version = database.prepare('SELECT * FROM v2_weekly_plan_versions WHERE plan_id=? AND revision=?').get(String(row.id), revision) as Record<string, unknown> | undefined;
  if (!version) throw new GoalDraftError('找不到每周规划版本', 404);
  return {
    id: String(row.id), weekStart: String(row.week_start), revision,
    activeRevision: row.active_revision === null ? null : Number(row.active_revision),
    status: String(version.status) as V2WeeklyPlan['status'],
    actions: JSON.parse(String(version.actions_json)) as WeeklyPlanAction[],
    reply: String(version.reply),
    userMessage: version.user_message === null ? null : String(version.user_message),
    createdAt: String(version.created_at),
  };
}

export function getWeeklyPlan(id: string) {
  return withDatabase(database => {
    const row = database.prepare('SELECT * FROM v2_weekly_plans WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new GoalDraftError('找不到每周规划', 404);
    const revision = Number(row.current_revision);
    const plan = revision > 0 ? mapPlan(database, row, revision) : null;
    const activeRevision = row.active_revision === null ? null : Number(row.active_revision);
    const activePlan = activeRevision === null ? null : mapPlan(database, row, activeRevision);
    const versions = (database.prepare('SELECT revision FROM v2_weekly_plan_versions WHERE plan_id=? ORDER BY revision').all(id) as Array<{ revision: number }>).map(item => mapPlan(database, row, Number(item.revision)));
    return { plan, activePlan, activeRevision, versions };
  });
}

export function getWeeklyPlanForGoal(goalId: string, weekStart = currentWeekStart()) {
  assertWeekStart(weekStart);
  getEnabledGoal(goalId);
  return withDatabase(database => {
    const generation = readGeneration(database, goalId, weekStart);
    const row = database.prepare('SELECT id FROM v2_weekly_plans WHERE week_start=?').get(weekStart) as { id: string } | undefined;
    return { generation, ...(row ? { ...getWeeklyPlanFromDatabase(database, row.id) } : { plan: null, activePlan: null, activeRevision: null, versions: [] }) };
  });
}

function getWeeklyPlanFromDatabase(database: DatabaseSync, id: string) {
  const row = database.prepare('SELECT * FROM v2_weekly_plans WHERE id=?').get(id) as Record<string, unknown>;
  const revision = Number(row.current_revision);
  const plan = revision > 0 ? mapPlan(database, row, revision) : null;
  const activeRevision = row.active_revision === null ? null : Number(row.active_revision);
  const activePlan = activeRevision === null ? null : mapPlan(database, row, activeRevision);
  const versions = (database.prepare('SELECT revision FROM v2_weekly_plan_versions WHERE plan_id=? ORDER BY revision').all(id) as Array<{ revision: number }>).map(item => mapPlan(database, row, Number(item.revision)));
  return { plan, activePlan, activeRevision, versions };
}

function validateActions(input: {
  actions: Array<{ operation: 'add' | 'update'; id?: string; title: string; description: string; date: string; goalIds: string[]; attributeIds: string[] }>;
  goals: GoalV2[];
  weekStart: string;
  previous: WeeklyPlanAction[];
}): WeeklyPlanAction[] {
  const goalsById = new Map(input.goals.map(goal => [goal.id, goal]));
  const attributesById = new Map(input.goals.flatMap(goal => goal.attributes.map(attribute => [attribute.id, goal.id] as const)));
  const previousById = new Map(input.previous.map(action => [action.id, action]));
  const assignedIds = new Set<string>();
  const updated = input.actions.map((action, index) => {
    if (!action.title.trim() || !validDate(action.date) || action.date < input.weekStart || action.date > addDays(input.weekStart, 6)) {
      throw new GoalDraftError(`第 ${index + 1} 个行动的名称或安排日期无效。`, 502);
    }
    if (!action.goalIds.length || new Set(action.goalIds).size !== action.goalIds.length
      || action.goalIds.some(id => !goalsById.has(id))) {
      throw new GoalDraftError(`第 ${index + 1} 个行动关联了不存在的目标。`, 502);
    }
    if (!action.attributeIds.length || new Set(action.attributeIds).size !== action.attributeIds.length
      || action.attributeIds.some(id => !attributesById.has(id) || !action.goalIds.includes(attributesById.get(id)!))) {
      throw new GoalDraftError(`第 ${index + 1} 个行动关联了不属于相关目标的属性。`, 502);
    }
    let id: string;
    if (action.operation === 'update') {
      if (!action.id || !previousById.has(action.id)) throw new GoalDraftError(`第 ${index + 1} 个修改行动必须引用当前版本中的有效 ID。`, 502);
      id = action.id;
    } else {
      if (action.id) throw new GoalDraftError(`第 ${index + 1} 个新增行动不能指定旧 ID。`, 502);
      id = randomUUID();
    }
    if (assignedIds.has(id)) throw new GoalDraftError('行动 ID 必须唯一。', 502);
    assignedIds.add(id);
    return { id, title: action.title.trim(), description: action.description.trim(), date: action.date, goalIds: [...action.goalIds], attributeIds: [...action.attributeIds] };
  });
  const preserved = input.previous.filter(action => !assignedIds.has(action.id));
  return [...updated, ...preserved];
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : '规划生成失败，请检查 Agent 服务后重试。';
}

function goalSnapshot(goals: GoalV2[]) {
  return goals.map(goal => `${goal.id}:${goal.attributes.map(attribute => attribute.id).sort().join(',')}`).sort();
}

function persistedGoalSnapshot(database: DatabaseSync) {
  const goals = database.prepare('SELECT id FROM v2_goals ORDER BY id').all() as Array<{ id: string }>;
  return goals.map(goal => {
    const attributes = database.prepare('SELECT id FROM v2_goal_attributes WHERE goal_id=? ORDER BY id').all(goal.id) as Array<{ id: string }>;
    return `${goal.id}:${attributes.map(attribute => attribute.id).join(',')}`;
  }).sort();
}

export async function generateWeeklyPlanForGoal(goalId: string, weekStart = currentWeekStart()) {
  assertWeekStart(weekStart);
  getEnabledGoal(goalId);
  const goals = listEnabledGoals();
  const requestId = randomUUID();
  const start = withDatabase(database => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const now = new Date().toISOString();
      let row = database.prepare('SELECT * FROM v2_weekly_plans WHERE week_start=?').get(weekStart) as Record<string, unknown> | undefined;
      if (!row) {
        database.prepare('INSERT INTO v2_weekly_plans (id,week_start,current_revision,active_revision,created_at,updated_at) VALUES (?,?,0,NULL,?,?)')
          .run(randomUUID(), weekStart, now, now);
        row = database.prepare('SELECT * FROM v2_weekly_plans WHERE week_start=?').get(weekStart) as Record<string, unknown>;
      }
      const prior = database.prepare('SELECT attempts FROM v2_weekly_plan_generation WHERE goal_id=? AND week_start=?').get(goalId, weekStart) as { attempts: number } | undefined;
      database.prepare(`INSERT INTO v2_weekly_plan_generation (goal_id,week_start,status,attempts,error,plan_id,request_id,updated_at)
        VALUES (?,?,'generating',?,NULL,?,?,?)
        ON CONFLICT(goal_id,week_start) DO UPDATE SET status='generating',attempts=excluded.attempts,error=NULL,plan_id=excluded.plan_id,request_id=excluded.request_id,updated_at=excluded.updated_at`)
        .run(goalId, weekStart, (prior?.attempts ?? 0) + 1, String(row.id), requestId, now);
      const revision = Number(row.current_revision);
      const current = revision > 0
        ? JSON.parse(String((database.prepare('SELECT actions_json FROM v2_weekly_plan_versions WHERE plan_id=? AND revision=?').get(String(row.id), revision) as { actions_json: string }).actions_json)) as WeeklyPlanAction[]
        : [];
      database.exec('COMMIT');
      return { planId: String(row.id), baselineRevision: revision, baselineActiveRevision: row.active_revision === null ? null : Number(row.active_revision), current };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });

  try {
    const proposal = await proposeWeeklyPlan({ weekStart, goals, currentPlan: start.baselineRevision ? { actions: start.current } : null, focusGoalId: goalId });
    const actions = validateActions({ actions: proposal.actions, goals, weekStart, previous: start.current });
    const uncoveredGoals = goals.filter(goal => !actions.some(action => action.goalIds.includes(goal.id)
      && action.attributeIds.some(attributeId => goal.attributes.some(attribute => attribute.id === attributeId))));
    if (uncoveredGoals.length) {
      const focusMissing = uncoveredGoals.some(goal => goal.id === goalId);
      throw new GoalDraftError(focusMissing
        ? 'Agent 没有为新启用目标及其属性生成关联行动。'
        : 'Agent 没有为每个已启用目标及其属性生成关联行动。', 502);
    }
    if (JSON.stringify(goalSnapshot(listEnabledGoals())) !== JSON.stringify(goalSnapshot(goals))) {
      throw new GoalDraftError('已启用目标发生变化，请基于最新目标重新生成规划。', 409);
    }
    return withDatabase(database => {
      database.exec('BEGIN IMMEDIATE');
      try {
        const generation = database.prepare('SELECT request_id FROM v2_weekly_plan_generation WHERE goal_id=? AND week_start=?').get(goalId, weekStart) as { request_id: string };
        if (generation.request_id !== requestId) throw new GoalDraftError('已有更新的规划生成请求，请读取最新状态。', 409);
        const planRow = database.prepare('SELECT * FROM v2_weekly_plans WHERE id=?').get(start.planId) as Record<string, unknown>;
        if (Number(planRow.current_revision) !== start.baselineRevision
          || (planRow.active_revision === null ? null : Number(planRow.active_revision)) !== start.baselineActiveRevision) {
          throw new GoalDraftError('规划已有新版本或已确认，请刷新后重试。', 409);
        }
        if (JSON.stringify(persistedGoalSnapshot(database)) !== JSON.stringify(goalSnapshot(goals))) {
          throw new GoalDraftError('已启用目标发生变化，请基于最新目标重新生成规划。', 409);
        }
        const nextRevision = start.baselineRevision + 1;
        const now = new Date().toISOString();
        if (start.baselineRevision > 0) database.prepare("UPDATE v2_weekly_plan_versions SET status='superseded' WHERE plan_id=? AND revision=? AND status='draft'")
          .run(start.planId, start.baselineRevision);
        database.prepare(`INSERT INTO v2_weekly_plan_versions (plan_id,revision,status,actions_json,goal_ids_json,reply,user_message,created_at,confirmed_at)
          VALUES (?,?,'draft',?,?,?,?,?,NULL)`)
          .run(start.planId, nextRevision, JSON.stringify(actions), JSON.stringify(goals.map(goal => goal.id)), proposal.reply, null, now);
        database.prepare('UPDATE v2_weekly_plans SET current_revision=?,updated_at=? WHERE id=?').run(nextRevision, now, start.planId);
        database.prepare("UPDATE v2_weekly_plan_generation SET status='ready',error=NULL,plan_id=?,updated_at=? WHERE goal_id=? AND week_start=? AND request_id=?")
          .run(start.planId, now, goalId, weekStart, requestId);
        const latest = database.prepare('SELECT * FROM v2_weekly_plans WHERE id=?').get(start.planId) as Record<string, unknown>;
        const plan = mapPlan(database, latest, nextRevision);
        database.exec('COMMIT');
        return { generation: readGeneration(database, goalId, weekStart), plan };
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    });
  } catch (error) {
    withDatabase(database => {
      database.prepare("UPDATE v2_weekly_plan_generation SET status='failed',error=?,updated_at=? WHERE goal_id=? AND week_start=? AND request_id=?")
        .run(safeError(error), new Date().toISOString(), goalId, weekStart, requestId);
    });
    throw error;
  }
}

export async function editWeeklyPlan(id: string, revisionValue: unknown, messageValue: unknown) {
  if (!Number.isInteger(revisionValue) || Number(revisionValue) < 1) throw new GoalDraftError('请提供当前规划版本。', 400);
  const revision = Number(revisionValue);
  if (typeof messageValue !== 'string' || !messageValue.trim()) throw new GoalDraftError('请输入规划调整意见。', 400);
  const message = messageValue.trim();
  const initial = withDatabase(database => {
    const row = database.prepare('SELECT * FROM v2_weekly_plans WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new GoalDraftError('找不到每周规划', 404);
    if (Number(row.current_revision) !== revision) throw new GoalDraftError('规划已有新版本，请刷新后继续。', 409);
    const current = JSON.parse(String((database.prepare('SELECT actions_json FROM v2_weekly_plan_versions WHERE plan_id=? AND revision=?').get(id, revision) as { actions_json: string }).actions_json)) as WeeklyPlanAction[];
    const goalIds = JSON.parse(String((database.prepare('SELECT goal_ids_json FROM v2_weekly_plan_versions WHERE plan_id=? AND revision=?').get(id, revision) as { goal_ids_json: string }).goal_ids_json)) as string[];
    return { row, current, goals: listEnabledGoals().filter(goal => goalIds.includes(goal.id)) };
  });
  const proposal = await proposeWeeklyPlan({ weekStart: String(initial.row.week_start), goals: initial.goals, currentPlan: { actions: initial.current }, message });
  const actions = validateActions({ actions: proposal.actions, goals: initial.goals, weekStart: String(initial.row.week_start), previous: initial.current });
  if (JSON.stringify(goalSnapshot(listEnabledGoals())) !== JSON.stringify(goalSnapshot(initial.goals))) {
    throw new GoalDraftError('相关目标发生变化，请刷新后重新调整规划。', 409);
  }
  return withDatabase(database => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const row = database.prepare('SELECT * FROM v2_weekly_plans WHERE id=?').get(id) as Record<string, unknown>;
      if (Number(row.current_revision) !== revision) throw new GoalDraftError('规划已有新版本，请刷新后继续。', 409);
      if (JSON.stringify(persistedGoalSnapshot(database)) !== JSON.stringify(goalSnapshot(initial.goals))) {
        throw new GoalDraftError('相关目标发生变化，请刷新后重新调整规划。', 409);
      }
      const nextRevision = revision + 1;
      const now = new Date().toISOString();
      database.prepare("UPDATE v2_weekly_plan_versions SET status='superseded' WHERE plan_id=? AND revision=? AND status='draft'")
        .run(id, revision);
      database.prepare(`INSERT INTO v2_weekly_plan_versions (plan_id,revision,status,actions_json,goal_ids_json,reply,user_message,created_at,confirmed_at)
        VALUES (?,?,'draft',?,?,?,?,?,NULL)`)
        .run(id, nextRevision, JSON.stringify(actions), JSON.stringify(initial.goals.map(goal => goal.id)), proposal.reply, message, now);
      database.prepare('UPDATE v2_weekly_plans SET current_revision=?,updated_at=? WHERE id=?').run(nextRevision, now, id);
      const updated = database.prepare('SELECT * FROM v2_weekly_plans WHERE id=?').get(id) as Record<string, unknown>;
      const plan = mapPlan(database, updated, nextRevision);
      database.exec('COMMIT');
      return { plan, reply: proposal.reply };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
}

export function confirmWeeklyPlan(id: string, revisionValue: unknown) {
  if (!Number.isInteger(revisionValue) || Number(revisionValue) < 1) throw new GoalDraftError('请提供要确认的规划版本。', 400);
  const revision = Number(revisionValue);
  return withDatabase(database => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const row = database.prepare('SELECT * FROM v2_weekly_plans WHERE id=?').get(id) as Record<string, unknown> | undefined;
      if (!row) throw new GoalDraftError('找不到每周规划', 404);
      if (Number(row.current_revision) !== revision) throw new GoalDraftError('规划已有新版本，请刷新后再确认。', 409);
      const version = database.prepare('SELECT status,goal_ids_json FROM v2_weekly_plan_versions WHERE plan_id=? AND revision=?').get(id, revision) as { status: string; goal_ids_json: string } | undefined;
      if (!version) throw new GoalDraftError('找不到待确认的规划版本', 404);
      if (version.status === 'confirmed' && Number(row.active_revision) === revision) {
        database.exec('COMMIT');
        return { ...getWeeklyPlanFromDatabase(database, id), plan: mapPlan(database, row, revision) };
      }
      if (version.status !== 'draft') throw new GoalDraftError('只能确认当前待确认的规划版本。', 409);
      const currentGoalIds = (database.prepare('SELECT id FROM v2_goals ORDER BY id').all() as Array<{ id: string }>).map(goal => goal.id);
      const plannedGoalIds = JSON.parse(version.goal_ids_json) as string[];
      if (currentGoalIds.length !== plannedGoalIds.length || currentGoalIds.some(goalId => !plannedGoalIds.includes(goalId))) {
        throw new GoalDraftError('已启用目标发生变化，请先生成包含最新目标的规划。', 409);
      }
      if (row.active_revision !== null) database.prepare("UPDATE v2_weekly_plan_versions SET status='superseded' WHERE plan_id=? AND revision=? AND status='confirmed'")
        .run(id, Number(row.active_revision));
      const now = new Date().toISOString();
      database.prepare("UPDATE v2_weekly_plan_versions SET status='confirmed',confirmed_at=? WHERE plan_id=? AND revision=?")
        .run(now, id, revision);
      database.prepare('UPDATE v2_weekly_plans SET active_revision=?,updated_at=? WHERE id=?').run(revision, now, id);
      const confirmed = database.prepare('SELECT * FROM v2_weekly_plans WHERE id=?').get(id) as Record<string, unknown>;
      const plan = mapPlan(database, confirmed, revision);
      database.exec('COMMIT');
      return { ...getWeeklyPlanFromDatabase(database, id), plan };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
}

