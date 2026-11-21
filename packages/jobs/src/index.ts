import { randomUUID } from 'node:crypto';
import {
  nowIso,
  type JobKind,
  type JobRecord,
  type JobState,
} from '@smartqa/shared';
import type { Store } from '@smartqa/db';

/**
 * Persistent job queue ports.
 *
 * `LocalQueue` is a durable, DB-backed queue polled by the process that owns the
 * store (zero-infrastructure mode). `BullQueue` is the Redis-backed production
 * implementation with real locks across worker processes.
 */

export interface EnqueueInput {
  kind: JobKind;
  userId: string;
  runId?: string | null;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
}

export type JobHandler = (job: JobRecord) => Promise<void>;

export interface JobQueue {
  readonly driver: 'local' | 'redis';
  enqueue(input: EnqueueInput): Promise<JobRecord>;
  start(handler: JobHandler): Promise<void>;
  stop(): Promise<void>;
  stats(): Promise<{ queued: number; active: number; failed: number }>;
}

export class LocalQueue implements JobQueue {
  readonly driver = 'local' as const;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private handler: JobHandler | null = null;
  private readonly workerId = `local-${randomUUID().slice(0, 8)}`;
  private executing = false;

  constructor(
    private readonly store: Store,
    private readonly pollMs = 750,
  ) {}

  async enqueue(input: EnqueueInput): Promise<JobRecord> {
    const job: JobRecord = {
      id: `job_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      kind: input.kind,
      runId: input.runId ?? null,
      userId: input.userId,
      payload: input.payload ?? {},
      state: 'queued',
      priority: input.priority ?? 0,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 2,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: null,
      finishedAt: null,
      error: null,
      workerId: null,
    };
    return this.store.jobs.create(job);
  }

  async start(handler: JobHandler): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.handler = handler;
    const tick = async () => {
      if (!this.running || this.executing) return;
      this.executing = true;
      try {
        await this.runOnce();
      } catch (error) {
        console.error('[smartqa] local queue tick failed:', error);
      } finally {
        this.executing = false;
      }
    };
    this.timer = setInterval(() => void tick(), this.pollMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    // Pick up jobs that were queued before this process started.
    void this.runOnce().catch(() => undefined);
  }

  private async runOnce(): Promise<void> {
    if (!this.handler) return;
    const queued = await this.store.jobs.find({
      where: { state: 'queued' },
      orderBy: { field: 'createdAt', direction: 'asc' },
      limit: 5,
    });
    const job = queued[0];
    if (!job) return;

    // Claim. The file store is single-process; BullMQ provides real locking for
    // multi-worker deployments.
    const active = await this.store.jobs.update(job.id, {
      state: 'active',
      attempts: job.attempts + 1,
      startedAt: nowIso(),
      updatedAt: nowIso(),
      workerId: this.workerId,
    });
    try {
      await this.handler(active);
      await this.store.jobs.update(job.id, {
        state: 'completed',
        finishedAt: nowIso(),
        updatedAt: nowIso(),
        error: null,
      });
    } catch (error) {
      const message = (error as Error).message;
      const retry = active.attempts < active.maxAttempts;
      await this.store.jobs.update(job.id, {
        state: retry ? 'queued' : 'failed',
        error: message,
        updatedAt: nowIso(),
        finishedAt: retry ? null : nowIso(),
      });
      console.error(`[smartqa] job ${job.id} failed (attempt ${active.attempts}):`, message);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async stats(): Promise<{ queued: number; active: number; failed: number }> {
    const count = async (state: JobState) => this.store.jobs.count({ state });
    return { queued: await count('queued'), active: await count('active'), failed: await count('failed') };
  }
}

/**
 * BullMQ adapter.
 *
 * Loaded lazily so local mode never opens a Redis connection. Requires
 * QUEUE_DRIVER=redis and REDIS_URL.
 */
export class BullQueue implements JobQueue {
  readonly driver = 'redis' as const;
  private queue: unknown = null;
  private worker: unknown = null;

  constructor(
    private readonly redisUrl: string,
    private readonly store: Store,
  ) {}

  private async connection() {
    const { default: IORedis } = await import('ioredis');
    return new IORedis(this.redisUrl, { maxRetriesPerRequest: null });
  }

  async enqueue(input: EnqueueInput): Promise<JobRecord> {
    const job: JobRecord = {
      id: `job_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      kind: input.kind,
      runId: input.runId ?? null,
      userId: input.userId,
      payload: input.payload ?? {},
      state: 'queued',
      priority: input.priority ?? 0,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 2,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: null,
      finishedAt: null,
      error: null,
      workerId: null,
    };
    await this.store.jobs.create(job);
    const { Queue } = await import('bullmq');
    const connection = await this.connection();
    this.queue ??= new Queue('smartqa', { connection });
    await (this.queue as InstanceType<typeof Queue>).add(
      input.kind,
      { jobId: job.id },
      { jobId: job.id, priority: input.priority ?? 0, attempts: job.maxAttempts },
    );
    return job;
  }

  async start(handler: JobHandler): Promise<void> {
    const { Worker } = await import('bullmq');
    const connection = await this.connection();
    this.worker = new Worker(
      'smartqa',
      async (job) => {
        const jobId = (job.data as { jobId?: string }).jobId;
        if (!jobId) throw new Error('Job payload is missing jobId');
        const record = await this.store.jobs.get(jobId);
        if (!record) throw new Error(`Job ${jobId} not found`);
        await this.store.jobs.update(jobId, {
          state: 'active',
          startedAt: nowIso(),
          updatedAt: nowIso(),
          attempts: record.attempts + 1,
        });
        try {
          await handler({ ...record, state: 'active' });
          await this.store.jobs.update(jobId, { state: 'completed', finishedAt: nowIso(), updatedAt: nowIso() });
        } catch (error) {
          await this.store.jobs.update(jobId, {
            state: 'failed',
            error: (error as Error).message,
            updatedAt: nowIso(),
            finishedAt: nowIso(),
          });
          throw error;
        }
      },
      { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1) },
    );
  }

  async stop(): Promise<void> {
    await (this.worker as { close?: () => Promise<void> } | null)?.close?.();
    await (this.queue as { close?: () => Promise<void> } | null)?.close?.();
  }

  async stats(): Promise<{ queued: number; active: number; failed: number }> {
    const count = async (state: JobState) => this.store.jobs.count({ state });
    return { queued: await count('queued'), active: await count('active'), failed: await count('failed') };
  }
}

export async function createQueue(store: Store): Promise<JobQueue> {
  if (process.env.QUEUE_DRIVER === 'redis' && process.env.REDIS_URL) {
    return new BullQueue(process.env.REDIS_URL, store);
  }
  return new LocalQueue(store);
}
