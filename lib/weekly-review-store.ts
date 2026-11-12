import { openDatabase, listEvidence } from './store';
import type { Evidence, EvidenceLevel } from './model';
import { getDailyPlan } from './daily-plan-store';
import { listChangeEvents } from './milestone-store';
import { listReplanProposals } from './replanning';
import {
  listGoalPlanContractVersions,
  listGoalPlanEvaluations,
  listGoalPlans,
  createGoalPlanActionForWeeklyReview,
  type GoalMilestone,
  type GoalPlan,
  type GoalPlanContractVersion,
  type GoalPlanEvaluation,
  type GoalPlanEvaluationRuleSnapshot,
} from './goal-plans';
import { getHistoryCalendar, type HistoryCalendarActivity } from './history-calendar';

export type WeeklyReviewAdjustment = {
  kind: 'measure' | 'practice' | 'setup';
  goalPlanId: string | null;
  goalTitle: string;
  milestoneId: string | null;
  milestoneTitle: string | null;
  actionId: string | null;
  actionTitle: string | null;
  title: string;
  rationale: string;
  expectedResult: string;
  verificationDate: string;
  modifiedByUser: boolean;
};

export type WeeklyReviewEvidence = Pick<Evidence, 'id' | 'observedAt' | 'text' | 'source' | 'reference' | 'level' | 'links' | 'goalPlanId' | 'goalActionId' | 'reportSubmitted' | 'benchmarkComplete' | 'latencyMs'> & {
  goalTitle: string | null;
  goalActionTitle: string | null;
};

export type WeeklyMilestoneReview = {
  milestoneId: string;
  title: string;
  successCriteria: string | null;
  evidenceRequirement: string | null;
  requiredEvidenceLevel: EvidenceLevel;
  evidenceRequirementSource: string;
  associatedActionCount: number;
  completedActionCount: number;
  evidenceCount: number;
  evidenceBeforeContractCount: number;
  qualifiedEvidenceCount: number;
  evidenceIds: string[];
  status: string;
  gap: string;
};

export type WeeklyReviewFollowupDecision = 'accepted' | 'modified';
export type WeeklyReviewFollowupState = 'creating' | 'confirmed';
export type WeeklyReviewFollowupSnapshot = {
  sourceWeekStart: string;
  decision: WeeklyReviewFollowupDecision;
  originalSuggestion: WeeklyReviewAdjustment;
  adjustment: WeeklyReviewAdjustment;
  goalPlanId: string;
  goalTitle: string;
  milestoneId: string;
  milestoneTitle: string;
  contractVersion: number;
  contractEffectiveAt: string;
  milestoneCriteria: string | null;
  evidenceRequirementSource: string;
  requiredEvidenceLevel: EvidenceLevel;
  confirmedAt: string;
};

export type WeeklyReviewFollowup = WeeklyReviewFollowupSnapshot & {
  state: WeeklyReviewFollowupState;
  actionId: string | null;
  taskTitle: string;
};

export type WeeklyReviewFollowupTrace = WeeklyReviewFollowup & {
  status: 'not_executed' | 'completed_no_evidence' | 'evidence_insufficient' | 'result_available';
  completedAt: string | null;
  evidence: WeeklyReviewEvidence[];
  outcome: 'met' | 'not_met' | 'requires_review' | null;
  resultSummary: string;
};

export type WeeklyGoalReview = {
  goalPlanId: string;
  title: string;
  status: GoalPlan['status'];
  contractVersion: number | null;
  contractEffectiveAt: string | null;
  contractChangeSummary: string | null;
  successDescription: string | null;
  completedAt: string | null;
  plannedActionCount: number;
  plannedMinutes: number;
  completedActionCount: number;
  evidenceCount: number;
  qualifiedEvidenceCount: number;
  milestones: WeeklyMilestoneReview[];
  evaluations: WeeklyGoalEvaluation[];
};

export type WeeklyGoalEvaluation = {
  id: string;
  observedAt: string;
  outcome: GoalPlanEvaluation['outcome'];
  status: GoalPlanEvaluation['status'];
  summary: string;
  milestoneId: string | null;
  contractVersionId: string;
  contractVersion: number;
  ruleSnapshot: GoalPlanEvaluationRuleSnapshot;
  evidenceIds: string[];
};

export type WeeklyPlannedAction = {
  actionId: string;
  goalPlanId: string;
  goalTitle: string;
  title: string;
  date: string;
  estimateMinutes: number;
  completedAt: string | null;
  evidenceCount: number;
  qualifiedEvidenceCount: number;
  status: 'completed' | 'completed-earlier' | 'completed-later' | 'pending' | 'overdue';
};

export type WeeklyReview = {
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  executionEffort: {
    planStatus: 'missing' | 'draft' | 'confirmed';
    plannedActionCount: number;
    plannedMinutes: number;
    unplacedActionCount: number;
    completedActionCount: number;
    actualEffortAvailable: false;
  };
  plannedActions: WeeklyPlannedAction[];
  goals: WeeklyGoalReview[];
  evidence: WeeklyReviewEvidence[];
  unlinkedEvidence: WeeklyReviewEvidence[];
  evidenceGaps: string[];
  deviations: string[];
  facts: string[];
  hypotheses: string[];
  suggestedAdjustment: WeeklyReviewAdjustment;
  adjustment: WeeklyReviewAdjustment;
  followups: WeeklyReviewFollowupTrace[];
};

export type WeeklyReviewRecord = { review: WeeklyReview; status: 'draft' | 'saved'; savedAt: string | null; followup: WeeklyReviewFollowup | null };
type GoalActionRelation = { id: string; goalPlanId: string; title: string; status: 'pending_schedule' | 'scheduled' | 'done'; milestoneId: string | null; evidenceRequirement: string | null; completedAt: string | null };
type WeeklyReviewGoalPlan = GoalPlan & { reviewContractEffectiveAt: string | null };

