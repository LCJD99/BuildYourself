import { nodes, evaluate } from '@/lib/model';
import { getContext, listEvidence } from '@/lib/store';
export const dynamic = 'force-dynamic';
export function GET() { const evidence=listEvidence(); return Response.json({nodes, evidence, results:evaluate(evidence), context:getContext()}); }
