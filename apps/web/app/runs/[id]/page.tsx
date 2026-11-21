'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  CheckResult,
  Confidence,
  FilterCombination,
  FilterDimension,
  Finding,
  FindingCategory,
  FindingStatus,
  RunReport,
  Severity,
  SeverityCounts,
} from '@smartqa/shared/types';
import {
  CATEGORY_LABELS,
  CONFIDENCES,
  FINDING_STATUSES,
  SEVERITIES,
  isTerminalStatus,
} from '@smartqa/shared/types';
import type { RunActionName } from '@smartqa/shared/schemas';
import {
  Activity,
  ArrowUpRight,
  Download,
  FileJson,
  FileText,
  Filter,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Printer,
  Radio,
  RefreshCw,
  RotateCcw,
  Square,
  TrendingUp,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CoveragePanel } from '@/components/coverage-panel';
import { ConfidenceBadge } from '@/components/confidence-badge';
import { EvidenceGrid } from '@/components/evidence-grid';
import { FindingDetail } from '@/components/finding-detail';
import { FindingsTable } from '@/components/findings-table';
import { LogStream } from '@/components/log-stream';
import { MetricSnapshotTable } from '@/components/metric-snapshot-table';
import { ProgressPanel } from '@/components/progress-panel';
import { SeverityBadge } from '@/components/severity-badge';
import { Shell } from '@/components/shell';
import { StateGraphList } from '@/components/state-graph-list';
import { StatusBadge } from '@/components/status-badge';
import {
  EmptyState,
  ErrorState,
  LoadingPanel,
  SectionLabel,
  StatGrid,
  StatTile,
} from '@/components/states';
import { ApiClientError, api, exportUrl } from '@/lib/api';
import {
  FINDING_STATUS_LABEL,
  SEVERITY_LABEL,
  formatDateTime,
  formatDuration,
  formatNumber,
  percentOf,
  severityRank,
  truncateMiddle,
} from '@/lib/format';
import { useApiData } from '@/lib/use-api-data';
import { useRunEvents } from '@/lib/use-run-events';
import { cn } from '@/lib/utils';

function countSeverities(findings: Finding[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <dt className="shrink-0 text-[11px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-[11px] text-foreground/85">{children}</dd>
    </div>
  );
}