function assertWeekStart(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('周起始日期必须是有效的 YYYY-MM-DD 日期。');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1) {
    throw new Error('周起始日期必须是有效的星期一。');
  }
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateKey(timestamp: string, timeZone: string): string | null {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time);
  const values = new Map(parts.map(part => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function isWithinWeek(value: string, weekStart: string, nextWeekStart: string, timeZone: string) {
  const date = dateKey(value, timeZone);
  return Boolean(date && date >= weekStart && date < nextWeekStart);
}

function contractVersionForReviewWeek(versions: GoalPlanContractVersion[], weekEnd: string, timeZone: string) {
  return versions.filter(version => {
    const effectiveDate = dateKey(version.effectiveAt, timeZone);
    return effectiveDate !== null && effectiveDate <= weekEnd;
  }).sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.version - b.version).at(-1) ?? null;
}

function parseLatencyTarget(milestone: GoalMilestone): { limit: number; inclusive: boolean } | null {
  const criteria = milestone.successCriteria ?? '';
  if (!/(延迟|响应时间|latency|response\s*time)/i.test(criteria)) return null;
  const match = criteria.match(/(<=|≤|<|小于等于|不超过|不高于|低于|小于|以下)\s*(\d+(?:\.\d+)?)\s*(milliseconds?|msec|ms|微秒|μs|µs|us|秒|seconds?|s)/i);
  if (!match) return null;
  const value = Number(match[2]);
  const unit = match[3].toLocaleLowerCase();
  const limit = /^(?:s|秒|seconds?)$/.test(unit) ? value * 1000
    : /^(?:us|μs|µs|微秒)$/.test(unit) ? value / 1000
      : value;
  return { limit, inclusive: match[1] !== '<' && match[1] !== '低于' && match[1] !== '小于' };
}

function latestCompleteMeasurement(evidence: Evidence[], minimumLevel: EvidenceLevel = 'E2') {
  return evidence.filter(item => item.benchmarkComplete === true && typeof item.latencyMs === 'number'
    && (item.level === 'E2' || item.level === 'E3') && evidenceLevelRank[item.level] >= evidenceLevelRank[minimumLevel])
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.createdAt.localeCompare(a.createdAt))[0];
}

const evidenceLevelRank: Record<EvidenceLevel, number> = { E1: 1, E2: 2, E3: 3 };

function parseEvidenceRequirementLevel(value: string): { level: EvidenceLevel; alternatives: string[] } | null {
  const groups = [...value.matchAll(/E[123](?:(?:\s*(?:或|\/|or)\s*)E[123])*/gi)]
    .map(match => [...match[0].matchAll(/E[123]/gi)].map(level => level[0].toUpperCase() as EvidenceLevel));
  if (!groups.length) return null;
  const levels = groups.map(group => group.reduce((lowest, current) =>
    evidenceLevelRank[current] < evidenceLevelRank[lowest] ? current : lowest));
  const level = levels.reduce((highest, current) =>
    evidenceLevelRank[current] > evidenceLevelRank[highest] ? current : highest);
  return { level, alternatives: groups.map(group => [...new Set(group)].join('/')) };
}

function normalizeRequirementText(value: string) {
  return value.toLocaleLowerCase()
    .replace(/e[123](?:(?:\s*(?:或|\/|or)\s*)e[123])*/gi, '')
    .replace(/[\s，,。:：;；()（）]/g, '');
}

function evidenceRequirementFor(goal: GoalPlan, milestone: GoalMilestone, actions: GoalActionRelation[]) {
  const localRequirements = [
    { label: '里程碑证据要求', text: milestone.evidenceRequirement },
    ...actions.map(action => ({ label: `行动「${action.title}」证据要求`, text: action.evidenceRequirement })),
  ].filter((requirement): requirement is { label: string; text: string } => Boolean(requirement.text));
  const localConstraints = localRequirements.flatMap(requirement => {
    const parsed = parseEvidenceRequirementLevel(requirement.text);
    if (!parsed) return [];
    return [{
      level: parsed.level,
      source: `${requirement.label}：${parsed.alternatives.join('、')} 中最低为 ${parsed.level}`,
    }];
  });

  const planRequirements = goal.evidenceRequirements.filter(requirement => requirement.minimumLevel !== null);
  const requirementMatches = localRequirements.map(requirement => {
    const normalizedText = normalizeRequirementText(requirement.text);
    return planRequirements.filter(planRequirement => [planRequirement.item, planRequirement.description]
      .some(value => value && normalizeRequirementText(value) === normalizedText));
  });
  const reliablyMatched = localRequirements.length > 0
    && requirementMatches.every(matches => matches.length === 1);
  const matchedPlanRequirements = reliablyMatched
    ? [...new Map(requirementMatches.flat().map(requirement => [requirement.id, requirement])).values()]
    : [];
  const resolvedPlanRequirements = reliablyMatched ? matchedPlanRequirements : planRequirements;
  const planLevel = resolvedPlanRequirements.reduce<EvidenceLevel | null>((highest, requirement) => {
    const current = requirement.minimumLevel;
    if (!current) return highest;
    if (!highest || evidenceLevelRank[current] > evidenceLevelRank[highest]) return current;
    return highest;
  }, null);

  const requested = [...localConstraints.map(constraint => constraint.level), ...(planLevel ? [planLevel] : [])]
    .reduce<EvidenceLevel | null>((highest, current) => {
      if (!highest || evidenceLevelRank[current] > evidenceLevelRank[highest]) return current;
      return highest;
    }, null) ?? 'E2';
  const level = evidenceLevelRank[requested] < evidenceLevelRank.E2 ? 'E2' : requested;
  const sourceParts = [
    ...localConstraints.map(constraint => constraint.source),
    ...(planLevel ? [reliablyMatched
      ? `精确关联目标证据要求：${matchedPlanRequirements.map(requirement => requirement.item ?? requirement.description).filter(Boolean).join('、')}（最高 ${planLevel}）`
      : `无法可靠关联目标计划中的具体证据要求，保守按全部目标证据要求最高等级 ${planLevel} 核对（关联不确定）`] : []),
    ...(requested === 'E1' ? ['关键里程碑高置信度最低按 E2 核对'] : []),
    ...(!planLevel && !localConstraints.length ? ['计划未设置可解析的证据等级，关键里程碑默认按 E2 核对'] : []),
  ];
  return { level, source: sourceParts.join('；') };
}

function listGoalActionRelations(goalPlanIds: string[]): GoalActionRelation[] {
  if (!goalPlanIds.length) return [];
  const database = openDatabase();
  try {
    const placeholders = goalPlanIds.map(() => '?').join(',');
    const rows = database.prepare(`SELECT id, goal_plan_id, title, status, milestone_id, evidence_requirement, completed_at
      FROM goal_plan_actions WHERE goal_plan_id IN (${placeholders}) ORDER BY created_at, id`).all(...goalPlanIds) as Array<Record<string, unknown>>;
    return rows.map(row => ({
      id: String(row.id), goalPlanId: String(row.goal_plan_id), title: String(row.title),
      status: row.status === 'done' || row.status === 'scheduled' ? row.status : 'pending_schedule',
      milestoneId: row.milestone_id === null ? null : String(row.milestone_id),
      evidenceRequirement: row.evidence_requirement === null ? null : String(row.evidence_requirement),
      completedAt: row.completed_at === null ? null : String(row.completed_at),
    }));
  } finally {
    database.close();
  }
}

