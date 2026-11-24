import { apiError } from '../api-error';
import { submitUnplannedActionFeedback, listUnplannedMiscellaneous } from '../../../../lib/action-feedback-v2';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await submitUnplannedActionFeedback({
      message: body?.message,
      idempotencyKey: body?.idempotencyKey,
      performedOn: body?.performedOn,
    });
    return Response.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return apiError(error, '无法保存计划外反馈');
  }
}

export async function GET() {
  try {
    return Response.json({ miscellaneous: listUnplannedMiscellaneous() });
  } catch (error) {
    return apiError(error, '无法读取杂项');
  }
}
