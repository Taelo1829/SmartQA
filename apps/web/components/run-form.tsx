'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { ExplorationFocus, RunMode, ViewportName } from '@smartqa/shared/types';
import { BUDGET_LIMITS, DEFAULT_BUDGETS } from '@smartqa/shared/types';
import {
  AlertTriangle,
  ArrowRight,
  Gauge,
  Loader2,
  Monitor,
  Radio,
  ShieldAlert,
  Shuffle,
  Wand2,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ApiClientError, api, type CreateRunRequest } from '@/lib/api';
import { cn } from '@/lib/utils';

const MAX_SEED = 2 ** 31 - 1;

const FOCUS_OPTIONS: Array<{ value: ExplorationFocus; label: string }> = [
  { value: 'full', label: 'Full exploration' },
  { value: 'navigation', label: 'Navigation & links' },
  { value: 'dashboard', label: 'Dashboards & metrics' },
  { value: 'forms', label: 'Forms & validation' },
];

type ErrorKey =
  | 'url'
  | 'viewports'
  | 'maxPages'
  | 'maxActions'
  | 'maxDepth'
  | 'maxFilterCombinations'
  | 'maxDurationMinutes'
  | 'seed'
  | 'reproductionAttempts'
  | 'notes'
  | 'authorization'
  | 'form';

type FormErrors = Partial<Record<ErrorKey, string>>;

interface FormValues {
  url: string;
  mode: RunMode;
  requireAuth: boolean;
  viewports: ViewportName[];
  focus: ExplorationFocus;
  maxPages: string;
  maxActions: string;
  maxDepth: string;
  maxFilterCombinations: string;
  maxDurationMinutes: string;
  seed: string;
  reproductionAttempts: string;
  captureScreenshots: boolean;
  recordTrace: boolean;
  allowDestructiveActions: boolean;
  notes: string;
  authorizationConfirmed: boolean;
}

const DURATION_MIN_MINUTES = Math.ceil(BUDGET_LIMITS.maxDurationMs.min / 60_000);
const DURATION_MAX_MINUTES = Math.floor(BUDGET_LIMITS.maxDurationMs.max / 60_000);

const INITIAL_VALUES: FormValues = {
  url: '',
  mode: 'live',
  requireAuth: false,
  viewports: ['desktop', 'mobile'],
  focus: 'full',
  maxPages: String(BUDGET_LIMITS.maxPages.max),
  maxActions: String(BUDGET_LIMITS.maxActions.max),
  maxDepth: String(BUDGET_LIMITS.maxDepth.max),
  maxFilterCombinations: String(BUDGET_LIMITS.maxFilterCombinations.max),
  maxDurationMinutes: String(DURATION_MAX_MINUTES),
  seed: '',
  reproductionAttempts: '5',
  captureScreenshots: true,
  recordTrace: true,
  allowDestructiveActions: false,
  notes: '',
  authorizationConfirmed: false,
};

function randomSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % MAX_SEED;
  }
  return Math.floor(Math.random() * MAX_SEED);
}

function parseIntegerInRange(raw: string, min: number, max: number): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || !/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < min || value > max) return null;
  return value;
}

function rangeMessage(min: number, max: number): string {
  return `Enter a whole number between ${min} and ${max}.`;
}

