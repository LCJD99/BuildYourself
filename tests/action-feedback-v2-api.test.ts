import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as createDraft } from '../app/api/v2/goal-drafts/route';
import { POST as confirmDraft } from '../app/api/v2/goal-drafts/[id]/confirm/route';
import { POST as confirmWeeklyPlan } from '../app/api/v2/weekly-plans/[id]/confirm/route';
import { POST as submitFeedback } from '../app/api/v2/action-feedback/route';
import { GET as getFeedback } from '../app/api/v2/action-feedback/[id]/route';
import { GET as getAction } from '../app/api/v2/actions/[id]/route';
import { GET as getGoal } from '../app/api/v2/goals/[id]/route';
import { GET as getAttributeContributions } from '../app/api/v2/goals/[id]/attributes/[attributeId]/contributions/route';
import { getLatestActionCompletionByIds } from '../lib/action-feedback-v2';
import { POST as submitUnplanned } from '../app/api/v2/unplanned-feedback/route';
import { GET as getCalendarDay } from '../app/api/v2/calendar/days/[date]/route';
import { GET as getCalendarMonth } from '../app/api/v2/calendar/months/[month]/route';

const { proposeGoalDraft, proposeWeeklyPlan, proposeActionAssessment } = vi.hoisted(() => ({
  proposeGoalDraft: vi.fn(),
  proposeWeeklyPlan: vi.fn(),
  proposeActionAssessment: vi.fn(),
}));
vi.mock('../lib/goal-draft-agent', () => ({ proposeGoalDraft }));
vi.mock('../lib/weekly-plan-agent', () => ({ proposeWeeklyPlan }));
vi.mock('../lib/action-feedback-agent', () => ({ proposeActionAssessment }));

const directory = mkdtempSync(join(tmpdir(), 'buildyourself-v2-action-feedback-'));
const params = <T extends Record<string, string>>(values: T) => ({ params: Promise.resolve(values) });
const readyProposal = {
  title: '提升英语表达能力',
  description: '能够独立完成英文项目介绍。',
  constraints: { status: 'confirmed', items: ['工作日每天可投入 30 分钟'] },
  attributes: [
    { name: '口语表达', description: '表达清晰度' },
    { name: '内容组织', description: '组织内容的能力' },
  ],
  clarifyingQuestions: [],
};

beforeEach(() => {
  process.env.BUILDYOURSELF_DB = join(directory, `${randomUUID()}.sqlite`);
  proposeGoalDraft.mockReset().mockResolvedValue({ reply: '目标草稿已准备好。', draft: readyProposal });
  proposeWeeklyPlan.mockReset().mockImplementation(async ({ weekStart, goals }: {
    weekStart: string;
    goals: Array<{ id: string; attributes: Array<{ id: string }> }>;
  }) => ({
    reply: '已生成本周行动。',
    actions: [{ operation: 'add', title: '练习英文介绍', description: '写并口头练习一段介绍。', date: weekStart,
      goalIds: goals.map(goal => goal.id), attributeIds: goals.flatMap(goal => goal.attributes.map(attribute => attribute.id)) }],
  }));
  proposeActionAssessment.mockReset().mockResolvedValue({
    completion: 0.5,
    confidence: 0.8,
    reply: '已经完成一半，表达清楚度有所提升。',
    contributions: [
      { attributeId: 'oral', amount: 0.8 },
      { attributeId: 'organization', amount: 0.5 },
    ],
  });
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function createConfirmedPlannedAction() {
  const created = await createDraft(new Request('http://localhost/api/v2/goal-drafts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '我想提升英语表达' }),
  }));
  const { draft } = await created.json();
  const confirmedGoal = await confirmDraft(new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: draft.revision }),
  }), params({ id: draft.id }));
  const { goal, weeklyPlanGeneration } = await confirmedGoal.json();
  const plan = weeklyPlanGeneration.plan;
  const confirmedPlan = await confirmWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${plan.id}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: plan.revision }),
  }), params({ id: plan.id }));
  expect(confirmedPlan.status).toBe(200);
  return { goal, action: plan.actions[0] };
}

