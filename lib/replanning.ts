import { randomUUID } from 'node:crypto';
import { openDatabase } from './store';
import { listExternalCommitments } from './commitments';
import { listGoalPlanActions, listPendingGoalActions, type GoalPlanAction } from './goal-plans';
import { generateWeeklyPlan, type PlannerAction, type WeeklyPlan } from './daily-planner';
import { getDailyPlan } from './daily-plan-store';

export type ReplanTrigger = 'new_commitment' | 'deadline_change' | 'scope_change' | 'capacity_change' | 'constraint_change' | 'infeasible' | 'execution_deviation';
export type ReplanChange = { actionId: string; title: string; fromDate: string | null; toDate: string | null; reason: string };
export type ReplanProposal = {
  id: string;
  weekStart: string;
  version: number;
  trigger: ReplanTrigger;
  triggerReason: string;
  previousPlan: WeeklyPlan;
  plan: WeeklyPlan;
  changes: ReplanChange[];
  status: 'draft' | 'accepted' | 'rejected';
  createdAt: string;
  decidedAt: string | null;
};

const triggers = new Set<ReplanTrigger>(['new_commitment', 'deadline_change', 'scope_change', 'capacity_change', 'constraint_change', 'infeasible', 'execution_deviation']);
const triggerLabels: Record<ReplanTrigger, string> = {
  new_commitment: '新承诺', deadline_change: '截止变化', scope_change: '范围变化', capacity_change: '容量变化',
  constraint_change: '约束变化', infeasible: '安排不可执行', execution_deviation: '重大执行偏差',
};

function assertWeekStart(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('周起始日期必须是有效的 YYYY-MM-DD 日期。');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1) throw new Error('周起始日期必须是有效的星期一。');
}

function ensureSchema() {
  const database = openDatabase();
  database.exec(`CREATE TABLE IF NOT EXISTS replan_proposals (
    id TEXT PRIMARY KEY,
    week_start TEXT NOT NULL,
    version INTEGER NOT NULL,
    trigger TEXT NOT NULL,
    trigger_reason TEXT NOT NULL,
    previous_plan_json TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    changes_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'accepted', 'rejected')),
    created_at TEXT NOT NULL,
    decided_at TEXT,
    baseline_updated_at TEXT,
    source_state_json TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS replan_proposals_week ON replan_proposals(week_start, created_at DESC);`);
  const columns = database.prepare('PRAGMA table_info(replan_proposals)').all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === 'baseline_updated_at')) database.exec('ALTER TABLE replan_proposals ADD COLUMN baseline_updated_at TEXT');
  if (!columns.some(column => column.name === 'source_state_json')) database.exec("ALTER TABLE replan_proposals ADD COLUMN source_state_json TEXT NOT NULL DEFAULT ''");
  return database;
}

function sourceState(database: ReturnType<typeof openDatabase>) {
  const goalPlans = database.prepare('SELECT id, status, plan_json FROM goal_plans ORDER BY id').all();
  const actions = database.prepare('SELECT * FROM goal_plan_actions ORDER BY id').all();
  const commitments = database.prepare(`SELECT id,status,source_text,deliverable,deadline,goal_plan_id,tasks_json,uncertain_fields_json,created_at
    FROM external_commitments ORDER BY id`).all();
  return JSON.stringify({ goalPlans, actions, commitments });
}

function fromRow(row: Record<string, unknown>): ReplanProposal {
  return {
    id: String(row.id), weekStart: String(row.week_start), version: Number(row.version), trigger: String(row.trigger) as ReplanTrigger,
    triggerReason: String(row.trigger_reason), previousPlan: JSON.parse(String(row.previous_plan_json)) as WeeklyPlan,
    plan: JSON.parse(String(row.plan_json)) as WeeklyPlan, changes: JSON.parse(String(row.changes_json)) as ReplanChange[],
    status: String(row.status) as ReplanProposal['status'], createdAt: String(row.created_at),
    decidedAt: row.decided_at === null ? null : String(row.decided_at),
  };
}