function validate(values: FormValues): { errors: FormErrors; payload: CreateRunRequest | null } {
  const errors: FormErrors = {};
  const url = values.url.trim();

  if (url.length === 0) {
    errors.url = 'Enter the URL you want tested.';
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.url = 'Only http:// and https:// URLs can be tested.';
      }
    } catch {
      errors.url = 'Enter a full URL including http:// or https://.';
    }
  }

  if (values.viewports.length === 0) {
    errors.viewports = 'Select at least one viewport.';
  }

  const maxPages = parseIntegerInRange(values.maxPages, BUDGET_LIMITS.maxPages.min, BUDGET_LIMITS.maxPages.max);
  if (maxPages == null) {
    errors.maxPages = rangeMessage(BUDGET_LIMITS.maxPages.min, BUDGET_LIMITS.maxPages.max);
  }

  const maxActions = parseIntegerInRange(
    values.maxActions,
    BUDGET_LIMITS.maxActions.min,
    BUDGET_LIMITS.maxActions.max,
  );
  if (maxActions == null) {
    errors.maxActions = rangeMessage(BUDGET_LIMITS.maxActions.min, BUDGET_LIMITS.maxActions.max);
  }

  const maxDepth = parseIntegerInRange(values.maxDepth, BUDGET_LIMITS.maxDepth.min, BUDGET_LIMITS.maxDepth.max);
  if (maxDepth == null) {
    errors.maxDepth = rangeMessage(BUDGET_LIMITS.maxDepth.min, BUDGET_LIMITS.maxDepth.max);
  }

  const maxFilterCombinations = parseIntegerInRange(
    values.maxFilterCombinations,
    BUDGET_LIMITS.maxFilterCombinations.min,
    BUDGET_LIMITS.maxFilterCombinations.max,
  );
  if (maxFilterCombinations == null) {
    errors.maxFilterCombinations = rangeMessage(
      BUDGET_LIMITS.maxFilterCombinations.min,
      BUDGET_LIMITS.maxFilterCombinations.max,
    );
  }

  const maxDurationMinutes = parseIntegerInRange(
    values.maxDurationMinutes,
    DURATION_MIN_MINUTES,
    DURATION_MAX_MINUTES,
  );
  if (maxDurationMinutes == null) {
    errors.maxDurationMinutes = rangeMessage(DURATION_MIN_MINUTES, DURATION_MAX_MINUTES);
  }

  const reproductionAttempts = parseIntegerInRange(values.reproductionAttempts, 0, 5);
  if (reproductionAttempts == null) {
    errors.reproductionAttempts = rangeMessage(0, 5);
  }

  let seed: number | null = null;
  if (values.seed.trim() !== '') {
    seed = parseIntegerInRange(values.seed, 0, MAX_SEED);
    if (seed == null) {
      errors.seed = `Seed must be a whole number between 0 and ${MAX_SEED}.`;
    }
  }

  const notes = values.notes.trim();
  if (notes.length > 2000) {
    errors.notes = 'Notes must be 2000 characters or fewer.';
  }

  if (!values.authorizationConfirmed) {
    errors.authorization = 'You must confirm you own or are authorised to test this website.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors, payload: null };
  }

  if (
    maxPages == null ||
    maxActions == null ||
    maxDepth == null ||
    maxFilterCombinations == null ||
    maxDurationMinutes == null ||
    reproductionAttempts == null
  ) {
    // Unreachable: every null case above also produced an error.
    return { errors, payload: null };
  }

  const payload: CreateRunRequest = {
    url,
    mode: values.mode,
    requireAuth: values.requireAuth,
    viewports: values.viewports,
    budgets: {
      maxPages,
      maxActions,
      maxDepth,
      actionsPerPage: DEFAULT_BUDGETS.actionsPerPage,
      maxFilterCombinations,
      maxDurationMs: maxDurationMinutes * 60_000,
    },
    seed: seed ?? randomSeed(),
    allowDestructiveActions: values.allowDestructiveActions,
    approvedActionPatterns: [],
    focus: values.focus,
    captureScreenshots: values.captureScreenshots,
    recordTrace: values.recordTrace,
    reproductionAttempts,
    ...(notes.length > 0 ? { notes } : {}),
    authorizationConfirmed: true,
  };

  return { errors, payload };
}

function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-border bg-card p-4 sm:p-5', className)}>
      <div className="mb-4">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-[11px] text-severity-critical">
      {message}
    </p>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  danger = false,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 rounded-md border p-3',
        danger ? 'border-severity-critical/30 bg-severity-critical/5' : 'border-border bg-background/40',
      )}
    >
      <div className="min-w-0">
        <Label htmlFor={id} className={cn('cursor-pointer', danger && 'text-severity-critical')}>
          {label}
        </Label>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} className="mt-0.5 shrink-0" />
    </div>
  );
}

