import { saveEvidence } from '@/lib/store';
export async function POST(request: Request) { try {return Response.json(saveEvidence(await request.json()),{status:201});} catch(e) {return Response.json({error:e instanceof Error?e.message:'无法保存'}, {status:400});} }
