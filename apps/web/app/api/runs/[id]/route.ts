import { handleRoute, json } from '@/lib/server/errors';
import { requireUser } from '@/lib/server/auth';
import { getRunDetail } from '@/lib/server/runs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const detail = await getRunDetail(user.id, id);
    return json(detail);
  });
}
