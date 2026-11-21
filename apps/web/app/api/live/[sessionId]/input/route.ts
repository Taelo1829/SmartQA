import { liveInputSchema } from '@smartqa/shared';
import { getStore } from '@smartqa/db';
import { getLiveSession } from '@smartqa/engine';
import { HttpError, assertSameOrigin, handleRoute, json } from '@/lib/server/errors';
import { requireUser } from '@/lib/server/auth';
import { checkRateLimit } from '@/lib/server/rateLimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Forwards human mouse/keyboard events into the isolated browser.
 *
 * Input is only accepted while the session is interactive (takeover) or while
 * the run is waiting for a manual sign-in; the agent owns the browser otherwise.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const limit = checkRateLimit(`live-input:${user.id}`, 400, 60_000);
    if (!limit.allowed) throw new HttpError(429, 'Input rate limit exceeded', 'RATE_LIMITED');

    const { sessionId } = await context.params;
    const session = getLiveSession(sessionId);
    if (!session) throw new HttpError(404, 'Live session not found', 'NOT_FOUND');

    const store = await getStore();
    const run = await store.runs.get(session.runId);
    if (!run || run.userId !== user.id) throw new HttpError(403, 'Not your session', 'FORBIDDEN');
    if (!session.interactive && run.status !== 'awaiting_login') {
      throw new HttpError(409, 'Take control before sending input', 'NOT_INTERACTIVE');
    }

    const body = await request.json().catch(() => null);
    const parsed = liveInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid input event', 'VALIDATION', parsed.error.flatten());
    }
    await session.dispatchInput(parsed.data);
    return json({ ok: true });
  });
}
