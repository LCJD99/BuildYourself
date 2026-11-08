/** pi extension: conversational goal planning with reviewable drafts and explicit activation. */
import { Type } from 'typebox';

const base = process.env.BUILDYOURSELF_URL || 'http://127.0.0.1:3000';
const optionalText = () => Type.Optional(Type.String());
const oneOf = values => Type.Union(values.map(value => Type.Literal(value)));
const planSchema = Type.Object({
  sourceIntent: optionalText(),
  title: optionalText(),
  domain: Type.Optional(oneOf(['learning', 'fitness', 'project', 'general'])),
  context: optionalText(),
  successDescription: optionalText(),
  observableResult: optionalText(),
  baselineStatus: Type.Optional(oneOf(['known', 'unknown', 'to_measure', 'not_applicable'])),
  baselineAction: optionalText(),
  milestones: Type.Optional(Type.Array(Type.Object({
    id: optionalText(),
    title: optionalText(),
    stage: Type.Optional(oneOf(['near', 'future'])),
    successCriteria: optionalText(),
    standardAssessment: Type.Optional(oneOf(['reasonable', 'provisional', 'needs_revision'])),
    evidenceAvailability: Type.Optional(oneOf(['available', 'future', 'uncertain', 'unavailable'])),
    reviewNote: optionalText(),
    evidenceRequirement: optionalText(),
  }))),
  nextActions: Type.Optional(Type.Array(Type.Object({
    id: optionalText(),
    title: optionalText(),
    details: optionalText(),
    estimateMinutes: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 10080 }), Type.Null()])),
    specificity: Type.Optional(oneOf(['concrete', 'draft'])),
  }))),
  constraints: Type.Optional(Type.Object({
    status: Type.Optional(oneOf(['confirmed', 'needs_clarification'])),
    items: Type.Optional(Type.Array(Type.String())),
  })),
  evidenceRequirements: Type.Optional(Type.Array(Type.Object({
    id: optionalText(),
    item: optionalText(),
    description: optionalText(),
    minimumLevel: Type.Optional(oneOf(['E1', 'E2', 'E3'])),
  }))),
  reviewCycleDays: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 3650 }), Type.Null()])),
});

