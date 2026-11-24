import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as createGoalDraft } from '../app/api/v2/goal-drafts/route';
import { POST as confirmGoalDraft } from '../app/api/v2/goal-drafts/[id]/confirm/route';
import { POST as createReview } from '../app/api/v2/weekly-reviews/route';
import { GET as readReview } from '../app/api/v2/weekly-reviews/[weekStart]/route';
import { POST as confirmPlan } from '../app/api/v2/weekly-plans/[id]/confirm/route';
import { POST as editReviewPlan } from '../app/api/v2/weekly-reviews/[weekStart]/messages/route';
import { POST as confirmReviewPlan } from '../app/api/v2/weekly-reviews/[weekStart]/confirm/route';
import { POST as submitActionFeedback } from '../app/api/v2/action-feedback/route';
import { POST as submitUnplannedFeedback } from '../app/api/v2/unplanned-feedback/route';
import { getGoalAttributeContributions } from '../lib/action-feedback-v2';

const { proposeGoalDraft, proposeWeeklyPlan, proposeWeeklyReview, proposeActionAssessment } = vi.hoisted(() => ({
  proposeGoalDraft: vi.fn(), proposeWeeklyPlan: vi.fn(), proposeWeeklyReview: vi.fn(), proposeActionAssessment: vi.fn(),
}));
vi.mock('../lib/goal-draft-agent', () => ({ proposeGoalDraft }));
vi.mock('../lib/weekly-plan-agent', () => ({ proposeWeeklyPlan }));
vi.mock('../lib/weekly-review-agent', () => ({ proposeWeeklyReview }));
vi.mock('../lib/action-feedback-agent', () => ({ proposeActionAssessment }));

const directory = mkdtempSync(join(tmpdir(), 'buildyourself-v2-weekly-reviews-'));
const params = (weekStart: string) => ({ params: Promise.resolve({ weekStart }) });
const planParams = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-24T04:00:00.000Z'));
  process.env.BUILDYOURSELF_DB = join(directory, `${randomUUID()}.sqlite`);
  proposeGoalDraft.mockReset().mockResolvedValue({ reply: '可以开始。', draft: {
    title: '学习英语', description: '可以用英语介绍项目', constraints: { status: 'confirmed', items: [] },
    attributes: [{ name: '口语', description: '表达能力' }], clarifyingQuestions: [],
  } });
  proposeWeeklyPlan.mockReset().mockImplementation(async ({ goals, currentPlan, message }: { goals: Array<{ id: string; attributes: Array<{ id: string }> }>; currentPlan: { actions: Array<{ id: string; title: string; description: string; date: string; goalIds: string[]; attributeIds: string[] }> } | null; message?: string }) => ({ reply: '本周安排已生成。', actions: currentPlan
    ? currentPlan.actions.map(action => ({ ...action, operation: 'update', date: message ? '2026-12-01' : action.date }))
    : [{ operation: 'add', title: '练习英文介绍', description: '准备一个项目介绍', date: '2026-11-25', goalIds: goals.map(goal => goal.id), attributeIds: goals.flatMap(goal => goal.attributes.map(attribute => attribute.id)) }] }));
  proposeWeeklyReview.mockReset().mockImplementation(async ({ currentActions }: { currentActions: Array<{ id: string; title: string; goalIds: string[]; attributeIds: string[] }> }) => ({
    summary: '本周完成了项目介绍初稿。', reply: '已结合你的意见生成下周规划。',
    actions: currentActions.map(action => ({ ...action, operation: 'update', description: '继续练习项目介绍', date: '2026-11-30' })),
  }));
  proposeActionAssessment.mockReset().mockResolvedValue({ completion: 0.5, confidence: 0.8, reply: '继续保持。', contributions: [] });
});
afterEach(() => vi.useRealTimers());
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function enableGoal() {
  const response = await createGoalDraft(new Request('http://localhost/api/v2/goal-drafts', { method: 'POST', body: JSON.stringify({ message: '我想学英语' }) }));
  const { draft } = await response.json();
  const confirmed = await confirmGoalDraft(new Request('http://localhost/api/v2/goal-drafts/id/confirm', { method: 'POST', body: JSON.stringify({ revision: draft.revision }) }), { params: Promise.resolve({ id: draft.id }) });
  const result = await confirmed.json();
  await confirmPlan(new Request('http://localhost/api/v2/weekly-plans/id/confirm', { method: 'POST', body: JSON.stringify({ revision: result.weeklyPlanGeneration.plan.revision }) }), planParams(result.weeklyPlanGeneration.plan.id));
  return { goal: result.goal, planId: result.weeklyPlanGeneration.plan.id };
}

