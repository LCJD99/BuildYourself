import { apiError } from '../../../api-error';
import { getCalendarDay } from '../../../../../../lib/calendar-v2';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ date: string }> }) {
  try {
    const { date } = await context.params;
    const timeZone = new URL(request.url).searchParams.get('timeZone') ?? undefined;
    return Response.json(getCalendarDay(date, timeZone));
  } catch (error) {
    return apiError(error, '无法读取每日安排');
  }
}
