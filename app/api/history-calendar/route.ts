import { listGoalPlanActions, listGoalPlanEvaluations, listGoalPlans } from '../../../lib/goal-plans';
import { getHistoryCalendar, historyCalendarDateKey, type HistoryCalendarReview } from '../../../lib/history-calendar';
import { listEvidence } from '../../../lib/store';
import { listSavedWeeklyReviews } from '../../../lib/weekly-review-store';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const timeZone = new URL(request.url).searchParams.get('timeZone') || 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone }).format(new Date(0)); } catch {
    return Response.json({ error: '时区无效' }, { status: 400 });
  }
  const history = getHistoryCalendar(timeZone);
  const evidenceById = new Map(listEvidence().map(evidence => [evidence.id, evidence]));
  const plans = listGoalPlans();
  const planById = new Map(plans.map(plan => [plan.id, plan]));
  const actionTitleById = new Map(listGoalPlanActions().map(action => [action.id, action.title]));
  const savedReviews = listSavedWeeklyReviews();
  const latestEvaluationByGoal = new Map([...new Set(savedReviews.flatMap(saved => saved.review.goals.map(goal => goal.goalPlanId)))]
    .map(goalPlanId => [goalPlanId, listGoalPlanEvaluations(goalPlanId).at(-1) ?? null]));
  for (const saved of savedReviews) {
    const { review, savedAt } = saved;
    if (!review.goals.length) continue;
    if (!savedAt) {
      history.undatedReviews.push({ review, savedAt, followup: saved.followup });
      continue;
    }
    const date = historyCalendarDateKey(savedAt, timeZone);
    if (!date) {
      history.undatedReviews.push({ review, savedAt, followup: saved.followup });
      continue;
    }
    const citationsByEvidence = new Map<string, HistoryCalendarReview['corrections'][number]['citations']>();
    for (const goal of review.goals) {
      for (const evaluation of goal.evaluations) {
        for (const evidenceId of evaluation.evidenceIds) {
          const citations = citationsByEvidence.get(evidenceId) ?? [];
          citations.push({ goalPlanId: goal.goalPlanId, goalTitle: goal.title, kind: 'evaluation', evaluationId: evaluation.id, summary: evaluation.summary });
          citationsByEvidence.set(evidenceId, citations);
        }
      }
    }
    for (const trace of review.followups) {
      for (const evidence of trace.evidence) {
        const citations = citationsByEvidence.get(evidence.id) ?? [];
        citations.push({
          goalPlanId: trace.goalPlanId,
          goalTitle: trace.goalTitle,
          kind: 'followup',
          sourceWeekStart: trace.sourceWeekStart,
          actionId: trace.actionId,
          summary: trace.resultSummary,
        });
        citationsByEvidence.set(evidence.id, citations);
      }
    }
    const snapshotsByEvidence = new Map(review.evidence.map(snapshot => [snapshot.id, snapshot]));
    for (const trace of review.followups) {
      for (const snapshot of trace.evidence) if (!snapshotsByEvidence.has(snapshot.id)) snapshotsByEvidence.set(snapshot.id, snapshot);
    }
    const corrections: HistoryCalendarReview['corrections'] = [];
    for (const snapshot of snapshotsByEvidence.values()) {
      const current = evidenceById.get(snapshot.id);
      const changedAt = current?.lastCorrectedAt;
      if (!current || !changedAt || Date.parse(changedAt) <= Date.parse(savedAt)) continue;
      const { revisionCount: _revisionCount, lastCorrectedAt: _lastCorrectedAt, revisions: _revisions, ...currentSnapshot } = current;
      corrections.push({
        evidenceId: snapshot.id,
        changedAt,
        citations: citationsByEvidence.get(snapshot.id) ?? [],
        before: snapshot,
        current: currentSnapshot,
        currentGoalTitle: current.goalPlanId ? planById.get(current.goalPlanId)?.title ?? null : null,
        currentGoalActionTitle: current.goalActionId ? actionTitleById.get(current.goalActionId) ?? null : null,
      });
    }
    const latestEvaluations: HistoryCalendarReview['latestEvaluations'] = review.goals.map(goal => {
      const evaluation = latestEvaluationByGoal.get(goal.goalPlanId) ?? null;
      const staleEvidenceIds = evaluation?.evidenceIds.filter(evidenceId => {
        const changedAt = evidenceById.get(evidenceId)?.lastCorrectedAt;
        return Boolean(changedAt && Date.parse(changedAt) > Date.parse(evaluation.evaluatedAt));
      }) ?? [];
      return {
        goalPlanId: goal.goalPlanId,
        evaluation: evaluation ? {
          id: evaluation.id,
          observedAt: evaluation.observedAt,
          evaluatedAt: evaluation.evaluatedAt,
          outcome: evaluation.outcome,
          status: evaluation.status,
          summary: evaluation.summary,
          contractVersion: evaluation.contractVersion.version,
          evidenceIds: evaluation.evidenceIds,
        } : null,
        staleEvidenceIds,
      };
    });
    const record: HistoryCalendarReview = { review, savedAt, followup: saved.followup, corrections, latestEvaluations };
    const day = history.days.find(item => item.date === date);
    if (day) day.reviews.push(record);
    else history.days.push({ date, activities: [], evidence: [], reviews: [record] });
  }
  history.days.sort((a, b) => a.date.localeCompare(b.date));
  return Response.json(history);
}
