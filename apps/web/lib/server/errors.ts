import { NextResponse } from 'next/server';
import type { ApiError } from '@smartqa/shared';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = 'ERROR',
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function json<T>(body: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, init);
}

export function apiError(status: number, message: string, code = 'ERROR', details?: unknown): NextResponse {
  const body: ApiError = { error: message, code, details };
  return NextResponse.json(body, { status });
}

type Handler = () => Promise<Response>;

/** Wraps a route handler so thrown HttpErrors become structured JSON. */
export async function handleRoute(handler: Handler): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof HttpError) {
      return apiError(error.status, error.message, error.code, error.details);
    }
    console.error('[smartqa] unhandled API error:', error);
    const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : (error as Error).message;
    return apiError(500, message, 'INTERNAL');
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const host = request.headers.get('host');
  try {
    if (new URL(origin).host !== host) {
      throw new HttpError(403, 'Cross-origin request rejected', 'CSRF');
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, 'Invalid origin header', 'CSRF');
  }
}
