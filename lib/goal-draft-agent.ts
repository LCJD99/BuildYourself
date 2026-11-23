import { execFile } from 'node:child_process';
import { GoalDraftError, validateGoalDraftProposal, type GoalDraftProposal, type GoalDraftV2 } from './goal-drafts-v2';

export type GoalDraftAgentResult = { reply: string; draft: GoalDraftProposal };

const systemPrompt = `你是 BuildYourself 的长期目标澄清 Agent。用中文简洁追问，依据用户原话，不编造事实。仅输出 JSON，不要代码围栏。格式：{"reply":"给用户的简短回复","draft":{"title":"","description":"","constraints":{"status":"needs_clarification","items":[]},"attributes":[{"name":"","description":""}],"clarifyingQuestions":[""]}}。属性和问题最多各 4 项。未澄清完整时保留 needs_clarification；信息完整时才用 confirmed 并清空问题。不能替用户确认启用目标。`;

function promptFor(input: {
  message: string;
  transcript: Array<{ role: 'user' | 'assistant'; message: string }>;
  currentDraft: Omit<GoalDraftV2, 'transcript' | 'updatedAt' | 'state' | 'confirmedGoalId'> | null;
}) {
  return JSON.stringify({
    task: 'clarify_goal',
    latestMessage: input.message,
    conversation: input.transcript,
    currentDraft: input.currentDraft,
  });
}

function runPi(prompt: string): Promise<string> {
  const command = process.env.BUILDYOURSELF_PI_BIN || 'pi';
  const model = process.env.BUILDYOURSELF_AGENT_MODEL;
  const args = [
    '--print', '--mode', 'text', '--no-session', '--no-tools', '--no-extensions', '--no-mcp', '--no-skills',
  ];
  if (model) args.push('--model', model);
  args.push('--thinking', 'minimal', '--system-prompt', systemPrompt, '--', prompt);

  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) {
        const childError = error as NodeJS.ErrnoException & { killed?: boolean };
        if (childError.code === 'ENOENT') {
          reject(new GoalDraftError(`找不到 PI 命令「${command}」，请设置 BUILDYOURSELF_PI_BIN。`, 503));
        } else if (childError.killed || childError.code === 'ETIMEDOUT') {
          reject(new GoalDraftError('PI Agent 响应超时，请检查模型服务后重试。', 504));
        } else {
          reject(new GoalDraftError('PI Agent 调用失败，请检查模型认证和服务状态。', 502));
        }
        return;
      }
      resolve(stdout);
    });
  });
}

function parseAgentResult(stdout: string): GoalDraftAgentResult {
  let content = stdout.trim();
  const fenced = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) content = fenced[1];
  let result: unknown;
  try {
    result = JSON.parse(content);
  } catch {
    throw new GoalDraftError('PI Agent 必须只返回一个 JSON 对象。', 502);
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new GoalDraftError('PI Agent 返回格式无效。', 502);
  }
  const body = result as Record<string, unknown>;
  if (typeof body.reply !== 'string' || !body.reply.trim() || !Object.hasOwn(body, 'draft')) {
    throw new GoalDraftError('PI Agent 必须返回 reply 和 draft。', 502);
  }
  const draft = body.draft && typeof body.draft === 'object' && !Array.isArray(body.draft)
    ? body.draft as Record<string, unknown>
    : {};
  const rawQuestions = draft.clarifyingQuestions ?? body.clarifyingQuestions;
  const questions = Array.isArray(rawQuestions)
    ? rawQuestions.map(question => typeof question === 'string'
      ? question
      : question && typeof question === 'object' && typeof (question as Record<string, unknown>).question === 'string'
        ? (question as Record<string, unknown>).question as string
        : null).filter((question): question is string => question !== null)
    : null;
  if (!questions) throw new GoalDraftError('PI Agent 必须返回待澄清问题列表。', 502);

  const rawConstraints = draft.constraints;
  let constraints: GoalDraftProposal['constraints'];
  if (rawConstraints === undefined) {
    constraints = undefined;
  } else if (Array.isArray(rawConstraints)) {
    constraints = {
      status: 'needs_clarification',
      items: rawConstraints.map(item => typeof item === 'string'
        ? item
        : item && typeof item === 'object'
          ? ['item', 'description', 'text'].map(key => (item as Record<string, unknown>)[key]).find(value => typeof value === 'string') as string | undefined ?? ''
          : '').filter(Boolean),
    };
  } else if (rawConstraints && typeof rawConstraints === 'object') {
    const record = rawConstraints as Record<string, unknown>;
    constraints = {
      status: record.status === 'confirmed' ? 'confirmed' : 'needs_clarification',
      items: Array.isArray(record.items) ? record.items.filter((item): item is string => typeof item === 'string') : [],
    };
  } else {
    constraints = { status: 'needs_clarification', items: [] };
  }

  const attributes = Array.isArray(draft.attributes)
    ? draft.attributes.map(attribute => {
      if (!attribute || typeof attribute !== 'object' || Array.isArray(attribute)) return attribute;
      const record = attribute as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name : '';
      const description = typeof record.description === 'string'
        ? record.description
        : typeof record.value === 'string'
          ? `${name}：${record.value}`
          : name;
      return { name, description };
    })
    : draft.attributes;

  try {
    const proposalInput = {
      ...draft,
      ...(body.draft === null ? {} : { attributes }),
      ...(constraints === undefined ? {} : { constraints }),
      clarifyingQuestions: questions,
    };
    return {
      reply: body.reply.trim(),
      draft: validateGoalDraftProposal(proposalInput),
    };
  } catch {
    throw new GoalDraftError('PI Agent 返回的目标草稿格式无效。', 502);
  }
}

export async function proposeGoalDraft(input: {
  message: string;
  transcript: Array<{ role: 'user' | 'assistant'; message: string }>;
  currentDraft: Omit<GoalDraftV2, 'transcript' | 'updatedAt' | 'state' | 'confirmedGoalId'> | null;
}): Promise<GoalDraftAgentResult> {
  return parseAgentResult(await runPi(promptFor(input)));
}
