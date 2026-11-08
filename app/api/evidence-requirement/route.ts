import { setEvidenceRequirement } from '@/lib/store';

export async function POST(request: Request) {
  try {
    const input=await request.json() as {nodeId?: unknown;minimumEvidenceLevel?: unknown};
    setEvidenceRequirement(input.nodeId,input.minimumEvidenceLevel);
    return Response.json({ok:true});
  } catch(e) {
    return Response.json({error:e instanceof Error?e.message:'无法保存证据要求'}, {status:400});
  }
}
