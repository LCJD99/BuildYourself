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

  it('重排时保留仍有容量且不违反截止和依赖的原日期', () => {
    const plan = generateWeeklyPlan({
      weekStart: '2026-11-09',
      capacities: { '2026-11-09': 60, '2026-11-10': 60, '2026-11-11': 60 },
      preferredDates: { prepare: '2026-11-10', submit: '2026-11-11' },
      actions: [
        action({ id: 'prepare', hardDeadline: '2026-11-11' }),
        action({ id: 'submit', dependsOn: ['prepare'], hardDeadline: '2026-11-12' }),
      ],
    });

    expect(plan.days[1].actions.map(item => item.actionId)).toEqual(['prepare']);
    expect(plan.days[2].actions.map(item => item.actionId)).toEqual(['submit']);
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

  it('按明确的目标恢复日阻止该目标训练，同时保留杂项硬截止任务', () => {
    const plan = generateWeeklyPlan({
      weekStart: '2026-11-09',
      capacities: { '2026-11-09': 120 },
      recoveryConstraints: [{ goalPlanId: 'fitness-goal', goalTitle: '长期健身', date: '2026-11-09', reason: '训练后安排恢复日' }],
      actions: [
        action({ id: 'training', goalPlanId: 'fitness-goal', goalTitle: '长期健身', title: '力量训练', hardDeadline: '2026-11-09', estimateMinutes: 60 }),
        action({ id: 'misc:report', goalPlanId: 'misc:report', goalTitle: '杂项', title: '提交项目报告', hardDeadline: '2026-11-09', estimateMinutes: 60, priority: 'high' }),
      ],
    });

    expect(plan.days[0].actions.map(item => item.actionId)).toEqual(['misc:report']);
    expect(plan.unplaced).toMatchObject([{ action: { id: 'training', hardDeadline: '2026-11-09' }, reason: expect.stringContaining('恢复约束') }]);
    expect(plan.recoveryConstraints).toEqual([{ goalPlanId: 'fitness-goal', goalTitle: '长期健身', date: '2026-11-09', reason: '训练后安排恢复日' }]);
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
