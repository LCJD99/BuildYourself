export type ActionPriority = 'high' | 'medium' | 'low';

export type PlannerAction = {
  id: string;
  goalPlanId: string;
  goalTitle: string;
  title: string;
  details: string | null;
  estimateMinutes: number | null;
  priority: ActionPriority;
  hardDeadline: string | null;
  milestoneId: string | null;
  milestoneTitle: string | null;
  milestoneCriteria: string | null;
  dependsOn: string[];
  createdAt: string;
};

export type PlannedAction = PlannerAction & {
  actionId: string;
  estimateMinutes: number;
  estimateIsDefault: boolean;
};

export type WeeklyPlanDay = {
  date: string;
  capacityMinutes: number;
  capacityIsDefault: boolean;
  usedMinutes: number;
  actions: PlannedAction[];
};

export type WeeklyPlan = {
  weekStart: string;
  days: WeeklyPlanDay[];
  unplaced: Array<{ action: PlannerAction; reason: string }>;
};

const DEFAULT_CAPACITY_MINUTES = 240;
const DEFAULT_ESTIMATE_MINUTES = 30;
const priorityRank: Record<ActionPriority, number> = { high: 0, medium: 1, low: 2 };

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function addDays(value: string, amount: number): string {
  const date = parseDate(value);
  if (!date) throw new Error('周起始日期必须是有效的 YYYY-MM-DD 日期。');
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function compareActions(a: PlannerAction, b: PlannerAction): number {
  const deadlineA = a.hardDeadline ?? '9999-12-31';
  const deadlineB = b.hardDeadline ?? '9999-12-31';
  return deadlineA.localeCompare(deadlineB)
    || priorityRank[a.priority] - priorityRank[b.priority]
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id);
}

export function generateWeeklyPlan(input: {
  weekStart: string;
  actions: PlannerAction[];
  capacities?: Record<string, number>;
}): WeeklyPlan {
  if (!parseDate(input.weekStart)) throw new Error('周起始日期必须是有效的 YYYY-MM-DD 日期。');
  if (new Set(input.actions.map(action => action.id)).size !== input.actions.length) throw new Error('待排行动 ID 不能重复。');

  const days: WeeklyPlanDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(input.weekStart, index);
    const customCapacity = input.capacities?.[date];
    const capacityMinutes = customCapacity ?? DEFAULT_CAPACITY_MINUTES;
    if (!Number.isInteger(capacityMinutes) || capacityMinutes < 0 || capacityMinutes > 1440) {
      throw new Error(`日期 ${date} 的每日容量必须是 0 到 1440 分钟的整数。`);
    }
    return { date, capacityMinutes, capacityIsDefault: customCapacity === undefined || customCapacity === DEFAULT_CAPACITY_MINUTES, usedMinutes: 0, actions: [] };
  });

  const actionsById = new Map(input.actions.map(action => [action.id, action]));
  const pending = new Map(input.actions.map(action => [action.id, action]));
  const scheduledDate = new Map<string, string>();
  const blocked = new Map<string, string>();
  const unplaced: WeeklyPlan['unplaced'] = [];

  for (const action of input.actions) {
    const unknownDependency = action.dependsOn.find(id => !actionsById.has(id));
    if (unknownDependency) {
      blocked.set(action.id, `依赖行动 ${unknownDependency} 不在本周待排任务中。`);
    }
    if (action.hardDeadline && !parseDate(action.hardDeadline)) {
      blocked.set(action.id, '硬截止日期无效，需先修正行动信息。');
    } else if (action.hardDeadline && action.hardDeadline < input.weekStart) {
      blocked.set(action.id, `硬截止 ${action.hardDeadline} 已早于本周，无法安排。`);
    }
  }

  for (const [id, reason] of blocked) {
    const action = pending.get(id)!;
    pending.delete(id);
    unplaced.push({ action, reason });
  }

  while (pending.size) {
    for (const [id, action] of pending) {
      const blockedDependency = action.dependsOn.find(dependency => blocked.has(dependency));
      if (blockedDependency) blocked.set(id, `依赖行动 ${blockedDependency} 未能安排。`);
    }
    for (const [id, reason] of blocked) {
      const action = pending.get(id);
      if (action) {
        pending.delete(id);
        unplaced.push({ action, reason });
      }
    }
    if (!pending.size) break;

    const ready = [...pending.values()]
      .filter(action => action.dependsOn.every(dependency => scheduledDate.has(dependency)))
      .sort(compareActions);
    if (!ready.length) {
      for (const action of pending.values()) unplaced.push({ action, reason: '依赖关系存在循环或依赖尚未安排，无法确定执行顺序。' });
      break;
    }

    const action = ready[0];
    const dependencyDates = action.dependsOn.map(id => scheduledDate.get(id)!);
    const earliestDate = dependencyDates.length ? addDays(dependencyDates.sort().at(-1)!, 1) : input.weekStart;
    const duration = action.estimateMinutes ?? DEFAULT_ESTIMATE_MINUTES;
    const candidate = days.find(day => day.date >= earliestDate
      && (!action.hardDeadline || day.date <= action.hardDeadline)
      && day.capacityMinutes - day.usedMinutes >= duration);

    pending.delete(action.id);
    if (!candidate) {
      unplaced.push({
        action,
        reason: action.hardDeadline
          ? `在硬截止 ${action.hardDeadline} 前没有足够的每日容量。`
          : '本周剩余每日容量不足，行动保持待排。',
      });
      blocked.set(action.id, '行动未能安排');
      continue;
    }

    const planned: PlannedAction = {
      ...action,
      actionId: action.id,
      estimateMinutes: duration,
      estimateIsDefault: action.estimateMinutes === null,
    };
    candidate.actions.push(planned);
    candidate.usedMinutes += duration;
    scheduledDate.set(action.id, candidate.date);
  }

  for (const day of days) day.actions.sort((a, b) => compareActions(a, b));
  unplaced.sort((a, b) => compareActions(a.action, b.action));
  return { weekStart: input.weekStart, days, unplaced };
}
