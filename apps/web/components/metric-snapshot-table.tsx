'use client';

import { useState } from 'react';
import type { MetricSnapshot, MetricSample } from '@smartqa/shared/types';
import { TableProperties } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState, SectionLabel } from '@/components/states';
import { formatDateTime, formatMetricValue, formatNumber, truncateMiddle } from '@/lib/format';
import { cn } from '@/lib/utils';

const ADDITIVITY_STYLE: Record<string, string> = {
  additive: 'border-success/40 bg-success/10 text-success',
  non_additive: 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium',
  unknown: 'border-border bg-muted text-muted-foreground',
};

function AdditivityCell({ sample }: { sample: MetricSample }) {
  const label =
    sample.additivity === 'additive'
      ? 'Additive'
      : sample.additivity === 'non_additive'
        ? 'Non-additive'
        : 'Unknown';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex cursor-default rounded-full border px-2 py-0.5 text-[10px] font-medium',
            ADDITIVITY_STYLE[sample.additivity] ?? ADDITIVITY_STYLE.unknown,
          )}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{sample.additivityReason || 'No rationale recorded.'}</TooltipContent>
    </Tooltip>
  );
}

export function MetricSnapshotTable({
  snapshots,
  className,
}: {
  snapshots: MetricSnapshot[];
  className?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (snapshots.length === 0) {
    return (
      <EmptyState
        icon={TableProperties}
        title="No metric snapshots"
        description="The agent records KPIs, table totals and filter results here when it finds number-shaped content on a page."
        className={className}
      />
    );
  }

  const ordered = [...snapshots].sort(
    (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
  );
  const selected = ordered.find((snapshot) => snapshot.id === selectedId) ?? ordered[0];

  return (
    <div className={cn('rounded-lg border border-border bg-card', className)}>
      <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <SectionLabel hint={`${snapshots.length} captured`}>Metric snapshots</SectionLabel>
          <p className="mono mt-1 truncate text-muted-foreground" title={selected.pageUrl}>
            {truncateMiddle(selected.pageUrl, 72)}
          </p>
        </div>
        {ordered.length > 1 ? (
          <Select
            value={selected.id}
            onValueChange={(value) => setSelectedId(value)}
          >
            <SelectTrigger className="w-full sm:w-64" aria-label="Select snapshot">
              <SelectValue placeholder="Select snapshot" />
            </SelectTrigger>
            <SelectContent>
              {ordered.map((snapshot) => (
                <SelectItem key={snapshot.id} value={snapshot.id}>
                  {`${formatDateTime(snapshot.capturedAt)} · ${snapshot.viewport} · ${snapshot.metrics.length} metrics`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        <Badge variant="outline" className="normal-case">
          {selected.viewport}
        </Badge>
        <span className="font-mono">{formatDateTime(selected.capturedAt)}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono">{selected.metrics.length} metrics</span>
        {selected.rowCount != null ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{formatNumber(selected.rowCount)} rows</span>
          </>
        ) : null}
        {selected.table ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-mono">
              table {selected.table.rowCount}×{selected.table.headers.length}
              {selected.table.paginationLabel ? ` · ${selected.table.paginationLabel}` : ''}
            </span>
          </>
        ) : null}
      </div>

      {selected.metrics.length === 0 ? (
        <p className="p-4 text-[12px] text-muted-foreground">
          This snapshot contains no numeric metrics.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Metric</TableHead>
              <TableHead>Displayed</TableHead>
              <TableHead className="hidden sm:table-cell">Parsed</TableHead>
              <TableHead className="hidden md:table-cell">Kind</TableHead>
              <TableHead>Additivity</TableHead>
              <TableHead className="hidden lg:table-cell">Scope</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {selected.metrics.map((sample) => (
              <TableRow key={`${selected.id}-${sample.key}`}>
                <TableCell className="max-w-[260px]">
                  <div className="truncate text-[12px] text-foreground" title={sample.label}>
                    {sample.label}
                  </div>
                  <div className="mono truncate text-[10px] text-muted-foreground" title={sample.key}>
                    {sample.key}
                  </div>
                </TableCell>
                <TableCell className="mono whitespace-nowrap">{formatMetricValue(sample)}</TableCell>
                <TableCell className="mono hidden whitespace-nowrap sm:table-cell">
                  {sample.value == null ? '—' : `${formatNumber(sample.value)}${sample.unit ? ` ${sample.unit}` : ''}`}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <span className="font-mono text-[11px] text-muted-foreground">{sample.kind}</span>
                </TableCell>
                <TableCell>
                  <AdditivityCell sample={sample} />
                </TableCell>
                <TableCell className="mono hidden text-[11px] text-muted-foreground lg:table-cell">
                  {sample.scope}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {selected.notes ? (
        <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">{selected.notes}</p>
      ) : null}
    </div>
  );
}
