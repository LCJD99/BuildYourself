import { GoalDraftError, getEnabledGoal } from '../../../../../lib/goal-drafts-v2';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ goal: getEnabledGoal(id) });
  } catch (error) {
    if (error instanceof GoalDraftError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : '无法读取目标' }, { status: 400 });
  }
}