async function api(path, options) {
  const response = await fetch(`${base}${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function result(message, isError = false) {
  return { content: [{ type: 'text', text: message }], isError };
}

function describePlan(plan) {
  const blockers = plan.validation.issues.length ? `\n待补充：${plan.validation.issues.join('；')}` : '\n契约校验通过，可以请求用户核对。';
  const milestones = plan.milestones.map(item => `- ${item.stage === 'near' ? '近期' : '远期'}：${item.title || '未命名'}；标准：${item.successCriteria || '待细化'}；评估：${item.standardAssessment}；证据可获得性：${item.evidenceAvailability}；说明：${item.reviewNote || '待补充'}；证据要求：${item.evidenceRequirement || '待补充'}`).join('\n') || '待补充';
  const actions = plan.nextActions.map(item => `- ${item.title || '待补充'}${item.details ? `：${item.details}` : ''}${item.estimateMinutes ? `（约 ${item.estimateMinutes} 分钟）` : ''} · ${item.specificity === 'concrete' ? '具体行动' : '待细化'}`).join('\n') || '待补充';
  const evidence = plan.evidenceRequirements.map(item => `- ${item.item || '待补充'}：${item.description || '待补充'}（最低 ${item.minimumLevel || '待设置'}）`).join('\n') || '待补充';
  const constraints = plan.constraints.status === 'confirmed' ? (plan.constraints.items.join('；') || '已确认无额外限制') : '待确认';
  return `草稿 ID：${plan.id}\n目标：${plan.title || '未命名目标'}\n状态：${plan.status === 'draft' ? '草稿（尚未启用，不进入自动规划）' : '已启用'}\n使用场景：${plan.context || '待补充'}\n成功描述：${plan.successDescription || '待补充'}\n可观察结果：${plan.observableResult || '待补充'}\n当前基础：${plan.baselineStatus}${plan.baselineAction ? `；基线行动：${plan.baselineAction}` : ''}\n关键限制：${constraints}\n复盘周期：${plan.reviewCycleDays ? `每 ${plan.reviewCycleDays} 天` : '待补充'}\n里程碑：\n${milestones}\n近期行动：\n${actions}\n证据要求：\n${evidence}${blockers}`;
}

export default function (pi) {
  pi.on('before_agent_start', event => ({
    systemPrompt: `${event.systemPrompt}\n\nBuildYourself goal planning instructions:\n- When a user expresses a long-term goal or asks to turn an intention into a plan, use the goal_planning tool. The user may also start with /goal.\n- Start from the user's own words. Ask only for missing context, desired observable result, current baseline, or constraints when the answer would change the plan. Ask one concise question at a time; don't repeat information already given.\n- Use the learning, fitness, project, or general template. A domain without a dedicated template is still supported. If the baseline is unknown, propose one concrete, low-cost baseline action instead of pretending to know the user's level.\n- Draft a success description, observable result, review cycle, evidence requirements, constraints, milestones, and at least one concrete near-term action. Assess each near milestone's standard and evidence availability; explain the assessment. Future milestones may stay provisional with a reason to refine them later. Never invent evidence or claim a standard is validated without support.\n- Save a draft as soon as the user asks to save or when they want to stop before the contract is complete. An incomplete draft must stay a draft and must not create scheduled actions.\n- Present the saved draft and validation issues for review. Apply requested edits by updating that draft. Do not activate or schedule actions until the user explicitly confirms the complete draft. Activation opens a separate confirmation dialog. After activation, near-term actions enter the pending schedule pool; do not invent dates or time slots.`,
  }));

  pi.registerCommand('goal', {
    description: '从自然语言开始建立或继续编辑目标计划',
    handler: async args => {
      const intent = args.trim() || '我想建立一个长期目标计划，请先问我想达成什么。';
      await pi.sendUserMessage(`请帮助我建立或继续编辑目标计划。用户输入：${intent}`);
    },
  });

  pi.registerTool({
    name: 'goal_planning',
    label: 'Goal Planning',
    description: 'Create or edit a goal contract draft, inspect saved plans, or activate a validated plan after explicit user confirmation.',
    promptSnippet: 'Create and review goal contract drafts; activation requires explicit user confirmation.',
    promptGuidelines: [
      'Use goal_planning to list plans, save or edit a draft, and activate a validated draft only after the user explicitly confirms it.',
      'When saving an edit, include the changed fields and preserve all other known contract details; drafts stay outside automatic planning until activation.',
      'Before activation, show the title, success description, observable result, milestones, evidence requirements, constraints, review cycle, and near-term actions to the user.',
    ],
    parameters: Type.Object({
      action: oneOf(['list', 'save_draft', 'activate']),
      draftId: Type.Optional(Type.String()),
      plan: Type.Optional(planSchema),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        if (params.action === 'list') {
          const data = await api('/api/goal-plans');
          const plans = data.plans.map(describePlan).join('\n\n') || '目前没有目标计划。';
          const actions = data.pendingActions.map(action => `- ${action.title}（${action.goalTitle}，待排）`).join('\n') || '暂无待排行动。';
          return result(`${plans}\n\n近期行动待排池：\n${actions}`);
        }

        if (params.action === 'save_draft') {
          if (!params.plan) return result('保存草稿需要提供目标计划内容。', true);
          const path = params.draftId ? `/api/goal-plans/${encodeURIComponent(params.draftId)}` : '/api/goal-plans';
          const data = await api(path, {
            method: params.draftId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params.plan),
          });
          return result(describePlan(data.plan));
        }

        if (!params.draftId) return result('启用目标需要提供已保存的草稿 ID。', true);
        const { plans } = await api('/api/goal-plans');
        const draft = plans.find(plan => plan.id === params.draftId);
        if (!draft) return result('找不到该目标草稿，请先列出已保存计划。', true);
        if (!draft.validation.ready) return result(`${describePlan(draft)}\n\n请先补齐校验问题。`, true);
        if (!ctx.hasUI) return result('启用目标需要交互式确认，请在 pi 交互界面或浏览器中核对并确认。', true);
        const confirmed = await ctx.ui.confirm('确认启用目标计划', `${draft.title}\n\n启用后，近期行动会进入待排池。`);
        if (!confirmed) return result('用户取消了启用；目标仍保持草稿。');
        const data = await api(`/api/goal-plans/${encodeURIComponent(params.draftId)}/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmed: true }),
        });
        return result(`${describePlan(data.plan)}\n近期行动已进入待排池。`);
      } catch (error) {
        return result(error instanceof Error ? error.message : '目标计划操作失败。', true);
      }
    },
  });
}
