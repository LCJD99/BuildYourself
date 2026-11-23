import { apiError } from '../../../api-error';
import { generateWeeklyPlanForGoal, getWeeklyPlanForGoal } from '../../../../../../lib/weekly-plans-v2';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const weekStart = new URL(request.url).searchParams.get('weekStart') ?? undefined;
    return Response.json(getWeeklyPlanForGoal(id, weekStart));
  } catch (error) {
    return apiError(error, '无法读取每周规划生成状态');
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { weekStart?: unknown };
    const result = await generateWeeklyPlanForGoal(id, body.weekStart === undefined ? undefined : body.weekStart as string);
    return Response.json(result);
  } catch (error) {
    return apiError(error, '无法重新生成每周规划');
  }
}
