import { listGoalPlans, listGoalPlanActions, listGoalPlanEvaluations, listPendingGoalActions, listTaskDecompositionProposals, listGoalProjects, saveGoalPlanDraft } from '../../../lib/goal-plans';
import { listChangeEvents } from '../../../lib/milestone-store';
import { listEvidence } from '../../../lib/store';
import { listExternalCommitments } from '../../../lib/commitments';

export const dynamic = 'force-dynamic';

type GoalPlanEvaluationRecord = ReturnType<typeof listGoalPlanEvaluations>[number];
type PublicEvaluation = Omit<GoalPlanEvaluationRecord, 'contractVersion' | 'evidenceSnapshots'> & {
  contractVersion: { version: number };
};

function publicEvaluation(evaluation: ReturnType<typeof listGoalPlanEvaluations>[number]): PublicEvaluation {
  const { evidenceSnapshots: _evidenceSnapshots, ...summary } = evaluation;
  return {
    ...summary,
    contractVersion: { version: evaluation.contractVersion.version },
  };
}

export function GET() {
  const changes = listChangeEvents().filter(event => event.eventType === 'task.created' || event.eventType === 'task.updated');
  const plans = listGoalPlans();
  const evaluations = plans.flatMap(plan => listGoalPlanEvaluations(plan.id).map(publicEvaluation));
  const latestEvaluations = Object.fromEntries(plans.map(plan => {
    const evaluation = evaluations.filter(item => item.goalPlanId === plan.id).at(-1);
    return [plan.id, evaluation ? {
      id: evaluation.id,
      goalPlanId: evaluation.goalPlanId,
      outcome: evaluation.outcome,
      status: evaluation.status,
      summary: evaluation.summary,
      observedAt: evaluation.observedAt,
      evaluatedAt: evaluation.evaluatedAt,
      evidenceIds: evaluation.evidenceIds,
      contractVersion: evaluation.contractVersion,
    } : null];
  }));
  return Response.json({
    plans,
    latestEvaluations,
    pendingActions: listPendingGoalActions(),
    actions: listGoalPlanActions(),
    taskProposals: listTaskDecompositionProposals(),
    taskChanges: changes,
    projects: listGoalProjects(),
    evidence: listEvidence(),
    commitments: listExternalCommitments(),
    evaluations,
  });
}

export async function POST(request: Request) {
  try {
    const plan = saveGoalPlanDraft(await request.json());
    return Response.json({ plan }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '无法保存目标草稿' },
      { status: 400 },
    );
  }
}
