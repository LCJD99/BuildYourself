import { confirmGoalPlanEvaluation, getGoalPlan, listGoalPlanEvaluations, recordGoalPlanEvaluation } from '../../../../../lib/goal-plans';
import { listEvidence } from '../../../../../lib/store';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!getGoalPlan(id)) return Response.json({ error: '找不到目标' }, { status: 404 });
    const evidenceCandidates = listEvidence().filter(evidence => evidence.goalPlanId === id);
    return Response.json({ evaluations: listGoalPlanEvaluations(id), evidenceCandidates });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法读取进展评价历史' }, { status: 400 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    if (body.action === 'record') {
      const evaluation = recordGoalPlanEvaluation(id, body);
      return Response.json({ evaluation }, { status: 201 });
    }
    if (body.action === 'confirm') {
      if (typeof body.evaluationId !== 'string') throw new Error('确认进展需要提供评价 ID');
      const evaluation = confirmGoalPlanEvaluation(id, body.evaluationId, body);
      return Response.json({ evaluation });
    }
    throw new Error('进展评价操作无效');
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法记录进展评价' }, { status: 400 });
  }
}
