import type { HistoryCalendar, HistoryCalendarDay } from './history-calendar';

export function filterHistoryDay(day: HistoryCalendarDay | undefined, goalPlanId: string): HistoryCalendarDay | undefined {
  if (!day || !goalPlanId) return day;
  return {
    date: day.date,
    activities: day.activities.filter(item => item.goalPlanId === goalPlanId),
    evidence: day.evidence.filter(item => item.goalPlanId === goalPlanId),
  };
}

export function selectHistoryDay(history: HistoryCalendar, date: string, goalPlanId = '') {
  return filterHistoryDay(history.days.find(day => day.date === date), goalPlanId);
}
