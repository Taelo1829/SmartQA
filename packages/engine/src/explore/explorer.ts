import {
  nowIso,
  shortId,
  type ActionKind,
  type ActionRecord,
  type InteractiveElement,
  type LogLevel,
  type MetricSample,
  type PageState,
  type RunProgress,
  type Rng,
  type TestRun,
} from '@smartqa/shared';
import { normalizeUrl, sameOrigin, waitFor } from '@smartqa/shared';
import type { Store } from '@smartqa/db';
import type { BrowserSession } from '../browser/session';
import type { PageSnapshot, RawElement } from '../browser/domSnapshot';
import { pageOutcomeSignature, waitForActionOutcome, waitForDomQuiet } from '../browser/readiness';
import type { CheckService } from '../checks';
import type { EvidenceService } from '../evidence';
import type { FindingDraft, FindingService } from '../findings';
import type { RunEventBus } from '../events';
import type { FilterEngine } from '../validate/filters';
import { analyzeSnapshot } from '../detect/analyzeSnapshot';
import { assessActionRisk } from './safety';
import { isIgnorableConsoleError } from '../browser/collectors';

/**
 * Autonomous exploration engine.
 *
 * Breadth-first over a state graph keyed by (normalised URL + structural DOM
 * signature). Every discovered interactive element becomes an ActionRecord;
 * actions are ordered with the seeded RNG so two runs with the same seed replay
 * the same sequence, and previously visited states are never re-expanded.
 */

export interface ActionRanker {
  enabled: boolean;
  rankActions(input: {
    pageUrl: string;
    pageTitle: string;
    candidates: Array<{ id: string; label: string; kind: string }>;
  }): Promise<{ actionId: string; reason: string } | null>;
}

export interface ExplorerContext {
  run: TestRun;
  store: Store;
  session: BrowserSession;
  rng: Rng;
  checks: CheckService;
  findings: FindingService;
  evidence: EvidenceService;
  emit: RunEventBus;
  filterEngine: FilterEngine;
  captureSnapshot: () => Promise<PageSnapshot>;
  log: (level: LogLevel, message: string, data?: Record<string, unknown>) => Promise<void>;
  pauseGate: () => Promise<void>;
  deadlineReached: () => boolean;
  stopRequested: () => boolean;
  consumeAction: (count?: number) => boolean;
  actionsRemaining: () => number;
  onProgress: (patch: Partial<RunProgress>) => Promise<void>;
  /** Optional AI planner used only to re-rank already-discovered actions. */
  ranker?: ActionRanker;
}

export interface ExplorationStats {
  states: PageState[];
  actions: ActionRecord[];
  elementsDiscovered: number;
  elementsTested: number;
  elementsSkipped: number;
  loopsPrevented: number;
  maxDepth: number;
  pagesVisited: number;
  visitedUrls: string[];
  limitations: string[];
  dashboardChecks: number;
}

const MAX_ELEMENTS_PER_STATE = 60;
const MAX_ACTIONS_PER_STATE = 14;

const KIND_PRIORITY: Record<string, number> = {
  fill: 0,
  check: 1,
  pagination: 2,
  click: 3,
  select: 4,
};

export class Explorer {
  private readonly states = new Map<string, PageState>();
  private readonly actionIndex = new Map<string, ActionRecord[]>();
  private readonly analyzed = new Set<string>();
  private readonly testedElements = new Set<string>();
  private readonly discoveredElements = new Set<string>();
  private readonly limitations: string[] = [];
  private readonly visitedUrls = new Set<string>();
  private executedActions = 0;
  private loopsPrevented = 0;
  private maxDepth = 0;
  private skippedByPolicy = 0;
  private dashboardChecks = 0;
  /** Dashboards already validated, keyed by normalized URL so duplicate page states do not replay the campaign. */
  private dashboardPages = new Set<string>();

  constructor(private readonly ctx: ExplorerContext) {}

  get page() {
    return this.ctx.session.page;
  }

  private get stateKey(): (state: { normalizedUrl: string; signature: string }) => string {
    return (state) => `${state.normalizedUrl}#${state.signature}`;
  }

  async run(): Promise<void> {
    const { run, session } = this.ctx;
    await this.ctx.log('info', `Navigating to ${run.url}`, { seed: run.config.seed });
    const navigation = await session.navigate(run.url);
    await this.ctx.log('info', `Entry page loaded (HTTP ${navigation.status ?? 'n/a'})`, {
      readiness: navigation.readiness,
      durationMs: navigation.durationMs,
    });
    if (navigation.status && navigation.status >= 400) {
      await this.ctx.checks.record({
        kind: 'page_load',
        title: 'Entry page loads successfully',
        status: 'failed',
        detail: `Entry URL returned HTTP ${navigation.status}.`,
        pageUrl: run.url,
        deterministic: true,
      });
    } else {
      await this.ctx.checks.record({
        kind: 'page_load',
        title: 'Entry page loads successfully',
        status: 'passed',
        detail: `Entry page responded with HTTP ${navigation.status ?? 'unknown'} and rendered content.`,
        pageUrl: run.url,
        deterministic: true,
      });
    }

    const snapshot = await this.captureSnapshot();
    const entry = await this.registerState({
      snapshot,
      depth: 0,
      parentStateId: null,
      viaActionId: null,
    });
    await this.observe(entry, snapshot, null);

    while (!this.ctx.stopRequested()) {
      if (this.ctx.deadlineReached()) {
        this.limitations.push('The run reached its configured time limit before exploration finished.');
        break;
      }
      if (this.ctx.actionsRemaining() <= 0) break;
      const state = this.nextState();
      if (!state) break;
      await this.ctx.pauseGate();
      await this.expandState(state);
    }

    await this.responsivePass();
  }

