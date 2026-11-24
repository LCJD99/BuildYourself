import { apiError } from '../../../api-error';
import { editWeeklyPlan } from '../../../../../../lib/weekly-plans-v2';
import { getWeeklyReview } from '../../../../../../lib/weekly-reviews-v2';

export async function POST(request: Request, context: { params: Promise<{ weekStart: string }> }) {
  try {
    const [{ weekStart }, body] = await Promise.all([context.params, request.json() as Promise<{ revision?: unknown; message?: unknown }>]);
    const { review } = getWeeklyReview(weekStart);
    return Response.json(await editWeeklyPlan(review.planId, body.revision, body.message));
  } catch (error) { return apiError(error, '无法调整下周规划'); }
}
