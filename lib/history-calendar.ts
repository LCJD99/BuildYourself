import { listGoalPlans, type GoalPlan, type GoalPlanAction, type GoalPlanStatus } from './goal-plans';
import { openDatabase } from './store';

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
  requirement: string | null;
  description: string;
  level: string;
};
export type HistoryCalendarDay = {
  date: string;
  activities: HistoryCalendarActivity[];
  evidence: HistoryCalendarEvidence[];
};
export type UndatedHistoryActivity = { id: string; goalPlanId: string; goalTitle: string; title: string };
export type HistoryCalendar = { goals: HistoryCalendarGoal[]; days: HistoryCalendarDay[]; undatedActivities: UndatedHistoryActivity[] };
type CompletedGoalAction = Pick<GoalPlanAction, 'id' | 'goalPlanId' | 'goalTitle' | 'title' | 'completedAt' | 'evidenceRequirement'>;

function dateKey(timestamp: string, timeZone: string): string | null {
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
  const date = dateKey(completedAt, timeZone);
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
  if (!plans.length) return { goals, days: [], undatedActivities: [] };

  const database = openDatabase();
  let actions: CompletedGoalAction[];
  try {
    const ids = plans.map(plan => plan.id);
    const placeholders = ids.map(() => '?').join(',');
    const rows = database.prepare(`SELECT a.id, a.goal_plan_id AS goalPlanId, a.title, a.evidence_requirement AS evidenceRequirement,
      a.completed_at AS completedAt
      FROM goal_plan_actions a JOIN goal_plans p ON p.id=a.goal_plan_id
      WHERE a.status='done' AND a.goal_plan_id IN (${placeholders}) ORDER BY a.completed_at, a.id`).all(...ids) as Array<Record<string, unknown>>;
    const planById = new Map(plans.map(plan => [plan.id, plan]));
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
  const dayFor = (date: string) => {
    const existing = days.get(date);
    if (existing) return existing;
    const day = { date, activities: [], evidence: [], unassignedEvidence: [] };
    days.set(date, day);
    return day;
  };

  for (const action of actions) {
    const activity = activityForCompletedAction(action, timeZone);
    if (activity) dayFor(dateKey(activity.completedAt, timeZone)!).activities.push(activity);
    else undatedActivities.push({ id: action.id, goalPlanId: action.goalPlanId, goalTitle: action.goalTitle, title: action.title });
  }

  for (const plan of plans) {
    for (const event of plan.lifecycleEvents.filter(item => item.action === 'completion_confirmed')) {
      const date = dateKey(event.createdAt, timeZone);
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
        day.evidence.push({
          id: `${event.id}:${index}`,
          goalPlanId: plan.id,
          goalTitle: plan.title ?? '未命名目标',
          requirement: requirement?.item ?? null,
          description: evidence.description,
          level: evidence.level,
        });
      }
    }
  }

  return {
    goals,
    undatedActivities,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(day => ({
      ...day,
      activities: day.activities.sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id)),
      evidence: day.evidence.sort((a, b) => a.goalTitle.localeCompare(b.goalTitle) || a.id.localeCompare(b.id)),
    })),
  };
}
