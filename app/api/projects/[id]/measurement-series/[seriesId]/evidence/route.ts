import { assignProjectEvidenceToSeries } from '@/lib/project-measurement-series';

export async function POST(request: Request, context: { params: Promise<{ id: string; seriesId: string }> }) {
  try {
    const { id, seriesId } = await context.params;
    const body = await request.json() as { evidenceId?: unknown };
    if (typeof body.evidenceId !== 'string' || !body.evidenceId) throw new Error('请选择证据');
    const series = assignProjectEvidenceToSeries(id, seriesId, body.evidenceId);
    return Response.json({ series });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法将证据加入比较序列' }, { status: 400 });
  }
}
