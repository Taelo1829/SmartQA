'use client';

import type { ReactNode } from 'react';
import type { Finding } from '@smartqa/shared/types';
import { CATEGORY_LABELS } from '@smartqa/shared/types';
import { SearchX, Sigma } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ConfidenceBadge } from '@/components/confidence-badge';
import { EmptyState } from '@/components/states';
import { SeverityBadge } from '@/components/severity-badge';
import {
  FINDING_STATUS_BADGE,
  FINDING_STATUS_LABEL,
  formatRelativeTime,
  severityRank,
  truncateMiddle,
} from '@/lib/format';
import { cn } from '@/lib/utils';

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    return a.title.localeCompare(b.title);
  });
}

export function FindingsTable({
  findings,
  onSelect,
  emptyTitle = 'No findings',
  emptyDescription = 'The agent has not reported any findings yet. Findings appear here as soon as they are confirmed or suspected.',
  emptyAction,
  className,
}: {
  findings: Finding[];
  onSelect?: (finding: Finding) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  className?: string;
}) {
  if (findings.length === 0) {
    return <EmptyState icon={SearchX} title={emptyTitle} description={emptyDescription} action={emptyAction} className={className} />;
  }

  const rows = sortFindings(findings);

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[92px]">Severity</TableHead>
            <TableHead>Finding</TableHead>
            <TableHead className="hidden sm:table-cell">Confidence</TableHead>
            <TableHead className="hidden md:table-cell">Status</TableHead>
            <TableHead className="hidden lg:table-cell">Evidence</TableHead>
            <TableHead className="w-[104px] text-right">Last seen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((finding) => {
            const interactive = Boolean(onSelect);
            return (
              <TableRow
                key={finding.id}
                className={cn(interactive && 'cursor-pointer')}
                tabIndex={interactive ? 0 : undefined}
                role={interactive ? 'button' : undefined}
                onClick={onSelect ? () => onSelect(finding) : undefined}
                onKeyDown={
                  onSelect
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelect(finding);
                        }
                      }
                    : undefined
                }
              >
                <TableCell>
                  <SeverityBadge severity={finding.severity} />
                </TableCell>
                <TableCell className="max-w-[520px]">
                  <div className="flex items-start gap-1.5">
                    <span className="line-clamp-2 text-[12px] font-medium leading-snug text-foreground">
                      {finding.title}
                    </span>
                    {finding.calculation ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="mt-0.5 inline-flex shrink-0 text-violetBrand" aria-label="Arithmetic check attached">
                            <Sigma className="h-3.5 w-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Deterministic arithmetic check attached</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge variant="outline" className="text-[10px] normal-case">
                      {CATEGORY_LABELS[finding.category]}
                    </Badge>
                    <span className="mono truncate text-muted-foreground" title={finding.pageUrl}>
                      {truncateMiddle(finding.pageUrl.replace(/^https?:\/\//, ''), 52)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <ConfidenceBadge confidence={finding.confidence} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <span
                    className={cn(
                      'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium',
                      FINDING_STATUS_BADGE[finding.status],
                    )}
                  >
                    {FINDING_STATUS_LABEL[finding.status]}
                  </span>
                </TableCell>
                <TableCell className="hidden lg:table-cell font-mono text-[11px] text-muted-foreground">
                  {finding.evidence.length}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-mono text-[11px] tabular-nums text-foreground/80">
                      {formatRelativeTime(finding.lastSeenAt)}
                    </span>
                    {finding.occurrenceCount > 1 ? (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        ×{finding.occurrenceCount}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
