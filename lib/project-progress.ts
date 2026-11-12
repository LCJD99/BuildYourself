import type { Evidence } from './model';
import type { GoalPlanAction, GoalProject } from './goal-plans';
import type { ProjectDeliverable } from './project-deliverables';
import type { ProjectMeasurementSeries } from './project-measurement-series';

export type ProjectProgressView = 'evidence' | 'milestones' | 'trend' | 'deliverables';

export type ProjectProgressObservation = {
  id: string;
  text: string;
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
    unassignedObservations: ProjectProgressObservation[];
    series: Array<{
      id: string;
      name: string;
      basis: string;
      confirmedComparableAt: string;
      evidenceIds: string[];
      observations: ProjectProgressObservation[];
      excludedEvidence: Array<{ id: string; reference: string; source: string; text: string; reason: string; canReconfirm: boolean }>;
      firstToLastDeltaMs: number | null;
      gap: string | null;
    }>;
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

function makeTrend(project: GoalProject, configuredSeries: ProjectMeasurementSeries[]): ProjectProgressModel['trend'] {
  const evidence = project.evidence;
  const observations = evidence
    .filter(item => item.links.includes('milestone') && item.benchmarkComplete === true && typeof item.latencyMs === 'number' && Number.isFinite(item.latencyMs))
    .filter(item => timestamp(item.observedAt) !== null)
    .map(item => ({
      id: item.id,
      text: item.text,
      observedAt: item.observedAt,
      value: item.latencyMs!,
      source: item.source,
      reference: item.reference,
      level: item.level,
    }))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.id.localeCompare(b.id));
  const observationsById = new Map(observations.map(item => [item.id, item]));
  const projectSeries = configuredSeries.filter(item => item.projectId === project.id);
  const assignedEvidenceIds = new Set(projectSeries.flatMap(item => item.evidence.map(assignment => assignment.evidenceId)));
  const series = projectSeries.map(item => {
    const excludedEvidence: ProjectProgressModel['trend']['series'][number]['excludedEvidence'] = [];
    const seriesObservations = item.evidence.flatMap(assignment => {
      const evidenceItem = evidence.find(candidate => candidate.id === assignment.evidenceId);
      if (!evidenceItem) return [];
      const correctionTime = timestamp(evidenceItem.lastCorrectedAt);
      const confirmationTime = timestamp(assignment.confirmedAt);
      if (correctionTime !== null && confirmationTime !== null && correctionTime > confirmationTime) {
        const stillAComparableMeasurement = evidenceItem.links.includes('milestone') && evidenceItem.benchmarkComplete === true
          && typeof evidenceItem.latencyMs === 'number' && Number.isFinite(evidenceItem.latencyMs)
          && timestamp(evidenceItem.observedAt) !== null;
        excludedEvidence.push({
          id: assignment.evidenceId,
          reference: evidenceItem.reference,
          source: evidenceItem.source,
          text: evidenceItem.text,
          reason: '此证据在加入序列后被更正；请核对新内容并重新确认口径。',
          canReconfirm: stillAComparableMeasurement,
        });
        return [];
      }
      const observation = observationsById.get(assignment.evidenceId);
      if (!observation) {
        excludedEvidence.push({
          id: assignment.evidenceId,
          reference: evidenceItem.reference,
          source: evidenceItem.source,
          text: evidenceItem.text,
          reason: '更正后不再满足完整延迟观测条件，未纳入趋势。',
          canReconfirm: false,
        });
      }
      return observation ? [observation] : [];
    }).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.id.localeCompare(b.id));
    const firstToLastDeltaMs = seriesObservations.length >= 2
      ? seriesObservations[seriesObservations.length - 1].value - seriesObservations[0].value
      : null;
    const gap = seriesObservations.length >= 2 ? null
      : excludedEvidence.length ? '部分已选证据经更正后不再是有效的完整延迟观测；当前有效观测不足两次，未计算差值。'
        : seriesObservations.length === 1 ? '此口径当前只有一次有效观测，无法判断趋势或计算差值。'
          : '此口径当前没有有效的完整延迟观测，未计算差值。';
    return {
      id: item.id,
      name: item.name,
      basis: item.basis,
      confirmedComparableAt: item.confirmedComparableAt,
      evidenceIds: item.evidence.map(assignment => assignment.evidenceId),
      observations: seriesObservations,
      excludedEvidence,
      firstToLastDeltaMs,
      gap,
    };
  });
  return {
    unassignedObservations: observations.filter(item => !assignedEvidenceIds.has(item.id)),
    series,
    applicableRule: null,
  };
}

export function deriveProjectProgress(project: GoalProject, actions: GoalPlanAction[], deliverables: ProjectDeliverable[] = [], measurementSeries: ProjectMeasurementSeries[] = []): ProjectProgressModel {
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
    trend: makeTrend(project, measurementSeries),
  };
}
