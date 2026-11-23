import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFile, stdinEnd } = vi.hoisted(() => ({ execFile: vi.fn(), stdinEnd: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));

import { proposeWeeklyPlan } from '../lib/weekly-plan-agent';

const existing = {
  id: 'existing-action-1', title: '准备英文介绍', description: '练习已有安排。', date: '2026-11-24',
  goalIds: ['goal-1'], attributeIds: ['attribute-1'],
};
const goals = [{
  id: 'goal-1', sourceDraftId: 'draft-1', sourceIntent: '学英语', title: '提升英语',
  description: '能够用英语交流。', constraints: { status: 'confirmed' as const, items: [] },
  attributes: [{ id: 'attribute-1', name: '口语', description: '口语清晰度', progress: 0 }],
  state: 'enabled' as const, createdAt: '2026-11-23T00:00:00.000Z',
}];

function provide(result: unknown) {
  execFile.mockImplementation((_command, _args, _options, callback) => {
    callback(null, JSON.stringify(result), '');
    return { stdin: { end: stdinEnd } };
  });
}

beforeEach(() => {
  delete process.env.BUILDYOURSELF_PI_BIN;
  delete process.env.BUILDYOURSELF_AGENT_MODEL;
  execFile.mockReset();
  stdinEnd.mockReset();
});

describe('v0.2 每周规划 PI 适配器', () => {
  it('新增行动的陌生临时 ID 会被丢弃并由服务端重新分配', async () => {
    provide({ reply: '安排一次新练习。', actions: [{
      operation: 'add', id: 'provider-temporary-id', title: '练习听力', description: '听英语播客。',
      date: '2026-11-25', goalIds: ['goal-1'], attributeIds: ['attribute-1'],
    }] });

    const result = await proposeWeeklyPlan({ weekStart: '2026-11-23', goals, currentPlan: { actions: [existing] }, focusGoalId: 'goal-1' });

    expect(result.actions[0]).not.toHaveProperty('id');
    expect(result.actions[0].operation).toBe('add');
    expect(stdinEnd).toHaveBeenCalledOnce();
    const prompt = JSON.parse(String(execFile.mock.calls[0][1].at(-1)));
    expect(prompt).toMatchObject({ task: 'add_goal_to_weekly_plan', focusGoalId: 'goal-1' });
  });

  it('不允许新增操作复用当前规划中的旧行动 ID', async () => {
    provide({ reply: '更新行动。', actions: [{
      operation: 'add', id: existing.id, title: existing.title, description: existing.description,
      date: existing.date, goalIds: existing.goalIds, attributeIds: existing.attributeIds,
    }] });

    await expect(proposeWeeklyPlan({ weekStart: '2026-11-23', goals, currentPlan: { actions: [existing] } }))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining('不能复用') });
  });

  it('修改操作必须引用当前版本的精确行动 ID', async () => {
    provide({ reply: '日期已调整。', actions: [{
      operation: 'update', id: 'stale-or-unknown-id', title: existing.title, description: existing.description,
      date: '2026-11-26', goalIds: existing.goalIds, attributeIds: existing.attributeIds,
    }] });

    await expect(proposeWeeklyPlan({ weekStart: '2026-11-23', goals, currentPlan: { actions: [existing] }, message: '改到周四' }))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining('有效旧行动 ID') });
  });

  it('拒绝同时提供 ID 别名，防止一个字段掩盖另一个行动身份', async () => {
    provide({ reply: '已调整日期。', actions: [{
      operation: 'update', id: existing.id, actionId: 'different-or-temporary-id',
      title: existing.title, description: existing.description, date: '2026-11-26',
      goalIds: existing.goalIds, attributeIds: existing.attributeIds,
    }] });

    await expect(proposeWeeklyPlan({ weekStart: '2026-11-23', goals, currentPlan: { actions: [existing] }, message: '改到周四' }))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining('无法识别的字段') });
  });
});
