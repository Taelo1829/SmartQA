'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunEvent } from '@smartqa/shared/types';
import { ArrowDownToLine, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/states';
import { LOG_LEVEL_CLASS, LOG_LEVEL_LABEL, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

type LogEvent = Extract<RunEvent, { type: 'log' }>;
type LogFilter = 'all' | 'info' | 'warn' | 'error';

const FILTERS: Array<{ value: LogFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

function isLogEvent(event: RunEvent): event is LogEvent {
  return event.type === 'log';
}

export function LogStream({
  events,
  connected,
  className,
  heightClassName = 'h-[340px]',
  showHeader = true,
  emptyLabel = 'Waiting for the agent to emit log output…',
}: {
  events: RunEvent[];
  connected: boolean;
  className?: string;
  heightClassName?: string;
  showHeader?: boolean;
  emptyLabel?: string;
}) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [follow, setFollow] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const entries = useMemo(() => events.filter(isLogEvent), [events]);
  const visible = useMemo(
    () => (filter === 'all' ? entries : entries.filter((entry) => entry.level === filter)),
    [entries, filter],
  );

  useEffect(() => {
    if (!follow) return;
    const element = containerRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [visible.length, follow]);

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
      {showHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full',
                connected ? 'animate-pulse bg-success' : 'bg-severity-medium',
              )}
              aria-hidden="true"
            />
            <span className="section-label">{connected ? 'Live log' : 'Log (reconnecting)'}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{visible.length}</span>
          </div>
          <div className="flex items-center gap-1">
            {FILTERS.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={filter === option.value ? 'subtle' : 'ghost'}
                className={cn('h-6 px-2 text-[10px]', filter === option.value && 'border-brand/40 text-brand')}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
            <label className="ml-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Switch
                checked={follow}
                onCheckedChange={setFollow}
                aria-label="Follow latest log output"
              />
              Follow
            </label>
          </div>
        </div>
      ) : null}

      <div ref={containerRef} role="log" aria-live="off" className={cn('overflow-y-auto scrollbar-thin', heightClassName)}>
        {visible.length === 0 ? (
          <div className="p-3">
            <EmptyState
              icon={Terminal}
              title={connected ? 'No log output yet' : 'Log stream disconnected'}
              description={connected ? emptyLabel : 'The event stream is reconnecting automatically.'}
              className="border-0 bg-transparent py-6"
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {visible.map((entry) => (
              <li key={`${entry.seq}-${entry.at}`} className="flex gap-2 px-3 py-1.5 hover:bg-accent/20">
                <span className="shrink-0 font-mono text-[10px] leading-5 text-muted-foreground">
                  {formatTime(entry.at)}
                </span>
                <span
                  className={cn(
                    'shrink-0 font-mono text-[10px] font-semibold leading-5',
                    LOG_LEVEL_CLASS[entry.level],
                  )}
                >
                  {LOG_LEVEL_LABEL[entry.level]}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground/90">
                  {entry.message}
                </span>
                {entry.actionId ? (
                  <span className="mono hidden shrink-0 text-[10px] leading-5 text-muted-foreground sm:inline">
                    {entry.actionId}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {!follow ? (
        <div className="flex justify-end border-t border-border px-2 py-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-[10px]"
            onClick={() => setFollow(true)}
          >
            <ArrowDownToLine className="h-3 w-3" />
            Jump to latest
          </Button>
        </div>
      ) : null}
    </div>
  );
}
