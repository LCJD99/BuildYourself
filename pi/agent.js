/** pi extension: continue the same contextual business-agent discussion used by the app. */
import { Type } from 'typebox';

const base = process.env.BUILDYOURSELF_URL || 'http://127.0.0.1:3000';
const oneOf = values => Type.Union(values.map(value => Type.Literal(value)));

async function api(path, options) {
  const response = await fetch(`${base}${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function result(message, isError = false) {
  return { content: [{ type: 'text', text: message }], isError };
}

function describeContext(data) {
  const context = data.context;
  return `业务 Agent：${data.agent.name}（${data.agent.id}）
正在讨论：${context.breadcrumb}
对象层级：${context.layer}
记录摘要：${context.summary}
当前标准：${context.standard || '尚未设置可核对标准'}
证据要求：${context.evidenceRequirement || '尚未设置证据要求'}
下一步：${context.nextStep}`;
}

export default function (pi) {
  pi.on('before_agent_start', event => ({
    systemPrompt: `${event.systemPrompt}\n\nBuildYourself contextual business-agent instructions:\n- The app and pi use one personal execution graph and one contextual discussion endpoint. Before discussing the current goal or task, call agent_discussion with action=current so the displayed object and graph context are explicit.\n- Use agent_discussion with action=discuss for the shared contextual answer. Keep discussion read-only when confirmation.required is true.\n- If a request changes goals, success standards, evidence standards, external commitments, or a major resource tradeoff, route it through the existing goal_planning, external_commitment, replan, weekly review, or lifecycle confirmation flow. Never treat a discussion answer as authority to write those changes.\n- If the user switches goal or task, do not silently reuse the previous object. Read the current object from the app and state the new breadcrumb before continuing.`,
  }));

  pi.registerCommand('discuss', {
    description: '继续讨论应用中当前选中的目标或任务',
    handler: async args => {
      const request = args.trim();
      await pi.sendUserMessage(request
        ? `先读取应用当前讨论对象，再调用 agent_discussion 继续讨论：${request}。若这涉及改变标准、外部承诺或关键取舍，转入现有确认流程。`
        : '请读取应用当前讨论对象，并在该对象和同一份个人执行图谱中继续讨论。先告诉我当前层级和记录摘要，再询问我想推进什么。');
    },
  });

  pi.registerTool({
    name: 'agent_discussion',
    label: 'Contextual Business Agent',
    description: 'Read the current app discussion object or continue the discussion through the same contextual business-agent endpoint used by the browser.',
    promptSnippet: 'Read and discuss the current goal or task from the same personal execution graph used by the app.',
    promptGuidelines: [
      'Call action=current before answering questions about the current object.',
      'Use action=discuss to continue the contextual discussion; include the user message exactly.',
      'When confirmation.required is true, explain the named existing confirmation flow and do not call a write API from this discussion tool.',
    ],
    parameters: Type.Object({
      action: oneOf(['current', 'discuss']),
      message: Type.Optional(Type.String({ maxLength: 4000 })),
    }),
    async execute(_toolCallId, params) {
      try {
        if (params.action === 'current') {
          return result(describeContext(await api('/api/agent-context')));
        }
        if (!params.message?.trim()) return result('继续讨论需要提供消息。', true);
        const data = await api('/api/agent-discussion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: params.message.trim() }),
        });
        const confirmation = data.confirmation.required
          ? `\n\n需要确认：${data.confirmation.title}\n${data.confirmation.detail}\n下一步：${data.confirmation.nextStep}`
          : '';
        return result(`${describeContext({ agent: data.agent, context: data.context })}\n\nAgent：${data.reply}${confirmation}`);
      } catch (error) {
        return result(error instanceof Error ? error.message : '无法继续当前对象的讨论。', true);
      }
    },
  });
}
