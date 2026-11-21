import { destroySession, getStore } from '@smartqa/db';
import { handleRoute, json } from '@/lib/server/errors';
import { clearSessionCookie, sessionToken } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  return handleRoute(async () => {
    const token = await sessionToken();
    if (token) {
      const store = await getStore();
      await destroySession(store, token);
    }
    const response = json({ ok: true });
    clearSessionCookie(response);
    return response;
  });
}