export function RunForm() {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = <Key extends keyof FormValues>(key: Key, value: FormValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key as ErrorKey];
      return next;
    });
    setSubmitError(null);
  };

  const toggleViewport = (viewport: ViewportName) => {
    setValues((current) => {
      const selected = current.viewports.includes(viewport);
      if (selected && current.viewports.length === 1) return current;
      return {
        ...current,
        viewports: selected
          ? current.viewports.filter((entry) => entry !== viewport)
          : [...current.viewports, viewport],
      };
    });
    setErrors((current) => {
      const next = { ...current };
      delete next.viewports;
      return next;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    const result = validate(values);
    setErrors(result.errors);
    if (!result.payload) {
      setSubmitError('Fix the highlighted fields before starting the run.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.createRun(result.payload);
      const target = values.mode === 'live' ? `/runs/${created.run.id}/live` : `/runs/${created.run.id}`;
      router.push(target);
    } catch (cause) {
      setSubmitError(
        cause instanceof ApiClientError
          ? cause.message
          : 'The run could not be created. Check the API and try again.',
      );
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <FormSection
            title="Target"
            description="Where the agent starts and how much of the site it should explore."
          >
            <div>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <Label htmlFor="url">Entry URL</Label>
              </div>
              <Input
                id="url"
                value={values.url}
                onChange={(event) => update('url', event.target.value)}
                placeholder="https://app.example.com"
                spellCheck={false}
                autoComplete="off"
                className="mt-1.5 font-mono"
                aria-invalid={Boolean(errors.url)}
                aria-describedby={errors.url ? 'url-error' : undefined}
              />
              <FieldError id="url-error" message={errors.url} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Enter the full URL of a site you are authorized to test (http:// or https://).
              </p>
            </div>

            <div>
              <Label>Execution mode</Label>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Execution mode">
                {(['live', 'background'] as const).map((mode) => {
                  const active = values.mode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => update('mode', mode)}
                      className={cn(
                        'flex items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors',
                        active
                          ? 'border-brand/50 bg-brand/5'
                          : 'border-border bg-background/40 hover:border-border hover:bg-accent/40',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border',
                          active
                            ? 'border-brand/40 bg-brand/10 text-brand'
                            : 'border-border bg-background/60 text-muted-foreground',
                        )}
                      >
                        {mode === 'live' ? <Radio className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-medium">
                          {mode === 'live' ? 'Live' : 'Background'}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                          {mode === 'live'
                            ? 'Watch and interact with the browser in real time.'
                            : 'Run headless and read the report when it finishes.'}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Viewports</Label>
                <div className="mt-1.5 space-y-1.5">
                  {(
                    [
                      { value: 'desktop', label: 'Desktop · 1440×900' },
                      { value: 'mobile', label: 'Mobile · 390×844' },
                    ] as const
                  ).map((option) => {
                    const checked = values.viewports.includes(option.value);
                    return (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background/40 px-2.5 py-2"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleViewport(option.value)}
                          aria-label={option.label}
                        />
                        <span className="text-[12px] text-foreground/90">{option.label}</span>
                      </label>
                    );
                  })}
                </div>
                <FieldError id="viewports-error" message={errors.viewports} />
                <p className="mt-1 text-[10px] text-muted-foreground">At least one viewport is required.</p>
              </div>

              <div>
                <Label htmlFor="focus">Exploration focus</Label>
                <Select
                  value={values.focus}
                  onValueChange={(value) => update('focus', value as ExplorationFocus)}
                >
                  <SelectTrigger id="focus" className="mt-1.5">
                    <SelectValue placeholder="Select focus" />
                  </SelectTrigger>
                  <SelectContent>
                    {FOCUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Narrows which controls and flows the agent prioritises.
                </p>
              </div>
            </div>

            <ToggleRow
              id="require-auth"
              label="Site requires authentication"
              description="Open the live browser so you can sign in to the target site yourself. After signing in, click “Sign-in complete — start testing” in the live console."
              checked={values.requireAuth}
              onCheckedChange={(checked) => {
                setValues((current) => ({
                  ...current,
                  requireAuth: checked,
                  mode: checked ? 'live' : current.mode,
                }));
                setErrors((current) => {
                  const next = { ...current };
                  delete next.form;
                  return next;
                });
                setSubmitError(null);
              }}
            />
            {values.requireAuth ? (
              <Alert variant="info">
                <Radio />
                <AlertTitle>Manual sign-in flow</AlertTitle>
                <AlertDescription>
                  You’ll be taken to a live browser for the target site. Sign in there, then click
                  <span className="font-medium"> “Sign-in complete — start testing”</span> to begin automated
                  testing with your authenticated session (saved encrypted for reuse on this site, when
                  possible).
                </AlertDescription>
              </Alert>
            ) : null}
          </FormSection>

          <FormSection
            title="Bounds"
            description="Hard caps. When a cap is reached the agent stops that branch and records it as a limitation."
          >
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background/40 p-3">
              <div>
                <p className="text-[12px] font-medium">Use maximum budgets</p>
                <p className="text-[11px] text-muted-foreground">
                  Set every exploration budget and viewport to its maximum for the broadest automated coverage.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setValues((current) => ({
                    ...current,
                    viewports: ['desktop', 'mobile'],
                    maxPages: String(BUDGET_LIMITS.maxPages.max),
                    maxActions: String(BUDGET_LIMITS.maxActions.max),
                    maxDepth: String(BUDGET_LIMITS.maxDepth.max),
                    maxFilterCombinations: String(BUDGET_LIMITS.maxFilterCombinations.max),
                    maxDurationMinutes: String(DURATION_MAX_MINUTES),
                    reproductionAttempts: '5',
                  }));
                  setErrors((current) => {
                    const next = { ...current };
                    delete next.viewports;
                    delete next.maxPages;
                    delete next.maxActions;
                    delete next.maxDepth;
                    delete next.maxFilterCombinations;
                    delete next.maxDurationMinutes;
                    delete next.reproductionAttempts;
                    return next;
                  });
                  setSubmitError(null);
                }}
              >
                <Gauge className="h-3.5 w-3.5" />
                Use max of everything
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  { key: 'maxPages', label: 'Max pages', hint: 'distinct states' },
                  { key: 'maxActions', label: 'Max actions', hint: 'interactions' },
                  { key: 'maxDepth', label: 'Max depth', hint: 'hops from entry' },
                  { key: 'maxFilterCombinations', label: 'Max filter combos', hint: 'excluding baseline' },
                  { key: 'maxDurationMinutes', label: 'Max duration', hint: 'minutes' },
                  { key: 'reproductionAttempts', label: 'Reproduction attempts', hint: '0–5 replays' },
                ] as const
              ).map((field) => (
                <div key={field.key}>
                  <Label htmlFor={field.key}>{field.label}</Label>
                  <Input
                    id={field.key}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={values[field.key]}
                    onChange={(event) => update(field.key, event.target.value)}
                    className="mt-1.5 font-mono tabular-nums"
                    aria-invalid={Boolean(errors[field.key])}
                  />
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/80">
                    {field.hint}
                  </p>
                  <FieldError message={errors[field.key]} />
                </div>
              ))}
            </div>

            <div>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <Label htmlFor="seed">Exploration seed</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px]"
                  onClick={() => update('seed', String(randomSeed()))}
                >
                  <Shuffle className="h-3 w-3" />
                  Randomise
                </Button>
              </div>
              <Input
                id="seed"
                value={values.seed}
                onChange={(event) => update('seed', event.target.value)}
                placeholder="Random if empty"
                inputMode="numeric"
                className="mt-1.5 font-mono tabular-nums"
                aria-invalid={Boolean(errors.seed)}
              />
              <FieldError message={errors.seed} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Recorded with the run so a failure can be replayed. Leave empty to generate a random seed
                with <span className="mono">crypto.getRandomValues</span>.
              </p>
            </div>
          </FormSection>
        </div>

        <div className="space-y-4">
          <FormSection
            title="Evidence"
            description="What the agent keeps for the report."
            className="lg:sticky lg:top-20"
          >
            <ToggleRow
              id="capture-screenshots"
              label="Capture screenshots"
              description="Store a screenshot for each finding and tested page."
              checked={values.captureScreenshots}
              onCheckedChange={(checked) => update('captureScreenshots', checked)}
            />
            <ToggleRow
              id="record-trace"
              label="Record Playwright trace"
              description="Adds a trace archive to the run evidence for offline replay."
              checked={values.recordTrace}
              onCheckedChange={(checked) => update('recordTrace', checked)}
            />
            <ToggleRow
              id="allow-destructive"
              label="Allow destructive actions"
              description="Lets the agent click destructive controls such as delete, pay or unsubscribe."
              checked={values.allowDestructiveActions}
              onCheckedChange={(checked) => update('allowDestructiveActions', checked)}
              danger
            />
            {values.allowDestructiveActions ? (
              <Alert variant="warning">
                <AlertTriangle />
                <AlertTitle>Destructive testing enabled</AlertTitle>
                <AlertDescription>
                  Only enable this on sites and accounts where data loss is acceptable. Destructive
                  interactions are blocked by default for a reason.
                </AlertDescription>
              </Alert>
            ) : null}
          </FormSection>

          <FormSection title="Notes" description="Optional context for the report.">
            <div>
              <Label htmlFor="notes">Operator note</Label>
              <Textarea
                id="notes"
                value={values.notes}
                onChange={(event) => update('notes', event.target.value)}
                placeholder="e.g. Revenue KPI is expected to equal the sum of regional totals."
                className="mt-1.5"
                maxLength={2000}
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>Included verbatim in the exported report.</span>
                <span className="font-mono tabular-nums">{values.notes.length}/2000</span>
              </div>
              <FieldError message={errors.notes} />
            </div>
          </FormSection>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <label
          className={cn(
            'flex cursor-pointer items-start gap-2.5 rounded-md border p-3',
            errors.authorization
              ? 'border-severity-critical/50 bg-severity-critical/5'
              : values.authorizationConfirmed
                ? 'border-success/40 bg-success/5'
                : 'border-border bg-background/40',
          )}
        >
          <Checkbox
            checked={values.authorizationConfirmed}
            onCheckedChange={(checked) => update('authorizationConfirmed', checked === true)}
            aria-label="Authorization confirmation"
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[12px] font-medium">
              <ShieldAlert className="h-3.5 w-3.5 text-severity-medium" />I own or am authorized to test
              this website.
            </span>
            <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
              The agent will interact with the target as a real user, including submitting forms and
              reading data. You are responsible for having permission to test it.
            </span>
          </span>
        </label>
        <FieldError message={errors.authorization} />

        {submitError ? (
          <Alert variant="destructive" className="mt-3">
            <Wand2 />
            <AlertTitle>Run not started</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" />
            {values.mode === 'live'
              ? 'Live run: you will be taken to the live console after creation.'
              : 'Background run: you will be taken to the run overview after creation.'}
          </p>
          <Button
            type="submit"
            variant="brand"
            disabled={!values.authorizationConfirmed || submitting}
            className="w-full sm:w-auto"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting
              ? 'Starting run…'
              : values.mode === 'live'
                ? 'Start live test'
                : 'Start background test'}
            {!submitting ? <ArrowRight className="h-3.5 w-3.5" /> : null}
          </Button>
        </div>
      </div>
    </form>
  );
}
