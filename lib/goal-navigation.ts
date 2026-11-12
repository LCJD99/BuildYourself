import type { Evidence } from './model';
import type { GoalMilestone, GoalPlan, GoalPlanAction } from './goal-plans';

export type GoalMilestoneEvaluation = {
  goalPlanId: string;
  milestoneId: string | null;
  outcome: 'insufficient' | 'not_met' | 'met';
  status: 'insufficient' | 'not_met' | 'pending_confirmation' | 'confirmed';
  evaluatedAt: string;
};

export type GoalPortfolioFilter = 'all' | 'attention';
export type GoalNavigationLayer = 'portfolio' | 'goal' | 'detail';
export type GoalNavigationDetail = { kind: 'action' | 'evidence'; id: string; goalPlanId: string };

export type GoalPortfolioSummary = {
  goalPlanId: string;
  title: string;
  status: 'active';
  domain: GoalPlan['domain'];
  nextMilestone: GoalMilestone | null;
  milestoneCount: number;
  confirmedMilestoneCount: number;
  actionCount: number;
  completedActionCount: number;
  nextAction: GoalPlanAction | null;
  recentEvidence: Evidence[];
  latestEvidence: Evidence | null;
  riskSignals: string[];
};

export type GoalNavigationState = {
  layer: GoalNavigationLayer;
  selectedGoalPlanId: string | null;
  selectedNodeId: string | null;
  detail: GoalNavigationDetail | null;
  returnLayer: 'portfolio' | 'goal' | null;
  filter: GoalPortfolioFilter;
  portfolioScrollTop: number;
  goalScrollTop: number;
  restoreScrollTop: number | null;
};

export type GoalNavigationAction =
  | { type: 'restore-state'; state: GoalNavigationState }
  | { type: 'set-filter'; filter: GoalPortfolioFilter }
  | { type: 'open-goal'; goalPlanId: string; scrollTop: number }
  | { type: 'open-detail'; detail: GoalNavigationDetail; scrollTop: number }
  | { type: 'show-goal' }
  | { type: 'show-portfolio' }
  | { type: 'clear-restored-scroll' };

export function createGoalNavigationState(): GoalNavigationState {
  return {
    layer: 'portfolio', selectedGoalPlanId: null, selectedNodeId: null, detail: null,
    returnLayer: null, filter: 'all', portfolioScrollTop: 0, goalScrollTop: 0, restoreScrollTop: null,
  };
}

export function goalNavigationReducer(state: GoalNavigationState, action: GoalNavigationAction): GoalNavigationState {
  if (action.type === 'restore-state') return action.state;
  if (action.type === 'set-filter') return { ...state, filter: action.filter };
  if (action.type === 'open-goal') return {
    ...state, layer: 'goal', selectedGoalPlanId: action.goalPlanId, selectedNodeId: action.goalPlanId,
    detail: null, returnLayer: null, portfolioScrollTop: action.scrollTop, restoreScrollTop: 0,
  };
  if (action.type === 'open-detail') return {
    ...state,
    layer: 'detail', selectedGoalPlanId: action.detail.goalPlanId, selectedNodeId: action.detail.id,
    detail: action.detail, returnLayer: state.layer === 'goal' ? 'goal' : 'portfolio',
    portfolioScrollTop: state.layer === 'portfolio' ? action.scrollTop : state.portfolioScrollTop,
    goalScrollTop: state.layer === 'goal' ? action.scrollTop : state.goalScrollTop,
    restoreScrollTop: null,
  };
  if (action.type === 'show-goal') return {
    ...state, layer: 'goal', detail: null, returnLayer: null,
    restoreScrollTop: state.goalScrollTop,
  };
  if (action.type === 'show-portfolio') return {
    ...state, layer: 'portfolio', detail: null, returnLayer: null,
    restoreScrollTop: state.portfolioScrollTop,
  };
  return { ...state, restoreScrollTop: null };
}

function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function summarizeGoalPortfolio(
  plans: GoalPlan[],
  actions: GoalPlanAction[],
  evidence: Evidence[],
  now = new Date(),
  evaluations: GoalMilestoneEvaluation[] = [],
): GoalPortfolioSummary[] {
  const today = localDateKey(now);
  const recentBoundary = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return plans.filter(plan => plan.status === 'active').map(plan => {
    const goalActions = actions.filter(action => action.goalPlanId === plan.id && !action.decomposedAt);
    const goalEvidence = evidence.filter(item => item.goalPlanId === plan.id)
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.createdAt.localeCompare(a.createdAt));
    const goalEvaluations = evaluations.filter(evaluation => evaluation.goalPlanId === plan.id && evaluation.milestoneId !== null)
      .sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt));
    const latestEvaluationByMilestone = new Map<string, GoalMilestoneEvaluation>();
    for (const evaluation of goalEvaluations) {
      if (!latestEvaluationByMilestone.has(evaluation.milestoneId!)) latestEvaluationByMilestone.set(evaluation.milestoneId!, evaluation);
    }
    const overdueCount = goalActions.filter(action => action.status !== 'done' && action.deadline !== null && action.deadline < today).length;
    const recentEvidence = goalEvidence.filter(item => item.observedAt >= recentBoundary);
    const nextAction = goalActions.filter(action => action.status !== 'done')
      .sort((a, b) => (a.deadline ?? '9999-12-31').localeCompare(b.deadline ?? '9999-12-31') || a.createdAt.localeCompare(b.createdAt))[0] ?? null;
    const incompleteMilestones = plan.milestones.filter(milestone => {
      const latest = latestEvaluationByMilestone.get(milestone.id);
      return !(latest?.status === 'confirmed' && latest.outcome === 'met');
    });
    const riskSignals = [
      ...(plan.milestones.length ? [] : ['尚未设置里程碑']),
      ...(goalActions.length ? [] : ['尚未配置行动']),
      ...(overdueCount ? [`有 ${overdueCount} 项行动已过截止日期且未完成`] : []),
      ...(recentEvidence.length ? [] : ['近 30 天没有关联证据']),
    ];
    return {
      goalPlanId: plan.id,
      title: plan.title || '未命名目标',
      status: 'active',
      domain: plan.domain,
      nextMilestone: incompleteMilestones.find(milestone => milestone.stage === 'near') ?? incompleteMilestones[0] ?? null,
      milestoneCount: plan.milestones.length,
      confirmedMilestoneCount: plan.milestones.filter(milestone => {
        const latest = latestEvaluationByMilestone.get(milestone.id);
        return latest?.status === 'confirmed' && latest.outcome === 'met';
      }).length,
      actionCount: goalActions.length,
      completedActionCount: goalActions.filter(action => action.status === 'done').length,
      nextAction,
      recentEvidence: recentEvidence.slice(0, 3),
      latestEvidence: goalEvidence[0] ?? null,
      riskSignals,
    };
  });
}

export function filterGoalPortfolio(summaries: GoalPortfolioSummary[], filter: GoalPortfolioFilter): GoalPortfolioSummary[] {
  return filter === 'attention' ? summaries.filter(summary => summary.riskSignals.length > 0) : summaries;
}
