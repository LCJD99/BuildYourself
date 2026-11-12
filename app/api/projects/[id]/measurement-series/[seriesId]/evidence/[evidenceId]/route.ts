import { removeProjectEvidenceFromSeries } from '@/lib/project-measurement-series';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; seriesId: string; evidenceId: string }> }) {
  try {
    const { id, seriesId, evidenceId } = await context.params;
    const series = removeProjectEvidenceFromSeries(id, seriesId, evidenceId);
    return Response.json({ series });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法从比较序列移除证据' }, { status: 400 });
  }
}
