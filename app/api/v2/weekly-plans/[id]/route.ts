import { apiError } from '../../api-error';
import { getWeeklyPlan } from '../../../../../lib/weekly-plans-v2';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json(getWeeklyPlan(id));
  } catch (error) {
    return apiError(error, '无法读取每周规划');
  }
}
