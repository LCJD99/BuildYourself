import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as createDraft } from '../app/api/v2/goal-drafts/route';
import { POST as confirmDraft } from '../app/api/v2/goal-drafts/[id]/confirm/route';
import { POST as retryGeneration } from '../app/api/v2/goals/[id]/weekly-plans/route';
import { GET as getWeeklyPlan } from '../app/api/v2/weekly-plans/[id]/route';
import { POST as editWeeklyPlan } from '../app/api/v2/weekly-plans/[id]/messages/route';
import { POST as confirmWeeklyPlan } from '../app/api/v2/weekly-plans/[id]/confirm/route';

const { proposeGoalDraft, proposeWeeklyPlan } = vi.hoisted(() => ({
  proposeGoalDraft: vi.fn(),
  proposeWeeklyPlan: vi.fn(),
}));
vi.mock('../lib/goal-draft-agent', () => ({ proposeGoalDraft }));
vi.mock('../lib/weekly-plan-agent', () => ({ proposeWeeklyPlan }));

const directory = mkdtempSync(join(tmpdir(), 'buildyourself-v2-weekly-plans-'));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const proposal = {
  title: '提升英语表达能力',
  description: '能够独立完成英文项目介绍。',
  constraints: { status: 'confirmed', items: ['工作日每天可投入 30 分钟'] },
  attributes: [{ name: '口语表达', description: '英文介绍的流畅度与清晰度' }],
  clarifyingQuestions: [],
};

