import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as createGoalDraft } from '../app/api/v2/goal-drafts/route';
import { POST as confirmGoalDraft } from '../app/api/v2/goal-drafts/[id]/confirm/route';
import { POST as confirmWeeklyPlan } from '../app/api/v2/weekly-plans/[id]/confirm/route';
import { GET as getCalendarMonth } from '../app/api/v2/calendar/months/[month]/route';
import { GET as getCalendarDay } from '../app/api/v2/calendar/days/[date]/route';
import { POST as submitActionFeedback } from '../app/api/v2/action-feedback/route';
import { GET as listMiscellaneous, POST as submitUnplannedFeedback } from '../app/api/v2/unplanned-feedback/route';
import { POST as createWeeklyReview } from '../app/api/v2/weekly-reviews/route';
import { GET as getWeeklyReview } from '../app/api/v2/weekly-reviews/[weekStart]/route';
import { POST as editWeeklyReview } from '../app/api/v2/weekly-reviews/[weekStart]/messages/route';
import { POST as confirmWeeklyReview } from '../app/api/v2/weekly-reviews/[weekStart]/confirm/route';
import { GET as getWeeklyPlan } from '../app/api/v2/weekly-plans/[id]/route';
import { GET as getGoal } from '../app/api/v2/goals/[id]/route';
import { GET as getAttributeContributions } from '../app/api/v2/goals/[id]/attributes/[attributeId]/contributions/route';

const { proposeGoalDraft, proposeWeeklyPlan, proposeWeeklyReview, proposeActionAssessment } = vi.hoisted(() => ({
  proposeGoalDraft: vi.fn(), proposeWeeklyPlan: vi.fn(), proposeWeeklyReview: vi.fn(), proposeActionAssessment: vi.fn(),
}));
vi.mock('../lib/goal-draft-agent', () => ({ proposeGoalDraft }));
vi.mock('../lib/weekly-plan-agent', () => ({ proposeWeeklyPlan }));
vi.mock('../lib/weekly-review-agent', () => ({ proposeWeeklyReview }));
vi.mock('../lib/action-feedback-agent', () => ({ proposeActionAssessment }));

const directory = mkdtempSync(join(tmpdir(), 'buildyourself-v2-acceptance-'));
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const goalProposal = {
  title: '长期成长目标', description: '通过持续行动提升能力。',
  constraints: { status: 'confirmed', items: [] },
  attributes: [{ name: '表达能力', description: '清楚表达观点' }, { name: '持续练习', description: '保持练习节奏' }],
  clarifyingQuestions: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-24T04:00:00.000Z'));
  process.env.BUILDYOURSELF_DB = join(directory, `${randomUUID()}.sqlite`);
  proposeGoalDraft.mockReset().mockResolvedValue({ reply: '目标已整理。', draft: goalProposal });
  proposeWeeklyPlan.mockReset().mockImplementation(async ({ goals, currentPlan }: {
    goals: Array<{ id: string; attributes: Array<{ id: string }> }>;
    currentPlan: { actions: Array<{ id: string; title: string; description: string; date: string }> } | null;
  }) => ({
    reply: '已生成共享练习行动。',
    actions: [currentPlan ? {
      ...currentPlan.actions[0], operation: 'update' as const,
      goalIds: goals.map(goal => goal.id), attributeIds: goals.flatMap(goal => goal.attributes.map(attribute => attribute.id)),
    } : {
      operation: 'add' as const, title: '练习目标相关表达', description: '围绕两个目标共同练习。', date: '2026-11-25',
      goalIds: goals.map(goal => goal.id), attributeIds: goals.flatMap(goal => goal.attributes.map(attribute => attribute.id)),
    }],
  }));
  proposeWeeklyReview.mockImplementation(async ({ currentActions }: {
    currentActions: Array<{ id: string; title: string; goalIds: string[]; attributeIds: string[] }>;
  }) => ({
    summary: '本周完成共享练习，也记录了计划外活动。', reply: '已准备下一周规划。',
    actions: currentActions.map(action => ({ ...action, operation: 'update', date: '2026-11-30' })),
  }));
  proposeActionAssessment.mockReset().mockResolvedValue({ completion: 0.5, confidence: 0.8, reply: '完成了一部分。', contributions: [] });
});
afterEach(() => vi.useRealTimers());
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function enableGoal() {
  const draftResponse = await createGoalDraft(new Request('http://localhost/api/v2/goal-drafts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '我想持续提升自己' }),
  }));
  const { draft } = await draftResponse.json();
  return confirmGoalDraft(new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: draft.revision }),
  }), params({ id: draft.id }));
}

