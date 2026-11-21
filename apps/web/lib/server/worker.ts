import { createQueue } from '@smartqa/jobs';
import { getStore } from '@smartqa/db';

/**
 * In-process worker for local mode.
 *
 * With QUEUE_DRIVER=redis the API must NOT run a worker (background jobs belong
 * to apps/worker). In file/local mode there is no separate broker, so the API
 * process hosts the durable queue consumer. Guarded by a global promise so hot
 * reload cannot start it twice.
 */

const KEY = Symbol.for('smartqa.inline-worker.v1');

type GlobalWithWorker = typeof globalThis & { [KEY]?: Promise<void> };

export async function ensureInlineWorker(): Promise<void> {
  if (process.env.QUEUE_DRIVER === 'redis') return;
  if (process.env.INLINE_WORKER === 'false') return;
  const global_ = globalThis as GlobalWithWorker;
  if (!global_[KEY]) {
    global_[KEY] = startInlineWorker().catch((error) => {
      console.error('[smartqa] inline worker failed to start:', error);
    });
  }
  await global_[KEY];
}

async function startInlineWorker(): Promise<void> {
  const store = await getStore();
  const queue = await createQueue(store);
  await queue.start(async (job) => {
    // Imported lazily so the engine (and Playwright) only loads when a job runs.
    const { handleJob } = await import('@smartqa/engine');
    await handleJob(job);
  });
  console.log(`[smartqa] inline ${queue.driver} worker started`);
}
