'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Finding, RunProgress, TestRun } from '@smartqa/shared/types';
import { CATEGORY_LABELS, isTerminalStatus } from '@smartqa/shared/types';
import { ArrowLeft, Info, Radio, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FindingDetail } from '@/components/finding-detail';
import { LiveBrowser } from '@/components/live-browser';
import { LogStream } from '@/components/log-stream';
import { ProgressPanel } from '@/components/progress-panel';
import { SeverityBadge } from '@/components/severity-badge';
import { Shell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { ErrorState, LoadingPanel, SectionLabel } from '@/components/states';
import { ApiClientError, api } from '@/lib/api';
import { formatDateTime, formatDuration, formatNumber, truncateMiddle } from '@/lib/format';
import { useApiData } from '@/lib/use-api-data';
import { useRunEvents } from '@/lib/use-run-events';

function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1 last:border-0">
      <dt className="shrink-0 text-[11px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-[11px] text-foreground/85">{children}</dd>
    </div>
  );
}

function FindingToast({
  finding,
  onOpen,
  onDismiss,
}: {
  finding: Finding;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const timer = setTimeout(() => dismissRef.current(), 9_000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="animate-toast-in rounded-lg border border-border bg-popover p-3" role="status">
      <div className="flex items-start justify-between gap-2">
        <SeverityBadge severity={finding.severity} />
        <button
          type="button"
          onClick={onDismiss}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss finding notification"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-1.5 block w-full text-left text-[12px] font-medium leading-snug hover:underline"
      >
        {finding.title}
      </button>
      <p className="mono mt-1 truncate text-[10px] text-muted-foreground">
        {CATEGORY_LABELS[finding.category]} · {truncateMiddle(finding.pageUrl.replace(/^https?:\/\//, ''), 40)}
      </p>
    </div>
  );
}

export default function LiveRunPage() {
  const params = useParams();
  const runId = typeof params.id === 'string' ? params.id : '';
  const [pollMs, setPollMs] = useState<number | null>(3_000);
  const [toasts, setToasts] = useState<Finding[]>([]);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [findingOpen, setFindingOpen] = useState(false);
  const [reproducing, setReproducing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const seenFindingIds = useRef<Set<string>>(new Set());
  const connectedAtRef = useRef<number>(Date.now());

  const runQuery = useApiData((signal) => api.getRun(runId, signal), [runId], {
    enabled: runId.length > 0,
    pollMs,
  });
  const run = runQuery.data?.run ?? null;
  const sessionId = runQuery.data?.liveSessionId ?? null;

  const sessionQuery = useApiData(
    (signal) => (sessionId ? api.getLiveSession(sessionId, signal) : Promise.resolve(null)),
    [sessionId, run?.status],
    {
      enabled: Boolean(sessionId),
      pollMs: run && isTerminalStatus(run.status) ? null : 10_000,
    },
  );
  const session = sessionQuery.data ?? null;
  const eventState = useRunEvents(runId || null);

  useEffect(() => {
    if (!run) return;
    setPollMs(isTerminalStatus(run.status) ? null : 4_000);
  }, [run?.status]);

  const liveProgress: RunProgress | null = useMemo(() => {
    for (let index = eventState.events.length - 1; index >= 0; index -= 1) {
      const event = eventState.events[index];
      if (event && event.type === 'progress') return event.progress;
    }
    return null;
  }, [eventState.events]);

  useEffect(() => {
    seenFindingIds.current = new Set();
    setToasts([]);
  }, [runId]);

  useEffect(() => {
    if (eventState.connected) connectedAtRef.current = Date.now();
  }, [eventState.connected]);

  useEffect(() => {
    for (const event of eventState.events) {
      if (event.type !== 'finding') continue;
      if (seenFindingIds.current.has(event.finding.id)) continue;
      seenFindingIds.current.add(event.finding.id);
      const seenAt = new Date(event.at).getTime();
      if (!Number.isFinite(seenAt) || seenAt < connectedAtRef.current - 2_000) continue;
      setToasts((current) => [...current.slice(-2), event.finding]);
    }
  }, [eventState.events]);

  const dismissToast = (findingId: string) => {
    setToasts((current) => current.filter((finding) => finding.id !== findingId));
  };

  const effectiveRun: TestRun | null = run && liveProgress ? { ...run, progress: liveProgress } : run;

  const reproduceFinding = async (finding: Finding) => {
    if (!run) return;
    setReproducing(true);
    setActionError(null);
    try {
      await api.runAction(run.id, { action: 'reproduce', findingId: finding.id });
      runQuery.reload();
    } catch (cause) {
      setActionError(
        cause instanceof ApiClientError
          ? cause.message
          : 'The reproduction request could not be queued.',
      );
    } finally {
      setReproducing(false);
    }
  };

  return (
    <Shell
      title={run ? `Live · ${truncateMiddle(run.url, 48)}` : 'Live console'}
      subtitle={
        run ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={run.status} />
            <span className="mono">{run.id}</span>
            <span aria-hidden="true">·</span>
            <span>{run.mode} session</span>
            {session ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="mono">{session.viewport.width}×{session.viewport.height}</span>
              </>
            ) : null}
          </div>
        ) : runId ? (
          <span className="mono">{runId}</span>
        ) : undefined
      }
      actions={
        <>
          {run ? <StatusBadge status={run.status} className="hidden sm:inline-flex" /> : null}
          <Button asChild variant="outline" size="sm">
            <Link href={`/runs/${runId}`}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Run detail
            </Link>
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {runQuery.error && !run ? (
          <ErrorState
            title="Could not load this run"
            message={runQuery.error}
            onRetry={runQuery.reload}
            retrying={runQuery.fetching}
          />
        ) : runQuery.loading && !run ? (
          <LoadingPanel label="Opening the live console" rows={5} />
        ) : !run ? (
          <ErrorState
            title="Run not found"
            message="This run may have been removed, or the identifier is invalid."
            onRetry={runQuery.reload}
          />
        ) : (
          <>
            {actionError ? (
              <Alert variant="destructive">
                <Info />
                <AlertTitle>Could not queue the replay</AlertTitle>
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            ) : null}

            {run.status === 'awaiting_login' ? (
              <Alert variant="warning">
                <Info />
                <AlertTitle>Awaiting manual sign-in</AlertTitle>
                <AlertDescription>
                  Sign in to the target website inside the live browser below. When you are signed in, click{' '}
                  <span className="font-medium">“Sign-in complete — start testing”</span> to start automated
                  testing.
                </AlertDescription>
              </Alert>
            ) : null}

            {sessionQuery.error ? (
              <Alert variant="destructive">
                <Info />
                <AlertTitle>Live session unavailable</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  {sessionQuery.error}
                  <Button variant="outline" size="sm" onClick={sessionQuery.reload}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-w-0 space-y-3">
                {sessionId ? (
                  <LiveBrowser
                    run={effectiveRun ?? run}
                    session={session}
                    onRunChanged={() => {
                      runQuery.reload();
                      sessionQuery.reload();
                    }}
                  />
                ) : (
                  <Alert variant="info">
                    <Radio />
                    <AlertTitle>No live browser session</AlertTitle>
                    <AlertDescription className="flex flex-col gap-2">
                      <span>
                        {run.mode === 'background'
                          ? 'This run executes in the background, so there is no screencast. Open the run detail to follow progress, findings and logs.'
                          : 'The live session is not available yet. It is created while the worker prepares the browser.'}
                      </span>
                      <Button asChild variant="outline" size="sm" className="w-fit">
                        <Link href={`/runs/${run.id}`}>Open run detail</Link>
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <section className="rounded-lg border border-border bg-card p-3">
                    <SectionLabel>Session</SectionLabel>
                    <dl className="mt-1.5">
                      <FactRow label="Session id">{session?.id ?? '—'}</FactRow>
                      <FactRow label="Status">{session?.status ?? 'connecting'}</FactRow>
                      <FactRow label="Viewers">{session?.viewerCount ?? 0}</FactRow>
                      <FactRow label="Interactive">{session ? (session.interactive ? 'yes' : 'no') : '—'}</FactRow>
                      <FactRow label="Started">{formatDateTime(session?.startedAt)}</FactRow>
                    </dl>
                  </section>
                  <section className="rounded-lg border border-border bg-card p-3">
                    <SectionLabel>Run</SectionLabel>
                    <dl className="mt-1.5">
                      <FactRow label="Mode">{run.mode}</FactRow>
                      <FactRow label="Seed">{run.config.seed}</FactRow>
                      <FactRow label="Pages visited">{formatNumber(run.progress.pagesVisited)}</FactRow>
                      <FactRow label="Actions">{formatNumber(run.progress.actionsExecuted)}</FactRow>
                      <FactRow label="Duration">{formatDuration(run.durationMs)}</FactRow>
                      <FactRow label="Started">{formatDateTime(run.startedAt)}</FactRow>
                    </dl>
                  </section>
                </div>
              </div>

              <aside className="min-w-0 space-y-3">
                {effectiveRun ? <ProgressPanel run={effectiveRun} /> : null}

                <section className="rounded-lg border border-border bg-card p-3">
                  <SectionLabel hint="streamed">Now testing</SectionLabel>
                  <p className="mono mt-1.5 break-all text-[11px] text-foreground/85">
                    {effectiveRun?.progress.currentUrl ?? 'Waiting for the first page…'}
                  </p>
                  <p className="mono mt-1 break-words text-[11px] text-brand">
                    {effectiveRun?.progress.currentAction ?? 'No action in flight'}
                  </p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {effectiveRun?.progress.message ?? 'The agent has not reported a status yet.'}
                  </p>
                </section>

                <LogStream
                  events={eventState.events}
                  connected={eventState.connected}
                  heightClassName="h-[420px]"
                  emptyLabel="Log output appears as soon as the worker starts reporting."
                />
              </aside>
            </div>
          </>
        )}
      </div>

      <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex w-[min(92vw,340px)] flex-col gap-2">
        {toasts.map((finding) => (
          <div key={finding.id} className="pointer-events-auto">
            <FindingToast
              finding={finding}
              onOpen={() => {
                setSelectedFinding(finding);
                setFindingOpen(true);
              }}
              onDismiss={() => dismissToast(finding.id)}
            />
          </div>
        ))}
      </div>

      <FindingDetail
        finding={selectedFinding}
        runId={runId}
        open={findingOpen}
        onOpenChange={setFindingOpen}
        onReproduce={(finding) => void reproduceFinding(finding)}
        reproducing={reproducing}
      />
    </Shell>
  );
}
