import path from 'node:path';
import {
  emptyProgress,
  nowIso,
  shortId,
  type ActionRecord,
  type CheckResult,
  type FilterCombination,
  type FilterDimension,
  type Finding,
  type LogLevel,
  type MetricSnapshot,
  type PageState,
  type RunLogEntry,
  type RunProgress,
  type RunStatus,
  type TestRun,
} from '@smartqa/shared';
import { getConfig, getRuntime, getStore, getVault } from '@smartqa/db';
import { BrowserSession, VIEWPORT_SIZES } from '../browser/session';
import { collectPageSnapshot, type PageSnapshot } from '../browser/domSnapshot';
import { waitForDomQuiet } from '../browser/readiness';
import { RunUrlGuard, assertSafeUrl } from '../security/ssrf';
import { createRng } from '@smartqa/shared';
import { CheckService } from '../checks';
import { EvidenceService } from '../evidence';
import { FindingService } from '../findings';
import { RunEventBus } from '../events';
import { FilterEngine } from '../validate/filters';
import { Explorer } from '../explore/explorer';
import { Reproducer } from '../reproduce/reproducer';
import { buildCoverage, buildSummary } from '../report/aggregate';
import { AiAssistant } from '../ai/provider';
import {
  LiveSession,
  RunControl,
  createLiveSession,
  getRunBus,
  removeLiveSession,
  removeRunControl,
  setRunControl,
} from './registry';

/**
 * Run orchestrator.
 *
 * Owns the lifecycle of one test run: browser provisioning, manual-auth pause,
 * exploration, dashboard validation, reproduction and final reporting.
 *
 * Live runs execute in this process so they can be streamed; background runs are
 * driven by the queue worker and are not tied to any user's dashboard.
 */

export interface RunHandle {
  run: TestRun;
  liveSessionId: string | null;
  completion: Promise<void>;
}

export function startRun(initialRun: TestRun): RunHandle {
  const viewportName = initialRun.config.viewports[0] ?? 'desktop';
  const live =
    initialRun.mode === 'live'
      ? createLiveSession({
          id: shortId('live'),
          runId: initialRun.id,
          viewport: {
            width: VIEWPORT_SIZES[viewportName].width,
            height: VIEWPORT_SIZES[viewportName].height,
          },
        })
      : null;
  const control = new RunControl();
  setRunControl(initialRun.id, control);

  const completion = execute(initialRun, control, live).catch((error: Error) => {
    console.error(`[smartqa] run ${initialRun.id} crashed:`, error);
  });

  return { run: initialRun, liveSessionId: live?.id ?? null, completion };
}

