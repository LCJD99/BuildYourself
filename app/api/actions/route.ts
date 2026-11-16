import { createLongTermAction, listLongTermActions } from '../../../lib/long-term-goals';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  try {
    return Response.json({ actions: listLongTermActions({ month: search.get('month') ?? undefined, date: search.get('date') ?? undefined }) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法读取行动' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    return Response.json({ action: createLongTermAction(await request.json()) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法保存行动' }, { status: 400 });
  }
}
