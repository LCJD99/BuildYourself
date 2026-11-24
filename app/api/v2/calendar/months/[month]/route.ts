import { apiError } from '../../../api-error';
import { getCalendarMonth } from '../../../../../../lib/calendar-v2';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ month: string }> }) {
  try {
    const { month } = await context.params;
    const timeZone = new URL(request.url).searchParams.get('timeZone') ?? undefined;
    return Response.json(getCalendarMonth(month, timeZone));
  } catch (error) {
    return apiError(error, '无法读取月历安排');
  }
}
