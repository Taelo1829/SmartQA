'use client';

import { useState } from 'react';
import type { Evidence, EvidenceRef } from '@smartqa/shared/types';
import { FileJson, FileText, Image as ImageIcon, Maximize2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/states';
import { evidenceUrl } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

export type EvidenceItem = Evidence | EvidenceRef;

const IMAGE_KINDS: ReadonlySet<string> = new Set(['screenshot', 'full_page_screenshot']);

function isImage(item: EvidenceItem): boolean {
  return IMAGE_KINDS.has(item.kind) || item.contentType.startsWith('image/');
}

function sizeOf(item: EvidenceItem): number | null {
  return 'sizeBytes' in item ? item.sizeBytes : null;
}

export function EvidenceGrid({
  runId,
  items,
  emptyLabel = 'No screenshots or artefacts were captured for this context.',
  className,
}: {
  runId: string;
  items: EvidenceItem[];
  emptyLabel?: string;
  className?: string;
}) {
  const [active, setActive] = useState<EvidenceItem | null>(null);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ImageIcon}
        title="No evidence"
        description={emptyLabel}
        className={cn('py-6', className)}
      />
    );
  }

  return (
    <>
      <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4', className)}>
        {items.map((item) =>
          isImage(item) ? (
            <button
              key={item.id}
              type="button"
              onClick={() => setActive(item)}
              className="group overflow-hidden rounded-md border border-border bg-background/60 text-left transition-colors hover:border-brand/50 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Open evidence: ${item.label}`}
            >
              <span className="relative block">
                <img
                  src={evidenceUrl(runId, item.id)}
                  alt={item.label}
                  loading="lazy"
                  className="h-24 w-full object-cover"
                />
                <span className="absolute right-1.5 top-1.5 rounded bg-black/70 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <Maximize2 className="h-3 w-3" />
                </span>
              </span>
              <span className="block truncate px-2 py-1.5 text-[10px] text-muted-foreground">
                {item.label}
              </span>
            </button>
          ) : (
            <a
              key={item.id}
              href={evidenceUrl(runId, item.id)}
              target="_blank"
              rel="noreferrer"
              download
              className="flex min-h-[74px] flex-col justify-between gap-2 rounded-md border border-border bg-background/60 p-2 transition-colors hover:border-brand/50"
            >
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {item.contentType.includes('json') ? (
                  <FileJson className="h-3.5 w-3.5" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                <span className="truncate text-[11px] text-foreground/90">{item.label}</span>
              </span>
              <span className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                <span className="truncate">{item.kind}</span>
                {sizeOf(item) != null ? <span className="shrink-0">{formatBytes(sizeOf(item))}</span> : null}
              </span>
            </a>
          ),
        )}
      </div>

      <Dialog
        open={active != null}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
      >
        <DialogContent className="max-w-5xl">
          <DialogTitle className="text-[12px] font-medium">{active?.label ?? 'Evidence'}</DialogTitle>
          {active && isImage(active) ? (
            <img
              src={evidenceUrl(runId, active.id)}
              alt={active.label}
              className="max-h-[72vh] w-full rounded-md border border-border bg-black object-contain"
            />
          ) : null}
          {active ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="mono">
                {active.kind} · {active.contentType}
                {sizeOf(active) != null ? ` · ${formatBytes(sizeOf(active))}` : ''}
              </span>
              <a
                href={evidenceUrl(runId, active.id)}
                target="_blank"
                rel="noreferrer"
                className="text-brand hover:underline"
              >
                Open original
              </a>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
