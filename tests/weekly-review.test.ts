import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activateGoalPlan, saveGoalPlanDraft } from '../lib/goal-plans';
import { generateAndSaveDailyPlan, confirmDailyPlan } from '../lib/daily-plan-store';
import { saveEvidence } from '../lib/store';
import { getWeeklyReview, saveWeeklyReview } from '../lib/weekly-review-store';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-weekly-review-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function completePlan() {
  return {
    sourceIntent: '完成性能基准测试',
    title: '改善响应延迟',
    domain: 'project',
    successDescription: '完整基准测试延迟低于 200 ms。',
    observableResult: '保存一份可复核的报告。',
    baselineStatus: 'known',
    milestones: [{
      id: 'latency-milestone', title: '响应延迟低于 200 ms', stage: 'near', successCriteria: '完整测试低于 200 ms。',
      standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: '保存完整测试结果。', evidenceRequirement: '完整测试报告。',
    }],
    nextActions: [{ id: 'run-benchmark', title: '运行完整基准测试', specificity: 'concrete', estimateMinutes: 45, priority: 'high', milestoneId: 'latency-milestone' }],
    constraints: { status: 'confirmed', items: [] },
    evidenceRequirements: [{ item: '基准测试', description: '保存完整报告。', minimumLevel: 'E2' }],
    reviewCycleDays: 7,
  };
}

