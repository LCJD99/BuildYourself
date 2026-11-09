import { listGoalPlans, listGoalPlanActions, listPendingGoalActions, saveGoalPlanDraft } from '@/lib/goal-plans';
import { listChangeEvents } from '@/lib/milestone-store';

export const dynamic = 'force-dynamic';

export function GET() {
  const changes = listChangeEvents().filter(event => event.eventType === 'task.created' || event.eventType === 'task.updated');
  return Response.json({
    plans: listGoalPlans(),
    pendingActions: listPendingGoalActions(),
    actions: listGoalPlanActions(),
    taskChanges: changes,
  });
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
