import { toPublicUser } from '@smartqa/db';
import { handleRoute, json } from '@/lib/server/errors';
import { requireUser } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const user = await requireUser();
    return json({ user: toPublicUser(user) });
  });
}
