import { linkGoalProjectToGoal } from '@/lib/goal-plans';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const project = linkGoalProjectToGoal(id, await request.json());
    return Response.json({ project });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法关联目标' }, { status: 400 });
  }
}
