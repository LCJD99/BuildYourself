import { describe, expect, it } from 'vitest';
import { generateWeeklyPlan, type PlannerAction } from '../lib/daily-planner';

const action = (overrides: Partial<PlannerAction> = {}): PlannerAction => ({
  id: 'task-a',
  goalPlanId: 'goal-a',
  goalTitle: '目标 A',
  title: '行动 A',
  details: null,
  estimateMinutes: 60,
  priority: 'medium',
  hardDeadline: null,
  milestoneId: 'milestone-a',
  milestoneTitle: '里程碑 A',
  milestoneCriteria: '达到里程碑 A 的标准',
  dependsOn: [],
  createdAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
});

describe('日级计划生成', () => {
  it('相同输入生成稳定结果，并默认每天 240 分钟容量', () => {
    const input = { weekStart: '2026-11-09', actions: [action({ id: 'b' }), action({ id: 'a' })] };
    const first = generateWeeklyPlan(input);
    const second = generateWeeklyPlan(input);

    expect(first).toEqual(second);
    expect(first.days).toHaveLength(7);
    expect(first.days[0]).toMatchObject({ date: '2026-11-09', capacityMinutes: 240, capacityIsDefault: true });
    expect(first.days[0].actions.map(item => item.actionId)).toEqual(['a', 'b']);
  });

  it('依赖先于后续行动，并在硬截止范围内安排高优先级任务', () => {
    const plan = generateWeeklyPlan({
      weekStart: '2026-11-09',
      capacities: { '2026-11-09': 120, '2026-11-10': 120 },
      actions: [
        action({ id: 'follow-up', title: '后续行动', dependsOn: ['prep'], hardDeadline: '2026-11-10' }),
        action({ id: 'prep', title: '准备材料', hardDeadline: '2026-11-09', priority: 'low' }),
      ],
    });

    expect(plan.days[0].actions.map(item => item.actionId)).toEqual(['prep']);
    expect(plan.days[1].actions.map(item => item.actionId)).toEqual(['follow-up']);
    expect(plan.unplaced).toEqual([]);
  });

  it('标记默认时长，并说明容量或截止导致的未安排事项', () => {
    const plan = generateWeeklyPlan({
      weekStart: '2026-11-09',
      capacities: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`2026-11-${String(9 + index).padStart(2, '0')}`, 0])),
      actions: [
        action({ id: 'default-estimate', estimateMinutes: null }),
        action({ id: 'late', estimateMinutes: 30, hardDeadline: '2026-11-08' }),
      ],
    });

    expect(plan.unplaced.find(item => item.action.id === 'late')?.reason).toContain('硬截止');
    expect(plan.unplaced.find(item => item.action.id === 'default-estimate')?.reason).toContain('容量');
    const normal = generateWeeklyPlan({ weekStart: '2026-11-09', actions: [action({ estimateMinutes: null })] });
    expect(normal.days[0].actions[0]).toMatchObject({ estimateMinutes: 30, estimateIsDefault: true });
  });

  it('把未知依赖和循环依赖明确列为阻塞', () => {
    const plan = generateWeeklyPlan({
      weekStart: '2026-11-09',
      actions: [
        action({ id: 'unknown', dependsOn: ['missing'] }),
        action({ id: 'cycle-a', dependsOn: ['cycle-b'] }),
        action({ id: 'cycle-b', dependsOn: ['cycle-a'] }),
      ],
    });

    expect(plan.unplaced).toHaveLength(3);
    expect(plan.unplaced.map(item => item.reason).join(' ')).toContain('依赖');
  });
});