async function confirmPlan(plan: { id: string; revision: number }) {
  return confirmWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${plan.id}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: plan.revision }),
  }), params({ id: plan.id }));
}

describe('v0.2 多目标与跨周闭环验收（HTTP，Agent 受控）', () => {
  it('从两个目标走通共享行动、反馈、计划外记录、复盘及跨周增量，并可丢弃客户端上下文后重读', async () => {
    const firstEnabledResponse = await enableGoal();
    const firstEnabled = await firstEnabledResponse.json();
    expect(firstEnabledResponse.status).toBe(201);
    const firstGoal = firstEnabled.goal;
    const firstPlan = firstEnabled.weeklyPlanGeneration.plan;
    expect((await confirmPlan(firstPlan)).status).toBe(200);

    const secondEnabledResponse = await enableGoal();
    const secondEnabled = await secondEnabledResponse.json();
    expect(secondEnabledResponse.status).toBe(201);
    const secondGoal = secondEnabled.goal;
    const sharedPlan = secondEnabled.weeklyPlanGeneration.plan;
    expect(sharedPlan.actions).toHaveLength(1);
    expect(sharedPlan.actions[0].goalIds).toEqual(expect.arrayContaining([firstGoal.id, secondGoal.id]));
    expect(sharedPlan.actions[0].attributeIds).toEqual(expect.arrayContaining([
      ...firstGoal.attributes.map((item: { id: string }) => item.id),
      ...secondGoal.attributes.map((item: { id: string }) => item.id),
    ]));
    expect((await confirmPlan(sharedPlan)).status).toBe(200);
    const action = sharedPlan.actions[0];

    const month = await getCalendarMonth(new Request('http://localhost/api/v2/calendar/months/2026-11?timeZone=Asia%2FShanghai'), params({ month: '2026-11' }));
    expect((await month.json()).dates).toEqual(['2026-11-25']);
    const scheduledDay = await getCalendarDay(new Request('http://localhost/api/v2/calendar/days/2026-11-25?timeZone=Asia%2FShanghai'), params({ date: '2026-11-25' }));
    const calendarActions = (await scheduledDay.json()).actions;
    expect(calendarActions).toHaveLength(1);
    expect(calendarActions[0].actionId).toBe(action.id);
    expect(calendarActions[0].goals.map((goal: { id: string }) => goal.id).sort()).toEqual([firstGoal.id, secondGoal.id].sort());

    proposeActionAssessment.mockResolvedValueOnce({ completion: 0.5, confidence: 0.8, reply: '完成了一半。', contributions: [
      ...firstGoal.attributes.map((attribute: { id: string }) => ({ attributeId: attribute.id, amount: 0.5 })),
      ...secondGoal.attributes.map((attribute: { id: string }) => ({ attributeId: attribute.id, amount: 0.4 })),
    ] });
    const feedbackBody = { actionId: action.id, message: '共享练习完成一半。', idempotencyKey: 'closure-planned-1' };
    const submitPlanned = () => submitActionFeedback(new Request('http://localhost/api/v2/action-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(feedbackBody),
    }));
    const feedbackResponse = await submitPlanned();
    const feedback = await feedbackResponse.json();
    expect(feedbackResponse.status).toBe(201);
    expect(feedback.feedback.assessment).toMatchObject({ completion: 0.5, confidence: 0.8 });
    expect(feedback.feedback.contributions).toHaveLength(4);
    const retryResponse = await submitPlanned();
    expect(retryResponse.status).toBe(200);
    expect((await retryResponse.json()).feedback.id).toBe(feedback.feedback.id);
    expect(proposeActionAssessment).toHaveBeenCalledTimes(1);
    expect((await (await getCalendarDay(new Request('http://localhost/api/v2/calendar/days/2026-11-25'), params({ date: '2026-11-25' }))).json()).actions[0].completionFraction).toBe(0.5);

    proposeActionAssessment.mockResolvedValueOnce({ completion: 0.5, confidence: 0.8, reply: '额外练习有收益。', contributions: [
      { attributeId: firstGoal.attributes[0].id, amount: 0.4 },
    ] });
    const unplannedResponse = await submitUnplannedFeedback(new Request('http://localhost/api/v2/unplanned-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '周末额外练习表达。', performedOn: '2026-11-28', idempotencyKey: 'closure-unplanned-1' }),
    }));
    const unplanned = await unplannedResponse.json();
    expect(unplanned.kind).toBe('action');
    expect(unplanned.feedback.performedOn).toBe('2026-11-28');
    const unplannedRetry = await submitUnplannedFeedback(new Request('http://localhost/api/v2/unplanned-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '周末额外练习表达。', performedOn: '2026-11-28', idempotencyKey: 'closure-unplanned-1' }),
    }));
    expect(unplannedRetry.status).toBe(200);
    expect((await unplannedRetry.json()).feedback.id).toBe(unplanned.feedback.id);
    const actualDay = await getCalendarDay(new Request('http://localhost/api/v2/calendar/days/2026-11-28'), params({ date: '2026-11-28' }));
    expect((await actualDay.json()).actions).toMatchObject([{ actionId: unplanned.feedback.actionId, source: 'unplanned' }]);
    const monthAfterUnplanned = await getCalendarMonth(new Request('http://localhost/api/v2/calendar/months/2026-11'), params({ month: '2026-11' }));
    expect((await monthAfterUnplanned.json()).dates).toContain('2026-11-28');
    const unplannedContributionTrace = await getAttributeContributions(new Request('http://localhost'), params({ id: firstGoal.id, attributeId: firstGoal.attributes[0].id }));
    expect((await unplannedContributionTrace.json()).contributions).toContainEqual(expect.objectContaining({ actionId: unplanned.feedback.actionId }));

    proposeActionAssessment.mockResolvedValueOnce({ completion: 1, confidence: 1, reply: '记录为杂项。', contributions: [] });
    const miscellaneous = await submitUnplannedFeedback(new Request('http://localhost/api/v2/unplanned-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '整理了桌面。', performedOn: '2026-11-28', idempotencyKey: 'closure-misc-1' }),
    }));
    const miscellaneousResult = await miscellaneous.json();
    expect(miscellaneousResult.kind).toBe('misc');
    expect(miscellaneousResult.feedback.contributions).toEqual([]);
    const miscellaneousList = await listMiscellaneous();
    expect((await miscellaneousList.json()).miscellaneous).toContainEqual(expect.objectContaining({ message: '整理了桌面。', performedOn: '2026-11-28' }));
    const goalAfterMiscRead = await getGoal(new Request('http://localhost'), params({ id: firstGoal.id }));
    const progressAfterMisc = (await goalAfterMiscRead.json()).goal.attributes.map((item: { progress: number }) => item.progress);
    expect(progressAfterMisc[0]).toBeCloseTo(0.36, 10);
    expect(progressAfterMisc[1]).toBeCloseTo(0.2, 10);
    const dayWithUnplanned = await getCalendarDay(new Request('http://localhost/api/v2/calendar/days/2026-11-28'), params({ date: '2026-11-28' }));
    expect((await dayWithUnplanned.json()).actions).toHaveLength(1);

    const reviewResponse = await createWeeklyReview(new Request('http://localhost/api/v2/weekly-reviews', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStart: '2026-11-23', weekFeedback: '共享计划有帮助。', nextWeekFeedback: '下周保持节奏。' }),
    }));
    expect(reviewResponse.status).toBe(201);
    const reviewResult = await reviewResponse.json();
    expect(proposeWeeklyReview.mock.calls.at(-1)?.[0].unplannedItems.map((item: { kind: string }) => item.kind).sort()).toEqual(['action', 'misc']);
    const nextPlan = reviewResult.nextWeekPlan.plan;
    expect(nextPlan.actions[0].id).toBe(action.id);
    const editResponse = await editWeeklyReview(new Request('http://localhost/api/v2/weekly-reviews/2026-11-23/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: nextPlan.revision, message: '把练习放在周二。' }),
    }), params({ weekStart: '2026-11-23' }));
    const edited = await editResponse.json();
    expect(editResponse.status).toBe(200);
    const confirmedReview = await confirmWeeklyReview(new Request('http://localhost/api/v2/weekly-reviews/2026-11-23/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: edited.plan.revision }),
    }), params({ weekStart: '2026-11-23' }));
    expect(confirmedReview.status).toBe(200);

    // A fresh HTTP read has no access to the previous in-memory conversation state.
    const reopenedReview = await getWeeklyReview(new Request('http://localhost/api/v2/weekly-reviews/2026-11-23'), params({ weekStart: '2026-11-23' }));
    expect((await reopenedReview.json()).review).toMatchObject({ weekFeedback: '共享计划有帮助。', nextWeekFeedback: '下周保持节奏。' });
    const reopenedPlan = await getWeeklyPlan(new Request('http://localhost'), params({ id: sharedPlan.id }));
    expect((await reopenedPlan.json()).activePlan).toMatchObject({
      status: 'confirmed', actions: [{ id: action.id, date: '2026-11-25' }],
    });

    vi.setSystemTime(new Date('2026-12-01T04:00:00.000Z'));
    proposeActionAssessment.mockResolvedValueOnce({ completion: 0.75, confidence: 0.8, reply: '继续完成了一部分。', contributions: [
      ...firstGoal.attributes.map((attribute: { id: string }) => ({ attributeId: attribute.id, amount: 0.5 })),
      ...secondGoal.attributes.map((attribute: { id: string }) => ({ attributeId: attribute.id, amount: 0.4 })),
    ] });
    const continued = await submitActionFeedback(new Request('http://localhost/api/v2/action-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: action.id, message: '下周继续练习。', idempotencyKey: 'closure-planned-2' }),
    }));
    expect(continued.status).toBe(201);
    const freshAttributeTraceAfterContinue = await getAttributeContributions(new Request('http://localhost'), params({ id: firstGoal.id, attributeId: firstGoal.attributes[0].id }));
    const firstAttributeRows = (await freshAttributeTraceAfterContinue.json()).contributions.filter((row: { actionId: string }) => row.actionId === action.id);
    expect(firstAttributeRows).toHaveLength(2);
    expect(firstAttributeRows[0].amount).toBeCloseTo(0.2, 10);
    expect(firstAttributeRows[1].amount).toBeCloseTo(0.1, 10);
    for (const [goal, expectedFirst, expectedAdditional] of [
      [firstGoal, 0.2, 0.1], [secondGoal, 0.16, 0.08],
    ] as const) {
      for (const attribute of goal.attributes) {
        const trace = goal.id === firstGoal.id && attribute.id === firstGoal.attributes[0].id
          ? { json: async () => ({ contributions: firstAttributeRows }) }
          : await getAttributeContributions(new Request('http://localhost'), params({ id: goal.id, attributeId: attribute.id }));
        const rows = (await trace.json()).contributions.filter((row: { actionId: string }) => row.actionId === action.id);
        expect(rows).toHaveLength(2);
        expect(rows[0].amount).toBeCloseTo(expectedFirst, 10);
        expect(rows[1].amount).toBeCloseTo(expectedAdditional, 10);
      }
    }
  });
});
