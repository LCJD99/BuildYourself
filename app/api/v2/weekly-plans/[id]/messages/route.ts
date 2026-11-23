import { apiError } from '../../../api-error';
import { editWeeklyPlan } from '../../../../../../lib/weekly-plans-v2';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { revision?: unknown; message?: unknown };
    const result = await editWeeklyPlan(id, body.revision, body.message);
    return Response.json(result);
  } catch (error) {
    return apiError(error, '无法修改每周规划');
  }
}
