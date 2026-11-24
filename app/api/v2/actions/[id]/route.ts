import { apiError } from '../../api-error';
import { getActionRecord } from '../../../../../lib/action-feedback-v2';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(getActionRecord((await context.params).id));
  } catch (error) {
    return apiError(error, '无法读取行动');
  }
}
