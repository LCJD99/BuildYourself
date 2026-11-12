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
    priority: Type.Optional(oneOf(['high', 'medium', 'low'])),
    hardDeadline: Type.Optional(Type.Union([Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), Type.Null()])),
    milestoneId: optionalText(),
    dependsOn: Type.Optional(Type.Array(Type.String())),
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
  const milestones = plan.milestones.map(item => `- ID ${item.id} · ${item.stage === 'near' ? '近期' : '远期'}：${item.title || '未命名'}；标准：${item.successCriteria || '待细化'}；评估：${item.standardAssessment}；证据可获得性：${item.evidenceAvailability}；说明：${item.reviewNote || '待补充'}；证据要求：${item.evidenceRequirement || '待补充'}`).join('\n') || '待补充';
  const actions = plan.nextActions.map(item => `- ID ${item.id} · ${item.title || '待补充'}${item.details ? `：${item.details}` : ''}${item.estimateMinutes ? `（约 ${item.estimateMinutes} 分钟）` : ''} · 优先级 ${item.priority || 'medium'} · 硬截止 ${item.hardDeadline || '无'} · 里程碑 ${item.milestoneId || '待关联'} · 依赖 ${item.dependsOn?.join(', ') || '无'} · ${item.specificity === 'concrete' ? '具体行动' : '待细化'}`).join('\n') || '待补充';
  const evidence = plan.evidenceRequirements.map(item => `- ID ${item.id} · ${item.item || '待补充'}：${item.description || '待补充'}（最低 ${item.minimumLevel || '待设置'}）`).join('\n') || '待补充';
  const constraints = plan.constraints.status === 'confirmed' ? (plan.constraints.items.join('；') || '已确认无额外限制') : '待确认';
  const status = {
    draft: '草稿（尚未启用，不进入自动规划）',
    active: '活跃（进入待排池）',
    paused: '已暂停（保留历史，退出待排池）',
    completed: '已完成',
    archived: '已归档',
    abandoned: '已放弃',
  }[plan.status] || plan.status;
  const contractVersion = plan.contractVersion ? `\n当前生效契约版本：${plan.contractVersion}` : '';
  return `目标 ID：${plan.id}\n目标：${plan.title || '未命名目标'}\n状态：${status}${contractVersion}${plan.lifecycleReason ? `\n状态原因：${plan.lifecycleReason}` : ''}\n使用场景：${plan.context || '待补充'}\n成功描述：${plan.successDescription || '待补充'}\n可观察结果：${plan.observableResult || '待补充'}\n当前基础：${plan.baselineStatus}${plan.baselineAction ? `；基线行动：${plan.baselineAction}` : ''}\n关键限制：${constraints}\n复盘周期：${plan.reviewCycleDays ? `每 ${plan.reviewCycleDays} 天` : '待补充'}\n里程碑：\n${milestones}\n近期行动：\n${actions}\n证据要求：\n${evidence}${blockers}`;
}

function describeContractSnapshot(plan) {
  const milestones = plan.milestones.map(item => `- ID ${item.id} · ${item.title || '未命名'}：${item.successCriteria || '标准待细化'}；证据要求：${item.evidenceRequirement || '待补充'}`).join('\n') || '无';
  const evidence = plan.evidenceRequirements.map(item => `- ID ${item.id} · ${item.item || '待补充'}：${item.description || '待补充'}（最低 ${item.minimumLevel || '待设置'}）`).join('\n') || '无';
  const constraints = plan.constraints.status === 'confirmed' ? plan.constraints.items.join('；') || '无额外限制' : '待确认';
  return `目标：${plan.title || '未命名目标'}\n领域：${plan.domain}\n成功描述：${plan.successDescription || '待补充'}\n可观察结果：${plan.observableResult || '待补充'}\n约束：${constraints}\n复盘周期：${plan.reviewCycleDays ? `每 ${plan.reviewCycleDays} 天` : '待补充'}\n里程碑：\n${milestones}\n证据要求：\n${evidence}`;
}

function describeContractChange(change) {
  return `目标契约变更 ID：${change.id} · 状态：${change.status} · 基于版本 ${change.baseVersion}\n变更说明：${change.summary}\n变更字段：${change.changedFields.join('、') || '无'}\n\n原契约：\n${describeContractSnapshot(change.previousPlan)}\n\n拟议的新契约：\n${describeContractSnapshot(change.proposedPlan)}`;
}