describe('v0.2 周复盘 HTTP API', () => {
  it('保存周总结和原始意见，生成可回读的下周规划草稿', async () => {
    const { planId } = await enableGoal();
    const current = await (await import('../app/api/v2/weekly-plans/[id]/route')).GET(new Request('http://localhost'), planParams(planId));
    const currentPlan = await current.json();
    const originalAction = currentPlan.activePlan.actions[0];
    const goal = (await import('../lib/goal-drafts-v2')).getEnabledGoal(originalAction.goalIds[0]);
    proposeActionAssessment.mockResolvedValueOnce({ completion: 0.5, confidence: 0.8, reply: '完成了一半。', contributions: [{ attributeId: goal.attributes[0].id, amount: 0.8 }] });
    const firstFeedback = await submitActionFeedback(new Request('http://localhost/api/v2/action-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: originalAction.id, message: '我完成了一半。', idempotencyKey: 'week-one-feedback' }) }));
    expect(firstFeedback.status).toBe(201);
    proposeActionAssessment.mockResolvedValueOnce({ completion: 0.5, confidence: 0.8, reply: '这项计划外行动有帮助。', contributions: [{ attributeId: goal.attributes[0].id, amount: 0.4 }] });
    const unplanned = await submitUnplannedFeedback(new Request('http://localhost/api/v2/unplanned-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '额外练习英文对话。', performedOn: '2026-11-27', idempotencyKey: 'unplanned-practice' }) }));
    expect((await unplanned.json()).kind).toBe('action');
    proposeActionAssessment.mockResolvedValueOnce({ completion: 1, confidence: 1, reply: '已记录杂项。', contributions: [] });
    const miscellaneous = await submitUnplannedFeedback(new Request('http://localhost/api/v2/unplanned-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '整理了桌面。', performedOn: '2026-11-27', idempotencyKey: 'unplanned-misc' }) }));
    expect((await miscellaneous.json()).kind).toBe('misc');
    const response = await createReview(new Request('http://localhost/api/v2/weekly-reviews', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStart: '2026-11-23', weekFeedback: '本周工作量较大。', nextWeekFeedback: '下周请把行动分散到工作日。' }),
    }));
    expect(response.status).toBe(201);
    const reviewCall = proposeWeeklyReview.mock.calls[0][0];
    expect(reviewCall.unplannedItems.map((item: { kind: string }) => item.kind).sort()).toEqual(['action', 'misc']);
    const result = await response.json();
    expect(result.review).toMatchObject({ weekStart: '2026-11-23', summary: expect.any(String), weekFeedback: '本周工作量较大。', nextWeekFeedback: '下周请把行动分散到工作日。' });
    expect(result.nextWeekPlan.plan.actions[0]).toMatchObject({ title: '练习英文介绍', date: '2026-11-30' });
    expect(result.nextWeekPlan.plan.actions[0].id).toBe(currentPlan.activePlan.actions[0].id);
    const editResponse = await editReviewPlan(new Request('http://localhost/api/v2/weekly-reviews/2026-11-23/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: result.nextWeekPlan.plan.revision, message: '把练习安排在周二。' }),
    }), params('2026-11-23'));
    expect(editResponse.status).toBe(200);
    const edited = await editResponse.json();
    expect(edited.plan).toMatchObject({ revision: 2, userMessage: '把练习安排在周二。' });
    const staleConfirm = await confirmReviewPlan(new Request('http://localhost/api/v2/weekly-reviews/2026-11-23/confirm', {
      method: 'POST', body: JSON.stringify({ revision: 1 }),
    }), params('2026-11-23'));
    expect(staleConfirm.status).toBe(409);
    const confirmed = await confirmReviewPlan(new Request('http://localhost/api/v2/weekly-reviews/2026-11-23/confirm', {
      method: 'POST', body: JSON.stringify({ revision: 2 }),
    }), params('2026-11-23'));
    expect(confirmed.status).toBe(200);
    const reread = await readReview(new Request('http://localhost/api/v2/weekly-reviews/2026-11-23'), params('2026-11-23'));
    expect(await reread.json()).toMatchObject({ review: result.review, nextWeekPlan: { plan: { revision: 2, status: 'confirmed' }, activeRevision: 2 } });
    const oldPlan = await (await import('../app/api/v2/weekly-plans/[id]/route')).GET(new Request('http://localhost'), planParams(planId));
    expect(await oldPlan.json()).toMatchObject({ activePlan: { revision: 1, status: 'confirmed' } });
    vi.setSystemTime(new Date('2026-11-24T04:01:00.000Z'));
    proposeActionAssessment.mockResolvedValueOnce({ completion: 0.75, confidence: 0.8, reply: '又完成一些。', contributions: [{ attributeId: goal.attributes[0].id, amount: 0.8 }] });
    const secondFeedback = await submitActionFeedback(new Request('http://localhost/api/v2/action-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: originalAction.id, message: '我又练习了一次。', idempotencyKey: 'week-two-feedback' }) }));
    expect(secondFeedback.status).toBe(201);
    const contributionRows = getGoalAttributeContributions(goal.id, goal.attributes[0].id).filter(row => row.actionId === originalAction.id);
    expect(contributionRows).toHaveLength(2);
    expect(contributionRows[0].amount).toBeCloseTo(0.32);
    expect(contributionRows[1].amount).toBeCloseTo(0.16);
  });
});
