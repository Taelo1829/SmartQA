'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Activity, ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import { LoginForm } from '@/components/login-form';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .me({ redirectOnUnauthorized: false })
      .then(() => {
        if (!alive) return;
        router.replace('/runs');
      })
      .catch(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="hero-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(34,211,238,0.10),transparent_70%)]"
        aria-hidden="true"
      />

      <div className="relative flex items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-brand/40 bg-brand/10 text-brand">
            <Activity className="h-4 w-4" />
          </span>
          <span className="text-[13px] font-semibold">SmartQA</span>
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to overview
        </Link>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
          <div className="rounded-xl border border-border bg-panel/95 p-5 sm:p-6">
            <div className="mb-5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <ShieldCheck className="h-3 w-3 text-brand" />
                Operator access
              </span>
              <h1 className="mt-3 text-lg font-semibold tracking-tight">Sign in to the control room</h1>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                Run lists, live browser sessions and evidence are scoped to your account.
              </p>
            </div>

            {checking ? (
              <div className="flex items-center gap-2 py-10 text-[12px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking your session…
              </div>
            ) : (
              <LoginForm />
            )}
          </div>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
            Testing a site requires explicit authorisation. The agent blocks destructive actions unless
            you opt in per run.
          </p>
        </div>
      </div>
    </div>
  );
}
