import { createRunSchema } from '@smartqa/shared';
import { handleRoute, json, HttpError, assertSameOrigin } from '@/lib/server/errors';
import { requireUser } from '@/lib/server/auth';
import { checkRateLimit } from '@/lib/server/rateLimit';
import { createRun, listRunsForUser } from '@/lib/server/runs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    const result = await listRunsForUser(user.id, {
      limit: Number(url.searchParams.get('limit') ?? 25),
      status: url.searchParams.get('status') ?? undefined,
      mode: url.searchParams.get('mode') ?? undefined,
    });
    return json(result);
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const limit = checkRateLimit(`runs:${user.id}`, 8, 10 * 60_000);
    if (!limit.allowed) {
      throw new HttpError(
        429,
        `Run creation limit reached. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
        'RATE_LIMITED',
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = createRunSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, 'Please check the run configuration.', 'VALIDATION', parsed.error.flatten());
    }

    const result = await createRun(user, parsed.data);
    return json(result, { status: 201 });
  });
}
