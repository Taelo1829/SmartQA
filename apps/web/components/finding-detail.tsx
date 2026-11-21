'use client';

import { useState } from 'react';
import type { Finding } from '@smartqa/shared/types';
import { CATEGORY_LABELS } from '@smartqa/shared/types';
import { Check, Copy, Loader2, RefreshCw, Sigma } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { ConfidenceBadge } from '@/components/confidence-badge';
import { EvidenceGrid } from '@/components/evidence-grid';
import { SeverityBadge } from '@/components/severity-badge';
import {
  calculationVerdict,
  FINDING_STATUS_BADGE,
  FINDING_STATUS_LABEL,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
} from '@/lib/format';
import { cn } from '@/lib/utils';

function formatScalar(value: number | null | undefined, unit?: string | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
}

function additivityLabel(additivity: 'additive' | 'non_additive' | 'unknown'): string {
  if (additivity === 'additive') return 'Additive';
  if (additivity === 'non_additive') return 'Non-additive';
  return 'Unknown';
}

function VerdictBadge({ delta, tolerance }: { delta: number | null; tolerance: number }) {
  const verdict = calculationVerdict(delta, tolerance);
  const label =
    verdict === 'within_tolerance'
      ? 'Within tolerance'
      : verdict === 'outside_tolerance'
        ? 'Outside tolerance'
        : 'Not comparable';
  const className =
    verdict === 'within_tolerance'
      ? 'border-success/40 bg-success/10 text-success'
      : verdict === 'outside_tolerance'
        ? 'border-severity-critical/40 bg-severity-critical/10 text-severity-critical'
        : 'border-border bg-muted text-muted-foreground';
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', className)}>
      {label}
    </span>
  );
}

export interface FindingDetailProps {
  finding: Finding | null;
  runId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReproduce?: (finding: Finding) => void;
  reproducing?: boolean;
}

