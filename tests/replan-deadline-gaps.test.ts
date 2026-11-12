import { describe, expect, it } from 'vitest';
import { calculateReplanDeadlineGaps } from '../lib/replanning';
import type { PlannerAction, WeeklyPlan } from '../lib/daily-planner';

const action = (overrides: Partial<PlannerAction> = {}): PlannerAction => ({
  id: 'task-a', goalPlanId: 'goal-a', goalTitle: '目标 A', title: '行动 A', details: null,
  estimateMinutes: 60, priority: 'high', hardDeadline: '2026-11-10', milestoneId: null,
  milestoneTitle: null, milestoneCriteria: null, dependsOn: [], createdAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
});

function plan(options: {
  freeMinutes?: Partial<Record<string, number>>;
  placed?: Array<{ actionId: string; date: string; minutes: number }>;
  unplaced?: PlannerAction[];
  recoveryConstraints?: WeeklyPlan['recoveryConstraints'];
} = {}): WeeklyPlan {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = `2026-11-${String(9 + index).padStart(2, '0')}`;
    const remaining = options.freeMinutes?.[date] ?? 0;
    const actions = (options.placed ?? []).filter(item => item.date === date).map(item => ({
      ...action({ id: item.actionId, hardDeadline: null, estimateMinutes: item.minutes }),
      actionId: item.actionId, estimateMinutes: item.minutes, estimateIsDefault: false,
    }));
    const usedMinutes = actions.reduce((sum, item) => sum + item.estimateMinutes, 0);
    return {
      date, capacityMinutes: usedMinutes + remaining, capacityIsDefault: false, usedMinutes, actions,
    };
  });
  return {
    weekStart: '2026-11-09', days,
    unplaced: (options.unplaced ?? []).map(item => ({ action: item, reason: '容量不足' })),
    recoveryConstraints: options.recoveryConstraints ?? [],
  };
}

describe('重排硬截止容量影响', () => {
  it('对不可拆分的单项任务，用最大单日剩余容量计算最低新增容量而非任务总时长', () => {
    const gaps = calculateReplanDeadlineGaps(plan({
      freeMinutes: { '2026-11-09': 40, '2026-11-10': 30 },
      unplaced: [action({ hardDeadline: '2026-11-10', estimateMinutes: 60 })],
    }));

    expect(gaps).toMatchObject([{
      deadline: '2026-11-10', unplacedWorkMinutes: 60, availableCapacityMinutes: 70,
      maxSingleDayCapacityMinutes: 40, requiredAdditionalCapacityMinutes: 20,
      calculation: 'exact', workloadHasDefaultEstimate: false,
    }]);
  });

  it('任务时长或容量采用默认值时，把可计算的缺口标为估算', () => {
    const gap = calculateReplanDeadlineGaps(plan({
      freeMinutes: { '2026-11-09': 0 },
      unplaced: [action({ hardDeadline: '2026-11-09', estimateMinutes: null })],
    }))[0];
    expect(gap).toMatchObject({ unplacedWorkMinutes: 30, workloadHasDefaultEstimate: true, calculation: 'estimate', requiredAdditionalCapacityMinutes: 30 });

    const defaultCapacityPlan = plan({ unplaced: [action({ hardDeadline: '2026-11-09', estimateMinutes: 60 })] });
    defaultCapacityPlan.days[0].capacityIsDefault = true;
    const defaultCapacityGap = calculateReplanDeadlineGaps(defaultCapacityPlan)[0];
    expect(defaultCapacityGap.calculation).toBe('estimate');
    expect(defaultCapacityGap.capacityHasDefaultValue).toBe(true);
  });

  it('把多个截止日分开显示，并在多项任务争用容量时不伪报精确缺口', () => {
    const gaps = calculateReplanDeadlineGaps(plan({
      freeMinutes: { '2026-11-09': 40, '2026-11-10': 50 },
      unplaced: [
        action({ id: 'early', title: '周一交付', estimateMinutes: 60, hardDeadline: '2026-11-09' }),
        action({ id: 'later', title: '周二交付', estimateMinutes: 30, hardDeadline: '2026-11-10' }),
      ],
    }));

    expect(gaps).toMatchObject([
      { deadline: '2026-11-09', unplacedWorkMinutes: 60, requiredAdditionalCapacityMinutes: 20, calculation: 'exact' },
      { deadline: '2026-11-10', unplacedWorkMinutes: 30, availableCapacityMinutes: 90, requiredAdditionalCapacityMinutes: null, calculation: 'unknown' },
    ]);
  });

  it('排除恢复日容量，并在依赖未安排或没有合法恢复窗口时标记不可确定', () => {
    const recoveryGap = calculateReplanDeadlineGaps(plan({
      freeMinutes: { '2026-11-09': 100, '2026-11-10': 40 },
      recoveryConstraints: [{ goalPlanId: 'goal-a', goalTitle: '目标 A', date: '2026-11-09', reason: '恢复日' }],
      unplaced: [action({ hardDeadline: '2026-11-10', estimateMinutes: 60 })],
    }))[0];
    expect(recoveryGap).toMatchObject({ availableCapacityMinutes: 40, maxSingleDayCapacityMinutes: 40, requiredAdditionalCapacityMinutes: 20, calculation: 'exact' });

    const dependencyGap = calculateReplanDeadlineGaps(plan({
      freeMinutes: { '2026-11-09': 100, '2026-11-10': 100 },
      unplaced: [action({ hardDeadline: '2026-11-10', dependsOn: ['not-scheduled'] })],
    }))[0];
    expect(dependencyGap).toMatchObject({ availableCapacityMinutes: null, requiredAdditionalCapacityMinutes: null, calculation: 'unknown' });

    const noRecoveryDate = calculateReplanDeadlineGaps(plan({
      freeMinutes: { '2026-11-09': 100 },
      recoveryConstraints: [{ goalPlanId: 'goal-a', goalTitle: '目标 A', date: '2026-11-09', reason: '恢复日' }],
      unplaced: [action({ hardDeadline: '2026-11-09', estimateMinutes: 60 })],
    }))[0];
    expect(noRecoveryDate).toMatchObject({ availableCapacityMinutes: 0, requiredAdditionalCapacityMinutes: null, calculation: 'unknown' });
  });
});
