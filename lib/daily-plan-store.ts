import { openDatabase } from './store';
import { generateWeeklyPlan, type WeeklyPlan } from './daily-planner';
import { listGoalPlanActions, listPendingGoalActions } from './goal-plans';

export type DailyPlanRecord = {
  plan: WeeklyPlan | null;
  status: 'draft' | 'confirmed' | null;
  confirmedAt: string | null;
  updatedAt: string | null;
};

function assertWeekStart(weekStart: unknown): asserts weekStart is string {
  if (typeof weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new Error('周起始日期必须是有效的 YYYY-MM-DD 日期。');
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== weekStart || date.getUTCDay() !== 1) {
    throw new Error('周起始日期必须是有效的星期一。');
  }
}

function ensureSchema() {
  const database = openDatabase();
  database.exec(`CREATE TABLE IF NOT EXISTS weekly_plans (
    week_start TEXT PRIMARY KEY,
    plan_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed')),
    confirmed_at TEXT,
    updated_at TEXT NOT NULL
  )`);
  return database;
}

export function getDailyPlan(weekStart: string): DailyPlanRecord {
  assertWeekStart(weekStart);
  const database = ensureSchema();
  try {
    const row = database.prepare('SELECT plan_json, status, confirmed_at, updated_at FROM weekly_plans WHERE week_start=?').get(weekStart) as {
      plan_json: string;
      status: 'draft' | 'confirmed';
      confirmed_at: string | null;
      updated_at: string;
    } | undefined;
    return row
      ? { plan: JSON.parse(row.plan_json) as WeeklyPlan, status: row.status, confirmedAt: row.confirmed_at, updatedAt: row.updated_at }
      : { plan: null, status: null, confirmedAt: null, updatedAt: null };
  } finally {
    database.close();
  }
}

export function generateAndSaveDailyPlan(weekStart: string, capacities: Record<string, number> = {}): WeeklyPlan {
  assertWeekStart(weekStart);
  const database = ensureSchema();
  try {
    const existing = database.prepare('SELECT status FROM weekly_plans WHERE week_start=?').get(weekStart) as { status: 'draft' | 'confirmed' } | undefined;
    if (existing?.status === 'confirmed') throw new Error('本周计划已经确认；再次打开时会继续使用这份安排。');
  } finally {
    database.close();
  }

  const plan = generateWeeklyPlan({ weekStart, actions: listPendingGoalActions(), capacities });
  const updatedAt = new Date().toISOString();
  const save = ensureSchema();
  try {
    save.prepare(`INSERT INTO weekly_plans (week_start, plan_json, status, confirmed_at, updated_at)
      VALUES (?, ?, 'draft', NULL, ?)
      ON CONFLICT(week_start) DO UPDATE SET plan_json=excluded.plan_json, status='draft', confirmed_at=NULL, updated_at=excluded.updated_at`)
      .run(weekStart, JSON.stringify(plan), updatedAt);
  } finally {
    save.close();
  }
  return plan;
}

export function confirmDailyPlan(weekStart: string): DailyPlanRecord {
  assertWeekStart(weekStart);
  listGoalPlanActions();
  const database = ensureSchema();
  let inTransaction = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    const row = database.prepare('SELECT plan_json, status FROM weekly_plans WHERE week_start=?').get(weekStart) as {
      plan_json: string;
      status: 'draft' | 'confirmed';
    } | undefined;
    if (!row) throw new Error('请先生成本周安排。');
    if (row.status === 'confirmed') {
      database.exec('COMMIT');
      inTransaction = false;
      return getDailyPlan(weekStart);
    }

    const plan = JSON.parse(row.plan_json) as WeeklyPlan;
    const scheduledIds = new Set(plan.days.flatMap(day => day.actions.map(action => action.actionId)));
    const markScheduled = database.prepare(`UPDATE goal_plan_actions SET status='scheduled'
      WHERE id=? AND status='pending_schedule'
      AND decomposed_at IS NULL
      AND EXISTS (SELECT 1 FROM goal_plans WHERE goal_plans.id=goal_plan_actions.goal_plan_id AND goal_plans.status='active')`);
    for (const id of scheduledIds) {
      if (Number(markScheduled.run(id).changes) !== 1) throw new Error('待排行动已发生变化，请重新生成计划后再确认。');
    }

    const confirmedAt = new Date().toISOString();
    database.prepare("UPDATE weekly_plans SET status='confirmed', confirmed_at=?, updated_at=? WHERE week_start=?")
      .run(confirmedAt, confirmedAt, weekStart);
    database.exec('COMMIT');
    inTransaction = false;
  } catch (error) {
    if (inTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
  return getDailyPlan(weekStart);
}
