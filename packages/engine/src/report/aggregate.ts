import {
  SEVERITY_ORDER,
  nowIso,
  zeroSeverities,
  type ActionRecord,
  type AiUsageSummary,
  type CheckCounts,
  type CheckResult,
  type CoverageCompleteness,
  type CoverageReport,
  type FilterCombination,
  type FilterDimension,
  type Finding,
  type MetricSnapshot,
  type PageState,
  type ReportFilterTest,
  type RunLogEntry,
  type RunReport,
  type RunSummary,
  type SeverityCounts,
  type TestRun,
} from '@smartqa/shared';

/**
 * Report aggregation: turns raw run data into the summary, honest coverage
 * statement and structured report consumed by the UI and the exporters.
 */

export interface CoverageInput {
  run: TestRun;
  pages: PageState[];
  actions: ActionRecord[];
  checks: CheckResult[];
  dimensions: FilterDimension[];
  combinations: FilterCombination[];
  snapshots: MetricSnapshot[];
  elementsDiscovered: number;
  elementsTested: number;
  visitedPages: number;
  maxDepth: number;
  loopsPrevented: number;
  extraLimitations: string[];
  durationMs: number;
}

export function countChecks(checks: CheckResult[]): CheckCounts {
  const counts: CheckCounts = { passed: 0, failed: 0, warning: 0, skipped: 0 };
  for (const check of checks) counts[check.status] += 1;
  return counts;
}

