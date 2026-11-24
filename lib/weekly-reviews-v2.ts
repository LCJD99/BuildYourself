import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { GoalDraftError, listEnabledGoals } from './goal-drafts-v2';
import { openDatabase } from './store';
import { getLatestActionCompletionByIds, getActionFeedbackForAction } from './action-feedback-v2';
import { confirmWeeklyPlan, getConfirmedWeeklyPlanForWeek, getWeeklyPlan, getWeeklyPlanForGoal, saveWeeklyPlanDraft, validateWeeklyPlanProposal } from './weekly-plans-v2';
import { proposeWeeklyReview } from './weekly-review-agent';
import { currentWeekStart } from './weekly-plans-v2';

type Review = { weekStart: string; summary: string; weekFeedback: string; nextWeekFeedback: string; planId: string; revision: number; createdAt: string };

function withDatabase<T>(operation: (database: DatabaseSync) => T): T {
  const database = openDatabase();
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS v2_weekly_reviews (
      week_start TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      week_feedback TEXT NOT NULL,
      next_week_feedback TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
    return operation(database);
  } finally { database.close(); }
}

function validWeek(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
}

function nextWeek(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
}

function read(database: DatabaseSync, weekStart: string): Review | null {
  const row = database.prepare('SELECT * FROM v2_weekly_reviews WHERE week_start=?').get(weekStart) as Record<string, unknown> | undefined;
  return row ? { weekStart, summary: String(row.summary), weekFeedback: String(row.week_feedback), nextWeekFeedback: String(row.next_week_feedback),
    planId: String(row.plan_id), revision: Number(row.revision), createdAt: String(row.created_at) } : null;
}

export function getWeeklyReview(weekStart: string) {
  if (!validWeek(weekStart)) throw new GoalDraftError('周起始日期必须是有效的星期一。', 400);
  return withDatabase(database => {
    const review = read(database, weekStart);
    if (!review) throw new GoalDraftError('找不到该周复盘。', 404);
    return { review, nextWeekPlan: getWeeklyPlan(review.planId) };
  });
}

export async function createWeeklyReview(input: { weekStart: unknown; weekFeedback: unknown; nextWeekFeedback: unknown }) {
  if (!validWeek(input.weekStart)) throw new GoalDraftError('周起始日期必须是有效的星期一。', 400);
  if (typeof input.weekFeedback !== 'string' || !input.weekFeedback.trim()
    || typeof input.nextWeekFeedback !== 'string' || !input.nextWeekFeedback.trim()) {
    throw new GoalDraftError('请分别填写本周复盘意见和下周规划意见。', 400);
  }
  const weekStart = input.weekStart;
  const weekFeedback = input.weekFeedback;
  const nextWeekFeedback = input.nextWeekFeedback;
  const currentPlan = getConfirmedWeeklyPlanForWeek(weekStart);
  if (!currentPlan) throw new GoalDraftError('本周没有已确认的每周规划，无法复盘。', 409);
  const goals = listEnabledGoals();
  if (!goals.length) throw new GoalDraftError('没有已启用目标，无法生成下周规划。', 409);
  const nextWeekStart = nextWeek(weekStart);
  const nextWeekSnapshot = getWeeklyPlanForGoal(goals[0].id, nextWeekStart);
  const expectedRevision = nextWeekSnapshot.plan?.revision ?? 0;
  const completions = getLatestActionCompletionByIds(currentPlan.actions.map(action => action.id));
  const priorFeedback = currentPlan.actions.flatMap(action => getActionFeedbackForAction(action.id));
  const requestId = randomUUID();
  const incomplete = currentPlan.actions.filter(action => (completions[action.id] ?? 0) < 1).map(action => ({
    ...action, date: nextWeekStart,
  }));
  const priorNextWeekActions = nextWeekSnapshot.plan?.actions ?? [];
  const planningById = new Map(priorNextWeekActions.map(action => [action.id, action]));
  for (const action of incomplete) planningById.set(action.id, action);
  const planningActions = [...planningById.values()];
  const previous = planningActions;
  const proposal = await proposeWeeklyReview({ weekStart, nextWeekStart, weekFeedback, nextWeekFeedback, goals,
    weekActions: currentPlan.actions, currentActions: planningActions, completions, priorFeedback });
  const proposedIds = new Set(proposal.actions.flatMap(action => action.operation === 'update' && action.id ? [action.id] : []));
  for (const action of incomplete) {
    if (!proposedIds.has(action.id)) proposal.actions.push({ ...action, operation: 'update' });
  }
  const actions = validateWeeklyPlanProposal({ weekStart: nextWeekStart, goals, actions: proposal.actions, previous });
  for (const action of incomplete) {
    if (!actions.some(candidate => candidate.id === action.id)) throw new GoalDraftError('下周草稿必须保留所有未完成行动的原 ID。', 502);
  }
  const plan = saveWeeklyPlanDraft({ weekStart: nextWeekStart, expectedRevision, actions, goals, reply: proposal.reply, userMessage: `${weekFeedback}\n${nextWeekFeedback}` });
  const review = withDatabase(database => {
    database.prepare(`INSERT INTO v2_weekly_reviews (week_start,summary,week_feedback,next_week_feedback,plan_id,revision,request_id,created_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(week_start) DO UPDATE SET summary=excluded.summary,week_feedback=excluded.week_feedback,
      next_week_feedback=excluded.next_week_feedback,plan_id=excluded.plan_id,revision=excluded.revision,request_id=excluded.request_id,created_at=excluded.created_at`)
      .run(weekStart, proposal.summary, weekFeedback, nextWeekFeedback, plan.id, plan.revision, requestId, new Date().toISOString());
    return read(database, weekStart)!;
  });
  return { review, nextWeekPlan: getWeeklyPlan(plan.id) };
}

export function confirmWeeklyReviewPlan(weekStart: string, revision: unknown) {
  const review = withDatabase(database => read(database, weekStart));
  if (!review) throw new GoalDraftError('找不到该周复盘。', 404);
  return confirmWeeklyPlan(review.planId, revision);
}

export function currentReviewWeekStart() { return currentWeekStart(); }
