import { registerSchema } from '@smartqa/shared';
import { createLoginSession, getStore, recordAudit, registerUser, toPublicUser } from '@smartqa/db';
import { HttpError, assertSameOrigin, handleRoute, json } from '@/lib/server/errors';
import { attachSessionCookie } from '@/lib/server/auth';
import { checkRateLimit, clientKey } from '@/lib/server/rateLimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOrigin(request);
    const limit = checkRateLimit(clientKey(request, 'register'), 5, 60 * 60_000);
    if (!limit.allowed) {
      throw new HttpError(429, 'Too many accounts created from this address.', 'RATE_LIMITED');
    }
    const body = await request.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, 'Check the form fields and try again.', 'VALIDATION', parsed.error.flatten());
    }
    const store = await getStore();
    try {
      const user = await registerUser(store, {
        email: parsed.data.email,
        password: parsed.data.password,
        name: parsed.data.name,
      });
      const { token, expiresAt } = await createLoginSession(store, user.id);
      await recordAudit(store, { userId: user.id, action: 'auth.register' });
      const response = json({ user: toPublicUser(user) }, { status: 201 });
      attachSessionCookie(response, token, expiresAt);
      return response;
    } catch (error) {
      if ((error as Error & { code?: string }).code === 'EMAIL_TAKEN') {
        throw new HttpError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
      }
      throw error;
    }
  });
}
