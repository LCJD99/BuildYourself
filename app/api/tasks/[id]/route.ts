import { updateGoalPlanAction } from '@/lib/goal-plans';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const task = updateGoalPlanAction(id, await request.json());
    return Response.json({ task });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法更新任务' },
      { status: 400 },
    );
  }
}