export function FindingDetail({
  finding,
  runId,
  open,
  onOpenChange,
  onReproduce,
  reproducing = false,
}: FindingDetailProps) {
  const [copied, setCopied] = useState(false);

  const copySteps = async () => {
    if (!finding) return;
    const steps = finding.reproduction.steps;
    const text =
      steps.length > 0
        ? steps.map((step, index) => `${index + 1}. ${step}`).join('\n')
        : finding.description;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        {finding ? (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-1.5">
                <SeverityBadge severity={finding.severity} />
                <ConfidenceBadge confidence={finding.confidence} />
                <span
                  className={cn(
                    'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium',
                    FINDING_STATUS_BADGE[finding.status],
                  )}
                >
                  {FINDING_STATUS_LABEL[finding.status]}
                </span>
                <Badge variant="outline" className="normal-case">
                  {CATEGORY_LABELS[finding.category]}
                </Badge>
                {finding.calculation ? (
                  <Badge variant="secondary">
                    <Sigma className="h-3 w-3" />
                    Math check
                  </Badge>
                ) : null}
              </div>
              <DialogTitle>{finding.title}</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-1">
                  <a
                    href={finding.pageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mono block break-all text-brand hover:underline"
                  >
                    {finding.pageUrl}
                  </a>
                  {finding.pageTitle ? (
                    <p className="text-[11px] text-muted-foreground">{finding.pageTitle}</p>
                  ) : null}
                </div>
              </DialogDescription>
            </DialogHeader>

            <p className="whitespace-pre-line text-[12px] leading-relaxed text-foreground/90">
              {finding.description}
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-border bg-background/50 p-3">
                <p className="section-label">Expected</p>
                <p className="mt-1.5 whitespace-pre-line text-[12px] text-foreground/90">
                  {finding.expected?.trim() ? finding.expected : 'No expectation recorded.'}
                </p>
              </div>
              <div className="rounded-md border border-border bg-background/50 p-3">
                <p className="section-label">Observed</p>
                <p className="mt-1.5 whitespace-pre-line text-[12px] text-foreground/90">
                  {finding.observed?.trim() ? finding.observed : 'No observation recorded.'}
                </p>
              </div>
            </div>

            {finding.calculation ? (
              <section className="rounded-md border border-violetBrand/30 bg-violetBrand/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="section-label text-violetBrand/90">Arithmetic validation</p>
                  <VerdictBadge
                    delta={finding.calculation.delta}
                    tolerance={finding.calculation.tolerance}
                  />
                </div>
                <div className="mt-2 overflow-hidden rounded border border-border">
                  <Table>
                    <TableBody>
                      <TableRow>
                        <TableCell className="w-32 text-muted-foreground">Formula</TableCell>
                        <TableCell className="mono whitespace-pre-wrap">{finding.calculation.formula}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Expected</TableCell>
                        <TableCell className="mono">
                          {formatScalar(finding.calculation.expected, finding.calculation.unit)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Observed</TableCell>
                        <TableCell className="mono">
                          {formatScalar(finding.calculation.observed, finding.calculation.unit)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Delta</TableCell>
                        <TableCell className="mono">
                          {formatScalar(finding.calculation.delta, finding.calculation.unit)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Tolerance</TableCell>
                        <TableCell className="mono">
                          {formatScalar(finding.calculation.tolerance, finding.calculation.unit)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Additivity</TableCell>
                        <TableCell>
                          <span className="mono">{additivityLabel(finding.calculation.additivity)}</span>
                          <span className="ml-2 text-[11px] text-muted-foreground">
                            {finding.calculation.reason}
                          </span>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Sample</TableCell>
                        <TableCell className="mono">
                          {finding.calculation.sampleSize} observations · {finding.calculation.metricKind}
                          {finding.calculation.unit ? ` · ${finding.calculation.unit}` : ''}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                {finding.calculation.components.length > 0 ? (
                  <div className="mt-2 overflow-hidden rounded border border-border">
                    <Table>
                      <TableBody>
                        {finding.calculation.components.map((component, index) => (
                          <TableRow key={`${component.label}-${index}`}>
                            <TableCell className="text-muted-foreground">{component.label}</TableCell>
                            <TableCell className="mono text-right">
                              {formatScalar(component.value, finding.calculation?.unit)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="section-label">Reproduction</p>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {finding.reproduction.successes}/{finding.reproduction.attempts} replays reproduced
                  {finding.reproduction.lastAttemptAt
                    ? ` · ${formatRelativeTime(finding.reproduction.lastAttemptAt)}`
                    : ''}
                </span>
              </div>
              {finding.reproduction.steps.length > 0 ? (
                <ol className="mt-2 space-y-1.5">
                  {finding.reproduction.steps.map((step, index) => (
                    <li key={`${index}-${step}`} className="flex gap-2 text-[12px] text-foreground/90">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border bg-background/60 font-mono text-[10px] text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  No human-readable steps were recorded.
                </p>
              )}
              {finding.reproduction.notes ? (
                <p className="mt-2 rounded border border-border bg-background/50 p-2 text-[11px] text-muted-foreground">
                  {finding.reproduction.notes}
                </p>
              ) : null}
              {finding.reproduction.reproducedBy ? (
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  verified by {finding.reproduction.reproducedBy}
                </p>
              ) : null}
            </section>

            <section>
              <p className="section-label">Evidence</p>
              <div className="mt-2">
                <EvidenceGrid
                  runId={runId}
                  items={finding.evidence}
                  emptyLabel="This finding has no screenshot evidence attached."
                />
              </div>
            </section>

            <div className="space-y-2 rounded-md border border-border bg-background/40 p-3">
              <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                <p>
                  First seen <span className="mono text-foreground/80">{formatDateTime(finding.firstSeenAt)}</span>
                </p>
                <p>
                  Last seen <span className="mono text-foreground/80">{formatDateTime(finding.lastSeenAt)}</span>
                </p>
                <p>
                  Occurrences <span className="mono text-foreground/80">{finding.occurrenceCount}</span>
                </p>
                {finding.elementLabel ? (
                  <p>
                    Element <span className="mono text-foreground/80">{finding.elementLabel}</span>
                  </p>
                ) : null}
                {finding.selector ? (
                  <p className="sm:col-span-2">
                    Selector <span className="mono text-foreground/80 break-all">{finding.selector}</span>
                  </p>
                ) : null}
                <p className="sm:col-span-2">
                  Fingerprint{' '}
                  <span className="mono break-all text-foreground/80">{finding.fingerprint}</span>
                </p>
              </div>
              {finding.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {finding.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="font-mono text-[10px] normal-case">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {finding.suspectedReason ? (
                <p className="text-[11px] text-severity-medium">{finding.suspectedReason}</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => void copySteps()}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy steps'}
              </Button>
              {onReproduce ? (
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => onReproduce(finding)}
                  disabled={reproducing}
                >
                  {reproducing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {reproducing ? 'Replaying…' : 'Re-run reproduction'}
                </Button>
              ) : null}
              <DialogClose asChild>
                <Button variant="ghost" size="sm">
                  Close
                </Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