function SeverityBreakdown({
  counts,
  onOpenFindings,
}: {
  counts: SeverityCounts;
  onOpenFindings: () => void;
}) {
  const total = SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0);
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="panel-header">
        <SectionLabel hint={`${formatNumber(total)} findings`}>Severity breakdown</SectionLabel>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={onOpenFindings}>
          View findings
          <ArrowUpRight className="h-3 w-3" />
        </Button>
      </div>
      <div className="space-y-2 p-3">
        {SEVERITIES.map((severity) => {
          const count = counts[severity];
          const pct = total === 0 ? 0 : percentOf(count, total);
          return (
            <div key={severity} className="flex items-center gap-2">
              <span className="w-20 shrink-0">
                <SeverityBadge severity={severity} />
              </span>
              <Progress
                value={Math.max(pct, count > 0 ? 2 : 0)}
                className="h-1.5 flex-1"
                indicatorClassName={cn(
                  severity === 'critical' && 'bg-severity-critical',
                  severity === 'high' && 'bg-severity-high',
                  severity === 'medium' && 'bg-severity-medium',
                  severity === 'low' && 'bg-severity-low',
                  severity === 'info' && 'bg-severity-info',
                )}
              />
              <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-foreground/80">
                {count}
              </span>
              <span className="hidden w-9 shrink-0 text-right font-mono text-[10px] text-muted-foreground sm:inline">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TopFindings({ findings, onSelect }: { findings: Finding[]; onSelect: (finding: Finding) => void }) {
  const top = [...findings]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, 5);
  if (top.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="panel-header">
        <SectionLabel hint="Sorted by severity">Top findings</SectionLabel>
      </div>
      <div>
        {top.map((finding) => (
          <button
            key={finding.id}
            type="button"
            onClick={() => onSelect(finding)}
            className="flex w-full items-start gap-2 border-b border-border/60 px-3 py-2 text-left transition-colors last:border-0 hover:bg-accent/30"
          >
            <SeverityBadge severity={finding.severity} />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-1 block text-[12px] font-medium text-foreground">{finding.title}</span>
              <span className="mono mt-0.5 block truncate text-[10px] text-muted-foreground">
                {CATEGORY_LABELS[finding.category]} · {truncateMiddle(finding.pageUrl.replace(/^https?:\/\//, ''), 48)}
              </span>
            </span>
            <ConfidenceBadge confidence={finding.confidence} />
          </button>
        ))}
      </div>
    </section>
  );
}

function CheckStatusBadge({ status }: { status: CheckResult['status'] }) {
  const styles: Record<CheckResult['status'], string> = {
    passed: 'border-success/40 bg-success/10 text-success',
    failed: 'border-severity-critical/40 bg-severity-critical/10 text-severity-critical',
    warning: 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium',
    skipped: 'border-border bg-muted text-muted-foreground',
  };
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', styles[status])}>
      {status}
    </span>
  );
}

function FilterValidationSection({
  dimensions,
  combinations,
}: {
  dimensions: FilterDimension[];
  combinations: FilterCombination[];
}) {
  if (dimensions.length === 0 && combinations.length === 0) {
    return (
      <EmptyState
        icon={Filter}
        title="No filter dimensions detected"
        description="If the target exposes filters, the agent plans combinations, resets the baseline and checks totals for additivity."
      />
    );
  }

  const captured = combinations.filter((combination) => combination.state === 'captured').length;

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="panel-header">
        <SectionLabel hint={`${combinations.length} planned · ${captured} captured`}>
          Filter validation
        </SectionLabel>
      </div>
      {dimensions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
          {dimensions.map((dimension) => (
            <Badge key={dimension.id} variant="outline" className="normal-case">
              {dimension.label}
              <span className="text-muted-foreground">
                {' '}
                · {dimension.kind} · {dimension.options.length} options
              </span>
            </Badge>
          ))}
        </div>
      ) : null}
      {combinations.length === 0 ? (
        <p className="px-3 py-3 text-[11px] text-muted-foreground">
          Dimensions were detected but no combinations have been planned yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Kind</TableHead>
              <TableHead>Selection</TableHead>
              <TableHead className="hidden md:table-cell">State</TableHead>
              <TableHead className="hidden lg:table-cell">Order</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Executed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {combinations.slice(0, 60).map((combination) => (
              <TableRow key={combination.id}>
                <TableCell>
                  <span className="mono text-[10px] text-muted-foreground">{combination.kind}</span>
                </TableCell>
                <TableCell className="max-w-[280px]">
                  <span className="block truncate text-[11px]">
                    {combination.selections.length === 0
                      ? '(no selection)'
                      : combination.selections
                          .map((selection) => `${selection.dimensionLabel}: ${selection.optionLabels.join('/')}`)
                          .join('  ·  ')}
                  </span>
                  <span className="mono block truncate text-[10px] text-muted-foreground">
                    {combination.stateKey}
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <span className="mono text-[10px] text-muted-foreground">{combination.state}</span>
                </TableCell>
                <TableCell className="mono hidden truncate text-[10px] text-muted-foreground lg:table-cell">
                  {combination.order.join(' → ') || '—'}
                </TableCell>
                <TableCell className="mono hidden text-right text-[10px] text-muted-foreground sm:table-cell">
                  {combination.executedAt ? formatDateTime(combination.executedAt) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {combinations.length > 60 ? (
        <p className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
          Showing the first 60 of {combinations.length} combinations. The JSON export contains all of them.
        </p>
      ) : null}
    </section>
  );
}

function ReportPreview({ report, runId }: { report: RunReport; runId: string }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div>
          <SectionLabel hint="JSON + PDF + print">Export bundle</SectionLabel>
          <p className="mono mt-1 text-[11px] text-muted-foreground">
            {report.meta.generator} · format v{report.meta.formatVersion} · seed {report.meta.seed}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="brand" size="sm">
            <Link href={`/runs/${runId}/report`}>
              <FileText className="h-3.5 w-3.5" />
              Open full report
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={exportUrl(runId, 'json')} download>
              <FileJson className="h-3.5 w-3.5" />
              JSON
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={exportUrl(runId, 'pdf')} download>
              <Download className="h-3.5 w-3.5" />
              PDF
            </a>
          </Button>
        </div>
      </div>

      <StatGrid>
        <StatTile label="Findings" value={formatNumber(report.summary.findingsTotal)} hint={`${report.summary.confirmed} confirmed`} tone="danger" />
        <StatTile label="Checks passed" value={formatNumber(report.summary.checks.passed)} hint={`${report.summary.checks.failed} failed`} tone="success" />
        <StatTile label="Pages visited" value={formatNumber(report.coverage.pagesVisited)} hint={`${report.coverage.pagesDiscovered} discovered`} tone="brand" />
        <StatTile label="Coverage" value={report.coverage.completeness} hint="Bounded, see limitations" />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-severity-medium/30 bg-severity-medium/5 p-4">
          <h3 className="text-[12px] font-semibold text-severity-medium">Limitations</h3>
          {report.limitations.length === 0 ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              No limitations were recorded. This is not a claim of complete coverage.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {report.limitations.map((limitation, index) => (
                <li key={`${index}-${limitation}`} className="text-[11px] leading-relaxed text-foreground/85">
                  · {limitation}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <SectionLabel hint={`${report.checks.length} checks`}>Checks</SectionLabel>
          <div className="mt-2 space-y-1.5">
            {report.checks.slice(0, 8).map((check) => (
              <div key={check.id} className="flex items-start gap-2">
                <CheckStatusBadge status={check.status} />
                <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/85" title={check.detail}>
                  {check.title}
                </span>
              </div>
            ))}
            {report.checks.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No checks recorded.</p>
            ) : null}
            {report.checks.length > 8 ? (
              <p className="text-[10px] text-muted-foreground">+{report.checks.length - 8} more in the full report</p>
            ) : null}
          </div>
        </section>
      </div>

      {report.filterTests.length > 0 ? (
        <section className="rounded-lg border border-border bg-card">
          <div className="panel-header">
            <SectionLabel hint="Filter consistency">Filter tests</SectionLabel>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Dimension</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="hidden sm:table-cell">Options</TableHead>
                <TableHead>Additivity</TableHead>
                <TableHead className="hidden md:table-cell text-right">Combos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.filterTests.map((test, index) => (
                <TableRow key={`${test.dimension}-${index}`}>
                  <TableCell className="max-w-[220px] truncate">{test.dimension}</TableCell>
                  <TableCell className="mono text-[10px] text-muted-foreground">{test.kind}</TableCell>
                  <TableCell className="mono hidden sm:table-cell">{test.options.length}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex rounded-full border px-2 py-0.5 text-[10px]',
                        test.additivityVerdict === 'consistent'
                          ? 'border-success/40 bg-success/10 text-success'
                          : test.additivityVerdict === 'inconsistent'
                            ? 'border-severity-critical/40 bg-severity-critical/10 text-severity-critical'
                            : test.additivityVerdict === 'suspected'
                              ? 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium'
                              : 'border-border bg-muted text-muted-foreground',
                      )}
                    >
                      {test.additivityVerdict.replace(/_/g, ' ')}
                    </span>
                  </TableCell>
                  <TableCell className="mono hidden text-right md:table-cell">{test.combinationsExecuted}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-4">
        <SectionLabel hint="Model assistance">AI usage</SectionLabel>
        <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
          <p>
            enabled <span className="mono text-foreground/80">{report.aiUsage.enabled ? 'yes' : 'no'}</span>
          </p>
          <p>
            provider <span className="mono text-foreground/80">{report.aiUsage.provider || '—'}</span>
          </p>
          <p>
            model <span className="mono text-foreground/80">{report.aiUsage.model || '—'}</span>
          </p>
          <p>
            calls <span className="mono text-foreground/80">{report.aiUsage.calls}</span> · failures{' '}
            <span className="mono text-foreground/80">{report.aiUsage.failures}</span>
          </p>
        </div>
      </section>
    </div>
  );
}

export default function RunDetailPage() {
  const params = useParams();
  const runId = typeof params.id === 'string' ? params.id : '';
  const [tab, setTab] = useState('overview');
  const [pollMs, setPollMs] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<RunActionName | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reproducingId, setReproducingId] = useState<string | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [findingOpen, setFindingOpen] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [confidenceFilter, setConfidenceFilter] = useState<Confidence | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<FindingStatus | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<FindingCategory | 'all'>('all');

  const runQuery = useApiData((signal) => api.getRun(runId, signal), [runId], {
    enabled: runId.length > 0,
    pollMs,
  });
  const reportQuery = useApiData((signal) => api.getReport(runId, signal), [runId], {
    enabled: runId.length > 0 && tab === 'report',
  });

  const detail = runQuery.data;
  const run = detail?.run ?? null;
  const events = useRunEvents(runId || null);

  useEffect(() => {
    if (!run) return;
    setPollMs(isTerminalStatus(run.status) ? null : 4_000);
  }, [run?.status]);

  const findings = detail?.findings;
  const categoryOptions = useMemo(() => {
    const seen = new Set<FindingCategory>();
    for (const finding of findings ?? []) seen.add(finding.category);
    return [...seen].sort();
  }, [findings]);

  const filteredFindings = useMemo(() => {
    return (findings ?? []).filter((finding) => {
      if (severityFilter !== 'all' && finding.severity !== severityFilter) return false;
      if (confidenceFilter !== 'all' && finding.confidence !== confidenceFilter) return false;
      if (statusFilter !== 'all' && finding.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && finding.category !== categoryFilter) return false;
      return true;
    });
  }, [findings, severityFilter, confidenceFilter, statusFilter, categoryFilter]);

  const hasFindingFilters =
    severityFilter !== 'all' || confidenceFilter !== 'all' || statusFilter !== 'all' || categoryFilter !== 'all';

  const resetFindingFilters = () => {
    setSeverityFilter('all');
    setConfidenceFilter('all');
    setStatusFilter('all');
    setCategoryFilter('all');
  };

  const openFinding = (finding: Finding) => {
    setSelectedFinding(finding);
    setFindingOpen(true);
  };

  const performAction = async (action: RunActionName, findingId?: string) => {
    if (!run) return;
    setBusyAction(action);
    setActionError(null);
    if (action === 'reproduce' && findingId) setReproducingId(findingId);
    try {
      await api.runAction(run.id, { action, ...(findingId ? { findingId } : {}) });
      runQuery.reload();
    } catch (cause) {
      setActionError(
        cause instanceof ApiClientError
          ? cause.message
          : 'The run action could not be applied. Check the API and try again.',
      );
    } finally {
      setBusyAction(null);
      setReproducingId(null);
    }
  };

  const headerActions = run ? (
    <>
      {detail?.liveSessionId ? (
        <Button asChild variant="brand" size="sm">
          <Link href={`/runs/${run.id}/live`}>
            <Radio className="h-3.5 w-3.5" />
            Live console
          </Link>
        </Button>
      ) : null}
      {run.status === 'queued' ? (
        <Button size="sm" variant="outline" onClick={() => void performAction('start')} disabled={busyAction != null}>
          {busyAction === 'start' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Start
        </Button>
      ) : null}
      {run.status === 'running' ? (
        <Button size="sm" variant="outline" onClick={() => void performAction('pause')} disabled={busyAction != null}>
          {busyAction === 'pause' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
          Pause
        </Button>
      ) : null}
      {run.status === 'paused' ? (
        <Button size="sm" variant="outline" onClick={() => void performAction('resume')} disabled={busyAction != null}>
          {busyAction === 'resume' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Resume
        </Button>
      ) : null}
      {!isTerminalStatus(run.status) ? (
        <Button size="sm" variant="outline" onClick={() => void performAction('stop')} disabled={busyAction != null}>
          {busyAction === 'stop' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          Stop
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <MoreHorizontal className="h-3.5 w-3.5" />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Report bundle</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link href={`/runs/${run.id}/report`}>
              <FileText className="h-3.5 w-3.5" />
              Open report
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={exportUrl(run.id, 'json')} download>
              <FileJson className="h-3.5 w-3.5" />
              Download JSON
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={exportUrl(run.id, 'pdf')} download>
              <Download className="h-3.5 w-3.5" />
              Download PDF
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/runs/${run.id}/report`}>
              <Printer className="h-3.5 w-3.5" />
              Print view
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" onClick={runQuery.reload} disabled={runQuery.fetching}>
        <RefreshCw className={cn('h-3.5 w-3.5', runQuery.fetching && 'animate-spin')} />
        Refresh
      </Button>
    </>
  ) : (
    <Button variant="outline" size="sm" onClick={runQuery.reload} disabled={runQuery.fetching}>
      <RefreshCw className={cn('h-3.5 w-3.5', runQuery.fetching && 'animate-spin')} />
      Retry
    </Button>
  );

  const subtitle = run ? (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={run.status} />
      <span className="mono">{run.id}</span>
      <span aria-hidden="true">·</span>
      <span className="capitalize">{run.mode}</span>
      <span aria-hidden="true">·</span>
      <span>{formatDuration(run.durationMs)}</span>
    </div>
  ) : runId ? (
    <span className="mono">{runId}</span>
  ) : undefined;

  return (
    <Shell
      title={run ? truncateMiddle(run.url, 64) : 'Run detail'}
      subtitle={subtitle}
      actions={headerActions}
    >
      <div className="space-y-4">
        {actionError ? (
          <Alert variant="destructive">
            <Activity />
            <AlertTitle>Run action failed</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}

        {runQuery.error && !run ? (
          <ErrorState
            title="Could not load this run"
            message={runQuery.error}
            onRetry={runQuery.reload}
            retrying={runQuery.fetching}
          />
        ) : runQuery.loading && !run ? (
          <div className="space-y-3">
            <LoadingPanel label="Loading run" rows={4} />
            <LoadingPanel label="Loading evidence" rows={2} />
          </div>
        ) : !run || !detail ? (
          <ErrorState
            title="Run not found"
            message="This run may have been removed, or the identifier is invalid."
            onRetry={runQuery.reload}
          />
        ) : (
          <>
            {run.status === 'awaiting_login' ? (
              <Alert variant="warning">
                <Activity />
                <AlertTitle>Waiting for manual sign-in</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    The agent paused at the authentication wall. Open the live console, sign in, then tell
                    it to continue.
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="brand">
                      <Link href={`/runs/${run.id}/live`}>
                        <Radio className="h-3.5 w-3.5" />
                        Open live console
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void performAction('login_complete')}
                      disabled={busyAction != null}
                    >
                      {busyAction === 'login_complete' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      Signed in — continue
                    </Button>
                  </span>
                </AlertDescription>
              </Alert>
            ) : null}

            {run.error ? (
              <Alert variant="destructive">
                <Activity />
                <AlertTitle>Run error</AlertTitle>
                <AlertDescription>{run.error}</AlertDescription>
              </Alert>
            ) : null}

            {runQuery.error ? (
              <ErrorState
                title="Refresh failed"
                message={`${runQuery.error} Showing the last successful snapshot.`}
                onRetry={runQuery.reload}
                retrying={runQuery.fetching}
              />
            ) : null}

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="findings">
                  Findings
                  <span className="font-mono text-[10px] text-muted-foreground">{detail.findings.length}</span>
                </TabsTrigger>
                <TabsTrigger value="coverage">Coverage</TabsTrigger>
                <TabsTrigger value="pages">Pages</TabsTrigger>
                <TabsTrigger value="logs">Logs</TabsTrigger>
                <TabsTrigger value="report">Report</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <ProgressPanel run={run} />

                <StatGrid>
                  <StatTile
                    label="Findings"
                    value={formatNumber(run.summary?.findingsTotal ?? run.progress.findings)}
                    hint={`${formatNumber(run.summary?.confirmed ?? 0)} confirmed · ${formatNumber(run.summary?.suspected ?? 0)} suspected`}
                    tone="danger"
                  />
                  <StatTile
                    label="Checks"
                    value={formatNumber(run.summary?.checks.passed ?? 0)}
                    hint={`${formatNumber(run.summary?.checks.failed ?? 0)} failed · ${formatNumber(run.summary?.checks.warning ?? 0)} warnings`}
                    tone="success"
                  />
                  <StatTile
                    label="Pages"
                    value={formatNumber(run.progress.pagesVisited)}
                    hint={`${formatNumber(run.progress.pagesDiscovered)} discovered`}
                    tone="brand"
                  />
                  <StatTile
                    label="Actions"
                    value={formatNumber(run.progress.actionsExecuted)}
                    hint={`budget ${formatNumber(run.config.budgets.maxActions)}`}
                  />
                  <StatTile
                    label="Duration"
                    value={formatDuration(run.durationMs)}
                    hint={run.startedAt ? `started ${formatDateTime(run.startedAt)}` : 'not started yet'}
                  />
                  <StatTile
                    label="Filter combos"
                    value={formatNumber(run.summary?.filterCombinationsExecuted ?? 0)}
                    hint={`${formatNumber(run.summary?.filterCombinationsPlanned ?? 0)} planned`}
                    tone="warning"
                  />
                  <StatTile label="Seed" value={run.config.seed} hint="replayable exploration" />
                  <StatTile
                    label="Coverage"
                    value={run.coverage?.completeness ?? 'pending'}
                    hint={run.coverage ? 'bounded by limitations' : 'appears when finalized'}
                    tone="brand"
                  />
                </StatGrid>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                  <SeverityBreakdown counts={countSeverities(detail.findings)} onOpenFindings={() => setTab('findings')} />
                  <section className="rounded-lg border border-border bg-card p-3">
                    <SectionLabel>Run facts</SectionLabel>
                    <dl className="mt-2">
                      <Fact label="Run id">{run.id}</Fact>
                      <Fact label="Mode">{run.mode}</Fact>
                      <Fact label="Status">{run.status}</Fact>
                      <Fact label="Auth state">{run.authState}</Fact>
                      <Fact label="Focus">{run.config.focus}</Fact>
                      <Fact label="Viewports">{run.config.viewports.join(', ')}</Fact>
                      <Fact label="Seed">{run.config.seed}</Fact>
                      <Fact label="Created">{formatDateTime(run.createdAt)}</Fact>
                      <Fact label="Started">{formatDateTime(run.startedAt)}</Fact>
                      <Fact label="Finished">{formatDateTime(run.finishedAt)}</Fact>
                      <Fact label="Budget">
                        {run.config.budgets.maxPages}p / {run.config.budgets.maxActions}a /{' '}
                        {run.config.budgets.maxDepth}d / {run.config.budgets.maxFilterCombinations}c /{' '}
                        {formatDuration(run.config.budgets.maxDurationMs)}
                      </Fact>
                      {run.config.notes ? <Fact label="Notes">{run.config.notes}</Fact> : null}
                    </dl>
                  </section>
                </div>

                <TopFindings findings={detail.findings} onSelect={openFinding} />

                {run.coverage && run.coverage.limitations.length > 0 ? (
                  <Alert variant="warning">
                    <TrendingUp />
                    <AlertTitle>Coverage limitations</AlertTitle>
                    <AlertDescription className="flex flex-col gap-2">
                      <ul className="space-y-1">
                        {run.coverage.limitations.slice(0, 3).map((limitation, index) => (
                          <li key={`${index}-${limitation}`}>· {limitation}</li>
                        ))}
                      </ul>
                      <Button variant="outline" size="sm" className="w-fit" onClick={() => setTab('coverage')}>
                        See all {run.coverage.limitations.length} limitations
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : null}

                <section>
                  <SectionLabel hint={`${detail.evidence.length} artefacts`}>Evidence</SectionLabel>
                  <div className="mt-2">
                    <EvidenceGrid
                      runId={run.id}
                      items={detail.evidence}
                      emptyLabel="Evidence appears as the agent captures screenshots and logs."
                    />
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="findings" className="space-y-3">
                <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
                  <div className="w-full sm:w-36">
                    <Label className="mb-1.5 block" htmlFor="finding-severity">
                      Severity
                    </Label>
                    <Select value={severityFilter} onValueChange={(value) => setSeverityFilter(value as Severity | 'all')}>
                      <SelectTrigger id="finding-severity">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All severities</SelectItem>
                        {SEVERITIES.map((severity) => (
                          <SelectItem key={severity} value={severity}>
                            {SEVERITY_LABEL[severity]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-full sm:w-36">
                    <Label className="mb-1.5 block" htmlFor="finding-confidence">
                      Confidence
                    </Label>
                    <Select
                      value={confidenceFilter}
                      onValueChange={(value) => setConfidenceFilter(value as Confidence | 'all')}
                    >
                      <SelectTrigger id="finding-confidence">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All confidence</SelectItem>
                        {CONFIDENCES.map((confidence) => (
                          <SelectItem key={confidence} value={confidence} className="capitalize">
                            {confidence}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-full sm:w-36">
                    <Label className="mb-1.5 block" htmlFor="finding-status">
                      Status
                    </Label>
                    <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as FindingStatus | 'all')}>
                      <SelectTrigger id="finding-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        {FINDING_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {FINDING_STATUS_LABEL[status]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-full sm:w-44">
                    <Label className="mb-1.5 block" htmlFor="finding-category">
                      Category
                    </Label>
                    <Select
                      value={categoryFilter}
                      onValueChange={(value) => setCategoryFilter(value as FindingCategory | 'all')}
                    >
                      <SelectTrigger id="finding-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All categories</SelectItem>
                        {categoryOptions.map((category) => (
                          <SelectItem key={category} value={category}>
                            {CATEGORY_LABELS[category]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {hasFindingFilters ? (
                    <Button variant="ghost" size="sm" onClick={resetFindingFilters}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset
                    </Button>
                  ) : null}
                  <span className="ml-auto pb-1 text-[11px] text-muted-foreground">
                    {formatNumber(filteredFindings.length)} of {formatNumber(detail.findings.length)} findings
                  </span>
                </div>

                <FindingsTable
                  findings={filteredFindings}
                  onSelect={openFinding}
                  emptyTitle={hasFindingFilters ? 'No findings match these filters' : 'No findings yet'}
                  emptyDescription={
                    hasFindingFilters
                      ? 'Adjust or reset the filters to see the full finding set.'
                      : run.status === 'completed'
                        ? 'The run completed without recording any findings.'
                        : 'Findings appear here as soon as the agent confirms or suspects a problem.'
                  }
                  emptyAction={
                    hasFindingFilters ? (
                      <Button variant="outline" size="sm" onClick={resetFindingFilters}>
                        Reset filters
                      </Button>
                    ) : undefined
                  }
                />

                <p className="text-[11px] text-muted-foreground">
                  Findings are ordered by severity. Select a row for the description, expected vs observed
                  values, arithmetic, reproduction steps and evidence.
                </p>
              </TabsContent>

              <TabsContent value="coverage" className="space-y-4">
                <CoveragePanel run={run} />
                <MetricSnapshotTable snapshots={detail.snapshots} />
                <FilterValidationSection
                  dimensions={detail.filterDimensions}
                  combinations={detail.filterCombinations}
                />
              </TabsContent>

              <TabsContent value="pages" className="space-y-4">
                <StateGraphList pages={detail.pages} actions={detail.actions} />
                {detail.actions.length > 0 ? (
                  <section className="rounded-lg border border-border bg-card">
                    <div className="panel-header">
                      <SectionLabel hint={`${detail.actions.length} executed`}>Recent actions</SectionLabel>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Kind</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="hidden md:table-cell">Outcome</TableHead>
                          <TableHead className="hidden sm:table-cell">URL after</TableHead>
                          <TableHead className="text-right">Duration</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...detail.actions]
                          .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
                          .slice(0, 25)
                          .map((action) => (
                            <TableRow key={action.id}>
                              <TableCell className="mono text-[10px] text-muted-foreground">{action.kind}</TableCell>
                              <TableCell className="max-w-[320px]">
                                <span className="block truncate text-[11px]" title={action.description}>
                                  {action.description}
                                </span>
                                <span className="mono block truncate text-[10px] text-muted-foreground">
                                  {action.elementLabel || action.element?.selector || '—'}
                                </span>
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                <span className="mono text-[10px] text-muted-foreground">{action.outcome}</span>
                              </TableCell>
                              <TableCell className="mono hidden max-w-[220px] truncate text-[10px] text-muted-foreground sm:table-cell">
                                {action.urlAfter ?? '—'}
                              </TableCell>
                              <TableCell className="text-right font-mono text-[10px] text-muted-foreground">
                                {formatDuration(action.durationMs)}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </section>
                ) : null}
              </TabsContent>

              <TabsContent value="logs" className="space-y-3">
                <LogStream
                  events={events.events}
                  connected={events.connected}
                  heightClassName="h-[480px]"
                  emptyLabel="Log output streams from the worker as the agent runs."
                />
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <Badge variant="outline" className="normal-case">
                    {events.events.filter((event) => event.type === 'action').length} action events
                  </Badge>
                  <Badge variant="outline" className="normal-case">
                    {events.events.filter((event) => event.type === 'check').length} check events
                  </Badge>
                  <Badge variant="outline" className="normal-case">
                    {events.events.filter((event) => event.type === 'finding').length} finding events
                  </Badge>
                  <span>Events stream live; reconnections replay from the last sequence number.</span>
                </div>
              </TabsContent>

              <TabsContent value="report" className="space-y-4">
                {reportQuery.error ? (
                  <ErrorState
                    title="Could not build the report"
                    message={reportQuery.error}
                    onRetry={reportQuery.reload}
                    retrying={reportQuery.fetching}
                  />
                ) : reportQuery.loading && !reportQuery.data ? (
                  <LoadingPanel label="Building report" rows={5} />
                ) : reportQuery.data ? (
                  <ReportPreview report={reportQuery.data} runId={run.id} />
                ) : (
                  <EmptyState
                    icon={FileText}
                    title="Report not available yet"
                    description="The report bundle is assembled as the run finalizes. You can still inspect findings and coverage."
                  />
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <FindingDetail
        finding={selectedFinding}
        runId={runId}
        open={findingOpen}
        onOpenChange={setFindingOpen}
        onReproduce={(finding) => void performAction('reproduce', finding.id)}
        reproducing={reproducingId === selectedFinding?.id}
      />
    </Shell>
  );
}