  private nextState(): PageState | null {
    const candidates = [...this.states.values()].filter((state) => {
      const actions = this.actionIndex.get(state.id) ?? [];
      return actions.some((action) => action.status === 'pending');
    });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const pending = (state: PageState) =>
        (this.actionIndex.get(state.id) ?? []).filter((action) => action.status === 'pending').length;
      if (a.visitCount !== b.visitCount) return a.visitCount - b.visitCount;
      if (a.depth !== b.depth) return a.depth - b.depth;
      return pending(b) - pending(a);
    });
    return candidates[0] ?? null;
  }

  private async ensureAt(state: PageState): Promise<boolean> {
    const current = normalizeUrl(this.page.url());
    if (current !== state.normalizedUrl) {
      try {
        await this.ctx.session.navigate(state.normalizedUrl);
        await this.ctx.pauseGate();
        return true;
      } catch (error) {
        await this.ctx.log('warn', `Could not return to ${state.normalizedUrl}: ${(error as Error).message}`);
        return false;
      }
    }
    return true;
  }

  private async expandState(state: PageState): Promise<void> {
    const { run } = this.ctx;
    if (!(await this.ensureAt(state))) return;
    const snapshot = await this.captureSnapshot();

    // Re-register actions if the DOM changed since discovery (dynamic content).
    if (this.actionIndex.get(state.id)?.every((action) => action.status !== 'pending')) {
      await this.registerActions(state, snapshot);
    }
    await this.observe(state, snapshot, null);

    const actions = (this.actionIndex.get(state.id) ?? [])
      .filter((action) => action.status === 'pending')
      .slice(0, run.config.budgets.actionsPerPage)
      .sort((a, b) => {
        const delta = (KIND_PRIORITY[a.kind] ?? 9) - (KIND_PRIORITY[b.kind] ?? 9);
        if (delta !== 0) return delta;
        return a.elementLabel.localeCompare(b.elementLabel);
      });

    if (this.ctx.ranker?.enabled && actions.length > 3) {
      const ranked = await this.ctx.ranker
        .rankActions({
          pageUrl: snapshot.url,
          pageTitle: snapshot.title,
          candidates: actions.map((action) => ({
            id: action.id,
            label: action.elementLabel,
            kind: action.kind,
          })),
        })
        .catch(() => null);
      if (ranked) {
        const index = actions.findIndex((action) => action.id === ranked.actionId);
        if (index > 0) {
          const [chosen] = actions.splice(index, 1);
          if (chosen) actions.unshift(chosen);
        }
        await this.ctx.log('info', `AI planner prioritised the next action: ${ranked.reason}`, {
          actionId: ranked.actionId,
        });
      }
    }

    for (const action of actions) {
      if (this.ctx.stopRequested() || this.ctx.deadlineReached()) return;
      if (!this.ctx.consumeAction(1)) return;
      await this.ctx.pauseGate();
      await this.executeAndRecord(state, action);
      if (this.page.url() !== state.url && !this.page.isClosed()) {
        // Return to the parent state so its remaining actions stay reachable.
        if (!(await this.ensureAt(state))) return;
        await waitForDomQuiet(this.page, 200, 2_000);
      }
    }

    state.visitCount += 1;
    state.visitedAt = nowIso();
    await this.ctx.store.pages.update(state.id, { visitCount: state.visitCount, visitedAt: state.visitedAt });
    this.visitedUrls.add(state.url);
  }

  private async executeAndRecord(state: PageState, action: ActionRecord): Promise<void> {
    const element = action.element;
    if (!element) {
      await this.updateAction(action, { status: 'skipped', outcome: 'unknown', error: 'No element reference' });
      return;
    }
    if (action.destructiveRisk === 'blocked') {
      this.skippedByPolicy += 1;
      await this.updateAction(action, { status: 'blocked', outcome: 'unknown', error: 'Blocked by safety policy' });
      await this.ctx.log('warn', `Blocked potentially destructive action: "${action.elementLabel}"`, {
        reason: action.error,
        selector: element.selector,
      });
      return;
    }
    if (action.destructiveRisk === 'possible' && !this.ctx.run.config.allowDestructiveActions) {
      this.skippedByPolicy += 1;
      await this.updateAction(action, {
        status: 'skipped',
        outcome: 'unknown',
        error: 'State-changing action skipped (destructive testing disabled)',
      });
      return;
    }

    await this.updateAction(action, { status: 'running' });
    await this.ctx.emit.emit({ type: 'action', action });
    const startedAt = Date.now();
    const signalMark = this.ctx.session.signals.mark();
    const finderCountBefore = this.ctx.findings.total;
    const beforeUrl = this.page.url();
    const beforeSignature = await this.signatureOfPage();
    // Outcome detection must compare like-for-like signatures. `signatureOfPage`
    // is the structural hash (used for page-state registration), so capture a
    // separate baseline with the same function `waitForActionOutcome` polls.
    const beforeOutcomeSignature = await pageOutcomeSignature(this.page);

    let outcome: ActionRecord['outcome'] = 'unknown';
    let errorMessage: string | null = null;

    try {
      const locator = await this.locate(element);
      if (!locator) {
        await this.updateAction(action, {
          status: 'failed',
          outcome: 'failed',
          error: 'Element could not be located (stale discovery)',
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      if (action.kind === 'fill') {
        await locator.fill(action.value ?? 'test', { timeout: 8_000 });
        await locator.press('Enter').catch(() => undefined);
      } else if (action.kind === 'select') {
        await locator.selectOption({ index: 1 }, { timeout: 8_000 }).catch(() => undefined);
      } else if (action.kind === 'check') {
        const checked = await locator.isChecked().catch(() => false);
        if (!checked) await locator.click({ timeout: 8_000 });
      } else {
        await locator.click({ timeout: 8_000 });
      }

      const change = await waitForActionOutcome(this.page, beforeUrl, beforeOutcomeSignature, { timeoutMs: 4_500 });
      outcome = change === 'navigated' ? 'navigated' : change === 'dom_changed' ? 'dom_changed' : 'no_change';
      await waitForDomQuiet(this.page, 250, 2_500);
    } catch (error) {
      errorMessage = (error as Error).message.split('\n')[0] ?? 'Action failed';
      outcome = 'failed';
    }

    const durationMs = Date.now() - startedAt;
    const afterUrl = this.page.isClosed() ? beforeUrl : this.page.url();
    const afterSignature = this.page.isClosed() ? beforeSignature : await this.signatureOfPage();
    const signals = this.ctx.session.signals.summarySince(signalMark);
    action.signals = {
      consoleErrors: signals.consoleErrors,
      pageErrors: signals.pageErrors,
      failedRequests: signals.failedRequests,
      httpErrors: signals.httpErrors,
      brokenImages: 0,
      sentinelHits: 0,
      networkRequests: signals.networkRequests,
    };

    let resultStateId: string | null = null;
    if (outcome === 'navigated' || (outcome === 'dom_changed' && afterSignature !== beforeSignature)) {
      const snapshot = await this.captureSnapshot();
      const child = await this.registerState({
        snapshot,
        depth: state.depth + 1,
        parentStateId: state.id,
        viaActionId: action.id,
      });
      resultStateId = child.id;
      await this.observe(child, snapshot, action.id);
    } else {
      const snapshot = await this.captureSnapshot();
      await this.observe(state, snapshot, action.id, { lightweight: true });
      resultStateId = state.id;
    }

    await this.updateAction(action, {
      status: outcome === 'failed' ? 'failed' : 'executed',
      outcome,
      urlAfter: afterUrl,
      resultStateId,
      durationMs,
      error: errorMessage,
    });
    this.executedActions += 1;
    this.testedElements.add(`${state.id}::${element.selector}::${action.kind}`);

    await this.reportSignals(state, action, signalMark);
    await this.checkActionBehaviour(state, action, outcome, signals.networkRequests, errorMessage);
    await this.checkStuckLoading(state, action, resultStateId);

    if (this.ctx.findings.total > finderCountBefore && !this.page.isClosed()) {
      const screenshot = await this.ctx.evidence.screenshot(this.ctx.run.id, this.page, `Evidence for action: ${action.description}`);
      if (screenshot) {
        const findings = await this.ctx.store.findings.find({
          where: { runId: this.ctx.run.id, actionId: action.id },
          limit: 20,
        });
        for (const finding of findings) await this.ctx.evidence.attach(finding, [screenshot]);
      }
    }

    await this.ctx.onProgress({
      pagesDiscovered: this.states.size,
      pagesVisited: this.visitedUrls.size,
      actionsExecuted: this.executedActions,
      currentUrl: this.page.isClosed() ? state.url : this.page.url(),
      currentAction: action.description,
    });
  }

  private async updateAction(
    action: ActionRecord,
    patch: Partial<ActionRecord>,
  ): Promise<ActionRecord> {
    Object.assign(action, patch);
    const saved = await this.ctx.store.actions.update(action.id, patch);
    Object.assign(action, saved);
    this.ctx.emit.emit({ type: 'action', action: saved });
    return saved;
  }

  private async locate(element: { selector: string; fallbackSelectors?: string[] }) {
    const candidates = [element.selector, ...(element.fallbackSelectors ?? [])];
    for (const candidate of candidates) {
      try {
        const locator = this.page.locator(candidate).first();
        if ((await locator.count()) === 0) continue;
        if (!(await locator.isVisible().catch(() => false))) continue;
        return locator;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async signatureOfPage(): Promise<string> {
    try {
      const snapshot = await this.captureSnapshot();
      return snapshot.domSignature;
    } catch {
      return 'unknown';
    }
  }

  private async captureSnapshot(): Promise<PageSnapshot> {
    return this.ctx.captureSnapshot();
  }

  // -------------------------------------------------------------- state graph
  private async registerState(input: {
    snapshot: PageSnapshot;
    depth: number;
    parentStateId: string | null;
    viaActionId: string | null;
  }): Promise<PageState> {
    const normalizedUrl = normalizeUrl(input.snapshot.url);
    const key = this.stateKey({ normalizedUrl, signature: input.snapshot.domSignature });
    const existing = this.states.get(key);
    if (existing) {
      if (existing.normalizedUrl !== normalizedUrl) this.loopsPrevented += 1;
      return existing;
    }

    if (this.states.size >= this.ctx.run.config.budgets.maxPages) {
      this.limitations.push(
        `Page budget (${this.ctx.run.config.budgets.maxPages}) reached; additional discovered pages were not explored.`,
      );
      const placeholder = this.createPlaceholderState(input, normalizedUrl);
      this.states.set(key, placeholder);
      return placeholder;
    }

    const state: PageState = {
      id: shortId('pst'),
      runId: this.ctx.run.id,
      url: input.snapshot.url,
      normalizedUrl,
      title: input.snapshot.title,
      signature: input.snapshot.domSignature,
      depth: input.depth,
      parentStateId: input.parentStateId,
      viaActionId: input.viaActionId,
      discoveredAt: nowIso(),
      visitedAt: null,
      visitCount: 0,
      interactiveCount: input.snapshot.elements.length,
      screenshotId: null,
      skeleton: false,
    };
    await this.ctx.store.pages.create(state);
    this.states.set(key, state);
    this.maxDepth = Math.max(this.maxDepth, input.depth);
    this.ctx.emit.emit({ type: 'page', page: state });
    await this.registerActions(state, input.snapshot);
    await this.ctx.log('info', `Discovered page: ${state.title || state.url}`, {
      depth: input.depth,
      elements: input.snapshot.elements.length,
      stateId: state.id,
    });
    return state;
  }

  private createPlaceholderState(
    input: { snapshot: PageSnapshot; depth: number; parentStateId: string | null; viaActionId: string | null },
    normalizedUrl: string,
  ): PageState {
    return {
      id: shortId('pst'),
      runId: this.ctx.run.id,
      url: input.snapshot.url,
      normalizedUrl,
      title: input.snapshot.title,
      signature: input.snapshot.domSignature,
      depth: input.depth,
      parentStateId: input.parentStateId,
      viaActionId: input.viaActionId,
      discoveredAt: nowIso(),
      visitedAt: null,
      visitCount: 0,
      interactiveCount: 0,
      screenshotId: null,
      skeleton: true,
    };
  }

  private async registerActions(state: PageState, snapshot: PageSnapshot): Promise<ActionRecord[]> {
    if (this.actionIndex.has(state.id) && (this.actionIndex.get(state.id) ?? []).length > 0) {
      return this.actionIndex.get(state.id) ?? [];
    }
    const actions: ActionRecord[] = [];
    const seenSelectors = new Set<string>();
    const origin = new URL(this.ctx.run.url).origin;

    for (const raw of snapshot.elements.slice(0, MAX_ELEMENTS_PER_STATE)) {
      const kind = this.kindFor(raw);
      if (!kind) continue;
      const dedupe = `${raw.selector}::${kind}`;
      if (seenSelectors.has(dedupe)) continue;
      seenSelectors.add(dedupe);

      const risk = assessActionRisk({
        label: raw.label,
        detail: raw.testId ?? raw.elementId,
        category: raw.category as InteractiveElement['category'],
        href: raw.href,
        inputType: raw.inputType,
        targetOrigin: origin,
        allowDestructive: this.ctx.run.config.allowDestructiveActions,
        approvedPatterns: this.ctx.run.config.approvedActionPatterns,
      });

      const action: ActionRecord = {
        id: shortId('act'),
        runId: this.ctx.run.id,
        pageStateId: state.id,
        kind,
        status: 'pending',
        element: {
          selector: raw.selector,
          fallbackSelectors: raw.fallbackSelectors,
          tag: raw.tag,
          role: raw.role ?? undefined,
          label: raw.label,
          box: raw.box,
          elementId: raw.elementId,
          testId: raw.testId,
          href: raw.href,
          inputType: raw.inputType,
        },
        elementLabel: raw.label,
        value: null,
        description: this.describeAction(kind, raw),
        destructiveRisk: risk.risk === 'blocked' ? 'blocked' : risk.risk,
        startedAt: nowIso(),
        durationMs: null,
        resultStateId: null,
        urlBefore: state.url,
        urlAfter: null,
        outcome: 'unknown',
        error: risk.risk === 'blocked' ? risk.reason : null,
        signals: null,
      };
      actions.push(action);
      this.discoveredElements.add(`${state.id}::${raw.selector}::${kind}`);
    }

    await this.ctx.store.actions.createMany(actions);
    this.actionIndex.set(state.id, actions);
    return actions;
  }

  private kindFor(raw: RawElement): ActionKind | null {
    switch (raw.category) {
      case 'link':
        return 'click';
      case 'button':
      case 'tab':
      case 'accordion':
      case 'menuitem':
      case 'menu':
        return 'click';
      case 'checkbox':
      case 'radio':
        return 'check';
      case 'filter':
        return 'click';
      case 'pagination':
        return 'pagination';
      case 'search':
        return 'fill';
      case 'input':
      case 'combobox':
        return raw.inputType === 'file' ? null : 'fill';
      case 'textarea':
        return 'fill';
      case 'select':
        return null; // handled by the filter engine, which knows the options
      default:
        return raw.tag === 'a' ? 'click' : null;
    }
  }

  private describeAction(kind: ActionKind, raw: RawElement): string {
    switch (kind) {
      case 'fill':
        return `Type a test query into "${raw.label}"`;
      case 'check':
        return `Toggle "${raw.label}"`;
      case 'pagination':
        return `Navigate using "${raw.label}"`;
      default:
        return `Click "${raw.label}"`;
    }
  }

  // -------------------------------------------------------------- observation
  private async observe(
    state: PageState,
    snapshot: PageSnapshot,
    actionId: string | null,
    options: { lightweight?: boolean } = {},
  ): Promise<void> {
    let working = snapshot;
    const resolved = await this.tryResolveBlockingModal(working).catch(() => null);
    if (resolved) working = resolved;

    const viewport = this.ctx.run.config.viewports[0] ?? 'desktop';
    const key = `${state.id}#${working.domSignature}#${viewport}`;
    if (this.analyzed.has(key)) return;
    this.analyzed.add(key);

    const analysis = analyzeSnapshot(working, {
      runId: this.ctx.run.id,
      pageUrl: working.url,
      pageTitle: working.title,
      pageStateId: state.id,
      actionId,
      viewport,
    });
    for (const draft of analysis.findings) await this.ctx.findings.record(draft);
    await this.ctx.checks.recordDrafts(analysis.checks, {
      pageUrl: working.url,
      actionId,
      pageStateId: state.id,
    });

    if (!options.lightweight && analysis.metrics.length > 0) {
      await this.persistPageSnapshot(state, working, analysis.metrics);
    }

    const dashboardKey = normalizeUrl(working.url);
    if (!this.dashboardPages.has(dashboardKey) && working.filters.length >= 2 && analysis.metrics.length >= 2) {
      this.dashboardPages.add(dashboardKey);
      const outcome = await this.ctx.filterEngine.validatePage(state, working);
      this.dashboardChecks += outcome.additivityChecks + outcome.orderChecks + outcome.resetChecks;
      await this.ctx.log(
        outcome.tested ? 'info' : 'warn',
        `Dashboard validation: ${outcome.reason}`,
        {
          dimensions: outcome.dimensions,
          planned: outcome.planned,
          executed: outcome.executed,
        },
      );
      if (outcome.tested) {
        this.limitations.push(
          `Filter coverage on ${state.url}: ${outcome.executed} of ${outcome.planned} planned combinations executed (budget-bounded).`,
        );
      }
    }
  }

  /**
   * Resolve a blocking selection dialog (e.g. "select supplier group") so the
   * underlying view can be tested. Without this, pages that require a modal
   * choice before showing data remain stuck and may display placeholder
   * NaN/undefined values that are not real defects.
   */
  private async tryResolveBlockingModal(snapshot: PageSnapshot): Promise<PageSnapshot | null> {
    if (!snapshot.modal || this.page.isClosed()) return null;
    const dialog = this.page.locator('[role="dialog"], [aria-modal="true"]').filter({ visible: true }).first();
    if (!(await dialog.isVisible().catch(() => false))) return null;

    let acted = false;
    const controlPattern = /^(apply|confirm|continue|ok|select( all)?|submit|done|save|view|show|close|cancel|dismiss|back|clear|reset)$/i;
    const primaryPattern = /apply|confirm|continue|ok|submit|done|save|view|show|select( group)?/i;
    const isControlLabel = (label: string): boolean => controlPattern.test(label.trim());

    // Native selects inside the dialog: choose a non-placeholder option.
    const selects = dialog.locator('select');
    const selectCount = await selects.count().catch(() => 0);
    for (let i = 0; i < Math.min(selectCount, 8); i += 1) {
      const sel = selects.nth(i);
      if (!(await sel.isVisible().catch(() => false))) continue;
      const selectedIndex = await sel
        .evaluate((el) => (el as HTMLSelectElement).selectedIndex)
        .catch(() => -1);
      const optionTexts = await sel.locator('option').allTextContents().catch(() => [] as string[]);
      const firstIsPlaceholder =
        optionTexts.length > 0 && /^(select|choose|--|—|all|none|$)/i.test((optionTexts[0] ?? '').trim());
      const currentText = (optionTexts[selectedIndex] ?? '').trim();
      const needsChoice =
        selectedIndex < 0 ||
        (selectedIndex === 0 && (firstIsPlaceholder || currentText === '')) ||
        /^(select|choose)/i.test(currentText);
      if (!needsChoice) continue;
      const targetIndex = firstIsPlaceholder && optionTexts.length > 1 ? 1 : 0;
      const value = await sel
        .locator('option')
        .nth(targetIndex)
        .getAttribute('value')
        .catch(() => null);
      try {
        if (value != null) await sel.selectOption(value, { timeout: 3_000 });
        else await sel.selectOption({ index: targetIndex }, { timeout: 3_000 });
        acted = true;
      } catch {
        /* ignore selection failure and continue */
      }
    }

    // Custom option groups (role=option/radio/checkbox/treeitem) when nothing is selected.
    const anySelected = async (): Promise<boolean> =>
      (await dialog
        .locator(
          '[role="option"][aria-selected="true"], [role="radio"][aria-checked="true"], [role="checkbox"][aria-checked="true"], [role="menuitemradio"][aria-checked="true"], [aria-pressed="true"], input:checked, [data-selected="true"], .selected, .active',
        )
        .count()
        .catch(() => 0)) > 0;

    if (!(await anySelected())) {
      const candidates = dialog.locator(
        '[role="option"], [role="radio"], [role="menuitemradio"], [role="checkbox"], [role="treeitem"], li, [data-value], [data-id], [data-key]',
      );
      const count = await candidates.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 40); i += 1) {
        const candidate = candidates.nth(i);
        if (!(await candidate.isVisible().catch(() => false))) continue;
        const text = ((await candidate.innerText().catch(() => '')) || '').trim();
        if (!text || isControlLabel(text) || /cancel|close|dismiss|back/i.test(text)) continue;
        // Avoid clicking a container that includes the whole dialog text.
        if (text.length > 120) continue;
        await candidate.click({ timeout: 3_000 }).catch(() => undefined);
        acted = true;
        await waitForDomQuiet(this.page, 200, 1_500);
        if (await anySelected()) break;
      }
    }

    // Fallback: click a small, dialog-local button/row that looks like a selectable choice.
    if (!(await anySelected())) {
      const candidates = dialog.locator('button, [role="button"], [tabindex]');
      const count = await candidates.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 30); i += 1) {
        const candidate = candidates.nth(i);
        if (!(await candidate.isVisible().catch(() => false))) continue;
        const text = ((await candidate.innerText().catch(() => '')) || '').trim();
        if (!text || text.length > 80) continue;
        if (isControlLabel(text) || primaryPattern.test(text) || /cancel|close|dismiss|back/i.test(text)) continue;
        await candidate.click({ timeout: 3_000 }).catch(() => undefined);
        acted = true;
        await waitForDomQuiet(this.page, 200, 1_500);
        if (await anySelected()) break;
      }
    }

    // Click a primary/apply action if present.
    const apply = dialog.getByRole('button', { name: primaryPattern }).first();
    if ((await apply.isVisible().catch(() => false))) {
      const label = ((await apply.innerText().catch(() => '')) || '').trim();
      if (!/cancel|close|dismiss|back/i.test(label)) {
        await apply.click({ timeout: 4_000 }).catch(() => undefined);
        acted = true;
      }
    }

    if (!acted) return null;

    await waitForDomQuiet(this.page, 450, 4_500);
    // A second apply attempt helps when selection enables the button asynchronously.
    if (await dialog.isVisible().catch(() => false)) {
      const apply2 = dialog.getByRole('button', { name: primaryPattern }).first();
      if ((await apply2.isVisible().catch(() => false))) {
        const label = ((await apply2.innerText().catch(() => '')) || '').trim();
        if (!/cancel|close|dismiss|back/i.test(label)) {
          await apply2.click({ timeout: 4_000 }).catch(() => undefined);
          await waitForDomQuiet(this.page, 450, 4_500);
        }
      }
    }

    await this.ctx.log('info', 'Attempted to complete an open dialog before analysis', {
      modal: snapshot.modal.text.slice(0, 160),
    });
    return this.captureSnapshot().catch(() => null);
  }

  private async persistPageSnapshot(
    state: PageState,
    snapshot: PageSnapshot,
    metrics: MetricSample[],
  ): Promise<void> {
    const existing = await this.ctx.store.snapshots.find({
      where: { runId: this.ctx.run.id, pageStateId: state.id },
      limit: 1,
    });
    if (existing.length > 0) return;
    const record = await this.ctx.store.snapshots.create({
      id: shortId('snp'),
      runId: this.ctx.run.id,
      pageStateId: state.id,
      combinationId: null,
      pageUrl: snapshot.url,
      capturedAt: nowIso(),
      metrics,
      table: snapshot.tables[0]
        ? {
            headers: snapshot.tables[0].headers,
            rows: snapshot.tables[0].rows.slice(0, 25),
            rowCount: snapshot.tables[0].rowCount,
            page: snapshot.tables[0].page,
            totalPages: snapshot.tables[0].totalPages,
            paginationLabel: snapshot.tables[0].paginationLabel,
          }
        : null,
      rowCount: snapshot.tables[0]?.rowCount ?? null,
      notes: 'Initial page observation',
      viewport: this.ctx.run.config.viewports[0] ?? 'desktop',
    });
    this.ctx.emit.emit({ type: 'snapshot', snapshot: record });
    void metrics;
  }

  // --------------------------------------------------------------- detection
  private async reportSignals(state: PageState, action: ActionRecord, since: number): Promise<void> {
    const events = this.ctx.session.signals.eventsSince(since);
    const findingDrafts: FindingDraft[] = [];

    const httpByUrl = new Map<string, number>();
    for (const http of events.http) {
      if (/favicon\.ico/i.test(http.url)) continue;
      if (http.resourceType === 'image') continue; // covered by broken-image detection
      let pathname: string;
      try {
        pathname = new URL(http.url, state.url).pathname;
      } catch {
        pathname = http.url;
      }
      const key = `${http.status}::${pathname}`;
      httpByUrl.set(key, (httpByUrl.get(key) ?? 0) + 1);
    }
    for (const [key, count] of httpByUrl) {
      const separatorIndex = key.indexOf('::');
      const status = Number(key.slice(0, separatorIndex));
      const path = key.slice(separatorIndex + 2);
      findingDrafts.push({
        category: 'http_error',
        severity: status >= 500 ? 'high' : 'medium',
        confidence: 'confirmed',
        title: `HTTP ${status} returned by ${path}`,
        description: `The page requested ${path} and the server responded with HTTP ${status} (${count} occurrence(s)) during "${action.description}".`,
        observed: `HTTP ${status}`,
        expected: 'HTTP 2xx/3xx response',
        pageUrl: state.url,
        pageStateId: state.id,
        actionId: action.id,
        elementLabel: action.elementLabel,
        fingerprintKey: `http:${key}`,
        tags: ['network', `status-${status}`],
      });
    }

    for (const failure of events.failures) {
      if (/ERR_ABORTED|blockedbyclient|NS_BINDING_ABORTED/i.test(failure.reason)) continue;
      if (/favicon\.ico/i.test(failure.url)) continue;
      findingDrafts.push({
        category: 'network_failure',
        severity: 'medium',
        confidence: 'confirmed',
        title: `Network request failed: ${failure.reason}`,
        description: `${failure.method} ${failure.url} failed with "${failure.reason}" while performing "${action.description}".`,
        observed: `${failure.reason} (${failure.resourceType})`,
        expected: 'Request completes successfully',
        pageUrl: state.url,
        pageStateId: state.id,
        actionId: action.id,
        elementLabel: action.elementLabel,
        fingerprintKey: `netfail:${failure.url}:${failure.reason}`,
        tags: ['network'],
      });
    }

    for (const error of events.pageErrors) {
      const isUnhandledRejection = /unhandled/i.test(error.message);
      findingDrafts.push({
        category: isUnhandledRejection ? 'unhandled_rejection' : 'runtime_exception',
        severity: isUnhandledRejection ? 'high' : 'critical',
        confidence: 'confirmed',
        title: isUnhandledRejection
          ? `Unhandled promise rejection: ${error.message.split('\n')[0]}`
          : `Uncaught JavaScript exception: ${error.message.split('\n')[0]}`,
        description: `An ${isUnhandledRejection ? 'unhandled promise rejection' : 'uncaught exception'} occurred while performing "${action.description}". Stack: ${error.stack}`,
        observed: error.message,
        expected: 'No uncaught exceptions during interaction',
        pageUrl: state.url,
        pageStateId: state.id,
        actionId: action.id,
        elementLabel: action.elementLabel,
        fingerprintKey: `pageerror:${error.message.slice(0, 120)}`,
        tags: ['javascript', 'runtime'],
      });
    }

    for (const message of events.console) {
      if (message.type !== 'error') continue;
      if (isIgnorableConsoleError(message.text)) continue;
      const unhandled = message.text.includes('[smartqa:unhandledrejection]');
      findingDrafts.push({
        category: unhandled ? 'unhandled_rejection' : 'console_error',
        severity: 'high',
        confidence: 'confirmed',
        title: unhandled
          ? `Unhandled promise rejection: ${cleanConsole(message.text)}`
          : `Console error: ${cleanConsole(message.text)}`,
        description: `The browser console reported an error during "${action.description}": ${message.text}${message.location ? ` (${message.location})` : ''}`,
        observed: message.text,
        expected: 'No console errors during interaction',
        pageUrl: state.url,
        pageStateId: state.id,
        actionId: action.id,
        elementLabel: action.elementLabel,
        fingerprintKey: `console:${message.text.slice(0, 140)}`,
        tags: ['console'],
      });
    }

    for (const draft of findingDrafts) await this.ctx.findings.record(draft);

    if (findingDrafts.length > 0) {
      const log = events.console.map((event) => `[${event.type}] ${event.text}`).join('\n');
      if (log) await this.ctx.evidence.text(this.ctx.run.id, 'console_log', 'Console output', log);
      const network = [...events.http, ...events.failures]
        .map((event) => `${'status' in event ? event.status : event.reason} ${event.url}`)
        .join('\n');
      if (network) await this.ctx.evidence.text(this.ctx.run.id, 'network_log', 'Network failures', network);
    }
  }

  private async checkActionBehaviour(
    state: PageState,
    action: ActionRecord,
    outcome: ActionRecord['outcome'],
    networkRequests: number,
    errorMessage: string | null,
  ): Promise<void> {
    if (errorMessage && /intercepts pointer events|detached|not visible/i.test(errorMessage)) {
      await this.ctx.findings.record({
        category: 'nonfunctional_control',
        severity: 'medium',
        confidence: 'probable',
        title: `Control could not be activated: "${action.elementLabel}"`,
        description: `Attempting to activate "${action.elementLabel}" failed: ${errorMessage}. The element may be covered, disabled, or detached from the DOM.`,
        observed: errorMessage,
        expected: 'Control is clickable and visible',
        pageUrl: state.url,
        pageStateId: state.id,
        actionId: action.id,
        elementLabel: action.elementLabel,
        selector: action.element?.selector ?? null,
        fingerprintKey: `unclickable:${action.element?.selector ?? action.elementLabel}`,
        tags: ['interaction'],
      });
      return;
    }

    const isControl = ['button', 'tab', 'accordion', 'menuitem', 'filter', 'menu'].includes(
      action.element?.tag ?? '',
    ) || action.element?.role === 'button';
    let noopDetected = false;

    if (outcome === 'no_change' && networkRequests === 0 && isControl) {
      noopDetected = true;
      const assessment = assessNoOpControl(action.elementLabel);
      await this.ctx.findings.record({
        category: 'nonfunctional_control',
        severity: 'medium',
        confidence: 'probable',
        title: assessment.title,
        description: assessment.description,
        observed: 'No navigation, DOM change or network activity',
        expected: assessment.expected,
        pageUrl: state.url,
        pageStateId: state.id,
        actionId: action.id,
        elementLabel: action.elementLabel,
        selector: action.element?.selector ?? null,
        fingerprintKey: `noop:${action.element?.selector ?? action.elementLabel}`,
        tags: ['interaction', 'wiring'],
        suspectedReason: assessment.suspectedReason,
      });
      await this.ctx.checks.record({
        kind: 'control_responds',
        title: `"${action.elementLabel}" has an observable effect`,
        status: 'warning',
        detail: 'No navigation, DOM change or network activity after activation.',
        pageUrl: state.url,
        pageStateId: state.id,
        actionId: action.id,
      });
    }

    if (outcome === 'no_change' && action.kind === 'pagination') {
      await this.ctx.findings.record({
        category: 'broken_pagination',
        severity: 'medium',
        confidence: 'confirmed',
        title: `Pagination control did not change the table: "${action.elementLabel}"`,
        description: `Clicking "${action.elementLabel}" left the page and the rendered rows unchanged.`,
        observed: 'No page change after pagination click',
        expected: 'The table advances to the requested page',
        pageUrl: state.url,
        pageStateId: state.id,
        actionId: action.id,
        elementLabel: action.elementLabel,
        fingerprintKey: `pagination:${action.element?.selector ?? action.elementLabel}`,
        tags: ['pagination'],
      });
      await this.ctx.checks.record({
        kind: 'pagination',
        title: `Pagination control changes the table: "${action.elementLabel}"`,
        status: 'failed',
        detail: 'No page change after pagination click.',
        pageUrl: state.url,
        pageStateId: state.id,
        actionId: action.id,
      });
    }

    if (outcome !== 'failed' && !noopDetected && action.kind !== 'pagination') {
      await this.ctx.checks.record({
        kind: 'control_responds',
        title: `"${action.elementLabel}" responds to interaction`,
        status: 'passed',
        detail: `Outcome: ${outcome}`,
        pageUrl: state.url,
        pageStateId: state.id,
        actionId: action.id,
      });
    }
  }

  private async checkStuckLoading(
    state: PageState,
    action: ActionRecord,
    resultStateId: string | null,
  ): Promise<void> {
    if (this.page.isClosed()) return;
    const resultState = resultStateId ? (this.states.get(resultStateId) ?? state) : state;
    const before = await this.captureSnapshot();
    const spinner = before.spinners.find((item) => item.visible);
    if (!spinner) return;

    const signalMark = this.ctx.session.signals.mark();
    const hidden = await waitFor(
      async () => {
        const snapshot = await this.captureSnapshot();
        return !snapshot.spinners.some((item) => item.visible);
      },
      { timeoutMs: 6_000, intervalMs: 700 },
    );

    if (hidden) {
      await this.ctx.checks.record({
        kind: 'loading_resolves',
        title: 'Loading indicator resolves',
        status: 'passed',
        detail: `Loading indicator "${spinner.label}" disappeared within 6s.`,
        pageUrl: resultState.url,
        pageStateId: resultState.id,
        actionId: action.id,
        deterministic: true,
      });
      return;
    }

    const signals = this.ctx.session.signals.summarySince(signalMark);
    await this.ctx.findings.record({
      category: 'infinite_loading',
      severity: 'high',
      confidence: signals.networkRequests === 0 ? 'confirmed' : 'probable',
      title: `Loading indicator never resolves: "${spinner.label}"`,
      description:
        `A loading indicator was still visible 6 seconds after "${action.description}"` +
        (signals.networkRequests === 0
          ? ', with no network activity during that window.'
          : ` (${signals.networkRequests} network request(s) completed without dismissing it).`),
      observed: `Loading indicator "${spinner.label}" still visible after 6s`,
      expected: 'Loading state resolves to content or an error state',
      pageUrl: resultState.url,
      pageStateId: resultState.id,
      actionId: action.id,
      elementLabel: action.elementLabel,
      selector: spinner.selector,
      // Stable across revisits: the same stuck indicator on the same page is
      // one defect with multiple occurrences, not a new finding per action.
      fingerprintKey: `loading:${spinner.selector}`,
      tags: ['loading'],
    });
    await this.ctx.checks.record({
      kind: 'loading_resolves',
      title: 'Loading indicator resolves',
      status: 'failed',
      detail: `Loading indicator "${spinner.label}" still visible after 6s.`,
      pageUrl: resultState.url,
      pageStateId: resultState.id,
      actionId: action.id,
      deterministic: true,
    });
  }

  // -------------------------------------------------------------- responsive
  private async responsivePass(): Promise<void> {
    const { run } = this.ctx;
    if (!run.config.viewports.includes('mobile')) {
      this.limitations.push('Mobile viewport testing was not requested for this run.');
      return;
    }
    const targets = [...this.states.values()].filter((state) => !state.skeleton).slice(0, 4);
    if (targets.length === 0) return;
    await this.ctx.log('info', 'Starting mobile viewport pass', { pages: targets.length });
    try {
      await this.ctx.session.setViewport('mobile');
      for (const state of targets) {
        if (this.ctx.deadlineReached() || this.ctx.stopRequested()) break;
        await this.ctx.pauseGate();
        try {
          await this.ctx.session.navigate(state.normalizedUrl);
          const snapshot = await this.captureSnapshot();
          const analysis = analyzeSnapshot(snapshot, {
            runId: run.id,
            pageUrl: snapshot.url,
            pageTitle: snapshot.title,
            pageStateId: state.id,
            actionId: null,
            viewport: 'mobile',
          });
          for (const draft of analysis.findings) await this.ctx.findings.record(draft);
          await this.ctx.checks.recordDrafts(analysis.checks, {
            pageUrl: snapshot.url,
            pageStateId: state.id,
          });
        } catch (error) {
          await this.ctx.log('warn', `Mobile pass failed for ${state.normalizedUrl}: ${(error as Error).message}`);
        }
      }
    } finally {
      await this.ctx.session.setViewport('desktop');
    }
  }

  // ------------------------------------------------------------------ summary
  stats(): ExplorationStats {
    const states = [...this.states.values()];
    const actions = [...this.actionIndex.values()].flat();
    const skipped = actions.filter((action) => action.status === 'skipped' || action.status === 'blocked').length;
    const limitations = [...this.limitations];
    if (this.skippedByPolicy > 0) {
      limitations.push(
        `${this.skippedByPolicy} interaction(s) were skipped by the destructive-action policy.`,
      );
    }
    if (actions.some((action) => action.status === 'pending')) {
      limitations.push(
        `${actions.filter((action) => action.status === 'pending').length} discovered interaction(s) remained untested when the run ended.`,
      );
    }
    if (states.some((state) => state.skeleton)) {
      limitations.push('Some discovered pages were recorded but not visited because the page budget was reached.');
    }
    const tested = actions.filter(
      (action) => action.status === 'executed' || action.status === 'failed',
    ).length;
    return {
      states,
      actions,
      elementsDiscovered: this.discoveredElements.size,
      elementsTested: tested,
      elementsSkipped: skipped,
      loopsPrevented: this.loopsPrevented,
      maxDepth: this.maxDepth,
      pagesVisited: this.visitedUrls.size,
      visitedUrls: [...this.visitedUrls],
      limitations,
      dashboardChecks: this.dashboardChecks,
    };
  }

  markVisitedFromCurrentPage(): void {
    this.visitedUrls.add(this.page.url());
  }

  get exploredElementCount(): number {
    return this.testedElements.size;
  }
}

export interface NoOpControlAssessment {
  hiddenEffectPossible: boolean;
  title: string;
  description: string;
  expected: string;
  suspectedReason: string;
}

/**
 * A control with no DOM/navigation/network effect is suspicious, but downloads
 * and clipboard writes can be invisible to the page. Keep them in the report
 * while being explicit about the reduced confidence.
 */
export function assessNoOpControl(label: string): NoOpControlAssessment {
  const hiddenEffectPossible = /export|download|copy|print|share|scroll|top|back/i.test(label);
  return {
    hiddenEffectPossible,
    title: hiddenEffectPossible
      ? `Control has no observable effect: "${label}"`
      : `Button appears to do nothing: "${label}"`,
    description:
      `Clicking "${label}" produced no navigation, no DOM change and no network request. ` +
      'The control may be unwired, its handler may silently fail, or its side effect may be external to the page.',
    expected: 'A visible response, download, or external side effect',
    suspectedReason: hiddenEffectPossible
      ? 'Downloads, clipboard writes, and scrolling may not alter the DOM or issue a network request.'
      : 'Some controls intentionally have no visible side effect (e.g. analytics).',
  };
}

function cleanConsole(text: string): string {
  return text.replace('[smartqa:unhandledrejection] ', '').slice(0, 160);
}

export function isSameSite(url: string, origin: string): boolean {
  return sameOrigin(url, origin);
}
