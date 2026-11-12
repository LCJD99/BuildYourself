import { describe, expect, it } from 'vitest';
import type { Evidence } from '../lib/model';
import type { GoalPlan, GoalPlanAction } from '../lib/goal-plans';
import {
  createGoalNavigationState,
  goalNavigationReducer,
  summarizeGoalPortfolio, type GoalMilestoneEvaluation,
} from '../lib/goal-navigation';

const plan = (overrides: Partial<GoalPlan> = {}): GoalPlan => ({
  id: 'goal-1', title: '完成英语课程', domain: 'learning', status: 'active',
  sourceIntent: null, context: null, successDescription: '完成课程', observableResult: '提交展示作业',
  baselineStatus: 'known', baselineAction: null,
  milestones: [{ id: 'milestone-1', title: '展示作业', stage: 'near', successCriteria: '提交作业', standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: null, evidenceRequirement: 'E2' }],
  nextActions: [], constraints: { status: 'confirmed', items: [] }, evidenceRequirements: [], reviewCycleDays: 7,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', activatedAt: '2026-11-01T00:00:00.000Z',
  completedAt: null, lifecycleReason: null, lifecycleEvents: [], pendingCompletion: null,
  validation: { ready: true, issues: [] }, contractVersion: 1,
  ...overrides,
} as GoalPlan);

const action = (overrides: Partial<GoalPlanAction> = {}): GoalPlanAction => ({
  id: 'action-1', goalPlanId: 'goal-1', goalTitle: '完成英语课程', projectId: null, projectName: null,
  title: '完成展示作业', details: '录制并提交展示', deadline: '2026-11-10', estimateMinutes: 60,
  dependencyIds: [], successCriteria: '完成 5 分钟展示', evidenceRequirement: 'E2 课程提交记录', priority: 'medium', hardDeadline: null,
  milestoneId: 'milestone-1', milestoneTitle: '展示作业', milestoneCriteria: '提交作业', dependsOn: [], status: 'pending_schedule',
  parentActionId: null, decomposedAt: null, completedAt: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
} as GoalPlanAction);

const evidence = (id: string, observedAt: string): Evidence => ({
  id, text: `反馈 ${id}`, source: '课程平台', reference: id, observedAt, createdAt: observedAt,
  links: ['task'], goalPlanId: 'goal-1', goalActionId: 'action-1', level: 'E2',
  reportSubmitted: true, latencyMs: null, benchmarkComplete: null,
});

describe('目标组合导航', () => {
  it('从真实目标、行动和证据生成组合摘要及可追溯的风险提示', () => {
    const summaries = summarizeGoalPortfolio([
      plan(), plan({ id: 'archived', title: '已归档目标', status: 'archived' }),
    ], [
      action(), action({ id: 'action-2', status: 'done', deadline: null, completedAt: '2026-11-11T12:00:00.000Z' }),
    ], [evidence('evidence-old', '2026-10-01T10:00:00.000Z'), evidence('evidence-new', '2026-11-12T10:00:00.000Z')], new Date('2026-11-12T12:00:00.000Z'));

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      goalPlanId: 'goal-1', title: '完成英语课程', status: 'active',
      nextMilestone: { id: 'milestone-1', title: '展示作业' },
      completedActionCount: 1, actionCount: 2,
      latestEvidence: { id: 'evidence-new', source: '课程平台' },
    });
    expect(summaries[0].riskSignals).toContain('有 1 项行动已过截止日期且未完成');
    expect(summaries[0].riskSignals).not.toContain('近 30 天没有关联证据');
  });

  it('跳过已由用户确认达标的里程碑，优先显示尚未完成的近期节点', () => {
    const target = plan({ milestones: [
      { id: 'done-milestone', title: '已确认节点', stage: 'near', successCriteria: '提交作业', standardAssessment: 'reasonable', evidenceAvailability: 'available', reviewNote: null, evidenceRequirement: 'E2' },
      { id: 'next-milestone', title: '下一阶段', stage: 'future', successCriteria: '完成展示', standardAssessment: 'provisional', evidenceAvailability: 'future', reviewNote: null, evidenceRequirement: 'E2' },
    ] });
    const confirmedEvaluation = { goalPlanId: 'goal-1', milestoneId: 'done-milestone', status: 'confirmed', outcome: 'met', evaluatedAt: '2026-11-12T10:00:00.000Z' } as GoalMilestoneEvaluation;
    const summaries = summarizeGoalPortfolio([target], [], [], new Date('2026-11-12T12:00:00.000Z'), [confirmedEvaluation]);

    expect(summaries[0]).toMatchObject({
      nextMilestone: { id: 'next-milestone', title: '下一阶段' },
      milestoneCount: 2,
      confirmedMilestoneCount: 1,
    });
  });

  it('在总览、目标和详情间返回时保留筛选、滚动及所选目标节点', () => {
    let state = createGoalNavigationState();
    state = goalNavigationReducer(state, { type: 'set-filter', filter: 'attention' });
    state = goalNavigationReducer(state, { type: 'open-goal', goalPlanId: 'goal-1', scrollTop: 340 });
    state = goalNavigationReducer(state, { type: 'open-detail', detail: { kind: 'action', id: 'action-1', goalPlanId: 'goal-1' }, scrollTop: 720 });

    expect(state).toMatchObject({ layer: 'detail', selectedGoalPlanId: 'goal-1', selectedNodeId: 'action-1' });
    state = goalNavigationReducer(state, { type: 'show-goal' });
    expect(state).toMatchObject({ layer: 'goal', filter: 'attention', selectedGoalPlanId: 'goal-1', selectedNodeId: 'action-1', restoreScrollTop: 720 });
    state = goalNavigationReducer(state, { type: 'show-portfolio' });
    expect(state).toMatchObject({ layer: 'portfolio', filter: 'attention', selectedGoalPlanId: 'goal-1', selectedNodeId: 'action-1', restoreScrollTop: 340 });
  });

  it('从组合总览直接打开证据详情后返回时恢复原筛选和总览位置', () => {
    let state = createGoalNavigationState();
    state = goalNavigationReducer(state, { type: 'set-filter', filter: 'attention' });
    state = goalNavigationReducer(state, { type: 'open-detail', detail: { kind: 'evidence', id: 'evidence-1', goalPlanId: 'goal-1' }, scrollTop: 265 });
    state = goalNavigationReducer(state, { type: 'show-portfolio' });

    expect(state).toMatchObject({
      layer: 'portfolio', filter: 'attention', selectedGoalPlanId: 'goal-1',
      selectedNodeId: 'evidence-1', restoreScrollTop: 265,
    });
  });
});
