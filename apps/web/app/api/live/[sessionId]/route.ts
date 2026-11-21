import { getStore } from '@smartqa/db';
import { getLiveSession } from '@smartqa/engine';
import { HttpError, handleRoute, json } from '@/lib/server/errors';
import { requireUser } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const user = await requireUser();
    const { sessionId } = await context.params;
    const session = getLiveSession(sessionId);
    if (!session) throw new HttpError(404, 'Live session not found or expired', 'NOT_FOUND');
    const store = await getStore();
    const run = await store.runs.get(session.runId);
    if (!run || run.userId !== user.id) throw new HttpError(403, 'Not your session', 'FORBIDDEN');
    return json(session.info());
  });
}
