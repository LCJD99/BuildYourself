import { listGoalPlans, listPendingGoalActions, saveGoalPlanDraft } from '@/lib/goal-plans';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ plans: listGoalPlans(), pendingActions: listPendingGoalActions() });
}

export async function POST(request: Request) {
  try {
    const plan = saveGoalPlanDraft(await request.json());
    return Response.json({ plan }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法保存目标草稿' },
      { status: 400 },
    );
  }
}
