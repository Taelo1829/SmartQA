import { randomInt } from 'node:crypto';
import {
  DEFAULT_BUDGETS,
  emptyProgress,
  nowIso,
  normalizeUrl,
  shortId,
  type ActionRecord,
  type CheckResult,
  type CreateRunPayload,
  type FilterCombination,
  type FilterDimension,
  type Finding,
  type MetricSnapshot,
  type PageState,
  type RunReport,
  type RunSummary,
  type TestRun,
  type User,
} from '@smartqa/shared';
import {
  assertSafeUrl,
  buildCoverage,
  buildFilterTests,
  getLiveSessionForRun,
  getRunControl,
  startRun,
} from '@smartqa/engine';
import { ensureSite, getConfig, getStore, getVault, recordAudit } from '@smartqa/db';
import { createQueue } from '@smartqa/jobs';
import { HttpError } from './errors';
import { ensureInlineWorker } from './worker';

/**
 * Run service: the single place that creates, controls and reports runs.
 * Route handlers stay thin and call into these functions.
 */

export interface CreateRunResult {
  run: TestRun;
  liveSessionId: string | null;
}

export async function createRun(user: User, payload: CreateRunPayload): Promise<CreateRunResult> {
  const store = await getStore();
  const config = getConfig();
  const url = normalizeUrl(payload.url);

  try {
    await assertSafeUrl(url, { allowPrivateNetworks: config.allowPrivateNetworks });
  } catch (error) {
    throw new HttpError(400, (error as Error).message, 'UNSAFE_URL');
  }

  const origin = new URL(url).origin;
  if (payload.requireAuth && payload.mode === 'background') {
    const stored = await (await getVault()).load(user.id, origin);
    if (!stored) {
      throw new HttpError(
        400,
        'Authenticated testing starts in live mode so you can sign in manually. Switch to Live mode.',
        'AUTH_REQUIRES_LIVE',
      );
    }
  }

  const site = await ensureSite(store, {
    userId: user.id,
    origin,
    authorizationConfirmedAt: nowIso(),
  });
  const seed = payload.seed ?? randomInt(1, 2 ** 31 - 1);
  const budgets = { ...DEFAULT_BUDGETS, ...(payload.budgets ?? {}) };

  const run: TestRun = {
    id: shortId('run'),
    userId: user.id,
    siteId: site.id,
    url,
    origin,
    mode: payload.mode,
    status: 'queued',
    config: {
      url,
      mode: payload.mode,
      requireAuth: payload.requireAuth,
      viewports: payload.viewports,
      budgets,
      seed,
      allowDestructiveActions: payload.allowDestructiveActions,
      approvedActionPatterns: payload.approvedActionPatterns,
      focus: payload.focus,
      captureScreenshots: payload.captureScreenshots,
      recordTrace: payload.recordTrace,
      reproductionAttempts: payload.reproductionAttempts,
      notes: payload.notes,
    },
    authState: payload.requireAuth ? 'awaiting_user' : 'not_required',
    progress: emptyProgress(),
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    heartbeatAt: null,
    cancelRequestedAt: null,
    summary: null,
    coverage: null,
    error: null,
    workerId: null,
  };
  await store.runs.create(run);
  await recordAudit(store, {
    userId: user.id,
    runId: run.id,
    action: 'run.created',
    detail: { url, mode: run.mode, seed, budgets },
  });

  if (run.mode === 'live') {
    const handle = startRun(run);
    return { run: handle.run, liveSessionId: handle.liveSessionId };
  }

  const queue = await createQueue(store);
  await queue.enqueue({ kind: 'run_test', userId: user.id, runId: run.id, payload: { runId: run.id } });
  await ensureInlineWorker();
  return { run, liveSessionId: null };
}

export interface RunDetail extends Record<string, unknown> {
  run: TestRun;
  findings: Finding[];
  pages: PageState[];
  actions: ActionRecord[];
  checks: CheckResult[];
  evidence: Array<import('@smartqa/shared').Evidence>;
  snapshots: MetricSnapshot[];
  filterDimensions: FilterDimension[];
  filterCombinations: FilterCombination[];
  liveSessionId: string | null;
}

