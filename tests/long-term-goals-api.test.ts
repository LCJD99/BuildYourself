import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { POST as postGoal } from '../app/api/goals/route';
import { POST as postAction, GET as getActions } from '../app/api/actions/route';
import { POST as postFeedback } from '../app/api/action-feedback/route';
import { GET as getCalendar } from '../app/api/action-calendar/route';

const directory = mkdtempSync(join('/tmp', 'buildyourself-v2-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(directory, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

describe('长期目标与行动 v0.2 API', () => {
  it('确认目标后支持共享行动、属性查询和自然语言反馈', async () => {
    const goalA = await json(await postGoal(new Request('http://localhost/api/goals', {
      method: 'POST', body: JSON.stringify({ intent: '学习和锻炼', title: '持续成长', attributes: [{ title: '学习' }] }),
    })));
    const goalB = await json(await postGoal(new Request('http://localhost/api/goals', {
      method: 'POST', body: JSON.stringify({ intent: '学习和锻炼', title: '身体状态', attributes: [{ title: '体能' }] }),
    })));
    const confirmedA = await json(await postGoal(new Request('http://localhost/api/goals', {
      method: 'POST', body: JSON.stringify({ action: 'confirm', id: goalA.goal.id }),
    })));
    const confirmedB = await json(await postGoal(new Request('http://localhost/api/goals', {
      method: 'POST', body: JSON.stringify({ action: 'confirm', id: goalB.goal.id }),
    })));
    const action = await json(await postAction(new Request('http://localhost/api/actions', {
      method: 'POST',
      body: JSON.stringify({
        title: '晨读并散步', source: 'planned', date: '2026-11-18',
        goalIds: [confirmedA.goal.id, confirmedB.goal.id],
        attributeIds: [confirmedA.goal.attributes[0].id, confirmedB.goal.attributes[0].id],
      }),
    })));
    expect(action.action.goalIds).toHaveLength(2);
    const feedback = await json(await postFeedback(new Request('http://localhost/api/action-feedback', {
      method: 'POST', body: JSON.stringify({
        actionId: action.action.id, rawFeedback: '完成了 30 分钟，其中阅读 20 分钟',
        completion: 0.5, confidence: 0.8, agentFeedback: '已完成一半，继续保持。',
        contributions: [
          { goalId: confirmedA.goal.id, attributeId: confirmedA.goal.attributes[0].id, amount: 0.6 },
          { goalId: confirmedB.goal.id, attributeId: confirmedB.goal.attributes[0].id, amount: 0.4 },
        ],
      }),
    })));
    expect(feedback.assessment.contributions).toHaveLength(2);
    const goals = await json(await (await import('../app/api/goals/route')).GET());
    expect(goals.goals.flatMap(goal => goal.attributes).map(attribute => attribute.progress)).toEqual([0.24, 0.16]);
  });

  it('月度日期与单日行动一致，并且跨周重复评估不重复计入', async () => {
    const goal = await json(await postGoal(new Request('http://localhost/api/goals', {
      method: 'POST', body: JSON.stringify({ intent: '写作', title: '完成作品', attributes: [{ title: '产出' }] }),
    })));
    await postGoal(new Request('http://localhost/api/goals', { method: 'POST', body: JSON.stringify({ action: 'confirm', id: goal.goal.id }) }));
    const action = await json(await postAction(new Request('http://localhost/api/actions', {
      method: 'POST', body: JSON.stringify({
        title: '写一段', source: 'planned', date: '2026-11-20',
        goalIds: [goal.goal.id], attributeIds: [goal.goal.attributes[0].id],
      }),
    })));
    const month = await json(getCalendar(new Request('http://localhost/api/action-calendar?month=2026-11')));
    const day = await json(getCalendar(new Request('http://localhost/api/action-calendar?month=2026-11&date=2026-11-20')));
    expect(month.dates).toContain('2026-11-20');
    expect(day.actions.map(item => item.id)).toContain(action.action.id);
    const body = {
      actionId: action.action.id, rawFeedback: '写了一半', completion: 0.5, confidence: 1,
      agentFeedback: '部分完成', contributions: [{ goalId: goal.goal.id, attributeId: goal.goal.attributes[0].id, amount: 1 }],
    };
    await postFeedback(new Request('http://localhost/api/action-feedback', { method: 'POST', body: JSON.stringify(body) }));
    await postFeedback(new Request('http://localhost/api/action-feedback', { method: 'POST', body: JSON.stringify(body) }));
    const goals = await json(await (await import('../app/api/goals/route')).GET());
    expect(goals.goals[0].attributes[0].progress).toBe(0.5);
  });

  it('没有属性收益的计划外记录进入杂项', async () => {
    const action = await json(await postAction(new Request('http://localhost/api/actions', {
      method: 'POST', body: JSON.stringify({ title: '临时刷视频', source: 'unplanned' }),
    })));
    const response = await json(await postFeedback(new Request('http://localhost/api/action-feedback', {
      method: 'POST', body: JSON.stringify({
        actionId: action.action.id, rawFeedback: '今天临时刷了视频',
        completion: 1, confidence: 1, agentFeedback: '未发现目标属性收益。', contributions: [],
      }),
    })));
    expect(response.assessment.miscellaneousId).toBeTypeOf('string');
  });
});
