import { nodes, type NodeId } from './model';
import {
  getGoalPlan,
  listGoalPlanActions,
  listGoalPlans,
  listGoalProjects,
  type GoalPlan,
  type GoalPlanAction,
} from './goal-plans';
import { listEvidence, openDatabase } from './store';

export const businessAgent = {
  id: 'buildyourself.business-agent.v1',
  name: 'BuildYourself 业务 Agent',
} as const;

export type AgentContextSelection =
  | { layer: 'portfolio' }
  | { layer: 'graph'; graphNodeId: NodeId }
  | { layer: 'goal'; goalPlanId: string }
  | { layer: 'task'; goalPlanId: string; actionId: string }
  | { layer: 'evidence'; goalPlanId: string; evidenceId: string }
  | { layer: 'project'; projectId: string };

export type AgentDiscussionContext = {
  layer: AgentContextSelection['layer'];
  title: string;
  breadcrumb: string;
  goalPlanId: string | null;
  actionId: string | null;
  evidenceId: string | null;
  projectId: string | null;
  graphNodeId: NodeId;
  summary: string;
  standard: string | null;
  evidenceRequirement: string | null;
  nextStep: string;
};

export type AgentConfirmation = {
  required: boolean;
  kind: 'contract_change' | 'external_commitment' | 'major_tradeoff' | null;
  title: string | null;
  detail: string | null;
  nextStep: string | null;
};

export type AgentDiscussion = {
  context: AgentDiscussionContext;
  reply: string;
  confirmation: AgentConfirmation;
};

const contextSetting = 'agentContext.v1';
const contextRevisionSetting = 'agentContextRevision.v1';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('讨论上下文格式无效');
  return value as Record<string, unknown>;
}

function requiredId(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`讨论上下文缺少${field}`);
  return value.trim();
}

export function normalizeAgentContextSelection(value: unknown): AgentContextSelection {
  const input = record(value);
  if (input.layer === 'portfolio') return { layer: 'portfolio' };
  if (input.layer === 'graph') {
    if (typeof input.graphNodeId !== 'string' || !nodes.some(node => node.id === input.graphNodeId)) {
      throw new Error('讨论上下文中的图谱节点无效');
    }
    return { layer: 'graph', graphNodeId: input.graphNodeId as NodeId };
  }
  if (input.layer === 'goal') return { layer: 'goal', goalPlanId: requiredId(input.goalPlanId, '目标') };
  if (input.layer === 'task') return {
    layer: 'task',
    goalPlanId: requiredId(input.goalPlanId, '目标'),
    actionId: requiredId(input.actionId, '行动'),
  };
  if (input.layer === 'evidence') return {
    layer: 'evidence',
    goalPlanId: requiredId(input.goalPlanId, '目标'),
    evidenceId: requiredId(input.evidenceId, '证据'),
  };
  if (input.layer === 'project') return { layer: 'project', projectId: requiredId(input.projectId, '项目') };
  throw new Error('讨论上下文层级无效');
}

function contextKey(selection: AgentContextSelection) {
  return JSON.stringify(selection);
}

function goalNextStep(plan: GoalPlan, actions: GoalPlanAction[]) {
  const next = actions.filter(action => !action.decomposedAt && action.status !== 'done')
    .sort((left, right) => (left.deadline ?? '9999-12-31').localeCompare(right.deadline ?? '9999-12-31')
      || left.createdAt.localeCompare(right.createdAt))[0];
  if (next) return `下一步先核对行动「${next.title}」的完成标准、证据要求和日级容量。`;
  if (plan.milestones.length) return `当前行动已记录完成，下一步按里程碑「${plan.milestones[0].title ?? '未命名里程碑'}」核对证据，完成与进展分开判断。`;
  return '当前目标还没有可执行行动，先补充一个具体行动或核对目标契约。';
}

