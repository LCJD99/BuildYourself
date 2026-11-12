import { describe, expect, it } from 'vitest';
import { evaluateMilestone, qualitativeMilestoneReview } from '../lib/milestone-review';
import type { Evidence } from '../lib/model';

const evidence: Evidence = {
  id: 'evidence-1',
  text: '完整基准测试测得延迟 199 ms',
  source: '基准测试报告',
  reference: 'report-1',
  observedAt: '2026-11-08T12:00:00.000Z',
  createdAt: '2026-11-08T12:01:00.000Z',
  links: ['milestone'],
  level: 'E2',
  reportSubmitted: null,
  latencyMs: 199,
  benchmarkComplete: true,
};

describe('里程碑核对', () => {
  it('未有完整实测时显示证据不足', () => {
    const result = evaluateMilestone([{ ...evidence, latencyMs: null }]);
    expect(result.status).toBe('证据不足');
    expect(result.gap).toContain('完整基准测试');
    expect(result.canConfirm).toBe(false);
  });

  it('完整实测不满足 E2/E3 门槛时仍显示证据不足', () => {
    const result = evaluateMilestone([{ ...evidence, level: 'E1' }]);
    expect(result.status).toBe('证据不足');
    expect(result.gap).toContain('E2 或 E3');
    expect(result.canConfirm).toBe(false);
  });

  it('完整实测未达标时不给确认入口', () => {
    const result = evaluateMilestone([{ ...evidence, latencyMs: 200 }]);
    expect(result.status).toBe('本次实测未达标');
    expect(result.canConfirm).toBe(false);
  });

  it('达到标准后等待用户确认，并展示确认要求', () => {
    const result = evaluateMilestone([evidence]);
    expect(result.status).toBe('达到标准，待确认');
    expect(result.confirmationRequired).toBe(true);
    expect(result.canConfirm).toBe(true);
    expect(result.confirmationRequirement).toContain('用户确认');
  });

  it('有持久化确认记录时显示已确认达成', () => {
    const result = evaluateMilestone([evidence], {
      nodeId: 'milestone',
      confirmedAt: '2026-11-08T12:05:00.000Z',
      evidenceIds: ['evidence-1'],
    });
    expect(result.status).toBe('已确认达成');
    expect(result.canConfirm).toBe(false);
    expect(result.confirmedAt).toBe('2026-11-08T12:05:00.000Z');
  });

  it('定性评价呈现 Agent 摘要、理由和适用的确认要求', () => {
    const result = qualitativeMilestoneReview({
      standard: '能够独立完成一次英文演示',
      summary: '提交的演示录像显示用户能够连续完成介绍和问答。',
      reasons: ['录像包含完整演示。', '外部反馈指出问答表达清楚。'],
      evidence: [{ ...evidence, text: '演示录像与导师反馈', level: 'E3' }],
      outcome: 'met',
      confirmationRequired: true,
      confirmation: null,
    });
    expect(result.method).toBe('Agent 汇总');
    expect(result.detail).toContain('演示录像');
    expect(result.reasoning).toContain('外部反馈');
    expect(result.status).toBe('达到标准，待确认');
    expect(result.confirmationRequirement).toContain('用户');
  });

  it('定性评价没有符合要求的 E2/E3 证据时不开放确认', () => {
    const result = qualitativeMilestoneReview({
      standard: '能够独立完成一次英文演示',
      summary: '用户自述已完成演示。',
      reasons: ['当前只有用户自报。'],
      evidence: [{ ...evidence, level: 'E1' }],
      outcome: 'met',
      confirmationRequired: true,
      confirmation: null,
    });
    expect(result.status).toBe('证据不足');
    expect(result.gap).toContain('E2 或 E3');
    expect(result.canConfirm).toBe(false);
  });

  it('定性里程碑使用契约指定的最低证据等级', () => {
    const result = qualitativeMilestoneReview({
      standard: '提交一次书面反思',
      summary: '调用方认为已完成书面反思。',
      reasons: [],
      evidence: [{ ...evidence, level: 'E1' }],
      outcome: 'met',
      confirmationRequired: true,
      confirmation: null,
      minimumEvidenceLevel: 'E1',
    });

    expect(result.status).toBe('达到标准，待确认');
    expect(result.canConfirm).toBe(true);
  });

  it('未达标结论也须用户核对，不把 Agent 总结当作系统判定', () => {
    const result = qualitativeMilestoneReview({
      standard: '完成一次英语演示',
      summary: '调用方认为仍未完成问答部分。',
      reasons: ['当前录像没有问答。'],
      evidence: [evidence],
      outcome: 'not-met',
      confirmationRequired: true,
      confirmation: null,
    });

    expect(result.status).toBe('未满足标准，待确认');
    expect(result.canConfirm).toBe(true);
  });
});
