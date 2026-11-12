import { createProjectDeliverable, listProjectDeliverables } from '@/lib/project-deliverables';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ deliverables: listProjectDeliverables(id) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法读取项目交付物' }, { status: 400 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const deliverables = createProjectDeliverable(id, await request.json());
    return Response.json({ deliverables }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法添加项目交付物' }, { status: 400 });
  }
}
