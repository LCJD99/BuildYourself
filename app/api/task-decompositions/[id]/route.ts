import { resolveTaskDecompositionProposal } from '@/lib/goal-plans';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const proposal = resolveTaskDecompositionProposal(id, await request.json());
    return Response.json({ proposal });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法处理拆分提议' }, { status: 400 });
  }
}
