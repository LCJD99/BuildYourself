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
  actions: Array<Omit<WeeklyPlanAction, 'id'> & { operation: 'add' | 'update'; id?: string }>;
};

const systemPrompt = `你负责为已启用的长期目标拟定一周行动安排，或按用户要求修改现有草稿。只返回一个 JSON 对象，不要 Markdown：{"reply":"中文回复","actions":[{"operation":"add 或 update","id":"update 时必须填写输入中现有行动的准确 ID；add 时省略","title":"行动名称","description":"简短说明","date":"YYYY-MM-DD","goalIds":["目标 ID"],"attributeIds":["属性 ID"]}]}。每个行动必须对应至少一个已启用目标及至少一个属于这些目标的属性；日期必须在给定周内，不安排具体时刻。目标或属性关联必须使用输入中的 ID。当输入提供 requiredGoals 和 requiredGoalIds 时，必须为 requiredGoals 中每个目标新增或修改至少一项行动，并使用该目标记录中的一个或多个属性 ID；不能遗漏任何 requiredGoalIds 中的目标。当输入提供 focusGoalId 时，该目标也必须有行动关联。每个返回项必须明确 operation：修改现有行动用 update 并逐字复制该行动的准确 ID；新增行动用 add 且不带 ID。绝不通过标题推断行动身份。只返回新增或修改的行动，未列出的旧行动会由系统自动保留；如果现有规划无需改变，返回空 actions 列表。不要生成、删除或推断任何未要求的变化，不要声称未生成或未应用的结果已经完成。`;

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

function parseResult(stdout: string, existingActionIds: Set<string>): WeeklyPlanAgentResult {
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
  if (result.actions.length > 100) throw new GoalDraftError('PI Agent 返回的行动过多。', 502);
  const actions = result.actions.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GoalDraftError(`第 ${index + 1} 个行动格式无效。`, 502);
    const action = value as Record<string, unknown>;
    if (Object.keys(action).some(key => !['operation', 'id', 'title', 'description', 'date', 'goalIds', 'attributeIds'].includes(key))) {
      throw new GoalDraftError(`第 ${index + 1} 个行动含无法识别的字段。`, 502);
    }
    if (action.operation !== 'add' && action.operation !== 'update') throw new GoalDraftError(`第 ${index + 1} 个行动缺少明确的新增或修改操作。`, 502);
    const operation = action.operation as 'add' | 'update';
    const proposedId = action.id;
    const id = typeof proposedId === 'string' && proposedId.trim() ? proposedId.trim() : undefined;
    if (operation === 'update' && (!id || !existingActionIds.has(id))) {
      throw new GoalDraftError(`第 ${index + 1} 个修改行动必须提供当前规划中的有效旧行动 ID。`, 502);
    }
    if (operation === 'add' && proposedId !== undefined && proposedId !== null
      && typeof proposedId !== 'string') {
      throw new GoalDraftError(`第 ${index + 1} 个新增行动 ID 必须省略或是临时文本 ID。`, 502);
    }
    if (operation === 'add' && id && existingActionIds.has(id)) {
      throw new GoalDraftError(`第 ${index + 1} 个新增行动不能复用现有行动 ID。`, 502);
    }
    if (typeof action.title !== 'string' || !action.title.trim()
      || (action.description !== undefined && typeof action.description !== 'string')
      || typeof action.date !== 'string'
      || !Array.isArray(action.goalIds) || !action.goalIds.every(item => typeof item === 'string')
      || !Array.isArray(action.attributeIds) || !action.attributeIds.every(item => typeof item === 'string')) {
      throw new GoalDraftError(`第 ${index + 1} 个行动缺少必需信息。`, 502);
    }
    return {
      operation,
      ...(operation === 'update' && id ? { id } : {}),
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
  focusGoalId?: string;
  requiredGoalIds?: string[];
  requiredGoals?: GoalV2[];
  message?: string;
}): Promise<WeeklyPlanAgentResult> {
  const result = parseResult(await invokePi(JSON.stringify({
    task: input.focusGoalId ? 'add_goal_to_weekly_plan' : input.currentPlan ? 'revise_weekly_plan' : 'generate_weekly_plan',
    weekStart: input.weekStart,
    days: Array.from({ length: 7 }, (_, index) => new Date(new Date(`${input.weekStart}T00:00:00.000Z`).getTime() + index * 86_400_000).toISOString().slice(0, 10)),
    goals: input.goals,
    focusGoalId: input.focusGoalId ?? null,
    requiredGoalIds: input.requiredGoalIds ?? [],
    requiredGoals: input.requiredGoals ?? [],
    currentPlan: input.currentPlan,
    userMessage: input.message ?? null,
  })), new Set(input.currentPlan?.actions.map(action => action.id) ?? []));
  if (!input.currentPlan && result.actions.length === 0) throw new GoalDraftError('PI Agent 没有为本周生成任何行动。', 502);
  // New actions receive their stable IDs in the persistence layer; the provider never owns identity.
  return result;
}
