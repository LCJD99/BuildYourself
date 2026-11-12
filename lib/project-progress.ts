import type { Evidence } from './model';
import type { GoalPlanAction, GoalProject } from './goal-plans';
import type { ProjectDeliverable } from './project-deliverables';

export type ProjectProgressView = 'evidence' | 'milestones' | 'trend' | 'deliverables';

export type ProjectProgressObservation = {
  id: string;
  observedAt: string;
  value: number;
  source: string;
  reference: string;
  level: Evidence['level'];
};

export type ProjectProgressModel = {
  evidence: {
    count: number;
    sources: string[];
    updatedAt: string | null;
    levels: Record<Evidence['level'], number>;
    qualityLabel: string;
    qualityDetail: string;
  };
  deliverables: { available: boolean; total: number; completed: number; percent: number | null; reason: string | null };
  milestones: Array<{
    goalPlanId: string;
    goalTitle: string;
    id: string;
    title: string;
    stage: string;
    successCriteria: string | null;
    evidenceRequirement: string | null;
    evidenceIds: string[];
    evidenceStatus: string;
    gap: string;
  }>;
  trend: {
    kind: 'empty' | 'single' | 'series';
    observations: ProjectProgressObservation[];
    firstToLastDeltaMs: number | null;
    gap: string | null;
    applicableRule: null;
  };
};

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function evidenceUpdatedAt(evidence: Evidence[]): string | null {
  return evidence.reduce<string | null>((latest, item) => {
    const itemUpdatedAt = item.lastCorrectedAt || item.createdAt;
    const itemTime = timestamp(itemUpdatedAt);
    const latestTime = timestamp(latest);
    return itemTime !== null && (latestTime === null || itemTime > latestTime) ? itemUpdatedAt : latest;
  }, null);
}

function summarizeEvidence(evidence: Evidence[]): ProjectProgressModel['evidence'] {
  const levels = { E1: 0, E2: 0, E3: 0 };
  for (const item of evidence) levels[item.level] += 1;
  const sources = [...new Set(evidence.map(item => item.source.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const verifiedCount = levels.E2 + levels.E3;
  const qualityLabel = !evidence.length ? '尚无关联证据'
    : verifiedCount ? '包含可验证或外部反馈证据'
      : '目前只有用户自报';
  const qualityDetail = evidence.length
    ? `E1 自报 ${levels.E1} 条，E2 可验证产出 ${levels.E2} 条，E3 外部专业反馈 ${levels.E3} 条。证据等级描述支持形式，不代表项目目标已达成。`
    : '关联到项目的证据会显示在此处；没有证据时不估算进展。';
  return { count: evidence.length, sources, updatedAt: evidenceUpdatedAt(evidence), levels, qualityLabel, qualityDetail };
}

function summarizeMilestoneEvidence(evidence: Evidence[], hasActions: boolean) {
  if (!hasActions) {
    return { evidenceStatus: '没有关联行动', gap: '尚无归属该目标与里程碑的行动，不能将项目中的其他证据归入此里程碑。' };
  }
  if (!evidence.length) {
    return { evidenceStatus: '尚无行动证据', gap: '关联行动尚无明确归属的证据记录。' };
  }
  if (evidence.some(item => item.level === 'E2' || item.level === 'E3')) {
    return { evidenceStatus: '含可验证证据', gap: '已有可验证证据，但尚未记录结构化的里程碑达成结果。' };
  }
  return { evidenceStatus: '仅有用户自报', gap: 'E1 自报不能单独确立里程碑达成；尚未记录结构化结果。' };
}

function makeMilestoneRows(project: GoalProject, actions: GoalPlanAction[]): ProjectProgressModel['milestones'] {
  return project.milestones.map(({ goalPlanId, goalTitle, milestone }) => {
    const milestoneActions = actions.filter(action => action.projectId === project.id && action.goalPlanId === goalPlanId && action.milestoneId === milestone.id);
    const actionIds = new Set(milestoneActions.map(action => action.id));
    const linkedEvidence = project.evidence.filter(item =>
      item.goalPlanId === goalPlanId && item.goalActionId !== null && item.goalActionId !== undefined && actionIds.has(item.goalActionId),
    );
    const { evidenceStatus, gap } = summarizeMilestoneEvidence(linkedEvidence, milestoneActions.length > 0);
    return {
      goalPlanId,
      goalTitle,
      id: milestone.id,
      title: milestone.title || '未命名里程碑',
      stage: milestone.stage,
      successCriteria: milestone.successCriteria,
      evidenceRequirement: milestone.evidenceRequirement,
      evidenceIds: linkedEvidence.map(item => item.id),
      evidenceStatus,
      gap,
    };
  });
}

function makeTrend(evidence: Evidence[]): ProjectProgressModel['trend'] {
  const observations = evidence
    .filter(item => item.links.includes('milestone') && item.benchmarkComplete === true && typeof item.latencyMs === 'number' && Number.isFinite(item.latencyMs))
    .filter(item => timestamp(item.observedAt) !== null)
    .map(item => ({
      id: item.id,
      observedAt: item.observedAt,
      value: item.latencyMs!,
      source: item.source,
      reference: item.reference,
      level: item.level,
    }))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.id.localeCompare(b.id));
  if (!observations.length) {
    return { kind: 'empty', observations, firstToLastDeltaMs: null, gap: '尚无带有完整基准测试标记的延迟观测。没有可适用的结构化项目判定规则。', applicableRule: null };
  }
  if (observations.length === 1) {
    return { kind: 'single', observations, firstToLastDeltaMs: null, gap: '目前只有一次观测，无法判断趋势；没有可适用的结构化项目判定规则。', applicableRule: null };
  }
  return {
    kind: 'series', observations,
    firstToLastDeltaMs: observations[observations.length - 1].value - observations[0].value,
    gap: '此视图只呈现观测与首末变化；当前没有可适用的结构化项目判定规则，因此不判断达标与否。',
    applicableRule: null,
  };
}

export function deriveProjectProgress(project: GoalProject, actions: GoalPlanAction[], deliverables: ProjectDeliverable[] = []): ProjectProgressModel {
  const completedDeliverables = deliverables.filter(item => item.completed).length;
  const hasFixedDenominator = deliverables.length > 0;
  return {
    evidence: summarizeEvidence(project.evidence),
    deliverables: {
      available: hasFixedDenominator,
      total: deliverables.length,
      completed: completedDeliverables,
      percent: hasFixedDenominator ? Math.round((completedDeliverables / deliverables.length) * 100) : null,
      reason: hasFixedDenominator ? null : '尚无已保存的固定交付物清单。添加明确交付物后，分母将固定为清单条目数；共享任务不会计入分母。',
    },
    milestones: makeMilestoneRows(project, actions),
    trend: makeTrend(project.evidence),
  };
}
