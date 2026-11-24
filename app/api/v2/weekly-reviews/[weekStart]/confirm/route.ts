import { apiError } from '../../../api-error';
import { confirmWeeklyReviewPlan } from '../../../../../../lib/weekly-reviews-v2';

export async function POST(request: Request, context: { params: Promise<{ weekStart: string }> }) {
  try {
    const [{ weekStart }, body] = await Promise.all([context.params, request.json() as Promise<{ revision?: unknown }>]);
    return Response.json(confirmWeeklyReviewPlan(weekStart, body.revision));
  } catch (error) { return apiError(error, '无法确认下周规划'); }
}
