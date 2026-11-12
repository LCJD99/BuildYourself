import { createGoalRelation, listGoalRelations, resolveGoalRelation } from '@/lib/goal-relations';
import { listGoalPlanActions } from '@/lib/goal-plans';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : '无法处理跨目标关系。' }, { status: 400 });
}

export function GET() {
  try {
    return Response.json({
      relations: listGoalRelations(),
      actions: listGoalPlanActions().filter(action => action.status !== 'done').map(action => ({
        id: action.id, goalPlanId: action.goalPlanId, goalTitle: action.goalTitle, title: action.title,
      })),
    });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === 'create') return Response.json({ relation: createGoalRelation(body.relation) }, { status: 201 });
    if (typeof body.relationId !== 'string') throw new Error('需要提供关系 ID。');
    return Response.json({ relation: resolveGoalRelation(body.relationId, body) });
  } catch (error) { return errorResponse(error); }
}
