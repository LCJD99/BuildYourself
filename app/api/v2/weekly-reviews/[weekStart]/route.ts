import { apiError } from '../../api-error';
import { getWeeklyReview } from '../../../../../lib/weekly-reviews-v2';

export async function GET(_request: Request, context: { params: Promise<{ weekStart: string }> }) {
  try { const { weekStart } = await context.params; return Response.json(getWeeklyReview(weekStart)); }
  catch (error) { return apiError(error, '无法读取周复盘'); }
}
