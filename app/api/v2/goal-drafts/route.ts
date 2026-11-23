import { GoalDraftError, createGoalDraft, getGoalDraftValidation } from '../../../../lib/goal-drafts-v2';
import { proposeGoalDraft } from '../../../../lib/goal-draft-agent';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof GoalDraftError) {
    return Response.json({ error: error.message, ...(error.issues ? { issues: error.issues } : {}) }, { status: error.status });
  }
  return Response.json({ error: error instanceof Error ? error.message : '无法创建目标草稿' }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { message?: unknown };
    if (typeof body.message !== 'string' || !body.message.trim()) {
      throw new GoalDraftError('请输入目标意图', 400);
    }
    const message = body.message.trim();
    const response = await proposeGoalDraft({
      message,
      transcript: [{ role: 'user', message }],
      currentDraft: null,
    });
    const draft = createGoalDraft(message, response.draft, response.reply);
    return Response.json({ draft, reply: response.reply, validation: getGoalDraftValidation(draft) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
