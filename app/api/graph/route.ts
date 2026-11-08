import { assessEvidence, nodes, evaluate } from '@/lib/model';
import { getContext, getEvidenceRequirements, getTaskExecution, listEvidence } from '@/lib/store';
export const dynamic = 'force-dynamic';
export function GET() {
  const evidence=listEvidence();
  const requirements=getEvidenceRequirements();
  return Response.json({
    nodes,
    evidence,
    results:evaluate(evidence),
    assessments:{
      task:assessEvidence(evidence,'task',requirements.task),
      milestone:assessEvidence(evidence,'milestone',requirements.milestone),
    },
    requirements,
    taskExecution:getTaskExecution(),
    context:getContext(),
  });
}
