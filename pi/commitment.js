/** pi extension: review facts from an external commitment before saving. */
import { Type } from 'typebox';

const base = process.env.BUILDYOURSELF_URL || 'http://127.0.0.1:3000';
const oneOf = values => Type.Union(values.map(value => Type.Literal(value)));
const nullableText = () => Type.Union([Type.String(), Type.Null()]);
const fieldSchema = oneOf(['deliverable', 'deadline', 'tasks', 'estimateMinutes', 'dependencies', 'acceptanceCriteria', 'goalPlanId']);

const taskSchema = Type.Object({
  title: Type.String(),
  details: Type.Optional(nullableText()),
  deadline: nullableText(),
  estimateMinutes: Type.Union([Type.Integer({ minimum: 1, maximum: 10080 }), Type.Null()]),
  dependencies: Type.Array(Type.String()),
  acceptanceCriteria: nullableText(),
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

const fieldLabels = {
  deliverable: '交付物',
  deadline: '截止时间',
  tasks: '任务拆分',
  estimateMinutes: '预计耗时',
  dependencies: '依赖',
  acceptanceCriteria: '验收要求',
  goalPlanId: '所属目标',
};

function formatDate(value) {
  return value || '未说明';
}

function describeUncertainty(item) {
  const location = item.taskIndex === null || item.taskIndex === undefined
    ? fieldLabels[item.field]
    : `任务 ${item.taskIndex + 1} · ${fieldLabels[item.field]}`;
  return `- ${location}：待核对（${item.reason}）`;
}

function describeCandidate(candidate, goalTitle) {
  const tasks = candidate.tasks.map((task, index) => [
    `${index + 1}. ${task.title}`,
    `截止：${formatDate(task.deadline)}`,
    `预计耗时：${task.estimateMinutes === null || task.estimateMinutes === undefined ? '未说明' : `${task.estimateMinutes} 分钟`}`,
    `依赖：${task.dependencies?.length ? task.dependencies.join('、') : '无'}`,
    `验收要求：${task.acceptanceCriteria || '未说明'}`,
    task.details ? `说明：${task.details}` : null,
  ].filter(Boolean).join('；')).join('\n');
  const uncertainty = candidate.uncertainFields?.length
    ? candidate.uncertainFields.map(describeUncertainty).join('\n')
    : '无';
  return `交付物：${candidate.deliverable}\n整体截止：${formatDate(candidate.deadline)}\n归属：${goalTitle || '杂项'}\n任务：\n${tasks}\n不确定字段：\n${uncertainty}\n\n原始通知：\n${candidate.sourceText}`;
}

function describeSavedCommitment(commitment) {
  const tasks = commitment.tasks.map(task => `- ${task.title}（${formatDate(task.deadline)}，${task.estimateMinutes === null ? '耗时待估' : `${task.estimateMinutes} 分钟`}）`).join('\n');
  return `承诺已保存，当前尚未排入。\n承诺 ID：${commitment.id}\n交付物：${commitment.deliverable}\n归属：${commitment.goalTitle || '杂项'}\n任务：\n${tasks}`;
}

export default function (pi) {
  pi.on('before_agent_start', event => ({
    systemPrompt: `${event.systemPrompt}\n\nBuildYourself external commitment intake instructions:\n- When the user pastes a teacher notice, project request, or other external task, or uses /commitment, use the external_commitment tool to inspect active goals and prepare a candidate.\n- Extract the deliverable, overall deadline when present, concrete tasks, each task deadline, estimated minutes, dependencies, acceptance criteria, and goal ownership. Preserve the original notice. Keep separate deadlines for separate tasks; do not collapse them to one date.\n- Do not invent facts. Mark every uncertain or missing field with a reason. If a value is not stated, leave it null or empty and mark it uncertain. Distinguish “no dependency” from “dependency is unknown.” Resolve relative dates only when the current date makes them unambiguous; otherwise ask the user instead of guessing.\n- Present the full candidate in the conversation, marking uncertain fields as 待核对. Ask a concise clarification when facts are ambiguous and invite corrections. Keep the candidate in the conversation and update it when the user corrects facts.\n- Once the candidate is clear and visible, call external_commitment with action=save. The tool presents the final candidate in an interactive confirmation dialog; write only if the user confirms in that dialog. If the user cancels, keep the candidate available for corrections and do not save it.\n- Use a listed active goal ID only when the user confirms that ownership. If the commitment currently has no goal ownership, set goalPlanId to null so it is saved under 杂项. If ownership is ambiguous, ask before choosing.\n- Saving a commitment must not schedule its tasks, change an active goal, or alter the existing plan. Tell the user it remains 尚未排入. Scheduling is a separate decision.`,
  }));

  pi.registerCommand('commitment', {
    description: '从通知或描述整理并核对一条外部承诺',
    handler: async args => {
      const source = args.trim();
      const prompt = source
        ? `请从下面的通知整理一条外部承诺。先展示候选字段、标出不确定项并允许我修正；只有我在最终确认弹窗中确认后才保存。\n\n通知原文：\n${source}`
        : '请粘贴需要整理的通知或外部任务描述。我会先提取候选字段供你核对；只有你在最终确认弹窗中确认后才保存。';
      await pi.sendUserMessage(prompt);
    },
  });

  pi.registerTool({
    name: 'external_commitment',
    label: 'External Commitment',
    description: 'List active goals and saved commitments, or save an explicitly reviewed external commitment as pending schedule.',
    promptSnippet: 'Review a notice into a commitment candidate; save only after explicit user confirmation.',
    promptGuidelines: [
      'Call action=list to see active goal IDs and existing commitments before assigning ownership.',
      'For action=save, provide the original notice, deliverable, all tasks, separate task deadlines, estimates, dependencies, acceptance criteria, goal ownership, and uncertainty reasons.',
      'Call action=save only after you have displayed the candidate and resolved the needed clarifications; write only after the interactive confirmation dialog is accepted.',
    ],
    parameters: Type.Object({
      action: oneOf(['list', 'save']),
      sourceText: Type.Optional(Type.String({ maxLength: 10000 })),
      deliverable: Type.Optional(Type.String({ maxLength: 500 })),
      deadline: Type.Optional(nullableText()),
      goalPlanId: Type.Optional(nullableText()),
      tasks: Type.Optional(Type.Array(taskSchema, { maxItems: 50 })),
      uncertainFields: Type.Optional(Type.Array(Type.Object({
        field: fieldSchema,
        taskIndex: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
        reason: Type.String({ maxLength: 500 }),
      }), { maxItems: 100 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        if (params.action === 'list') {
          const data = await api('/api/commitments');
          const goals = data.goals.map(goal => `- ${goal.title} · ID ${goal.id}`).join('\n') || '暂无活跃目标。';
          const commitments = data.commitments.map(item => `- ${item.deliverable}（${item.goalTitle || '杂项'}，${item.status === 'pending_schedule' ? '尚未排入' : item.status}）`).join('\n') || '暂无已保存的外部承诺。';
          return result(`活跃目标：\n${goals}\n\n已保存承诺：\n${commitments}`);
        }

        if (!params.sourceText || !params.deliverable || !params.tasks?.length) {
          return result('保存承诺需要原始通知、交付物和至少一项任务。', true);
        }
        if (!Object.hasOwn(params, 'deadline') || !Object.hasOwn(params, 'goalPlanId') || !Object.hasOwn(params, 'uncertainFields')) {
          return result('请明确提供整体截止时间、目标归属和不确定字段列表；没有单一截止或不确定项时分别传 null 和空列表。', true);
        }
        if (!ctx.hasUI) return result('保存承诺需要交互式确认，请在 pi 交互界面中核对。', true);
        const data = await api('/api/commitments');
        const goal = params.goalPlanId ? data.goals.find(item => item.id === params.goalPlanId) : null;
        if (params.goalPlanId && !goal) return result('所选目标不在活跃目标列表中；请重新核对目标归属或选择「杂项」。', true);
        const confirmed = await ctx.ui.confirm('确认保存外部承诺', describeCandidate(params, goal?.title ?? null));
        if (!confirmed) return result('用户取消保存；承诺候选未写入。你可以修正字段后重新核对。');
        const saved = await api('/api/commitments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, confirmed: true }),
        });
        return result(describeSavedCommitment(saved.commitment));
      } catch (error) {
        return result(error instanceof Error ? error.message : '外部承诺操作失败。', true);
      }
    },
  });
}
