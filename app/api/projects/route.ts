import { createGoalProject, listGoalProjects } from '@/lib/goal-plans';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ projects: listGoalProjects() });
}

export async function POST(request: Request) {
  try {
    const project = createGoalProject(await request.json());
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '无法创建项目' }, { status: 400 });
  }
}
