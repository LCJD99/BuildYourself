import { getHistoryCalendar } from '../../../lib/history-calendar';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const timeZone = new URL(request.url).searchParams.get('timeZone') || 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone }).format(new Date(0)); } catch {
    return Response.json({ error: '时区无效' }, { status: 400 });
  }
  return Response.json(getHistoryCalendar(timeZone));
}