export async function getRunDetail(userId: string, runId: string): Promise<RunDetail> {
  const store = await getStore();
  const run = await store.runs.get(runId);
  if (!run || run.userId !== userId) throw new HttpError(404, 'Run not found', 'NOT_FOUND');

  const [findings, pages, actions, checks, evidence, snapshots, filterDimensions, filterCombinations] =
    await Promise.all([
      store.findings.find({ where: { runId }, orderBy: { field: 'firstSeenAt', direction: 'asc' }, limit: 500 }),
      store.pages.find({ where: { runId }, orderBy: { field: 'discoveredAt', direction: 'asc' }, limit: 500 }),
      store.actions.find({ where: { runId }, orderBy: { field: 'startedAt', direction: 'asc' }, limit: 5_000 }),
      store.checks.find({ where: { runId }, orderBy: { field: 'createdAt', direction: 'asc' }, limit: 5_000 }),
      store.evidence.find({ where: { runId }, orderBy: { field: 'createdAt', direction: 'asc' }, limit: 500 }),
      store.snapshots.find({ where: { runId }, orderBy: { field: 'capturedAt', direction: 'asc' }, limit: 1_000 }),
      store.filterDimensions.find({ where: { runId }, limit: 100 }),
      store.filterCombinations.find({ where: { runId }, orderBy: { field: 'plannedAt', direction: 'asc' }, limit: 500 }),
    ]);

  return {
    run,
    findings,
    pages,
    actions,
    checks,
    evidence,
    snapshots,
    filterDimensions,
    filterCombinations,
    liveSessionId: getLiveSessionForRun(runId)?.id ?? null,
  };
}

export type RunActionName =
  | 'start'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'takeover'
  | 'release'
  | 'detach'
  | 'login_complete'
  | 'reproduce';

