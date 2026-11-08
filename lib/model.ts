export const nodes = [
  { id: 'goal', type: '目标', title: '提升系统性能', parent: null, description: '通过可验证的基准测试，持续改善系统响应速度。' },
  { id: 'task', type: '任务', title: '提交测试报告', parent: 'goal', description: '按要求提交测试报告。' },
  { id: 'milestone', type: '里程碑', title: '响应延迟低于 200 ms', parent: 'goal', description: '完整基准测试的实测延迟严格低于 200 ms。' },
] as const;
export type NodeId = typeof nodes[number]['id'];
export type Evidence = { id: string; text: string; source: string; reference: string; observedAt: string; createdAt: string; links: NodeId[]; reportSubmitted: boolean | null; latencyMs: number | null; benchmarkComplete: boolean | null };
export type Result = { title: string; status: string; tone: 'success' | 'warning' | 'neutral'; standard: string; detail: string; gap: string; evidence: Evidence[] };
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
