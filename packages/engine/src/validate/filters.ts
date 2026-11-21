import {
  nowIso,
  shortId,
  type CheckKind,
  type CombinationKind,
  type FilterCombination,
  type FilterDimension,
  type FilterOption,
  type FilterSelection,
  type LogLevel,
  type MetricSample,
  type MetricSnapshot,
  type PageState,
  type Rng,
  type TestRun,
} from '@smartqa/shared';
import type { Store } from '@smartqa/db';
import type { BrowserSession } from '../browser/session';
import type { PageSnapshot } from '../browser/domSnapshot';
import { waitForDomQuiet } from '../browser/readiness';
import type { CheckService } from '../checks';
import type { EvidenceService } from '../evidence';
import type { FindingService } from '../findings';
import type { RunEventBus } from '../events';
import { analyzeSnapshot } from '../detect/analyzeSnapshot';
import {
  classifyMetricKind,
  classifyAdditivity,
  compareMetricStates,
  evaluateCoherence,
  evaluatePartitionSum,
  isReliableFilterMetric,
  metricValues,
  normalizeMetricKey,
  parseNumberText,
  toCalculationDetail,
  toMetricSample,
} from './metrics';

/**
 * Dashboard & filter validation engine.
 *
 * Strategy:
 *  1. Capture a baseline (no filters) after a fresh load.
 *  2. Discover filter dimensions and their options from the DOM.
 *  3. Replay combinations from a clean load each time (so results cannot depend
 *     on residual UI state), in the planned order.
 *  4. Compare equivalent states reached through different orders.
 *  5. Verify that reset restores the baseline.
 *  6. Check additive metrics against the sum of an exhaustive partition, and
 *     apply *different* invariants to non-additive metrics (means, percentages,
 *     distinct counts) instead of summing them.
 *
 * Every combination is bounded by the run's filter budget and recorded with its
 * seed so a failure can be reproduced.
 */

export interface FilterEngineContext {
  run: TestRun;
  store: Store;
  session: BrowserSession;
  rng: Rng;
  checks: CheckService;
  findings: FindingService;
  evidence: EvidenceService;
  emit: RunEventBus;
  captureSnapshot: () => Promise<PageSnapshot>;
  pauseGate: () => Promise<void>;
  log: (level: LogLevel, message: string, data?: Record<string, unknown>) => Promise<void>;
  consumeAction: (count?: number) => boolean;
  actionsRemaining: () => number;
  deadlineReached: () => boolean;
  maxCombinations: number;
  /** Optional AI assist for metrics whose additivity is not obvious from the label. */
  classifyMetric?: (
    sample: MetricSample,
  ) => Promise<{ additivity: MetricSample['additivity']; reason: string } | null>;
}

interface Plan {
  kind: CombinationKind;
  selections: FilterSelection[];
  order: string[];
  stateKey: string;
}

interface PlanResult {
  combination: FilterCombination;
  snapshot: PageSnapshot;
  metrics: MetricSample[];
  record: MetricSnapshot | null;
  rowCount: number;
}

export interface FilterValidationOutcome {
  tested: boolean;
  dimensions: number;
  planned: number;
  executed: number;
  additivityChecks: number;
  orderChecks: number;
  resetChecks: number;
  reason: string;
}

const MAX_OPTIONS_PER_DIMENSION = 4;
const MAX_DIMENSIONS = 3;