describe('v0.2 计划内行动反馈 HTTP API', () => {
  it('保存部分完成评估及多属性贡献，重开后可从属性和行动追溯', async () => {
    const { goal, action } = await createConfirmedPlannedAction();
    proposeActionAssessment.mockResolvedValueOnce({
      completion: 0.5,
      confidence: 0.8,
      reply: '已经完成一半，表达清楚度有所提升。',
      contributions: [
        { attributeId: goal.attributes[0].id, amount: 0.8 },
        { attributeId: goal.attributes[1].id, amount: 0.5 },
      ],
    });

    const response = await submitFeedback(new Request('http://localhost/api/v2/action-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: action.id, message: '练习并完成了一半的英文介绍。', idempotencyKey: 'feedback-1' }),
    }));
    const saved = await response.json();

    expect(response.status).toBe(201);
    expect(saved.feedback).toMatchObject({
      actionId: action.id, message: '练习并完成了一半的英文介绍。',
      assessment: { completion: 0.5, confidence: 0.8, reply: '已经完成一半，表达清楚度有所提升。' },
    });
    expect(saved.feedback.contributions).toHaveLength(2);

    const reopened = await getFeedback(new Request('http://localhost'), params({ id: saved.feedback.id }));
    expect((await reopened.json()).feedback).toEqual(saved.feedback);

    const firstAttribute = await getAttributeContributions(new Request('http://localhost'), params({ id: goal.id, attributeId: goal.attributes[0].id }));
    const firstTrace = await firstAttribute.json();
    expect(firstTrace.contributions).toHaveLength(1);
    expect(firstTrace.contributions[0]).toMatchObject({
      actionId: action.id, feedbackId: saved.feedback.id,
      assessment: { completion: 0.5, confidence: 0.8 },
    });

    const reopenedAction = await getAction(new Request('http://localhost'), params({ id: action.id }));
    const actionRecord = await reopenedAction.json();
    expect(actionRecord.action.id).toBe(action.id);
    expect(actionRecord.feedback).toHaveLength(1);
    expect(getLatestActionCompletionByIds([action.id, 'no-feedback-yet'])).toEqual({ [action.id]: 0.5, 'no-feedback-yet': null });
    expect((await getGoal(new Request('http://localhost'), params({ id: goal.id }))).status).toBe(200);
  });

  it('同一重试标识复用原评估，并将跨次反馈只计入未记录的累计差额', async () => {
    const { goal, action } = await createConfirmedPlannedAction();
    const body = { actionId: action.id, message: '我练完了一半。', idempotencyKey: 'retry-1' };
    proposeActionAssessment.mockResolvedValueOnce({
      completion: 0.5, confidence: 0.8, reply: '完成了一半。',
      contributions: [{ attributeId: goal.attributes[0].id, amount: 0.8 }],
    });
    const request = () => submitFeedback(new Request('http://localhost/api/v2/action-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    const first = await request();
    const retry = await request();
    const firstBody = await first.json();
    const retryBody = await retry.json();
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retryBody.feedback.id).toBe(firstBody.feedback.id);
    expect(proposeActionAssessment).toHaveBeenCalledOnce();

    proposeActionAssessment.mockResolvedValueOnce({
      completion: 1, confidence: 1, reply: '已完成该行动。',
      contributions: [{ attributeId: goal.attributes[0].id, amount: 0.8 }],
    });
    const next = await submitFeedback(new Request('http://localhost/api/v2/action-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, message: '后来我完成了剩余部分。', idempotencyKey: 'retry-2' }),
    }));
    const { feedback: nextFeedback } = await next.json();
    expect(nextFeedback.contributions[0].amount).toBeCloseTo(0.48, 10);
    expect(nextFeedback.contributions[0].cumulativeAmount).toBeCloseTo(0.8, 10);
    const attributeTrace = await getAttributeContributions(new Request('http://localhost'), params({ id: goal.id, attributeId: goal.attributes[0].id }));
    const amounts = (await attributeTrace.json()).contributions.map((item: { amount: number }) => item.amount);
    expect(amounts[0]).toBeCloseTo(0.32, 10);
    expect(amounts[1]).toBeCloseTo(0.48, 10);
  });

  it('未知属性不会产生反馈或进度', async () => {
    const { goal, action } = await createConfirmedPlannedAction();
    proposeActionAssessment.mockResolvedValueOnce({
      completion: 1, confidence: 1, reply: '已完成。', contributions: [{ attributeId: 'unknown', amount: 1 }],
    });
    const response = await submitFeedback(new Request('http://localhost/api/v2/action-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: action.id, message: '完成了。', idempotencyKey: 'invalid-attribute' }),
    }));
    expect(response.status).toBe(502);
    const detail = await getGoal(new Request('http://localhost'), params({ id: goal.id }));
    expect((await detail.json()).goal.attributes.map((attribute: { progress: number }) => attribute.progress)).toEqual([0, 0]);
  });

  it('并发重试同一标识只计入一次贡献', async () => {
    const { goal, action } = await createConfirmedPlannedAction();
    proposeActionAssessment.mockResolvedValue({
      completion: 0.5, confidence: 0.8, reply: '完成了一半。',
      contributions: [{ attributeId: goal.attributes[0].id, amount: 0.8 }],
    });
    const request = () => submitFeedback(new Request('http://localhost/api/v2/action-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: action.id, message: '练习了一半。', idempotencyKey: 'parallel-1' }),
    }));
    const [firstResponse, secondResponse] = await Promise.all([request(), request()]);
    expect([firstResponse.status, secondResponse.status].sort()).toEqual([200, 201]);
    const first = await firstResponse.json();
    const second = await secondResponse.json();
    expect(first.feedback.id).toBe(second.feedback.id);
    expect(first.feedback.contributions).toHaveLength(1);
  });

  it('不同请求并发评估到相同贡献快照时拒绝过期写入', async () => {
    const { goal, action } = await createConfirmedPlannedAction();
    let release!: () => void;
    let evaluationsStarted = 0;
    const bothEvaluated = new Promise<void>(resolve => { release = resolve; });
    proposeActionAssessment.mockImplementation(async () => {
      evaluationsStarted += 1;
      if (evaluationsStarted === 2) release();
      await bothEvaluated;
      return {
        completion: 0.5, confidence: 0.8, reply: '完成了一半。',
        contributions: [{ attributeId: goal.attributes[0].id, amount: 0.8 }],
      };
    });
    const request = (idempotencyKey: string) => submitFeedback(new Request('http://localhost/api/v2/action-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: action.id, message: '刚完成一半。', idempotencyKey }),
    }));
    const [first, second] = await Promise.all([request('concurrent-a'), request('concurrent-b')]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const trace = await getAttributeContributions(new Request('http://localhost'), params({ id: goal.id, attributeId: goal.attributes[0].id }));
    const contributions = (await trace.json()).contributions;
    expect(contributions).toHaveLength(1);
    expect(contributions[0].amount).toBeCloseTo(0.32, 10);
  });

  it('保留反馈中的原始空格和换行以便回看', async () => {
    const { goal, action } = await createConfirmedPlannedAction();
    proposeActionAssessment.mockResolvedValueOnce({
      completion: 0.5, confidence: 0.8, reply: '已记录。',
      contributions: [{ attributeId: goal.attributes[0].id, amount: 0.8 }],
    });
    const message = '  我练习了一半。\n还需要继续复习。  ';
    const response = await submitFeedback(new Request('http://localhost/api/v2/action-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: action.id, message, idempotencyKey: 'preserve-raw-feedback' }),
    }));
    expect(response.status).toBe(201);
    expect((await response.json()).feedback.message).toBe(message);
  });

  it('空结果和从未反馈的行动可安全查询完成度', () => {
    expect(getLatestActionCompletionByIds([])).toEqual({});
    expect(getLatestActionCompletionByIds(['missing-action'])).toEqual({ 'missing-action': null });
  });

  it('计划外有收益时按实际日期保存为行动、增加属性贡献并显示在日历', async () => {
    const { goal } = await createConfirmedPlannedAction();
    const performedOn = '2026-11-20';
    proposeActionAssessment.mockImplementationOnce(async ({ action }: { action: { attributeIds: string[] } }) => ({
      completion: 0.5, confidence: 0.8, reply: '这次练习提升了表达。',
      contributions: [{ attributeId: action.attributeIds[0], amount: 0.6 }],
    }));
    const requestBody = { message: '临时练习了英文演讲。', idempotencyKey: 'unplanned-gain', performedOn };
    const request = (body: typeof requestBody) => submitUnplanned(new Request('http://localhost/api/v2/unplanned-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    const response = await request(requestBody);
    const result = await response.json();
    expect(response.status).toBe(201);
    expect(result.kind).toBe('action');
    const retry = await request(requestBody);
    expect(retry.status).toBe(200);
    expect((await retry.json()).feedback.id).toBe(result.feedback.id);
    expect((await request({ ...requestBody, message: '不同的反馈。' })).status).toBe(409);
    expect(proposeActionAssessment).toHaveBeenCalledOnce();
    expect(proposeActionAssessment.mock.calls.at(-1)?.[0].unplanned).toBe(true);
    expect(result.feedback.performedOn).toBe(performedOn);
    expect(result.feedback.contributions[0].amount).toBeCloseTo(0.24, 10);
    const calendar = await getCalendarDay(new Request('http://localhost'), params({ date: performedOn }));
    expect((await calendar.json()).actions).toContainEqual(expect.objectContaining({
      actionId: result.feedback.actionId, source: 'unplanned', scheduledDate: performedOn,
    }));
    const month = await getCalendarMonth(new Request('http://localhost'), params({ month: performedOn.slice(0, 7) }));
    expect((await month.json()).dates).toContain(performedOn);
    const reopened = await getFeedback(new Request('http://localhost'), params({ id: result.feedback.id }));
    expect((await reopened.json()).feedback.message).toBe('临时练习了英文演讲。');
  });

  it.each([
    { completion: 0.5, confidence: 0 },
    { completion: 0, confidence: 0.9 },
  ])('计划外无有效贡献时保存为杂项并保持进度不变（$completion/$confidence）', async ({ completion, confidence }) => {
    const { goal } = await createConfirmedPlannedAction();
    proposeActionAssessment.mockImplementationOnce(async ({ action }: { action: { attributeIds: string[] } }) => ({
      completion, confidence, reply: '已记录为杂项。',
      contributions: [{ attributeId: action.attributeIds[0], amount: 1 }],
    }));
    const body = { message: '整理了桌面。', idempotencyKey: 'unplanned-misc', performedOn: '2026-11-21' };
    const request = () => submitUnplanned(new Request('http://localhost/api/v2/unplanned-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    const first = await request(); const firstResult = await first.json();
    const retry = await request(); const retryResult = await retry.json();
    expect(firstResult.kind).toBe('misc');
    expect(retry.status).toBe(200);
    expect(retryResult.feedback.id).toBe(firstResult.feedback.id);
    const list = await (await import('../app/api/v2/unplanned-feedback/route')).GET();
    expect((await list.json()).miscellaneous).toContainEqual(expect.objectContaining({
      id: firstResult.feedback.id, message: '整理了桌面。', performedOn: '2026-11-21',
    }));
    const goalResponse = await getGoal(new Request('http://localhost'), params({ id: goal.id }));
    const progress = (await goalResponse.json()).goal.attributes
      .map((attribute: { progress: number }) => attribute.progress);
    expect(progress).toEqual([0, 0]);
    expect(proposeActionAssessment).toHaveBeenCalledOnce();
  });
});
