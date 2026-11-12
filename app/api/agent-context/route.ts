import { businessAgent, getAgentContext, setAgentContext } from '../../../lib/agent-context';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    return Response.json({ agent: businessAgent, context: getAgentContext() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法读取讨论上下文' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { selection?: unknown; revision?: unknown };
    const wrapped = Object.hasOwn(body, 'selection');
    const context = setAgentContext(wrapped ? body.selection : body, wrapped ? body.revision : undefined);
    return Response.json({ agent: businessAgent, context });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法切换讨论上下文' },
      { status: 400 },
    );
  }
}