export async function executeRunById(runId: string): Promise<void> {
  const store = await getStore();
  const run = await store.runs.get(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  if (['completed', 'failed', 'cancelled'].includes(run.status)) return;
  const handle = startRun(run);
  await handle.completion;
}

async function execute(initialRun: TestRun, control: RunControl, live: LiveSession | null): Promise<void> {
  const store = await getStore();
  const appConfig = getConfig();
  const runtime = getRuntime();
  const vault = await getVault();
  const bus = getRunBus(initialRun.id);
  const evidence = new EvidenceService(store, runtime.objects);
  const startedAt = Date.now();
  const deadline = startedAt + Math.min(initialRun.config.budgets.maxDurationMs, appConfig.runTimeoutMs);

  let run: TestRun = initialRun;
  let logSeq = (await store.logs.count({ runId: run.id })) || 0;
  let session: BrowserSession | null = null;
  let tracePath: string | null = null;
  let actionsUsed = 0;
  let failure: string | null = null;
  let lastProgressWrite = 0;

  const budget = run.config.budgets;
  const maxActions = budget.maxActions;

  const log = async (level: LogLevel, message: string, data?: Record<string, unknown>): Promise<void> => {
    logSeq += 1;
    const entry: RunLogEntry = {
      id: shortId('log'),
      runId: run.id,
      seq: logSeq,
      level,
      message: message.slice(0, 2_000),
      actionId: (data?.actionId as string | undefined) ?? null,
      at: nowIso(),
      data: data ?? null,
    };
    try {
      await store.logs.create(entry);
    } catch {
      /* logging must never abort a run */
    }
    bus.emit({ type: 'log', level, message: entry.message, actionId: entry.actionId ?? null });
  };

  const setStatus = async (status: RunStatus, extra: Partial<TestRun> = {}): Promise<void> => {
    run = await store.runs.update(run.id, { ...extra, status });
    bus.emitRun(run);
    if (live) live.status = status;
  };

  const progressPercent = (): number => {
    if (['completed', 'failed', 'cancelled'].includes(run.status)) return 100;
    const actionRatio = Math.min(1, actionsUsed / Math.max(1, maxActions));
    const pageRatio = Math.min(1, run.progress.pagesVisited / Math.max(1, budget.maxPages));
    const checkRatio = Math.min(1, run.progress.checksRun / 120);
    return Math.min(95, Math.round(12 + actionRatio * 45 + pageRatio * 18 + checkRatio * 10));
  };

  const updateProgress = async (patch: Partial<RunProgress>, force = false): Promise<void> => {
    const now = Date.now();
    if (!force && now - lastProgressWrite < 400) return;
    lastProgressWrite = now;
    const progress: RunProgress = {
      ...run.progress,
      ...patch,
      percent: progressPercent(),
      updatedAt: nowIso(),
    };
    run = await store.runs.update(run.id, { progress });
    bus.emit({ type: 'progress', progress });
    if (live) live.status = run.status;
  };

  const heartbeat = setInterval(() => {
    void store.runs.update(run.id, { heartbeatAt: nowIso() }).catch(() => undefined);
    bus.emitHeartbeat();
  }, 5_000);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  try {
    await setStatus('preparing', {
      startedAt: nowIso(),
      heartbeatAt: nowIso(),
      error: null,
      authState: run.config.requireAuth ? 'awaiting_user' : 'not_required',
      progress: {
        ...emptyProgress(),
        phase: 'preparing',
        phaseLabel: 'Preparing',
        message: 'Validating target and launching an isolated browser',
        percent: 5,
      },
    });
    await log('info', `Run started for ${run.url}`, {
      mode: run.mode,
      seed: run.config.seed,
      budgets: run.config.budgets,
      viewports: run.config.viewports,
    });

    const policy = { allowPrivateNetworks: appConfig.allowPrivateNetworks };
    await assertSafeUrl(run.url, policy);
    const guard = new RunUrlGuard(run.url, policy);
    const origin = new URL(run.url).origin;

    // Reuse a previously captured authenticated session when one is available.
    let storageState: unknown = undefined;
    let hadVaultedSession = false;
    if (run.siteId) {
      const stored = await vault.load(run.userId, origin).catch(() => null);
      if (stored) {
        storageState = stored.storageState;
        hadVaultedSession = true;
        await log('info', 'Reusing encrypted authenticated session from the vault', {
          expiresAt: stored.entry.expiresAt,
        });
      }
    }

    tracePath = run.config.recordTrace ? path.join(runtime.config.dataDir, 'traces', `${run.id}.zip`) : null;
    session = await BrowserSession.launch({
      runId: run.id,
      headless: appConfig.browser.headless,
      channel: appConfig.browser.channel,
      viewport: run.config.viewports[0] ?? 'desktop',
      storageState,
      urlGuard: guard,
      traceDir: tracePath ?? undefined,
      artifactsDir: runtime.config.dataDir,
    });

    if (live) {
      live.setInputSink(async (input) => {
        await session!.dispatchInput(input);
      });
      try {
        await session.startScreencast((frame) => live.pushFrame(frame));
      } catch (error) {
        await log('warn', `Live streaming could not start: ${(error as Error).message}`);
      }
    }

    const navigation = await session.navigate(run.url);
    await log('info', `Entry page loaded (HTTP ${navigation.status ?? 'unknown'})`, {
      readiness: navigation.readiness,
    });
    await updateProgress(
      { phaseLabel: 'Checking authentication', message: 'Inspecting the entry page for a login wall', percent: 8 },
      true,
    );

    const passwordFields = await session.page
      .locator('input[type="password"]:visible')
      .count()
      .catch(() => 0);
    const loginWallVisible = passwordFields > 0;
    // Pause for manual sign-in when auth is required and there is no saved session,
    // or when a login wall is visible (including an expired/rejected saved session).
    const needsManualLogin = run.config.requireAuth && (!hadVaultedSession || loginWallVisible);

    if (needsManualLogin) {
      if (run.mode !== 'live') {
        throw new Error(
          'Authentication is required but no valid saved session is available. Start a live run to sign in, then retry.',
        );
      }
      if (live) live.interactive = true;
      await setStatus('awaiting_login', { authState: 'awaiting_user' });
      await log(
        'warn',
        'Authentication required. Sign in to the target site in the live browser, then click "Sign-in complete — start testing".',
      );
      await updateProgress(
        {
          phase: 'awaiting_login',
          phaseLabel: 'Awaiting manual sign-in',
          message:
            'Sign in to the site in the browser window, then click "Sign-in complete — start testing"',
          currentUrl: session.page.url(),
        },
        true,
      );
      const loginResult = await control.waitForLogin(15 * 60_000);
      if (loginResult !== 'completed') {
        if (loginResult === 'stopped' || control.stopped) {
          await setStatus('cancelled', { finishedAt: nowIso() });
          return;
        }
        throw new Error('Timed out waiting for manual sign-in (15 minutes).');
      }
      if (control.stopped) {
        await setStatus('cancelled', { finishedAt: nowIso() });
        return;
      }
      if (live) live.interactive = false;
      await waitForDomQuiet(session.page, 300, 4_000);
      const state = await session.storageState();
      if (run.siteId) {
        await vault.save({
          userId: run.userId,
          siteId: run.siteId,
          runId: run.id,
          origin,
          storageState: state,
        });
      }
      await setStatus('running', { authState: 'captured' });
      await log(
        'info',
        'Authenticated session captured and encrypted; starting automated testing with the signed-in browser',
      );
      await session.navigate(run.url);
    } else if (loginWallVisible) {
      await log(
        'warn',
        'A password field is present but authentication was not requested; only the unauthenticated surface will be tested.',
      );
      await store.runs.update(run.id, { authState: 'not_required' });
    } else if (run.config.requireAuth && hadVaultedSession) {
      await store.runs.update(run.id, { authState: 'captured' });
    }

    await setStatus('running');
    await updateProgress(
      { phase: 'running', phaseLabel: 'Exploring', message: 'Discovering pages and interactive elements', percent: 15 },
      true,
    );

    const findings = new FindingService(store, run.id, evidence, async (finding) => {
      findingsCount += 1;
      bus.emit({ type: 'finding', finding });
      await updateProgress({ findings: findingsCount }, true);
      await log('warn', `[${finding.severity.toUpperCase()}] ${finding.title}`, { findingId: finding.id });
    });
    let findingsCount = 0;
    const checks = new CheckService(store, run.id, async (check) => {
      bus.emit({ type: 'check', check });
      await updateProgress({ checksRun: checks.total }, false);
    });

    const ai = new AiAssistant(appConfig.llm);
    const rng = createRng(run.config.seed);
    const captureSnapshot = async (): Promise<PageSnapshot> =>
      (await session!.page.evaluate(collectPageSnapshot as never)) as PageSnapshot;

    const filterEngine = new FilterEngine({
      run,
      store,
      session,
      rng,
      checks,
      findings,
      evidence,
      emit: bus,
      captureSnapshot,
      pauseGate: () => control.gate(),
      log,
      consumeAction: (count = 1) => {
        if (actionsUsed + count > maxActions) return false;
        actionsUsed += count;
        return true;
      },
      actionsRemaining: () => Math.max(0, maxActions - actionsUsed),
      deadlineReached: () => Date.now() >= deadline,
      maxCombinations: run.config.budgets.maxFilterCombinations,
      classifyMetric: (sample) => ai.classifyMetric(sample),
    });

    const explorer = new Explorer({
      run,
      store,
      session,
      rng,
      checks,
      findings,
      evidence,
      emit: bus,
      filterEngine,
      captureSnapshot,
      log,
      pauseGate: () => control.gate(),
      deadlineReached: () => Date.now() >= deadline,
      stopRequested: () => control.stopped,
      consumeAction: (count = 1) => {
        if (actionsUsed + count > maxActions) return false;
        actionsUsed += count;
        return true;
      },
      actionsRemaining: () => Math.max(0, maxActions - actionsUsed),
      onProgress: async (patch) => updateProgress(patch),
      ranker: ai,
    });

    await explorer.run();
    const stats = explorer.stats();
    findingsCount = findings.total;

    if (control.detachRequested && live) {
      await session.stopScreencast().catch(() => undefined);
      await log('info', 'Live streaming detached; the run continues in the background');
    }

    if (control.stopped) {
      await log('warn', 'Run stopped by operator; finalising partial results');
    }

    // ------------------------------------------------------------- finalise
    await setStatus(control.stopped ? 'cancelled' : 'finalizing');
    await updateProgress(
      { phase: 'finalizing', phaseLabel: 'Finalising', message: 'Reproducing findings and building the report' },
      true,
    );

    const traceEvidence =
      tracePath && session
        ? await session
            .stopTracing(tracePath)
            .then((file) =>
              file
                ? evidence.storeFile({
                    runId: run.id,
                    filePath: file,
                    kind: 'trace',
                    label: 'Full Playwright trace of the test run',
                    contentType: 'application/zip',
                    cleanup: true,
                  })
                : null,
            )
            .catch(() => null)
        : null;

    const allFindings = await store.findings.find({
      where: { runId: run.id },
      orderBy: { field: 'firstSeenAt', direction: 'asc' },
      limit: 500,
    });
    const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const reproductionTargets = [...allFindings]
      .filter((finding) => finding.confidence !== 'suspected')
      .sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9))
      .slice(0, 4);

    if (reproductionTargets.length > 0) {
      const reproducer = new Reproducer({
        store,
        run,
        evidence,
        tracesDir: path.join(runtime.config.dataDir, 'traces'),
        log,
        getStorageState: async () => {
          const stored = await vault.load(run.userId, origin).catch(() => null);
          return stored?.storageState ?? undefined;
        },
        createSession: async (options) =>
          BrowserSession.launch({
            runId: run.id,
            headless: appConfig.browser.headless,
            channel: appConfig.browser.channel,
            viewport: options.viewport,
            storageState: options.storageState,
            urlGuard: guard,
            traceDir: options.traceDir,
            artifactsDir: runtime.config.dataDir,
          }),
      });
      for (const finding of reproductionTargets) {
        if (control.stopped) break;
        await updateProgress(
          { message: `Reproducing: ${finding.title}`, currentAction: 'reproduction' },
          true,
        );
        await reproducer.reproduce(finding).catch(async (error: Error) => {
          await log('warn', `Reproduction failed for "${finding.title}": ${error.message}`);
        });
      }
    }

    const pages = await store.pages.find({ where: { runId: run.id }, limit: 500 });
    const actions = await store.actions.find({ where: { runId: run.id }, limit: 5_000 });
    const checksAll = await store.checks.find({ where: { runId: run.id }, limit: 5_000 });
    const snapshots = await store.snapshots.find({ where: { runId: run.id }, limit: 1_000 });
    const dimensions = await store.filterDimensions.find({ where: { runId: run.id }, limit: 100 });
    const combinations = await store.filterCombinations.find({ where: { runId: run.id }, limit: 500 });
    const finalFindings = await store.findings.find({
      where: { runId: run.id },
      orderBy: { field: 'firstSeenAt', direction: 'asc' },
      limit: 500,
    });
    const durationMs = Date.now() - startedAt;

    const coverage = buildCoverage({
      run,
      pages,
      actions,
      checks: checksAll,
      dimensions,
      combinations,
      snapshots,
      elementsDiscovered: stats.elementsDiscovered,
      elementsTested: stats.elementsTested,
      visitedPages: stats.pagesVisited,
      maxDepth: stats.maxDepth,
      loopsPrevented: stats.loopsPrevented,
      extraLimitations: stats.limitations,
      durationMs,
    });
    const summary = buildSummary({
      run,
      findings: finalFindings,
      checks: checksAll,
      pages,
      actions,
      dimensions,
      combinations,
      snapshots,
      elementsDiscovered: stats.elementsDiscovered,
      elementsTested: stats.elementsTested,
      visitedPages: stats.pagesVisited,
      loopsPrevented: stats.loopsPrevented,
      durationMs,
      coverage,
    });
    const narrative = await ai.summarize({
      summary,
      findings: finalFindings,
      url: run.url,
    });
    if (narrative) {
      await log('info', `AI executive summary: ${narrative}`);
    }

    const finalStatus: RunStatus = control.stopped ? 'cancelled' : 'completed';
    await setStatus(finalStatus, {
      finishedAt: nowIso(),
      durationMs,
      summary: { ...summary, narrative },
      coverage,
      error: null,
      progress: {
        ...run.progress,
        phase: finalStatus,
        phaseLabel: finalStatus === 'cancelled' ? 'Cancelled' : 'Completed',
        message:
          finalStatus === 'cancelled'
            ? 'Run cancelled by operator'
            : `${finalFindings.length} finding(s) across ${summary.pagesVisited} page(s)`,
        percent: 100,
        pagesDiscovered: pages.length,
        pagesVisited: stats.pagesVisited,
        actionsExecuted: stats.elementsTested,
        checksRun: checksAll.length,
        findings: finalFindings.length,
      },
    });
    await log('info', `Run completed in ${Math.round(durationMs / 1000)}s`, {
      findings: finalFindings.length,
      checks: checksAll.length,
      pages: pages.length,
    });

    const site = run.siteId ? await store.sites.get(run.siteId) : null;
    if (site) {
      await store.sites.update(site.id, {
        lastRunAt: nowIso(),
        runCount: site.runCount + 1,
      });
    }
    await store.audit.create({
      id: shortId('aud'),
      userId: run.userId,
      runId: run.id,
      action: 'run.completed',
      detail: { findings: finalFindings.length, status: finalStatus },
      ip: null,
      at: nowIso(),
    });
  } catch (error) {
    failure = (error as Error).message;
    console.error(`[smartqa] run ${run.id} failed:`, error);
    await log('error', `Run failed: ${failure}`).catch(() => undefined);
    try {
      const durationMs = Date.now() - startedAt;
      await setStatus('failed', {
        finishedAt: nowIso(),
        durationMs,
        error: failure,
        progress: {
          ...run.progress,
          phase: 'failed',
          phaseLabel: 'Failed',
          message: failure,
          percent: 100,
        },
      });
      await store.audit.create({
        id: shortId('aud'),
        userId: run.userId,
        runId: run.id,
        action: 'run.failed',
        detail: { error: failure },
        ip: null,
        at: nowIso(),
      });
    } catch {
      /* status persistence failure is unrecoverable */
    }
  } finally {
    clearInterval(heartbeat);
    if (session) {
      if (live) {
        await session.stopScreencast().catch(() => undefined);
        live.status = 'completed';
      }
      await session.close().catch(() => undefined);
    }
    removeRunControl(run.id);
    if (live) {
      const timer = setTimeout(() => removeLiveSession(live.id), 10 * 60_000);
      if (typeof timer.unref === 'function') timer.unref();
    }
    void failure;
  }
}

