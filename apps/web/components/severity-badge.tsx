import type { Severity } from '@smartqa/shared/types';
import { SEVERITY_BADGE, SEVERITY_DOT, SEVERITY_LABEL } from '@/lib/format';
import { cn } from '@/lib/utils';

export function SeverityDot({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', SEVERITY_DOT[severity], className)}
      aria-hidden="true"
    />
  );
}

export function SeverityBadge({
  severity,
  count,
  className,
}: {
  severity: Severity;
  count?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase leading-normal tracking-wide',
        SEVERITY_BADGE[severity],
        className,
      )}
    >
      <SeverityDot severity={severity} />
      {SEVERITY_LABEL[severity]}
      {count != null ? <span className="font-mono text-[11px] tabular-nums opacity-90">{count}</span> : null}
    </span>
  );
}
