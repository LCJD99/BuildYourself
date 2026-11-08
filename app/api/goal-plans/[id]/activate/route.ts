import { activateGoalPlan } from '@/lib/goal-plans';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const input = await request.json() as { confirmed?: unknown };
    if (input.confirmed !== true) throw new Error('需要用户明确确认后才能启用目标。');
    const { id } = await context.params;
    return Response.json({ plan: activateGoalPlan(id) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法启用目标' },
      { status: 400 },
    );
  }
}
