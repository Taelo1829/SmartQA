import type { TestRun } from '@smartqa/shared/types';
import { ArrowUpRight, CircleDot, Gauge } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/status-badge';
import { formatDuration, formatRelativeTime, percentOf } from '@/lib/format';
import { cn } from '@/lib/utils';

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[15px] leading-tight tabular-nums text-foreground">{value}</span>
      <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
    </div>
  );
}

export function ProgressPanel({ run, className }: { run: TestRun; className?: string }) {
  const { progress } = run;
  const percent = Math.min(100, Math.max(0, Math.round(progress.percent)));
  const active = run.status === 'running' || run.status === 'preparing' || run.status === 'finalizing';

  return (
    <section
      className={cn(
        'rounded-lg border border-border bg-card bg-panel-glow p-4 print:border-neutral-300 print:bg-white',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={run.status} />
          <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {progress.phaseLabel}
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[12px] tabular-nums text-muted-foreground">
          <Gauge className="h-3.5 w-3.5" />
          {percent}%
        </div>
      </div>

      <div className="mt-3">
        <Progress
          value={percent}
          indicatorClassName={cn(
            active ? 'bg-brand' : 'bg-brand/60',
            run.status === 'failed' && 'bg-severity-critical',
            run.status === 'completed' && 'bg-success',
          )}
          aria-label={`Run progress: ${percent}%`}
        />
      </div>

      <p className="mt-2 line-clamp-2 text-[12px] text-muted-foreground">
        {progress.message || 'No status message yet.'}
      </p>

      <div className="mt-3 grid grid-cols-4 gap-2 border-t border-border pt-3">
        <Counter label="Pages" value={progress.pagesVisited} />
        <Counter label="Actions" value={progress.actionsExecuted} />
        <Counter label="Checks" value={progress.checksRun} />
        <Counter label="Findings" value={progress.findings} />
      </div>

      {progress.currentUrl || progress.currentAction ? (
        <div className="mt-3 space-y-1.5 rounded-md border border-border bg-background/50 p-2">
          {progress.currentUrl ? (
            <div className="flex items-start gap-1.5">
              <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-brand" />
              <span className="mono break-all text-muted-foreground">{progress.currentUrl}</span>
            </div>
          ) : null}
          {progress.currentAction ? (
            <div className="flex items-start gap-1.5">
              <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-violetBrand" />
              <span className="mono break-words text-foreground/90">{progress.currentAction}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          Discovered <span className="font-mono text-foreground/80">{progress.pagesDiscovered}</span> pages
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Updated <span className="font-mono text-foreground/80">{formatRelativeTime(progress.updatedAt)}</span>
        </span>
        {run.durationMs != null ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              Ran <span className="font-mono text-foreground/80">{formatDuration(run.durationMs)}</span>
            </span>
          </>
        ) : null}
        {run.config.budgets.maxDurationMs > 0 && active ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              Budget{' '}
              <span className="font-mono text-foreground/80">
                {percentOf(progress.actionsExecuted, run.config.budgets.maxActions)}%
              </span>{' '}
              actions
            </span>
          </>
        ) : null}
      </div>
    </section>
  );
}
