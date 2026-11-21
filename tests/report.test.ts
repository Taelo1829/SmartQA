import { describe, expect, it } from 'vitest';
import { buildCoverage, buildFilterTests, buildSummary } from '@smartqa/engine';
import type { ActionRecord, CheckResult, CoverageReport, Finding, FilterCombination, FilterDimension, PageState, TestRun } from '@smartqa/shared';

/**
 * Reporting honesty: the platform must never claim more coverage than it has.
 */
function run(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: 'run_1',
    userId: 'usr_1',
    url: 'https://example.com',
    origin: 'https://example.com',
    mode: 'background',
    status: 'completed',
    config: {
      url: 'https://example.com',
      mode: 'background',
      requireAuth: false,
      viewports: ['desktop'],
      budgets: {
        maxPages: 25,
        maxActions: 120,
        maxDepth: 3,
        actionsPerPage: 12,
        maxFilterCombinations: 24,
        maxDurationMs: 600_000,
      },
      seed: 7,
      allowDestructiveActions: false,
      approvedActionPatterns: [],
      focus: 'full',
      captureScreenshots: true,
      recordTrace: false,
      reproductionAttempts: 2,
    },
    authState: 'not_required',
    progress: {
      phase: 'completed',
      phaseLabel: 'Completed',
      percent: 100,
      message: '',
      pagesDiscovered: 1,
      pagesVisited: 1,
      actionsExecuted: 1,
      checksRun: 1,
      findings: 1,
      updatedAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    durationMs: 1_000,
    heartbeatAt: null,
    cancelRequestedAt: null,
    summary: null,
    coverage: null,
    error: null,
    workerId: null,
    ...overrides,
  };
}

function page(id: string, visitCount = 1): PageState {
  return {
    id,
    runId: 'run_1',
    url: `https://example.com/${id}`,
    normalizedUrl: `https://example.com/${id}`,
    title: id,
    signature: `sig-${id}`,
    depth: 1,
    parentStateId: null,
    viaActionId: null,
    discoveredAt: new Date().toISOString(),
    visitedAt: new Date().toISOString(),
    visitCount,
    interactiveCount: 3,
    screenshotId: null,
    skeleton: false,
  };
}

function action(id: string, status: ActionRecord['status']): ActionRecord {
  return {
    id,
    runId: 'run_1',
    pageStateId: 'p1',
    kind: 'click',
    status,
    element: null,
    elementLabel: id,
    value: null,
    description: id,
    destructiveRisk: 'none',
    startedAt: new Date().toISOString(),
    durationMs: 10,
    resultStateId: null,
    urlBefore: 'https://example.com',
    urlAfter: null,
    outcome: 'unknown',
    error: null,
    signals: null,
  };
}

function check(id: string, status: CheckResult['status']): CheckResult {
  return {
    id,
    runId: 'run_1',
    kind: 'page_load',
    title: id,
    status,
    detail: '',
    pageUrl: 'https://example.com',
    actionId: null,
    pageStateId: null,
    combinationId: null,
    evidenceIds: [],
    deterministic: true,
    calculation: null,
    createdAt: new Date().toISOString(),
    durationMs: 1,
  };
}

