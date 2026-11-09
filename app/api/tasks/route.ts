import { createGoalPlanAction } from '@/lib/goal-plans';

export async function POST(request: Request) {
  try {
    const task = createGoalPlanAction(await request.json());
    return Response.json({ task }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法添加任务' },
      { status: 400 },
    );
  }
}
