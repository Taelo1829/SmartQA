import { nowIso, type RunEvent } from '@smartqa/shared';
import { getStore } from '@smartqa/db';
import { getRunBus, type RunEventPayload } from '@smartqa/engine';
import { requireUser } from '@/lib/server/auth';
import { sseStream } from '@/lib/server/sse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Server-Sent Events for a run: initial state, recent log history, then every
 * live event. An EventSource auto-reconnects, so the client always recovers.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { id } = await context.params;
  const store = await getStore();
  const run = await store.runs.get(id);
  if (!run || run.userId !== user.id) {
    return new Response('Not found', { status: 404 });
  }

  return sseStream((send) => {
    let seq = 0;
    const emit = (event: RunEventPayload) => {
      seq += 1;
      send({ ...event, seq, at: nowIso() } as RunEvent);
    };

    emit({ type: 'run', run });
    const bus = getRunBus(id);
    for (const event of bus.history()) send(event);

    void store.logs
      .find({ where: { runId: id }, orderBy: { field: 'seq', direction: 'asc' }, limit: 300 })
      .then((logs) => {
        for (const log of logs) {
          send({
            type: 'log',
            seq: log.seq,
            at: log.at,
            level: log.level,
            message: log.message,
            actionId: log.actionId,
          } satisfies RunEvent);
        }
      })
      .catch(() => undefined);

    const unsubscribe = bus.subscribe((event) => send(event));
    const heartbeat = setInterval(() => emit({ type: 'heartbeat' }), 15_000);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    const cleanup = () => {
      unsubscribe();
      clearInterval(heartbeat);
    };
    request.signal.addEventListener('abort', cleanup);
    return cleanup;
  });
}
