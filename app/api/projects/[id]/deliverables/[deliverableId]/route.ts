import { deleteProjectDeliverable, updateProjectDeliverable } from '@/lib/project-deliverables';

export async function PATCH(request: Request, context: { params: Promise<{ id: string; deliverableId: string }> }) {
  try {
    const { id, deliverableId } = await context.params;
    const deliverables = updateProjectDeliverable(id, deliverableId, await request.json());
    return Response.json({ deliverables });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法更新项目交付物' }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; deliverableId: string }> }) {
  try {
    const { id, deliverableId } = await context.params;
    const deliverables = deleteProjectDeliverable(id, deliverableId);
    return Response.json({ deliverables });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法删除项目交付物' }, { status: 400 });
  }
}