describe('周复盘', () => {
  it('区分计划投入、结果与缺测量，并只提出一项补测建议', () => {
    const review = getWeeklyReview('2026-11-09');

    expect(review.status).toBe('draft');
    expect(review.review.executionEffort.plannedMinutes).toBe(0);
    expect(review.review.exampleGraph.delivery.status).toBe('证据不足');
    expect(review.review.exampleGraph.capability.status).toBe('证据不足');
    expect(review.review.exampleGraph.evidenceGaps.join(' ')).toContain('延迟测量');
    expect(review.review.facts.length).toBeGreaterThan(0);
    expect(review.review.hypotheses.length).toBeGreaterThan(0);
    expect(review.review.adjustment).toMatchObject({ kind: 'measure', milestoneId: 'milestone' });
    expect(review.review.adjustment.verificationDate).toBe('2026-11-22');
  });

  it('有完整但未达标的合格实测时才建议改变单一练习变量', () => {
    saveEvidence({
      text: '完整基准测试测得延迟 240 ms', source: '测试报告', reference: 'report-240',
      observedAt: '2026-11-11T10:00:00.000Z', links: ['milestone'], level: 'E2',
      reportSubmitted: null, latencyMs: 240, benchmarkComplete: true,
    });

    const review = getWeeklyReview('2026-11-09');
    expect(review.review.exampleGraph.capability.status).toBe('本次实测未达标');
    expect(review.review.adjustment.kind).toBe('practice');
    expect(review.review.adjustment.expectedResult).toContain('200 ms');
  });

  it('报告已提交只改善交付结论，不自动推断能力进展', () => {
    saveEvidence({
      text: '报告已通过提交系统上传', source: '提交记录', reference: 'submission-1',
      observedAt: '2026-11-11T10:00:00.000Z', links: ['task'], level: 'E2',
      reportSubmitted: true, latencyMs: null, benchmarkComplete: null,
    });

    const review = getWeeklyReview('2026-11-09');
    expect(review.review.exampleGraph.delivery.status).toBe('交付已验收');
    expect(review.review.exampleGraph.capability.status).toBe('证据不足');
    expect(review.review.adjustment.kind).toBe('measure');
    expect(review.review.evidence[0]).toMatchObject({ source: '提交记录', reference: 'submission-1' });
  });

  it('已达到标准的完整实测建议复测稳定性，不错误提示缺少测量', () => {
    saveEvidence({
      text: '完整基准测试测得延迟 190 ms', source: '测试报告', reference: 'report-190',
      observedAt: '2026-11-11T10:00:00.000Z', links: ['milestone'], level: 'E2',
      reportSubmitted: null, latencyMs: 190, benchmarkComplete: true,
    });

    const review = getWeeklyReview('2026-11-09');
    expect(review.review.exampleGraph.capability.status).toBe('达到标准，待确认');
    expect(review.review.adjustment.title).toContain('复测');
    expect(review.review.adjustment.rationale).toContain('190 ms');
    expect(review.review.adjustment.rationale).not.toContain('没有足以判断');
  });

  it('根据已确认周计划说明容量偏差，但不把计划分钟数当作实际工时', () => {
    const goal = saveGoalPlanDraft(completePlan());
    activateGoalPlan(goal.id);
    generateAndSaveDailyPlan('2026-11-09', {
      '2026-11-09': 0, '2026-11-10': 0, '2026-11-11': 0, '2026-11-12': 0,
      '2026-11-13': 0, '2026-11-14': 0, '2026-11-15': 0,
    });
    confirmDailyPlan('2026-11-09');

    const review = getWeeklyReview('2026-11-09');
    expect(review.review.executionEffort.plannedMinutes).toBe(0);
    expect(review.review.plannedActions).toHaveLength(0);
    expect(review.review.deviations.join(' ')).toContain('容量');
    expect(review.review.executionEffort.actualEffortAvailable).toBe(false);
  });

  it('保存后重新打开仍返回原快照，不重算已更正的证据', () => {
    const draft = getWeeklyReview('2026-11-09');
    saveEvidence({
      text: '完整基准测试测得延迟 190 ms', source: '测试报告', reference: 'report-190',
      observedAt: '2026-11-12T10:00:00.000Z', links: ['milestone'], level: 'E2',
      reportSubmitted: null, latencyMs: 190, benchmarkComplete: true,
    });
    const saved = saveWeeklyReview('2026-11-09', draft.review.adjustment);

    expect(saved.status).toBe('saved');
    expect(saved.review.evidence).toEqual([]);
    expect(saved.review.exampleGraph.capability.status).toBe('证据不足');
    saveEvidence({
      text: '第二次完整基准测试测得延迟 185 ms', source: '测试报告', reference: 'report-185',
      observedAt: '2026-11-13T10:00:00.000Z', links: ['milestone'], level: 'E2',
      reportSubmitted: null, latencyMs: 185, benchmarkComplete: true,
    });
    expect(getWeeklyReview('2026-11-09')).toEqual(saved);
    expect(saveWeeklyReview('2026-11-09', { ...draft.review.adjustment, title: '后来改写的建议' })).toEqual(saved);
  });

  it('只接受有效周一作为复盘起点', () => {
    expect(() => getWeeklyReview('2026-11-10')).toThrow('星期一');
  });

  it('验证日期必须晚于复盘周，空建议不能保存', () => {
    const draft = getWeeklyReview('2026-11-09');
    expect(() => saveWeeklyReview('2026-11-09', { ...draft.review.adjustment, verificationDate: '2026-11-15' })).toThrow('本周结束后');
    expect(() => saveWeeklyReview('2026-11-09', { ...draft.review.adjustment, title: ' ' })).toThrow('不能为空');
  });

  it('按本地日历周边界筛选证据，不把周一前一刻的记录算进本周', () => {
    const mondayStart = new Date('2026-11-09T00:00:00').getTime();
    const beforeMonday = new Date(mondayStart - 1).toISOString();
    const monday = new Date(mondayStart).toISOString();
    saveEvidence({ text: '上周提交', source: '提交系统', reference: 'previous-week', observedAt: beforeMonday, links: ['task'], level: 'E2', reportSubmitted: true, latencyMs: null, benchmarkComplete: null });
    const current = saveEvidence({ text: '本周提交', source: '提交系统', reference: 'current-week', observedAt: monday, links: ['task'], level: 'E2', reportSubmitted: true, latencyMs: null, benchmarkComplete: null });

    expect(getWeeklyReview('2026-11-09').review.evidence.map(item => item.id)).toEqual([current.id]);
  });
});
