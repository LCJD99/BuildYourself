import {
  createGoalPlanContractChange,
  editGoalPlanContractChange,
  getGoalPlan,
  getGoalPlanContractVersionAt,
  listGoalPlanContractChanges,
  listGoalPlanContractVersions,
  resolveGoalPlanContractChange,
} from '../../../../../lib/goal-plans';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const goal = getGoalPlan(id);
  if (!goal) return Response.json({ error: '找不到目标' }, { status: 404 });
  try {
    const observedAt = new URL(request.url).searchParams.get('observedAt');
    const versions = listGoalPlanContractVersions(id);
    return Response.json({
      goalPlanId: id,
      currentVersion: goal.contractVersion,
      versions,
      changes: listGoalPlanContractChanges(id),
      applicableVersion: observedAt ? getGoalPlanContractVersionAt(id, observedAt) : null,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法读取目标契约历史' }, { status: 400 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    if (body.action === 'propose') {
      const change = createGoalPlanContractChange(id, body);
      return Response.json({ change }, { status: 201 });
    }
    if (body.action === 'edit') {
      if (typeof body.changeId !== 'string') throw new Error('编辑契约变更需要提供变更 ID');
      const change = editGoalPlanContractChange(id, body.changeId, body);
      return Response.json({ change });
    }
    if (body.action === 'confirm' || body.action === 'reject') {
      if (typeof body.changeId !== 'string') throw new Error('处理契约变更需要提供变更 ID');
      const change = resolveGoalPlanContractChange(id, body.changeId, body);
      return Response.json({ change });
    }
    throw new Error('目标契约变更操作无效');
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法处理目标契约变更' }, { status: 400 });
  }
}
