import { activateGoalPlan } from '../../../../../lib/goal-plans';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const input = await request.json();
    const { id } = await context.params;
    return Response.json({ plan: activateGoalPlan(id, input) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法启用目标' },
      { status: 400 },
    );
  }
}
