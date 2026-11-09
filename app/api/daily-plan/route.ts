import { confirmDailyPlan, generateAndSaveDailyPlan, getDailyPlan } from '@/lib/daily-plan-store';
import { listPendingGoalActions } from '@/lib/goal-plans';

export const dynamic = 'force-dynamic';

function readWeekStart(request: Request): string {
  const value = new URL(request.url).searchParams.get('weekStart');
  if (!value) throw new Error('需要提供周起始日期。');
  return value;
}

export function GET(request: Request) {
  try {
    const weekStart = readWeekStart(request);
    return Response.json({ dailyPlan: getDailyPlan(weekStart), pendingActions: listPendingGoalActions() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法读取日级计划' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { weekStart?: unknown; capacities?: unknown };
    if (typeof body.weekStart !== 'string') throw new Error('需要提供周起始日期。');
    if (body.capacities !== undefined && (!body.capacities || typeof body.capacities !== 'object' || Array.isArray(body.capacities))) {
      throw new Error('每日容量格式无效。');
    }
    generateAndSaveDailyPlan(body.weekStart, (body.capacities ?? {}) as Record<string, number>);
    return Response.json({ dailyPlan: getDailyPlan(body.weekStart), pendingActions: listPendingGoalActions() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法生成日级计划' }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { weekStart?: unknown };
    if (typeof body.weekStart !== 'string') throw new Error('需要提供周起始日期。');
    return Response.json({ dailyPlan: confirmDailyPlan(body.weekStart), pendingActions: listPendingGoalActions() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法确认日级计划' }, { status: 400 });
  }
}
