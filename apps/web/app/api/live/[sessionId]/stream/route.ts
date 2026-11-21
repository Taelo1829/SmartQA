import { getStore } from '@smartqa/db';
import { getLiveSession } from '@smartqa/engine';
import { requireUser } from '@/lib/server/auth';
import { sseStream } from '@/lib/server/sse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Screencast frames + interactive status for the live browser view. */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { sessionId } = await context.params;
  const session = getLiveSession(sessionId);
  if (!session) return new Response('Session not found', { status: 404 });
  const store = await getStore();
  const run = await store.runs.get(session.runId);
  if (!run || run.userId !== user.id) return new Response('Forbidden', { status: 403 });

  return sseStream((send) => {
    send({ type: 'status', status: run.status, interactive: session.interactive, at: new Date().toISOString() });
    const unsubscribe = session.subscribe((data) => {
      send({ type: 'frame', data, at: new Date().toISOString() });
    });
    const interval = setInterval(() => {
      send({ type: 'status', status: run.status, interactive: session.interactive, at: new Date().toISOString() });
    }, 5_000);
    if (typeof interval.unref === 'function') interval.unref();
    const cleanup = () => {
      unsubscribe();
      clearInterval(interval);
    };
    request.signal.addEventListener('abort', cleanup);
    return cleanup;
  });
}
