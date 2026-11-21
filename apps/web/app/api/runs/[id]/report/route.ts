import { handleRoute, json } from '@/lib/server/errors';
import { requireUser } from '@/lib/server/auth';
import { buildReportForRun } from '@/lib/server/runs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const report = await buildReportForRun(user.id, id);
    return json(report);
  });
}
