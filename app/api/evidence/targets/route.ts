import { listGoalEvidenceTargets } from '../../../../lib/goal-plans';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ targets: listGoalEvidenceTargets() });
}
