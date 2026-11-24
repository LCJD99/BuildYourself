import { execFile } from 'node:child_process';
import { GoalDraftError } from './goal-drafts-v2';
import type { GoalV2 } from './goal-drafts-v2';
import type { WeeklyPlanAction } from './weekly-plan-agent';

export type ActionAssessmentResult = {
  completion: number;
  confidence: number;
  reply: string;
  contributions: Array<{ attributeId: string; amount: number }>;
};

const systemPrompt = `你评估用户对一项已安排行动的反馈，或评估用户计划外做的事情是否推进了其长期目标。只返回一个 JSON 对象，不要 Markdown：{"completion":0到1之间的数,"confidence":0到1之间的数,"reply":"简短中文反馈","contributions":[{"attributeId":"输入中的目标属性 ID","amount":0到1之间的数}]}。completion 表示行动完成情况；confidence 表示对本次判断的把握程度，不评价用户诚信。对计划外事情，只有在确实有目标属性收益时才返回贡献；没有明确收益就返回空列表。contributions 中的 amount 是对所列属性的累计预期贡献基数；按用户反馈评估，不得臆造输入中不存在的属性 ID。允许部分完成。`;

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
        if (childError.code === 'ENOENT') reject(new GoalDraftError(`找不到 PI 命令「${command}」，请设置 BUILDYOURSELF_PI_BIN。`, 503));
        else if (childError.killed || childError.code === 'ETIMEDOUT') reject(new GoalDraftError('PI Agent 响应超时，请检查模型服务后重试。', 504));
        else reject(new GoalDraftError('PI Agent 调用失败，请检查模型认证和服务状态。', 502));
        return;
      }
      resolve(stdout);
    });
    child.stdin?.end();
  });
}

function normalizedJson(stdout: string): unknown {
  let content = stdout.trim();
  const fenced = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) content = fenced[1];
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === 'string' ? JSON.parse(parsed) as unknown : parsed;
  } catch { throw new GoalDraftError('PI Agent 必须只返回一个 JSON 对象。', 502); }
}

export function validateActionAssessment(value: unknown, action: WeeklyPlanAction): ActionAssessmentResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    throw new GoalDraftError(`PI Agent 返回格式无效（${actual}）。`, 502);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !['completion', 'confidence', 'reply', 'contributions'].includes(key))) {
    throw new GoalDraftError('PI Agent 返回了无法识别的评估字段。', 502);
  }
  const ratio = (input: unknown): input is number => typeof input === 'number' && Number.isFinite(input) && input >= 0 && input <= 1;
  if (!ratio(record.completion) || !ratio(record.confidence)
    || typeof record.reply !== 'string' || !record.reply.trim() || !Array.isArray(record.contributions)) {
    throw new GoalDraftError('PI Agent 返回的完成度、置信度、反馈或属性贡献无效。', 502);
  }
  const seen = new Set<string>();
  const contributions = record.contributions.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GoalDraftError(`第 ${index + 1} 项属性贡献格式无效。`, 502);
    const item = value as Record<string, unknown>;
    if (Object.keys(item).some(key => !['attributeId', 'amount'].includes(key))
      || typeof item.attributeId !== 'string' || !action.attributeIds.includes(item.attributeId)
      || !ratio(item.amount) || seen.has(item.attributeId)) {
      throw new GoalDraftError(`第 ${index + 1} 项属性贡献无效或关联到不相关属性。`, 502);
    }
    seen.add(item.attributeId);
    return { attributeId: item.attributeId, amount: item.amount };
  });
  return {
    completion: record.completion,
    confidence: record.confidence,
    reply: record.reply.trim(),
    contributions,
  };
}

export async function proposeActionAssessment(input: {
  action: WeeklyPlanAction;
  goals: GoalV2[];
  message: string;
  performedOn: string | null;
  priorCumulativeContributions: Record<string, number>;
  unplanned?: boolean;
}): Promise<ActionAssessmentResult> {
  const { unplanned = false, ...assessmentInput } = input;
  const prompt = JSON.stringify({ task: unplanned ? 'assess_unplanned_activity' : 'assess_planned_action_feedback', ...assessmentInput });
  return validateActionAssessment(normalizedJson(await runPi(prompt)), input.action);
}
