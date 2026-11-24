import { apiError } from '../api-error';
import { submitPlannedActionFeedback } from '../../../../lib/action-feedback-v2';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await submitPlannedActionFeedback({
      actionId: body?.actionId,
      message: body?.message,
      idempotencyKey: body?.idempotencyKey,
      performedOn: body?.performedOn,
    });
    return Response.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return apiError(error, '无法保存行动反馈');
  }
}
