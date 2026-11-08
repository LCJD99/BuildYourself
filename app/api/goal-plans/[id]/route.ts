import { updateGoalPlanDraft } from '@/lib/goal-plans';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const plan = updateGoalPlanDraft(id, await request.json());
    return Response.json({ plan });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法更新目标草稿' },
      { status: 400 },
    );
  }
}
