'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { HealthResponse } from '@smartqa/shared/types';
import {
  Activity,
  LayoutList,
  LogOut,
  Menu,
  PlusCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiData } from '@/lib/use-api-data';
import { cn } from '@/lib/utils';



interface HealthIndicatorProps {
  data: HealthResponse | null;
  error: string | null;
  loading: boolean;
  onRetry: () => void;
  compact?: boolean;
}

function HealthIndicator({ data, error, loading, onRetry, compact = false }: HealthIndicatorProps) {
  const healthy = data?.ok === true;
  const label = error ? 'API offline' : data ? (healthy ? 'API healthy' : 'API degraded') : 'Checking API…';
  const dotClassName = error
    ? 'bg-severity-critical'
    : data
      ? healthy
        ? 'bg-success'
        : 'bg-severity-medium'
      : 'bg-muted-foreground';

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onRetry}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/50"
            aria-label={`${label}. Re-check API health.`}
          >
            <span className={cn('h-2 w-2 rounded-full', dotClassName, healthy && 'animate-pulse')} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onRetry}
          className="flex w-full items-center gap-2 rounded-md border border-border bg-background/50 px-2 py-1.5 text-left transition-colors hover:border-brand/30"
        >
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClassName, healthy && 'animate-pulse')} />
          <span className="flex-1 truncate text-[11px] text-muted-foreground">{label}</span>
          {loading ? (
            <RefreshCw className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
          ) : data ? (
            <span className="mono shrink-0 text-[10px] text-muted-foreground/80">v{data.version}</span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="w-72">
        {error ? (
          <p className="text-severity-critical">{error}</p>
        ) : data ? (
          <div className="space-y-1">
            <p className="font-medium text-foreground">{label}</p>
            <p>storage · {data.storage}</p>
            <p>queue · {data.queue}</p>
            <p>ai · {data.ai ? 'enabled' : 'disabled'}</p>
            <p>checked · {formatDateTime(data.time)}</p>
            {Object.entries(data.checks).map(([key, check]) => (
              <p key={key} className={check.ok ? 'text-success' : 'text-severity-critical'}>
                {key}: {check.ok ? 'ok' : 'fail'} — {check.detail}
              </p>
            ))}
          </div>
        ) : (
          <p>Contacting the API…</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function UserFooter() {
  const { data, error } = useApiData((signal) => api.me({ signal }), []);
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await api.logout();
    } catch {
      // Even if the revoke call fails, drop the local session view.
    } finally {
      window.location.assign('/login');
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-2 py-1.5">
        <span className="text-[11px] text-muted-foreground">Session expired</span>
        <Link href="/login" className="text-[11px] font-medium text-brand hover:underline">
          Sign in
        </Link>
      </div>
    );
  }

  const user = data?.user;
  const initial = user?.name?.trim().charAt(0).toUpperCase() || 'Q';

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-2 py-1.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand/30 bg-brand/10 font-mono text-[10px] text-brand">
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-foreground">{user?.name ?? 'Operator'}</p>
        <p className="truncate text-[10px] text-muted-foreground">{user?.email ?? 'session loading…'}</p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => void signOut()}
        disabled={signingOut}
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-brand/40 bg-brand/10 text-brand',
        className,
      )}
    >
      <Activity className="relative h-4 w-4" />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brand/70 to-transparent" />
    </span>
  );
}

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutList;
  external?: boolean;
  isActive: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Runs',
    href: '/runs',
    icon: LayoutList,
    isActive: (pathname) => pathname === '/runs' || (pathname.startsWith('/runs/') && pathname !== '/runs/new'),
  },
  {
    label: 'New test',
    href: '/runs/new',
    icon: PlusCircle,
    isActive: (pathname) => pathname === '/runs/new',
  },

];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const active = item.isActive(pathname);
        const className = cn(
          'flex items-center gap-2 rounded-md border px-2.5 py-2 text-[12px] transition-colors',
          active
            ? 'border-brand/30 bg-brand/10 text-brand'
            : 'border-transparent text-muted-foreground hover:border-border hover:bg-accent/60 hover:text-foreground',
        );
        const Icon = item.icon;
        if (item.external) {
          return (
            <a
              key={item.label}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className={className}
              onClick={onNavigate}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{item.label}</span>
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          );
        }
        return (
          <Link
            key={item.label}
            href={item.href}
            className={className}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {active ? <span className="h-1 w-1 rounded-full bg-brand" /> : null}
          </Link>
        );
      })}
    </>
  );
}

export interface ShellProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function Shell({ title, subtitle, actions, children }: ShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const health = useApiData((signal) => api.health(signal), [], { pollMs: 30_000 });

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-border bg-panel md:flex print:hidden">
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-3.5">
          <LogoMark />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-none">SmartQA</p>
            <p className="mt-1 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              QA control room
            </p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2.5">
          <p className="px-2 pb-1.5 pt-1 text-[9px] uppercase tracking-[0.18em] text-muted-foreground/60">
            Console
          </p>
          <NavLinks pathname={pathname} />
        </nav>
        <div className="space-y-2 border-t border-border p-2.5">
          <HealthIndicator
            data={health.data}
            error={health.error}
            loading={health.fetching}
            onRetry={health.reload}
          />
          <UserFooter />
        </div>
      </aside>

      <header className="sticky top-0 z-40 border-b border-border bg-panel/95 backdrop-blur md:hidden print:hidden">
        <div className="flex h-12 items-center justify-between gap-2 px-3">
          <Link href="/runs" className="flex items-center gap-2">
            <LogoMark />
            <span className="text-[13px] font-semibold">SmartQA</span>
          </Link>
          <div className="flex items-center gap-1.5">
            <HealthIndicator
              compact
              data={health.data}
              error={health.error}
              loading={health.fetching}
              onRetry={health.reload}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen((open) => !open)}
              aria-expanded={mobileOpen}
              aria-label="Toggle navigation"
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        {mobileOpen ? (
          <div className="border-t border-border p-2.5">
            <nav className="space-y-1">
              <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </nav>
            <div className="mt-2 space-y-2 border-t border-border pt-2">
              <HealthIndicator
                data={health.data}
                error={health.error}
                loading={health.fetching}
                onRetry={health.reload}
              />
              <UserFooter />
            </div>
          </div>
        ) : null}
      </header>

      <div className="md:pl-56">
        <header className="sticky top-0 z-30 hidden border-b border-border bg-background/85 backdrop-blur md:block print:hidden">
          <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-start justify-between gap-3 px-6 py-3">
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold leading-tight">{title}</h1>
              {subtitle ? (
                <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div>
              ) : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        </header>

        <div className="border-b border-border bg-background/70 px-4 py-3 md:hidden print:hidden">
          <h1 className="text-[14px] font-semibold leading-tight">{title}</h1>
          {subtitle ? <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div> : null}
          {actions ? <div className="mt-2 flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>

        <main className="mx-auto w-full max-w-[1400px] px-4 py-4 md:px-6 md:py-6 print:max-w-none print:px-0 print:py-0">
          {children}
        </main>
      </div>
    </div>
  );
}