function readProposal(database: ReturnType<typeof openDatabase>, id: string) {
  const row = database.prepare('SELECT * FROM replan_proposals WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error('找不到这份重排建议。');
  return fromRow(row);
}

function planActions(plan: WeeklyPlan): Array<{ action: PlannerAction; date: string | null; unplacedReason?: string }> {
  return [
    ...plan.days.flatMap(day => day.actions.map(action => ({ action: { ...action, id: action.actionId } as PlannerAction, date: day.date }))),
    ...plan.unplaced.map(item => ({ action: item.action, date: null, unplacedReason: item.reason })),
  ];
}

function plannerAction(action: GoalPlanAction): PlannerAction {
  return {
    id: action.id, goalPlanId: action.goalPlanId, goalTitle: action.goalTitle, title: action.title, details: action.details,
    estimateMinutes: action.estimateMinutes, priority: action.priority, hardDeadline: action.hardDeadline,
    milestoneId: action.milestoneId, milestoneTitle: action.milestoneTitle, milestoneCriteria: action.milestoneCriteria,
    dependsOn: action.dependsOn, createdAt: action.createdAt,
  };
}

function commitmentActions(existingIds: Set<string>): PlannerAction[] {
  const commitments = listExternalCommitments();
  return commitments.filter(item => item.status !== 'scheduled').flatMap(commitment => {
    const actionIds = commitment.tasks.map((_, index) => `commitment/${commitment.id}/${index}`);
    const byTitle = new Map(commitment.tasks.map((task, index) => [task.title, actionIds[index]]));
    return commitment.tasks.flatMap((task, index) => {
      const id = actionIds[index];
      if (existingIds.has(id)) return [];
      return [{
        id, goalPlanId: commitment.goalPlanId ?? `misc:${commitment.id}`, goalTitle: commitment.goalTitle || '杂项',
        title: task.title, details: task.acceptanceCriteria || task.details, estimateMinutes: task.estimateMinutes,
        priority: 'high' as const, hardDeadline: task.deadline || commitment.deadline, milestoneId: null,
        milestoneTitle: commitment.deliverable, milestoneCriteria: task.acceptanceCriteria, dependsOn: task.dependencies.map(name => byTitle.get(name) ?? name),
        createdAt: commitment.createdAt,
      }];
    });
  });
}

function findChanges(previousPlan: WeeklyPlan, plan: WeeklyPlan, trigger: ReplanTrigger): ReplanChange[] {
  const before = new Map(planActions(previousPlan).map(entry => [entry.action.id, entry]));
  const after = new Map(planActions(plan).map(entry => [entry.action.id, entry]));
  const changes: ReplanChange[] = [];
  for (const [id, entry] of after) {
    const old = before.get(id);
    const toDate = entry.date;
    const actionChanged = Boolean(old && (
      old.action.title !== entry.action.title
      || old.action.details !== entry.action.details
      || old.action.estimateMinutes !== entry.action.estimateMinutes
      || old.action.hardDeadline !== entry.action.hardDeadline
      || JSON.stringify(old.action.dependsOn) !== JSON.stringify(entry.action.dependsOn)
    ));
    if (old?.date === toDate && !actionChanged) continue;
    const reason = !old
      ? `新增承诺「${entry.action.title}」，需在容量与截止范围内安排。`
      : actionChanged && old.date === toDate
        ? '行动范围、时长、截止或依赖已变化；原日期仍满足约束，予以保留。'
      : toDate === null
        ? (plan.unplaced.find(item => item.action.id === id)?.reason ?? '当前约束下无法安排，保留为尚未排入。')
        : old.date === null
          ? `此前尚未排入；本次按「${triggerLabels[trigger]}」重新计算后安排。`
          : `受「${triggerLabels[trigger]}」影响，原日期容量或依赖不再适用，已移动到该日期。`;
    changes.push({ actionId: id, title: entry.action.title, fromDate: old?.date ?? null, toDate, reason });
  }
  for (const [id, entry] of before) if (!after.has(id)) {
    changes.push({ actionId: id, title: entry.action.title, fromDate: entry.date, toDate: null, reason: '行动已完成或所属目标不再活跃，已从本周待办移除。' });
  }
  return changes;
}

export function listReplanProposals(weekStart: string): ReplanProposal[] {
  assertWeekStart(weekStart);
  const database = ensureSchema();
  try {
    return (database.prepare('SELECT * FROM replan_proposals WHERE week_start=? ORDER BY created_at DESC, rowid DESC').all(weekStart) as Array<Record<string, unknown>>).map(fromRow);
  } finally { database.close(); }
}

export function createReplanProposal(input: { weekStart: unknown; trigger: unknown; reason: unknown; capacities?: unknown }): ReplanProposal {
  assertWeekStart(input.weekStart);
  if (typeof input.trigger !== 'string' || !triggers.has(input.trigger as ReplanTrigger)) throw new Error('请选择重排触发原因。');
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 1000) throw new Error('请说明本次变化或安排问题（最多 1000 字）。');
  const trigger = input.trigger as ReplanTrigger;
  const capacities = input.capacities === undefined ? {} : input.capacities;
  if (!capacities || typeof capacities !== 'object' || Array.isArray(capacities)) throw new Error('每日容量格式无效。');

  listPendingGoalActions();
  listExternalCommitments();
  const current = getDailyPlan(input.weekStart);
  const sourceDatabase = openDatabase();
  let sourceSnapshotAtStart: string;
  try { sourceSnapshotAtStart = sourceState(sourceDatabase); } finally { sourceDatabase.close(); }
  const currentCapacity = Object.fromEntries((current.plan?.days ?? []).map(day => [day.date, day.capacityMinutes]));
  const mergedCapacities = { ...currentCapacity, ...(capacities as Record<string, number>) };
  const pendingGoalActions = listPendingGoalActions();
  const authoritativeGoalActions = listGoalPlanActions().filter(action => action.status !== 'done');
  const goalActionsById = new Map(authoritativeGoalActions.map(action => [action.id, plannerAction(action)]));
  const previousPlan = current.plan ?? generateWeeklyPlan({ weekStart: input.weekStart, actions: pendingGoalActions, capacities: mergedCapacities });
  const beforeEntries = planActions(previousPlan);
  const actionsById = new Map<string, PlannerAction>();
  for (const entry of beforeEntries) {
    if (entry.action.id.startsWith('commitment/')) actionsById.set(entry.action.id, entry.action);
    else {
      const authoritative = goalActionsById.get(entry.action.id);
      if (authoritative) actionsById.set(entry.action.id, authoritative);
    }
  }
  for (const action of authoritativeGoalActions) {
    if (action.status === 'pending_schedule' && !actionsById.has(action.id)) actionsById.set(action.id, plannerAction(action));
  }
  const commitments = commitmentActions(new Set(actionsById.keys()));
  for (const action of commitments) actionsById.set(action.id, action);

  const preferredDates: Record<string, string> = Object.fromEntries(beforeEntries.filter(entry => entry.date).map(entry => [entry.action.id, entry.date!]));
  for (const action of commitments) if (action.hardDeadline) preferredDates[action.id] = action.hardDeadline;
  const plan = generateWeeklyPlan({ weekStart: input.weekStart, actions: [...actionsById.values()], capacities: mergedCapacities, preferredDates });
  const changes = findChanges(previousPlan, plan, trigger);
  const now = new Date().toISOString();
  const database = ensureSchema();
  const id = randomUUID();
  try {
    const snapshot = sourceState(database);
    const latestPlan = database.prepare('SELECT updated_at FROM weekly_plans WHERE week_start=?').get(input.weekStart) as { updated_at: string } | undefined;
    if (snapshot !== sourceSnapshotAtStart || (latestPlan?.updated_at ?? null) !== current.updatedAt) {
      throw new Error('原计划或承诺在生成期间发生变化，请重新生成建议。');
    }
    const row = database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM replan_proposals WHERE week_start=? AND status='accepted'").get(input.weekStart) as { version: number };
    const version = Number(row.version) + 1;
    database.prepare(`INSERT INTO replan_proposals
      (id,week_start,version,trigger,trigger_reason,previous_plan_json,plan_json,changes_json,status,created_at,decided_at,baseline_updated_at,source_state_json)
      VALUES (?,?,?,?,?,?,?,?, 'draft', ?, NULL, ?, ?)`)
      .run(id, input.weekStart, version, trigger, input.reason.trim(), JSON.stringify(previousPlan), JSON.stringify(plan), JSON.stringify(changes), now, current.updatedAt, snapshot);
    return readProposal(database, id);
  } finally { database.close(); }
}

