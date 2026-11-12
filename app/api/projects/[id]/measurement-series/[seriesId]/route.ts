import { deleteProjectMeasurementSeries } from '@/lib/project-measurement-series';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; seriesId: string }> }) {
  try {
    const { id, seriesId } = await context.params;
    const series = deleteProjectMeasurementSeries(id, seriesId);
    return Response.json({ series });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法删除比较序列' }, { status: 400 });
  }
}
