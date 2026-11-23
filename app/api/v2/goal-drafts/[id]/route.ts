import { GoalDraftError, getGoalDraft, getGoalDraftValidation } from '../../../../../lib/goal-drafts-v2';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const draft = getGoalDraft(id);
    return Response.json({ draft, validation: getGoalDraftValidation(draft) });
  } catch (error) {
    if (error instanceof GoalDraftError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : '无法读取目标草稿' }, { status: 400 });
  }
}