export function editReplanProposal(id: string, placements: unknown): ReplanProposal {
  if (!placements || typeof placements !== 'object' || Array.isArray(placements)) throw new Error('重排编辑内容无效。');
  const proposal = getReplanProposal(id);
  if (proposal.status !== 'draft') throw new Error('这份建议已经处理，不能继续编辑。');
  const moves = placements as Record<string, unknown>;
  const entries = planActions(proposal.plan);
  const byId = new Map(entries.map(entry => [entry.action.id, { ...entry }]));
  const dayDates = new Set(proposal.plan.days.map(day => day.date));
  for (const [idToMove, date] of Object.entries(moves)) {
    const entry = byId.get(idToMove);
    if (!entry) throw new Error('找不到要编辑的行动。');
    if (date !== null && (typeof date !== 'string' || !dayDates.has(date))) throw new Error('请选择本周内的日期，或选择尚未排入。');
    entry.date = date as string | null;
    if (date === null) entry.unplacedReason = '用户编辑后暂未安排。';
  }
  const days = proposal.plan.days.map(day => ({ ...day, actions: [] as typeof day.actions, usedMinutes: 0 }));
  const unplaced: WeeklyPlan['unplaced'] = [];
  for (const entry of byId.values()) {
    if (!entry.date) {
      unplaced.push({ action: entry.action, reason: entry.unplacedReason ?? '用户编辑后暂未安排。' });
      continue;
    }
    const day = days.find(item => item.date === entry.date)!;
    const duration = entry.action.estimateMinutes ?? 30;
    if (entry.action.hardDeadline && entry.date > entry.action.hardDeadline) throw new Error(`「${entry.action.title}」不能排在硬截止 ${entry.action.hardDeadline} 之后。`);
    if (day.usedMinutes + duration > day.capacityMinutes) throw new Error(`${entry.date} 的容量不足，无法安排「${entry.action.title}」。`);
    day.actions.push({ ...entry.action, actionId: entry.action.id, estimateMinutes: duration, estimateIsDefault: entry.action.estimateMinutes === null });
    day.usedMinutes += duration;
  }
  const datesById = new Map(days.flatMap(day => day.actions.map(action => [action.actionId, day.date] as const)));
  for (const day of days) for (const action of day.actions) {
    for (const dependency of action.dependsOn) {
      const dependencyDate = datesById.get(dependency);
      if (!dependencyDate || dependencyDate >= day.date) throw new Error(`「${action.title}」必须在依赖行动完成后的日期安排。`);
    }
  }
  const plan = { ...proposal.plan, days, unplaced };
  const changes = findChanges(proposal.previousPlan, plan, proposal.trigger);
  const database = ensureSchema();
  try {
    database.prepare("UPDATE replan_proposals SET plan_json=?, changes_json=? WHERE id=? AND status='draft'")
      .run(JSON.stringify(plan), JSON.stringify(changes), id);
    return readProposal(database, id);
  } finally { database.close(); }
}

