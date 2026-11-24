import { GoalDraftError, listEnabledGoals } from './goal-drafts-v2';
import { listConfirmedWeeklyPlanActions } from './weekly-plans-v2';
import { getLatestActionCompletionByIds } from './action-feedback-v2';
import type { WeeklyPlanAction } from './weekly-plan-agent';

const defaultTimeZone = 'Asia/Shanghai';

type CalendarGoal = {
  id: string;
  title: string;
  attributes: Array<{ id: string; name: string }>;
};

export type V2CalendarAction = {
  actionId: string;
  title: string;
  description: string;
  scheduledDate: string;
  source: 'planned';
  goals: CalendarGoal[];
  completionFraction: number | null;
};

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateForMonth(month: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new GoalDraftError('月份格式必须是 YYYY-MM。', 400);
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function calendarDate(date: string): string {
  if (!validDate(date)) throw new GoalDraftError('日期格式必须是有效的 YYYY-MM-DD。', 400);
  return date;
}

function calendarTimeZone(value: string | undefined): string {
  const timeZone = value?.trim() || defaultTimeZone;
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(new Date(0));
  } catch {
    throw new GoalDraftError('时区无效。', 400);
  }
  return timeZone;
}

function readConfirmedActions(startDate: string, endDate: string): WeeklyPlanAction[] {
  return listConfirmedWeeklyPlanActions(startDate, endDate);
}

function dailyActionDetails(actions: WeeklyPlanAction[]): V2CalendarAction[] {
  const goalsById = new Map(listEnabledGoals().map(goal => [goal.id, goal]));
  const attributesForAction = (action: WeeklyPlanAction, goalId: string) => {
    const goal = goalsById.get(goalId);
    if (!goal) return [];
    return goal.attributes
      .filter(attribute => action.attributeIds.includes(attribute.id))
      .map(attribute => ({ id: attribute.id, name: attribute.name }));
  };
  const actionsById = new Map<string, V2CalendarAction>();
  for (const action of actions) {
    const visibleGoals = action.goalIds
      .filter(goalId => goalsById.has(goalId))
      .map(goalId => {
        const goal = goalsById.get(goalId)!;
        return { id: goal.id, title: goal.title, attributes: attributesForAction(action, goalId) };
      });
    const current = actionsById.get(action.id);
    if (current) {
      const goals = new Map(current.goals.map(goal => [goal.id, goal]));
      for (const goal of visibleGoals) goals.set(goal.id, goal);
      current.goals = [...goals.values()];
      continue;
    }
    actionsById.set(action.id, {
      actionId: action.id,
      title: action.title,
      description: action.description,
      scheduledDate: action.date,
      source: 'planned',
      goals: visibleGoals,
      // Date-only plans have no assessment until the feedback API records one.
      completionFraction: null,
    });
  }
  const completionByActionId = getLatestActionCompletionByIds([...actionsById.keys()]);
  for (const [actionId, action] of actionsById) {
    action.completionFraction = completionByActionId[actionId] ?? null;
  }
  // Scheduled dates are plain YYYY-MM-DD values in the calendar's date grain.
  return [...actionsById.values()].sort((left, right) =>
    left.scheduledDate.localeCompare(right.scheduledDate) || left.actionId.localeCompare(right.actionId));
}

export function getCalendarMonth(month: string, timeZoneValue?: string) {
  const { start, end } = dateForMonth(month);
  const timeZone = calendarTimeZone(timeZoneValue);
  const actions = readConfirmedActions(start, end);
  return { month, timeZone, dates: [...new Set(actions.map(action => action.date))].sort() };
}

export function getCalendarDay(dateValue: string, timeZoneValue?: string) {
  const date = calendarDate(dateValue);
  const timeZone = calendarTimeZone(timeZoneValue);
  return { date, timeZone, actions: dailyActionDetails(readConfirmedActions(date, date)) };
}