export async function performRunAction(
  userId: string,
  runId: string,
  action: RunActionName,
  findingId?: string,
): Promise<TestRun> {
  const store = await getStore();
  const run = await store.runs.get(runId);
  if (!run || run.userId !== userId) throw new HttpError(404, 'Run not found', 'NOT_FOUND');
  const control = getRunControl(runId);
  const live = getLiveSessionForRun(runId);

  switch (action) {
    case 'start': {
      if (run.status !== 'queued' && run.status !== 'awaiting_login') {
        throw new HttpError(409, `Run is already ${run.status}`, 'INVALID_STATE');
      }
      if (run.status === 'awaiting_login' && control) {
        control.completeLogin();
        return (await store.runs.get(runId)) ?? run;
      }
      const handle = startRun(run);
      if (handle.liveSessionId) live && (live.status = 'running');
      return handle.run;
    }
    case 'pause': {
      if (!control) throw new HttpError(409, 'Run is not active in this process', 'NOT_ACTIVE');
      control.pause();
      return store.runs.update(runId, { status: 'paused' });
    }
    case 'resume': {
      if (!control) throw new HttpError(409, 'Run is not active in this process', 'NOT_ACTIVE');
      control.resume();
      return store.runs.update(runId, { status: 'running' });
    }
    case 'stop': {
      if (control) control.stop();
      if (live) live.status = 'cancelled';
      return store.runs.update(runId, {
        status: 'cancelled',
        cancelRequestedAt: nowIso(),
        finishedAt: nowIso(),
      });
    }
    case 'takeover': {
      if (!control) throw new HttpError(409, 'Run is not active', 'NOT_ACTIVE');
      control.requestTakeover();
      if (live) live.interactive = true;
      return store.runs.update(runId, { status: 'paused' });
    }
    case 'release': {
      if (!control) throw new HttpError(409, 'Run is not active', 'NOT_ACTIVE');
      control.release();
      if (live) live.interactive = false;
      return store.runs.update(runId, { status: 'running' });
    }
    case 'login_complete': {
      if (!control) throw new HttpError(409, 'Run is not waiting for sign-in', 'NOT_ACTIVE');
      control.completeLogin();
      return (await store.runs.get(runId)) ?? run;
    }
    case 'detach': {
      if (!control) throw new HttpError(409, 'Run is not active', 'NOT_ACTIVE');
      control.detach();
      if (live) live.status = 'running';
      return store.runs.update(runId, { mode: 'background' });
    }
    case 'reproduce': {
      if (!findingId) throw new HttpError(400, 'findingId is required', 'INVALID_INPUT');
      const finding = await store.findings.get(findingId);
      if (!finding || finding.runId !== runId) throw new HttpError(404, 'Finding not found', 'NOT_FOUND');
      const queue = await createQueue(store);
      await queue.enqueue({
        kind: 'reproduce_finding',
        userId,
        runId,
        payload: { findingId },
        maxAttempts: 1,
      });
      await ensureInlineWorker();
      return run;
    }
    default:
      throw new HttpError(400, `Unknown action "${action}"`, 'INVALID_ACTION');
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function fallbackSummary(run: TestRun, findings: Finding[], checks: CheckResult[]): RunSummary {
  return {
    findingsTotal: findings.length,
    confirmed: findings.filter((finding) => finding.confidence === 'confirmed').length,
    suspected: findings.filter((finding) => finding.confidence === 'suspected').length,
    intermittent: findings.filter((finding) => finding.status === 'intermittent').length,
    severities: (() => {
      const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      for (const finding of findings) counts[finding.severity] += 1;
      return counts;
    })(),
    checks: {
      passed: checks.filter((check) => check.status === 'passed').length,
      failed: checks.filter((check) => check.status === 'failed').length,
      warning: checks.filter((check) => check.status === 'warning').length,
      skipped: checks.filter((check) => check.status === 'skipped').length,
    },
    pagesDiscovered: 0,
    pagesVisited: 0,
    elementsDiscovered: 0,
    elementsTested: 0,
    filterDimensions: 0,
    filterCombinationsExecuted: 0,
    filterCombinationsPlanned: 0,
    metricSamplesCaptured: 0,
    statesDiscovered: 0,
    loopsPrevented: 0,
    durationMs: run.durationMs ?? 0,
    coverageCompleteness: 'partial',
    limitations: ['The run did not finish normally; this report contains partial results.'],
    topFindings: findings.slice(0, 8).map((finding) => ({
      id: finding.id,
      title: finding.title,
      category: finding.category,
      severity: finding.severity,
      confidence: finding.confidence,
      status: finding.status,
      pageUrl: finding.pageUrl,
    })),
    viewports: run.config.viewports,
    seed: run.config.seed,
    generatedAt: nowIso(),
  };
}

export async function buildReportForRun(userId: string, runId: string): Promise<RunReport> {
  const store = await getStore();
  const detail = await getRunDetail(userId, runId);
  const { run } = detail;
  const logs = await store.logs.find({
    where: { runId },
    orderBy: { field: 'seq', direction: 'asc' },
    limit: 2_000,
  });
  const aiRecords = await store.aiDecisions.find({
    where: { runId },
    orderBy: { field: 'at', direction: 'asc' },
    limit: 200,
  });

  const summary = run.summary ?? fallbackSummary(run, detail.findings, detail.checks);
  const coverage =
    run.coverage ??
    buildCoverage({
      run,
      pages: detail.pages,
      actions: detail.actions,
      checks: detail.checks,
      dimensions: detail.filterDimensions,
      combinations: detail.filterCombinations,
      snapshots: detail.snapshots,
      elementsDiscovered: detail.actions.length,
      elementsTested: detail.actions.filter((action) => action.status === 'executed').length,
      visitedPages: detail.pages.filter((page) => page.visitCount > 0).length,
      maxDepth: detail.pages.reduce((max, page) => Math.max(max, page.depth), 0),
      loopsPrevented: 0,
      extraLimitations: [],
      durationMs: run.durationMs ?? 0,
    });

  const aiUsage = {
    enabled: aiRecords.length > 0 || Boolean(process.env.LLM_API_KEY),
    provider: 'openai-compatible',
    model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
    calls: aiRecords.length,
    failures: aiRecords.filter((record) => !record.accepted).length,
    decisions: aiRecords.map((record) => ({
      at: record.at,
      purpose: record.purpose,
      summary: record.summary,
      accepted: record.accepted,
    })),
  };

  const report = {
    meta: {
      generatedAt: nowIso(),
      generator: 'smartqa-engine',
      formatVersion: 1,
      runId: run.id,
      seed: run.config.seed,
      url: run.url,
      mode: run.mode,
    },
    run,
    summary,
    coverage,
    findings: [...detail.findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    checks: detail.checks,
    snapshots: detail.snapshots,
    filterTests: buildFilterTests(detail.filterDimensions, detail.filterCombinations, detail.checks, detail.findings),
    stateGraph: {
      states: detail.pages,
      actions: detail.actions,
      frontierStateIds: detail.pages
        .filter((page) =>
          detail.actions.some((action) => action.pageStateId === page.id && action.status === 'pending'),
        )
        .map((page) => page.id),
      loopsPrevented: 0,
      maxDepthReached: detail.pages.reduce((max, page) => Math.max(max, page.depth), 0),
      visitedUrls: detail.pages.filter((page) => page.visitCount > 0).map((page) => page.url),
    },
    logs,
    limitations: coverage.limitations,
    aiUsage,
    narrative: summary.narrative ?? null,
  } as RunReport;

  return report;
}

function severityRank(severity: Finding['severity']): number {
  return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[severity];
}

// ---------------------------------------------------------------------------
export async function listRunsForUser(
  userId: string,
  options: { limit?: number; status?: string; mode?: string } = {},
): Promise<{ runs: TestRun[]; total: number }> {
  const store = await getStore();
  const where: Record<string, string | number> = { userId };
  if (options.status) where.status = options.status;
  if (options.mode) where.mode = options.mode;
  const [runs, total] = await Promise.all([
    store.runs.find({
      where,
      orderBy: { field: 'createdAt', direction: 'desc' },
      limit: Math.min(options.limit ?? 25, 100),
    }),
    store.runs.count(where),
  ]);
  return { runs, total };
}

export type { Store };
