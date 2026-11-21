'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicUser } from '@smartqa/shared/types';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiClientError, api } from '@/lib/api';

// Bootstrap credentials can be configured via BOOTSTRAP_EMAIL / BOOTSTRAP_PASSWORD.

export function LoginForm({ onAuthenticated }: { onAuthenticated?: (user: PublicUser) => void }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || password.length === 0) {
      setError('Enter both your email and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.login({ email: email.trim(), password });
      onAuthenticated?.(result.user);
      router.replace('/runs');
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiClientError
          ? cause.message
          : 'Sign-in failed. Check the API is running and try again.',
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
        {error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Could not sign in</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              className="pl-8"
              aria-invalid={Boolean(error)}
              disabled={submitting}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="px-8"
              aria-invalid={Boolean(error)}
              disabled={submitting}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <Button type="submit" variant="brand" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? 'Signing in…' : 'Sign in to console'}
          {!submitting ? <ArrowRight className="h-3.5 w-3.5" /> : null}
        </Button>
      </form>


      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Use the bootstrap account from your environment on first sign-in, or register a new account.
      </p>
    </div>
  );
}