export function getReplanProposal(id: string): ReplanProposal {
  const database = ensureSchema();
  try { return readProposal(database, id); } finally { database.close(); }
}

export function decideReplanProposal(id: string, decision: unknown): ReplanProposal {
  if (decision !== 'accept' && decision !== 'reject') throw new Error('请选择接受或拒绝这份建议。');
  const proposal = getReplanProposal(id);
  if (proposal.status !== 'draft') return proposal;
  listPendingGoalActions();
  const commitments = decision === 'accept' ? listExternalCommitments() : [];
  const database = ensureSchema();
  try {
    database.exec('BEGIN IMMEDIATE');
    const row = database.prepare(`SELECT status,plan_json,week_start,baseline_updated_at,source_state_json
      FROM replan_proposals WHERE id=?`).get(id) as { status: string; plan_json: string; week_start: string; baseline_updated_at: string | null; source_state_json: string } | undefined;
    if (!row || row.status !== 'draft') throw new Error('这份建议已被处理，请刷新后查看。');
    const now = new Date().toISOString();
    if (decision === 'reject') {
      database.prepare("UPDATE replan_proposals SET status='rejected', decided_at=? WHERE id=?").run(now, id);
    } else {
      const currentPlan = database.prepare('SELECT updated_at FROM weekly_plans WHERE week_start=?').get(row.week_start) as { updated_at: string } | undefined;
      if ((currentPlan?.updated_at ?? null) !== row.baseline_updated_at || sourceState(database) !== row.source_state_json) {
        throw new Error('原计划、目标或承诺已发生变化，请重新生成重排建议。');
      }
      const plan = JSON.parse(row.plan_json) as WeeklyPlan;
      database.exec(`CREATE TABLE IF NOT EXISTS weekly_plans (
        week_start TEXT PRIMARY KEY, plan_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed')), confirmed_at TEXT, updated_at TEXT NOT NULL
      )`);
      database.prepare(`INSERT INTO weekly_plans (week_start,plan_json,status,confirmed_at,updated_at) VALUES (?,?,'confirmed',?,?)
        ON CONFLICT(week_start) DO UPDATE SET plan_json=excluded.plan_json,status='confirmed',confirmed_at=excluded.confirmed_at,updated_at=excluded.updated_at`)
        .run(row.week_start, row.plan_json, now, now);
      const markGoalAction = database.prepare(`UPDATE goal_plan_actions SET status='scheduled' WHERE id=? AND status='pending_schedule'
        AND EXISTS (SELECT 1 FROM goal_plans WHERE goal_plans.id=goal_plan_actions.goal_plan_id AND goal_plans.status='active')`);
      for (const day of plan.days) for (const action of day.actions) markGoalAction.run(action.actionId);
      const scheduled = new Set(plan.days.flatMap(day => day.actions.map(action => action.actionId)));
      const previousGoalIds = new Set(planActions(proposal.previousPlan).filter(entry => !entry.action.id.startsWith('commitment/')).map(entry => entry.action.id));
      const markPendingAgain = database.prepare(`UPDATE goal_plan_actions SET status='pending_schedule' WHERE id=? AND status='scheduled'
        AND EXISTS (SELECT 1 FROM goal_plans WHERE goal_plans.id=goal_plan_actions.goal_plan_id AND goal_plans.status='active')`);
      for (const actionId of previousGoalIds) if (!scheduled.has(actionId)) markPendingAgain.run(actionId);
      const updateCommitment = database.prepare('UPDATE external_commitments SET status=? WHERE id=?');
      const proposalActionIds = new Set([
        ...plan.days.flatMap(day => day.actions.map(action => action.actionId)),
        ...planActions(proposal.previousPlan).map(entry => entry.action.id),
      ]);
      for (const commitment of commitments) {
        if (!commitment.tasks.some((_, index) => proposalActionIds.has(`commitment/${commitment.id}/${index}`))) continue;
        const scheduledCount = commitment.tasks.filter((_, index) => scheduled.has(`commitment/${commitment.id}/${index}`)).length;
        const status = scheduledCount === commitment.tasks.length ? 'scheduled' : scheduledCount > 0 ? 'partially_scheduled' : 'pending_schedule';
        updateCommitment.run(status, commitment.id);
      }
      const latestVersion = database.prepare("SELECT COALESCE(MAX(version),0) AS version FROM replan_proposals WHERE week_start=? AND status='accepted'").get(row.week_start) as { version: number };
      database.prepare("UPDATE replan_proposals SET status='accepted', version=?, decided_at=? WHERE id=?").run(Number(latestVersion.version) + 1, now, id);
    }
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* transaction already ended */ }
    throw error;
  } finally { database.close(); }
  return getReplanProposal(id);
}
