import type { GoalPlanDraft } from './goal-plans';

export type GoalTemplateReview = {
  template: string;
  sources: string;
  criteria: string;
  evidence: string;
  actions: string;
  plan: string;
};

function orFallback(value: string | null, empty: string) {
  return value || empty;
}

export function describeGoalTemplateReview(plan: GoalPlanDraft): GoalTemplateReview {
  const template = plan.domainTemplate;
  const criteria = plan.milestones.map(milestone =>
    `${milestone.stage === 'near' ? '近期' : '远期'} · ${orFallback(milestone.title, '未命名里程碑')}：${orFallback(milestone.successCriteria, '标准待细化')}`).join('\n');
  const evidence = plan.evidenceRequirements.map(requirement =>
    `${orFallback(requirement.item, '未命名证据对象')}：${orFallback(requirement.description, '待补充')}（最低 ${requirement.minimumLevel || '待设置'}）`).join('\n');
  const actions = plan.nextActions.map(action =>
    `${orFallback(action.title, '未命名行动')} · ${action.specificity === 'concrete' ? '具体行动' : '待细化'}${action.estimateMinutes ? ` · 约 ${action.estimateMinutes} 分钟` : ''}`).join('\n');
  return {
    template: template
      ? `${template.title} v${template.version}\n${template.summary}\n适用条件：${template.applicabilityConditions.join('；')}\n使用边界：${template.limitations.join('；')}`
      : '此旧草稿未记录领域模板版本，请在 pi 中查看来源后选择模板。',
    sources: template
      ? template.sourceReferences.map(source =>
        `${source.title} · ${source.version}\n${source.url}\n适用：${source.applicability}\n边界：${source.limitations}`).join('\n')
      : '没有已记录的模板来源。',
    criteria: criteria || '尚未添加里程碑。',
    evidence: evidence || '尚未添加证据要求。',
    actions: actions || '尚未添加近期行动。',
    plan: `成功描述：${orFallback(plan.successDescription, '待补充')}\n可观察结果：${orFallback(plan.observableResult, '待补充')}\n关键限制：${plan.constraints.status === 'confirmed' ? plan.constraints.items.join('；') || '已确认无额外限制' : '待确认'}\n复盘周期：${plan.reviewCycleDays ? `每 ${plan.reviewCycleDays} 天` : '待补充'}`,
  };
}