function makeSetupAdjustment(weekStart: string, goal?: GoalPlan, historicalContractMissing = false): WeeklyReviewAdjustment {
  return {
    kind: 'setup',
    goalPlanId: goal?.id ?? null,
    goalTitle: goal?.title ?? '尚无活跃目标',
    milestoneId: null,
    milestoneTitle: null,
    actionId: null,
    actionTitle: null,
    title: historicalContractMissing
      ? '补录该周适用的目标标准版本'
      : goal ? '为这个目标补充一个近期里程碑' : '先建立并确认一个目标计划',
    rationale: goal
      ? historicalContractMissing
        ? `目标「${goal.title ?? '未命名目标'}」在该复盘周没有已生效的契约版本；不能用之后的目标标准改写这段历史评价。`
        : `目标「${goal.title ?? '未命名目标'}」尚无可用于复盘的里程碑，当前记录不能支持目标级的进展判断。`
      : '本周没有活跃目标，无法把行动、证据或结果归到明确的目标和里程碑。',
    expectedResult: goal
      ? historicalContractMissing
        ? '如能核实当时标准，请补录带有正确生效时间的目标契约；无法核实时保留为未评估，不套用当前标准。'
        : '确认一个近期里程碑、可观察标准和至少一项关联行动，以便下周按目标核对执行与证据。'
      : '确认一个包含近期里程碑和可观察标准的目标计划，再开始收集对应行动与证据。',
    verificationDate: addDays(weekStart, 13),
    modifiedByUser: false,
  };
}

function makeAdjustment(weekStart: string, activeGoals: WeeklyReviewGoalPlan[], actions: GoalActionRelation[], evidence: Evidence[]): WeeklyReviewAdjustment {
  const candidates = activeGoals.flatMap(goal => {
    const milestones = goal.milestones.filter(milestone => milestone.stage === 'near');
    const selectedMilestones = milestones.length ? milestones : goal.milestones;
    return selectedMilestones.map(milestone => {
      const milestoneActions = actions.filter(action => action.goalPlanId === goal.id && action.milestoneId === milestone.id);
      const actionIds = new Set(milestoneActions.map(action => action.id));
      const effectiveAt = goal.reviewContractEffectiveAt ? Date.parse(goal.reviewContractEffectiveAt) : null;
      const milestoneEvidence = evidence.filter(item => item.goalPlanId === goal.id && item.goalActionId != null && actionIds.has(item.goalActionId)
        && (effectiveAt === null || Date.parse(item.observedAt) >= effectiveAt));
      const evidenceRequirement = evidenceRequirementFor(goal, milestone, milestoneActions);
      const threshold = parseLatencyTarget(milestone);
      const measured = latestCompleteMeasurement(milestoneEvidence, evidenceRequirement.level);
      if (threshold && measured) {
        const passes = threshold.inclusive ? measured.latencyMs! <= threshold.limit : measured.latencyMs! < threshold.limit;
        if (!passes) return {
          priority: 100,
          adjustment: {
            kind: 'measure' as const, goalPlanId: goal.id, goalTitle: goal.title ?? '未命名目标',
            milestoneId: milestone.id, milestoneTitle: milestone.title ?? '未命名里程碑',
            actionId: milestoneActions[0]?.id ?? null, actionTitle: milestoneActions[0]?.title ?? null,
            title: '固定测试环境并记录并发请求数后复测',
            rationale: `目标「${goal.title ?? '未命名目标'}」的里程碑「${milestone.title ?? '未命名里程碑'}」要求${threshold.inclusive ? '不高于' : '低于'} ${threshold.limit} ms；本周符合 ${evidenceRequirement.level} 要求的完整实测为 ${measured.latencyMs} ms。并发负载可能影响响应延迟，但当前记录不足以判断原因；这是待验证推断。`,
            expectedResult: `在固定软硬件环境并记录并发请求数的条件下取得一条完整 ${evidenceRequirement.level} 测量，核对延迟是否${threshold.inclusive ? '不高于' : '低于'} ${threshold.limit} ms，并与本周 ${measured.latencyMs} ms 的结果比较。`,
            verificationDate: addDays(weekStart, 13), modifiedByUser: false,
          },
        };
        return {
          priority: 85,
          adjustment: {
            kind: 'measure' as const, goalPlanId: goal.id, goalTitle: goal.title ?? '未命名目标',
            milestoneId: milestone.id, milestoneTitle: milestone.title ?? '未命名里程碑',
            actionId: milestoneActions[0]?.id ?? null, actionTitle: milestoneActions[0]?.title ?? null,
            title: '下周在相同条件下复测一次',
            rationale: `目标「${goal.title ?? '未命名目标'}」的本周关联实测为 ${measured.latencyMs} ms，达到里程碑标准；单次结果还不能说明表现稳定。`,
            expectedResult: `取得一条新的完整 ${evidenceRequirement.level} 测量，并核对延迟是否仍${threshold.inclusive ? '不高于' : '低于'} ${threshold.limit} ms。`,
            verificationDate: addDays(weekStart, 13), modifiedByUser: false,
          },
        };
      }
      const qualifiedEvidence = milestoneEvidence.filter(item => evidenceLevelRank[item.level] >= evidenceLevelRank[evidenceRequirement.level]);
      const nextAction = milestoneActions.find(action => action.status !== 'done') ?? milestoneActions[0];
      return {
        priority: qualifiedEvidence.length ? 70 : milestoneActions.length ? 60 : 40,
        adjustment: {
          kind: 'measure' as const, goalPlanId: goal.id, goalTitle: goal.title ?? '未命名目标',
          milestoneId: milestone.id, milestoneTitle: milestone.title ?? '未命名里程碑',
          actionId: nextAction?.id ?? null, actionTitle: nextAction?.title ?? null,
          title: nextAction ? `完成「${nextAction.title}」并保存可核验结果` : `为「${milestone.title ?? '未命名里程碑'}」补一次可核验测量`,
          rationale: qualifiedEvidence.length
            ? `目标已有与该里程碑关联且达到 ${evidenceRequirement.level} 门槛的证据，但成功标准没有可直接核验的数值测量规则；需要把本次结果与标准对照。`
            : `目标「${goal.title ?? '未命名目标'}」的里程碑「${milestone.title ?? '未命名里程碑'}」本周没有达到 ${evidenceRequirement.level} 门槛的关联结果证据。`,
          expectedResult: `保存一条达到 ${evidenceRequirement.level} 要求、关联到目标「${goal.title ?? '未命名目标'}」${nextAction ? `和行动「${nextAction.title}」` : ''}的可复核结果，并对照里程碑标准「${milestone.successCriteria ?? '待补充'}」。`,
          verificationDate: addDays(weekStart, 13), modifiedByUser: false,
        },
      };
    });
  });
  candidates.sort((a, b) => b.priority - a.priority);
  const fallbackGoal = activeGoals[0];
  return candidates[0]?.adjustment ?? makeSetupAdjustment(weekStart, fallbackGoal, fallbackGoal?.contractVersion === null);
}

