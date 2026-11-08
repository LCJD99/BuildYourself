import { assessEvidence, nodes, evaluate } from '@/lib/model';
import { getContext, getEvidenceRequirements, getTaskExecution, listEvidence } from '@/lib/store';
import { evaluateMilestone } from '@/lib/milestone-review';
import { getMilestoneConfirmation, listMilestoneChanges } from '@/lib/milestone-store';
export const dynamic = 'force-dynamic';
export function GET() {
  const evidence=listEvidence();
  const requirements=getEvidenceRequirements();
  const confirmation=getMilestoneConfirmation();
  const baseResults=evaluate(evidence);
  return Response.json({
    nodes,
    evidence,
    results:[baseResults[0], evaluateMilestone(evidence, confirmation)],
    assessments:{
      task:assessEvidence(evidence,'task',requirements.task),
      milestone:assessEvidence(evidence,'milestone',requirements.milestone),
    },
    requirements,
    taskExecution:getTaskExecution(),
    milestoneConfirmation:confirmation,
    changes:listMilestoneChanges(),
    context:getContext(),
  });
}
