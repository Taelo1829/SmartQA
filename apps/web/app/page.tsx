'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  ExternalLink,
  FileDown,
  Layers,
  Loader2,
  MousePointerClick,
  Radar,
  Radio,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SeverityBadge } from '@/components/severity-badge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';



const STEPS = [
  {
    icon: Code2,
    title: 'Paste a URL',
    body: 'Point the agent at a staging site and confirm you are authorised to test it. Budgets keep the blast radius small.',
  },
  {
    icon: Radio,
    title: 'Go live or background',
    body: 'Watch every click in the live console — or let the run execute headless and read the report when it lands.',
  },
  {
    icon: Radar,
    title: 'Watch it explore',
    body: 'Pages, filters, pagination and forms are exercised as a real user. Console errors and failed requests are captured.',
  },
  {
    icon: ClipboardCheck,
    title: 'Review and export',
    body: 'Findings arrive with severity, confidence, reproduction steps, screenshots and arithmetic validation. Export JSON or PDF.',
  },
];

const FEATURES = [
  {
    icon: MousePointerClick,
    title: 'Live takeover',
    body: 'Watch the browser in real time. Take control to clear a sign-in wall, then hand the run back to the agent without restarting it.',
  },
  {
    icon: Calculator,
    title: 'Filter & math validation',
    body: 'Filter combinations are planned and replayed, with additivity checks that compare a total against the sum of its parts.',
  },
  {
    icon: Layers,
    title: 'Evidence for every claim',
    body: 'Screenshots, console and network logs, DOM snapshots and traces are stored per finding — no finding without evidence.',
  },
  {
    icon: Terminal,
    title: 'Reproducible findings',
    body: 'Each finding is replayed a configurable number of times and ships with ordered reproduction steps and recorded actions.',
  },
  {
    icon: ShieldCheck,
    title: 'Honest coverage',
    body: 'Budgets, skipped elements and limitations are always listed. The console never claims complete coverage.',
  },
  {
    icon: FileDown,
    title: 'Reports that travel',
    body: 'A print-ready report, JSON export for tooling and a PDF for stakeholders, all generated from the same finding set.',
  },
];

const LOG_LINES = [
  { level: 'INF', text: 'Exploring /dashboard/sales', tone: 'text-slate-300' },
  { level: 'ACT', text: 'Filter “Region: EMEA” applied', tone: 'text-brand' },
  { level: 'CHK', text: 'Revenue total vs regional sum…', tone: 'text-violetBrand' },
  { level: 'ERR', text: 'Delta 2,325 above tolerance', tone: 'text-severity-critical' },
] as const;

function HeroConsole() {
  return (
    <div className="relative">
      <div className="absolute -inset-4 -z-10 rounded-2xl bg-brand/5 blur-2xl" aria-hidden="true" />
      <div className="rounded-xl border border-border bg-panel/90 p-3.5">
        <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-brand">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
            Running
          </span>
          <span className="mono text-[10px] text-muted-foreground">run_3f9a1c2b</span>
        </div>

        <p className="mono mt-2 truncate text-[11px] text-muted-foreground">
          app.staging.example.com/dashboard/sales
        </p>
        <Progress value={62} className="mt-2.5 h-1" />
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Deeper exploration</span>
          <span className="mono tabular-nums">62%</span>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          {[
            { label: 'Pages', value: '12' },
            { label: 'Actions', value: '47' },
            { label: 'Checks', value: '89' },
            { label: 'Findings', value: '3' },
          ].map((stat) => (
            <div key={stat.label} className="rounded border border-border bg-background/50 py-1.5">
              <p className="font-mono text-[13px] leading-none tabular-nums text-foreground">{stat.value}</p>
              <p className="mt-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          <SeverityBadge severity="critical" count={1} />
          <SeverityBadge severity="high" count={1} />
          <SeverityBadge severity="medium" count={1} />
          <SeverityBadge severity="low" count={0} className="opacity-40" />
          <SeverityBadge severity="info" count={0} className="opacity-40" />
        </div>

        <div className="mt-3 space-y-1 rounded border border-border bg-background/70 p-2 font-mono text-[10px] leading-relaxed">
          {LOG_LINES.map((line) => (
            <p key={line.text} className="flex gap-2">
              <span
                className={cn(
                  'shrink-0 font-semibold',
                  line.level === 'ERR' ? 'text-severity-critical' : 'text-muted-foreground',
                )}
              >
                {line.level}
              </span>
              <span className={cn('truncate', line.tone)}>{line.text}</span>
            </p>
          ))}
        </div>

        <div className="mt-3 rounded border border-severity-critical/30 bg-severity-critical/5 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-severity-critical">
              Critical finding
            </span>
            <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
              <Calculator className="h-2.5 w-2.5" /> arithmetic
            </span>
          </div>
          <p className="mt-1 text-[11px] font-medium leading-snug text-foreground">
            Revenue KPI does not equal the sum of regional totals
          </p>
          <p className="mono mt-1 text-[10px] text-muted-foreground">
            expected 184,320 · observed 181,995 · Δ 2,325
          </p>
        </div>
      </div>
    </div>
  );
}

function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md border border-brand/40 bg-brand/10 text-brand',
        className,
      )}
    >
      <Activity className="h-4 w-4" />
    </span>
  );
}

function HeadingSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking your session…
      </div>
    </div>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<'checking' | 'anonymous' | 'authenticated'>('checking');

  useEffect(() => {
    let alive = true;
    api
      .me({ redirectOnUnauthorized: false })
      .then(() => {
        if (!alive) return;
        setAuthState('authenticated');
        router.replace('/runs');
      })
      .catch(() => {
        if (alive) setAuthState('anonymous');
      });
    return () => {
      alive = false;
    };
  }, [router]);

  if (authState !== 'anonymous') return <HeadingSkeleton />;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex items-center gap-2">
            <Logo />
            <span className="text-[13px] font-semibold tracking-tight">SmartQA</span>
            <span className="hidden rounded border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-muted-foreground sm:inline">
              control room
            </span>
          </Link>
          <nav className="hidden items-center gap-4 text-[12px] text-muted-foreground sm:flex">
            <a href="#how" className="hover:text-foreground">
              How it works
            </a>
            <a href="#features" className="hover:text-foreground">
              Capabilities
            </a>
            <Link href="/runs/new" className="hover:text-foreground">
              New test
            </Link>
          </nav>
          <div className="flex items-center gap-1.5">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild variant="brand" size="sm">
              <Link href="/runs">
                Launch console
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_0%,rgba(34,211,238,0.12),transparent_70%)]"
            aria-hidden="true"
          />
          <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:py-20">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-brand">
                <Sparkles className="h-3 w-3" />
                Autonomous QA agent
              </span>
              <h1 className="balance mt-4 text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl lg:text-[44px]">
                Test any web app like a{' '}
                <span className="text-brand">relentless QA engineer</span>.
              </h1>
              <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-muted-foreground sm:text-sm">
                SmartQA drives a real browser through your site, exercises filters and forms, replays
                failures and validates the numbers on screen. You get evidence-backed findings — and an
                honest statement of what was not covered.
              </p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                <Button asChild variant="brand" size="lg">
                  <Link href="/runs">
                    Launch the console
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/runs/new">
                    Test a website
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  Deterministic arithmetic checks
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  Bounded budgets by default
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  Coverage limitations always surfaced
                </span>
              </div>
            </div>
            <HeroConsole />
          </div>
        </section>

        <section id="how" className="border-b border-border">
          <div className="mx-auto w-full max-w-6xl px-4 py-14">
            <div className="max-w-2xl">
              <p className="section-label">How it works</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">From URL to evidence in four steps</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                No test scripts to write. You define the bounds, the agent decides what to exercise, and
                everything it claims is backed by captured evidence.
              </p>
            </div>
            <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="relative rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md border border-brand/30 bg-brand/10 text-brand">
                      <step.icon className="h-4 w-4" />
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground/60">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-3 text-[13px] font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="features" className="border-b border-border">
          <div className="mx-auto w-full max-w-6xl px-4 py-14">
            <div className="max-w-2xl">
              <p className="section-label">Capabilities</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                Built for people who have to trust the report
              </h2>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <article
                  key={feature.title}
                  className="rounded-lg border border-border bg-card bg-card-sheen bg-no-repeat p-4"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/60 text-violetBrand">
                    <feature.icon className="h-4 w-4" />
                  </span>
                  <h3 className="mt-3 text-[13px] font-semibold">{feature.title}</h3>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-border">
          <div className="mx-auto w-full max-w-6xl px-4 py-12">
            <div className="relative overflow-hidden rounded-xl border border-border bg-panel p-6 sm:p-8">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_120%_at_100%_0%,rgba(167,139,250,0.14),transparent_60%)]" aria-hidden="true" />
              <div className="relative flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Point it at a URL you can test</h2>
                  <p className="mt-1.5 max-w-xl text-[12px] leading-relaxed text-muted-foreground">
                    Enter any authorized website URL, confirm you can test it, and start a live or
                    background run. The agent explores like a user and reports evidence-backed findings.
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <Button asChild variant="brand">
                    <Link href="/runs/new">
                      <ScanSearch className="h-4 w-4" />
                      Start a test run
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/login">Sign in</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 py-8 text-[11px] text-muted-foreground">
        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-2">
            <Logo className="h-5 w-5" />
            SmartQA — autonomous website testing
          </span>
          <span className="mono">test sites you are authorized to assess</span>
        </div>
      </footer>
    </div>
  );
}
