import { correctEvidence } from '@/lib/milestone-store';
import { saveEvidence } from '@/lib/store';
export async function POST(request: Request) { try {return Response.json(saveEvidence(await request.json()),{status:201});} catch(e) {return Response.json({error:e instanceof Error?e.message:'无法保存'}, {status:400});} }
export async function PATCH(request: Request) { try { const body=await request.json() as {id?:unknown;[key:string]:unknown}; const {id,...input}=body; return Response.json(correctEvidence(id,input)); } catch(e) {return Response.json({error:e instanceof Error?e.message:'无法更正'}, {status:400});} }
