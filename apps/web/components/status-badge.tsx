import type { RunStatus } from '@smartqa/shared/types';
import { STATUS_META } from '@/lib/format';
import { cn } from '@/lib/utils';

export function StatusDot({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn('relative inline-flex h-1.5 w-1.5 shrink-0 rounded-full', meta.dot, className)}
      aria-hidden="true"
    >
      {meta.pulse ? (
        <span className={cn('absolute inset-0 animate-pulse-ring rounded-full', meta.dot)} />
      ) : null}
    </span>
  );
}

export function StatusBadge({
  status,
  className,
  showDot = true,
}: {
  status: RunStatus;
  className?: string;
  showDot?: boolean;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-normal',
        meta.badge,
        className,
      )}
    >
      {showDot ? <StatusDot status={status} /> : null}
      {meta.label}
    </span>
  );
}
