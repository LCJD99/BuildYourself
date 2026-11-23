import { apiError } from '../../../api-error';
import { confirmWeeklyPlan } from '../../../../../../lib/weekly-plans-v2';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { revision?: unknown };
    return Response.json(confirmWeeklyPlan(id, body.revision));
  } catch (error) {
    return apiError(error, '无法确认每周规划');
  }
}
