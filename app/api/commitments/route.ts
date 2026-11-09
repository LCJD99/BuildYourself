import { listExternalCommitments, saveExternalCommitment } from '../../../lib/commitments';
import { listGoalPlans } from '../../../lib/goal-plans';

export const dynamic = 'force-dynamic';

export function GET() {
  const commitments = listExternalCommitments();
  const goals = listGoalPlans()
    .filter(goal => goal.status === 'active')
    .map(goal => ({ id: goal.id, title: goal.title || '未命名目标' }));
  return Response.json({ commitments, goals });
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as Record<string, unknown>;
    if (input.confirmed !== true) throw new Error('请先在 pi 中核对并明确确认这条承诺');
    const commitment = saveExternalCommitment(input);
    return Response.json({ commitment }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法保存外部承诺' },
      { status: 400 },
    );
  }
}