function taskNextStep(action: GoalPlanAction, actions: GoalPlanAction[]) {
  const unfinishedDependency = action.dependencyIds
    .map(id => actions.find(candidate => candidate.id === id))
    .find(candidate => candidate && candidate.status !== 'done');
  if (unfinishedDependency) return `先完成前置行动「${unfinishedDependency.title}」，再处理当前行动。`;
  if (action.status === 'done') return `行动已完成；请保存符合「${action.evidenceRequirement || action.successCriteria || '当前完成标准'}」的证据，再独立核对目标进展。`;
  if (action.status === 'pending_schedule') return `核对${action.estimateMinutes === null ? '预计耗时' : `${action.estimateMinutes} 分钟预计耗时`}、${action.deadline ? `${action.deadline} 截止日期` : '截止日期'}与日级容量后再排入计划。`;
  return `按「${action.successCriteria || '当前完成标准'}」执行，并保存符合该行动证据要求的材料。`;
}

export function resolveAgentContext(selection: AgentContextSelection): AgentDiscussionContext {
  if (selection.layer === 'portfolio') {
    const active = listGoalPlans().filter(plan => plan.status === 'active');
    return {
      layer: 'portfolio',
      title: '目标组合',
      breadcrumb: '目标组合',
      goalPlanId: null,
      actionId: null,
      evidenceId: null,
      projectId: null,
      graphNodeId: 'goal',
      summary: `当前有 ${active.length} 个活跃目标；讨论会读取个人执行图谱中的真实目标、行动、证据和承诺。`,
      standard: null,
      evidenceRequirement: null,
      nextStep: '选择具体目标或行动后，讨论会切换到对应层级的上下文。',
    };
  }

  if (selection.layer === 'graph') {
    const node = nodes.find(candidate => candidate.id === selection.graphNodeId)!;
    const linkedEvidence = listEvidence().filter(evidence => evidence.links.includes(node.id));
    return {
      layer: 'graph',
      title: node.title,
      breadcrumb: `目标组合 / 证据判定图谱 / ${node.type}：${node.title}`,
      goalPlanId: null,
      actionId: null,
      evidenceId: null,
      projectId: null,
      graphNodeId: node.id,
      summary: `${node.description}当前有 ${linkedEvidence.length} 条关联证据。`,
      standard: null,
      evidenceRequirement: null,
      nextStep: node.id === 'task'
        ? '核对当前执行记录和关联证据，不要把任务完成直接当作目标进展。'
        : node.id === 'milestone'
          ? '核对里程碑证据是否达到最低等级，再单独确认结果。'
          : '核对目标标准、里程碑和关联证据，再决定下一步行动。',
    };
  }

  if (selection.layer === 'project') {
    const project = listGoalProjects().find(candidate => candidate.id === selection.projectId);
    if (!project) throw new Error('讨论上下文中的项目不存在');
    return {
      layer: 'project',
      title: project.title,
      breadcrumb: `目标组合 / 共享项目 / ${project.title}`,
      goalPlanId: null,
      actionId: null,
      evidenceId: null,
      projectId: project.id,
      graphNodeId: 'goal',
      summary: `共享项目关联 ${project.goals.length} 个目标、${project.milestones.length} 个里程碑和 ${project.evidence.length} 条证据。`,
      standard: null,
      evidenceRequirement: null,
      nextStep: project.milestones.length ? '下一步从共享项目中核对近期里程碑、行动和证据。' : '下一步先关联或建立可核对的项目里程碑。',
    };
  }

  const plan = getGoalPlan(selection.goalPlanId);
  if (!plan) throw new Error('讨论上下文中的目标不存在');
  const actions = listGoalPlanActions(plan.id);

  if (selection.layer === 'goal') {
    return {
      layer: 'goal',
      title: plan.title || '未命名目标',
      breadcrumb: `目标组合 / ${plan.title || '未命名目标'}`,
      goalPlanId: plan.id,
      actionId: null,
      evidenceId: null,
      projectId: null,
      graphNodeId: 'goal',
      summary: plan.successDescription || plan.observableResult || '这个目标还没有填写成功描述。',
      standard: plan.successDescription,
      evidenceRequirement: plan.evidenceRequirements[0]
        ? `${plan.evidenceRequirements[0].item || '证据'}：${plan.evidenceRequirements[0].description || '待补充'}（最低 ${plan.evidenceRequirements[0].minimumLevel || '待设置'}）`
        : null,
      nextStep: goalNextStep(plan, actions),
    };
  }

  if (selection.layer === 'task') {
    const action = actions.find(candidate => candidate.id === selection.actionId);
    if (!action) throw new Error('讨论上下文中的行动不属于该目标');
    const milestone = plan.milestones.find(candidate => candidate.id === action.milestoneId);
    const evidenceRequirement = action.evidenceRequirement
      || milestone?.evidenceRequirement
      || (plan.evidenceRequirements[0]
        ? `${plan.evidenceRequirements[0].item || '证据'}：${plan.evidenceRequirements[0].description || '待补充'}（最低 ${plan.evidenceRequirements[0].minimumLevel || '待设置'}）`
        : null);
    const nextStep = taskNextStep(action, actions);
    return {
      layer: 'task',
      title: action.title,
      breadcrumb: `目标组合 / ${plan.title || '未命名目标'} / ${action.title}`,
      goalPlanId: plan.id,
      actionId: action.id,
      evidenceId: null,
      projectId: action.projectId,
      graphNodeId: 'task',
      summary: action.details || action.title,
      standard: action.successCriteria || action.milestoneCriteria,
      evidenceRequirement,
      nextStep: evidenceRequirement && !nextStep.includes(evidenceRequirement)
        ? `${nextStep} 完成时保留：${evidenceRequirement}`
        : nextStep,
    };
  }

  const evidence = listEvidence().find(candidate => candidate.id === selection.evidenceId);
  if (!evidence || evidence.goalPlanId !== plan.id) throw new Error('讨论上下文中的证据不属于该目标');
  const action = actions.find(candidate => candidate.id === evidence.goalActionId) ?? null;
  const milestone = plan.milestones.find(candidate => evidence.links.includes('milestone')
    && (!action?.milestoneId || candidate.id === action.milestoneId)) ?? null;
  return {
    layer: 'evidence',
    title: evidence.reference,
    breadcrumb: `目标组合 / ${plan.title || '未命名目标'} / 证据 / ${evidence.reference}`,
    goalPlanId: plan.id,
    actionId: action?.id ?? null,
    evidenceId: evidence.id,
    projectId: action?.projectId ?? null,
    graphNodeId: evidence.links.includes('task') ? 'task' : 'milestone',
    summary: evidence.text,
    standard: milestone?.successCriteria || action?.successCriteria || null,
    evidenceRequirement: milestone?.evidenceRequirement || action?.evidenceRequirement || null,
    nextStep: '按当前对象自己的标准核对这条证据；证据等级不等于成功标准已经达到。',
  };
}

