import { SEVERITY_ORDER } from '@smartqa/shared/types';
import type {
  Confidence,
  FindingStatus,
  MetricSample,
  RunStatus,
  Severity,
} from '@smartqa/shared/types';

const DASH = '—';

export function formatDuration(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return DASH;
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.round(ms / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Stopwatch-style duration for live timers, e.g. `04:21` or `1:04:21`. */
export function formatClock(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return DASH;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return DASH;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return formatDateTime(iso);
  const seconds = Math.floor(diffMs / 1_000);
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateTime(iso);
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatDateTime(iso?: string | null): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  return dateTimeFormatter.format(date);
}

export function formatTime(iso?: string | null): string {
  if (!iso) return '--:--:--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return timeFormatter.format(date);
}

export function formatNumber(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

export function formatCompactNumber(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

export function percentOf(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((part / total) * 100)));
}

export function formatPercent(part: number, total: number): string {
  return `${percentOf(part, total)}%`;
}

export function formatPercentValue(value?: number | null, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return `${value.toFixed(digits)}%`;
}

export function formatBytes(bytes?: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return DASH;
  if (bytes < 1_024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1_024;
  let unitIndex = 0;
  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

/** Prefer the sampled raw text so the UI never re-rounds a reported number. */
export function formatMetricValue(sample: MetricSample): string {
  if (sample.rawText.trim().length > 0) return sample.rawText;
  if (sample.value == null || !Number.isFinite(sample.value)) return DASH;
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(sample.value);
  return sample.unit ? `${number} ${sample.unit}` : number;
}

export function truncateMiddle(value: string, max = 64): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

export function severityRank(severity: Severity): number {
  return SEVERITY_ORDER[severity];
}

export function calculationVerdict(
  delta: number | null,
  tolerance: number,
): 'within_tolerance' | 'outside_tolerance' | 'unknown' {
  if (delta == null || !Number.isFinite(delta)) return 'unknown';
  return Math.abs(delta) <= Math.abs(tolerance) ? 'within_tolerance' : 'outside_tolerance';
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

export const SEVERITY_TEXT: Record<Severity, string> = {
  critical: 'text-severity-critical',
  high: 'text-severity-high',
  medium: 'text-severity-medium',
  low: 'text-severity-low',
  info: 'text-severity-info',
};

export const SEVERITY_BADGE: Record<Severity, string> = {
  critical: 'border-severity-critical/40 bg-severity-critical/10 text-severity-critical',
  high: 'border-severity-high/40 bg-severity-high/10 text-severity-high',
  medium: 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium',
  low: 'border-severity-low/40 bg-severity-low/10 text-severity-low',
  info: 'border-severity-info/40 bg-severity-info/10 text-severity-info',
};

export const SEVERITY_DOT: Record<Severity, string> = {
  critical: 'bg-severity-critical',
  high: 'bg-severity-high',
  medium: 'bg-severity-medium',
  low: 'bg-severity-low',
  info: 'bg-severity-info',
};

export const SEVERITY_BAR: Record<Severity, string> = {
  critical: 'bg-severity-critical',
  high: 'bg-severity-high',
  medium: 'bg-severity-medium',
  low: 'bg-severity-low',
  info: 'bg-severity-info',
};

export const SEVERITY_HEX: Record<Severity, string> = {
  critical: '#f87171',
  high: '#fb923c',
  medium: '#fbbf24',
  low: '#60a5fa',
  info: '#94a3b8',
};

export interface StatusMeta {
  label: string;
  badge: string;
  dot: string;
  pulse: boolean;
}

export const STATUS_META: Record<RunStatus, StatusMeta> = {
  queued: {
    label: 'Queued',
    badge: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
    dot: 'bg-slate-400',
    pulse: false,
  },
  preparing: {
    label: 'Preparing',
    badge: 'border-violetBrand/40 bg-violetBrand/10 text-violetBrand',
    dot: 'bg-violetBrand',
    pulse: true,
  },
  awaiting_login: {
    label: 'Awaiting sign-in',
    badge: 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium',
    dot: 'bg-severity-medium',
    pulse: true,
  },
  running: {
    label: 'Running',
    badge: 'border-brand/40 bg-brand/10 text-brand',
    dot: 'bg-brand',
    pulse: true,
  },
  paused: {
    label: 'Paused',
    badge: 'border-severity-high/40 bg-severity-high/10 text-severity-high',
    dot: 'bg-severity-high',
    pulse: false,
  },
  finalizing: {
    label: 'Finalizing',
    badge: 'border-violetBrand/40 bg-violetBrand/10 text-violetBrand',
    dot: 'bg-violetBrand',
    pulse: true,
  },
  completed: {
    label: 'Completed',
    badge: 'border-success/40 bg-success/10 text-success',
    dot: 'bg-success',
    pulse: false,
  },
  failed: {
    label: 'Failed',
    badge: 'border-severity-critical/40 bg-severity-critical/10 text-severity-critical',
    dot: 'bg-severity-critical',
    pulse: false,
  },
  cancelled: {
    label: 'Cancelled',
    badge: 'border-muted-foreground/40 bg-muted/60 text-muted-foreground',
    dot: 'bg-muted-foreground',
    pulse: false,
  },
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  confirmed: 'Confirmed',
  probable: 'Probable',
  suspected: 'Suspected',
};

export const CONFIDENCE_BADGE: Record<Confidence, string> = {
  confirmed: 'border-success/40 bg-success/10 text-success',
  probable: 'border-brand/40 bg-brand/10 text-brand',
  suspected: 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium',
};

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  reproducible: 'Reproducible',
  intermittent: 'Intermittent',
  suspected: 'Suspected',
  not_reproduced: 'Not reproduced',
  open: 'Open',
};

export const FINDING_STATUS_BADGE: Record<FindingStatus, string> = {
  reproducible: 'border-success/40 bg-success/10 text-success',
  intermittent: 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium',
  suspected: 'border-violetBrand/40 bg-violetBrand/10 text-violetBrand',
  not_reproduced: 'border-muted-foreground/40 bg-muted/60 text-muted-foreground',
  open: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
};

export const LOG_LEVEL_CLASS: Record<'debug' | 'info' | 'warn' | 'error', string> = {
  debug: 'text-muted-foreground',
  info: 'text-slate-200',
  warn: 'text-severity-medium',
  error: 'text-severity-critical',
};

export const LOG_LEVEL_LABEL: Record<'debug' | 'info' | 'warn' | 'error', string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
};