function evidenceSnapshot(item: Evidence, goalTitle: string | null, goalActionTitle: string | null): WeeklyReviewEvidence {
  return {
    id: item.id, observedAt: item.observedAt, text: item.text, source: item.source, reference: item.reference,
    level: item.level, links: item.links, goalPlanId: item.goalPlanId ?? null, goalActionId: item.goalActionId ?? null,
    reportSubmitted: item.reportSubmitted, benchmarkComplete: item.benchmarkComplete, latencyMs: item.latencyMs,
    goalTitle, goalActionTitle,
  };
}

function listFollowupTraces(weekStart: string, nextWeekStart: string, timeZone: string): WeeklyReviewFollowupTrace[] {
  const database = ensureSchema();
  let rows: Array<WeeklyReviewFollowupRow & {
    goal_plan_id: string;
    action_title: string | null;
    action_status: string | null;
    completed_at: string | null;
  }>;
  try {
    rows = database.prepare(`SELECT f.review_week_start,f.action_id,f.payload_json,f.status,f.goal_plan_id,
      a.title AS action_title,a.status AS action_status,a.completed_at
      FROM weekly_review_followups f LEFT JOIN goal_plan_actions a ON a.id=f.action_id
      WHERE f.status='confirmed' AND f.review_week_start<? ORDER BY f.review_week_start,f.action_id`)
      .all(weekStart) as typeof rows;
  } finally {
    database.close();
  }
  const allEvidence = listEvidence();
  return rows.flatMap(row => {
    const payload = JSON.parse(row.payload_json) as WeeklyReviewFollowupSnapshot & { taskTitle: string };
    const confirmedDate = dateKey(payload.confirmedAt, timeZone);
    if (!row.action_id || !confirmedDate || confirmedDate >= nextWeekStart) return [];
    const completedDate = row.completed_at ? dateKey(row.completed_at, timeZone) : null;
    const completedByReview = row.action_status === 'done' && Boolean(row.completed_at && Date.parse(row.completed_at) >= Date.parse(payload.confirmedAt)
      && completedDate && completedDate < nextWeekStart);
    const linkedEvidence = allEvidence.filter(item => item.goalPlanId === payload.goalPlanId && item.goalActionId === row.action_id
      && Date.parse(item.observedAt) >= Date.parse(payload.confirmedAt)
      && (dateKey(item.observedAt, timeZone) ?? '') < nextWeekStart);
    const evidence = linkedEvidence.map(item => evidenceSnapshot(item, payload.goalTitle, payload.taskTitle));
    const base: WeeklyReviewFollowupTrace = {
      ...payload, state: 'confirmed', actionId: row.action_id, taskTitle: row.action_title ?? payload.taskTitle,
      status: 'not_executed', completedAt: completedByReview ? row.completed_at : null,
      evidence, outcome: null, resultSummary: '',
    };
    if (!completedByReview) return [{ ...base, resultSummary: '截至本复盘周，任务没有完成记录。' }];
    if (!linkedEvidence.length) return [{
      ...base, status: 'completed_no_evidence', resultSummary: `任务已于 ${row.completed_at} 完成，但没有找到确认后的关联证据。`,
    }];

    const qualifiedEvidence = linkedEvidence.filter(item => evidenceLevelRank[item.level] >= evidenceLevelRank[payload.requiredEvidenceLevel]);
    if (!qualifiedEvidence.length) return [{
      ...base, status: 'evidence_insufficient', resultSummary: `任务已完成并有 ${linkedEvidence.length} 条关联证据，但没有证据达到 ${payload.requiredEvidenceLevel} 门槛。`,
    }];

    const acceptedTarget = parseLatencyTarget({ successCriteria: payload.adjustment.expectedResult } as GoalMilestone);
    const threshold = acceptedTarget ?? (payload.decision === 'accepted'
      ? parseLatencyTarget({ successCriteria: payload.milestoneCriteria } as GoalMilestone)
      : null);
    const measured = latestCompleteMeasurement(qualifiedEvidence, payload.requiredEvidenceLevel);
    if (threshold && measured) {
      const met = threshold.inclusive ? measured.latencyMs! <= threshold.limit : measured.latencyMs! < threshold.limit;
      return [{
        ...base, status: 'result_available', outcome: met ? 'met' : 'not_met',
        resultSummary: `完整实测为 ${measured.latencyMs} ms，${met ? '达到' : '未达到'}${acceptedTarget ? '已确认建议中的' : `契约 v${payload.contractVersion} 的`}标准${threshold.inclusive ? '不高于' : '低于'} ${threshold.limit} ms。`,
      }];
    }
    return [{
      ...base, status: 'result_available', outcome: 'requires_review',
      resultSummary: `已有 ${qualifiedEvidence.length} 条达到 ${payload.requiredEvidenceLevel} 门槛的关联结果证据，需按原建议预期核对。`,
    }];
  });
}

