import { handleRoute } from '@/lib/server/errors';
import { requireUser } from '@/lib/server/auth';
import { buildReportForRun } from '@/lib/server/runs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const report = await buildReportForRun(user.id, id);
    const body = JSON.stringify(
      { $schema: 'https://smartqa.local/schemas/run-report.v1.json', ...report },
      null,
      2,
    );
    return new Response(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="smartqa-${id}.json"`,
        'cache-control': 'no-store',
      },
    });
  });
}
