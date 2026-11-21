import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw, type LucideIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function SectionLabel({
  children,
  hint,
  action,
  className,
}: {
  children: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2', className)}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {children}
        </h2>
        {hint ? <span className="text-[11px] text-muted-foreground/70">{hint}</span> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-panel/40 px-5 py-10 text-center',
        className,
      )}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/60 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="space-y-1">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-md text-[12px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Could not load this view',
  message,
  onRetry,
  retrying = false,
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <Alert variant="destructive" className={cn('items-start', className)}>
      <AlertTriangle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span className="text-foreground/80">{message}</span>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying} className="w-fit">
            {retrying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Retry
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export function LoadingPanel({
  label = 'Loading',
  rows = 3,
  className,
}: {
  label?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-panel/60 p-4', className)} role="status">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {label}
      </div>
      <div className="mt-3 space-y-2">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton
            key={index}
            className={cn('h-3', index === rows - 1 ? 'w-2/3' : index === 0 ? 'w-full' : 'w-5/6')}
          />
        ))}
      </div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'brand' | 'success' | 'danger' | 'warning';
  className?: string;
}) {
  const toneClass =
    tone === 'brand'
      ? 'text-brand'
      : tone === 'success'
        ? 'text-success'
        : tone === 'danger'
          ? 'text-severity-critical'
          : tone === 'warning'
            ? 'text-severity-medium'
            : 'text-foreground';
  return (
    <div className={cn('rounded-lg border border-border bg-panel/60 px-3 py-2.5', className)}>
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={cn('mt-1 font-mono text-lg leading-none text-tabular', toneClass)}>{value}</div>
      {hint ? <div className="mt-1.5 text-[11px] leading-tight text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4', className)}>{children}</div>
  );
}
