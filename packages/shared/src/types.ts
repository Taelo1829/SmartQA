/**
 * SmartQA shared domain model.
 *
 * These types are the contract between the web app, the worker, the engine and
 * the persistence adapters. They are intentionally framework-agnostic: nothing
 * here imports Playwright, Prisma or Next.js.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Id = string;
export type IsoDate = string;

export const RUN_MODES = ['live', 'background'] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const RUN_STATUSES = [
  'queued',
  'preparing',
  'awaiting_login',
  'running',
  'paused',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['completed', 'failed', 'cancelled'];

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

export const VIEWPORTS = ['desktop', 'mobile'] as const;
export type ViewportName = (typeof VIEWPORTS)[number];

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const CONFIDENCES = ['confirmed', 'probable', 'suspected'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const FINDING_STATUSES = [
  'reproducible',
  'intermittent',
  'suspected',
  'not_reproduced',
  'open',
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const FINDING_CATEGORIES = [
  'console_error',
  'unhandled_rejection',
  'network_failure',
  'http_error',
  'broken_image',
  'missing_content',
  'infinite_loading',
  'nonfunctional_control',
  'broken_navigation',
  'broken_pagination',
  'filter_inconsistency',
  'calculation_error',
  'invalid_value',
  'layout_overflow',
  'element_overlap',
  'responsive_breakage',
  'runtime_exception',
  'accessibility',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  console_error: 'JavaScript error',
  unhandled_rejection: 'Unhandled promise rejection',
  network_failure: 'Failed network request',
  http_error: 'HTTP error response',
  broken_image: 'Broken image',
  missing_content: 'Missing content',
  infinite_loading: 'Loading never resolves',
  nonfunctional_control: 'Non-functional control',
  broken_navigation: 'Broken navigation',
  broken_pagination: 'Broken pagination',
  filter_inconsistency: 'Inconsistent filtering',
  calculation_error: 'Calculation error',
  invalid_value: 'Invalid displayed value',
  layout_overflow: 'Layout overflow',
  element_overlap: 'Overlapping elements',
  responsive_breakage: 'Responsive breakage',
  runtime_exception: 'Runtime exception',
  accessibility: 'Accessibility problem',
};

// ---------------------------------------------------------------------------
// Run configuration
// ---------------------------------------------------------------------------

export interface RunBudgets {
  /** Hard cap on distinct page states visited. */
  maxPages: number;
  /** Hard cap on executed interactions. */
  maxActions: number;
  /** Navigation depth limit from the entry URL. */
  maxDepth: number;
  /** Interactions attempted per page state. */
  actionsPerPage: number;
  /** Maximum filter combinations (excluding baseline/reset probes). */
  maxFilterCombinations: number;
  /** Wall-clock cap for the whole run. */
  maxDurationMs: number;
}

export const DEFAULT_BUDGETS: RunBudgets = {
  maxPages: 25,
  maxActions: 120,
  maxDepth: 3,
  actionsPerPage: 12,
  maxFilterCombinations: 24,
  maxDurationMs: 8 * 60_000,
};

export const BUDGET_LIMITS: Record<keyof RunBudgets, { min: number; max: number }> = {
  maxPages: { min: 1, max: 200 },
  maxActions: { min: 5, max: 2000 },
  maxDepth: { min: 1, max: 10 },
  actionsPerPage: { min: 1, max: 60 },
  maxFilterCombinations: { min: 0, max: 200 },
  maxDurationMs: { min: 30_000, max: 60 * 60_000 },
};

export type ExplorationFocus = 'full' | 'navigation' | 'dashboard' | 'forms';

export interface RunConfig {
  url: string;
  mode: RunMode;
  /** When true the run pauses in `awaiting_login` until a human signs in. */
  requireAuth: boolean;
  viewports: ViewportName[];
  budgets: RunBudgets;
  /** Deterministic exploration seed; recorded so failures can be replayed. */
  seed: number;
  /** Destructive operations are blocked unless this is explicitly enabled. */
  allowDestructiveActions: boolean;
  /** Additional user-approved action label patterns (regex sources). */
  approvedActionPatterns: string[];
  focus: ExplorationFocus;
  captureScreenshots: boolean;
  recordTrace: boolean;
  /** How many replay attempts to classify each finding. */
  reproductionAttempts: number;
  /** Optional human note, surfaced in the report. */
  notes?: string;
}

export type AuthState = 'none' | 'not_required' | 'awaiting_user' | 'captured' | 'expired';

// ---------------------------------------------------------------------------
// Run entities
// ---------------------------------------------------------------------------

