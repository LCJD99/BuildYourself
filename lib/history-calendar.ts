import { listGoalPlans, type GoalPlan, type GoalPlanAction, type GoalPlanStatus } from './goal-plans';
import type { EvidenceSnapshot } from './model';
import type { WeeklyReview, WeeklyReviewFollowup } from './weekly-review-store';
import { listEvidence, openDatabase } from './store';

export type HistoryCalendarGoal = { id: string; title: string; status: GoalPlanStatus };
export type HistoryCalendarActivity = {
  id: string;
  kind: 'action' | 'goal_completed';
  goalPlanId: string;
  goalTitle: string;
  title: string;
  completedAt: string;
  evidenceRequirement: string | null;
};
export type HistoryCalendarEvidence = {
  id: string;
  goalPlanId: string;
  goalTitle: string;
  goalActionId: string | null;
  actionTitle: string | null;
  requirement: string | null;
  description: string;
  level: string;
  observedAt: string;
  reference: string;
  source: string;
};
export type HistoryCalendarReviewCitation = {
  goalPlanId: string;
  goalTitle: string;
  kind: 'evaluation' | 'followup';
  evaluationId?: string;
  sourceWeekStart?: string;
  actionId?: string | null;
  summary: string;
};
export type HistoryCalendarReviewCorrection = {
  evidenceId: string;
  changedAt: string;
  citations: HistoryCalendarReviewCitation[];
  before: WeeklyReview['evidence'][number];
  current: EvidenceSnapshot;
  currentGoalTitle: string | null;
  currentGoalActionTitle: string | null;
};
export type HistoryCalendarLatestEvaluation = {
  goalPlanId: string;
  evaluation: {
    id: string;
    observedAt: string;
    evaluatedAt: string;
    outcome: 'insufficient' | 'not_met' | 'met';
    status: 'insufficient' | 'not_met' | 'pending_confirmation' | 'confirmed';
    summary: string;
    contractVersion: number;
    evidenceIds: string[];
  } | null;
  staleEvidenceIds: string[];
};
export type HistoryCalendarReview = {
  review: WeeklyReview;
  savedAt: string;
  followup: WeeklyReviewFollowup | null;
  corrections: HistoryCalendarReviewCorrection[];
  latestEvaluations: HistoryCalendarLatestEvaluation[];
};
export type HistoryCalendarDay = {
  date: string;
  activities: HistoryCalendarActivity[];
  evidence: HistoryCalendarEvidence[];
  reviews: HistoryCalendarReview[];
};
export type UndatedHistoryActivity = { id: string; goalPlanId: string; goalTitle: string; title: string };
export type UndatedHistoryEvidence = Omit<HistoryCalendarEvidence, 'observedAt'>;
export type UndatedHistoryReview = { review: WeeklyReview; savedAt: string | null; followup: WeeklyReviewFollowup | null };
export type HistoryCalendar = { goals: HistoryCalendarGoal[]; days: HistoryCalendarDay[]; undatedActivities: UndatedHistoryActivity[]; undatedEvidence: UndatedHistoryEvidence[]; undatedReviews: UndatedHistoryReview[] };
type CompletedGoalAction = Pick<GoalPlanAction, 'id' | 'goalPlanId' | 'goalTitle' | 'title' | 'completedAt' | 'evidenceRequirement'>;

