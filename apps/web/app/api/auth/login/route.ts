import { credentialsSchema } from '@smartqa/shared';
import {
  authenticate,
  createLoginSession,
  ensureBootstrapUser,
  getConfig,
  getStore,
  recordAudit,
} from '@smartqa/db';
import { HttpError, assertSameOrigin, handleRoute, json } from '@/lib/server/errors';
import { attachSessionCookie } from '@/lib/server/auth';
import { checkRateLimit, clientKey } from '@/lib/server/rateLimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOrigin(request);
    const limit = checkRateLimit(clientKey(request, 'login'), 10, 5 * 60_000);
    if (!limit.allowed) {
      throw new HttpError(429, `Too many sign-in attempts. Try again in ${limit.retryAfterSeconds}s.`, 'RATE_LIMITED');
    }

    const body = await request.json().catch(() => null);
    const parsed = credentialsSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, 'Enter a valid email and password (min 8 characters).', 'VALIDATION', parsed.error.flatten());
    }

    const store = await getStore();
    const config = getConfig();
    if (parsed.data.email.toLowerCase() === config.bootstrap.email.toLowerCase()) {
      await ensureBootstrapUser(store, config.bootstrap);
    }
    const user = await authenticate(store, parsed.data.email, parsed.data.password);
    if (!user) throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');

    const { token, expiresAt } = await createLoginSession(store, user.id);
    await recordAudit(store, { userId: user.id, action: 'auth.login', ip: request.headers.get('x-forwarded-for') });

    const response = json({
      user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
    });
    attachSessionCookie(response, token, expiresAt);
    return response;
  });
}
