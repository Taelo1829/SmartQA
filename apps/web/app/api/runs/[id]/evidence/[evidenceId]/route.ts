import { getRuntime, getStore } from '@smartqa/db';
import { HttpError, handleRoute } from '@/lib/server/errors';
import { requireUser } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Authenticated evidence delivery. Objects are never served from a public path. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; evidenceId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id, evidenceId } = await context.params;
    const store = await getStore();
    const run = await store.runs.get(id);
    if (!run || run.userId !== user.id) throw new HttpError(404, 'Run not found', 'NOT_FOUND');
    const evidence = await store.evidence.get(evidenceId);
    if (!evidence || evidence.runId !== id) throw new HttpError(404, 'Evidence not found', 'NOT_FOUND');

    const objects = getRuntime().objects;
    const object = await objects.get(evidence.storageKey);
    const download = new URL(request.url).searchParams.get('download') === '1';
    const headers: Record<string, string> = {
      'content-type': object.contentType,
      'content-length': String(object.data.length),
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    };
    if (download || evidence.kind === 'trace') {
      headers['content-disposition'] = `attachment; filename="${evidence.label.replace(/[^\w.-]+/g, '_')}"`;
    }
    return new Response(new Uint8Array(object.data), { headers });
  });
}
