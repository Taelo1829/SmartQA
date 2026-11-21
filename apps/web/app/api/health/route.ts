import { nowIso } from '@smartqa/shared';
import { getConfig, getStore } from '@smartqa/db';
import { handleRoute, json } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const config = getConfig();
    const checks: Record<string, { ok: boolean; detail: string }> = {
      config: { ok: true, detail: `storage=${config.storageDriver} queue=${config.queueDriver}` },
      storage: { ok: false, detail: 'not probed' },
      browser: { ok: true, detail: 'Playwright chromium (probed at run time)' },
      ai: {
        ok: true,
        detail: config.llm.enabled ? `model ${config.llm.model}` : 'deterministic heuristics (no LLM key configured)',
      },
    };
    try {
      const store = await getStore();
      await store.runs.count({});
      checks.storage = { ok: true, detail: `${config.storageDriver} reachable` };
    } catch (error) {
      checks.storage = { ok: false, detail: (error as Error).message };
    }

    return json({
      ok: Object.values(checks).every((check) => check.ok),
      version: '1.0.0',
      storage: config.storageDriver,
      queue: config.queueDriver,
      ai: config.llm.enabled,
      time: nowIso(),
      checks,
    });
  });
}