function describeEvaluation(evaluation) {
  const rule = evaluation.ruleSnapshot;
  const standard = rule.milestone?.successCriteria || rule.successDescription || '未设置';
  const milestone = rule.milestone ? `里程碑：${rule.milestone.title || rule.milestone.id}` : '总体目标评价';
  const evidenceRequirements = (rule.evidenceRequirements || []).map(item => `- ID ${item.id} · ${item.item || '待补充'}：${item.description || '待补充'}（最低 ${item.minimumLevel || '待设置'}）`).join('\n') || '无';
  const outcome = evaluation.outcome === 'met' ? '提出达到标准' : evaluation.outcome === 'not_met' ? '提出未达到标准' : '提出证据不足';
  const status = evaluation.status === 'pending_confirmation' ? '待用户核对' : evaluation.status === 'confirmed' ? '用户已确认调用方结论' : evaluation.status === 'not_met' ? '未满足标准' : evaluation.outcome === 'insufficient' ? '调用方提出证据不足' : '系统证据门槛未通过';
  const gate = `最低证据等级 ${evaluation.evidenceGate.requiredLevel}：${evaluation.evidenceGate.status === 'qualified' ? `已满足（${evaluation.evidenceGate.qualifiedEvidenceIds.length} 条达标证据）` : '未满足'}`;
  return `评价 ID：${evaluation.id} · ${status}\n观察时间：${evaluation.observedAt} · 评价时间：${evaluation.evaluatedAt}\n评价来源：调用方提出的结论（${outcome}）；系统只核对当时契约规定的证据等级，不独立判断自然语言标准是否达到。\n证据门槛：${gate}\n实际使用契约：版本 ${evaluation.contractVersion.version}（${evaluation.contractVersion.id}）\n${milestone}\n当时标准：${standard}\n证据要求：\n${evidenceRequirements}\n结论说明：${evaluation.summary}\n依据：${evaluation.reasons.join('；') || '无补充说明'}\n证据 ID：${evaluation.evidenceIds.join('、') || '无'}`;
}

function describeTaskProposals(proposals, actions = []) {
  return proposals.map(proposal => {
    const parentTask = actions.find(action => action.id === proposal.parentActionId);
    const parent = `拆分提议 ID：${proposal.id} · 父任务 ${parentTask?.title || ''}（ID ${proposal.parentActionId}，截止 ${parentTask?.deadline || '未设置'}）· 状态：${proposal.status === 'pending_review' ? '待核对' : proposal.status === 'accepted' ? '已确认' : '已拒绝'}`;
    const tasks = proposal.tasks.map(task => `- 子任务 ID ${task.id} · ${task.title}（${task.estimateMinutes} 分钟）· 截止 ${task.deadline || `沿用父任务（${parentTask?.deadline || '未设置'}）`} · 依赖 ${task.dependencyIds.join(', ') || '无'} · 完成标准：${task.successCriteria}`).join('\n');
    return `${parent}\n${tasks}`;
  }).join('\n\n') || '暂无任务拆分提议。';
}

