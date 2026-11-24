import { execFile } from 'node:child_process';
import { GoalDraftError } from './goal-drafts-v2';
import type { GoalV2 } from './goal-drafts-v2';
import type { WeeklyPlanAction, WeeklyPlanAgentResult } from './weekly-plan-agent';

export type WeeklyReviewAgentResult = {
  summary: string;
  reply: string;
  actions: WeeklyPlanAgentResult['actions'];
};

const systemPrompt = `你负责总结本周工作，并根据用户分别对本周和下周的意见提出下周行动规划草稿。输入字段 weekActions 是本周计划内行动及评估，unplannedItems 是本周计划外行动与杂项及其原始反馈，currentActions 是已有的下周草稿行动和待延续行动。总结应结合本周实际发生的计划内行动、计划外行动和杂项，区分计划外行动与无属性收益的杂项，不臆造结果。只返回一个 JSON 对象：{"summary":"本周工作总结","reply":"简短中文反馈","actions":[{"operation":"add 或 update","id":"update 时填写已存在行动 ID","title":"行动名称","description":"说明","date":"YYYY-MM-DD","goalIds":["目标 ID"],"attributeIds":["属性 ID"]}]}。必须把所有未完成的行动作为 update 保留原 ID，并安排在下一周；不得把它们改成不同 ID 的新行动。完成度为 null 或小于 1 的行动都视为未完成。保留已有下周行动，除非用户明确要求删除（系统不支持删除，请说明）。每项行动关联有效目标和该目标属性，安排日期限下一周。update 必须使用输入中准确的 ID；add 省略 ID。只输出 JSON，不用 Markdown。`;

function invoke(prompt: string): Promise<string> {
  const command = process.env.BUILDYOURSELF_PI_BIN || 'pi';
  const args = ['--print', '--mode', 'text', '--no-session', '--no-tools', '--no-extensions', '--no-mcp', '--no-skills', '--no-context-files', '--no-prompt-templates'];
  if (process.env.BUILDYOURSELF_AGENT_MODEL) args.push('--model', process.env.BUILDYOURSELF_AGENT_MODEL);
  args.push('--thinking', 'minimal', '--system-prompt', systemPrompt, '--', prompt);
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (!error) return resolve(stdout);
      const childError = error as NodeJS.ErrnoException & { killed?: boolean };
      if (childError.code === 'ENOENT') reject(new GoalDraftError(`找不到 PI 命令「${command}」。`, 503));
      else if (childError.killed || childError.code === 'ETIMEDOUT') reject(new GoalDraftError('PI Agent 响应超时。', 504));
      else reject(new GoalDraftError('PI Agent 调用失败。', 502));
    });
    child.stdin?.end();
  });
}

export async function proposeWeeklyReview(input: {
  weekStart: string;
  nextWeekStart: string;
  weekFeedback: string;
  nextWeekFeedback: string;
  goals: GoalV2[];
  weekActions: WeeklyPlanAction[];
  unplannedItems: unknown[];
  currentActions: WeeklyPlanAction[];
  completions: Record<string, number | null>;
  priorFeedback: unknown[];
}): Promise<WeeklyReviewAgentResult> {
  let text = (await invoke(JSON.stringify(input))).trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1];
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new GoalDraftError('PI Agent 必须返回有效 JSON。', 502); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new GoalDraftError('PI Agent 返回格式无效。', 502);
  const result = raw as Record<string, unknown>;
  if (typeof result.summary !== 'string' || !result.summary.trim() || typeof result.reply !== 'string' || !result.reply.trim() || !Array.isArray(result.actions)) {
    throw new GoalDraftError('PI Agent 必须返回总结、回复和行动列表。', 502);
  }
  if (result.actions.length > 100) throw new GoalDraftError('PI Agent 返回的行动过多。', 502);
  const existingIds = new Set(input.currentActions.map(action => action.id));
  const actions = result.actions.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GoalDraftError(`第 ${index + 1} 个行动格式无效。`, 502);
    const action = value as Record<string, unknown>;
    if ((action.operation !== 'add' && action.operation !== 'update')
      || typeof action.title !== 'string' || !action.title.trim()
      || typeof action.description !== 'string' || typeof action.date !== 'string'
      || !Array.isArray(action.goalIds) || !action.goalIds.every(id => typeof id === 'string')
      || !Array.isArray(action.attributeIds) || !action.attributeIds.every(id => typeof id === 'string')) {
      throw new GoalDraftError(`第 ${index + 1} 个行动内容无效。`, 502);
    }
    const operation = action.operation as 'add' | 'update';
    if (action.operation === 'update' && (typeof action.id !== 'string' || !existingIds.has(action.id))) {
      throw new GoalDraftError(`第 ${index + 1} 个延续行动必须沿用已有 ID。`, 502);
    }
    if (action.operation === 'add' && action.id !== undefined) throw new GoalDraftError(`第 ${index + 1} 个新行动不能指定 ID。`, 502);
    return {
      operation,
      ...(operation === 'update' ? { id: action.id as string } : {}),
      title: action.title.trim(), description: action.description.trim(), date: action.date,
      goalIds: action.goalIds as string[], attributeIds: action.attributeIds as string[],
    };
  });
  return { summary: result.summary.trim(), reply: result.reply.trim(), actions };
}
