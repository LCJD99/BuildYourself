import { createProjectMeasurementSeries, listProjectMeasurementSeries } from '@/lib/project-measurement-series';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ series: listProjectMeasurementSeries(id) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法读取比较序列' }, { status: 400 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const series = createProjectMeasurementSeries(id, await request.json());
    return Response.json({ series }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法创建比较序列' }, { status: 400 });
  }
}
