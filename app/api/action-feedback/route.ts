import { assessLongTermAction } from '../../../lib/long-term-goals';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.actionId !== 'string') throw new Error('反馈需要提供行动 ID');
    return Response.json({ assessment: assessLongTermAction(body.actionId, body) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法评估行动反馈' }, { status: 400 });
  }
}
