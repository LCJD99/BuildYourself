import { execFile } from 'node:child_process';
import { GoalDraftError, validateGoalDraftProposal, type GoalDraftProposal, type GoalDraftV2 } from './goal-drafts-v2';

export type GoalDraftAgentResult = { reply: string; draft: GoalDraftProposal };

const systemPrompt = `Return one concise JSON object only, no Markdown: {"reply":"中文回复","draft":{"title":"","description":"","constraints":{"status":"needs_clarification","items":[]},"attributes":[{"name":"","description":""}],"clarifyingQuestions":["中文问题"]}}. Reply in Chinese; use only user-provided facts; ask at most three questions. Mark constraints confirmed and clear questions only when enough details are known. Never activate a goal.`;

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
    '--no-context-files', '--no-prompt-templates',
  ];
  if (model) args.push('--model', model);
  args.push('--thinking', 'minimal', '--system-prompt', systemPrompt, '--', prompt);

  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
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
    child.stdin?.end();
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
  const parsedQuestions = Array.isArray(rawQuestions)
    ? rawQuestions.map(question => {
      if (typeof question === 'string') return question.trim() || null;
      if (!question || typeof question !== 'object' || Array.isArray(question)) return null;
      const record = question as Record<string, unknown>;
      return typeof record.question === 'string' ? record.question.trim() || null : null;
    })
    : null;
  if (!parsedQuestions) throw new GoalDraftError('PI Agent 必须返回待澄清问题列表。', 502);
  if (parsedQuestions.some(question => question === null)) {
    throw new GoalDraftError('PI Agent 的澄清问题列表含无法识别或为空的条目。', 502);
  }
  const questions = parsedQuestions as string[];

  const rawConstraints = draft.constraints;
  let constraints: GoalDraftProposal['constraints'];
  if (rawConstraints === undefined) {
    constraints = undefined;
  } else if (Array.isArray(rawConstraints)) {
    const items = rawConstraints.map(item => {
      if (typeof item === 'string') return item.trim() || null;
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        const keys = Object.keys(record);
        if (keys.length !== 1 || !['item', 'description', 'text'].includes(keys[0])) return null;
        const value = record[keys[0]];
        return typeof value === 'string' && value.trim() ? value.trim() : null;
      }
      return null;
    });
    if (items.some(item => item === null)) throw new GoalDraftError('PI Agent 的约束列表含无法识别或为空的条目。', 502);
    constraints = {
      status: 'needs_clarification',
      items: items as string[],
    };
  } else if (rawConstraints && typeof rawConstraints === 'object') {
    const record = rawConstraints as Record<string, unknown>;
    if (record.status !== undefined && record.status !== 'confirmed' && record.status !== 'needs_clarification') {
      throw new GoalDraftError('PI Agent 返回了无法识别的约束状态。', 502);
    }
    const supportedFields = new Set(['status', 'items', 'must', 'prefer', 'avoid']);
    if (Object.keys(record).some(key => !supportedFields.has(key))) {
      throw new GoalDraftError('PI Agent 的约束对象含无法识别的字段。', 502);
    }
    if (!['items', 'must', 'prefer', 'avoid'].some(field => Object.hasOwn(record, field))) {
      throw new GoalDraftError('PI Agent 的约束对象缺少约束内容字段。', 502);
    }
    const items: string[] = [];
    if (record.items !== undefined) {
      if (!Array.isArray(record.items)) throw new GoalDraftError('PI Agent 的约束项必须是列表。', 502);
      const values = record.items.map(item => typeof item === 'string' && item.trim() ? item.trim() : null);
      if (values.some(item => item === null)) throw new GoalDraftError('PI Agent 的约束项含无法识别或为空的条目。', 502);
      items.push(...values as string[]);
    }
    for (const field of ['must', 'prefer', 'avoid'] as const) {
      const group = record[field];
      if (group === undefined) continue;
      if (!Array.isArray(group)) throw new GoalDraftError(`PI Agent 的 ${field} 约束必须是列表。`, 502);
      const values = group.map(item => typeof item === 'string' && item.trim() ? item.trim() : null);
      if (values.some(item => item === null)) throw new GoalDraftError(`PI Agent 的 ${field} 约束含无法识别或为空的条目。`, 502);
      items.push(...(values as string[]).map(item => `${field}: ${item}`));
    }
    constraints = {
      status: record.status === 'confirmed' ? 'confirmed' : 'needs_clarification',
      items,
    };
  } else {
    throw new GoalDraftError('PI Agent 返回的约束格式无法识别。', 502);
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
