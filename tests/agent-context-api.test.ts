import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET as getAgentContext, POST as postAgentContext } from '../app/api/agent-context/route';
import { POST as postAgentDiscussion } from '../app/api/agent-discussion/route';
import {
  activateGoalPlan,
  getGoalPlan,
  listGoalPlanActions,
  listGoalPlanContractChanges,
  saveGoalPlanDraft,
} from '../lib/goal-plans';
import { getContext } from '../lib/store';

const directory = mkdtempSync(join(tmpdir(), 'buildyourself-agent-context-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(directory, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function completePlan(title: string) {
  return {
    sourceIntent: `我想完成${title}`,
    title,
    domain: 'learning' as const,
    domainTemplate: { id: 'learning', version: '1.0.0' },
    context: '真实工作场景',
    successDescription: '能独立完成一次可核对的英文演示。',
    observableResult: '提交演示录像并获得课程平台反馈。',
    baselineStatus: 'known' as const,
    baselineAction: null,
    milestones: [{
      title: '完成演示', stage: 'near' as const,
      successCriteria: '提交一段完整的英文演示录像。',
      standardAssessment: 'reasonable' as const,
      evidenceAvailability: 'available' as const,
      reviewNote: '录像和平台反馈均可保存。',
      evidenceRequirement: 'E2 平台提交记录。',
    }],
    nextActions: [{
      title: '录制演示', details: '按课程要求准备并录制。',
      estimateMinutes: 30, specificity: 'concrete' as const,
    }],
    constraints: { status: 'confirmed' as const, items: [] },
    evidenceRequirements: [{ item: '演示录像', description: '保存平台提交记录。', minimumLevel: 'E2' as const }],
    reviewCycleDays: 7,
  };
}

function activeGoal(title: string) {
  const draft = saveGoalPlanDraft(completePlan(title));
  return activateGoalPlan(draft.id, { confirmed: true, reviewedAt: draft.updatedAt });
}

describe('共享 Agent 上下文 API', () => {
  it('保存具体行动上下文，并让普通讨论读取该层级的执行图谱', async () => {
    const goal = activeGoal('英语展示');
    const action = listGoalPlanActions(goal.id)[0];
    const contextResponse = await postAgentContext(new Request('http://localhost/api/agent-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layer: 'task', goalPlanId: goal.id, actionId: action.id }),
    }));

    expect(contextResponse.status).toBe(200);
    expect(getContext()).toBe('task');
    expect(await (await getAgentContext()).json()).toMatchObject({
      context: {
        layer: 'task',
        title: action.title,
        breadcrumb: `目标组合 / ${goal.title} / ${action.title}`,
        goalPlanId: goal.id,
        actionId: action.id,
        graphNodeId: 'task',
      },
    });

    const discussion = await postAgentDiscussion(new Request('http://localhost/api/agent-discussion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我现在最应该做什么？' }),
    }));
    const body = await discussion.json();

    expect(discussion.status).toBe(200);
    expect(body.context).toMatchObject({ layer: 'task', actionId: action.id });
    expect(body.reply).toContain(action.title);
    expect(body.reply).toContain('E2 平台提交记录');
    expect(body.confirmation).toEqual({ required: false, kind: null, title: null, detail: null, nextStep: null });
  });

  it('将修改成功标准的建议交给现有契约确认流，不在讨论中直接改权威状态', async () => {
    const goal = activeGoal('英语展示');
    await postAgentContext(new Request('http://localhost/api/agent-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layer: 'goal', goalPlanId: goal.id }),
    }));

    const response = await postAgentDiscussion(new Request('http://localhost/api/agent-discussion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '把成功标准改成每周都交付一次演示。' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.confirmation).toMatchObject({
      required: true,
      kind: 'contract_change',
      title: '目标契约变更确认',
    });
    expect(body.confirmation.detail).toContain('确认前不会生效');
    expect(body.confirmation.nextStep).toContain('propose_change');
    expect(getGoalPlan(goal.id)?.successDescription).toBe(goal.successDescription);
    expect(getGoalPlan(goal.id)?.contractVersion).toBe(1);
    expect(listGoalPlanContractChanges(goal.id)).toEqual([]);
  });

  it('拒绝跨目标的行动上下文，并保留原讨论对象', async () => {
    const first = activeGoal('目标一');
    const second = activeGoal('目标二');
    const secondAction = listGoalPlanActions(second.id)[0];
    await postAgentContext(new Request('http://localhost/api/agent-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layer: 'goal', goalPlanId: first.id }),
    }));

    const response = await postAgentContext(new Request('http://localhost/api/agent-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layer: 'task', goalPlanId: first.id, actionId: secondAction.id }),
    }));

    expect(response.status).toBe(400);
    expect(await (await getAgentContext()).json()).toMatchObject({
      context: { layer: 'goal', goalPlanId: first.id, title: first.title },
    });
  });

  it('按修订号忽略迟到的旧上下文写入，并让讨论上下文保持只读', async () => {
    const first = activeGoal('目标一');
    const second = activeGoal('目标二');
    await postAgentContext(new Request('http://localhost/api/agent-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selection: { layer: 'goal', goalPlanId: first.id }, revision: 20 }),
    }));
    const discussion = await postAgentDiscussion(new Request('http://localhost/api/agent-discussion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '这个目标接下来做什么？',
        context: { layer: 'goal', goalPlanId: second.id },
      }),
    }));
    expect(await discussion.json()).toMatchObject({
      context: { layer: 'goal', goalPlanId: second.id, title: second.title },
    });
    expect(await (await getAgentContext()).json()).toMatchObject({
      context: { layer: 'goal', goalPlanId: first.id, title: first.title },
    });

    const stale = await postAgentContext(new Request('http://localhost/api/agent-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selection: { layer: 'goal', goalPlanId: second.id }, revision: 10 }),
    }));

    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({
      context: { layer: 'goal', goalPlanId: first.id, title: first.title },
    });
  });

  it('为旧证据判定图谱的节点保留独立讨论上下文', async () => {
    const response = await postAgentContext(new Request('http://localhost/api/agent-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layer: 'graph', graphNodeId: 'milestone' }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      context: {
        layer: 'graph',
        title: '响应延迟低于 200 ms',
        breadcrumb: '目标组合 / 证据判定图谱 / 里程碑：响应延迟低于 200 ms',
        graphNodeId: 'milestone',
      },
    });
  });

  it('同一请求包含多种高影响变更时保留全部确认路径', async () => {
    const goal = activeGoal('英语展示');
    const response = await postAgentDiscussion(new Request('http://localhost/api/agent-discussion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '把成功标准改高，并登记老师新发的周五提交通知。',
        context: { layer: 'goal', goalPlanId: goal.id },
      }),
    }));
    const body = await response.json();

    expect(body.confirmation).toMatchObject({ required: true, title: '多重确认' });
    expect(body.confirmation.detail).toContain('目标契约变更流程');
    expect(body.confirmation.detail).toContain('外部承诺流程');
    expect(body.confirmation.nextStep).toContain('propose_change');
    expect(body.confirmation.nextStep).toContain('/commitment');
  });
});
