import { GoalDraftError, validateGoalDraftProposal, type GoalDraftProposal, type GoalDraftV2 } from './goal-drafts-v2';

export type GoalDraftAgentResult = { reply: string; draft: GoalDraftProposal };

export async function proposeGoalDraft(input: {
  message: string;
  transcript: Array<{ role: 'user' | 'assistant'; message: string }>;
  currentDraft: Omit<GoalDraftV2, 'transcript' | 'updatedAt' | 'state' | 'confirmedGoalId'> | null;
}): Promise<GoalDraftAgentResult> {
  const endpoint = process.env.BUILDYOURSELF_AGENT_URL;
  if (!endpoint) {
    throw new GoalDraftError('目标澄清 Agent 尚未配置，请设置 BUILDYOURSELF_AGENT_URL。', 503);
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new GoalDraftError('BUILDYOURSELF_AGENT_URL 不是有效的 URL。', 503);
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.BUILDYOURSELF_AGENT_TOKEN) {
    headers.Authorization = `Bearer ${process.env.BUILDYOURSELF_AGENT_TOKEN}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ task: 'clarify_goal', ...input }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GoalDraftError('无法连接目标澄清 Agent，请检查 Agent 服务地址和状态。', 502);
  }
  if (!response.ok) throw new GoalDraftError(`目标澄清 Agent 返回 HTTP ${response.status}。`, 502);

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new GoalDraftError('目标澄清 Agent 返回了无效 JSON。', 502);
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new GoalDraftError('目标澄清 Agent 返回格式无效。', 502);
  }
  const body = result as Record<string, unknown>;
  if (typeof body.reply !== 'string' || !body.reply.trim() || !Object.hasOwn(body, 'draft')) {
    throw new GoalDraftError('目标澄清 Agent 必须返回 reply 和 draft。', 502);
  }
  if (!body.draft || typeof body.draft !== 'object' || Array.isArray(body.draft)
    || !Array.isArray((body.draft as Record<string, unknown>).clarifyingQuestions)) {
    throw new GoalDraftError('目标澄清 Agent 必须返回待澄清问题列表。', 502);
  }
  try {
    return { reply: body.reply.trim(), draft: validateGoalDraftProposal(body.draft) };
  } catch {
    throw new GoalDraftError('目标澄清 Agent 返回的目标草稿格式无效。', 502);
  }
}