function summarizeMilestone(goal: WeeklyReviewGoalPlan, milestone: GoalMilestone, actions: GoalActionRelation[], activities: HistoryCalendarActivity[], evidence: Evidence[]): WeeklyMilestoneReview {
  const milestoneActions = actions.filter(action => action.milestoneId === milestone.id);
  const actionIds = new Set(milestoneActions.map(action => action.id));
  const completedIds = new Set(activities.filter(activity => activity.kind === 'action').map(activity => activity.id));
  const effectiveAt = goal.reviewContractEffectiveAt ? Date.parse(goal.reviewContractEffectiveAt) : null;
  const evidenceBeforeContract = effectiveAt === null ? [] : evidence.filter(item => item.goalActionId != null
    && actionIds.has(item.goalActionId) && Date.parse(item.observedAt) < effectiveAt);
  const linkedEvidence = evidence.filter(item => item.goalActionId != null && actionIds.has(item.goalActionId)
    && (effectiveAt === null || Date.parse(item.observedAt) >= effectiveAt));
  const evidenceRequirement = evidenceRequirementFor(goal, milestone, milestoneActions);
  const qualifiedEvidence = linkedEvidence.filter(item => evidenceLevelRank[item.level] >= evidenceLevelRank[evidenceRequirement.level]);
  const measured = latestCompleteMeasurement(linkedEvidence, evidenceRequirement.level);
  const threshold = parseLatencyTarget(milestone);
  let status: string;
  if (threshold && measured) {
    const passed = threshold.inclusive ? measured.latencyMs! <= threshold.limit : measured.latencyMs! < threshold.limit;
    status = passed ? '本周关联实测达到标准，待用户核对' : '本周关联实测未达标';
  } else if (qualifiedEvidence.length) status = `已有达到 ${evidenceRequirement.level} 门槛的关联证据，需对照成功标准核验`;
  else if ([...actionIds].some(id => completedIds.has(id))) status = `关联行动已完成，但缺少达到 ${evidenceRequirement.level} 门槛的结果证据`;
  else if (milestoneActions.length) status = '本周没有完成关联行动';
  else status = '没有关联行动，无法追踪此里程碑';

  const baseGap = !milestoneActions.length
    ? '没有关联行动，无法把本周执行或证据归到该里程碑。'
    : !qualifiedEvidence.length
      ? `缺少达到 ${evidenceRequirement.level} 门槛且关联到里程碑行动的结果证据。`
      : threshold && !measured
        ? `缺少符合完整测量条件且达到 ${evidenceRequirement.level} 门槛的证据。`
        : threshold && measured && status === '本周关联实测未达标'
          ? `实测 ${measured.latencyMs} ms，未满足${threshold.inclusive ? '不高于' : '低于'} ${threshold.limit} ms。`
          : '证据需要与成功标准一同核对。';
  const gap = evidenceBeforeContract.length
    ? `${baseGap}另有 ${evidenceBeforeContract.length} 条关联证据早于契约生效时间，不用于本版本判定。`
    : baseGap;
  return {
    milestoneId: milestone.id, title: milestone.title ?? '未命名里程碑', successCriteria: milestone.successCriteria,
    evidenceRequirement: milestone.evidenceRequirement, requiredEvidenceLevel: evidenceRequirement.level,
    evidenceRequirementSource: evidenceRequirement.source, associatedActionCount: milestoneActions.length,
    completedActionCount: milestoneActions.filter(action => completedIds.has(action.id)).length,
    evidenceCount: linkedEvidence.length, evidenceBeforeContractCount: evidenceBeforeContract.length,
    qualifiedEvidenceCount: qualifiedEvidence.length,
    evidenceIds: linkedEvidence.map(item => item.id), status, gap,
  };
}

