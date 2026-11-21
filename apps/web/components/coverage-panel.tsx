import type {
  CheckCounts,
  CoverageCompleteness,
  CoverageReport,
  TestRun,
} from '@smartqa/shared/types';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { EmptyState, SectionLabel, StatGrid, StatTile } from '@/components/states';
import { formatDuration, formatNumber, percentOf } from '@/lib/format';
import { cn } from '@/lib/utils';

const COMPLETENESS_META: Record<CoverageCompleteness, { label: string; badge: string }> = {
  smoke: { label: 'Smoke', badge: 'border-slate-500/40 bg-slate-500/10 text-slate-300' },
  partial: { label: 'Partial', badge: 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium' },
  broad: { label: 'Broad', badge: 'border-brand/40 bg-brand/10 text-brand' },
  exhaustive: { label: 'Exhaustive', badge: 'border-violetBrand/40 bg-violetBrand/10 text-violetBrand' },
};

function ChecksRow({ checks }: { checks: CheckCounts }) {
  const items: Array<{ label: string; value: number; className: string }> = [
    { label: 'Passed', value: checks.passed, className: 'text-success' },
    { label: 'Failed', value: checks.failed, className: 'text-severity-critical' },
    { label: 'Warnings', value: checks.warning, className: 'text-severity-medium' },
    { label: 'Skipped', value: checks.skipped, className: 'text-muted-foreground' },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border border-border bg-background/40 px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{item.label}</div>
          <div className={cn('font-mono text-sm tabular-nums', item.className)}>{formatNumber(item.value)}</div>
        </div>
      ))}
    </div>
  );
}

function BudgetBars({ coverage, run }: { coverage: CoverageReport; run: TestRun }) {
  const budgets = run.config.budgets;
  const rows: Array<{ key: string; label: string; used: number; cap: number; display: string }> = [
    {
      key: 'pages',
      label: 'Pages',
      used: coverage.budget.pages,
      cap: budgets.maxPages,
      display: `${coverage.budget.pages} / ${budgets.maxPages}`,
    },
    {
      key: 'actions',
      label: 'Actions',
      used: coverage.budget.actions,
      cap: budgets.maxActions,
      display: `${coverage.budget.actions} / ${budgets.maxActions}`,
    },
    {
      key: 'depth',
      label: 'Depth',
      used: coverage.budget.depth,
      cap: budgets.maxDepth,
      display: `${coverage.budget.depth} / ${budgets.maxDepth}`,
    },
    {
      key: 'filtercombinations',
      label: 'Filter combos',
      used: coverage.budget.filterCombinations,
      cap: budgets.maxFilterCombinations,
      display: `${coverage.budget.filterCombinations} / ${budgets.maxFilterCombinations}`,
    },
    {
      key: 'durationms',
      label: 'Duration',
      used: coverage.budget.durationMs,
      cap: budgets.maxDurationMs,
      display: `${formatDuration(coverage.budget.durationMs)} / ${formatDuration(budgets.maxDurationMs)}`,
    },
  ];

  const exhausted = coverage.budget.exhausted.map((entry) => entry.toLowerCase());

  return (
    <div className="space-y-2.5">
      {rows.map((row) => {
        const pct = percentOf(row.used, row.cap);
        const hit = exhausted.some(
          (entry) => entry === row.key || entry.includes(row.label.toLowerCase()),
        );
        return (
          <div key={row.key}>
            <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {row.label}
                {hit ? <Badge variant="warning">Exhausted</Badge> : null}
              </span>
              <span className="font-mono tabular-nums text-foreground/80">{row.display}</span>
            </div>
            <Progress
              value={pct}
              className="h-1"
              indicatorClassName={pct >= 100 ? 'bg-severity-critical' : pct >= 80 ? 'bg-severity-medium' : 'bg-brand'}
            />
          </div>
        );
      })}
    </div>
  );
}

