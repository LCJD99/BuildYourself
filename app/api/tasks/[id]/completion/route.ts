import { markGoalPlanActionDone } from '@/lib/goal-plans';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ task: markGoalPlanActionDone(id) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法记录行动完成时间' },
      { status: 400 },
    );
  }
}
