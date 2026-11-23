import { listEnabledGoals } from '../../../../lib/goal-drafts-v2';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ goals: listEnabledGoals() });
}