export function historyCalendarDateKey(timestamp: string, timeZone: string): string | null {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time);
  const values = new Map(parts.map(part => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function activityForCompletedAction(action: CompletedGoalAction, timeZone: string): HistoryCalendarActivity | null {
  const completedAt = action.completedAt;
  if (!completedAt) return null;
  const date = historyCalendarDateKey(completedAt, timeZone);
  if (!date) return null;
  return {
    id: action.id,
    kind: 'action',
    goalPlanId: action.goalPlanId,
    goalTitle: action.goalTitle,
    title: action.title,
    completedAt,
    evidenceRequirement: action.evidenceRequirement,
  };
}

function historyPlans(plans: GoalPlan[]) {
  return plans.filter((plan): plan is GoalPlan & { status: Exclude<GoalPlanStatus, 'draft'> } => plan.status !== 'draft');
}

export function getHistoryCalendar(timeZone = 'UTC'): HistoryCalendar {
  new Intl.DateTimeFormat('en', { timeZone }).format(new Date(0));
  const plans = historyPlans(listGoalPlans());
  const goals = plans.map(plan => ({ id: plan.id, title: plan.title ?? '未命名目标', status: plan.status }));
  if (!plans.length) return { goals, days: [], undatedActivities: [], undatedEvidence: [], undatedReviews: [] };

  const database = openDatabase();
  let actions: CompletedGoalAction[];
  const planById = new Map(plans.map(plan => [plan.id, plan]));
  const actionTitles = new Map<string, string>();
  try {
    const ids = plans.map(plan => plan.id);
    const placeholders = ids.map(() => '?').join(',');
    const rows = database.prepare(`SELECT a.id, a.goal_plan_id AS goalPlanId, a.title, a.evidence_requirement AS evidenceRequirement,
      a.completed_at AS completedAt
      FROM goal_plan_actions a JOIN goal_plans p ON p.id=a.goal_plan_id
      WHERE a.status='done' AND a.goal_plan_id IN (${placeholders}) ORDER BY a.completed_at, a.id`).all(...ids) as Array<Record<string, unknown>>;
    const actionRows = database.prepare(`SELECT id, title FROM goal_plan_actions WHERE goal_plan_id IN (${placeholders})`).all(...ids) as Array<{ id: string; title: string }>;
    for (const row of actionRows) actionTitles.set(row.id, row.title);
    actions = rows.map(row => {
      const plan = planById.get(String(row.goalPlanId))!;
      return {
        id: String(row.id), goalPlanId: String(row.goalPlanId), goalTitle: plan.title ?? '未命名目标',
        title: String(row.title),
        evidenceRequirement: row.evidenceRequirement === null ? null : String(row.evidenceRequirement),
        completedAt: row.completedAt === null ? null : String(row.completedAt),
      };
    });
  } finally {
    database.close();
  }

  const days = new Map<string, HistoryCalendarDay>();
  const undatedActivities: UndatedHistoryActivity[] = [];
  const undatedEvidence: UndatedHistoryEvidence[] = [];
  const dayFor = (date: string) => {
    const existing = days.get(date);
    if (existing) return existing;
    const day: HistoryCalendarDay = { date, activities: [], evidence: [], reviews: [] };
    days.set(date, day);
    return day;
  };

  for (const action of actions) {
    const activity = activityForCompletedAction(action, timeZone);
    if (activity) dayFor(historyCalendarDateKey(activity.completedAt, timeZone)!).activities.push(activity);
    else undatedActivities.push({ id: action.id, goalPlanId: action.goalPlanId, goalTitle: action.goalTitle, title: action.title });
  }

  for (const evidence of listEvidence()) {
    if (!evidence.goalPlanId || !planById.has(evidence.goalPlanId)) continue;
    const plan = planById.get(evidence.goalPlanId)!;
    const record = {
      id: evidence.id,
      goalPlanId: evidence.goalPlanId,
      goalTitle: plan.title ?? '未命名目标',
      goalActionId: evidence.goalActionId ?? null,
      actionTitle: evidence.goalActionId ? actionTitles.get(evidence.goalActionId) ?? null : null,
      requirement: null,
      description: evidence.text,
      level: evidence.level,
      observedAt: evidence.observedAt,
      reference: evidence.reference,
      source: evidence.source,
    };
    const date = historyCalendarDateKey(record.observedAt, timeZone);
    if (date) dayFor(date).evidence.push(record);
  }

  for (const plan of plans) {
    for (const event of plan.lifecycleEvents.filter(item => item.action === 'completion_confirmed')) {
      const date = historyCalendarDateKey(event.createdAt, timeZone);
      if (!date) continue;
      const day = dayFor(date);
      day.activities.push({
        id: event.id,
        kind: 'goal_completed',
        goalPlanId: plan.id,
        goalTitle: plan.title ?? '未命名目标',
        title: '确认完成目标',
        completedAt: event.createdAt,
        evidenceRequirement: null,
      });
      for (const [index, evidence] of (event.evidence ?? []).entries()) {
        const requirement = plan.evidenceRequirements.find(item => item.id === evidence.requirementId);
        const record = {
          id: `${event.id}:${index}`,
          goalPlanId: plan.id,
          goalTitle: plan.title ?? '未命名目标',
          goalActionId: null,
          actionTitle: null,
          requirement: requirement?.item ?? null,
          description: evidence.description,
          level: evidence.level,
          reference: requirement?.item ?? '目标完成证据',
          source: '目标完成核对',
        };
        const observedAt = evidence.observedAt;
        const evidenceDate = observedAt ? historyCalendarDateKey(observedAt, timeZone) : null;
        if (observedAt && evidenceDate) dayFor(evidenceDate).evidence.push({ ...record, observedAt });
        else undatedEvidence.push(record);
      }
    }
  }

  return {
    goals,
    undatedActivities,
    undatedEvidence,
    undatedReviews: [],
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(day => ({
      ...day,
      activities: day.activities.sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id)),
      evidence: day.evidence.sort((a, b) => a.goalTitle.localeCompare(b.goalTitle) || a.id.localeCompare(b.id)),
    })),
  };
}
