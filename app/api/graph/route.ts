import { assessEvidence, nodes, evaluate } from '@/lib/model';
import { getContext, getEvidenceRequirements, getTaskExecution, listEvidence } from '@/lib/store';
import { evaluateMilestone } from '@/lib/milestone-review';
import { getMilestoneConfirmation, listChangeEvents } from '@/lib/milestone-store';
import { ensureDemoData } from '@/lib/demo-seed';
export const dynamic = 'force-dynamic';
export async function GET() {
  await ensureDemoData();
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
    changes:listChangeEvents(),
    context:getContext(),
  });
}