function normalizeRevision(value: unknown) {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('讨论上下文修订号无效');
  return value;
}

export function setAgentContext(value: unknown, revisionValue?: unknown): AgentDiscussionContext {
  const selection = normalizeAgentContextSelection(value);
  const context = resolveAgentContext(selection);
  const revision = normalizeRevision(revisionValue);
  let stale = false;
  const database = openDatabase();
  try {
    database.exec('BEGIN IMMEDIATE');
    const savedRevision = database.prepare('SELECT value FROM settings WHERE key=?').get(contextRevisionSetting) as { value: string } | undefined;
    stale = revision > 0 && savedRevision !== undefined && Number(savedRevision.value) >= revision;
    if (!stale) {
      database.prepare("INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(contextSetting, contextKey(selection));
      if (selection.layer !== 'portfolio') {
        database.prepare("INSERT INTO settings VALUES ('context', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
          .run(context.graphNodeId);
      }
      if (revision > 0) {
        database.prepare("INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
          .run(contextRevisionSetting, String(revision));
      }
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
  return stale ? getAgentContext() : context;
}

export function getAgentContext(): AgentDiscussionContext {
  const database = openDatabase();
  let saved: string | undefined;
  try {
    const row = database.prepare('SELECT value FROM settings WHERE key=?').get(contextSetting) as { value: string } | undefined;
    saved = row?.value;
  } finally {
    database.close();
  }
  if (saved) {
    try {
      return resolveAgentContext(normalizeAgentContextSelection(JSON.parse(saved)));
    } catch {
      // A stale saved object falls back to the portfolio without changing graph state.
    }
  }
  return resolveAgentContext({ layer: 'portfolio' });
}

function confirmationFor(message: string): AgentConfirmation {
  const confirmations: AgentConfirmation[] = [];
  if (/(成功标准|评价标准|完成标准|证据要求|里程碑).{0,20}(改|调整|提高|降低)|(?:改|调整|提高|降低).{0,20}(成功标准|评价标准|完成标准|证据要求|里程碑)/.test(message)) {
    confirmations.push({
      required: true,
      kind: 'contract_change',
      title: '目标契约变更确认',
      detail: '这会改变已确认的标准或证据要求。请沿用现有目标契约变更流程，先核对前后内容并单独确认；确认前不会生效。',
      nextStep: '在 pi 中使用 /discuss 继续说明完整拟议内容，再由 goal_planning 的 propose_change 与 confirm_change 完成核对和确认。',
    });
  }
  if (/(收到|新增|老师|学校|客户|外部).{0,30}(通知|要求|任务|截止|提交)|粘贴.{0,10}(通知|要求)/.test(message)) {
    confirmations.push({
      required: true,
      kind: 'external_commitment',
      title: '外部承诺确认',
      detail: '请沿用现有外部承诺流程，先整理并核对事实，再决定是否保存和排期；讨论不会直接创建或移动外部承诺。',
      nextStep: '在 pi 中使用 /commitment 核对原始通知、截止、任务与归属，只有最终确认后才保存。',
    });
  }
  if (/(放弃|取消|延期|推迟|牺牲|压缩.{0,10}(计划|时间)|重大取舍|重新安排优先级)/.test(message)) {
    confirmations.push({
      required: true,
      kind: 'major_tradeoff',
      title: '计划与资源取舍确认',
      detail: '这涉及关键取舍或既有承诺。请沿用现有重排或复盘确认流程，在看清容量、顺延事项和缺口后由你决定。',
      nextStep: '在应用的“计划调整”面板生成一份重排建议，或继续讨论后由现有重排流程核对取舍并确认。',
    });
  }
  if (!confirmations.length) return { required: false, kind: null, title: null, detail: null, nextStep: null };
  if (confirmations.length === 1) return confirmations[0];
  return {
    required: true,
    kind: confirmations[0].kind,
    title: '多重确认',
    detail: confirmations.map(item => item.detail).join(' '),
    nextStep: confirmations.map(item => item.nextStep).join(' '),
  };
}

function contextualReply(context: AgentDiscussionContext, message: string, confirmation: AgentConfirmation) {
  if (confirmation.required) {
    return `当前讨论对象是「${context.breadcrumb}」。${confirmation.detail}`;
  }
  const asksForNextStep = /(下一步|接下来|先做|最应该|怎么推进|安排)/.test(message);
  const asksAboutStandard = /(标准|证据|完成|达标|验收)/.test(message);
  if (asksForNextStep) return `当前应围绕「${context.title}」推进。${context.nextStep}`;
  if (asksAboutStandard) {
    return `「${context.title}」当前标准：${context.standard || '尚未设置可核对标准'}；证据要求：${context.evidenceRequirement || '尚未设置证据要求'}。证据等级本身不等于标准已达成。`;
  }
  return `当前讨论对象是「${context.breadcrumb}」。「${context.title}」的记录摘要：${context.summary} ${context.nextStep}`;
}

export function discussWithAgent(messageValue: unknown, context = getAgentContext()): AgentDiscussion {
  if (typeof messageValue !== 'string' || !messageValue.trim()) throw new Error('请输入要继续讨论的内容');
  const message = messageValue.trim();
  if (message.length > 4000) throw new Error('讨论内容不能超过 4000 个字符');
  const confirmation = confirmationFor(message);
  return {
    context,
    reply: contextualReply(context, message, confirmation),
    confirmation,
  };
}
