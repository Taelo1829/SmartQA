import {
  nowIso,
  shortId,
  type AuthSessionRecord,
  type PublicUser,
  type Site,
  type User,
} from '@smartqa/shared';
import { createSessionToken, hashPassword, hashToken, verifyPassword } from './crypto';
import type { Store } from './store/types';

export const SESSION_COOKIE = 'smartqa_session';
const SESSION_TTL_MS = 7 * 86_400_000;

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Idempotently create the bootstrap operator account (local/dev convenience). */
export async function ensureBootstrapUser(
  store: Store,
  input: { email: string; password: string; name: string },
): Promise<User> {
  const email = normalizeEmail(input.email);
  const existing = await store.users.find({ where: { email }, limit: 1 });
  if (existing[0]) return existing[0];
  const now = nowIso();
  return store.users.create({
    id: shortId('usr'),
    email,
    name: input.name,
    passwordHash: hashPassword(input.password),
    createdAt: now,
    updatedAt: now,
  });
}

export async function registerUser(
  store: Store,
  input: { email: string; password: string; name: string },
): Promise<User> {
  const email = normalizeEmail(input.email);
  const existing = await store.users.find({ where: { email }, limit: 1 });
  if (existing[0]) {
    const error = new Error('An account with this email already exists');
    (error as Error & { code?: string }).code = 'EMAIL_TAKEN';
    throw error;
  }
  const now = nowIso();
  return store.users.create({
    id: shortId('usr'),
    email,
    name: input.name.trim(),
    passwordHash: hashPassword(input.password),
    createdAt: now,
    updatedAt: now,
  });
}

export async function authenticate(store: Store, email: string, password: string): Promise<User | null> {
  const users = await store.users.find({ where: { email: normalizeEmail(email) }, limit: 1 });
  const user = users[0];
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user;
}

export async function createLoginSession(
  store: Store,
  userId: string,
): Promise<{ token: string; expiresAt: string; session: AuthSessionRecord }> {
  const token = createSessionToken();
  const now = new Date();
  const session: AuthSessionRecord = {
    id: shortId('ses'),
    userId,
    tokenHash: hashToken(token),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    lastSeenAt: now.toISOString(),
  };
  await store.authSessions.create(session);
  return { token, expiresAt: session.expiresAt, session };
}

export async function resolveSession(store: Store, token: string | undefined | null): Promise<User | null> {
  if (!token) return null;
  const hash = hashToken(token);
  const sessions = await store.authSessions.find({ where: { tokenHash: hash }, limit: 1 });
  const session = sessions[0];
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await store.authSessions.delete(session.id);
    return null;
  }
  const user = await store.users.get(session.userId);
  if (!user) return null;
  // Touch at most once per minute to avoid a write per request.
  if (Date.now() - new Date(session.lastSeenAt).getTime() > 60_000) {
    await store.authSessions.update(session.id, { lastSeenAt: nowIso() });
  }
  return user;
}

export async function destroySession(store: Store, token: string | undefined | null): Promise<void> {
  if (!token) return;
  const hash = hashToken(token);
  const sessions = await store.authSessions.find({ where: { tokenHash: hash }, limit: 5 });
  for (const session of sessions) await store.authSessions.delete(session.id);
}

/**
 * Site registry. A site is created the first time a user tests an origin, and
 * records their attestation of ownership/authorisation.
 */
export async function ensureSite(
  store: Store,
  input: { userId: string; origin: string; name?: string; authorizationConfirmedAt?: string },
): Promise<Site> {
  const existing = await store.sites.find({ where: { userId: input.userId, origin: input.origin }, limit: 1 });
  const now = nowIso();
  if (existing[0]) {
    if (existing[0].authorizationConfirmedAt) {
      return store.sites.update(existing[0].id, { updatedAt: now, name: input.name ?? existing[0].name });
    }
    return store.sites.update(existing[0].id, {
      updatedAt: now,
      authorizationConfirmedAt: input.authorizationConfirmedAt ?? now,
    });
  }
  return store.sites.create({
    id: shortId('site'),
    userId: input.userId,
    origin: input.origin,
    name: input.name ?? input.origin.replace(/^https?:\/\//, ''),
    authorizationConfirmedAt: input.authorizationConfirmedAt ?? now,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    runCount: 0,
  });
}

export async function recordAudit(
  store: Store,
  input: { userId?: string | null; runId?: string | null; action: string; detail?: Record<string, unknown>; ip?: string | null },
): Promise<void> {
  await store.audit.create({
    id: shortId('aud'),
    userId: input.userId ?? null,
    runId: input.runId ?? null,
    action: input.action,
    detail: input.detail ?? null,
    ip: input.ip ?? null,
    at: nowIso(),
  });
}