export function CoveragePanel({ run, className }: { run: TestRun; className?: string }) {
  const coverage = run.coverage;

  if (!coverage) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="No coverage report yet"
        description="Coverage is measured while the agent explores. It appears here once the run starts exploring and is finalized when the run ends."
        className={className}
      />
    );
  }

  const completeness = COMPLETENESS_META[coverage.completeness];

  return (
    <div className={cn('space-y-4', className)}>
      <section className="rounded-lg border border-border bg-card bg-panel-glow p-4 print:border-neutral-300 print:bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="section-label">Reported coverage</span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
                completeness.badge,
              )}
            >
              {completeness.label}
            </span>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">
            {coverage.checks.passed + coverage.checks.failed + coverage.checks.warning} checks evaluated
          </span>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">{coverage.completenessReason}</p>
        <Alert variant="info" className="mt-3">
          <Info />
          <AlertTitle>Coverage is bounded, not complete</AlertTitle>
          <AlertDescription>
            This run is reported as <span className="font-medium text-foreground">{completeness.label.toLowerCase()}</span>{' '}
            coverage, never “100% covered”. The limitations below list exactly what was not exercised.
          </AlertDescription>
        </Alert>
      </section>

      <SectionLabel hint="What the agent actually touched">Exploration totals</SectionLabel>
      <StatGrid>
        <StatTile
          label="Pages visited"
          value={formatNumber(coverage.pagesVisited)}
          hint={`${formatNumber(coverage.pagesDiscovered)} discovered`}
          tone="brand"
        />
        <StatTile
          label="States visited"
          value={formatNumber(coverage.statesVisited)}
          hint={`${formatNumber(coverage.statesDiscovered)} discovered`}
        />
        <StatTile
          label="Elements tested"
          value={formatNumber(coverage.elementsTested)}
          hint={`${formatNumber(coverage.elementsSkipped)} skipped`}
        />
        <StatTile
          label="Filter dimensions"
          value={formatNumber(coverage.filterDimensions)}
          hint={`${formatNumber(coverage.filterOptions)} options`}
        />
        <StatTile
          label="Filter combos"
          value={formatNumber(coverage.filterCombinationsExecuted)}
          hint={`${formatNumber(coverage.filterCombinationsPlanned)} planned`}
          tone={
            coverage.filterCombinationsExecuted < coverage.filterCombinationsPlanned
              ? 'warning'
              : 'default'
          }
        />
        <StatTile label="Elements discovered" value={formatNumber(coverage.elementsDiscovered)} />
        <StatTile
          label="Checks"
          value={formatNumber(
            coverage.checks.passed + coverage.checks.failed + coverage.checks.warning + coverage.checks.skipped,
          )}
          hint={`${formatNumber(coverage.checks.passed)} passed · ${formatNumber(coverage.checks.failed)} failed`}
        />
        <StatTile
          label="Budget exhausted"
          value={coverage.budget.exhausted.length === 0 ? 'None' : String(coverage.budget.exhausted.length)}
          hint={coverage.budget.exhausted.length > 0 ? coverage.budget.exhausted.join(', ') : 'Within all budgets'}
          tone={coverage.budget.exhausted.length > 0 ? 'warning' : 'success'}
        />
      </StatGrid>

      <section className="rounded-lg border border-severity-medium/30 bg-severity-medium/5 p-4 print:border-neutral-300 print:bg-white">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-severity-medium" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[12px] font-semibold text-severity-medium">Known limitations</h3>
            {coverage.limitations.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {coverage.limitations.map((limitation, index) => (
                  <li
                    key={`${index}-${limitation}`}
                    className="flex gap-2 text-[12px] leading-relaxed text-foreground/85"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-severity-medium" />
                    {limitation}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                The agent did not record explicit limitations. Absence of a recorded limitation is not
                evidence that the site is fully covered — treat the reported coverage level as the bound.
              </p>
            )}
          </div>
        </div>
      </section>

      {coverage.basis.length > 0 ? (
        <section>
          <SectionLabel hint="Evidence behind the completeness rating">Basis</SectionLabel>
          <ul className="mt-2 space-y-1.5">
            {coverage.basis.map((reason, index) => (
              <li key={`${index}-${reason}`} className="flex gap-2 text-[12px] text-foreground/85">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                {reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4 print:border-neutral-300 print:bg-white">
          <SectionLabel hint="Used vs configured caps">Budget usage</SectionLabel>
          <div className="mt-3">
            <BudgetBars coverage={coverage} run={run} />
          </div>
        </section>
        <section className="rounded-lg border border-border bg-card p-4 print:border-neutral-300 print:bg-white">
          <SectionLabel hint="Deterministic checks">Checks by outcome</SectionLabel>
          <div className="mt-3">
            <ChecksRow checks={coverage.checks} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {formatNumber(coverage.statesDiscovered)} states were discovered; {formatNumber(coverage.statesVisited)}{' '}
            were visited. Elements that could not be exercised safely are counted as skipped.
          </p>
        </section>
      </div>
    </div>
  );
}
