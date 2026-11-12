import { getWeeklyReview, saveWeeklyReview } from '../../../lib/weekly-review-store';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  try {
    const weekStart = new URL(request.url).searchParams.get('weekStart');
    if (!weekStart) throw new Error('请指定周复盘的周一日期。');
    const timeZone = new URL(request.url).searchParams.get('timeZone') ?? 'UTC';
    return Response.json(getWeeklyReview(weekStart, timeZone));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法读取周复盘' }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const input = await request.json() as { weekStart?: unknown; timeZone?: unknown; adjustment?: unknown };
    if (typeof input.weekStart !== 'string') throw new Error('请指定周复盘的周一日期。');
    if (input.timeZone !== undefined && typeof input.timeZone !== 'string') throw new Error('时区格式无效。');
    return Response.json(saveWeeklyReview(input.weekStart, input.adjustment, input.timeZone ?? 'UTC'));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法保存周复盘' }, { status: 400 });
  }
}