export function generateWeeklyReview(weekStart: string, timeZone = 'UTC'): WeeklyReview {
  assertWeekStart(weekStart);
  new Intl.DateTimeFormat('en', { timeZone }).format(new Date(0));
  const weekEnd = addDays(weekStart, 6);
  const nextWeekStart = addDays(weekStart, 7);
  const planRecord = getDailyPlan(weekStart);
  const plan = planRecord.plan;
  const planActions = plan?.days.flatMap(day => day.actions.map(action => ({ action, date: day.date }))) ?? [];
  const unplaced = plan?.unplaced ?? [];
  const allEvidence = listEvidence().filter(item => isWithinWeek(item.observedAt, weekStart, nextWeekStart, timeZone));
  const allPlans = listGoalPlans().filter(goal => goal.status !== 'draft');
  const contractVersionByGoal = new Map(allPlans.map(goal => [goal.id,
    contractVersionForReviewWeek(listGoalPlanContractVersions(goal.id), weekEnd, timeZone)]));
  const reviewPlans: WeeklyReviewGoalPlan[] = allPlans.map(goal => {
    const contractVersion = contractVersionByGoal.get(goal.id);
    return contractVersion
      ? { ...goal, ...contractVersion.plan, contractVersion: contractVersion.version, reviewContractEffectiveAt: contractVersion.effectiveAt }
      : { ...goal, successDescription: null, milestones: [], evidenceRequirements: [], contractVersion: null, reviewContractEffectiveAt: null };
  });
  const history = getHistoryCalendar(timeZone);
  const weekActivities = history.days.filter(day => day.date >= weekStart && day.date < nextWeekStart).flatMap(day => day.activities);
  const actionActivities = weekActivities.filter(activity => activity.kind === 'action');
  const evidenceTargetIds = new Set(allEvidence.flatMap(item => item.goalPlanId ? [item.goalPlanId] : []));
  const activeGoalIds = new Set(reviewPlans.filter(goal => goal.status === 'active').map(goal => goal.id));
  const reportGoalIds = new Set([
    ...activeGoalIds, ...actionActivities.map(activity => activity.goalPlanId), ...evidenceTargetIds,
    ...planActions.map(entry => entry.action.goalPlanId),
  ]);
  const goals = reviewPlans.filter(goal => reportGoalIds.has(goal.id));
  const goalById = new Map(goals.map(goal => [goal.id, goal]));
  const evaluationsByGoal = new Map(goals.map(goal => [goal.id,
    listGoalPlanEvaluations(goal.id).filter(evaluation => isWithinWeek(evaluation.observedAt, weekStart, nextWeekStart, timeZone))]));
  const goalActions = listGoalActionRelations(goals.map(goal => goal.id));
  const actionById = new Map(goalActions.map(action => [action.id, action]));
  const evidenceForGoal = new Map<string, Evidence[]>();
  for (const item of allEvidence) {
    if (!item.goalPlanId || !goalById.has(item.goalPlanId)) continue;
    const list = evidenceForGoal.get(item.goalPlanId) ?? [];
    list.push(item);
    evidenceForGoal.set(item.goalPlanId, list);
  }
  const activityForGoal = new Map<string, HistoryCalendarActivity[]>();
  for (const activity of actionActivities) {
    const list = activityForGoal.get(activity.goalPlanId) ?? [];
    list.push(activity);
    activityForGoal.set(activity.goalPlanId, list);
  }
  const activeGoals = goals.filter(goal => goal.status === 'active');
  const planActionById = new Map(planActions.map(entry => [entry.action.actionId, entry]));
  const completedById = new Map(actionActivities.map(activity => [activity.id, activity]));
  const currentDate = dateKey(new Date().toISOString(), timeZone) ?? weekEnd;
  const plannedReviewActions: WeeklyPlannedAction[] = planActions.map(({ action, date }) => {
    const completed = completedById.get(action.actionId);
    const actionEvidence = allEvidence.filter(item => item.goalActionId === action.actionId && item.goalPlanId === action.goalPlanId);
    const completedAt = completed?.completedAt ?? actionById.get(action.actionId)?.completedAt ?? null;
    const completedDate = completedAt ? dateKey(completedAt, timeZone) : null;
    const status: WeeklyPlannedAction['status'] = completedDate
      ? completedDate === date ? 'completed' : completedDate < date ? 'completed-earlier' : 'completed-later'
      : date <= weekEnd && date <= currentDate ? 'overdue' : 'pending';
    return {
      actionId: action.actionId, goalPlanId: action.goalPlanId, goalTitle: action.goalTitle,
      title: action.title, date, estimateMinutes: action.estimateMinutes,
      completedAt, evidenceCount: actionEvidence.length,
      qualifiedEvidenceCount: actionEvidence.filter(item => item.level === 'E2' || item.level === 'E3').length,
      status,
    };
  });
  const plannedMinutes = planActions.reduce((sum, entry) => sum + entry.action.estimateMinutes, 0);
  const actualActionIds = new Set(actionActivities.map(activity => activity.id));
  const completedInWeek = actionActivities.length;
  const planStatus = plan?.weekStart ? planRecord.status! : 'missing';

  const weeklyGoals: WeeklyGoalReview[] = goals.map(goal => {
    const goalActionRecords = goalActions.filter(action => action.goalPlanId === goal.id);
    const goalPlanActions = planActions.filter(entry => entry.action.goalPlanId === goal.id);
    const goalActivities = activityForGoal.get(goal.id) ?? [];
    const goalEvidence = evidenceForGoal.get(goal.id) ?? [];
    const milestones = goal.milestones.map(milestone => summarizeMilestone(goal, milestone,
      goalActionRecords, goalActivities, goalEvidence));
    return {
      goalPlanId: goal.id, title: goal.title ?? '未命名目标', status: goal.status,
      contractVersion: contractVersionByGoal.get(goal.id)?.version ?? null,
      contractEffectiveAt: contractVersionByGoal.get(goal.id)?.effectiveAt ?? null,
      contractChangeSummary: contractVersionByGoal.get(goal.id)?.changeSummary ?? null,
      successDescription: goal.successDescription, completedAt: goal.completedAt,
      plannedActionCount: goalPlanActions.length,
      plannedMinutes: goalPlanActions.reduce((sum, entry) => sum + entry.action.estimateMinutes, 0),
      completedActionCount: goalActivities.length, evidenceCount: goalEvidence.length,
      qualifiedEvidenceCount: goalEvidence.filter(item => item.level === 'E2' || item.level === 'E3').length,
      milestones,
      evaluations: (evaluationsByGoal.get(goal.id) ?? []).map(evaluation => ({
        id: evaluation.id, observedAt: evaluation.observedAt, outcome: evaluation.outcome,
        status: evaluation.status, summary: evaluation.summary, milestoneId: evaluation.milestoneId,
        contractVersionId: evaluation.contractVersion.id, contractVersion: evaluation.contractVersion.version,
        ruleSnapshot: evaluation.ruleSnapshot, evidenceIds: evaluation.evidenceIds,
      })),
    };
  });

  const nameById = new Map(goals.map(goal => [goal.id, goal.title ?? '未命名目标']));
  const evidence = allEvidence.map(item => evidenceSnapshot(item,
    item.goalPlanId ? nameById.get(item.goalPlanId) ?? null : null,
    item.goalActionId ? actionById.get(item.goalActionId)?.title ?? planActionById.get(item.goalActionId)?.action.title ?? null : null));
  const unlinkedEvidence = evidence.filter(item => !item.goalPlanId);
  const evidenceGaps = weeklyGoals.flatMap(goal => {
    const goalActivities = activityForGoal.get(goal.goalPlanId) ?? [];
    const goalEvidence = evidenceForGoal.get(goal.goalPlanId) ?? [];
    return [
      ...goal.milestones.filter(milestone => milestone.qualifiedEvidenceCount === 0)
        .map(milestone => `「${goal.title}」的里程碑「${milestone.title}」：${milestone.gap}`),
      ...goalActivities.filter(activity => !goalEvidence.some(item => item.goalActionId === activity.id))
        .map(activity => `「${goal.title}」的行动「${activity.title}」已完成，但没有关联证据。`),
    ];
  });
  const deviations = [
    ...unplaced.map(item => `「${item.action.goalTitle}」的行动「${item.action.title}」未排入：${item.reason}`),
    ...plannedReviewActions.filter(action => action.status === 'overdue')
      .map(action => `「${action.goalTitle}」的行动「${action.title}」原计划 ${action.date}，截至复盘时没有完成记录。`),
    ...plannedReviewActions.filter(action => action.status === 'completed-later' || action.status === 'completed-earlier')
      .map(action => `「${action.goalTitle}」的行动「${action.title}」原计划 ${action.date}，实际完成于 ${dateKey(action.completedAt!, timeZone)}。`),
    ...actionActivities.filter(activity => !planActionById.has(activity.id))
      .map(activity => `「${activity.goalTitle}」的行动「${activity.title}」本周已完成，但未出现在保存的周计划中。`),
    ...listReplanProposals(weekStart).filter(proposal => proposal.status === 'accepted')
      .flatMap(proposal => proposal.changes.map(change => `周计划重排「${change.title}」：${change.reason}`)),
  ];
  const changes = listChangeEvents().filter(event => isWithinWeek(event.createdAt, weekStart, nextWeekStart, timeZone));
  const taskChanges = changes.filter(event => event.eventType === 'task.updated')
    .filter(event => typeof event.details.goalPlanId === 'string' && goalById.has(event.details.goalPlanId));
  const facts = [
    plan
      ? `本周${planStatus === 'confirmed' ? '已确认' : '尚未确认'}计划安排 ${planActions.length} 项行动，估算计划投入 ${plannedMinutes} 分钟；另有 ${unplaced.length} 项未排入。该分钟数是计划估算，不是实际工时。`
      : '本周没有保存的周计划，无法从计划记录计算预期投入。',
    `本周有 ${completedInWeek} 项目标行动的完成记录；系统不记录这些行动的实际耗时。`,
    ...weeklyGoals.map(goal => `目标「${goal.title}」（${goal.status}）：本周完成 ${goal.completedActionCount} 项行动，关联 ${goal.evidenceCount} 条证据，其中 E2/E3 有 ${goal.qualifiedEvidenceCount} 条。成功条件：${goal.successDescription ?? '尚未填写'}。`),
    ...weeklyGoals.flatMap(goal => goal.milestones.map(milestone => `里程碑「${milestone.title}」（目标：${goal.title}）：${milestone.status}；本周关联行动完成 ${milestone.completedActionCount}/${milestone.associatedActionCount}，E2/E3 证据 ${milestone.qualifiedEvidenceCount} 条。`)),
    ...weeklyGoals.flatMap(goal => goal.evaluations.map(evaluation => `已保存目标进展评价「${goal.title}」：观察于 ${evaluation.observedAt}，按契约 v${evaluation.contractVersion} 的历史规则记录为 ${evaluation.outcome}（${evaluation.status}），摘要：${evaluation.summary}。`)),
    ...taskChanges.map(event => `目标任务变更记录：${event.summary}`),
    ...unlinkedEvidence.map(item => `未关联具体目标的证据「${item.reference}」未用于目标进展判定。`),
    ...goals.flatMap(goal => goal.lifecycleEvents.filter(event => isWithinWeek(event.createdAt, weekStart, nextWeekStart, timeZone))
      .map(event => `目标「${goal.title ?? '未命名目标'}」状态记录：${event.action}${event.reason ? `，${event.reason}` : ''}。`)),
  ];
  const hypotheses = [
    ...weeklyGoals.flatMap(goal => goal.milestones.some(milestone => milestone.status === '本周关联实测未达标')
      ? [`目标「${goal.title}」有一项关联完整测量未达到标准；现有结构化证据没有并发请求数字段，无法据此归因。并发请求数只是待验证变量，建议固定测试环境、记录该数后复测。`]
      : goal.completedActionCount && goal.evidenceCount === 0
      ? [`目标「${goal.title}」有行动完成记录但没有关联证据；可能是结果尚未保存，也可能是行动完成本身还不足以证明目标进展。`]
      : goal.completedActionCount === 0 && goal.plannedActionCount > 0
        ? [`目标「${goal.title}」的已排行动没有本周完成记录；无法区分未执行与完成状态未记录。`]
        : goal.qualifiedEvidenceCount > 0
          ? [`目标「${goal.title}」已有 E2/E3 证据，但除可核验的数值标准外，系统不会据文本等级自动判定是否达到里程碑。`]
          : []),
    ...(unlinkedEvidence.length ? ['未关联目标的证据无法解释任一目标的进展或计划偏差。'] : []),
  ];
  if (!hypotheses.length) hypotheses.push('现有目标、行动和证据记录不足以解释本周偏差原因。');

  const evidenceById = new Map(allEvidence.map(item => [item.id, item]));
  const activeGoalActions = goalActions.filter(action => activeGoalIds.has(action.goalPlanId));
  const adjustment = makeAdjustment(weekStart, activeGoals, activeGoalActions, [...evidenceById.values()]);
  const followups = listFollowupTraces(weekStart, nextWeekStart, timeZone);
  return {
    weekStart, weekEnd, timeZone,
    executionEffort: {
      planStatus, plannedActionCount: planActions.length, plannedMinutes, unplacedActionCount: unplaced.length,
      completedActionCount: completedInWeek, actualEffortAvailable: false,
    },
    plannedActions: plannedReviewActions,
    goals: weeklyGoals,
    evidence,
    unlinkedEvidence,
    evidenceGaps: [...new Set(evidenceGaps)],
    deviations,
    facts,
    hypotheses,
    suggestedAdjustment: adjustment,
    adjustment,
    followups,
  };
}

