import { GoalDraftError, confirmGoalDraft } from '../../../../../../lib/goal-drafts-v2';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { revision?: unknown };
    const result = confirmGoalDraft(id, body.revision);
    return Response.json({
      goal: result.goal,
      weeklyPlanGeneration: { status: 'not_implemented' },
    }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    if (error instanceof GoalDraftError) {
      return Response.json({ error: error.message, ...(error.issues ? { issues: error.issues } : {}) }, { status: error.status });
    }
    return Response.json({ error: error instanceof Error ? error.message : '无法启用目标' }, { status: 400 });
  }
}