function finding(id: string, severity: Finding['severity'], confidence: Finding['confidence']): Finding {
  return {
    id,
    runId: 'run_1',
    category: 'console_error',
    severity,
    confidence,
    status: 'open',
    title: id,
    description: '',
    expected: null,
    observed: '',
    pageUrl: 'https://example.com',
    pageTitle: null,
    pageStateId: null,
    actionId: null,
    elementLabel: null,
    selector: null,
    calculation: null,
    reproduction: { attempts: 0, successes: 0, steps: [], recordedSteps: [], notes: '', lastAttemptAt: null },
    evidence: [],
    fingerprint: id,
    tags: [],
    suspectedReason: null,
    occurrenceCount: 1,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
}

function coverage(overrides: Partial<Parameters<typeof buildCoverage>[0]> = {}): CoverageReport {
  return buildCoverage({
    run: run(),
    pages: [page('p1'), page('p2')],
    actions: [action('a1', 'executed'), action('a2', 'executed'), action('a3', 'executed'), action('a4', 'executed')],
    checks: [check('c1', 'passed'), check('c2', 'failed')],
    dimensions: [],
    combinations: [],
    snapshots: [],
    elementsDiscovered: 10,
    elementsTested: 9,
    visitedPages: 2,
    maxDepth: 1,
    loopsPrevented: 3,
    extraLimitations: [],
    durationMs: 30_000,
    ...overrides,
  });
}

describe('coverage reporting', () => {
  it('never claims exhaustive coverage while interactions remain untested', () => {
    const report = coverage({
      elementsDiscovered: 20,
      elementsTested: 5,
      actions: [action('a1', 'executed'), action('a2', 'pending')],
    });
    expect(report.completeness).not.toBe('exhaustive');
    expect(report.limitations.some((line) => line.includes('not executed'))).toBe(true);
  });

  it('records budget exhaustion honestly', () => {
    const report = coverage({
      pages: Array.from({ length: 25 }, (_, index) => page(`p${index}`)),
      elementsDiscovered: 5,
      elementsTested: 5,
      actions: [action('a1', 'executed')],
    });
    expect(report.budget.exhausted).toContain('page budget');
    expect(report.completeness).toBe('partial');
  });

  it('always includes the sampling caveat', () => {
    const report = coverage();
    expect(report.limitations.some((line) => line.includes('not proof of correctness'))).toBe(true);
    expect(report.limitations.some((line) => line.includes('Mobile viewport'))).toBe(true);
    expect(report.basis.length).toBeGreaterThan(0);
  });

  it('reports smoke coverage for a single trivial page', () => {
    const report = coverage({
      pages: [page('p1')],
      actions: [action('a1', 'executed')],
      elementsDiscovered: 2,
      elementsTested: 1,
      visitedPages: 1,
    });
    expect(report.completeness).toBe('smoke');
  });

  it('reaches broad coverage when most interactions were exercised', () => {
    const report = coverage({
      elementsDiscovered: 10,
      elementsTested: 10,
      actions: Array.from({ length: 10 }, (_, index) => action(`a${index}`, 'executed')),
    });
    expect(['broad', 'exhaustive']).toContain(report.completeness);
  });
});

describe('summary aggregation', () => {
  it('counts severities, confirmations and top findings in order', () => {
    const findings = [
      finding('low-1', 'low', 'confirmed'),
      finding('crit-1', 'critical', 'confirmed'),
      finding('med-1', 'medium', 'suspected'),
    ];
    const report = buildSummary({
      run: run(),
      findings,
      checks: [check('c1', 'passed'), check('c2', 'failed')],
      pages: [page('p1')],
      actions: [action('a1', 'executed')],
      dimensions: [],
      combinations: [],
      snapshots: [],
      elementsDiscovered: 5,
      elementsTested: 4,
      visitedPages: 1,
      loopsPrevented: 1,
      durationMs: 5_000,
      coverage: coverage(),
    });
    expect(report.findingsTotal).toBe(3);
    expect(report.severities.critical).toBe(1);
    expect(report.confirmed).toBe(2);
    expect(report.suspected).toBe(1);
    expect(report.checks.passed).toBe(1);
    expect(report.topFindings[0]?.id).toBe('crit-1');
    expect(report.limitations.length).toBeGreaterThan(0);
  });
});

describe('filter test reporting', () => {
  const dimension: FilterDimension = {
    id: 'fdm_1',
    runId: 'run_1',
    pageStateId: 'p1',
    label: 'Region',
    kind: 'checkbox_group',
    selector: '#filters',
    options: [
      { id: 'o1', label: 'A', value: null, selector: '#a', index: 0 },
      { id: 'o2', label: 'B', value: null, selector: '#b', index: 1 },
    ],
    optionSource: 'checkboxes',
    multiple: true,
    notes: null,
  };

  function combination(id: string, order: string[]): FilterCombination {
    return {
      id,
      runId: 'run_1',
      pageStateId: 'p1',
      kind: 'single',
      selections: [
        { dimensionId: 'fdm_1', dimensionLabel: 'Region', optionIds: ['o1'], optionLabels: ['A'] },
      ],
      order,
      state: 'captured',
      plannedAt: new Date().toISOString(),
      executedAt: new Date().toISOString(),
      snapshotId: null,
      error: null,
      stateKey: 'fdm_1=o1',
    };
  }

  it('summarises combinations, order variants and reset behaviour', () => {
    const tests = buildFilterTests(
      [dimension],
      [combination('c1', ['fdm_1', 'fdm_2']), combination('c2', ['fdm_2', 'fdm_1'])],
      [check('c1', 'passed')],
      [],
    );
    expect(tests).toHaveLength(1);
    expect(tests[0]?.dimension).toBe('Region');
    expect(tests[0]?.combinationsExecuted).toBe(2);
    expect(tests[0]?.orderVariants).toBe(2);
  });
});
