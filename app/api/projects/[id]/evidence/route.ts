import { linkGoalProjectEvidence } from '@/lib/goal-plans';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { evidenceId?: unknown };
    if (typeof body.evidenceId !== 'string' || !body.evidenceId) throw new Error('请选择证据');
    const project = linkGoalProjectEvidence(id, body.evidenceId);
    return Response.json({ project });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法关联证据' }, { status: 400 });
  }
}
