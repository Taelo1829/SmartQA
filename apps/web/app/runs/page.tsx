'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isTerminalStatus, RUN_STATUSES } from '@smartqa/shared/types';
import type { RunMode, RunStatus } from '@smartqa/shared/types';
import { ListChecks, Plus, RefreshCw, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { RunCard } from '@/components/run-card';
import { Shell } from '@/components/shell';
import { EmptyState, ErrorState } from '@/components/states';
import { api } from '@/lib/api';
import { STATUS_META } from '@/lib/format';
import { useApiData } from '@/lib/use-api-data';
import { cn } from '@/lib/utils';

const STATUS_OPTIONS: Array<{ value: RunStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  ...RUN_STATUSES.map((status) => ({ value: status, label: STATUS_META[status].label })),
];

const MODE_OPTIONS: Array<{ value: RunMode | 'all'; label: string }> = [
  { value: 'all', label: 'All modes' },
  { value: 'live', label: 'Live' },
  { value: 'background', label: 'Background' },
];

function RunCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-12" />
      </div>
      <Skeleton className="mt-3 h-3 w-3/4" />
      <Skeleton className="mt-3 h-1 w-full" />
      <div className="mt-3 flex gap-1">
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  );
}

export default function RunsPage() {
  const [statusFilter, setStatusFilter] = useState<RunStatus | 'all'>('all');
  const [modeFilter, setModeFilter] = useState<RunMode | 'all'>('all');
  const [pollMs, setPollMs] = useState<number | null>(null);

  const runsQuery = useApiData(
    (signal) => api.listRuns({ limit: 50, status: statusFilter, mode: modeFilter }, signal),
    [statusFilter, modeFilter],
    { pollMs },
  );

  const runs = runsQuery.data?.runs ?? [];
  const hasActiveRun = runs.some((run) => !isTerminalStatus(run.status));
  const hasFilters = statusFilter !== 'all' || modeFilter !== 'all';

  useEffect(() => {
    setPollMs(hasActiveRun ? 3_000 : null);
  }, [hasActiveRun]);

  const clearFilters = () => {
    setStatusFilter('all');
    setModeFilter('all');
  };

  return (
    <Shell
      title="Test runs"
      subtitle="Autonomous runs against your sites, newest first."
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={runsQuery.reload}
            disabled={runsQuery.fetching && runs.length > 0}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', runsQuery.fetching && runs.length > 0 && 'animate-spin')} />
            Refresh
          </Button>
          <Button asChild variant="brand" size="sm">
            <Link href="/runs/new">
              <Plus className="h-3.5 w-3.5" />
              New test
            </Link>
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
          <div className="w-full sm:w-44">
            <Label htmlFor="status-filter" className="mb-1.5 block">
              Status
            </Label>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as RunStatus | 'all')}
            >
              <SelectTrigger id="status-filter">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-44">
            <Label htmlFor="mode-filter" className="mb-1.5 block">
              Mode
            </Label>
            <Select
              value={modeFilter}
              onValueChange={(value) => setModeFilter(value as RunMode | 'all')}
            >
              <SelectTrigger id="mode-filter">
                <SelectValue placeholder="All modes" />
              </SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-2 pb-1 text-[11px] text-muted-foreground">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                hasActiveRun ? 'animate-pulse bg-brand' : 'bg-muted-foreground/60',
              )}
            />
            {hasActiveRun ? 'Auto-refreshing every 3s' : 'No active runs'}
            {runsQuery.data ? (
              <span className="font-mono tabular-nums text-muted-foreground/80">
                · {runsQuery.data.total} total
              </span>
            ) : null}
          </div>
        </div>

        {runsQuery.error && runs.length === 0 ? (
          <ErrorState
            title="Could not load runs"
            message={runsQuery.error}
            onRetry={runsQuery.reload}
            retrying={runsQuery.fetching}
          />
        ) : runsQuery.loading && runs.length === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <RunCardSkeleton key={index} />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <EmptyState
            icon={hasFilters ? SearchX : ListChecks}
            title={hasFilters ? 'No runs match these filters' : 'No test runs yet'}
            description={
              hasFilters
                ? 'Try a different status or mode, or clear the filters to see every run.'
                : 'Start an autonomous test against your staging site. A live run opens the browser console immediately; a background run reports back when it finishes.'
            }
            action={
              hasFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button asChild variant="brand" size="sm">
                  <Link href="/runs/new">
                    <Plus className="h-3.5 w-3.5" />
                    Start your first test
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <>
            {runsQuery.error ? (
              <ErrorState
                title="Refresh failed"
                message={`${runsQuery.error} Showing the last successful result.`}
                onRetry={runsQuery.reload}
                retrying={runsQuery.fetching}
              />
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {runs.map((run) => (
                <RunCard key={run.id} run={run} />
              ))}
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