/** Convenience used by tests: run a synthetic config directly against a URL. */
export async function runSyntheticTest(input: {
  userId: string;
  url: string;
  mode?: 'live' | 'background';
  budgets?: Partial<TestRun['config']['budgets']>;
}): Promise<{ run: TestRun; handle: RunHandle }> {
  const store = await getStore();
  const now = nowIso();
  const run: TestRun = {
    id: shortId('run'),
    userId: input.userId,
    url: input.url,
    origin: new URL(input.url).origin,
    mode: input.mode ?? 'background',
    status: 'queued',
    config: {
      url: input.url,
      mode: input.mode ?? 'background',
      requireAuth: false,
      viewports: ['desktop'],
      budgets: {
        maxPages: 6,
        maxActions: 30,
        maxDepth: 2,
        actionsPerPage: 8,
        maxFilterCombinations: 8,
        maxDurationMs: 120_000,
        ...input.budgets,
      },
      seed: 12345,
      allowDestructiveActions: false,
      approvedActionPatterns: [],
      focus: 'full',
      captureScreenshots: true,
      recordTrace: true,
      reproductionAttempts: 1,
    },
    authState: 'not_required',
    progress: emptyProgress(),
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    heartbeatAt: null,
    cancelRequestedAt: null,
    siteId: null,
  };
  await store.runs.create(run);
  const handle = startRun(run);
  return { run, handle };
}
