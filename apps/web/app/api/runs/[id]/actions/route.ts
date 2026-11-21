import { runActionSchema } from '@smartqa/shared';
import { HttpError, assertSameOrigin, handleRoute, json } from '@/lib/server/errors';
import { requireUser } from '@/lib/server/auth';
import { performRunAction } from '@/lib/server/runs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleRoute(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const parsed = runActionSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, 'Unknown action', 'VALIDATION', parsed.error.flatten());
    }
    const run = await performRunAction(user.id, id, parsed.data.action, parsed.data.findingId);
    return json({ run });
  });
}
