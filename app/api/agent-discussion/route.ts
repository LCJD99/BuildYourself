import { businessAgent, discussWithAgent, getAgentContext, normalizeAgentContextSelection, resolveAgentContext } from '../../../lib/agent-context';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { message?: unknown; context?: unknown };
    const context = body.context === undefined
      ? getAgentContext()
      : resolveAgentContext(normalizeAgentContextSelection(body.context));
    const discussion = discussWithAgent(body.message, context);
    return Response.json({ agent: businessAgent, ...discussion });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法继续讨论' },
      { status: 400 },
    );
  }
}