function ensureSchema() {
  const database = openDatabase();
  database.exec(`CREATE TABLE IF NOT EXISTS weekly_reviews (
    week_start TEXT PRIMARY KEY,
    review_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'saved')),
    saved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS weekly_review_followups (
    review_week_start TEXT PRIMARY KEY REFERENCES weekly_reviews(week_start) ON DELETE CASCADE,
    goal_plan_id TEXT NOT NULL,
    milestone_id TEXT NOT NULL,
    action_id TEXT UNIQUE,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('creating', 'confirmed')),
    confirmed_at TEXT NOT NULL
  )`);
  return database;
}

type WeeklyReviewFollowupRow = {
  review_week_start: string;
  action_id: string | null;
  payload_json: string;
  status: WeeklyReviewFollowupState;
};

function readFollowup(database: ReturnType<typeof openDatabase>, weekStart: string): WeeklyReviewFollowup | null {
  const row = database.prepare('SELECT review_week_start, action_id, payload_json, status FROM weekly_review_followups WHERE review_week_start=?')
    .get(weekStart) as WeeklyReviewFollowupRow | undefined;
  if (!row) return null;
  const payload = JSON.parse(row.payload_json) as WeeklyReviewFollowupSnapshot & { taskTitle: string };
  return { ...payload, state: row.status, actionId: row.action_id, taskTitle: payload.taskTitle };
}