beforeEach(() => {
  process.env.BUILDYOURSELF_DB = join(directory, `${randomUUID()}.sqlite`);
  proposeGoalDraft.mockClear();
  proposeWeeklyPlan.mockClear();
  proposeGoalDraft.mockResolvedValue({ reply: '已整理目标。', draft: proposal });
  proposeWeeklyPlan.mockImplementation(async ({ goals, currentPlan, message }: {
    goals: Array<{ id: string; attributes: Array<{ id: string }> }>;
    currentPlan: { actions: Array<{ id: string; title: string; date: string; goalIds: string[]; attributeIds: string[] }> } | null;
    message?: string;
  }) => ({
    reply: '已生成本周行动安排。',
    actions: currentPlan?.actions.map(action => ({ ...action, operation: 'update' as const, date: message ? '2026-11-25' : action.date }))
      ?? [{
        operation: 'add' as const,
        title: '准备一段英文项目介绍', description: '写出并练习项目介绍。', date: '2026-11-23',
        goalIds: goals.map(goal => goal.id), attributeIds: goals.flatMap(goal => goal.attributes.map(attribute => attribute.id)),
      }],
  }));
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function enableGoal() {
  const created = await createDraft(new Request('http://localhost/api/v2/goal-drafts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '我想学英语' }),
  }));
  const { draft } = await created.json();
  return confirmDraft(new Request(`http://localhost/api/v2/goal-drafts/${draft.id}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: draft.revision }),
  }), params(draft.id));
}

describe('v0.2 首周规划 HTTP API', () => {
  it('启用目标后生成可回读草稿，自然语言调整产生版本，确认新版本后保留旧安排历史', async () => {
    const enabled = await enableGoal();
    const { goal, weeklyPlanGeneration } = await enabled.json();
    expect(enabled.status).toBe(201);
    expect(weeklyPlanGeneration.status).toBe('ready');
    expect(proposeWeeklyPlan).toHaveBeenCalledOnce();
    const first = weeklyPlanGeneration.plan;
    expect(first).toMatchObject({ revision: 1, status: 'draft' });
    expect(first.actions[0]).toMatchObject({
      title: '准备一段英文项目介绍', goalIds: [goal.id], attributeIds: [goal.attributes[0].id],
    });
    expect(first.actions[0].id).toBeTypeOf('string');

    const firstConfirmed = await confirmWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${first.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: first.revision }),
    }), params(first.id));
    expect(firstConfirmed.status).toBe(200);

    const edited = await editWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${first.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: first.revision, message: '把行动改到周三' }),
    }), params(first.id));
    const { plan: second } = await edited.json();
    expect(edited.status).toBe(200);
    expect(second.revision).toBe(2);
    expect(second.actions[0]).toMatchObject({ id: first.actions[0].id, date: '2026-11-25' });
    expect(second.userMessage).toBe('把行动改到周三');
    const beforeSwitch = await getWeeklyPlan(new Request('http://localhost'), params(first.id));
    expect((await beforeSwitch.json()).activePlan.actions[0]).toMatchObject({ id: first.actions[0].id, date: first.actions[0].date });

    const confirmed = await confirmWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${first.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: second.revision }),
    }), params(first.id));
    expect(confirmed.status).toBe(200);
    const { plan } = await confirmed.json();
    expect(plan).toMatchObject({ activeRevision: 2, revision: 2, status: 'confirmed' });

    const reopened = await getWeeklyPlan(new Request('http://localhost'), params(first.id));
    const { plan: saved, versions } = await reopened.json();
    expect(saved).toMatchObject({ activeRevision: 2 });
    expect(versions.map((version: { revision: number }) => version.revision)).toEqual([1, 2]);
    expect(versions[0].actions[0]).toMatchObject({ id: first.actions[0].id, date: first.actions[0].date });
  });

  it('生成失败可读，并可在原目标上重试', async () => {
    proposeWeeklyPlan.mockRejectedValueOnce(new Error('模型暂时不可用'));
    const enabled = await enableGoal();
    const { goal, weeklyPlanGeneration } = await enabled.json();
    expect(weeklyPlanGeneration).toMatchObject({ status: 'failed', error: expect.any(String) });

    const retried = await retryGeneration(new Request(`http://localhost/api/v2/goals/${goal.id}/weekly-plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    }), params(goal.id));
    expect(retried.status).toBe(200);
    expect((await retried.json()).generation.status).toBe('ready');
    expect(proposeWeeklyPlan).toHaveBeenCalledTimes(2);
    expect(proposeWeeklyPlan.mock.calls[1][0].goals.map((item: { id: string }) => item.id)).toContain(goal.id);
  });

  it('只接受关联目标下的属性，并拒绝过期的编辑版本', async () => {
    const enabled = await enableGoal();
    const { goal, weeklyPlanGeneration } = await enabled.json();
    const first = weeklyPlanGeneration.plan;
    proposeWeeklyPlan.mockResolvedValueOnce({
      reply: '安排已调整。', actions: [{
        operation: 'update', id: first.actions[0].id,
        title: '无效跨目标关联', date: '2026-11-24', goalIds: [goal.id], attributeIds: ['not-an-attribute'],
      }],
    });
    const invalid = await editWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${first.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: first.revision, message: '再改一下' }),
    }), params(first.id));
    expect(invalid.status).toBe(502);

    const stale = await editWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${first.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: first.revision + 1, message: '编辑过期版本' }),
    }), params(first.id));
    expect(stale.status).toBe(409);
  });

  it('一个行动可以关联多个已启用目标及其各自属性', async () => {
    proposeWeeklyPlan.mockImplementation(async ({ goals, currentPlan }: {
      goals: Array<{ id: string; attributes: Array<{ id: string }> }>;
      currentPlan: { actions: Array<{ id: string; title: string; description: string; date: string }> } | null;
    }) => ({
      reply: '已合并两个目标的共同行动。',
      actions: [currentPlan ? {
        ...currentPlan.actions[0], operation: 'update' as const, goalIds: goals.map(goal => goal.id),
        attributeIds: goals.flatMap(goal => goal.attributes.map(attribute => attribute.id)),
      } : {
        operation: 'add' as const,
        title: '准备双语项目介绍', description: '用英语和中文演练项目说明。', date: '2026-11-24',
        goalIds: goals.map(goal => goal.id), attributeIds: goals.flatMap(goal => goal.attributes.map(attribute => attribute.id)),
      }],
    }));
    const firstEnabled = await enableGoal();
    const firstResult = await firstEnabled.json();
    const firstGoal = firstResult.goal;
    const firstPlan = firstResult.weeklyPlanGeneration.plan;
    const initialConfirmation = await confirmWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${firstPlan.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: firstPlan.revision }),
    }), params(firstPlan.id));
    expect((await initialConfirmation.json()).plan.activeRevision).toBe(1);
    const secondEnabled = await enableGoal();
    const secondResult = await secondEnabled.json();
    const secondGoal = secondResult.goal;
    const plan = secondResult.weeklyPlanGeneration.plan;

    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].goalIds).toEqual(expect.arrayContaining([firstGoal.id, secondGoal.id]));
    expect(plan.actions[0].attributeIds).toEqual(expect.arrayContaining([
      firstGoal.attributes[0].id, secondGoal.attributes[0].id,
    ]));
    const beforeConfirm = await getWeeklyPlan(new Request('http://localhost'), params(plan.id));
    expect((await beforeConfirm.json()).activePlan.revision).toBe(1);
    const nextConfirmation = await confirmWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${plan.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: plan.revision }),
    }), params(plan.id));
    const { versions } = await nextConfirmation.json();
    expect(versions.find((item: { revision: number }) => item.revision === 1).status).toBe('superseded');
  });

  it('新增目标的规划结果省略旧行动时仍保留已确认安排', async () => {
    proposeWeeklyPlan.mockImplementationOnce(async ({ goals, weekStart }: {
      goals: Array<{ id: string; attributes: Array<{ id: string }> }>; weekStart: string;
    }) => ({ reply: '已安排原有目标行动。', actions: [{
      operation: 'add' as const,
      title: '原目标练习', description: '保留原安排。', date: weekStart,
      goalIds: [goals[0].id], attributeIds: [goals[0].attributes[0].id],
    }] }));
    const firstEnabled = await enableGoal();
    const firstResult = await firstEnabled.json();
    const firstGoal = firstResult.goal;
    const firstPlan = firstResult.weeklyPlanGeneration.plan;
    const confirmed = await confirmWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${firstPlan.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: firstPlan.revision }),
    }), params(firstPlan.id));
    expect(confirmed.status).toBe(200);

    proposeWeeklyPlan.mockImplementationOnce(async ({ goals, weekStart }: {
      goals: Array<{ id: string; attributes: Array<{ id: string }> }>; weekStart: string;
    }) => {
      const addedGoal = goals.find(goal => goal.id !== firstGoal.id)!;
      return { reply: '为新增目标安排行动。', actions: [{
        operation: 'add' as const,
        title: '新增目标练习', description: '推动新增目标。', date: weekStart,
        goalIds: [addedGoal.id], attributeIds: [addedGoal.attributes[0].id],
      }] };
    });
    const secondEnabled = await enableGoal();
    const secondPlan = (await secondEnabled.json()).weeklyPlanGeneration.plan;

    expect(secondPlan.actions).toHaveLength(2);
    expect(secondPlan.actions.map((action: { id: string }) => action.id)).toContain(firstPlan.actions[0].id);
    const beforeSwitch = await getWeeklyPlan(new Request('http://localhost'), params(firstPlan.id));
    expect((await beforeSwitch.json()).activePlan).toMatchObject({ revision: firstPlan.revision, actions: firstPlan.actions });
  });

  it('Agent 未为新目标提出行动时标记失败，使用同一目标重试后才生成新版本', async () => {
    const firstEnabled = await enableGoal();
    const firstResult = await firstEnabled.json();
    const firstGoal = firstResult.goal;
    const firstPlan = firstResult.weeklyPlanGeneration.plan;
    const initialConfirmation = await confirmWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${firstPlan.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: firstPlan.revision }),
    }), params(firstPlan.id));
    expect(initialConfirmation.status).toBe(200);

    proposeWeeklyPlan.mockImplementationOnce(async ({ goals }: { goals: Array<{ id: string }> }) => {
      const addedGoal = goals.find(goal => goal.id !== firstGoal.id)!;
      return { reply: '将旧行动关联新目标。', actions: [{
        ...firstPlan.actions[0], operation: 'update' as const, id: firstPlan.actions[0].id,
        goalIds: [firstGoal.id, addedGoal.id], attributeIds: [firstGoal.attributes[0].id],
      }] };
    });
    const secondEnabled = await enableGoal();
    const secondResult = await secondEnabled.json();
    const secondGoal = secondResult.goal;
    expect(secondResult.weeklyPlanGeneration.status).toBe('failed');
    expect(secondResult.weeklyPlanGeneration.error).toContain('新启用目标及其属性');
    const beforeRetry = await getWeeklyPlan(new Request('http://localhost'), params(firstPlan.id));
    expect((await beforeRetry.json()).activePlan.revision).toBe(1);

    proposeWeeklyPlan.mockImplementationOnce(async ({ goals, weekStart }: {
      goals: Array<{ id: string; attributes: Array<{ id: string }> }>; weekStart: string;
    }) => {
      const target = goals.find(goal => goal.id === secondGoal.id)!;
      return { reply: '已为新目标增加行动。', actions: [{
        operation: 'add' as const, title: '新增目标专项练习', description: '完成新目标对应的练习。', date: weekStart,
        goalIds: [target.id], attributeIds: [target.attributes[0].id],
      }] };
    });
    const retry = await retryGeneration(new Request(`http://localhost/api/v2/goals/${secondGoal.id}/weekly-plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStart: secondResult.weeklyPlanGeneration.weekStart }),
    }), params(secondGoal.id));
    const retried = await retry.json();

    expect(retry.status).toBe(200);
    expect(retried.plan.revision).toBe(2);
    expect(retried.plan.actions.map((action: { id: string }) => action.id)).toContain(firstPlan.actions[0].id);
    expect(retried.plan.actions.some((action: { goalIds: string[] }) => action.goalIds.includes(secondGoal.id))).toBe(true);
    expect(retried.generation.goalId).toBe(secondGoal.id);
  });

  it('新生成规划必须覆盖所有已启用目标，漏掉先前失败目标时失败且可重试', async () => {
    proposeWeeklyPlan.mockRejectedValueOnce(new Error('首次规划服务不可用'));
    const firstEnabled = await enableGoal();
    const firstResult = await firstEnabled.json();
    const firstGoal = firstResult.goal;
    expect(firstResult.weeklyPlanGeneration.status).toBe('failed');

    proposeWeeklyPlan.mockImplementationOnce(async ({ goals, weekStart }: {
      goals: Array<{ id: string; attributes: Array<{ id: string }> }>; weekStart: string;
    }) => {
      const onlyNewGoal = goals.find(goal => goal.id !== firstGoal.id)!;
      return { reply: '只为新目标安排行动。', actions: [{
        operation: 'add' as const, title: '新增目标专项练习', description: '练习新目标内容。', date: weekStart,
        goalIds: [onlyNewGoal.id], attributeIds: [onlyNewGoal.attributes[0].id],
      }] };
    });
    const secondEnabled = await enableGoal();
    const secondResult = await secondEnabled.json();
    const secondGoal = secondResult.goal;
    expect(secondResult.weeklyPlanGeneration.status).toBe('failed');
    expect(secondResult.weeklyPlanGeneration.error).toContain('每个已启用目标');

    proposeWeeklyPlan.mockImplementationOnce(async ({ goals, weekStart }: {
      goals: Array<{ id: string; attributes: Array<{ id: string }> }>; weekStart: string;
    }) => ({ reply: '已补齐所有目标的首周行动。', actions: goals.map(goal => ({
      operation: 'add' as const, title: `推进：${goal.id}`, description: '首周目标行动。', date: weekStart,
      goalIds: [goal.id], attributeIds: [goal.attributes[0].id],
    })) }));
    const retry = await retryGeneration(new Request(`http://localhost/api/v2/goals/${secondGoal.id}/weekly-plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStart: secondResult.weeklyPlanGeneration.weekStart }),
    }), params(secondGoal.id));
    const retried = await retry.json();

    expect(retry.status).toBe(200);
    expect(retried.generation.status).toBe('ready');
    expect(retried.plan.actions).toHaveLength(2);
    expect(retried.plan.actions.some((action: { goalIds: string[] }) => action.goalIds.includes(firstGoal.id))).toBe(true);
    expect(retried.plan.actions.some((action: { goalIds: string[] }) => action.goalIds.includes(secondGoal.id))).toBe(true);
  });

  it('较早返回的 Agent 编辑结果不能覆盖较新的规划草稿', async () => {
    const enabled = await enableGoal();
    const { plan: first } = (await enabled.json()).weeklyPlanGeneration;
    let releaseFirst!: (value: { reply: string; actions: typeof first.actions }) => void;
    proposeWeeklyPlan
      .mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve; }))
      .mockImplementationOnce(async ({ currentPlan }: { currentPlan: { actions: typeof first.actions } }) => ({
        reply: '较新的调整已生成。', actions: currentPlan.actions.map((action: typeof first.actions[number]) => ({ ...action, operation: 'update' as const, date: '2026-11-26' })),
      }));
    const request = (message: string) => new Request(`http://localhost/api/v2/weekly-plans/${first.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: first.revision, message }),
    });
    const earlier = editWeeklyPlan(request('较早发出的请求'), params(first.id));
    const laterResponse = await editWeeklyPlan(request('较晚发出的请求'), params(first.id));
    const later = await laterResponse.json();
    releaseFirst({ reply: '旧调整返回。', actions: first.actions.map((action: typeof first.actions[number]) => ({ ...action, operation: 'update' as const, date: '2026-11-24' })) });
    const earlierResponse = await earlier;

    expect(laterResponse.status).toBe(200);
    expect(later.plan.revision).toBe(2);
    expect(earlierResponse.status).toBe(409);
    const saved = await getWeeklyPlan(new Request('http://localhost'), params(first.id));
    expect((await saved.json()).plan.actions[0].date).toBe('2026-11-26');
  });

  it('较早返回的重新生成结果不能覆盖较新的规划草稿', async () => {
    const enabled = await enableGoal();
    const { goal, weeklyPlanGeneration } = await enabled.json();
    const first = weeklyPlanGeneration.plan;
    let releaseFirst!: (value: { reply: string; actions: typeof first.actions }) => void;
    proposeWeeklyPlan
      .mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve; }))
      .mockImplementationOnce(async ({ currentPlan }: { currentPlan: { actions: typeof first.actions } }) => ({
        reply: '较新的规划已生成。', actions: currentPlan.actions.map((action: typeof first.actions[number]) => ({ ...action, operation: 'update' as const, date: '2026-11-27' })),
      }));
    const request = () => new Request(`http://localhost/api/v2/goals/${goal.id}/weekly-plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekStart: weeklyPlanGeneration.weekStart }),
    });
    const earlier = retryGeneration(request(), params(goal.id));
    const later = await retryGeneration(request(), params(goal.id));
    releaseFirst({ reply: '旧规划返回。', actions: first.actions.map((action: typeof first.actions[number]) => ({ ...action, operation: 'update' as const, date: '2026-11-24' })) });
    const earlierResponse = await earlier;
    const latest = await getWeeklyPlan(new Request('http://localhost'), params(first.id));

    expect(later.status).toBe(200);
    expect(earlierResponse.status).toBe(409);
    expect((await latest.json()).plan.actions[0].date).toBe('2026-11-27');
  });

  it('模型临时 ID 或遗漏的 ID 都不能把旧行动修改静默变成新增', async () => {
    proposeWeeklyPlan.mockImplementationOnce(async ({ goals, weekStart }: {
      goals: Array<{ id: string; attributes: Array<{ id: string }> }>; weekStart: string;
    }) => ({ reply: '安排两次练习。', actions: [1, 2].map(() => ({
      operation: 'add' as const,
      title: '练习英文介绍', description: '口头练习。', date: weekStart,
      goalIds: goals.map(goal => goal.id), attributeIds: goals.flatMap(goal => goal.attributes.map(attribute => attribute.id)),
    })) }));
    const enabled = await enableGoal();
    const first = (await enabled.json()).weeklyPlanGeneration.plan;
    expect(first.actions).toHaveLength(2);
    expect(first.actions[0].id).not.toBe(first.actions[1].id);
    proposeWeeklyPlan.mockResolvedValueOnce({ reply: '已调整。', actions: first.actions.map((action: typeof first.actions[number], index: number) => ({
      ...action, operation: 'update' as const, id: `temporary-${index}`, date: '2026-11-24',
    })) });

    const response = await editWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${first.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: first.revision, message: '调整两次练习日期' }),
    }), params(first.id));
    expect(response.status).toBe(502);

    proposeWeeklyPlan.mockResolvedValueOnce({ reply: '已改名。', actions: [{
      operation: 'update', id: undefined, title: '改名后的练习', description: '修改旧行动。', date: '2026-11-24',
      goalIds: first.actions[0].goalIds, attributeIds: first.actions[0].attributeIds,
    }] });
    const missingId = await editWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${first.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: first.revision, message: '修改行动名称' }),
    }), params(first.id));
    expect(missingId.status).toBe(502);
    const reopened = await getWeeklyPlan(new Request('http://localhost'), params(first.id));
    expect((await reopened.json()).plan.revision).toBe(first.revision);
  });

  it('自然语言只调整一个行动时保留其他未提及行动', async () => {
    proposeWeeklyPlan.mockImplementationOnce(async ({ goals, weekStart }: {
      goals: Array<{ id: string; attributes: Array<{ id: string }> }>; weekStart: string;
    }) => ({ reply: '已安排两项行动。', actions: ['练习英文介绍', '收听英文播客'].map(title => ({
      operation: 'add' as const,
      title, description: title, date: weekStart,
      goalIds: goals.map(goal => goal.id), attributeIds: goals.flatMap(goal => goal.attributes.map(attribute => attribute.id)),
    })) }));
    const enabled = await enableGoal();
    const first = (await enabled.json()).weeklyPlanGeneration.plan;
    const changed = first.actions[0];
    const omitted = first.actions[1];
    proposeWeeklyPlan.mockResolvedValueOnce({ reply: '已将练习改到周三。', actions: [{
      ...changed, operation: 'update' as const, date: '2026-11-25',
    }] });

    const response = await editWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${first.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: first.revision, message: '把练习英文介绍改到周三' }),
    }), params(first.id));
    const revised = (await response.json()).plan;

    expect(response.status).toBe(200);
    expect(revised.actions).toHaveLength(2);
    expect(revised.actions).toContainEqual({ ...changed, date: '2026-11-25' });
    expect(revised.actions).toContainEqual(omitted);
  });

  it('Agent 只回复无需调整时接受空变更并保留完整安排', async () => {
    const enabled = await enableGoal();
    const first = (await enabled.json()).weeklyPlanGeneration.plan;
    proposeWeeklyPlan.mockResolvedValueOnce({ reply: '当前安排已经符合要求。', actions: [] });

    const response = await editWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${first.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: first.revision, message: '确认一下现在的安排，无需改变' }),
    }), params(first.id));
    const revised = (await response.json()).plan;

    expect(response.status).toBe(200);
    expect(revised.actions).toEqual(first.actions);
    expect(revised.userMessage).toBe('确认一下现在的安排，无需改变');
  });

  it('旧行动明确沿用 ID 时允许新增同名行动且分配新 ID', async () => {
    proposeWeeklyPlan.mockImplementationOnce(async ({ goals, weekStart }: {
      goals: Array<{ id: string; attributes: Array<{ id: string }> }>; weekStart: string;
    }) => ({ reply: '已安排一次练习。', actions: [{
      operation: 'add' as const,
      title: '练习英文介绍', description: '原行动。', date: weekStart,
      goalIds: goals.map(goal => goal.id), attributeIds: goals.flatMap(goal => goal.attributes.map(attribute => attribute.id)),
    }] }));
    const enabled = await enableGoal();
    const first = (await enabled.json()).weeklyPlanGeneration.plan;
    const original = first.actions[0];
    proposeWeeklyPlan.mockResolvedValueOnce({ reply: '保留原行动并新增一次练习。', actions: [
      { ...original, operation: 'update' as const },
      { ...original, operation: 'add' as const, id: undefined, description: '新增行动。', date: '2026-11-26' },
    ] });

    const response = await editWeeklyPlan(new Request(`http://localhost/api/v2/weekly-plans/${first.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: first.revision, message: '再加一次同名练习' }),
    }), params(first.id));
    const revised = (await response.json()).plan;

    expect(response.status).toBe(200);
    expect(revised.actions).toHaveLength(2);
    expect(revised.actions.map((action: { id: string }) => action.id)).toContain(original.id);
    expect(new Set(revised.actions.map((action: { id: string }) => action.id)).size).toBe(2);
  });
});
