import { apiError } from '../../../../../api-error';
import { getGoalAttributeContributions } from '../../../../../../../../lib/action-feedback-v2';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string; attributeId: string }> }) {
  try {
    const { id, attributeId } = await context.params;
    return Response.json({ contributions: getGoalAttributeContributions(id, attributeId) });
  } catch (error) {
    return apiError(error, '无法读取属性贡献');
  }
}
