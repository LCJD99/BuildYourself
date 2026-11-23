import { execFile } from 'node:child_process';
import { GoalDraftError, type GoalV2 } from './goal-drafts-v2';

export type WeeklyPlanAction = {
  id: string;
  title: string;
  description: string;
  date: string;
  goalIds: string[];
  attributeIds: string[];
};

export type WeeklyPlanAgentResult = {
  reply: string;
  actions: Array<Omit<WeeklyPlanAction, 'id'> & { id?: string }>;
};

const systemPrompt = `你负责为已启用的长期目标拟定一周行动安排，或按用户要求修改现有草稿。只返回一个 JSON 对象，不要 Markdown：{"reply":"中文回复","actions":[{"id":"沿用现有行动时填写输入中的原 ID；新行动留空","title":"行动名称","description":"简短说明","date":"YYYY-MM-DD","goalIds":["目标 ID"],"attributeIds":["属性 ID"]}]}。每个行动必须对应至少一个已启用目标及至少一个属于这些目标的属性；日期必须在给定周内，不安排具体时刻。目标或属性关联必须使用输入中的 ID。修改时只返回新增或修改的行动，任何修改过的现有行动都必须带输入中的准确旧 ID；未列出的旧行动会由系统自动保留。不要生成、删除或推断任何未要求的变化，不要声称未生成或未应用的结果已经完成。`;

function invokePi(prompt: string): Promise<string> {
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
        if (childError.code === 'ENOENT') reject(new GoalDraftError(`找不到 PI 命令「${command}」，请设置 BUILDYOURSELF_PI_BIN。`, 503));
        else if (childError.killed || childError.code === 'ETIMEDOUT') reject(new GoalDraftError('PI Agent 响应超时，请检查模型服务后重试。', 504));
        else reject(new GoalDraftError('PI Agent 调用失败，请检查模型认证和服务状态。', 502));
        return;
      }
      resolve(stdout);
    });
    // PI --print waits for EOF before it evaluates a positional prompt.
    child.stdin?.end();
  });
}

function parseResult(stdout: string): WeeklyPlanAgentResult {
  let text = stdout.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1];
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new GoalDraftError('PI Agent 必须只返回一个 JSON 对象。', 502); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new GoalDraftError('PI Agent 返回格式无效。', 502);
  const result = parsed as Record<string, unknown>;
  if (typeof result.reply !== 'string' || !result.reply.trim() || !Array.isArray(result.actions)) {
    throw new GoalDraftError('PI Agent 必须返回说明和行动列表。', 502);
  }
  if (!result.actions.length) throw new GoalDraftError('PI Agent 没有为本周生成任何行动。', 502);
  if (result.actions.length > 100) throw new GoalDraftError('PI Agent 返回的行动过多。', 502);
  const actions = result.actions.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GoalDraftError(`第 ${index + 1} 个行动格式无效。`, 502);
    const action = value as Record<string, unknown>;
    if (Object.keys(action).some(key => !['id', 'actionId', 'title', 'description', 'date', 'goalIds', 'attributeIds'].includes(key))) {
      throw new GoalDraftError(`第 ${index + 1} 个行动含无法识别的字段。`, 502);
    }
    const proposedId = action.id ?? action.actionId;
    const id = typeof proposedId === 'string' && proposedId.trim() ? proposedId.trim() : undefined;
    if (typeof action.title !== 'string' || !action.title.trim()
      || (action.description !== undefined && typeof action.description !== 'string')
      || typeof action.date !== 'string'
      || !Array.isArray(action.goalIds) || !action.goalIds.every(item => typeof item === 'string')
      || !Array.isArray(action.attributeIds) || !action.attributeIds.every(item => typeof item === 'string')) {
      throw new GoalDraftError(`第 ${index + 1} 个行动缺少必需信息。`, 502);
    }
    return {
      ...(id === undefined ? {} : { id }),
      title: action.title.trim(),
      description: typeof action.description === 'string' ? action.description.trim() : '',
      date: action.date,
      goalIds: action.goalIds as string[],
      attributeIds: action.attributeIds as string[],
    };
  });
  return { reply: result.reply.trim(), actions };
}

export async function proposeWeeklyPlan(input: {
  weekStart: string;
  goals: GoalV2[];
  currentPlan: { actions: WeeklyPlanAction[] } | null;
  message?: string;
}): Promise<WeeklyPlanAgentResult> {
  const result = parseResult(await invokePi(JSON.stringify({
    task: input.currentPlan ? 'revise_weekly_plan' : 'generate_weekly_plan',
    weekStart: input.weekStart,
    days: Array.from({ length: 7 }, (_, index) => new Date(new Date(`${input.weekStart}T00:00:00.000Z`).getTime() + index * 86_400_000).toISOString().slice(0, 10)),
    goals: input.goals,
    currentPlan: input.currentPlan,
    userMessage: input.message ?? null,
  })));
  // New actions receive their stable IDs in the persistence layer; the provider never owns identity.
  return result;
}
