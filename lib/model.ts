export const nodes = [
  { id: 'goal', type: '目标', title: '提升系统性能', parent: null, description: '通过可验证的基准测试，持续改善系统响应速度。' },
  { id: 'task', type: '任务', title: '提交测试报告', parent: 'goal', description: '按要求提交测试报告。' },
  { id: 'milestone', type: '里程碑', title: '响应延迟低于 200 ms', parent: 'goal', description: '完整基准测试的实测延迟严格低于 200 ms。' },
] as const;
export type NodeId = typeof nodes[number]['id'];
export type EvidenceNodeId = Extract<NodeId, 'task' | 'milestone'>;
export type EvidenceLevel = 'E1' | 'E2' | 'E3';
export type MinimumEvidenceLevel = 'E0' | EvidenceLevel;
export const evidenceLevels: Record<MinimumEvidenceLevel, { title: string; trust: string }> = {
  E0: { title: '无需证据', trust: '仅执行状态' },
  E1: { title: '用户自报', trust: '低可信度' },
  E2: { title: '可验证产出', trust: '中可信度' },
  E3: { title: '外部专业反馈', trust: '高可信度' },
};
export const defaultEvidenceRequirements: Record<EvidenceNodeId, MinimumEvidenceLevel> = { task: 'E1', milestone: 'E2' };
export type EvidenceSnapshot = {
  id: string;
  text: string;
  source: string;
  reference: string;
  observedAt: string;
  createdAt: string;
  links: NodeId[];
  goalPlanId?: string | null;
  goalActionId?: string | null;
  level: EvidenceLevel;
  reportSubmitted: boolean | null;
  latencyMs: number | null;
  benchmarkComplete: boolean | null;
};
export type EvidenceRevision = { changedAt: string; before: EvidenceSnapshot; after: EvidenceSnapshot };
export type Evidence = EvidenceSnapshot & { revisionCount?: number; lastCorrectedAt?: string | null; revisions?: EvidenceRevision[] };
export type Result = { title: string; status: string; tone: 'success' | 'warning' | 'neutral'; standard: string; detail: string; gap: string; evidence: Evidence[] };
export type EvidenceAssessment = { nodeId: EvidenceNodeId; requiredLevel: MinimumEvidenceLevel; status: '无需证据' | '证据不足' | '证据充足'; summary: string; gap: string; highestLevel: EvidenceLevel | null; evidence: Evidence[] };
export type TaskExecution = { completedAt: string | null };

const evidenceRanks: Record<MinimumEvidenceLevel, number> = { E0: 0, E1: 1, E2: 2, E3: 3 };
export function isEvidenceLevel(value: unknown): value is EvidenceLevel {
  return value === 'E1' || value === 'E2' || value === 'E3';
}
export function isMinimumEvidenceLevel(value: unknown): value is MinimumEvidenceLevel {
  return value === 'E0' || isEvidenceLevel(value);
}
export function assessEvidence(evidence: Evidence[], nodeId: EvidenceNodeId, requiredLevel: MinimumEvidenceLevel): EvidenceAssessment {
  const linked = evidence.filter(item => item.links.includes(nodeId));
  const highestLevel = linked.reduce<EvidenceLevel | null>((highest, item) => !highest || evidenceRanks[item.level] > evidenceRanks[highest] ? item.level : highest, null);
  if (requiredLevel === 'E0') {
    return { nodeId, requiredLevel, status: '无需证据', summary: '此对象设置为无需附加证据。', gap: '无', highestLevel, evidence: linked };
  }
  const qualified = linked.filter(item => evidenceRanks[item.level] >= evidenceRanks[requiredLevel]);
  if (qualified.length) {
    const best = qualified.reduce((current, item) => evidenceRanks[item.level] > evidenceRanks[current.level] ? item : current);
    return { nodeId, requiredLevel, status: '证据充足', summary: `已有 ${best.level}（${evidenceLevels[best.level].title}）证据，达到最低要求。`, gap: '无', highestLevel, evidence: linked };
  }
  const required = `${requiredLevel}（${evidenceLevels[requiredLevel].title}）`;
  const gap = highestLevel
    ? `当前最高为 ${highestLevel}（${evidenceLevels[highestLevel].title}），还需 ${required} 或更高等级证据。`
    : `缺少 ${required} 或更高等级证据。`;
  return { nodeId, requiredLevel, status: '证据不足', summary: highestLevel ? `当前证据未达到 ${required}。` : '尚无关联证据。', gap, highestLevel, evidence: linked };
}

export function evaluate(evidence: Evidence[]): Result[] {
  const task = evidence.filter(e => e.links.includes('task'));
  const milestone = evidence.filter(e => e.links.includes('milestone'));
  const submitted = task.some(e => e.reportSubmitted === true);
  const measured = milestone.filter(e => e.benchmarkComplete === true && e.latencyMs !== null).sort((a,b) => b.observedAt.localeCompare(a.observedAt) || b.createdAt.localeCompare(a.createdAt))[0];
  return [
    { title:'交付', status: submitted ? '交付已验收' : '证据不足', tone: submitted ? 'success' : 'neutral', standard:'提交测试报告', detail: submitted ? '已记录报告按要求提交。' : '尚无已确认提交报告的证据。', gap: submitted ? '无' : '缺少报告提交情况', evidence:task },
    { title:'里程碑', status: measured ? (measured.latencyMs! < 200 ? '达到标准，待确认' : '本次实测未达标') : '证据不足', tone: measured ? (measured.latencyMs! < 200 ? 'success' : 'warning') : 'neutral', standard:'完整基准测试的实测延迟低于 200 ms', detail: measured ? `最近一次完整基准测试：${measured.latencyMs} ms。` : '尚无完整基准测试的可用延迟测量。', gap: measured ? '无' : '缺少完整基准测试的延迟测量', evidence:milestone }
  ];
}
