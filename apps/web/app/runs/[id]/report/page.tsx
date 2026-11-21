'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import type { EvidenceRef, Finding, RunReport } from '@smartqa/shared/types';
import { CATEGORY_LABELS, SEVERITIES } from '@smartqa/shared/types';
import { ArrowLeft, FileJson, FileText, Printer, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfidenceBadge } from '@/components/confidence-badge';
import { SeverityBadge } from '@/components/severity-badge';
import { Shell } from '@/components/shell';
import { ErrorState, LoadingPanel } from '@/components/states';
import { api, evidenceUrl, exportUrl } from '@/lib/api';
import {
  FINDING_STATUS_LABEL,
  LOG_LEVEL_LABEL,
  SEVERITY_LABEL,
  calculationVerdict,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatTime,
} from '@/lib/format';
import { useApiData } from '@/lib/use-api-data';
import { cn } from '@/lib/utils';

function isImageEvidence(evidence: EvidenceRef): boolean {
  return (
    evidence.contentType.startsWith('image/') ||
    evidence.kind === 'screenshot' ||
    evidence.kind === 'full_page_screenshot'
  );
}

function DocSection({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-lg border border-border bg-card p-4 print:rounded-none print:border-0 print:border-t print:border-neutral-300 print:p-0 print:pt-3',
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 print:border-neutral-300">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em]">{title}</h2>
        {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function DocStat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded border border-border bg-background/40 px-2.5 py-2 print:bg-transparent">
      <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-[15px] leading-none tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function DocTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-border text-left">
            {head.map((label) => (
              <th
                key={label}
                className="whitespace-nowrap px-2 py-1.5 text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function CheckStatus({ status }: { status: 'passed' | 'failed' | 'warning' | 'skipped' }) {
  const className =
    status === 'passed'
      ? 'text-success'
      : status === 'failed'
        ? 'text-severity-critical'
        : status === 'warning'
          ? 'text-severity-medium'
          : 'text-muted-foreground';
  return <span className={cn('font-mono text-[10px] uppercase', className)}>{status}</span>;
}

function CalculationBlock({ finding }: { finding: Finding }) {
  const calculation = finding.calculation;
  if (!calculation) return null;
  const verdict = calculationVerdict(calculation.delta, calculation.tolerance);
  const verdictLabel =
    verdict === 'within_tolerance'
      ? 'Within tolerance'
      : verdict === 'outside_tolerance'
        ? 'Outside tolerance'
        : 'Not comparable';

  return (
    <div className="rounded border border-border p-2.5 print:border-neutral-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violetBrand print:text-neutral-800">
          Arithmetic validation
        </p>
        <span className="mono text-[10px]">{verdictLabel}</span>
      </div>
      <DocTable head={['Field', 'Value']}>
        <tr className="border-b border-border/60">
          <td className="px-2 py-1 text-muted-foreground">Formula</td>
          <td className="px-2 py-1 font-mono">{calculation.formula}</td>
        </tr>
        <tr className="border-b border-border/60">
          <td className="px-2 py-1 text-muted-foreground">Expected</td>
          <td className="px-2 py-1 font-mono">
            {calculation.expected == null ? '—' : formatNumber(calculation.expected)}
            {calculation.unit ? ` ${calculation.unit}` : ''}
          </td>
        </tr>
        <tr className="border-b border-border/60">
          <td className="px-2 py-1 text-muted-foreground">Observed</td>
          <td className="px-2 py-1 font-mono">
            {calculation.observed == null ? '—' : formatNumber(calculation.observed)}
            {calculation.unit ? ` ${calculation.unit}` : ''}
          </td>
        </tr>
        <tr className="border-b border-border/60">
          <td className="px-2 py-1 text-muted-foreground">Delta</td>
          <td className="px-2 py-1 font-mono">
            {calculation.delta == null ? '—' : formatNumber(calculation.delta)}
            {calculation.unit ? ` ${calculation.unit}` : ''}
          </td>
        </tr>
        <tr className="border-b border-border/60">
          <td className="px-2 py-1 text-muted-foreground">Tolerance</td>
          <td className="px-2 py-1 font-mono">
            {formatNumber(calculation.tolerance)}
            {calculation.unit ? ` ${calculation.unit}` : ''}
          </td>
        </tr>
        <tr className="border-b border-border/60">
          <td className="px-2 py-1 text-muted-foreground">Additivity</td>
          <td className="px-2 py-1">
            <span className="font-mono">{calculation.additivity}</span> · {calculation.reason}
          </td>
        </tr>
        <tr>
          <td className="px-2 py-1 text-muted-foreground">Sample</td>
          <td className="px-2 py-1 font-mono">
            {calculation.sampleSize} observations · {calculation.metricKind}
          </td>
        </tr>
      </DocTable>
      {calculation.components.length > 0 ? (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] sm:grid-cols-3">
          {calculation.components.map((component, index) => (
            <div key={`${component.label}-${index}`} className="flex justify-between gap-2 border-b border-border/40">
              <span className="truncate text-muted-foreground">{component.label}</span>
              <span className="font-mono">{formatNumber(component.value)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReportFinding({ finding, runId }: { finding: Finding; runId: string }) {
  const images = finding.evidence.filter(isImageEvidence).slice(0, 3);
  const artefacts = finding.evidence.filter((evidence) => !isImageEvidence(evidence));

  return (
    <article className="report-avoid-break rounded-lg border border-border bg-background/30 p-3 print:rounded-none print:border-0 print:border-b print:border-neutral-300 print:bg-transparent print:px-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={finding.severity} />
        <ConfidenceBadge confidence={finding.confidence} />
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px]">
          {FINDING_STATUS_LABEL[finding.status]}
        </span>
        <span className="text-[10px] text-muted-foreground">{CATEGORY_LABELS[finding.category]}</span>
      </div>

      <h3 className="mt-2 text-[13px] font-semibold leading-snug">{finding.title}</h3>
      <p className="mono mt-0.5 break-all text-[10px] text-muted-foreground">{finding.pageUrl}</p>
      <p className="mt-2 whitespace-pre-line text-[11px] leading-relaxed">{finding.description}</p>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Expected</p>
          <p className="mt-0.5 whitespace-pre-line text-[11px]">{finding.expected?.trim() || 'No expectation recorded.'}</p>
        </div>
        <div>
          <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Observed</p>
          <p className="mt-0.5 whitespace-pre-line text-[11px]">{finding.observed?.trim() || 'No observation recorded.'}</p>
        </div>
      </div>

      {finding.calculation ? (
        <div className="mt-2">
          <CalculationBlock finding={finding} />
        </div>
      ) : null}

      {finding.reproduction.steps.length > 0 ? (
        <div className="mt-2">
          <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Reproduction ({finding.reproduction.successes}/{finding.reproduction.attempts} replays)
          </p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11px] leading-relaxed">
            {finding.reproduction.steps.map((step, index) => (
              <li key={`${index}-${step}`}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {images.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((evidence) => (
            <figure key={evidence.id} className="max-w-[240px]">
              <img
                src={evidenceUrl(runId, evidence.id)}
                alt={evidence.label}
                className="max-h-40 w-auto rounded border border-border object-contain"
              />
              <figcaption className="mt-0.5 text-[9px] text-muted-foreground">{evidence.label}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {artefacts.length > 0 ? (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Additional evidence: {artefacts.map((evidence) => `${evidence.kind} (${evidence.label})`).join(', ')}
        </p>
      ) : null}

      <p className="mono mt-1.5 text-[9px] text-muted-foreground">
        first seen {formatDateTime(finding.firstSeenAt)} · last seen {formatDateTime(finding.lastSeenAt)} ·{' '}
        {finding.occurrenceCount} occurrence(s) · fingerprint {finding.fingerprint}
      </p>
    </article>
  );
}

function ReportDocument({ report, runId }: { report: RunReport; runId: string }) {
  const sortedFindings = useMemo(
    () =>
      [...report.findings].sort((a, b) => {
        const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
        const bySeverity = rank[a.severity] - rank[b.severity];
        return bySeverity !== 0 ? bySeverity : a.title.localeCompare(b.title);
      }),
    [report.findings],
  );

  const states = [...report.stateGraph.states].sort((a, b) => a.depth - b.depth);
  const logs = report.logs.slice(-80);
  const notes = report.run.config.notes?.trim();

  return (
    <div className="space-y-4">
      <header className="rounded-lg border border-border bg-card p-5 print:border-0 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="section-label">SmartQA · test report</p>
            <h2 className="mt-1 break-all text-xl font-semibold tracking-tight">{report.meta.url}</h2>
            <p className="mono mt-1 break-all text-[11px] text-muted-foreground">
              run {report.run.id} · seed {report.meta.seed} · {report.meta.mode} mode
            </p>
          </div>
          <dl className="space-y-0.5 text-right text-[10px] text-muted-foreground">
            <div>
              generated <span className="mono text-foreground/85">{formatDateTime(report.meta.generatedAt)}</span>
            </div>
            <div>
              {report.meta.generator} · format v{report.meta.formatVersion}
            </div>
            <div>
              status <span className="mono text-foreground/85">{report.run.status}</span>
            </div>
            <div>
              duration <span className="mono text-foreground/85">{formatDuration(report.run.durationMs)}</span>
            </div>
          </dl>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            coverage: {report.coverage.completeness}
          </span>
          <span className="text-[11px] text-muted-foreground">{report.coverage.completenessReason}</span>
        </div>

        <p className="mt-3 rounded border border-severity-medium/40 bg-severity-medium/5 p-2 text-[10px] leading-relaxed">
          <strong className="font-semibold">Coverage statement.</strong> This report describes what the agent
          observed within its configured budgets. Coverage is <span className="font-mono">{report.coverage.completeness}</span>{' '}
          and bounded by {report.limitations.length} recorded limitation(s). It is not a claim of complete
          coverage.
        </p>

        {notes ? (
          <p className="mt-2 rounded border border-border p-2 text-[10px] leading-relaxed">
            <strong className="font-semibold">Operator note:</strong> {notes}
          </p>
        ) : null}
      </header>

      <DocSection
        title="Executive summary"
        hint={`${formatNumber(report.summary.findingsTotal)} findings · ${formatNumber(
          report.summary.checks.passed + report.summary.checks.failed + report.summary.checks.warning,
        )} checks`}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <DocStat
            label="Findings"
            value={formatNumber(report.summary.findingsTotal)}
            hint={`${report.summary.confirmed} confirmed · ${report.summary.suspected} suspected`}
          />
          <DocStat
            label="Checks"
            value={formatNumber(report.summary.checks.passed)}
            hint={`${report.summary.checks.failed} failed · ${report.summary.checks.warning} warnings`}
          />
          <DocStat
            label="Pages visited"
            value={formatNumber(report.summary.pagesVisited)}
            hint={`${report.summary.pagesDiscovered} discovered`}
          />
          <DocStat
            label="Actions"
            value={formatNumber(report.coverage.budget.actions)}
            hint={`budget ${report.run.config.budgets.maxActions}`}
          />
          <DocStat
            label="States"
            value={formatNumber(report.summary.statesDiscovered)}
            hint={`${report.summary.loopsPrevented} loops prevented`}
          />
          <DocStat
            label="Filter combos"
            value={formatNumber(report.summary.filterCombinationsExecuted)}
            hint={`${report.summary.filterCombinationsPlanned} planned`}
          />
          <DocStat
            label="Duration"
            value={formatDuration(report.summary.durationMs)}
            hint={report.run.startedAt ? formatDateTime(report.run.startedAt) : 'not started'}
          />
          <DocStat label="Coverage" value={report.coverage.completeness} hint="see limitations" />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SEVERITIES.map((severity) => (
            <SeverityBadge
              key={severity}
              severity={severity}
              count={report.summary.severities[severity]}
              className={report.summary.severities[severity] === 0 ? 'opacity-50' : undefined}
            />
          ))}
        </div>
      </DocSection>

      <DocSection
        title="Coverage & limitations"
        hint={`${report.coverage.pagesVisited}/${report.coverage.pagesDiscovered} pages · ${report.coverage.elementsTested}/${report.coverage.elementsDiscovered} elements`}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <DocStat label="Pages visited" value={report.coverage.pagesVisited} hint={`${report.coverage.pagesDiscovered} discovered`} />
          <DocStat label="States" value={report.coverage.statesVisited} hint={`${report.coverage.statesDiscovered} discovered`} />
          <DocStat label="Elements tested" value={report.coverage.elementsTested} hint={`${report.coverage.elementsSkipped} skipped`} />
          <DocStat
            label="Filter combinations"
            value={report.coverage.filterCombinationsExecuted}
            hint={`${report.coverage.filterCombinationsPlanned} planned`}
          />
        </div>

        <div>
          <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-severity-medium">
            <ShieldAlert className="h-3 w-3" />
            Known limitations
          </h3>
          {report.limitations.length === 0 ? (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              The agent recorded no explicit limitations. That is not evidence of complete coverage — the
              reported coverage level and budgets define the bound.
            </p>
          ) : (
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11px] leading-relaxed">
              {report.limitations.map((limitation, index) => (
                <li key={`${index}-${limitation}`}>{limitation}</li>
              ))}
            </ol>
          )}
        </div>

        {report.coverage.basis.length > 0 ? (
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Coverage basis
            </h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed">
              {report.coverage.basis.map((basis, index) => (
                <li key={`${index}-${basis}`}>{basis}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-[10px] text-muted-foreground">
          Budget usage: pages {report.coverage.budget.pages}/{report.run.config.budgets.maxPages} · actions{' '}
          {report.coverage.budget.actions}/{report.run.config.budgets.maxActions} · depth{' '}
          {report.coverage.budget.depth}/{report.run.config.budgets.maxDepth} · filter combos{' '}
          {report.coverage.budget.filterCombinations}/{report.run.config.budgets.maxFilterCombinations} · duration{' '}
          {formatDuration(report.coverage.budget.durationMs)}/{formatDuration(report.run.config.budgets.maxDurationMs)}
          {report.coverage.budget.exhausted.length > 0
            ? ` · exhausted: ${report.coverage.budget.exhausted.join(', ')}`
            : ''}
        </p>
      </DocSection>

      <DocSection title="Findings" hint={`${sortedFindings.length} finding(s), ordered by severity`}>
        {sortedFindings.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No findings were recorded for this run.</p>
        ) : (
          <div className="space-y-3">
            {sortedFindings.map((finding) => (
              <ReportFinding key={finding.id} finding={finding} runId={runId} />
            ))}
          </div>
        )}
      </DocSection>

      <DocSection title="Checks" hint={`${report.checks.length} deterministic check(s)`}>
        {report.checks.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No checks were recorded.</p>
        ) : (
          <DocTable head={['Status', 'Kind', 'Check', 'Detail', 'Page']}>
            {report.checks.map((check) => (
              <tr key={check.id} className="border-b border-border/60 align-top">
                <td className="px-2 py-1">
                  <CheckStatus status={check.status} />
                </td>
                <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">{check.kind}</td>
                <td className="px-2 py-1">{check.title}</td>
                <td className="px-2 py-1 text-[10px] text-muted-foreground">
                  {check.detail}
                  {check.calculation ? ` · ${check.calculation.formula}` : ''}
                </td>
                <td className="mono max-w-[220px] truncate px-2 py-1 text-[10px] text-muted-foreground">
                  {check.pageUrl}
                </td>
              </tr>
            ))}
          </DocTable>
        )}
      </DocSection>

      {report.filterTests.length > 0 ? (
        <DocSection title="Filter validation" hint={`${report.filterTests.length} dimension(s)`}>
          <DocTable head={['Dimension', 'Kind', 'Options', 'Combos', 'Order variants', 'Reset', 'Additivity', 'Detail']}>
            {report.filterTests.map((test, index) => (
              <tr key={`${test.dimension}-${index}`} className="border-b border-border/60 align-top">
                <td className="px-2 py-1">{test.dimension}</td>
                <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">{test.kind}</td>
                <td className="px-2 py-1 font-mono">{test.options.length}</td>
                <td className="px-2 py-1 font-mono">{test.combinationsExecuted}</td>
                <td className="px-2 py-1 font-mono">{test.orderVariants}</td>
                <td className="px-2 py-1 font-mono">
                  {test.resetRestoredBaseline == null ? '—' : test.resetRestoredBaseline ? 'yes' : 'no'}
                </td>
                <td className="px-2 py-1 font-mono text-[10px]">{test.additivityVerdict}</td>
                <td className="px-2 py-1 text-[10px] text-muted-foreground">{test.detail}</td>
              </tr>
            ))}
          </DocTable>
        </DocSection>
      ) : null}

      <DocSection title="Metric snapshots" hint={`${report.snapshots.length} snapshot(s)`}>
        {report.snapshots.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No metric snapshots were captured.</p>
        ) : (
          <>
            <DocTable head={['Page', 'Viewport', 'Metrics', 'Rows', 'Captured']}>
              {report.snapshots.map((snapshot) => (
                <tr key={snapshot.id} className="border-b border-border/60 align-top">
                  <td className="mono max-w-[340px] truncate px-2 py-1 text-[10px]">{snapshot.pageUrl}</td>
                  <td className="px-2 py-1 font-mono text-[10px]">{snapshot.viewport}</td>
                  <td className="px-2 py-1 font-mono text-[10px]">{snapshot.metrics.length}</td>
                  <td className="px-2 py-1 font-mono text-[10px]">{snapshot.rowCount ?? '—'}</td>
                  <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
                    {formatDateTime(snapshot.capturedAt)}
                  </td>
                </tr>
              ))}
            </DocTable>
            <p className="text-[10px] text-muted-foreground">
              Key metrics:{' '}
              {report.snapshots
                .flatMap((snapshot) => snapshot.metrics)
                .slice(0, 12)
                .map((metric) => `${metric.label} ${metric.rawText || metric.value}${metric.unit ?? ''}`)
                .join(' · ') || '—'}
            </p>
          </>
        )}
      </DocSection>

      <DocSection title="Pages tested" hint={`${states.length} state(s) · max depth ${report.stateGraph.maxDepthReached}`}>
        {states.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No page states were recorded.</p>
        ) : (
          <DocTable head={['Depth', 'Title', 'URL', 'Visits', 'Interactive', 'Visited']}>
            {states.map((state) => (
              <tr key={state.id} className="border-b border-border/60 align-top">
                <td className="px-2 py-1 font-mono">{state.depth}</td>
                <td className="px-2 py-1">{state.title || '(untitled)'}</td>
                <td className="mono max-w-[360px] truncate px-2 py-1 text-[10px] text-muted-foreground">{state.url}</td>
                <td className="px-2 py-1 font-mono">{state.visitCount}</td>
                <td className="px-2 py-1 font-mono">{state.interactiveCount}</td>
                <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">{formatDateTime(state.visitedAt)}</td>
              </tr>
            ))}
          </DocTable>
        )}
        <p className="text-[10px] text-muted-foreground">
          {report.stateGraph.actions.length} actions · {report.stateGraph.loopsPrevented} loops prevented ·{' '}
          {report.stateGraph.frontierStateIds.length} frontier states left
        </p>
      </DocSection>

      <DocSection title="Log excerpt" hint={`last ${logs.length} entries`}>
        {logs.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No log entries were captured.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border p-2 print:border-neutral-300">
            <ul className="space-y-0.5 font-mono text-[9px] leading-relaxed">
              {logs.map((entry) => (
                <li key={entry.id} className="flex gap-2">
                  <span className="shrink-0 text-muted-foreground">{formatTime(entry.at)}</span>
                  <span className="shrink-0 uppercase">{LOG_LEVEL_LABEL[entry.level]}</span>
                  <span className="min-w-0 whitespace-pre-wrap break-words">{entry.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DocSection>

      <DocSection title="Agent & AI usage" hint={report.aiUsage.enabled ? 'assisted' : 'deterministic only'}>
        <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
          <DocStat label="AI enabled" value={report.aiUsage.enabled ? 'yes' : 'no'} />
          <DocStat label="Provider" value={report.aiUsage.provider || '—'} />
          <DocStat label="Model" value={report.aiUsage.model || '—'} />
          <DocStat label="Calls" value={`${report.aiUsage.calls} / ${report.aiUsage.failures} failed`} />
        </div>
        {report.aiUsage.decisions.length > 0 ? (
          <ul className="space-y-0.5 text-[10px]">
            {report.aiUsage.decisions.slice(-8).map((decision, index) => (
              <li key={`${index}-${decision.at}`} className="flex flex-wrap gap-x-2">
                <span className="font-mono text-muted-foreground">{formatTime(decision.at)}</span>
                <span className="font-mono">{decision.purpose}</span>
                <span className="min-w-0 flex-1">{decision.summary}</span>
                <span className="font-mono text-muted-foreground">
                  {decision.accepted ? 'accepted' : 'rejected'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </DocSection>

      <footer className="border-t border-border pt-3 text-[9px] text-muted-foreground print:border-neutral-300">
        <p>
          Generated by {report.meta.generator} · format version {report.meta.formatVersion} · run{' '}
          {report.meta.runId} · seed {report.meta.seed} · {formatDateTime(report.meta.generatedAt)}
        </p>
        <p className="mt-0.5">
          Severity labels used: {SEVERITIES.map((severity) => SEVERITY_LABEL[severity]).join(', ')}. This
          document is evidence-scoped and does not assert complete coverage.
        </p>
      </footer>
    </div>
  );
}

export default function ReportPage() {
  const params = useParams();
  const runId = typeof params.id === 'string' ? params.id : '';
  const reportQuery = useApiData((signal) => api.getReport(runId, signal), [runId], {
    enabled: runId.length > 0,
  });
  const report = reportQuery.data;

  return (
    <Shell
      title="Run report"
      subtitle={
        report ? (
          <span className="mono break-all">{report.meta.url}</span>
        ) : (
          <span className="mono">{runId}</span>
        )
      }
      actions={
        <>
          <Button
            size="sm"
            variant="brand"
            onClick={() => window.print()}
            disabled={!report}
          >
            <Printer className="h-3.5 w-3.5" />
            Print / Save PDF
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={exportUrl(runId, 'json')} download>
              <FileJson className="h-3.5 w-3.5" />
              JSON
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={exportUrl(runId, 'pdf')} download>
              <FileText className="h-3.5 w-3.5" />
              PDF
            </a>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/runs/${runId}`}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Run
            </Link>
          </Button>
        </>
      }
    >
      <div className="report-doc space-y-4">
        {reportQuery.error && !report ? (
          <ErrorState
            title="Could not load the report"
            message={reportQuery.error}
            onRetry={reportQuery.reload}
            retrying={reportQuery.fetching}
          />
        ) : reportQuery.loading && !report ? (
          <LoadingPanel label="Assembling the report" rows={6} />
        ) : report ? (
          <ReportDocument report={report} runId={runId} />
        ) : (
          <ErrorState
            title="Report unavailable"
            message="The report bundle could not be produced for this run."
            onRetry={reportQuery.reload}
          />
        )}
      </div>
    </Shell>
  );
}
