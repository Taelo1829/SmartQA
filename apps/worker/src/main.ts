import { createQueue } from '@smartqa/jobs';
import { getStore } from '@smartqa/db';
import { handleJob } from '@smartqa/engine';

/**
 * Standalone background worker.
 *
 * Run with QUEUE_DRIVER=redis for horizontal scaling (BullMQ), or with the
 * default local driver for a single-process deployment where this worker owns
 * the queue instead of the web server (set INLINE_WORKER=false on the web app).
 */
async function main(): Promise<void> {
  const store = await getStore();
  const queue = await createQueue(store);
  console.log(`[smartqa-worker] driver=${queue.driver} starting`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[smartqa-worker] ${signal} received, draining`);
    await queue.stop();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await queue.start(async (job) => {
    console.log(`[smartqa-worker] job ${job.id} (${job.kind}) started`);
    await handleJob(job);
    console.log(`[smartqa-worker] job ${job.id} finished`);
  });
  await new Promise(() => {
    /* run until signalled */
  });
}

void main().catch((error) => {
  console.error('[smartqa-worker] fatal:', error);
  process.exit(1);
});
