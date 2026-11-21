import Link from 'next/link';
import type { TestRun } from '@smartqa/shared/types';
import { ArrowRight, Monitor, Radio } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { SeverityBadge } from '@/components/severity-badge';
import { StatusBadge } from '@/components/status-badge';
import { formatDuration, formatRelativeTime, percentOf } from '@/lib/format';
import { cn } from '@/lib/utils';

export function RunCard({ run, className }: { run: TestRun; className?: string }) {
  const active =
    run.status === 'running' || run.status === 'preparing' || run.status === 'finalizing';
  const severities = run.summary?.severities ?? null;
  const percent = Math.min(100, Math.max(0, Math.round(run.progress.percent)));
  const findingsTotal = run.summary?.findingsTotal ?? run.progress.findings;

  return (
    <Link
      href={`/runs/${run.id}`}
      className={cn('group block rounded-lg focus-visible:outline-none', className)}
      aria-label={`Open run for ${run.url}`}
    >
      <Card className="h-full border-border/90 p-4 transition-colors group-hover:border-brand/40 group-focus-visible:border-brand/60">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={run.status} />
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {run.mode === 'live' ? <Radio className="h-3 w-3 text-brand" /> : <Monitor className="h-3 w-3" />}
              {run.mode === 'live' ? 'Live' : 'Background'}
            </span>
          </div>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {formatRelativeTime(run.createdAt)}
          </span>
        </div>

        <p className="mt-2.5 truncate font-mono text-[12px] text-foreground/90" title={run.url}>
          {run.url}
        </p>

        {active ? (
          <div className="mt-3 space-y-1.5">
            <Progress
              value={percent}
              className="h-1"
              indicatorClassName={run.status === 'finalizing' ? 'bg-violetBrand' : 'bg-brand'}
            />
            <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
              <span className="truncate">{run.progress.phaseLabel}</span>
              <span className="shrink-0 tabular-nums">{percent}%</span>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-1">
            {severities ? (
              (['critical', 'high', 'medium', 'low', 'info'] as const).map((severity) => (
                <SeverityBadge
                  key={severity}
                  severity={severity}
                  count={severities[severity]}
                  className={cn(severities[severity] === 0 && 'opacity-40')}
                />
              ))
            ) : (
              <span className="text-[11px] text-muted-foreground">No summary yet.</span>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              <span className="font-mono tabular-nums text-foreground/80">{findingsTotal}</span> findings
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <span className="font-mono tabular-nums text-foreground/80">{run.progress.checksRun}</span> checks
            </span>
            {run.durationMs != null ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-foreground/80">
                  {formatDuration(run.durationMs)}
                </span>
              </>
            ) : null}
            {run.summary && run.summary.checks.failed > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-severity-critical">{run.summary.checks.failed} failed checks</span>
              </>
            ) : null}
          </div>
          <span className="inline-flex items-center gap-1 text-brand opacity-0 transition-opacity group-hover:opacity-100">
            Open <ArrowRight className="h-3 w-3" />
          </span>
        </div>

        {active ? (
          <div className="mt-2">
            <Progress
              value={percentOf(run.progress.actionsExecuted, run.config.budgets.maxActions)}
              className="h-0.5"
              indicatorClassName="bg-muted-foreground/60"
              aria-label="Action budget used"
            />
          </div>
        ) : null}
      </Card>
    </Link>
  );
}
