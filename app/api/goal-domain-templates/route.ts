import { listGoalDomainTemplates } from '../../../lib/goal-domain-templates';

export function GET() {
  return Response.json({ templates: listGoalDomainTemplates() });
}
