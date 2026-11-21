import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import type { User } from '@smartqa/shared';
import { SESSION_COOKIE, getStore, resolveSession } from '@smartqa/db';
import { HttpError } from './errors';

/** Resolve the current user from the signed session cookie. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const store = await getStore();
  return resolveSession(store, token);
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, 'Sign in to continue', 'UNAUTHENTICATED');
  return user;
}

export function attachSessionCookie(response: NextResponse, token: string, expiresAt: string): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function assertOwnsRun(userId: string, runId: string): Promise<import('@smartqa/shared').TestRun> {
  const store = await getStore();
  const run = await store.runs.get(runId);
  if (!run || run.userId !== userId) throw new HttpError(404, 'Run not found', 'NOT_FOUND');
  return run;
}
