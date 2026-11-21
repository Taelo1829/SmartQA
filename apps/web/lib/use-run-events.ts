'use client';

import { useEffect, useRef, useState } from 'react';
import type { RunEvent } from '@smartqa/shared/types';
import { runEventsUrl } from '@/lib/api';

const EVENT_TYPES = [
  'run',
  'progress',
  'log',
  'action',
  'page',
  'check',
  'finding',
  'snapshot',
  'heartbeat',
] as const;

export interface RunEventsState {
  events: RunEvent[];
  connected: boolean;
  lastEvent: RunEvent | null;
}

function parseRunEvent(raw: string): RunEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as { type?: unknown; seq?: unknown; at?: unknown };
    if (
      typeof candidate.type !== 'string' ||
      typeof candidate.seq !== 'number' ||
      typeof candidate.at !== 'string'
    ) {
      return null;
    }
    return parsed as RunEvent;
  } catch {
    return null;
  }
}

/**
 * Subscribes to the run event SSE stream. `EventSource` owns reconnection; this
 * hook only tracks connection state, de-duplicates replayed sequence numbers
 * and bounds the retained history so long runs cannot exhaust memory.
 */
export function useRunEvents(
  runId: string | null | undefined,
  options: { maxEvents?: number } = {},
): RunEventsState {
  const maxEvents = options.maxEvents ?? 500;
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<RunEvent | null>(null);
  const lastSeqRef = useRef(-1);

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      setConnected(false);
      setLastEvent(null);
      return;
    }

    lastSeqRef.current = -1;
    setEvents([]);
    setLastEvent(null);
    setConnected(false);

    const source = new EventSource(runEventsUrl(runId));

    const handleMessage = (message: Event) => {
      if (!(message instanceof MessageEvent)) return;
      const data: unknown = message.data;
      if (typeof data !== 'string') return;
      const event = parseRunEvent(data);
      if (!event) return;
      if (event.seq <= lastSeqRef.current) return;
      lastSeqRef.current = event.seq;
      setLastEvent(event);
      setEvents((current) => {
        const next = current.length >= maxEvents ? current.slice(current.length - maxEvents + 1) : [...current];
        next.push(event);
        return next;
      });
    };

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = handleMessage;

    for (const type of EVENT_TYPES) {
      source.addEventListener(type, handleMessage);
    }

    return () => {
      for (const type of EVENT_TYPES) {
        source.removeEventListener(type, handleMessage);
      }
      source.close();
    };
  }, [runId, maxEvents]);

  return { events, connected, lastEvent };
}
