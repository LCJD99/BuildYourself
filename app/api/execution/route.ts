import { setTaskExecution } from '@/lib/store';

export async function POST(request: Request) {
  try {
    const input=await request.json() as {completed?: unknown};
    if (typeof input.completed !== 'boolean') throw new Error('请选择有效的执行状态');
    return Response.json(setTaskExecution(input.completed));
  } catch(e) {
    return Response.json({error:e instanceof Error?e.message:'无法保存执行状态'}, {status:400});
  }
}
