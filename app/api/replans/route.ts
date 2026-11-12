import { createReplanProposal, decideReplanProposal, editReplanProposal, listReplanProposals } from '@/lib/replanning';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : '无法处理重排建议。' }, { status: 400 });
}

export function GET(request: Request) {
  try {
    const weekStart = new URL(request.url).searchParams.get('weekStart');
    if (!weekStart) throw new Error('需要提供周起始日期。');
    return Response.json({ proposals: listReplanProposals(weekStart) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { weekStart?: unknown; trigger?: unknown; reason?: unknown; capacities?: unknown };
    const proposal = createReplanProposal({ weekStart: body.weekStart, trigger: body.trigger, reason: body.reason, capacities: body.capacities });
    return Response.json({ proposal }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { proposalId?: unknown; placements?: unknown };
    if (typeof body.proposalId !== 'string') throw new Error('需要提供重排建议 ID。');
    return Response.json({ proposal: editReplanProposal(body.proposalId, body.placements) });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { proposalId?: unknown; decision?: unknown };
    if (typeof body.proposalId !== 'string') throw new Error('需要提供重排建议 ID。');
    return Response.json({ proposal: decideReplanProposal(body.proposalId, body.decision) });
  } catch (error) { return errorResponse(error); }
}
