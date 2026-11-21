import type { RunEvent, RunEventType, TestRun } from '@smartqa/shared';

/**
 * In-process event bus for live progress.
 *
 * SSE handlers subscribe here. Events are also persisted (logs) by the
 * orchestrator so a client that reconnects can replay state from the API.
 */
export type RunEventPayload = RunEvent extends infer T
  ? T extends { seq: number; at: string }
    ? Omit<T, 'seq' | 'at'>
    : never
  : never;

export class RunEventBus {
  private seq = 0;
  private readonly listeners = new Set<(event: RunEvent) => void>();
  private readonly ring: RunEvent[] = [];

  constructor(private readonly ringSize = 300) {}

  emit(payload: RunEventPayload): RunEvent {
    const event = { ...payload, seq: (this.seq += 1), at: new Date().toISOString() } as RunEvent;
    this.ring.push(event);
    if (this.ring.length > this.ringSize) this.ring.shift();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* a broken subscriber must not break the run */
      }
    }
    return event;
  }

  subscribe(listener: (event: RunEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  history(): RunEvent[] {
    return [...this.ring];
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  emitRun(run: TestRun): void {
    this.emit({ type: 'run', run });
  }

  emitHeartbeat(): void {
    this.emit({ type: 'heartbeat' });
  }
}

export const EVENT_TYPES: RunEventType[] = [
  'run',
  'progress',
  'log',
  'action',
  'page',
  'check',
  'finding',
  'snapshot',
  'heartbeat',
];
