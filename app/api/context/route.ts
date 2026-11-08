import { setContext } from '@/lib/store';
export async function POST(request: Request) { try { const {id}=await request.json(); setContext(id); return Response.json({ok:true}); } catch {return Response.json({error:'无效的对象'}, {status:400});} }
