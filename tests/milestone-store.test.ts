import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateMilestone } from '../lib/milestone-review';
import { confirmMilestone, correctEvidence, getMilestoneConfirmation, listChangeEvents, listMilestoneChanges } from '../lib/milestone-store';
import { listEvidence, saveEvidence } from '../lib/store';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-milestone-test-'));
process.env.BUILDYOURSELF_DB = join(dir, 'graph.sqlite');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function saveMeasurement(input: { level: 'E1' | 'E2' | 'E3'; latencyMs: number; observedAt: string }) {
  return saveEvidence({
    text: `完整基准测试测得延迟 ${input.latencyMs} ms`,
    source: '基准测试报告',
    reference: 'report',
    observedAt: input.observedAt,
    links: ['milestone'],
    level: input.level,
    reportSubmitted: null,
    latencyMs: input.latencyMs,
    benchmarkComplete: true,
  });
}

describe('里程碑确认记录', () => {
  it('拒绝不符合证据等级的确认请求', () => {
    saveMeasurement({ level: 'E1', latencyMs: 199, observedAt: '2026-11-08T12:00:00.000Z' });
    expect(() => confirmMilestone('milestone')).toThrow('不满足确认条件');
    expect(getMilestoneConfirmation()).toBeNull();
    expect(listMilestoneChanges()).toHaveLength(0);
  });

  it('原子保存用户确认和变更记录，重复请求不重复记录', () => {
    const evidence = saveMeasurement({ level: 'E2', latencyMs: 199, observedAt: '2026-11-08T12:01:00.000Z' });
    const result = confirmMilestone('milestone');
    expect(result.created).toBe(true);
    expect(result.confirmation.evidenceIds).toEqual([evidence.id]);
    expect(evaluateMilestone(listEvidence(), getMilestoneConfirmation()).status).toBe('已确认达成');
    expect(listMilestoneChanges()).toHaveLength(1);

    expect(confirmMilestone('milestone').created).toBe(false);
    expect(listMilestoneChanges()).toHaveLength(1);
  });

  it('新实测需要新的确认，并保留此前的变更记录', () => {
    const evidence = saveMeasurement({ level: 'E3', latencyMs: 180, observedAt: '2026-11-08T12:02:00.000Z' });
    expect(evaluateMilestone(listEvidence(), getMilestoneConfirmation()).status).toBe('达到标准，待确认');
    const result = confirmMilestone('milestone');
    expect(result.created).toBe(true);
    expect(result.confirmation.evidenceIds).toEqual([evidence.id]);
    expect(listMilestoneChanges()).toHaveLength(2);
  });

  it('更正同一份证据会重算所有引用判定并撤销过期的里程碑确认', () => {
    const evidenceCount = listEvidence().length;
    const evidence = saveEvidence({
      text: '报告已提交，延迟 199 ms',
      source: '基准测试报告',
      reference: 'report',
      observedAt: '2026-11-08T12:03:00.000Z',
      links: ['task', 'milestone'],
      level: 'E2',
      reportSubmitted: true,
      latencyMs: 199,
      benchmarkComplete: true,
    });
    confirmMilestone('milestone');

    const corrected = correctEvidence(evidence.id, {
      text: '报告尚未提交，延迟 230 ms',
      source: '基准测试报告（更正）',
      reference: 'report corrected',
      observedAt: '2026-11-08T12:03:00.000Z',
      links: ['task', 'milestone'],
      level: 'E2',
      reportSubmitted: false,
      latencyMs: 230,
      benchmarkComplete: true,
    });

    expect(corrected.evidence).toMatchObject({ id: evidence.id, text: '报告尚未提交，延迟 230 ms', revisionCount: 1 });
    expect(corrected.evidence.revisions?.[0]).toMatchObject({ before: { text: '报告已提交，延迟 199 ms' }, after: { text: '报告尚未提交，延迟 230 ms' } });
    expect(corrected.confirmationInvalidated).toBe(true);
    expect(getMilestoneConfirmation()).toBeNull();
    expect(evaluateMilestone(listEvidence(), getMilestoneConfirmation()).status).toBe('本次实测未达标');
    expect(corrected.resultChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '交付', beforeStatus: '交付已验收', afterStatus: '证据不足' }),
      expect.objectContaining({ title: '里程碑', beforeStatus: '已确认达成', afterStatus: '本次实测未达标' }),
    ]));
    expect(listEvidence()).toHaveLength(evidenceCount + 1);
    expect(listEvidence().find(item => item.id === evidence.id)?.createdAt).toBe(evidence.createdAt);
    expect(listChangeEvents()[0]).toMatchObject({ eventType: 'evidence.corrected', evidenceIds: [evidence.id], confirmationInvalidated: true });
  });
});
