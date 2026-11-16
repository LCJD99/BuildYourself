import { listActionDates, listLongTermActions } from '../../../lib/long-term-goals';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const month = search.get('month');
  try {
    if (!month) throw new Error('请指定月份');
    const date = search.get('date');
    return Response.json(date
      ? { month, date, actions: listLongTermActions({ date }) }
      : { month, dates: listActionDates(month) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法读取行动安排' }, { status: 400 });
  }
}