export function countSeverities(findings: Finding[]): SeverityCounts {
  const counts = zeroSeverities();
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

export function buildCoverage(input: CoverageInput): CoverageReport {
  const budget = input.run.config.budgets;
  const exhausted: string[] = [];
  if (input.pages.length >= budget.maxPages) exhausted.push('page budget');
  if (input.actions.length >= budget.maxActions) exhausted.push('action budget');
  if (input.combinations.length >= budget.maxFilterCombinations) exhausted.push('filter-combination budget');
  if (input.maxDepth >= budget.maxDepth) exhausted.push('depth limit');
  if (input.durationMs >= budget.maxDurationMs * 0.95) exhausted.push('time limit');

  const pendingActions = input.actions.filter((action) => action.status === 'pending').length;
  const skippedElements = input.actions.filter(
    (action) => action.status === 'skipped' || action.status === 'blocked',
  ).length;
  const testedRatio = input.elementsDiscovered === 0 ? 0 : input.elementsTested / input.elementsDiscovered;

  const limitations = new Set<string>(input.extraLimitations);
  if (pendingActions > 0) {
    limitations.add(
      `${pendingActions} discovered interaction(s) were not executed before the run ended (budget or time limit).`,
    );
  }
  if (exhausted.length > 0) {
    limitations.add(`Exploration stopped early because of: ${exhausted.join(', ')}.`);
  }
  if (skippedElements > 0) {
    limitations.add(
      `${skippedElements} interaction(s) were skipped by policy (destructive actions) or could not be executed.`,
    );
  }
  if (!input.run.config.viewports.includes('mobile')) {
    limitations.add('Mobile viewport was not tested.');
  }
  limitations.add(
    'Coverage is behavioural sampling, not proof of correctness: untested states may still contain defects.',
  );

  let completeness: CoverageCompleteness;
  let completenessReason: string;
  if (input.pages.length <= 1 && input.actions.length < 8) {
    completeness = 'smoke';
    completenessReason = 'Only a single page state with few interactions was exercised.';
  } else if (exhausted.length > 0 || pendingActions > 0 || testedRatio < 0.8) {
    completeness = 'partial';
    completenessReason =
      exhausted.length > 0 || pendingActions > 0
        ? 'Exploration was budget-limited before every discovered interaction was exercised.'
        : `Only ${Math.round(testedRatio * 100)}% of discovered interactive elements were exercised.`;
  } else if (testedRatio >= 0.995 && limitations.size <= 2) {
    completeness = 'exhaustive';
    completenessReason = 'Every discovered interaction was exercised and no budget limit was reached.';
  } else {
    completeness = 'broad';
    completenessReason = `${Math.round(testedRatio * 100)}% of discovered interactions were exercised within budget.`;
  }

  const basis = [
    `${input.checks.length} deterministic checks were recorded (${input.checks.filter((check) => check.status === 'passed').length} passed).`,
    `${input.snapshots.length} metric snapshots captured across ${input.dimensions.length} filter dimensions.`,
    `${input.pages.length} page states discovered and ${input.visitedPages} visited.`,
    `${input.actions.filter((action) => action.status === 'executed').length} interactions completed successfully.`,
    `${input.loopsPrevented} repeat state transitions were suppressed by the state graph.`,
  ];

  return {
    completeness,
    completenessReason,
    pagesDiscovered: input.pages.length,
    pagesVisited: input.visitedPages,
    statesDiscovered: input.pages.length,
    statesVisited: input.visitedPages,
    elementsDiscovered: input.elementsDiscovered,
    elementsTested: input.elementsTested,
    elementsSkipped: skippedElements,
    filterDimensions: input.dimensions.length,
    filterOptions: input.dimensions.reduce((sum, dimension) => sum + dimension.options.length, 0),
    filterCombinationsPlanned: input.combinations.length,
    filterCombinationsExecuted: input.combinations.filter((combination) => combination.state === 'captured').length,
    checks: countChecks(input.checks),
    budget: {
      pages: input.pages.length,
      actions: input.actions.length,
      depth: input.maxDepth,
      filterCombinations: input.combinations.length,
      durationMs: input.durationMs,
      exhausted,
    },
    limitations: [...limitations],
    basis,
  };
}

export function buildFilterTests(
  dimensions: FilterDimension[],
  combinations: FilterCombination[],
  checks: CheckResult[],
  findings: Finding[],
): ReportFilterTest[] {
  return dimensions.map((dimension) => {
    const related = combinations.filter((combination) =>
      combination.selections.some((selection) => selection.dimensionId === dimension.id),
    );
    const executed = related.filter((combination) => combination.state === 'captured');
    const orders = new Set(related.map((combination) => combination.order.join('>')));
    const resetCheck = checks.find((check) => check.kind === 'filter_reset' && check.status !== 'skipped');
    const additivityFinding = findings.find(
      (finding) =>
        finding.category === 'calculation_error' &&
        (finding.tags.includes(dimension.label) || finding.description.includes(dimension.label)),
    );
    const additivityCheck = checks.find((check) => check.kind === 'filter_additivity');
    const additivityVerdict: ReportFilterTest['additivityVerdict'] = additivityFinding
      ? additivityFinding.confidence === 'suspected'
        ? 'suspected'
        : 'inconsistent'
      : additivityCheck?.status === 'passed'
        ? 'consistent'
        : additivityCheck?.status === 'failed'
          ? 'inconsistent'
          : 'not_applicable';

    return {
      dimension: dimension.label,
      kind: dimension.kind,
      options: dimension.options.map((option) => option.label),
      combinationsExecuted: executed.length,
      orderVariants: orders.size,
      resetRestoredBaseline: resetCheck ? resetCheck.status === 'passed' : null,
      additivityVerdict,
      detail:
        additivityFinding?.description ??
        additivityCheck?.detail ??
        `${dimension.options.length} options discovered; ${executed.length} state(s) captured.`,
    };
  });
}

export interface SummaryInput {
  run: TestRun;
  findings: Finding[];
  checks: CheckResult[];
  pages: PageState[];
  actions: ActionRecord[];
  dimensions: FilterDimension[];
  combinations: FilterCombination[];
  snapshots: MetricSnapshot[];
  elementsDiscovered: number;
  elementsTested: number;
  visitedPages: number;
  loopsPrevented: number;
  durationMs: number;
  coverage: CoverageReport;
}

export function buildSummary(input: SummaryInput): RunSummary {
  const severities = countSeverities(input.findings);
  const sorted = [...input.findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return {
    findingsTotal: input.findings.length,
    confirmed: input.findings.filter((finding) => finding.confidence === 'confirmed').length,
    suspected: input.findings.filter((finding) => finding.confidence === 'suspected').length,
    intermittent: input.findings.filter((finding) => finding.status === 'intermittent').length,
    severities,
    checks: countChecks(input.checks),
    pagesDiscovered: input.pages.length,
    pagesVisited: input.visitedPages,
    elementsDiscovered: input.elementsDiscovered,
    elementsTested: input.elementsTested,
    filterDimensions: input.dimensions.length,
    filterCombinationsExecuted: input.combinations.filter((combination) => combination.state === 'captured').length,
    filterCombinationsPlanned: input.combinations.length,
    metricSamplesCaptured: input.snapshots.reduce((sum, snapshot) => sum + snapshot.metrics.length, 0),
    statesDiscovered: input.pages.length,
    loopsPrevented: input.loopsPrevented,
    durationMs: input.durationMs,
    coverageCompleteness: input.coverage.completeness,
    limitations: input.coverage.limitations,
    topFindings: sorted.slice(0, 8).map((finding) => ({
      id: finding.id,
      title: finding.title,
      category: finding.category,
      severity: finding.severity,
      confidence: finding.confidence,
      status: finding.status,
      pageUrl: finding.pageUrl,
    })),
    viewports: input.run.config.viewports,
    seed: input.run.config.seed,
    generatedAt: nowIso(),
  };
}

export interface ReportInput extends SummaryInput {
  logs: RunLogEntry[];
  ai: AiUsageSummary;
  narrative?: string | null;
}

export function buildReport(input: ReportInput): RunReport {
  const summary = buildSummary(input);
  return {
    meta: {
      generatedAt: nowIso(),
      generator: 'smartqa-engine',
      formatVersion: 1,
      runId: input.run.id,
      seed: input.run.config.seed,
      url: input.run.url,
      mode: input.run.mode,
    },
    run: input.run,
    summary,
    coverage: input.coverage,
    findings: [...input.findings].sort((a, b) => {
      const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      return severity !== 0 ? severity : a.title.localeCompare(b.title);
    }),
    checks: input.checks,
    snapshots: input.snapshots,
    filterTests: buildFilterTests(input.dimensions, input.combinations, input.checks, input.findings),
    stateGraph: {
      states: input.pages,
      actions: input.actions,
      frontierStateIds: input.pages
        .filter((page) =>
          input.actions.some((action) => action.pageStateId === page.id && action.status === 'pending'),
        )
        .map((page) => page.id),
      loopsPrevented: input.loopsPrevented,
      maxDepthReached: input.coverage.budget.depth,
      visitedUrls: input.pages.filter((page) => page.visitCount > 0).map((page) => page.url),
    },
    logs: input.logs,
    limitations: input.coverage.limitations,
    aiUsage: input.ai,
    narrative: input.narrative ?? null,
  };
}

/** JSON export: stable, self-describing, safe to archive or diff. */
export function serializeReport(report: RunReport): string {
  return JSON.stringify(
    {
      $schema: 'https://smartqa.local/schemas/run-report.v1.json',
      ...report,
      exportedAt: nowIso(),
    },
    null,
    2,
  );
}