export interface RunProgress {
  phase: string;
  phaseLabel: string;
  percent: number;
  message: string;
  pagesDiscovered: number;
  pagesVisited: number;
  actionsExecuted: number;
  checksRun: number;
  findings: number;
  currentUrl?: string;
  currentAction?: string;
  updatedAt: IsoDate;
}

export function emptyProgress(): RunProgress {
  return {
    phase: 'queued',
    phaseLabel: 'Queued',
    percent: 0,
    message: 'Waiting to start',
    pagesDiscovered: 0,
    pagesVisited: 0,
    actionsExecuted: 0,
    checksRun: 0,
    findings: 0,
    updatedAt: new Date().toISOString(),
  };
}

export interface TestRun {
  id: Id;
  userId: Id;
  siteId?: Id | null;
  url: string;
  origin: string;
  mode: RunMode;
  status: RunStatus;
  config: RunConfig;
  authState: AuthState;
  progress: RunProgress;
  summary?: RunSummary | null;
  coverage?: CoverageReport | null;
  error?: string | null;
  workerId?: string | null;
  createdAt: IsoDate;
  startedAt?: IsoDate | null;
  finishedAt?: IsoDate | null;
  durationMs?: number | null;
  heartbeatAt?: IsoDate | null;
  cancelRequestedAt?: IsoDate | null;
}

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export function zeroSeverities(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

export interface CheckCounts {
  passed: number;
  failed: number;
  warning: number;
  skipped: number;
}

export interface RunSummary {
  findingsTotal: number;
  confirmed: number;
  suspected: number;
  intermittent: number;
  severities: SeverityCounts;
  checks: CheckCounts;
  pagesDiscovered: number;
  pagesVisited: number;
  elementsDiscovered: number;
  elementsTested: number;
  filterDimensions: number;
  filterCombinationsExecuted: number;
  filterCombinationsPlanned: number;
  metricSamplesCaptured: number;
  statesDiscovered: number;
  loopsPrevented: number;
  durationMs: number;
  coverageCompleteness: CoverageCompleteness;
  limitations: string[];
  topFindings: FindingSummary[];
  viewports: ViewportName[];
  seed: number;
  generatedAt: IsoDate;
  /** Optional AI-written executive summary; never used for validation. */
  narrative?: string | null;
}

export interface FindingSummary {
  id: Id;
  title: string;
  category: FindingCategory;
  severity: Severity;
  confidence: Confidence;
  status: FindingStatus;
  pageUrl: string;
}

export type CoverageCompleteness = 'smoke' | 'partial' | 'broad' | 'exhaustive';

export interface BudgetUsage {
  pages: number;
  actions: number;
  depth: number;
  filterCombinations: number;
  durationMs: number;
  exhausted: string[];
}

export interface CoverageReport {
  completeness: CoverageCompleteness;
  completenessReason: string;
  pagesDiscovered: number;
  pagesVisited: number;
  statesDiscovered: number;
  statesVisited: number;
  elementsDiscovered: number;
  elementsTested: number;
  elementsSkipped: number;
  filterDimensions: number;
  filterOptions: number;
  filterCombinationsPlanned: number;
  filterCombinationsExecuted: number;
  checks: CheckCounts;
  budget: BudgetUsage;
  /** Human-readable list of what was *not* covered, never omitted. */
  limitations: string[];
  /** What evidence supports the completeness claim. */
  basis: string[];
}

// ---------------------------------------------------------------------------
// Site / project
// ---------------------------------------------------------------------------

export interface Site {
  id: Id;
  userId: Id;
  origin: string;
  name: string;
  authorizationConfirmedAt: IsoDate;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  lastRunAt?: IsoDate | null;
  runCount: number;
}

// ---------------------------------------------------------------------------
// State graph
// ---------------------------------------------------------------------------

export interface ElementRef {
  /** Stable-per-page selector computed at discovery time (CSS or Playwright text). */
  selector: string;
  /** Alternative selectors, tried in order if the primary detaches. */
  fallbackSelectors?: string[];
  tag: string;
  role?: string;
  label: string;
  /** Bounding box in CSS pixels, for evidence and overlap checks. */
  box?: { x: number; y: number; width: number; height: number } | null;
  elementId?: string | null;
  testId?: string | null;
  href?: string | null;
  inputType?: string | null;
}

export type ElementCategory =
  | 'link'
  | 'button'
  | 'tab'
  | 'menu'
  | 'menuitem'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'combobox'
  | 'input'
  | 'search'
  | 'textarea'
  | 'accordion'
  | 'pagination'
  | 'filter'
  | 'other';

export interface InteractiveElement extends ElementRef {
  id: Id;
  category: ElementCategory;
  destructiveRisk: 'none' | 'possible' | 'blocked';
  blockedReason?: string | null;
  discoveredAt: IsoDate;
  signature: string;
}

export interface PageState {
  id: Id;
  runId: Id;
  url: string;
  normalizedUrl: string;
  title: string;
  /** Structural fingerprint of the DOM region that matters (main content). */
  signature: string;
  depth: number;
  parentStateId?: Id | null;
  viaActionId?: Id | null;
  discoveredAt: IsoDate;
  visitedAt?: IsoDate | null;
  visitCount: number;
  interactiveCount: number;
  screenshotId?: Id | null;
  skeleton?: boolean;
}

export type ActionKind =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select'
  | 'check'
  | 'press'
  | 'hover'
  | 'scroll'
  | 'submit'
  | 'clear_filters'
  | 'pagination';

export type ActionStatus = 'pending' | 'running' | 'executed' | 'failed' | 'blocked' | 'skipped';

export interface ActionRecord {
  id: Id;
  runId: Id;
  pageStateId: Id;
  kind: ActionKind;
  status: ActionStatus;
  element?: ElementRef | null;
  elementLabel: string;
  value?: string | null;
  description: string;
  destructiveRisk: 'none' | 'possible' | 'blocked';
  startedAt: IsoDate;
  durationMs?: number | null;
  resultStateId?: Id | null;
  urlBefore: string;
  urlAfter?: string | null;
  outcome: 'no_change' | 'dom_changed' | 'navigated' | 'modal_opened' | 'failed' | 'unknown';
  error?: string | null;
  /** Signals observed during this action, correlated to findings. */
  signals?: ActionSignals | null;
}

export interface ActionSignals {
  consoleErrors: number;
  pageErrors: number;
  failedRequests: number;
  httpErrors: number;
  brokenImages: number;
  sentinelHits: number;
  networkRequests: number;
}

export interface RecordedStep {
  index: number;
  kind: ActionKind;
  description: string;
  url: string;
  selector?: string | null;
  value?: string | null;
  pageStateId?: Id | null;
}

export interface StateGraphSummary {
  states: PageState[];
  actions: ActionRecord[];
  frontierStateIds: Id[];
  loopsPrevented: number;
  maxDepthReached: number;
  visitedUrls: string[];
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const EVIDENCE_KINDS = [
  'screenshot',
  'full_page_screenshot',
  'trace',
  'console_log',
  'network_log',
  'dom_snapshot',
  'metrics_json',
  'page_html',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface Evidence {
  id: Id;
  runId: Id;
  findingId?: Id | null;
  kind: EvidenceKind;
  label: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  storageKey: string;
  createdAt: IsoDate;
  metadata: Record<string, unknown>;
}

export interface EvidenceRef {
  id: Id;
  kind: EvidenceKind;
  label: string;
  contentType: string;
}

// ---------------------------------------------------------------------------
// Metrics & filters
// ---------------------------------------------------------------------------

export type MetricKind =
  | 'currency'
  | 'integer'
  | 'decimal'
  | 'percentage'
  | 'ratio'
  | 'average'
  | 'duration'
  | 'distinct_count'
  | 'score'
  | 'unknown';

export type Additivity = 'additive' | 'non_additive' | 'unknown';

export type MetricScope = 'page_total' | 'filtered_total' | 'table_total' | 'table_row' | 'kpi' | 'other';

export interface MetricSample {
  key: string;
  label: string;
  rawText: string;
  value: number | null;
  unit?: string | null;
  kind: MetricKind;
  additivity: Additivity;
  additivityReason: string;
  scope: MetricScope;
  source: string;
  /** Optional business grouping, e.g. region option that produced the value. */
  groupKey?: string | null;
  /** Plausible inclusive bounds used for non-additive sanity checks. */
  plausibleMin?: number | null;
  plausibleMax?: number | null;
}

export type FilterKind =
  | 'select'
  | 'multi_select'
  | 'checkbox_group'
  | 'radio_group'
  | 'toggle_group'
  | 'range'
  | 'date'
  | 'search'
  | 'unknown';

export interface FilterOption {
  id: Id;
  label: string;
  value?: string | null;
  selector: string;
  index: number;
}

export interface FilterDimension {
  id: Id;
  runId: Id;
  pageStateId: Id;
  label: string;
  kind: FilterKind;
  selector: string;
  options: FilterOption[];
  optionSource: 'options' | 'checkboxes' | 'radios' | 'buttons' | 'menu' | 'unknown';
  multiple: boolean;
  notes?: string | null;
}

export interface FilterSelection {
  dimensionId: Id;
  dimensionLabel: string;
  optionIds: Id[];
  optionLabels: string[];
}

export type CombinationKind =
  | 'baseline'
  | 'single'
  | 'pair'
  | 'triple'
  | 'permutation'
  | 'reset'
  | 'empty'
  | 'all_options'
  | 'random';

export type CombinationState = 'planned' | 'applied' | 'captured' | 'failed' | 'skipped';

export interface FilterCombination {
  id: Id;
  runId: Id;
  pageStateId: Id;
  kind: CombinationKind;
  selections: FilterSelection[];
  /** Dimension ids in the order the filters were applied. */
  order: string[];
  state: CombinationState;
  plannedAt: IsoDate;
  executedAt?: IsoDate | null;
  snapshotId?: Id | null;
  error?: string | null;
  /** Identity of the logical state, order-insensitive. */
  stateKey: string;
}

export interface TableSnapshot {
  headers: string[];
  rows: string[][];
  rowCount: number;
  page?: number | null;
  totalPages?: number | null;
  paginationLabel?: string | null;
}

export interface MetricSnapshot {
  id: Id;
  runId: Id;
  pageStateId: Id;
  combinationId?: Id | null;
  pageUrl: string;
  capturedAt: IsoDate;
  metrics: MetricSample[];
  table?: TableSnapshot | null;
  rowCount?: number | null;
  notes?: string | null;
  viewport: ViewportName;
}

/** A consistency rule evaluated with deterministic arithmetic. */
export type CheckKind =
  | 'page_load'
  | 'navigation'
  | 'control_responds'
  | 'console_error'
  | 'network_request'
  | 'image_load'
  | 'invalid_value'
  | 'loading_resolves'
  | 'content_present'
  | 'filter_reset'
  | 'filter_additivity'
  | 'filter_order'
  | 'filter_empty'
  | 'filter_subset'
  | 'table_totals'
  | 'pagination'
  | 'layout_overflow'
  | 'element_overlap'
  | 'responsive'
  | 'form_validation'
  | 'auth_required';

export type CheckStatus = 'passed' | 'failed' | 'warning' | 'skipped';

export interface CalculationDetail {
  formula: string;
  expected: number | null;
  observed: number | null;
  delta: number | null;
  tolerance: number;
  components: Array<{ label: string; value: number }>;
  additivity: Additivity;
  metricKind: MetricKind;
  unit?: string | null;
  sampleSize: number;
  confidence: Confidence;
  reason: string;
}

export interface CheckResult {
  id: Id;
  runId: Id;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  detail: string;
  pageUrl: string;
  actionId?: Id | null;
  pageStateId?: Id | null;
  combinationId?: Id | null;
  evidenceIds: Id[];
  deterministic: boolean;
  calculation?: CalculationDetail | null;
  createdAt: IsoDate;
  durationMs?: number | null;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export interface ReproductionInfo {
  attempts: number;
  successes: number;
  steps: string[];
  recordedSteps: RecordedStep[];
  notes: string;
  lastAttemptAt?: IsoDate | null;
  /** Actions replayed during verification, for auditability. */
  reproducedBy?: string;
}

export interface Finding {
  id: Id;
  runId: Id;
  category: FindingCategory;
  severity: Severity;
  confidence: Confidence;
  status: FindingStatus;
  title: string;
  description: string;
  expected?: string | null;
  observed: string;
  pageUrl: string;
  pageTitle?: string | null;
  pageStateId?: Id | null;
  actionId?: Id | null;
  elementLabel?: string | null;
  selector?: string | null;
  calculation?: CalculationDetail | null;
  reproduction: ReproductionInfo;
  evidence: EvidenceRef[];
  fingerprint: string;
  tags: string[];
  suspectedReason?: string | null;
  occurrenceCount: number;
  firstSeenAt: IsoDate;
  lastSeenAt: IsoDate;
}

// ---------------------------------------------------------------------------
// Logs & events
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RunLogEntry {
  id: Id;
  runId: Id;
  seq: number;
  level: LogLevel;
  message: string;
  actionId?: Id | null;
  at: IsoDate;
  data?: Record<string, unknown> | null;
}

interface EventBase {
  seq: number;
  at: IsoDate;
}

export type RunEvent = EventBase &
  (
    | { type: 'run'; run: TestRun }
    | { type: 'progress'; progress: RunProgress }
    | { type: 'log'; level: LogLevel; message: string; actionId?: Id | null }
    | { type: 'action'; action: ActionRecord }
    | { type: 'page'; page: PageState }
    | { type: 'check'; check: CheckResult }
    | { type: 'finding'; finding: Finding }
    | { type: 'snapshot'; snapshot: MetricSnapshot }
    | { type: 'heartbeat' }
  );

export type RunEventType = RunEvent['type'];

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ReportMeta {
  generatedAt: IsoDate;
  generator: string;
  formatVersion: number;
  runId: Id;
  seed: number;
  url: string;
  mode: RunMode;
}

export interface ReportFilterTest {
  dimension: string;
  kind: FilterKind;
  options: string[];
  combinationsExecuted: number;
  orderVariants: number;
  resetRestoredBaseline: boolean | null;
  additivityVerdict: 'consistent' | 'inconsistent' | 'not_applicable' | 'suspected';
  detail: string;
}

export interface RunReport {
  meta: ReportMeta;
  run: TestRun;
  summary: RunSummary;
  coverage: CoverageReport;
  findings: Finding[];
  checks: CheckResult[];
  snapshots: MetricSnapshot[];
  filterTests: ReportFilterTest[];
  stateGraph: StateGraphSummary;
  logs: RunLogEntry[];
  limitations: string[];
  aiUsage: AiUsageSummary;
  /** Optional AI-written executive summary (never used for validation). */
  narrative?: string | null;
}

export interface AiUsageSummary {
  enabled: boolean;
  provider: string;
  model: string;
  calls: number;
  failures: number;
  totalTokens?: number;
  decisions: Array<{ at: IsoDate; purpose: string; summary: string; accepted: boolean }>;
}

// ---------------------------------------------------------------------------
// Auth / users
// ---------------------------------------------------------------------------

export interface User {
  id: Id;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface PublicUser {
  id: Id;
  email: string;
  name: string;
  createdAt: IsoDate;
}

export interface AuthSessionRecord {
  id: Id;
  userId: Id;
  tokenHash: string;
  createdAt: IsoDate;
  expiresAt: IsoDate;
  lastSeenAt: IsoDate;
}

/** Encrypted-at-rest Playwright storage state. */
export interface SessionVaultEntry {
  id: Id;
  userId: Id;
  siteId: Id;
  runId?: Id | null;
  origin: string;
  /** AES-256-GCM ciphertext; never returned through any API. */
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  createdAt: IsoDate;
  expiresAt: IsoDate;
  lastUsedAt?: IsoDate | null;
  revokedAt?: IsoDate | null;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type JobKind = 'run_test' | 'reproduce_finding' | 'export_report';

export type JobState = 'queued' | 'active' | 'completed' | 'failed' | 'delayed' | 'cancelled';

export interface JobRecord {
  id: Id;
  kind: JobKind;
  runId?: Id | null;
  userId: Id;
  payload: Record<string, unknown>;
  state: JobState;
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  startedAt?: IsoDate | null;
  finishedAt?: IsoDate | null;
  error?: string | null;
  workerId?: string | null;
}

// ---------------------------------------------------------------------------
// API payloads
// ---------------------------------------------------------------------------

export interface CreateRunResponse {
  run: TestRun;
  liveSessionId?: string | null;
}

export interface RunListResponse {
  runs: TestRun[];
  total: number;
}

export interface RunDetailResponse {
  run: TestRun;
  findings: Finding[];
  pages: PageState[];
  actions: ActionRecord[];
  checks: CheckResult[];
  evidence: Evidence[];
  snapshots: MetricSnapshot[];
  filterDimensions: FilterDimension[];
  filterCombinations: FilterCombination[];
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  storage: string;
  queue: string;
  ai: boolean;
  time: IsoDate;
  checks: Record<string, { ok: boolean; detail: string }>;
}

// ---------------------------------------------------------------------------
// Live view, AI decisions and audit trail
// ---------------------------------------------------------------------------

export interface LiveSessionInfo {
  id: Id;
  runId: Id;
  status: RunStatus;
  viewport: { width: number; height: number };
  interactive: boolean;
  viewerCount: number;
  startedAt: IsoDate;
}

/** One AI decision, persisted so the report can show what the model influenced. */
export interface AiDecisionRecord {
  id: Id;
  runId: Id;
  userId: Id;
  purpose: string;
  summary: string;
  accepted: boolean;
  at: IsoDate;
  tokens?: number | null;
}

export interface AuditRecord {
  id: Id;
  userId?: Id | null;
  runId?: Id | null;
  action: string;
  detail: Record<string, unknown> | null;
  ip?: string | null;
  at: IsoDate;
}

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}
