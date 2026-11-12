import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activateGoalPlan, listGoalPlanActions, markGoalPlanActionDone, saveGoalPlanDraft } from '../lib/goal-plans';
import { confirmDailyPlan, generateAndSaveDailyPlan } from '../lib/daily-plan-store';
import { saveEvidence } from '../lib/store';
import { getWeeklyReview, saveWeeklyReview } from '../lib/weekly-review-store';

const dir = mkdtempSync(join(tmpdir(), 'buildyourself-weekly-review-'));
beforeEach(() => { process.env.BUILDYOURSELF_DB = join(dir, `${randomUUID()}.sqlite`); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function currentWeekStart() {
  const today = new Date();
  const day = today.getUTCDay();
  today.setUTCDate(today.getUTCDate() - ((day + 6) % 7));
  return today.toISOString().slice(0, 10);
}

function createGoalPlan(minimumLevel: 'E2' | 'E3' = 'E2', successCriteria = '完整基准测试响应延迟低于 200 ms') {
  const draft = saveGoalPlanDraft({
    sourceIntent: '改善服务响应延迟',
    title: '改善服务响应延迟',
    domain: 'project',
    context: '服务性能调优',
    successDescription: successCriteria,
    observableResult: '保存完整基准报告并复测响应延迟。',
    baselineStatus: 'known',
    baselineAction: '运行完整基准测试并记录延迟。',
    milestones: [{
      id: 'latency-milestone', title: '响应延迟低于 200 ms', stage: 'near',
      successCriteria, standardAssessment: 'reasonable',
      evidenceAvailability: 'available', reviewNote: '保存完整报告与测试条件。',
      evidenceRequirement: minimumLevel === 'E3' ? '完整基准测试 E3 结果。' : '完整基准测试 E2 或 E3 结果。',
    }],
    nextActions: [{
      id: 'run-benchmark', title: '运行完整基准测试', details: '保持环境固定并保存结果。',
      estimateMinutes: 45, priority: 'high', hardDeadline: null, milestoneId: 'latency-milestone',
      dependsOn: [], specificity: 'concrete',
    }],
    constraints: { status: 'confirmed', items: [] },
    evidenceRequirements: [{ id: 'benchmark-result', item: '基准结果', description: '保存完整报告。', minimumLevel }],
    reviewCycleDays: 7,
  });
  activateGoalPlan(draft.id);
  return draft.id;
}

function scheduleGoal(weekStart: string) {
  generateAndSaveDailyPlan(weekStart);
  confirmDailyPlan(weekStart);
}

function saveBenchmark(goalPlanId: string, goalActionId: string, latencyMs: number, level: 'E2' | 'E3' = 'E2') {
  return saveEvidence({
    text: `完整基准测试测得延迟 ${latencyMs} ms`, source: '测试报告', reference: `report-${latencyMs}`,
    observedAt: new Date().toISOString(), links: ['milestone'], level,
    reportSubmitted: null, latencyMs, benchmarkComplete: true, goalPlanId, goalActionId,
  });
}

describe('目标周复盘', () => {
  it('按真实目标与里程碑汇总行动和证据，结果未达标时建议一项有依据的复测步骤', () => {
    const weekStart = currentWeekStart();
    const goalPlanId = createGoalPlan();
    scheduleGoal(weekStart);
    const action = listGoalPlanActions(goalPlanId)[0];
    markGoalPlanActionDone(action.id);
    saveBenchmark(goalPlanId, action.id, 240);

    const { review } = getWeeklyReview(weekStart, 'UTC');
    const goal = review.goals.find(item => item.goalPlanId === goalPlanId)!;
    const milestone = goal.milestones.find(item => item.milestoneId === 'latency-milestone')!;

    expect(review.executionEffort).toMatchObject({ plannedActionCount: 1, plannedMinutes: 45, completedActionCount: 1 });
    expect(goal).toMatchObject({ title: '改善服务响应延迟', completedActionCount: 1, evidenceCount: 1, qualifiedEvidenceCount: 1 });
    expect(milestone).toMatchObject({ status: '本周关联实测未达标', completedActionCount: 1, evidenceCount: 1 });
    expect(review.adjustment).toMatchObject({
      kind: 'measure', goalPlanId, goalTitle: '改善服务响应延迟', milestoneId: 'latency-milestone',
      actionId: action.id, verificationDate: expect.any(String),
    });
    expect(review.adjustment.expectedResult).toContain('200 ms');
    expect(review.adjustment.title).toContain('固定测试环境');
    expect(review.adjustment.rationale).toContain('待验证推断');
    expect(review.facts.join(' ')).toContain('E2/E3');
    expect(review.hypotheses.join(' ')).toContain('并发请求数只是待验证变量');
  });

  it('缺少目标测量时，建议为该目标的具体里程碑行动补充可复核结果', () => {
    const weekStart = currentWeekStart();
    const goalPlanId = createGoalPlan();
    scheduleGoal(weekStart);

    const { review } = getWeeklyReview(weekStart, 'UTC');
    const action = listGoalPlanActions(goalPlanId)[0];
    expect(review.adjustment).toMatchObject({ kind: 'measure', goalPlanId, milestoneId: 'latency-milestone', actionId: action.id });
    expect(review.adjustment.expectedResult).toContain('可复核结果');
    expect(review.evidenceGaps.join(' ')).toContain('达到 E2 门槛且关联到里程碑行动');
  });

  it('低等级或未关联具体行动的测量不会被当作里程碑达标依据', () => {
    const weekStart = currentWeekStart();
    const goalPlanId = createGoalPlan();
    const action = listGoalPlanActions(goalPlanId)[0];
    saveEvidence({
      text: '完整基准测试测得延迟 350 ms', source: '用户自报', reference: 'low-level-measure',
      observedAt: new Date().toISOString(), links: ['milestone'], level: 'E1',
      reportSubmitted: null, latencyMs: 350, benchmarkComplete: true, goalPlanId, goalActionId: action.id,
    });
    saveEvidence({
      text: '目标级结果没有指出具体里程碑行动', source: '项目记录', reference: 'goal-only-measure',
      observedAt: new Date().toISOString(), links: ['milestone'], level: 'E3',
      reportSubmitted: null, latencyMs: 500, benchmarkComplete: true, goalPlanId,
    });

    const { review } = getWeeklyReview(weekStart, 'UTC');
    const milestone = review.goals.find(goal => goal.goalPlanId === goalPlanId)!.milestones[0];
    expect(milestone.evidenceCount).toBe(1);
    expect(milestone.qualifiedEvidenceCount).toBe(0);
    expect(milestone.status).not.toContain('未达标');
    expect(review.adjustment.kind).toBe('measure');
  });

  it('目标要求 E3 时，关联 E2 实测不能判作达标或符合证据要求', () => {
    const weekStart = currentWeekStart();
    const goalPlanId = createGoalPlan('E3');
    const action = listGoalPlanActions(goalPlanId)[0];
    saveBenchmark(goalPlanId, action.id, 350);

    const { review } = getWeeklyReview(weekStart, 'UTC');
    const milestone = review.goals.find(goal => goal.goalPlanId === goalPlanId)!.milestones[0];
    expect(milestone.requiredEvidenceLevel).toBe('E3');
    expect(milestone.qualifiedEvidenceCount).toBe(0);
    expect(milestone.status).not.toContain('未达标');
    expect(review.adjustment.kind).toBe('measure');
    expect(review.adjustment.expectedResult).toContain('E3');
  });

  it('目标要求 E3 时，只用关联 E3 测量评估数值标准', () => {
    const weekStart = currentWeekStart();
    const goalPlanId = createGoalPlan('E3');
    const action = listGoalPlanActions(goalPlanId)[0];
    saveBenchmark(goalPlanId, action.id, 190, 'E3');

    const { review } = getWeeklyReview(weekStart, 'UTC');
    const milestone = review.goals.find(goal => goal.goalPlanId === goalPlanId)!.milestones[0];
    expect(milestone.requiredEvidenceLevel).toBe('E3');
    expect(milestone.qualifiedEvidenceCount).toBe(1);
    expect(milestone.status).toContain('达到标准');
    expect(review.adjustment.title).toContain('复测');
  });

  it('把秒转换为毫秒，并按不高于边界判定响应时间标准', () => {
    const weekStart = currentWeekStart();
    const goalPlanId = createGoalPlan('E2', '完整基准测试响应时间不高于 0.2 秒');
    scheduleGoal(weekStart);
    const action = listGoalPlanActions(goalPlanId)[0];
    saveBenchmark(goalPlanId, action.id, 200);

    const { review } = getWeeklyReview(weekStart, 'UTC');
    const milestone = review.goals.find(goal => goal.goalPlanId === goalPlanId)!.milestones[0];
    expect(milestone.status).toContain('达到标准');
    expect(review.adjustment.title).toContain('复测');
  });

  it('已达到数值标准的目标建议复测稳定性，不把未关联的示例证据当作目标结果', () => {
    const weekStart = currentWeekStart();
    const goalPlanId = createGoalPlan();
    scheduleGoal(weekStart);
    const action = listGoalPlanActions(goalPlanId)[0];
    saveBenchmark(goalPlanId, action.id, 190);
    saveEvidence({
      text: '示例图谱延迟 900 ms', source: '未关联报告', reference: 'unlinked-sample',
      observedAt: new Date().toISOString(), links: ['milestone'], level: 'E2',
      reportSubmitted: null, latencyMs: 900, benchmarkComplete: true,
    });

    const { review } = getWeeklyReview(weekStart, 'UTC');
    expect(review.adjustment).toMatchObject({ kind: 'measure', goalPlanId, milestoneId: 'latency-milestone' });
    expect(review.adjustment.title).toContain('复测');
    expect(review.goals.find(item => item.goalPlanId === goalPlanId)?.milestones[0].status).toContain('达到标准');
    expect(review.unlinkedEvidence.map(item => item.reference)).toContain('unlinked-sample');
    expect(review.goals.find(item => item.goalPlanId === goalPlanId)?.evidenceCount).toBe(1);
  });

  it('没有活跃目标时明确说明无法生成目标级结论，不使用静态示例图谱', () => {
    const weekStart = currentWeekStart();
    saveEvidence({
      text: '完整基准测试测得延迟 250 ms', source: '测试报告', reference: 'sample-only',
      observedAt: new Date().toISOString(), links: ['milestone'], level: 'E2',
      reportSubmitted: null, latencyMs: 250, benchmarkComplete: true,
    });

    const { review } = getWeeklyReview(weekStart, 'UTC');
    expect(review.goals).toEqual([]);
    expect(review.adjustment.kind).toBe('setup');
    expect(review.adjustment.goalPlanId).toBeNull();
    expect(review.facts.join(' ')).toContain('未关联具体目标');
  });

  it('保存后重新打开仍返回核对时的目标和证据快照', () => {
    const weekStart = currentWeekStart();
    const draft = getWeeklyReview(weekStart, 'UTC');
    saveEvidence({
      text: '之后录入的示例测量', source: '示例报告', reference: 'later-sample',
      observedAt: new Date().toISOString(), links: ['milestone'], level: 'E2',
      reportSubmitted: null, latencyMs: 190, benchmarkComplete: true,
    });
    const saved = saveWeeklyReview(weekStart, { ...draft.review.adjustment, title: '先完成目标设置' }, 'UTC');
    expect(saved.status).toBe('saved');
    expect(saved.review.evidence).toEqual([]);
    expect(saved.review.adjustment.modifiedByUser).toBe(true);
    expect(getWeeklyReview(weekStart, 'UTC')).toEqual(saved);
    expect(saveWeeklyReview(weekStart, { ...draft.review.adjustment, title: '后续改写' }, 'UTC')).toEqual(saved);
  });

  it('按本地时区周边界筛选证据', () => {
    const timeZone = 'Asia/Shanghai';
    const weekStart = '2026-11-09';
    const mondayStart = new Date(`${weekStart}T00:00:00+08:00`).getTime();
    const beforeMonday = new Date(mondayStart - 1).toISOString();
    const monday = new Date(mondayStart).toISOString();
    saveEvidence({ text: '上周记录', source: '提交系统', reference: 'previous-week', observedAt: beforeMonday, links: ['task'], level: 'E2', reportSubmitted: true, latencyMs: null, benchmarkComplete: null });
    const current = saveEvidence({ text: '本周记录', source: '提交系统', reference: 'current-week', observedAt: monday, links: ['task'], level: 'E2', reportSubmitted: true, latencyMs: null, benchmarkComplete: null });

    expect(getWeeklyReview(weekStart, timeZone).review.unlinkedEvidence.map(item => item.id)).toEqual([current.id]);
  });

  it('验证日期必须晚于复盘周，空建议不能保存', () => {
    const weekStart = currentWeekStart();
    const draft = getWeeklyReview(weekStart, 'UTC');
    expect(() => saveWeeklyReview(weekStart, { ...draft.review.adjustment, verificationDate: draft.review.weekEnd }, 'UTC')).toThrow('本周结束后');
    expect(() => saveWeeklyReview(weekStart, { ...draft.review.adjustment, title: ' ' }, 'UTC')).toThrow('不能为空');
  });
});
