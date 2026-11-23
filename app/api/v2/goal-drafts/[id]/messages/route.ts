import { GoalDraftError, getGoalDraft, getGoalDraftValidation, updateGoalDraft } from '../../../../../../lib/goal-drafts-v2';
import { proposeGoalDraft } from '../../../../../../lib/goal-draft-agent';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof GoalDraftError) {
    return Response.json({ error: error.message, ...(error.issues ? { issues: error.issues } : {}) }, { status: error.status });
  }
  return Response.json({ error: error instanceof Error ? error.message : '无法更新目标草稿' }, { status: 400 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { message?: unknown; revision?: unknown };
    if (typeof body.message !== 'string' || !body.message.trim()) throw new GoalDraftError('请输入澄清或修改内容', 400);

    const current = getGoalDraft(id);
    if (current.state !== 'draft') throw new GoalDraftError('已启用的目标不能继续修改草稿', 409);
    if (current.revision !== body.revision) throw new GoalDraftError('草稿已有新版本，请刷新后继续', 409);
    const message = body.message.trim();
    const response = await proposeGoalDraft({
      message,
      transcript: [...current.transcript, { role: 'user', message }],
      currentDraft: {
        id: current.id, revision: current.revision, sourceIntent: current.sourceIntent,
        title: current.title, description: current.description, constraints: current.constraints,
        attributes: current.attributes, clarifyingQuestions: current.clarifyingQuestions,
      },
    });
    const draft = updateGoalDraft(id, { message, revision: body.revision, proposal: response.draft, reply: response.reply });
    return Response.json({ draft, reply: response.reply, validation: getGoalDraftValidation(draft) });
  } catch (error) {
    return errorResponse(error);
  }
}
