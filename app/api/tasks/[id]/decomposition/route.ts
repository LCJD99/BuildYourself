import { createTaskDecompositionProposal } from '@/lib/goal-plans';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const proposal = createTaskDecompositionProposal(id, await request.json());
    return Response.json({ proposal }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法保存拆分提议' }, { status: 400 });
  }
}
