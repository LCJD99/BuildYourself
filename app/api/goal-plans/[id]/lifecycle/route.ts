import { transitionGoalPlan } from '@/lib/goal-plans';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const plan = transitionGoalPlan(id, await request.json());
    return Response.json({ plan });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法变更目标状态' },
      { status: 400 },
    );
  }
}