function createFollowupIntent(weekStart: string, payload: WeeklyReviewFollowupSnapshot & { taskTitle: string }): WeeklyReviewFollowup {
  const database = ensureSchema();
  let inTransaction = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    const existing = readFollowup(database, weekStart);
    if (existing) {
      database.exec('COMMIT');
      inTransaction = false;
      return existing;
    }
    database.prepare(`INSERT INTO weekly_review_followups
      (review_week_start,goal_plan_id,milestone_id,action_id,payload_json,status,confirmed_at)
      VALUES (?,?,?,NULL,?,'creating',?)`)
      .run(weekStart, payload.goalPlanId, payload.milestoneId, JSON.stringify(payload), payload.confirmedAt);
    database.exec('COMMIT');
    inTransaction = false;
    return { ...payload, state: 'creating', actionId: null, taskTitle: payload.taskTitle };
  } catch (error) {
    if (inTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

function readRecord(database: ReturnType<typeof openDatabase>, weekStart: string): WeeklyReviewRecord | null {
  const row = database.prepare('SELECT review_json, status, saved_at FROM weekly_reviews WHERE week_start=?').get(weekStart) as { review_json: string; status: 'draft' | 'saved'; saved_at: string | null } | undefined;
  if (!row) return null;
  const saved = JSON.parse(row.review_json) as Partial<WeeklyReview>;
  const review = {
    ...saved,
    suggestedAdjustment: saved.suggestedAdjustment ?? saved.adjustment!,
    followups: saved.followups ?? [],
  } as WeeklyReview;
  return { review, status: row.status, savedAt: row.saved_at, followup: readFollowup(database, weekStart) };
}

function validateAdjustment(input: unknown, generated: WeeklyReviewAdjustment, weekStart: string): WeeklyReviewAdjustment {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('复盘调整内容无效。');
  const value = input as Record<string, unknown>;
  const text = (key: 'title' | 'rationale' | 'expectedResult', label: string, maxLength: number) => {
    const item = value[key];
    if (typeof item !== 'string' || !item.trim() || item.trim().length > maxLength) throw new Error(`${label}不能为空且不能超过 ${maxLength} 字。`);
    return item.trim();
  };
  const verificationDate = value.verificationDate;
  if (typeof verificationDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(verificationDate)) throw new Error('请填写有效的验证日期。');
  const parsed = new Date(`${verificationDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== verificationDate || verificationDate <= addDays(weekStart, 6)) {
    throw new Error('验证日期必须是本周结束后的有效日期。');
  }
  const title = text('title', '调整建议', 240);
  const rationale = text('rationale', '建议依据', 500);
  const expectedResult = text('expectedResult', '预期结果', 500);
  return {
    ...generated, title, rationale, expectedResult, verificationDate,
    modifiedByUser: title !== generated.title || rationale !== generated.rationale
      || expectedResult !== generated.expectedResult || verificationDate !== generated.verificationDate,
  };
}

export function getWeeklyReview(weekStart: string, timeZone = 'UTC'): WeeklyReviewRecord {
  assertWeekStart(weekStart);
  new Intl.DateTimeFormat('en', { timeZone }).format(new Date(0));
  const initial = ensureSchema();
  let existing: WeeklyReviewRecord | null;
  try {
    existing = readRecord(initial, weekStart);
  } finally {
    initial.close();
  }
  if (existing) return existing;

  const generated = generateWeeklyReview(weekStart, timeZone);
  const database = ensureSchema();
  let inTransaction = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    existing = readRecord(database, weekStart);
    if (existing) {
      database.exec('COMMIT');
      inTransaction = false;
      return existing;
    }
    database.prepare("INSERT INTO weekly_reviews (week_start, review_json, status, saved_at) VALUES (?, ?, 'draft', NULL)")
      .run(weekStart, JSON.stringify(generated));
    database.exec('COMMIT');
    inTransaction = false;
    return { review: generated, status: 'draft', savedAt: null, followup: null };
  } catch (error) {
    if (inTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

export function listSavedWeeklyReviews(): WeeklyReviewRecord[] {
  const database = ensureSchema();
  try {
    const rows = database.prepare("SELECT week_start FROM weekly_reviews WHERE status='saved' ORDER BY saved_at, week_start")
      .all() as Array<{ week_start: string }>;
    return rows.flatMap(row => {
      const record = readRecord(database, row.week_start);
      return record?.status === 'saved' ? [record] : [];
    });
  } finally {
    database.close();
  }
}

export function saveWeeklyReview(weekStart: string, adjustment: unknown, timeZone = 'UTC'): WeeklyReviewRecord {
  assertWeekStart(weekStart);
  const draft = getWeeklyReview(weekStart, timeZone);
  if (draft.status === 'saved') return draft;
  const review = { ...draft.review, adjustment: validateAdjustment(adjustment, draft.review.adjustment, weekStart) };
  const database = ensureSchema();
  let inTransaction = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    const existing = readRecord(database, weekStart);
    if (existing?.status === 'saved') {
      database.exec('COMMIT');
      inTransaction = false;
      return existing;
    }
    const savedAt = new Date().toISOString();
    database.prepare("UPDATE weekly_reviews SET review_json=?, status='saved', saved_at=? WHERE week_start=? AND status='draft'")
      .run(JSON.stringify(review), savedAt, weekStart);
    database.exec('COMMIT');
    inTransaction = false;
    return { review, status: 'saved', savedAt, followup: null };
  } catch (error) {
    if (inTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

export function confirmWeeklyReviewAdjustment(weekStart: string, timeZone = 'UTC'): WeeklyReviewRecord {
  assertWeekStart(weekStart);
  new Intl.DateTimeFormat('en', { timeZone }).format(new Date(0));
  const record = getWeeklyReview(weekStart, timeZone);
  if (record.status !== 'saved') throw new Error('请先核对并保存周复盘建议。');
  if (record.followup?.state === 'confirmed') return record;

  let followup = record.followup;
  if (!followup) {
    const adjustment = record.review.adjustment;
    if (adjustment.kind === 'setup' || !adjustment.goalPlanId || !adjustment.milestoneId) {
      throw new Error('当前建议没有可关联的目标里程碑，无法创建待排任务。');
    }
    const goal = record.review.goals.find(item => item.goalPlanId === adjustment.goalPlanId);
    const milestone = goal?.milestones.find(item => item.milestoneId === adjustment.milestoneId);
    if (!goal || !milestone || goal.contractVersion === null || !goal.contractEffectiveAt) {
      throw new Error('复盘快照缺少适用的目标契约或里程碑，无法创建任务。');
    }
    const confirmedAt = new Date().toISOString();
    followup = createFollowupIntent(weekStart, {
      sourceWeekStart: weekStart,
      decision: adjustment.modifiedByUser ? 'modified' : 'accepted',
      originalSuggestion: record.review.suggestedAdjustment,
      adjustment,
      goalPlanId: goal.goalPlanId,
      goalTitle: goal.title,
      milestoneId: milestone.milestoneId,
      milestoneTitle: milestone.title,
      contractVersion: goal.contractVersion,
      contractEffectiveAt: goal.contractEffectiveAt,
      milestoneCriteria: milestone.successCriteria,
      evidenceRequirementSource: milestone.evidenceRequirementSource,
      requiredEvidenceLevel: milestone.requiredEvidenceLevel,
      confirmedAt,
      taskTitle: adjustment.title,
    });
  }

  const milestoneEvidenceRequirement = `来源标准：${followup.evidenceRequirementSource}；预期结果：${followup.adjustment.expectedResult}`;
  const task = createGoalPlanActionForWeeklyReview({
    goalPlanId: followup.goalPlanId,
    milestoneId: followup.milestoneId,
    title: followup.taskTitle,
    details: `来自 ${weekStart} 周复盘的${followup.decision === 'accepted' ? '已接受' : '已修改'}建议：${followup.adjustment.rationale}`,
    estimateMinutes: null,
    dependencyIds: [],
    successCriteria: followup.adjustment.expectedResult,
    evidenceRequirement: milestoneEvidenceRequirement,
  }, weekStart);
  const database = ensureSchema();
  try {
    database.prepare(`UPDATE weekly_review_followups SET action_id=?,status='confirmed'
      WHERE review_week_start=? AND status='creating'`).run(task.id, weekStart);
  } finally {
    database.close();
  }
  return getWeeklyReview(weekStart, timeZone);
}
