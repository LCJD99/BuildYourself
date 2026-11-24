import { apiError } from '../api-error';
import { createWeeklyReview } from '../../../../lib/weekly-reviews-v2';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { weekStart: unknown; weekFeedback: unknown; nextWeekFeedback: unknown };
    return Response.json(await createWeeklyReview(body), { status: 201 });
  } catch (error) { return apiError(error, '无法生成周复盘和下周规划'); }
}
