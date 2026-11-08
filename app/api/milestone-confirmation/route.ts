import { confirmMilestone } from '@/lib/milestone-store';

export async function POST(request: Request) {
  try {
    const input = await request.json() as { id?: unknown };
    const result = confirmMilestone(input.id);
    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法确认里程碑' },
      { status: 400 },
    );
  }
}