export function metricsFromSnapshot(snapshot: PageSnapshot): MetricSample[] {
  const samples: MetricSample[] = [];
  const seen = new Set<string>();
  for (const raw of snapshot.metrics) {
    const sample = toMetricSample(raw, { pageUrl: snapshot.url });
    if (!sample || !isReliableFilterMetric(sample)) continue;
    const key = `${sample.key}::${sample.value}::${sample.scope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push(sample);
  }
  return samples;
}

/** Prefer real data rows; skeleton/empty-state rows are not results. */
export function rowCountFromSnapshot(snapshot: PageSnapshot): number {
  const table = snapshot.tables[0];
  if (!table) return 0;
  if (snapshot.emptyStateText) return 0;
  return table.dataRowCount ?? table.rowCount;
}

function selectionKey(selections: FilterSelection[]): string {
  return selections
    .map((selection) => `${selection.dimensionId}=${[...selection.optionIds].sort().join(',')}`)
    .sort()
    .join('&');
}

export class FilterEngine {
  private baselineSnapshot: PageSnapshot | null = null;

  constructor(private readonly ctx: FilterEngineContext) {}

  private get page() {
    return this.ctx.session.page;
  }

  async validatePage(state: PageState, initialSnapshot: PageSnapshot): Promise<FilterValidationOutcome> {
    const dimensions = await this.persistDimensions(state, initialSnapshot);
    if (dimensions.length === 0) {
      return {
        tested: false,
        dimensions: 0,
        planned: 0,
        executed: 0,
        additivityChecks: 0,
        orderChecks: 0,
        resetChecks: 0,
        reason: 'No filter dimensions were detected on this page.',
      };
    }
    if (dimensions.length < 2) {
      return {
        tested: false,
        dimensions: dimensions.length,
        planned: 0,
        executed: 0,
        additivityChecks: 0,
        orderChecks: 0,
        resetChecks: 0,
        reason: 'Only one filter dimension was detected; combination testing needs at least two.',
      };
    }

    await this.ctx.log('info', `Dashboard detected: validating ${dimensions.length} filter dimensions`, {
      dimensions: dimensions.map((dimension) => ({
        label: dimension.label,
        kind: dimension.kind,
        options: dimension.options.length,
      })),
    });

    const baseline = await this.captureBaseline(state);
    if (!baseline) {
      return {
        tested: false,
        dimensions: dimensions.length,
        planned: 0,
        executed: 0,
        additivityChecks: 0,
        orderChecks: 0,
        resetChecks: 0,
        reason: 'Baseline could not be captured (no numeric metrics found).',
      };
    }

    const plans = this.plan(dimensions);
    await this.ctx.log('info', `Planned ${plans.length} filter combinations`, {
      seed: this.ctx.run.config.seed,
      kinds: plans.map((plan) => plan.kind),
    });

    const results: PlanResult[] = [baseline];
    let additivityChecks = 0;
    let orderChecks = 0;
    let resetChecks = 0;
    let executed = 1;

    for (const plan of plans) {
      if (this.ctx.deadlineReached()) break;
      if (!this.ctx.consumeAction(1)) break;
      await this.ctx.pauseGate();
      try {
        const result = await this.runPlan(state, plan);
        if (!result) continue;
        results.push(result);
        executed += 1;
        if (plan.kind === 'reset') resetChecks += 1;
        if (plan.kind === 'permutation') orderChecks += 1;
      } catch (error) {
        await this.ctx.log('warn', `Filter combination failed: ${(error as Error).message}`);
      }
    }

    additivityChecks += await this.checkPartitionAdditivity(state, dimensions, results);
    await this.checkOrderIndependence(state, results);
    await this.checkReset(state, results);
    await this.checkSubsetCoherence(state, results, dimensions);
    await this.checkSubsetBounds(state, results);
    await this.checkEmptyResults(state, results);
    await this.checkFilterEffectiveness(state, dimensions, results);
    await this.checkTableTotals(state, results);

    // Leave the page in a clean state for exploration.
    await this.resetTo(state.url);

    return {
      tested: true,
      dimensions: dimensions.length,
      planned: plans.length,
      executed,
      additivityChecks,
      orderChecks,
      resetChecks,
      reason: `Executed ${executed} filter states across ${dimensions.length} dimensions.`,
    };
  }

  // ------------------------------------------------------------- dimension io
  private async persistDimensions(state: PageState, snapshot: PageSnapshot): Promise<FilterDimension[]> {
    const existing = await this.ctx.store.filterDimensions.find({
      where: { runId: this.ctx.run.id, pageStateId: state.id },
      limit: 50,
    });
    if (existing.length > 0) return existing;

    const dimensions: FilterDimension[] = [];
    for (const raw of snapshot.filters.slice(0, MAX_DIMENSIONS)) {
      if (raw.options.length < 2) continue;
      const dimension: FilterDimension = {
        id: shortId('fdm'),
        runId: this.ctx.run.id,
        pageStateId: state.id,
        label: raw.label || `Filter ${dimensions.length + 1}`,
        kind: (raw.kind as FilterDimension['kind']) ?? 'unknown',
        selector: raw.selector,
        options: raw.options.slice(0, 12).map((option, index) => ({
          id: shortId('fop'),
          label: option.label,
          value: option.value,
          selector: option.selector,
          index,
        })),
        optionSource: (raw.optionSource as FilterDimension['optionSource']) ?? 'unknown',
        multiple: raw.multiple,
        notes: null,
      };
      await this.ctx.store.filterDimensions.create(dimension);
      dimensions.push(dimension);
    }
    return dimensions;
  }

  // ------------------------------------------------------------- baseline
  private async captureBaseline(state: PageState): Promise<PlanResult | null> {
    await this.resetTo(state.url);
    const snapshot = await this.ctx.captureSnapshot();
    const metrics = metricsFromSnapshot(snapshot);
    if (metrics.filter((metric) => metric.value !== null).length === 0) return null;
    this.baselineSnapshot = snapshot;
    const combination = await this.createCombination(state, 'baseline', [], []);
    const record = await this.persistSnapshot(state, combination.id, snapshot, metrics);
    const updated = await this.ctx.store.filterCombinations.update(combination.id, {
      state: 'captured',
      executedAt: nowIso(),
      snapshotId: record?.id ?? null,
    });
    if (record) this.ctx.emit.emit({ type: 'snapshot', snapshot: record });
    await this.analyzePlanSnapshot(state, snapshot, updated.id);
    await this.emitStateCheck(state, {
      kind: 'filter_reset',
      title: 'Baseline state captured before filtering',
      status: 'passed',
      detail: `${metrics.length} metrics captured at ${state.url}`,
    });
    return {
      combination: updated,
      snapshot,
      metrics,
      record,
      rowCount: rowCountFromSnapshot(snapshot),
    };
  }

  // ------------------------------------------------------------- planning
  private plan(dimensions: FilterDimension[]): Plan[] {
    const plans: Plan[] = [];
    const { rng } = this.ctx;
    type DimensionEntry = {
      dimension: FilterDimension;
      options: FilterOption[];
    };
    const dims: DimensionEntry[] = dimensions
      .slice(0, MAX_DIMENSIONS)
      .map((dimension) => ({
        dimension,
        options: dimension.options.slice(0, MAX_OPTIONS_PER_DIMENSION),
      }))
      .filter((entry) => entry.options.length > 0);
    if (dims.length === 0) return plans;

    const selectionFor = (entry: DimensionEntry, option: FilterOption): FilterSelection => ({
      dimensionId: entry.dimension.id,
      dimensionLabel: entry.dimension.label,
      optionIds: [option.id],
      optionLabels: [option.label],
    });
    const isSentinel = (option: FilterOption): boolean =>
      /^(all|any|none|no\s+filter)\b/i.test(option.label);
    const meaningful = (entry: DimensionEntry): FilterOption[] =>
      entry.options.filter((option) => !isSentinel(option));
    const lastOption = (entry: DimensionEntry): FilterOption | undefined =>
      entry.options[entry.options.length - 1];
    const firstMeaningful = (entry: DimensionEntry): FilterOption | undefined =>
      meaningful(entry)[0] ?? entry.options[0];

    const singlePlan = (entry: DimensionEntry, option: FilterOption): Plan => {
      const selection = selectionFor(entry, option);
      return {
        kind: 'single',
        selections: [selection],
        order: [entry.dimension.id],
        stateKey: selectionKey([selection]),
      };
    };
    const pairPlan = (
      left: DimensionEntry,
      leftOption: FilterOption,
      right: DimensionEntry,
      rightOption: FilterOption,
    ): Plan => {
      const selections = [selectionFor(left, leftOption), selectionFor(right, rightOption)];
      return {
        kind: 'pair',
        selections,
        order: [left.dimension.id, right.dimension.id],
        stateKey: selectionKey(selections),
      };
    };

    const seenPlans = new Set<string>();
    const add = (plan: Plan): void => {
      const signature = [plan.kind, plan.stateKey, plan.order.join(',')].join('|');
      if (seenPlans.has(signature)) return;
      seenPlans.add(signature);
      plans.push(plan);
    };

    const pairs: Array<{ left: DimensionEntry; right: DimensionEntry }> = [];
    for (let i = 0; i < dims.length; i += 1) {
      for (let j = i + 1; j < dims.length; j += 1) {
        const left = dims[i];
        const right = dims[j];
        if (left && right) pairs.push({ left, right });
      }
    }

    // Boundary pairs first. Empty-result and arithmetic defects tend to live
    // in the last options of each dimension, and a small budget must still
    // reach them before broad random coverage.
    for (const pair of pairs) {
      const leftLast = lastOption(pair.left);
      const rightLast = lastOption(pair.right);
      const leftFirst = firstMeaningful(pair.left);
      const rightFirst = firstMeaningful(pair.right);
      if (leftLast && rightLast) add(pairPlan(pair.left, leftLast, pair.right, rightLast));
      if (leftLast && rightFirst) add(pairPlan(pair.left, leftLast, pair.right, rightFirst));
      if (leftFirst && rightLast) add(pairPlan(pair.left, leftFirst, pair.right, rightLast));
    }

    // Reset probes prefer single-select dimensions: a stale applied value is
    // most often left behind by a <select> whose visible state is cleared but
    // whose submitted value is not. Checkbox groups are a fallback.
    const resetEntries = [...dims].sort((a, b) => {
      const score = (entry: DimensionEntry): number =>
        Number(entry.options.some(isSentinel)) * 2 + Number(!entry.dimension.multiple);
      return score(b) - score(a);
    });
    for (const entry of resetEntries) {
      const option = firstMeaningful(entry);
      if (!option) continue;
      const selection = selectionFor(entry, option);
      add({
        kind: 'reset',
        selections: [selection],
        order: [entry.dimension.id],
        stateKey: `reset:${selectionKey([selection])}`,
      });
      break;
    }

    // Same logical state, opposite application order. Prefer a select +
    // multi-select pair, since application order is most observable when a
    // repeated-value filter is mixed with a single-value filter.
    const permutationPair =
      pairs.find((pair) => pair.left.dimension.multiple !== pair.right.dimension.multiple) ?? pairs[0];
    if (permutationPair) {
      const leftOption = firstMeaningful(permutationPair.left);
      const rightOption = firstMeaningful(permutationPair.right);
      if (leftOption && rightOption) {
        const forward = pairPlan(permutationPair.left, leftOption, permutationPair.right, rightOption);
        add({ ...forward, kind: 'permutation', order: [permutationPair.left.dimension.id, permutationPair.right.dimension.id] });
        add({ ...forward, kind: 'permutation', order: [permutationPair.right.dimension.id, permutationPair.left.dimension.id] });
      }
    }

    // At least one individual option per dimension proves each control works.
    for (const entry of dims) {
      const option = firstMeaningful(entry);
      if (option) add(singlePlan(entry, option));
    }

    // Selecting every option of a multi-select dimension should equal no filter.
    for (const entry of dims.filter((candidate) => candidate.dimension.multiple)) {
      const selection: FilterSelection = {
        dimensionId: entry.dimension.id,
        dimensionLabel: entry.dimension.label,
        optionIds: entry.options.map((option) => option.id),
        optionLabels: entry.options.map((option) => option.label),
      };
      add({
        kind: 'all_options',
        selections: [selection],
        order: [entry.dimension.id],
        stateKey: selectionKey([selection]),
      });
    }

    // If budget remains, add a second individual option for partition evidence.
    for (const entry of dims) {
      const options = meaningful(entry);
      const second = options[1];
      if (second) add(singlePlan(entry, second));
    }

    const randomPairs: Plan[] = [];
    const shuffledPairs = rng.shuffle([...pairs]);
    for (const pair of shuffledPairs) {
      const leftOptions = rng.sample(meaningful(pair.left), Math.min(2, meaningful(pair.left).length));
      const rightOptions = rng.sample(meaningful(pair.right), Math.min(2, meaningful(pair.right).length));
      for (const leftOption of leftOptions) {
        for (const rightOption of rightOptions) {
          randomPairs.push(pairPlan(pair.left, leftOption, pair.right, rightOption));
        }
      }
    }
    for (const plan of rng.sample(randomPairs, Math.min(3, randomPairs.length))) add(plan);

    if (dims.length >= 3) {
      const selected = dims.slice(0, 3).map((entry) => {
        const option = rng.pick(meaningful(entry)) ?? meaningful(entry)[0] ?? entry.options[0];
        return selectionFor(entry, option as FilterOption);
      });
      add({
        kind: 'triple',
        selections: selected,
        order: rng.shuffle(selected.map((selection) => selection.dimensionId)),
        stateKey: selectionKey(selected),
      });
    }

    const campaign = plans.slice(0, Math.max(0, this.ctx.maxCombinations));
    if (plans.length > campaign.length) {
      void this.ctx.log('warn', `Filter budget limited the campaign to ${campaign.length} of ${plans.length} combinations`);
    }
    return campaign;
  }

  // ------------------------------------------------------------- execution
  private async runPlan(state: PageState, plan: Plan): Promise<PlanResult | null> {
    if (plan.kind === 'reset') return this.runResetPlan(state, plan);

    await this.resetTo(state.url);
    const combination = await this.createCombination(state, plan.kind, plan.selections, plan.order);
    const responseWaiter = this.page
      .waitForResponse((response) => ['xhr', 'fetch'].includes(response.request().resourceType()), { timeout: 5_000 })
      .catch(() => null);

    for (const dimensionId of plan.order) {
      const selection = plan.selections.find((item) => item.dimensionId === dimensionId);
      if (!selection) continue;
      await this.applySelection(selection);
    }
    await responseWaiter;
    await this.settle();

    const snapshot = await this.ctx.captureSnapshot();
    const metrics = metricsFromSnapshot(snapshot);
    const record = await this.persistSnapshot(state, combination.id, snapshot, metrics);
    const updated = await this.ctx.store.filterCombinations.update(combination.id, {
      state: 'captured',
      executedAt: nowIso(),
      snapshotId: record?.id ?? null,
    });
    if (record) this.ctx.emit.emit({ type: 'snapshot', snapshot: record });
    await this.analyzePlanSnapshot(state, snapshot, updated.id);
    await this.ctx.log('debug', `Filter state captured (${plan.kind})`, {
      selections: plan.selections.map((selection) => selection.optionLabels.join(' + ')),
      order: plan.order,
      metrics: metrics.filter((metric) => metric.value !== null).length,
    });
    return {
      combination: updated,
      snapshot,
      metrics,
      record,
      rowCount: rowCountFromSnapshot(snapshot),
    };
  }

  private async runResetPlan(state: PageState, plan: Plan): Promise<PlanResult | null> {
    await this.resetTo(state.url);
    const combination = await this.createCombination(state, 'reset', plan.selections, plan.order);
    for (const selection of plan.selections) await this.applySelection(selection);
    await this.settle();

    const resetControl = await this.findResetControl();
    if (!resetControl) {
      await this.ctx.store.filterCombinations.update(combination.id, {
        state: 'skipped',
        error: 'No reset/clear control was found.',
      });
      await this.ctx.log('info', 'No reset control found; skipping reset verification');
      return null;
    }
    await resetControl.click({ timeout: 5_000 });
    await this.settle();
    const snapshot = await this.ctx.captureSnapshot();
    const metrics = metricsFromSnapshot(snapshot);
    const record = await this.persistSnapshot(state, combination.id, snapshot, metrics);
    const updated = await this.ctx.store.filterCombinations.update(combination.id, {
      state: 'captured',
      executedAt: nowIso(),
      snapshotId: record?.id ?? null,
    });
    if (record) this.ctx.emit.emit({ type: 'snapshot', snapshot: record });
    await this.analyzePlanSnapshot(state, snapshot, updated.id);
    return {
      combination: updated,
      snapshot,
      metrics,
      record,
      rowCount: rowCountFromSnapshot(snapshot),
    };
  }

  private async applySelection(selection: FilterSelection): Promise<void> {
    const dimensions = await this.ctx.store.filterDimensions.find({
      where: { runId: this.ctx.run.id },
      limit: 50,
    });
    const dimension = dimensions.find((item) => item.id === selection.dimensionId);
    if (!dimension) return;

    if (dimension.kind === 'select') {
      for (const optionId of selection.optionIds) {
        const option = dimension.options.find((item) => item.id === optionId);
        if (!option) continue;
        try {
          await this.page.selectOption(dimension.selector, { label: option.label }, { timeout: 5_000 });
        } catch {
          if (option.value) await this.page.selectOption(dimension.selector, option.value, { timeout: 5_000 });
        }
      }
      return;
    }

    for (const optionId of selection.optionIds) {
      const option = dimension.options.find((item) => item.id === optionId);
      if (!option) continue;
      const locator = this.page.locator(option.selector).first();
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;
      const checked = await locator.isChecked().catch(() => false);
      if (dimension.multiple && checked) continue;
      await locator.click({ timeout: 5_000 }).catch(() => undefined);
    }
  }

  private async findResetControl() {
    const page = this.page;
    const candidates = page.locator(
      'button:has-text("Reset"), button:has-text("Clear"), [role="button"]:has-text("Reset"), [role="button"]:has-text("Clear"), [data-testid*="reset"], [data-testid*="clear"]',
    );
    const count = await candidates.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      const visible = await candidate.isVisible().catch(() => false);
      if (visible) return candidate;
    }
    return null;
  }

  private async resetTo(url: string): Promise<void> {
    await this.ctx.session.navigate(url);
    await this.settle();
  }

  private async settle(): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
    await waitForDomQuiet(this.page, 350, 3_500);
  }

  // ------------------------------------------------------------- persistence
  private async createCombination(
    state: PageState,
    kind: CombinationKind,
    selections: FilterSelection[],
    order: string[],
  ): Promise<FilterCombination> {
    const combination: FilterCombination = {
      id: shortId('fcm'),
      runId: this.ctx.run.id,
      pageStateId: state.id,
      kind,
      selections,
      order,
      state: 'applied',
      plannedAt: nowIso(),
      executedAt: null,
      snapshotId: null,
      error: null,
      stateKey: selectionKey(selections),
    };
    await this.ctx.store.filterCombinations.create(combination);
    return combination;
  }

  private async persistSnapshot(
    state: PageState,
    combinationId: string,
    snapshot: PageSnapshot,
    metrics: MetricSample[],
  ): Promise<MetricSnapshot | null> {
    if (metrics.length === 0) return null;
    const record: MetricSnapshot = {
      id: shortId('snp'),
      runId: this.ctx.run.id,
      pageStateId: state.id,
      combinationId,
      pageUrl: snapshot.url,
      capturedAt: nowIso(),
      metrics,
      table: snapshot.tables[0]
        ? {
            headers: snapshot.tables[0].headers,
            rows: snapshot.tables[0].rows.slice(0, 40),
            rowCount: snapshot.tables[0].rowCount,
            page: snapshot.tables[0].page,
            totalPages: snapshot.tables[0].totalPages,
            paginationLabel: snapshot.tables[0].paginationLabel,
          }
        : null,
      rowCount: snapshot.tables[0]?.rowCount ?? null,
      notes: null,
      viewport: this.ctx.run.config.viewports[0] ?? 'desktop',
    };
    await this.ctx.store.snapshots.create(record);
    return record;
  }

  private async emitStateCheck(
    state: PageState,
    input: { kind: CheckKind; title: string; status: 'passed' | 'failed' | 'warning' | 'skipped'; detail: string },
  ): Promise<void> {
    await this.ctx.checks.record({
      ...input,
      pageUrl: state.url,
      pageStateId: state.id,
      deterministic: true,
    });
  }

  /** A filtered state can expose invalid values that the baseline never shows. */
  private async analyzePlanSnapshot(state: PageState, snapshot: PageSnapshot, combinationId: string): Promise<void> {
    const analysis = analyzeSnapshot(snapshot, {
      runId: this.ctx.run.id,
      pageUrl: snapshot.url || state.url,
      pageTitle: snapshot.title || state.title,
      pageStateId: state.id,
      actionId: null,
      viewport: this.ctx.run.config.viewports[0] ?? 'desktop',
    });
    for (const draft of analysis.findings) await this.ctx.findings.record(draft);
    for (const draft of analysis.checks) {
      await this.ctx.checks.record({
        ...draft,
        pageUrl: snapshot.url || state.url,
        pageStateId: state.id,
        combinationId,
      });
    }
  }

  // ------------------------------------------------------------- validation
  private async checkPartitionAdditivity(
    state: PageState,
    dimensions: FilterDimension[],
    results: PlanResult[],
  ): Promise<number> {
    let checks = 0;
    const baseline = results.find((result) => result.combination.kind === 'baseline');
    if (!baseline) return 0;
    const baselineMetrics = metricValues(baseline.metrics);

    for (const dimension of dimensions) {
      const singles = results.filter(
        (result) =>
          result.combination.kind === 'single' &&
          result.combination.selections.some((selection) => selection.dimensionId === dimension.id),
      );
      if (singles.length < 2) continue;
      const allOptions = results.find(
        (result) =>
          result.combination.kind === 'all_options' &&
          result.combination.selections.some((selection) => selection.dimensionId === dimension.id),
      );
      const exhaustive = this.isExhaustivePartition(
        dimension,
        baseline.metrics,
        allOptions?.metrics ?? [],
        singles.length,
      );

      for (const [key, baseSample] of baselineMetrics) {
        let sample = baseSample;
        if (sample.additivity === 'unknown' && this.ctx.classifyMetric) {
          const verdict = await this.ctx.classifyMetric(sample).catch(() => null);
          if (verdict) {
            sample = { ...sample, additivity: verdict.additivity, additivityReason: `AI: ${verdict.reason}` };
            await this.ctx.log('info', `Metric "${sample.label}" classified as ${verdict.additivity}`, {
              reason: verdict.reason,
            });
          }
        }
        if (sample.value === null || sample.additivity !== 'additive') continue;
        const parts: Array<{ label: string; value: number }> = [];
        for (const single of singles) {
          const observed = single.metrics.find((metric) => metric.key === key && metric.value !== null);
          if (!observed || observed.value === null) continue;
          parts.push({ label: observed.groupKey ?? observed.label, value: observed.value });
        }
        if (parts.length < 2) {
          // Partial partition: still useful, but only as a suspected signal.
          continue;
        }
        const evaluation = evaluatePartitionSum({
          metricLabel: sample.label,
          kind: sample.kind,
          additivity: sample.additivity,
          unit: sample.unit ?? null,
          baseline: sample.value,
          parts,
          exhaustive,
        });
        checks += 1;
        if (evaluation.verdict === 'pass') {
          await this.ctx.checks.record({
            kind: 'filter_additivity',
            title: `Sum of "${dimension.label}" options equals the unfiltered ${sample.label}`,
            status: 'passed',
            detail: evaluation.formula,
            pageUrl: state.url,
            pageStateId: state.id,
            combinationId: baseline.combination.id,
            calculation: toCalculationDetail(evaluation, parts.length),
          });
          continue;
        }
        if (evaluation.verdict === 'fail' || evaluation.verdict === 'suspect') {
          const calculation = toCalculationDetail(evaluation, parts.length);
          await this.ctx.findings.record({
            category: 'calculation_error',
            severity: evaluation.verdict === 'fail' ? 'high' : 'medium',
            confidence: evaluation.verdict === 'fail' ? 'confirmed' : 'suspected',
            title:
              evaluation.verdict === 'fail'
                ? `Filter breakdown does not add up: "${sample.label}"`
                : `Possible filter arithmetic inconsistency: "${sample.label}"`,
            description: `${evaluation.reason} Filter dimension: "${dimension.label}". Values were read from the page; the expected total is the unfiltered value the page displayed.`,
            observed: `${evaluation.observed}`,
            expected: `${evaluation.expected}`,
            pageUrl: state.url,
            pageStateId: state.id,
            calculation,
            fingerprintKey: `additivity:${dimension.label}:${key}`,
            tags: ['calculation', 'filters', dimension.label],
            suspectedReason: evaluation.verdict === 'suspect' ? evaluation.reason : null,
            reproduceSteps: [
              `Open ${state.url}`,
              `Record the unfiltered ${sample.label} (${evaluation.expected}).`,
              `Apply each "${dimension.label}" option separately and record the value.`,
              `Sum the option values: ${evaluation.observed}.`,
            ],
          });
          await this.ctx.checks.record({
            kind: 'filter_additivity',
            title: `Sum of "${dimension.label}" options equals the unfiltered ${sample.label}`,
            status: evaluation.verdict === 'fail' ? 'failed' : 'warning',
            detail: evaluation.reason,
            pageUrl: state.url,
            pageStateId: state.id,
            combinationId: baseline.combination.id,
            calculation,
          });
        }
      }
    }
    return checks;
  }

  /**
   * A dimension's options form an exhaustive partition when selecting every
   * option produces the same metrics as no filter. Without that evidence a
   * mismatch stays "suspected" instead of being called a confirmed bug.
   */
  private isExhaustivePartition(
    dimension: FilterDimension,
    baseline: MetricSample[],
    allOptions: MetricSample[],
    singleCount: number,
  ): boolean {
    const hasAllSentinel = dimension.options.some((option) => /^(all|any|none)\b/i.test(option.label));
    // A closed single-select option list (with no "All" choice) is itself the
    // universe of mutually exclusive values. Observing every option is enough
    // to prove the partition; no "select everything" state exists.
    if (
      (dimension.kind === 'select' || dimension.kind === 'radio_group') &&
      !hasAllSentinel &&
      singleCount === dimension.options.length
    ) {
      return true;
    }
    if (allOptions.length === 0) return false;
    const comparison = compareMetricStates(baseline, allOptions, 0.005);
    const compared = comparison.comparedKeys.length;
    return compared > 0 && comparison.differences.length === 0 && singleCount >= 2;
  }

  private async checkOrderIndependence(state: PageState, results: PlanResult[]): Promise<void> {
    const groups = new Map<string, PlanResult[]>();
    for (const result of results) {
      if (!['pair', 'permutation', 'triple'].includes(result.combination.kind)) continue;
      const key = result.combination.stateKey;
      const list = groups.get(key) ?? [];
      list.push(result);
      groups.set(key, list);
    }

    for (const [stateKey, group] of groups) {
      if (group.length < 2) continue;
      const [first, second] = group;
      if (!first || !second) continue;
      const orderA = first.combination.order.join(' → ');
      const orderB = second.combination.order.join(' → ');
      if (orderA === orderB) continue;
      const comparison = compareMetricStates(first.metrics, second.metrics, 0.005);
      if (comparison.comparedKeys.length === 0) continue;

      if (comparison.equal) {
        await this.ctx.checks.record({
          kind: 'filter_order',
          title: 'Equivalent filter states give equal results regardless of order',
          status: 'passed',
          detail: `Orders "${orderA}" and "${orderB}" produced identical values for ${comparison.comparedKeys.length} metrics.`,
          pageUrl: state.url,
          pageStateId: state.id,
          combinationId: second.combination.id,
        });
        continue;
      }

      const differences = comparison.differences
        .slice(0, 4)
        .map((difference) => `${difference.key}: ${difference.left} vs ${difference.right} (Δ ${difference.delta})`)
        .join('; ');
      await this.ctx.findings.record({
        category: 'filter_inconsistency',
        severity: 'high',
        confidence: 'probable',
        title: 'Same filters in a different order return different results',
        description:
          `Applying ${describeSelections(first.combination.selections)} in order "${orderA}" produced different values than ` +
          `"${orderB}". Equivalent filter states should return equivalent data when the underlying data is unchanged. ` +
          `Differences: ${differences}.`,
        observed: differences,
        expected: 'Order-independent filter semantics produce equal results',
        pageUrl: state.url,
        pageStateId: state.id,
        fingerprintKey: `order:${stateKey}`,
        tags: ['filters', 'order-dependence'],
        reproduceSteps: [
          `Open ${state.url}`,
          `Apply ${describeSelections(first.combination.selections)} in order ${orderA} and record the metrics.`,
          `Reload and apply the same filters in order ${orderB}.`,
          'Compare the values; they should match.',
        ],
      });
      await this.ctx.checks.record({
        kind: 'filter_order',
        title: 'Equivalent filter states give equal results regardless of order',
        status: 'failed',
        detail: differences,
        pageUrl: state.url,
        pageStateId: state.id,
        combinationId: second.combination.id,
      });
    }
  }

  private async checkReset(state: PageState, results: PlanResult[]): Promise<void> {
    const baseline = results.find((result) => result.combination.kind === 'baseline');
    if (!baseline) return;
    const resets = results.filter((result) => result.combination.kind === 'reset');
    if (resets.length === 0) {
      await this.ctx.checks.record({
        kind: 'filter_reset',
        title: 'Clearing filters restores the baseline',
        status: 'skipped',
        detail: 'No reset/clear control was available to test.',
        pageUrl: state.url,
        pageStateId: state.id,
      });
      return;
    }

    for (const reset of resets) {
      const comparison = compareMetricStates(baseline.metrics, reset.metrics, 0.005);
      if (comparison.comparedKeys.length === 0) continue;
      if (comparison.equal) {
        await this.ctx.checks.record({
          kind: 'filter_reset',
          title: 'Clearing filters restores the baseline',
          status: 'passed',
          detail: `All ${comparison.comparedKeys.length} comparable metrics returned to baseline after reset.`,
          pageUrl: state.url,
          pageStateId: state.id,
          combinationId: reset.combination.id,
        });
        continue;
      }
      const differences = comparison.differences
        .slice(0, 5)
        .map((difference) => `${difference.key}: baseline ${difference.left} vs after reset ${difference.right}`)
        .join('; ');
      await this.ctx.findings.record({
        category: 'filter_inconsistency',
        severity: 'medium',
        confidence: 'confirmed',
        title: 'Resetting filters does not restore the baseline data',
        description:
          `After applying ${describeSelections(reset.combination.selections)} and pressing the reset/clear control, ` +
          `the page did not return to its unfiltered values. ${differences}. This suggests at least one filter is not cleared ` +
          `or the cleared state is not re-applied.`,
        observed: differences,
        expected: 'The unfiltered baseline values',
        pageUrl: state.url,
        pageStateId: state.id,
        fingerprintKey: `reset:${reset.combination.stateKey}`,
        tags: ['filters', 'reset'],
        reproduceSteps: [
          `Open ${state.url} and note the unfiltered metrics.`,
          `Apply ${describeSelections(reset.combination.selections)}.`,
          'Press the reset/clear filters control.',
          `Observe that ${differences}`,
        ],
      });
      await this.ctx.checks.record({
        kind: 'filter_reset',
        title: 'Clearing filters restores the baseline',
        status: 'failed',
        detail: differences,
        pageUrl: state.url,
        pageStateId: state.id,
        combinationId: reset.combination.id,
      });
    }
  }

  /** For non-additive metrics, check invariants instead of summing. */
  private async checkSubsetCoherence(
    state: PageState,
    results: PlanResult[],
    dimensions: FilterDimension[],
  ): Promise<void> {
    const baseline = results.find((result) => result.combination.kind === 'baseline');
    if (!baseline) return;
    const baselineMap = metricValues(baseline.metrics);

    for (const [key, baseSample] of baselineMap) {
      if (baseSample.value === null || baseSample.additivity === 'additive') continue;
      const singles = results.filter((result) => result.combination.kind === 'single');
      const parts: Array<{ label: string; value: number }> = [];
      for (const single of singles) {
        const sample = single.metrics.find((metric) => metric.key === key && metric.value !== null);
        if (sample?.value != null) parts.push({ label: sample.groupKey ?? sample.label, value: sample.value });
      }
      if (parts.length < 2) continue;
      const evaluation = evaluateCoherence({
        metricLabel: baseSample.label,
        kind: baseSample.kind,
        additivity: baseSample.additivity,
        total: baseSample.value,
        parts,
      });
      if (evaluation.verdict === 'pass') {
        await this.ctx.checks.record({
          kind: 'filter_subset',
          title: `Non-additive invariant holds for "${baseSample.label}"`,
          status: 'passed',
          detail: evaluation.reason,
          pageUrl: state.url,
          pageStateId: state.id,
        });
      } else if (evaluation.verdict === 'fail') {
        await this.ctx.findings.record({
          category: 'calculation_error',
          severity: 'medium',
          confidence: 'confirmed',
          title: `Impossible value for non-additive metric "${baseSample.label}"`,
          description: evaluation.reason,
          observed: `overall=${baseSample.value}`,
          expected: `A value between ${Math.min(...parts.map((part) => part.value))} and ${Math.max(
            ...parts.map((part) => part.value),
          )}`,
          pageUrl: state.url,
          pageStateId: state.id,
          fingerprintKey: `coherence:${key}`,
          tags: ['calculation', 'non-additive'],
        });
        await this.ctx.checks.record({
          kind: 'filter_subset',
          title: `Non-additive invariant holds for "${baseSample.label}"`,
          status: 'failed',
          detail: evaluation.reason,
          pageUrl: state.url,
          pageStateId: state.id,
        });
      }
      void dimensions;
    }
  }

  private async checkSubsetBounds(state: PageState, results: PlanResult[]): Promise<void> {
    const baseline = results.find((result) => result.combination.kind === 'baseline');
    if (!baseline) return;
    for (const pair of results.filter((result) => result.combination.kind === 'pair')) {
      for (const key of metricValues(baseline.metrics).keys()) {
        const base = metricValues(baseline.metrics).get(key);
        if (!base || base.value === null || base.additivity !== 'additive') continue;
        const pairValue = pair.metrics.find((metric) => metric.key === key)?.value;
        if (pairValue == null) continue;
        for (const selection of pair.combination.selections) {
          const single = results.find(
            (result) =>
              result.combination.kind === 'single' &&
              result.combination.stateKey === markerFor(selection),
          );
          if (!single) continue;
          const singleValue = single.metrics.find((metric) => metric.key === key)?.value;
          if (singleValue == null) continue;
          const tolerance = Math.max(0.5, Math.abs(singleValue) * 0.005);
          if (pairValue > singleValue + tolerance) {
            await this.ctx.findings.record({
              category: 'filter_inconsistency',
              severity: 'medium',
              confidence: 'suspected',
              title: `Combining filters increased "${base.label}" instead of narrowing it`,
              description: `A narrower filter state returned ${pairValue} for "${base.label}", larger than the single-filter value ${singleValue}. ` +
                'This can be legitimate if the dimensions combine with OR semantics, so it is reported as suspected.',
              observed: `combined=${pairValue}, single=${singleValue}`,
              expected: `<= ${singleValue}`,
              pageUrl: state.url,
              pageStateId: state.id,
              fingerprintKey: `subset:${key}:${pair.combination.id}`,
              tags: ['filters', 'subset'],
              suspectedReason: 'Filter combination semantics (AND vs OR) are not established.',
            });
          }
          break;
        }
      }
    }
  }

  private async checkEmptyResults(state: PageState, results: PlanResult[]): Promise<void> {
    for (const result of results) {
      if (result.combination.kind === 'baseline') continue;
      if (result.rowCount > 0) continue;
      const hasEmptyState = Boolean(result.snapshot.emptyStateText);
      const invalidMetrics = result.metrics.filter(
        (metric) => metric.value !== null && !Number.isFinite(metric.value),
      );
      const invalidValues = result.snapshot.sentinels.filter((sentinel) => sentinel.isolated);
      const status = hasEmptyState && invalidMetrics.length === 0 && invalidValues.length === 0 ? 'passed' : 'failed';
      if (status === 'failed' && !hasEmptyState) {
        await this.ctx.findings.record({
          category: 'filter_inconsistency',
          severity: 'low',
          confidence: 'probable',
          title: 'Filter combination returns no rows without an empty state',
          description:
            'A filter combination produced zero rows but the page did not render an explicit empty-state message, ' +
            'leaving the user with an apparently blank result area.',
          observed: '0 rows and no empty-state text',
          expected: 'An explicit "no results" message',
          pageUrl: state.url,
          pageStateId: state.id,
          fingerprintKey: `empty:${result.combination.stateKey}`,
          tags: ['filters', 'empty-state'],
        });
      }
      await this.ctx.checks.record({
        kind: 'filter_empty',
        title: 'Empty filter results are handled explicitly',
        status,
        detail: hasEmptyState
          ? `Empty state rendered: "${result.snapshot.emptyStateText}"${invalidValues.length ? `; ${invalidValues.length} invalid value(s) rendered` : ''}`
          : 'Zero rows with no empty-state message.',
        pageUrl: state.url,
        pageStateId: state.id,
        combinationId: result.combination.id,
      });
    }
  }

  private async checkFilterEffectiveness(
    state: PageState,
    dimensions: FilterDimension[],
    results: PlanResult[],
  ): Promise<void> {
    const baseline = results.find((result) => result.combination.kind === 'baseline');
    if (!baseline) return;
    const singles = results.filter((result) => result.combination.kind === 'single');
    if (singles.length < 2) {
      await this.ctx.checks.record({
        kind: 'control_responds',
        title: 'Filters change the displayed data',
        status: 'skipped',
        detail: 'Fewer than two single-filter states were captured.',
        pageUrl: state.url,
        pageStateId: state.id,
      });
      return;
    }
    let changed = 0;
    let compared = 0;
    for (const single of singles) {
      const selection = single.combination.selections[0];
      if (!selection) continue;
      const labels = selection.optionLabels.join(' ').toLowerCase();
      if (/^(all|any|none)\b/.test(labels) || labels.includes('all years') || labels.includes('all statuses')) continue;
      const comparison = compareMetricStates(baseline.metrics, single.metrics, 0.001);
      if (comparison.comparedKeys.length === 0) continue;
      compared += 1;
      if (!comparison.equal) changed += 1;
    }
    if (compared >= 2 && changed === 0) {
      await this.ctx.findings.record({
        category: 'filter_inconsistency',
        severity: 'high',
        confidence: 'probable',
        title: 'Filters do not change the displayed data',
        description:
          `Applying ${compared} different filter options produced identical metrics in every case, ` +
          'which suggests the filters are not wired to the data source.',
        observed: 'All filter states identical to baseline',
        expected: 'Filtered values differ from the unfiltered baseline',
        pageUrl: state.url,
        pageStateId: state.id,
        fingerprintKey: 'filter-no-effect',
        tags: ['filters', 'wiring'],
        suspectedReason: 'Data may be static by design, but the filters are presented as functional.',
      });
      await this.ctx.checks.record({
        kind: 'control_responds',
        title: 'Filters change the displayed data',
        status: 'failed',
        detail: `${compared} filter options produced no metric change.`,
        pageUrl: state.url,
        pageStateId: state.id,
      });
    } else if (compared > 0) {
      await this.ctx.checks.record({
        kind: 'control_responds',
        title: 'Filters change the displayed data',
        status: 'passed',
        detail: `${changed}/${compared} single-filter states changed at least one metric.`,
        pageUrl: state.url,
        pageStateId: state.id,
      });
    }
    void dimensions;
  }

  private async checkTableTotals(state: PageState, results: PlanResult[]): Promise<void> {
    const baseline = results.find((result) => result.combination.kind === 'baseline');
    if (!baseline) return;
    const table = baseline.snapshot.tables[0];
    if (!table || table.footer.length === 0) return;

    const kpiMetrics = baseline.metrics.filter((metric) => metric.scope === 'kpi' && metric.additivity === 'additive');
    for (let column = 0; column < table.footer.length; column += 1) {
      const footer = parseNumberText(table.footer[column] ?? '');
      if (!footer) continue;
      const header = table.headers[column] ?? '';
      if (!header) continue;
      const kind = classifyMetricKind(header, footer.unit, footer.value);
      const additivity = classifyAdditivity(header, kind, footer.unit).additivity;
      if (additivity !== 'additive') continue;
      const candidates = kpiMetrics.filter((metric) => {
        const label = metric.label.toLowerCase();
        return label.includes(normalizeMetricKey(header)) || normalizeMetricKey(header).includes(label);
      });
      const match = candidates.find((metric) => metric.value != null);
      if (!match || match.value == null) continue;
      const pageRows = table.rows.length;
      const totalPages = table.totalPages ?? null;
      if (totalPages && totalPages > 1 && pageRows < match.value) {
        const ratio = footer.value / (match.value || 1);
        if (Math.abs(footer.value - match.value) > Math.max(1, match.value * 0.02) && ratio < 0.9) {
          await this.ctx.findings.record({
            category: 'filter_inconsistency',
            severity: 'low',
            confidence: 'probable',
            title: `Table "Total" row totals only the visible page, not the full result set`,
            description:
              `The table footer shows ${footer.value} for "${header}" while the page-level total for "${match.label}" is ` +
              `${match.value}. With pagination (${pageRows} of ${table.rowCount} rows per page, ${totalPages} pages), ` +
              'a footer labelled "Total" is expected to represent the full filtered set.',
            observed: `footer=${footer.value}, page total=${match.value}`,
            expected: `${match.value}`,
            pageUrl: state.url,
            pageStateId: state.id,
            fingerprintKey: `table-footer:${header}`,
            tags: ['table', 'pagination', 'totals'],
            suspectedReason: 'The label may intentionally mean "total of this page".',
          });
          await this.ctx.checks.record({
            kind: 'table_totals',
            title: `Table footer total represents the filtered total for "${header}"`,
            status: 'warning',
            detail: `Footer ${footer.value} vs page total ${match.value} across ${totalPages} pages.`,
            pageUrl: state.url,
            pageStateId: state.id,
          });
        }
      }
    }
  }
}

function markerFor(selection: FilterSelection): string {
  return selectionKey([selection]);
}

function describeSelections(selections: FilterSelection[]): string {
  return selections
    .map((selection) => `${selection.dimensionLabel}=${selection.optionLabels.join('/')}`)
    .join(', ');
}
