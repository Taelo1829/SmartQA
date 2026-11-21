import { nowIso, type LiveInput, type LiveSessionInfo, type RunStatus, type ViewportName } from '@smartqa/shared';
import { RunEventBus } from '../events';

/**
 * In-process registry for live browser sessions, run event buses and control
 * handles. It is intentionally process-local: a live run is pinned to the
 * process that owns its browser, while background runs are queue-driven and can
 * be picked up by any worker.
 *
 * Cached on globalThis so Next.js hot reload does not orphan a running session.
 */

export type LiveFrameSink = (base64Jpeg: string) => void;

export class LiveSession {
  readonly id: string;
  readonly runId: string;
  readonly viewport: { width: number; height: number };
  readonly startedAt = nowIso();
  status: RunStatus = 'running';
  interactive = false;
  viewerCount = 0;
  private lastFrame: { data: string; at: string } | null = null;
  private readonly listeners = new Set<LiveFrameSink>();
  private inputSink: ((input: LiveInput) => Promise<void>) | null = null;

  constructor(id: string, runId: string, viewport: { width: number; height: number }) {
    this.id = id;
    this.runId = runId;
    this.viewport = viewport;
  }

  /** Wired by the orchestrator once the browser exists. */
  setInputSink(sink: (input: LiveInput) => Promise<void>): void {
    this.inputSink = sink;
  }

  async dispatchInput(input: LiveInput): Promise<void> {
    if (!this.inputSink) throw new Error('Browser session is not accepting input yet');
    await this.inputSink(input);
  }

  pushFrame(data: string): void {
    this.lastFrame = { data, at: nowIso() };
    for (const listener of this.listeners) {
      try {
        listener(data);
      } catch {
        /* ignore dead subscriber */
      }
    }
  }

  subscribe(listener: LiveFrameSink): () => void {
    this.listeners.add(listener);
    this.viewerCount = this.listeners.size;
    if (this.lastFrame) listener(this.lastFrame.data);
    return () => {
      this.listeners.delete(listener);
      this.viewerCount = this.listeners.size;
    };
  }

  latestFrame(): { data: string; at: string } | null {
    return this.lastFrame;
  }

  info(): LiveSessionInfo {
    return {
      id: this.id,
      runId: this.runId,
      status: this.status,
      viewport: this.viewport,
      interactive: this.interactive,
      viewerCount: this.viewerCount,
      startedAt: this.startedAt,
    };
  }
}

export class RunControl {
  paused = false;
  stopped = false;
  takeover = false;
  detachRequested = false;
  loginCompleted = false;
  private loginWaiters: Array<() => void> = [];

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  requestTakeover(): void {
    this.paused = true;
    this.takeover = true;
  }

  release(): void {
    this.takeover = false;
    this.paused = false;
  }

  stop(): void {
    this.stopped = true;
    this.paused = false;
    this.resolveLogin();
  }

  detach(): void {
    this.detachRequested = true;
  }

  completeLogin(): void {
    this.loginCompleted = true;
    this.resolveLogin();
  }

  private resolveLogin(): void {
    const waiters = this.loginWaiters.splice(0);
    for (const waiter of waiters) waiter();
  }

  /** Resolves when a human completes sign-in, the run is stopped, or timeout. */
  async waitForLogin(timeoutMs: number): Promise<'completed' | 'stopped' | 'timeout'> {
    if (this.loginCompleted) return 'completed';
    if (this.stopped) return 'stopped';
    return new Promise((resolve) => {
      let settled = false;
      const finish = (reason: 'completed' | 'stopped' | 'timeout') => {
        if (settled) return;
        settled = true;
        resolve(reason);
      };
      this.loginWaiters.push(() => finish(this.stopped ? 'stopped' : 'completed'));
      setTimeout(() => finish(this.stopped ? 'stopped' : 'timeout'), timeoutMs);
    });
  }

  /** Cooperative pause/stop checkpoint used between agent steps. */
  async gate(): Promise<void> {
    while (this.paused && !this.stopped) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

interface Registry {
  live: Map<string, LiveSession>;
  liveByRun: Map<string, LiveSession>;
  buses: Map<string, RunEventBus>;
  controls: Map<string, RunControl>;
}

const KEY = Symbol.for('smartqa.run-registry.v1');

function registry(): Registry {
  const global_ = globalThis as typeof globalThis & { [KEY]?: Registry };
  if (!global_[KEY]) {
    global_[KEY] = {
      live: new Map(),
      liveByRun: new Map(),
      buses: new Map(),
      controls: new Map(),
    };
  }
  return global_[KEY]!;
}

export function createLiveSession(input: {
  id: string;
  runId: string;
  viewport: { width: number; height: number };
}): LiveSession {
  const session = new LiveSession(input.id, input.runId, input.viewport);
  registry().live.set(session.id, session);
  registry().liveByRun.set(session.runId, session);
  return session;
}

export function getLiveSession(id: string): LiveSession | null {
  return registry().live.get(id) ?? null;
}

export function getLiveSessionForRun(runId: string): LiveSession | null {
  return registry().liveByRun.get(runId) ?? null;
}

export function removeLiveSession(id: string): void {
  const reg = registry();
  const session = reg.live.get(id);
  if (session) {
    reg.live.delete(id);
    reg.liveByRun.delete(session.runId);
  }
}

export function getRunBus(runId: string): RunEventBus {
  const reg = registry();
  let bus = reg.buses.get(runId);
  if (!bus) {
    bus = new RunEventBus();
    reg.buses.set(runId, bus);
  }
  return bus;
}

export function getRunControl(runId: string): RunControl | null {
  return registry().controls.get(runId) ?? null;
}

export function setRunControl(runId: string, control: RunControl): void {
  registry().controls.set(runId, control);
}

export function removeRunControl(runId: string): void {
  registry().controls.delete(runId);
}

export function activeRunCount(): number {
  return registry().controls.size;
}

export function liveSessionInfos(): LiveSessionInfo[] {
  return [...registry().live.values()].map((session) => session.info());
}
