import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'smartqa_session';

/**
 * Page-level auth gate. API routes authenticate themselves and are deliberately
 * excluded from the matcher so SSE streams and JSON endpoints keep working.
 */
export function middleware(request: NextRequest): NextResponse {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = '';
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/runs', '/runs/:path*'],
};
