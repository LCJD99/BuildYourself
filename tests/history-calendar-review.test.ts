import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET as getHistoryCalendarRoute } from '../app/api/history-calendar/route';
import { activateGoalPlan, listGoalPlanActions, markGoalPlanActionDone, recordGoalPlanEvaluation, saveGoalPlanDraft } from '../lib/goal-plans';
import { correctEvidence } from '../lib/milestone-store';
import { openDatabase, saveEvidence } from '../lib/store';
import { confirmWeeklyReviewAdjustment, getWeeklyReview, saveWeeklyReview } from '../lib/weekly-review-store';
import type { HistoryCalendar } from '../lib/history-calendar';
import { selectHistoryDay } from '../lib/history-calendar-view';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-history-review-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function completePlan() {
  return {
    sourceIntent: '提升工作英语表达', title: '英语目标', domain: 'learning' as const, context: '工作会议',
    domainTemplate: { id: 'learning', version: '1.0.0' },
    successDescription: '能主持英文会议。', observableResult: '保存会议录音。',
    baselineStatus: 'known' as const, baselineAction: null,
    milestones: [{ title: '主持会议', stage: 'near' as const, successCriteria: '主持一次会议。', standardAssessment: 'reasonable' as const, evidenceAvailability: 'available' as const, reviewNote: '检查录音。', evidenceRequirement: '会议录音' }],
    nextActions: [{ title: '准备录音', details: '准备并录制。', estimateMinutes: 20, specificity: 'concrete' as const }],
    constraints: { status: 'confirmed' as const, items: [] },
    evidenceRequirements: [{ item: '会议录音', description: '保存录音', minimumLevel: 'E2' as const }], reviewCycleDays: 7,
  };
}

