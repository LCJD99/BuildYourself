import type { HistoryCalendar, HistoryCalendarDay } from './history-calendar';

export function filterHistoryDay(day: HistoryCalendarDay | undefined, goalPlanId: string): HistoryCalendarDay | undefined {
  if (!day || !goalPlanId) return day;
  return {
    date: day.date,
    activities: day.activities.filter(item => item.goalPlanId === goalPlanId),
    evidence: day.evidence.filter(item => item.goalPlanId === goalPlanId),
    reviews: day.reviews.flatMap(saved => {
      const goals = saved.review.goals.filter(goal => goal.goalPlanId === goalPlanId);
      if (!goals.length) return [];
      return [{
        ...saved,
        review: {
          ...saved.review,
          goals,
          plannedActions: saved.review.plannedActions.filter(item => item.goalPlanId === goalPlanId),
          followups: saved.review.followups.filter(item => item.goalPlanId === goalPlanId),
          evidence: saved.review.evidence.filter(item => item.goalPlanId === goalPlanId),
          unlinkedEvidence: [],
        },
        followup: saved.followup?.goalPlanId === goalPlanId ? saved.followup : null,
        corrections: saved.corrections.filter(correction => correction.before.goalPlanId === goalPlanId
          || correction.citations.some(citation => citation.goalPlanId === goalPlanId)),
        latestEvaluations: saved.latestEvaluations.filter(evaluation => evaluation.goalPlanId === goalPlanId),
      }];
    }),
  };
}

export function selectHistoryDay(history: HistoryCalendar, date: string, goalPlanId = '') {
  return filterHistoryDay(history.days.find(day => day.date === date), goalPlanId);
}
