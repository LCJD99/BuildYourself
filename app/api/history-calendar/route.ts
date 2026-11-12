import { getHistoryCalendar } from '@/lib/history-calendar';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(getHistoryCalendar());
}
