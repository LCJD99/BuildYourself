import { GoalDraftError } from '../../../lib/goal-drafts-v2';

export function apiError(error: unknown, fallback: string) {
  if (error instanceof GoalDraftError) {
    return Response.json({ error: error.message, ...(error.issues ? { issues: error.issues } : {}) }, { status: error.status });
  }
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 400 });
}
