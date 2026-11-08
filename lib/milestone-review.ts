import type { Evidence, Result } from './model';

export type MilestoneConfirmation = {
  nodeId: 'milestone';
  confirmedAt: string;
  evidenceIds: string[];
};

export type MilestoneReview = Result & {
  id: 'milestone';
  evidenceIds: string[];
  method: '规则核验' | 'Agent 汇总';
  reasoning: string;
  confirmationRequired: boolean;
  confirmationRequirement: string;
  canConfirm: boolean;
  confirmedAt: string | null;
};

const standard = '完整基准测试的实测延迟低于 200 ms';
const confirmationRequirement = '核对当前证据后由用户确认；确认前不记为达成。';

function hasCurrentConfirmation(evidence: Evidence, confirmation: MilestoneConfirmation | null) {
  return Boolean(confirmation && confirmation.evidenceIds.length === 1 && confirmation.evidenceIds[0] === evidence.id);
}

function isCompleteMeasurement(item: Evidence): item is Evidence & { latencyMs: number } {
  return item.benchmarkComplete === true && typeof item.latencyMs === 'number' && Number.isFinite(item.latencyMs);
}

export function evaluateMilestone(evidence: Evidence[], confirmation: MilestoneConfirmation | null = null): MilestoneReview {
  const milestoneEvidence = evidence.filter(item => item.links.includes('milestone'));
  const measured = milestoneEvidence
    .filter(isCompleteMeasurement)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.createdAt.localeCompare(a.createdAt))[0];

  const result = (status: string, tone: Result['tone'], detail: string, gap: string, reasoning: string, canConfirm = false, confirmedAt: string | null = null): MilestoneReview => ({
    id: 'milestone',
    evidenceIds: measured ? [measured.id] : [],
    title: '里程碑',
    status,
    tone,
    standard,
    detail,
    gap,
    evidence: milestoneEvidence,
    method: '规则核验',
    reasoning,
    confirmationRequired: true,
    confirmationRequirement,
    canConfirm,
    confirmedAt,
  });

  if (!measured) {
    return result(
      '证据不足',
      'neutral',
      '尚无完整基准测试的可用延迟测量。',
      '缺少完整基准测试的延迟测量',
      '规则需要完整基准测试和实测延迟，当前证据尚不能判定是否达到标准。',
    );
  }

  if (measured.level !== 'E2' && measured.level !== 'E3') {
    return result(
      '证据不足',
      'neutral',
      `完整基准测试记录为 ${measured.latencyMs} ms，但该证据为 ${measured.level}。`,
      '关键里程碑的高置信度进展需要符合标准的 E2 或 E3 证据',
      `已记录完整实测值 ${measured.latencyMs} ms；${measured.level} 证据不足以支持关键里程碑的高置信度判定。`,
    );
  }

  if (measured.latencyMs >= 200) {
    return result(
      '本次实测未达标',
      'warning',
      `最近一次符合证据要求的完整基准测试为 ${measured.latencyMs} ms，未低于 200 ms。`,
      '本次实测未达到里程碑标准',
      `${measured.level} 证据支持本次完整实测；实测值 ${measured.latencyMs} ms 未满足严格低于 200 ms 的条件。`,
    );
  }

  if (hasCurrentConfirmation(measured, confirmation)) {
    return result(
      '已确认达成',
      'success',
      `用户已确认当前完整基准测试结果：${measured.latencyMs} ms。`,
      '无',
      `规则核验显示 ${measured.level} 证据支持的实测值 ${measured.latencyMs} ms 低于 200 ms；用户已确认。`,
      false,
      confirmation!.confirmedAt,
    );
  }

  return result(
    '达到标准，待确认',
    'success',
    `最近一次符合证据要求的完整基准测试为 ${measured.latencyMs} ms，达到标准。`,
    '无',
    `${measured.level} 证据支持的实测值 ${measured.latencyMs} ms 低于 200 ms；仍需用户确认后才记为达成。`,
    true,
  );
}

export type QualitativeOutcome = 'insufficient' | 'not-met' | 'met';

export function qualitativeMilestoneReview(input: {
  standard: string;
  summary: string;
  reasons: string[];
  evidence: Evidence[];
  outcome: QualitativeOutcome;
  confirmationRequired: boolean;
  confirmation: MilestoneConfirmation | null;
}): MilestoneReview {
  const { standard: qualitativeStandard, summary, reasons, evidence, outcome, confirmationRequired, confirmation } = input;
  const currentEvidenceIds = new Set(evidence.map(item => item.id));
  const sameEvidenceSnapshot = confirmation
    && confirmation.evidenceIds.length === currentEvidenceIds.size
    && confirmation.evidenceIds.every(id => currentEvidenceIds.has(id));
  const confirmedAt = sameEvidenceSnapshot ? confirmation.confirmedAt : null;
  const hasQualifiedEvidence = evidence.some(item => item.level === 'E2' || item.level === 'E3');
  const effectiveOutcome: QualitativeOutcome = hasQualifiedEvidence ? outcome : 'insufficient';
  const confirmed = effectiveOutcome === 'met' && confirmationRequired && Boolean(confirmedAt);
  const pending = effectiveOutcome === 'met' && confirmationRequired && !confirmed;
  let status: string;
  if (effectiveOutcome === 'insufficient') status = '证据不足';
  else if (effectiveOutcome === 'not-met') status = '未满足标准';
  else if (pending) status = '达到标准，待确认';
  else if (confirmationRequired) status = '已确认达成';
  else status = '达到标准';
  const tone: Result['tone'] = effectiveOutcome === 'not-met' ? 'warning' : effectiveOutcome === 'met' ? 'success' : 'neutral';

  return {
    id: 'milestone',
    evidenceIds: [...currentEvidenceIds],
    title: '里程碑',
    status,
    tone,
    standard: qualitativeStandard,
    detail: summary,
    gap: effectiveOutcome === 'insufficient'
      ? hasQualifiedEvidence ? 'Agent 汇总后仍缺少足以判断的证据' : '关键里程碑的高置信度进展需要符合标准的 E2 或 E3 证据'
      : '无',
    evidence,
    method: 'Agent 汇总',
    reasoning: reasons.join(' '),
    confirmationRequired,
    confirmationRequirement: confirmationRequired ? '达到标准后由用户核对证据并确认。' : '此里程碑无需额外确认。',
    canConfirm: pending,
    confirmedAt: confirmed ? confirmedAt : null,
  };
}
