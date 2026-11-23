import { confirmGoalDraft } from '../../../../../../lib/goal-drafts-v2';
import { currentWeekStart, generateWeeklyPlanForGoal, getWeeklyPlanForGoal } from '../../../../../../lib/weekly-plans-v2';
import { apiError } from '../../../api-error';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { revision?: unknown };
    const result = confirmGoalDraft(id, body.revision);
    const weekStart = currentWeekStart();
    let snapshot = getWeeklyPlanForGoal(result.goal.id, weekStart);
    if (!result.idempotent || snapshot.generation.status === 'not_started') {
      try {
        await generateWeeklyPlanForGoal(result.goal.id, weekStart);
      } catch {
        // The enabled goal remains valid; the durable generation record exposes the failure and retry path.
      }
      snapshot = getWeeklyPlanForGoal(result.goal.id, weekStart);
    }
    return Response.json({
      goal: result.goal,
      weeklyPlanGeneration: {
        ...snapshot.generation,
        ...(snapshot.plan ? { plan: snapshot.plan } : {}),
      },
    }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return apiError(error, '无法启用目标');
  }
}