describe('历史日历中的已保存复盘', () => {
  it('保留保存时复盘和结论，标记被引用证据的后续更正，并提供最近判定入口', async () => {
    const plan = saveGoalPlanDraft(completePlan());
    activateGoalPlan(plan.id, { confirmed: true, reviewedAt: plan.updatedAt });
    const action = listGoalPlanActions(plan.id)[0];
    const evidence = saveEvidence({
      text: '原始录音反馈', source: '导师', reference: 'review-audio-v1', observedAt: '2026-11-10T10:00:00.000Z',
      links: ['milestone'], goalPlanId: plan.id, goalActionId: action.id, level: 'E2',
      reportSubmitted: null, benchmarkComplete: null, latencyMs: null,
    });
    const unreferencedEvidence = saveEvidence({
      text: '另一条目标证据清单记录', source: '用户', reference: 'unreferenced-note', observedAt: '2026-11-11T10:00:00.000Z',
      links: ['task'], goalPlanId: plan.id, goalActionId: null, level: 'E1',
      reportSubmitted: null, benchmarkComplete: null, latencyMs: null,
    });
    saveEvidence({
      text: '未关联目标的通用记录', source: '用户', reference: 'misc-note', observedAt: '2026-11-11T11:00:00.000Z',
      links: ['task'], goalPlanId: null, goalActionId: null, level: 'E1',
      reportSubmitted: null, benchmarkComplete: null, latencyMs: null,
    });
    const milestoneId = plan.milestones[0].id;
    const originalEvaluation = recordGoalPlanEvaluation(plan.id, {
      outcome: 'not_met', status: 'pending_confirmation', summary: '保存时的结论：尚未达到会议标准。',
      reasons: ['录音尚未覆盖提问环节。'], milestoneId, evidenceIds: [evidence.id], observedAt: '2026-11-10T10:00:00.000Z',
    });
    const weekStart = '2026-11-09';
    const draft = getWeeklyReview(weekStart, 'UTC');
    const saved = saveWeeklyReview(weekStart, draft.review.adjustment, 'UTC');

    correctEvidence(evidence.id, { ...evidence, text: '更正后的录音反馈', reference: 'review-audio-v2' });
    correctEvidence(unreferencedEvidence.id, { ...unreferencedEvidence, text: '未被判定引用的更正记录' });
    const reviewDate = saved.savedAt!.slice(0, 10);
    const afterCorrectionResponse = await getHistoryCalendarRoute(new Request('http://localhost/api/history-calendar?timeZone=UTC'));
    const afterCorrection = await afterCorrectionResponse.json() as HistoryCalendar;
    const afterCorrectionReview = selectHistoryDay(afterCorrection, reviewDate, plan.id)!.reviews[0];
    expect(afterCorrectionReview.latestEvaluations).toContainEqual(expect.objectContaining({
      goalPlanId: plan.id, evaluation: expect.objectContaining({ id: originalEvaluation.id }), staleEvidenceIds: [evidence.id],
    }));
    expect(afterCorrectionReview.corrections).toContainEqual(expect.objectContaining({ evidenceId: unreferencedEvidence.id, citations: [] }));
    expect(afterCorrectionReview.review.evidence).not.toContainEqual(expect.objectContaining({ reference: 'misc-note' }));
    expect(afterCorrectionReview.review.evidence.map(item => item.id)).toContain(unreferencedEvidence.id);
    const latestEvaluation = recordGoalPlanEvaluation(plan.id, {
      outcome: 'met', status: 'pending_confirmation', summary: '更正证据后的新判定。',
      reasons: ['更正后的录音包含完整会议流程。'], milestoneId, evidenceIds: [evidence.id], observedAt: '2026-11-12T12:00:00.000Z',
    });

    const response = await getHistoryCalendarRoute(new Request('http://localhost/api/history-calendar?timeZone=UTC'));
    expect(response.status).toBe(200);
    const history = await response.json() as HistoryCalendar;
    const selectedDay = selectHistoryDay(history, reviewDate, plan.id);
    expect(selectedDay?.reviews).toHaveLength(1);
    const historicalReview = selectedDay!.reviews[0];
    expect(historicalReview.review.facts).toEqual(saved.review.facts);
    expect(historicalReview.review.goals[0].evaluations[0]).toMatchObject({
      id: originalEvaluation.id, outcome: 'not_met', summary: '保存时的结论：尚未达到会议标准。', evidenceIds: [evidence.id],
    });
    expect(historicalReview.review.evidence.find(item => item.id === evidence.id)?.text).toBe('原始录音反馈');
    expect(historicalReview.corrections).toContainEqual(expect.objectContaining({
      evidenceId: evidence.id,
      citations: [expect.objectContaining({ goalPlanId: plan.id, evaluationId: originalEvaluation.id })],
      before: expect.objectContaining({ text: '原始录音反馈', reference: 'review-audio-v1' }),
      current: expect.objectContaining({ text: '更正后的录音反馈', reference: 'review-audio-v2' }),
    }));
    expect(historicalReview.latestEvaluations).toContainEqual(expect.objectContaining({
      goalPlanId: plan.id,
      evaluation: expect.objectContaining({ id: latestEvaluation.id, outcome: 'met', summary: '更正证据后的新判定。' }),
      staleEvidenceIds: [],
    }));
  });

  it('按用户明确传入的时区把跨午夜保存的复盘放到本地保存日', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T00:30:00.000Z'));
    try {
      const plan = saveGoalPlanDraft(completePlan());
      activateGoalPlan(plan.id, { confirmed: true, reviewedAt: plan.updatedAt });
      const weekStart = '2026-11-09';
      const draft = getWeeklyReview(weekStart, 'America/Los_Angeles');
      const saved = saveWeeklyReview(weekStart, draft.review.adjustment, 'America/Los_Angeles');
      expect(saved.savedAt).toBe('2026-11-16T00:30:00.000Z');

      const response = await getHistoryCalendarRoute(new Request('http://localhost/api/history-calendar?timeZone=America%2FLos_Angeles'));
      const history = await response.json() as HistoryCalendar;
      expect(selectHistoryDay(history, '2026-11-15')?.reviews).toHaveLength(1);
      expect(selectHistoryDay(history, '2026-11-16')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('不把只含未关联目标证据的周复盘计入目标历史日历', async () => {
    saveEvidence({
      text: '个人杂项记录', source: '用户', reference: 'misc-only', observedAt: '2026-11-10T10:00:00.000Z',
      links: ['task'], goalPlanId: null, goalActionId: null, level: 'E1',
      reportSubmitted: null, benchmarkComplete: null, latencyMs: null,
    });
    const weekStart = '2026-11-09';
    const draft = getWeeklyReview(weekStart, 'UTC');
    const saved = saveWeeklyReview(weekStart, draft.review.adjustment, 'UTC');

    const response = await getHistoryCalendarRoute(new Request('http://localhost/api/history-calendar?timeZone=UTC'));
    const history = await response.json() as HistoryCalendar;
    expect(selectHistoryDay(history, saved.savedAt!.slice(0, 10))).toBeUndefined();
  });

  it('旧复盘缺少保存时间时列入日期不详，不推测日期', async () => {
    const plan = saveGoalPlanDraft(completePlan());
    activateGoalPlan(plan.id, { confirmed: true, reviewedAt: plan.updatedAt });
    const weekStart = '2026-11-09';
    const draft = getWeeklyReview(weekStart, 'UTC');
    saveWeeklyReview(weekStart, draft.review.adjustment, 'UTC');
    const database = openDatabase();
    try {
      database.prepare('UPDATE weekly_reviews SET saved_at=NULL WHERE week_start=?').run(weekStart);
    } finally {
      database.close();
    }

    const response = await getHistoryCalendarRoute(new Request('http://localhost/api/history-calendar?timeZone=UTC'));
    const history = await response.json() as HistoryCalendar;
    expect(history.days.flatMap(day => day.reviews)).toEqual([]);
    expect(history.undatedReviews).toEqual([expect.objectContaining({ review: expect.objectContaining({ weekStart }), savedAt: null })]);
  });

  it('保留已确认建议及后续复盘的任务证据追踪，并标记追踪证据更正', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T12:00:00.000Z'));
    try {
      const plan = saveGoalPlanDraft(completePlan());
      activateGoalPlan(plan.id, { confirmed: true, reviewedAt: plan.updatedAt });
      const sourceWeek = '2026-11-09';
      const sourceDraft = getWeeklyReview(sourceWeek, 'UTC');
      expect(sourceDraft.review.adjustment.goalPlanId).toBe(plan.id);
      const sourceSaved = saveWeeklyReview(sourceWeek, sourceDraft.review.adjustment, 'UTC');
      const confirmed = confirmWeeklyReviewAdjustment(sourceWeek, 'UTC');
      const actionId = confirmed.followup?.actionId;
      expect(confirmed.followup).toMatchObject({ state: 'confirmed', decision: 'accepted', goalPlanId: plan.id });
      if (!actionId) throw new Error('expected a task linked to the saved review suggestion');

      vi.setSystemTime(new Date('2026-11-12T12:00:01.000Z'));
      markGoalPlanActionDone(actionId);
      const evidence = saveEvidence({
        text: '建议任务的原始复测证据', source: '测试报告', reference: 'followup-v1',
        observedAt: '2026-11-12T12:00:02.000Z', links: ['milestone'], goalPlanId: plan.id, goalActionId: actionId,
        level: 'E2', reportSubmitted: null, benchmarkComplete: null, latencyMs: null,
      });
      const followupWeek = '2026-11-16';
      vi.setSystemTime(new Date('2026-11-16T12:00:00.000Z'));
      const followupDraft = getWeeklyReview(followupWeek, 'UTC');
      expect(followupDraft.review.followups[0]).toMatchObject({
        sourceWeekStart: sourceWeek, actionId, status: 'result_available', evidence: [expect.objectContaining({ id: evidence.id, text: '建议任务的原始复测证据' })],
      });
      const followupSaved = saveWeeklyReview(followupWeek, followupDraft.review.adjustment, 'UTC');
      vi.setSystemTime(new Date('2026-11-16T12:00:03.000Z'));
      correctEvidence(evidence.id, { ...evidence, text: '建议任务的更正后复测证据', reference: 'followup-v2' });

      const response = await getHistoryCalendarRoute(new Request('http://localhost/api/history-calendar?timeZone=UTC'));
      const history = await response.json() as HistoryCalendar;
      const sourceDay = selectHistoryDay(history, sourceSaved.savedAt!.slice(0, 10), plan.id)!;
      const followupDay = selectHistoryDay(history, followupSaved.savedAt!.slice(0, 10), plan.id)!;
      const sourceReview = sourceDay.reviews.find(item => item.review.weekStart === sourceWeek)!;
      const followupReview = followupDay.reviews.find(item => item.review.weekStart === followupWeek)!;
      expect(sourceReview.followup).toMatchObject({ state: 'confirmed', actionId, taskTitle: confirmed.followup!.taskTitle });
      expect(followupReview.review.followups[0]).toMatchObject({
        sourceWeekStart: sourceWeek, actionId, status: 'result_available', evidence: [expect.objectContaining({ text: '建议任务的原始复测证据' })],
      });
      expect(followupReview.corrections).toContainEqual(expect.objectContaining({
        evidenceId: evidence.id,
        citations: [expect.objectContaining({ kind: 'followup', sourceWeekStart: sourceWeek, actionId })],
        before: expect.objectContaining({ text: '建议任务的原始复测证据' }),
        current: expect.objectContaining({ text: '建议任务的更正后复测证据', reference: 'followup-v2' }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('检测复盘周外发生但被周内评价引用的证据更正', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T12:00:00.000Z'));
    try {
      const plan = saveGoalPlanDraft(completePlan());
      activateGoalPlan(plan.id, { confirmed: true, reviewedAt: plan.updatedAt });
      const action = listGoalPlanActions(plan.id)[0];
      const evidence = saveEvidence({
        text: '复盘周之前的评价证据', source: '导师', reference: 'older-review-evidence', observedAt: '2026-11-03T10:00:00.000Z',
        links: ['milestone'], goalPlanId: plan.id, goalActionId: action.id, level: 'E2',
        reportSubmitted: null, benchmarkComplete: null, latencyMs: null,
      });
      const evaluation = recordGoalPlanEvaluation(plan.id, {
        outcome: 'not_met', summary: '周内评价引用了较早证据。', reasons: ['查看此前录音。'],
        milestoneId: plan.milestones[0].id, evidenceIds: [evidence.id], observedAt: '2026-11-10T10:00:00.000Z',
      });
      const weekStart = '2026-11-09';
      const draft = getWeeklyReview(weekStart, 'UTC');
      expect(draft.review.evidence.map(item => item.id)).not.toContain(evidence.id);
      const saved = saveWeeklyReview(weekStart, draft.review.adjustment, 'UTC');
      vi.setSystemTime(new Date('2026-11-12T12:00:01.000Z'));
      correctEvidence(evidence.id, { ...evidence, text: '更正后的较早证据' });

      const response = await getHistoryCalendarRoute(new Request('http://localhost/api/history-calendar?timeZone=UTC'));
      const history = await response.json() as HistoryCalendar;
      const review = selectHistoryDay(history, saved.savedAt!.slice(0, 10), plan.id)!.reviews[0];
      expect(review.review.goals.flatMap(goal => goal.evaluations)).toContainEqual(expect.objectContaining({ id: evaluation.id, evidenceIds: [evidence.id] }));
      expect(review.corrections).toContainEqual(expect.objectContaining({
        evidenceId: evidence.id,
        citations: [expect.objectContaining({ kind: 'evaluation', evaluationId: evaluation.id })],
        before: expect.objectContaining({ text: '复盘周之前的评价证据' }),
        originalUnavailable: false,
        current: expect.objectContaining({ text: '更正后的较早证据' }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('旧评价缺少证据快照时仍标记更正并说明原值不可恢复', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T12:00:00.000Z'));
    try {
      const plan = saveGoalPlanDraft(completePlan());
      activateGoalPlan(plan.id, { confirmed: true, reviewedAt: plan.updatedAt });
      const action = listGoalPlanActions(plan.id)[0];
      const evidence = saveEvidence({
        text: '没有可恢复快照的证据', source: '用户', reference: 'legacy-evidence', observedAt: '2026-11-03T10:00:00.000Z',
        links: ['milestone'], goalPlanId: plan.id, goalActionId: action.id, level: 'E2',
        reportSubmitted: null, benchmarkComplete: null, latencyMs: null,
      });
      const evaluation = recordGoalPlanEvaluation(plan.id, {
        outcome: 'not_met', summary: '旧评价保留了证据引用 ID。', reasons: [],
        milestoneId: plan.milestones[0].id, evidenceIds: [evidence.id], observedAt: '2026-11-10T10:00:00.000Z',
      });
      const database = openDatabase();
      try {
        database.prepare('UPDATE goal_plan_evaluations SET evidence_snapshots_json=? WHERE id=?').run('[]', evaluation.id);
      } finally {
        database.close();
      }
      const weekStart = '2026-11-09';
      const draft = getWeeklyReview(weekStart, 'UTC');
      const saved = saveWeeklyReview(weekStart, draft.review.adjustment, 'UTC');
      vi.setSystemTime(new Date('2026-11-12T12:00:01.000Z'));
      correctEvidence(evidence.id, { ...evidence, text: '旧证据更正后版本' });

      const response = await getHistoryCalendarRoute(new Request('http://localhost/api/history-calendar?timeZone=UTC'));
      const history = await response.json() as HistoryCalendar;
      const review = selectHistoryDay(history, saved.savedAt!.slice(0, 10), plan.id)!.reviews[0];
      expect(review.corrections).toContainEqual(expect.objectContaining({
        evidenceId: evidence.id,
        citations: [expect.objectContaining({ kind: 'evaluation', evaluationId: evaluation.id })],
        before: null,
        originalUnavailable: true,
        current: expect.objectContaining({ text: '旧证据更正后版本' }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });
});
