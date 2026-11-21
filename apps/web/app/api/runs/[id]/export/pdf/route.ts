import { HttpError, handleRoute } from '@/lib/server/errors';
import { requireUser, sessionToken } from '@/lib/server/auth';
import { buildReportForRun } from '@/lib/server/runs';
import { renderRunReportPdf } from '@/lib/server/pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    // Validates ownership before rendering anything.
    await buildReportForRun(user.id, id);
    const token = await sessionToken();
    let pdf: Buffer;
    try {
      pdf = await renderRunReportPdf({ runId: id, sessionToken: token });
    } catch (error) {
      throw new HttpError(
        503,
        `PDF rendering is unavailable: ${(error as Error).message}. The JSON export always works.`,
        'PDF_UNAVAILABLE',
      );
    }
    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="smartqa-${id}.pdf"`,
        'cache-control': 'no-store',
      },
    });
  });
}
