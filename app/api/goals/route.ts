import { confirmLongTermGoal, createLongTermGoal, listLongTermGoals } from '../../../lib/long-term-goals';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ goals: listLongTermGoals() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === 'confirm') {
      if (typeof body.id !== 'string') throw new Error('确认目标需要提供目标 ID');
      return Response.json({ goal: confirmLongTermGoal(body.id) });
    }
    return Response.json({ goal: createLongTermGoal(body) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法保存目标' }, { status: 400 });
  }
}
