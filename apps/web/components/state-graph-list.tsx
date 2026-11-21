import type { ActionRecord, PageState } from '@smartqa/shared/types';
import { Camera, Layers, MousePointerClick, Route } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState, StatGrid, StatTile } from '@/components/states';
import { formatDateTime, formatNumber, truncateMiddle } from '@/lib/format';
import { cn } from '@/lib/utils';

export function StateGraphList({
  pages,
  actions,
  className,
}: {
  pages: PageState[];
  actions?: ActionRecord[];
  className?: string;
}) {
  if (pages.length === 0) {
    return (
      <EmptyState
        icon={Route}
        title="No pages explored yet"
        description="Once the agent starts navigating, every page state it discovers is listed here with depth and visit counts."
        className={className}
      />
    );
  }

  const ordered = [...pages].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.normalizedUrl.localeCompare(b.normalizedUrl);
  });

  const visited = pages.filter((page) => page.visitedAt != null).length;
  const maxDepth = pages.reduce((max, page) => Math.max(max, page.depth), 0);
  const totalVisits = pages.reduce((sum, page) => sum + page.visitCount, 0);
  const actionsByPage = new Map<string, number>();
  for (const action of actions ?? []) {
    actionsByPage.set(action.pageStateId, (actionsByPage.get(action.pageStateId) ?? 0) + 1);
  }

  return (
    <div className={cn('space-y-3', className)}>
      <StatGrid className="lg:grid-cols-4">
        <StatTile label="Pages tested" value={formatNumber(visited)} hint={`${formatNumber(pages.length)} discovered`} tone="brand" />
        <StatTile label="Max depth" value={formatNumber(maxDepth)} hint="Hops from the entry URL" />
        <StatTile
          label="Total visits"
          value={formatNumber(totalVisits)}
          hint={`${formatNumber(pages.filter((page) => page.visitCount > 1).length)} pages revisited`}
        />
        <StatTile
          label="Interactive elements"
          value={formatNumber(pages.reduce((sum, page) => sum + page.interactiveCount, 0))}
          hint="Discovered across states"
        />
      </StatGrid>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="divide-y divide-border">
          {ordered.map((page) => {
            const actionCount = actionsByPage.get(page.id) ?? 0;
            const isVisited = page.visitedAt != null;
            return (
              <div
                key={page.id}
                className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-accent/30"
                style={{ paddingLeft: `${Math.min(page.depth, 4) * 10 + 12}px` }}
              >
                <span className="mt-0.5 flex h-6 w-9 shrink-0 items-center justify-center rounded border border-border bg-background/60 font-mono text-[10px] text-muted-foreground">
                  D{page.depth}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[12px] font-medium text-foreground" title={page.title}>
                      {page.title || '(untitled page)'}
                    </span>
                    {!isVisited ? (
                      <Badge variant="muted" className="text-[10px]">
                        not visited
                      </Badge>
                    ) : null}
                    {page.skeleton ? (
                      <Badge variant="warning" className="text-[10px]">
                        skeleton
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mono mt-0.5 truncate text-muted-foreground" title={page.url}>
                    {truncateMiddle(page.url, 96)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1 font-mono" title="Visit count">
                    <Layers className="h-3 w-3" />×{page.visitCount}
                  </span>
                  <span
                    className="hidden items-center gap-1 font-mono sm:inline-flex"
                    title="Interactive elements discovered"
                  >
                    <MousePointerClick className="h-3 w-3" />
                    {page.interactiveCount}
                  </span>
                  {actions ? (
                    <span className="hidden items-center gap-1 font-mono md:inline-flex" title="Actions executed on this page">
                      {actionCount} act
                    </span>
                  ) : null}
                  {page.screenshotId ? (
                    <span title="Screenshot captured" className="text-brand">
                      <Camera className="h-3 w-3" />
                    </span>
                  ) : null}
                  {isVisited ? (
                    <span className="hidden font-mono text-[10px] lg:inline" title="Last visited">
                      {formatDateTime(page.visitedAt)}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