export default function (pi) {
  pi.on('before_agent_start', event => ({
    systemPrompt: `${event.systemPrompt}\n\nBuildYourself goal planning instructions:\n- When a user expresses a long-term goal or asks to turn an intention into a plan, use the goal_planning tool. The user may also start with /goal.\n- Start from the user's own words. Ask only for missing context, desired observable result, current baseline, or constraints when the answer would change the plan. Ask one concise question at a time; don't repeat information already given.\n- Use the learning, fitness, project, or general template. A domain without a dedicated template is still supported. If the baseline is unknown, propose one concrete, low-cost baseline action instead of pretending to know the user's level.\n- Draft a success description, observable result, review cycle, evidence requirements, constraints, milestones, and at least one concrete near-term action. Assess each near milestone's standard and evidence availability; explain the assessment. Future milestones may stay provisional with a reason to refine them later. Never invent evidence or claim a standard is validated without support.\n- Save a draft as soon as the user asks to save or when they want to stop before the contract is complete. An incomplete draft must stay a draft and must not create scheduled actions.\n- Present the saved draft and validation issues for review. Apply requested edits by updating that draft. Do not activate or schedule actions until the user explicitly confirms the complete draft. Activation opens a separate confirmation dialog. After activation, near-term actions enter the pending schedule pool; do not invent dates or time slots.\n- For a large active task, propose 2–20 concrete subtasks with individual estimates, explicit completion criteria, dependencies, and only supported deadlines through task_decomposition. A proposal stays outside the pending pool while awaiting review. Show it to the user and preserve its child task IDs when editing. Confirm or reject only after the user decides; confirmation requires the tool's separate interactive confirmation.`,
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
    description: 'Create and edit goal drafts, review versioned contract changes, evaluate progress against the effective contract, and inspect history.',
    promptSnippet: 'Version active goal contract changes and persist evaluations against the exact contract version used.',
    promptGuidelines: [
      'Use goal_planning to list plans, save or edit a draft, and activate a validated draft only after the user explicitly confirms it.',
      'When saving an edit, include the changed fields and preserve all other known contract details; drafts stay outside automatic planning until activation.',
      'Before activation, show the title, success description, observable result, milestones, evidence requirements, constraints, review cycle, and near-term actions to the user.',
      'For each concrete action, include an estimate when supported, priority (high/medium/low), an explicit hard deadline only when stated, dependencies on action IDs when applicable, and a related near milestone ID when clear. Reuse IDs from this draft and never invent deadlines or dependencies.',
      'For an active or paused goal contract change, first use propose_change. Show the stored before/after contract and do not update the effective version until the user explicitly approves and the interactive confirmation succeeds.',
      'Preserve milestone and evidence requirement IDs when editing. Keep nextActions unchanged in contract changes; task editing has its own workflow.',
      'New progress evaluations use the current effective contract, regardless of observedAt. Set backfill=true only when the user explicitly requests evaluating a past observation under the version effective at that time.',
      'Before proposing a progress evaluation, call list_history and use only evidence candidates explicitly associated with that goal; select evidence ids from that returned list.',
      'An evaluation outcome is a caller-supplied user or Agent assessment, not an independent system judgment. The system only checks evidence level against the stored contract. Keep any qualified conclusion pending user confirmation, and explain that the natural-language criterion was not independently verified.',
      'History must display its stored contract version and rule snapshot rather than evaluating it again against current criteria.',
    ],
    parameters: Type.Object({
      action: oneOf(['list', 'save_draft', 'activate', 'propose_change', 'edit_change', 'confirm_change', 'reject_change', 'list_history', 'evaluate_progress', 'confirm_evaluation']),
      draftId: Type.Optional(Type.String()),
      goalPlanId: Type.Optional(Type.String()),
      changeId: Type.Optional(Type.String()),
      evaluationId: Type.Optional(Type.String()),
      summary: optionalText(),
      outcome: Type.Optional(oneOf(['insufficient', 'not_met', 'met'])),
      milestoneId: optionalText(),
      evidenceIds: Type.Optional(Type.Array(Type.String())),
      reasons: Type.Optional(Type.Array(Type.String())),
      observedAt: optionalText(),
      backfill: Type.Optional(Type.Boolean()),
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

        if (params.action === 'list_history') {
          if (!params.goalPlanId) return result('读取目标版本历史需要提供目标 ID。', true);
          const query = params.observedAt ? `?observedAt=${encodeURIComponent(params.observedAt)}` : '';
          const [history, evaluationData] = await Promise.all([
            api(`/api/goal-plans/${encodeURIComponent(params.goalPlanId)}/contract-changes${query}`),
            api(`/api/goal-plans/${encodeURIComponent(params.goalPlanId)}/evaluations`),
          ]);
          const versions = history.versions.map(version => `版本 ${version.version} · ${version.effectiveAt} · ${version.changeSummary}\n${describeContractSnapshot(version.plan)}`).join('\n\n') || '暂无生效版本。';
          const changes = history.changes.map(describeContractChange).join('\n\n') || '暂无变更提议。';
          const evaluations = evaluationData.evaluations.map(describeEvaluation).join('\n\n') || '暂无进展评价。';
          const evidenceCandidates = evaluationData.evidenceCandidates.map(evidence => `- ${evidence.id} · ${evidence.level} · ${evidence.observedAt} · ${evidence.reference}：${evidence.text}${evidence.goalActionId ? `（行动 ${evidence.goalActionId}）` : ''}`).join('\n') || '暂无明确关联此目标的证据。';
          const applicable = history.applicableVersion ? `\n该观察时间适用版本：${history.applicableVersion.version}（${history.applicableVersion.id}）` : '';
          return result(`目标 ${params.goalPlanId} · 当前版本 ${history.currentVersion ?? '尚未生效'}${applicable}\n\n版本历史：\n${versions}\n\n变更记录：\n${changes}\n\n明确关联到此目标的证据：\n${evidenceCandidates}\n\n已保存的进展评价：\n${evaluations}`);
        }

        if (params.action === 'propose_change' || params.action === 'edit_change') {
          if (!params.goalPlanId || !params.plan) return result('提出目标契约变更需要目标 ID 和完整拟议内容。', true);
          if (params.action === 'edit_change' && !params.changeId) return result('编辑契约变更需要变更 ID。', true);
          const change = await api(`/api/goal-plans/${encodeURIComponent(params.goalPlanId)}/contract-changes`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: params.action === 'propose_change' ? 'propose' : 'edit', changeId: params.changeId, plan: params.plan, summary: params.summary }),
          });
          return result(`变更仅保存为待核对提议；当前有效契约未改变。\n${describeContractChange(change.change)}`);
        }

        if (params.action === 'confirm_change' || params.action === 'reject_change') {
          if (!params.goalPlanId || !params.changeId) return result('处理目标契约变更需要目标 ID 和变更 ID。', true);
          const history = await api(`/api/goal-plans/${encodeURIComponent(params.goalPlanId)}/contract-changes`);
          const change = history.changes.find(item => item.id === params.changeId);
          if (!change || change.status !== 'pending_review') return result('找不到待核对的契约变更，请先查看版本历史。', true);
          if (params.action === 'confirm_change') {
            if (!ctx.hasUI) return result('确认目标契约变更需要交互式确认，请在 pi 交互界面核对前后内容。', true);
            const confirmed = await ctx.ui.confirm('确认目标契约变更', `${describeContractChange(change)}\n\n确认后将创建新契约版本，并从现在生效。`);
            if (!confirmed) return result('用户取消确认；当前版本继续生效，提议仍待核对。');
          }
          const data = await api(`/api/goal-plans/${encodeURIComponent(params.goalPlanId)}/contract-changes`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: params.action === 'confirm_change' ? 'confirm' : 'reject', changeId: params.changeId, confirmed: params.action === 'confirm_change' }),
          });
          return result(params.action === 'confirm_change'
            ? `目标契约已更新并创建新版本。\n${describeContractChange(data.change)}`
            : `已拒绝这份提议；当前契约继续生效。\n${describeContractChange(data.change)}`);
        }

        if (params.action === 'evaluate_progress') {
          if (!params.goalPlanId || !params.outcome || !params.summary) return result('记录进展评价需要目标 ID、结果和摘要。', true);
          if (params.backfill && !params.observedAt) return result('按历史口径回填必须提供明确的 observedAt。', true);
          const data = await api(`/api/goal-plans/${encodeURIComponent(params.goalPlanId)}/evaluations`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'record', outcome: params.outcome, summary: params.summary, reasons: params.reasons || [],
              milestoneId: params.milestoneId, evidenceIds: params.evidenceIds || [], observedAt: params.observedAt, backfill: params.backfill === true }),
          });
          return result(`已保存调用方提出的候选评价；系统只核对证据等级门槛，没有独立判断自然语言标准是否达到。${data.evaluation.status === 'pending_confirmation' ? '请再核对候选结论并明确确认。' : ''}\n${describeEvaluation(data.evaluation)}`);
        }

        if (params.action === 'confirm_evaluation') {
          if (!params.goalPlanId || !params.evaluationId) return result('确认进展评价需要目标 ID 和评价 ID。', true);
          const { evaluations } = await api(`/api/goal-plans/${encodeURIComponent(params.goalPlanId)}/evaluations`);
          const evaluation = evaluations.find(item => item.id === params.evaluationId);
          if (!evaluation || evaluation.status !== 'pending_confirmation') return result('找不到待确认的进展评价。', true);
          if (!ctx.hasUI) return result('确认进展评价需要交互式确认。', true);
          if (!await ctx.ui.confirm('确认目标进展', describeEvaluation(evaluation))) return result('用户取消确认；进展仍为待确认。');
          const data = await api(`/api/goal-plans/${encodeURIComponent(params.goalPlanId)}/evaluations`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'confirm', evaluationId: params.evaluationId, confirmed: true }),
          });
          return result(`已确认进展。\n${describeEvaluation(data.evaluation)}`);
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

  pi.registerTool({
    name: 'task_decomposition',
    label: 'Task Decomposition',
    description: 'Propose, edit, inspect, confirm, or reject a reviewable decomposition of an active goal task.',
    promptSnippet: 'Keep proposed subtasks outside the planner until the user reviews and confirms them.',
    promptGuidelines: [
      'List saved proposals before changing one. A proposal contains 2–20 subtasks, each with a stable unique short ID, a supported estimate, and a clear success criterion; dependencyIds must refer to those IDs and include dependencies only when justified.',
      'Preserve proposal child IDs when editing because dependencies refer to those IDs. Do not invent deadlines; omitted child deadlines inherit the parent deadline when accepted.',
      'Proposing or editing never schedules tasks. Confirming creates the subtasks and removes the parent task from the pending pool; rejecting leaves the parent unchanged.',
      'Before confirmation, show all subtasks and ask the user. Use the explicit confirmation dialog; never infer approval from a request to review or edit.',
    ],
    parameters: Type.Object({
      action: oneOf(['list', 'propose', 'edit', 'confirm', 'reject']),
      parentTaskId: Type.Optional(Type.String()),
      proposalId: Type.Optional(Type.String()),
      tasks: Type.Optional(Type.Array(Type.Object({
        id: Type.String(),
        title: Type.String(),
        projectName: optionalText(),
        details: optionalText(),
        deadline: Type.Optional(Type.Union([Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), Type.Null()])),
        estimateMinutes: Type.Integer({ minimum: 1, maximum: 10080 }),
        dependencyIds: Type.Optional(Type.Array(Type.String())),
        successCriteria: Type.String(),
        evidenceRequirement: optionalText(),
      }), { minItems: 2, maxItems: 20 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        if (params.action === 'list') {
          const data = await api('/api/goal-plans');
          return result(describeTaskProposals(data.taskProposals || [], data.actions || []));
        }
        if (params.action === 'propose') {
          if (!params.parentTaskId || !params.tasks) return result('拆分提议需要父任务 ID 和子任务列表。', true);
          const data = await api(`/api/tasks/${encodeURIComponent(params.parentTaskId)}/decomposition`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: params.tasks }),
          });
          const overview = await api('/api/goal-plans');
          return result(`已保存为待核对草稿；子任务尚未进入计划。\n${describeTaskProposals([data.proposal], overview.actions || [])}`);
        }
        if (!params.proposalId) return result('处理拆分提议需要提供提议 ID。', true);
        if (params.action === 'edit' && !params.tasks) return result('编辑提议需要提供完整子任务列表并保留现有子任务 ID。', true);
        if (params.action === 'confirm') {
          const data = await api('/api/goal-plans');
          const proposal = (data.taskProposals || []).find(item => item.id === params.proposalId);
          if (!proposal) return result('找不到该拆分提议，请先列出已保存的提议。', true);
          if (!ctx.hasUI) return result('确认拆分需要交互式确认，请在 pi 交互界面或浏览器中核对。', true);
          const summary = proposal.tasks.map(task => {
            const dependencies = task.dependencyIds.map(id => proposal.tasks.find(candidate => candidate.id === id)?.title || id).join('、') || '无';
            const parentDeadline = data.actions.find(action => action.id === proposal.parentActionId)?.deadline || '未设置';
            return `- ${task.title}（${task.estimateMinutes} 分钟，截止 ${task.deadline || `沿用父任务（${parentDeadline}）`}，依赖 ${dependencies}）：${task.successCriteria}`;
          }).join('\n');
          if (!await ctx.ui.confirm('确认任务拆分', `确认后父任务会退出待排池，子任务进入待排池。\n\n${summary}`)) return result('用户取消确认；提议仍待核对。');
        }
        const data = await api(`/api/task-decompositions/${encodeURIComponent(params.proposalId)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: params.action, ...(params.tasks ? { tasks: params.tasks } : {}) }),
        });
        const overview = await api('/api/goal-plans');
        return result(describeTaskProposals([data.proposal], overview.actions || []));
      } catch (error) {
        return result(error instanceof Error ? error.message : '任务拆分操作失败。', true);
      }
    },
  });
}
