import type {
  Additivity,
  CalculationDetail,
  Confidence,
  MetricKind,
  MetricSample,
  MetricScope,
} from '@smartqa/shared';

/**
 * Metric parsing, classification and arithmetic validation.
 *
 * Design rule: the AI never invents an expected value. Every expectation here
 * is derived from the numbers the application itself displayed, using
 * arithmetic that is only applied when the metric is known to be additive.
 */

const NON_ADDITIVE_LABEL =
  /\b(average|avg|mean|median|percent|percentage|rate|ratio|margin|growth|conversion|score|unique|distinct|per\s+(customer|user|order|day|capita|session)|utilisation|utilization|occupancy|share|index|nps|csat|latency|duration|time\s+on)\b|%/i;

const ADDITIVE_LABEL =
  /\b(total|sum|revenue|sales|amount|count|orders?|customers?|quantity|units?|balance|spend|cost|price|visits?|clicks?|impressions?|transactions?|volume|users?|records?|rows?|invoices?|refunds?|fees?|tax)\b/i;

const CURRENCY_PREFIX = /^\s*(R|\$|€|£|¥|CHF|USD|EUR|ZAR)\s*/i;

export interface ParsedNumber {
  value: number;
  unit: string | null;
  /** Text the number was read from, trimmed. */
  raw: string;
}

/**
 * Parse a displayed number. Handles currency prefixes/suffixes, thousands
 * separators (both 1,234.56 and 1.234,56), percentages, parentheses negatives
 * and a leading plus. Returns null when the text has no single unambiguous
 * number (e.g. a date range or an order number).
 */
export function parseNumberText(input: string): ParsedNumber | null {
  if (!input) return null;
  const text = input.replace(/\u00a0/g, ' ').replace(/\u2212/g, '-').trim();
  // Dates and identifiers are not metrics.
  if (/^\d{4}-\d{2}-\d{2}/.test(text) || /^\d{4}\/\d{1,2}\/\d{1,2}/.test(text)) return null;
  const percentMatch = text.match(/(-?[\d\s.,]+)\s*%/);
  const currencyMatch = text.match(CURRENCY_PREFIX);
  const numberMatch = text.match(/-?\d[\d\s.,]*/);
  if (!numberMatch) return null;

  // Reject numbers glued to letters (order ids, codes, "v2", "ORD-1001").
  if (!percentMatch && !currencyMatch) {
    const index = text.indexOf(numberMatch[0]);
    const before = text.slice(0, index);
    const after = text.slice(index + numberMatch[0].length);
    if (/[a-zA-Z]$/.test(before) || /^[a-zA-Z]/.test(after)) return null;
  }

  const candidate = (percentMatch ? percentMatch[1] : numberMatch[0]).replace(/\s+/g, '');
  if (!candidate || !/\d/.test(candidate)) return null;

  const normalized = normalizeSeparators(candidate);
  if (normalized === null) return null;
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;

  const unit = percentMatch ? '%' : currencyMatch ? currencyMatch[1].toUpperCase() : null;
  return { value, unit, raw: text };
}

function normalizeSeparators(candidate: string): string | null {
  const hasComma = candidate.includes(',');
  const hasDot = candidate.includes('.');
  let result = candidate;
  if (hasComma && hasDot) {
    // Whichever separator appears last is the decimal separator.
    const lastComma = candidate.lastIndexOf(',');
    const lastDot = candidate.lastIndexOf('.');
    result = lastComma > lastDot ? candidate.replace(/\./g, '').replace(',', '.') : candidate.replace(/,/g, '');
  } else if (hasComma) {
    const parts = candidate.split(',');
    if (parts.length === 2 && parts[1].length === 3) result = parts.join('');
    else result = parts.join('.');
  } else if (hasDot) {
    const parts = candidate.split('.');
    if (parts.length > 2) result = parts.join('');
  }
  if (!/^-?\d+(\.\d+)?$/.test(result)) return null;
  return result;
}

export function normalizeMetricKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

export function classifyMetricKind(label: string, unit: string | null, value: number): MetricKind {
  const lower = label.toLowerCase();
  if (unit === '%' || /%|\bpercent|percentage\b/.test(lower)) return 'percentage';
  if (/\b(average|avg|mean|median)\b/.test(lower)) return 'average';
  if (/\b(unique|distinct)\b/.test(lower)) return 'distinct_count';
  if (unit && /^(R|\$|€|£|¥|CHF|USD|EUR|ZAR)$/i.test(unit)) return 'currency';
  if (/\b(rate|ratio|conversion|margin|score|nps|csat)\b/.test(lower)) return 'ratio';
  if (/\b(duration|latency|time on|seconds|minutes|hours)\b/.test(lower)) return 'duration';
  if (/\b(count|orders|customers|users|visits|clicks|records|rows|transactions|units)\b/.test(lower)) {
    return Number.isInteger(value) ? 'integer' : 'decimal';
  }
  if (Number.isInteger(value)) return 'integer';
  return 'decimal';
}

/**
 * Decide whether values of this metric can be summed.
 *
 * Non-additive wins over additive: "average order value" contains "order" but
 * must never be summed. When nothing matches, the metric is `unknown` and the
 * engine will not perform a sum check on it.
 */
export function classifyAdditivity(label: string, kind: MetricKind, unit: string | null): {
  additivity: Additivity;
  reason: string;
} {
  const lower = label.toLowerCase();
  if (unit === '%' || kind === 'percentage') {
    return { additivity: 'non_additive', reason: 'Percentages are ratios of a changing denominator and cannot be summed.' };
  }
  if (kind === 'average') {
    return { additivity: 'non_additive', reason: 'Averages are means; summing them does not produce a mean of the whole.' };
  }
  if (kind === 'distinct_count') {
    return {
      additivity: 'non_additive',
      reason: 'Distinct counts overlap between groups, so sums double-count entities.',
    };
  }
  if (kind === 'ratio' || NON_ADDITIVE_LABEL.test(lower)) {
    return { additivity: 'non_additive', reason: 'Rate/ratio/derived metric; group values are not additive.' };
  }
  if (kind === 'duration') {
    return { additivity: 'non_additive', reason: 'Duration averages are not additive.' };
  }
  if (ADDITIVE_LABEL.test(lower)) {
    return { additivity: 'additive', reason: 'Label describes an extensive quantity (total/count/amount).' };
  }
  if (kind === 'currency' || kind === 'integer' || kind === 'decimal') {
    return {
      additivity: 'unknown',
      reason: 'Numeric metric without an explicit additive/derived label; summing is not justified.',
    };
  }
  return { additivity: 'unknown', reason: 'Metric semantics could not be established.' };
}

export interface RawMetricInput {
  label: string;
  rawText: string;
  value?: number | null;
  unit?: string | null;
  selector: string;
  scope: string;
  groupKey?: string | null;
}

const UNRELIABLE_METRIC_LABEL = /(©|\bcopyright\b|\bdemo environment\b|\bpage\s+\d+\b)/i;

/**
 * Dashboard partition checks may only use page-level metrics with an explicit
 * label. Table cells, footer labels and decorative copy are evidence for other
 * checks, but summing them against KPIs produces fake arithmetic findings.
 */
export function isReliableFilterMetric(sample: MetricSample): boolean {
  if (sample.scope !== 'kpi' && sample.scope !== 'filtered_total') return false;
  if (!sample.label.trim()) return false;
  return !UNRELIABLE_METRIC_LABEL.test(sample.label);
}

export function toMetricSample(input: RawMetricInput, context: { pageUrl: string }): MetricSample | null {
  const parsed =
    input.value == null
      ? parseNumberText(input.rawText)
      : { value: input.value, unit: input.unit ?? null, raw: input.rawText };
  if (!parsed) return null;
  const label = input.label.trim();
  if (!label) return null;
  const kind = classifyMetricKind(label, parsed.unit, parsed.value);
  const { additivity, reason } = classifyAdditivity(label, kind, parsed.unit);
  const scope: MetricScope =
    input.scope === 'table_row'
      ? 'table_row'
      : input.scope === 'table_total'
        ? 'table_total'
        : input.scope === 'filtered_total'
          ? 'filtered_total'
          : 'kpi';
  void context.pageUrl;
  return {
    key: normalizeMetricKey(label),
    label,
    rawText: parsed.raw,
    value: parsed.value,
    unit: parsed.unit,
    kind,
    additivity,
    additivityReason: reason,
    scope,
    source: input.selector,
    groupKey: input.groupKey ?? null,
    plausibleMin: kind === 'percentage' ? 0 : null,
    plausibleMax: kind === 'percentage' ? 100 : null,
  };
}

/**
 * Tolerance for a sum comparison: half a unit per component (rounding of
 * integers) plus 0.1% for display rounding of larger values.
 */
export function sumTolerance(expected: number, componentCount: number): number {
  const rounding = Math.max(0.5, Math.abs(expected) * 0.001);
  return Math.max(rounding * Math.max(1, componentCount), 0.5);
}

export type PartitionVerdict = 'pass' | 'fail' | 'suspect' | 'not_applicable';

export interface PartitionEvaluation {
  verdict: PartitionVerdict;
  expected: number;
  observed: number;
  delta: number;
  tolerance: number;
  formula: string;
  reason: string;
  confidence: Confidence;
  components: Array<{ label: string; value: number }>;
  additivity: Additivity;
  metricKind: MetricKind;
  unit: string | null;
}

/**
 * Compare the sum of per-option values against the unfiltered total.
 *
 * Only called for additive metrics. The caller states whether the option set is
 * known to be an exhaustive partition; when it is not, a mismatch is reported
 * as a *suspected* inconsistency rather than a confirmed bug.
 */
export function evaluatePartitionSum(input: {
  metricLabel: string;
  kind: MetricKind;
  additivity: Additivity;
  unit: string | null;
  baseline: number;
  parts: Array<{ label: string; value: number }>;
  exhaustive: boolean;
}): PartitionEvaluation {
  const components = input.parts.map((part) => ({ label: part.label, value: part.value }));
  const observed = components.reduce((sum, part) => sum + part.value, 0);
  const tolerance = sumTolerance(input.baseline, components.length);
  const delta = round(observed - input.baseline, 4);
  const formula = `${components.map((part) => formatNumber(part.value, input.unit)).join(' + ')} = ${formatNumber(
    observed,
    input.unit,
  )} vs ${formatNumber(input.baseline, input.unit)}`;

  if (input.additivity !== 'additive') {
    return {
      verdict: 'not_applicable',
      expected: input.baseline,
      observed,
      delta,
      tolerance,
      formula,
      reason: `Metric "${input.metricLabel}" is ${input.additivity}; summation is not a valid check.`,
      confidence: 'suspected',
      components,
      additivity: input.additivity,
      metricKind: input.kind,
      unit: input.unit,
    };
  }
  if (components.length < 2) {
    return {
      verdict: 'not_applicable',
      expected: input.baseline,
      observed,
      delta,
      tolerance,
      formula,
      reason: 'Fewer than two components were observed; no partition check is possible.',
      confidence: 'suspected',
      components,
      additivity: input.additivity,
      metricKind: input.kind,
      unit: input.unit,
    };
  }

  if (Math.abs(delta) <= tolerance) {
    return {
      verdict: 'pass',
      expected: input.baseline,
      observed,
      delta,
      tolerance,
      formula,
      reason: `Component sum equals the unfiltered total within ±${round(tolerance, 2)}.`,
      confidence: 'confirmed',
      components,
      additivity: input.additivity,
      metricKind: input.kind,
      unit: input.unit,
    };
  }

  const relative = input.baseline === 0 ? 1 : Math.abs(delta) / Math.abs(input.baseline);
  const verdict: PartitionVerdict = input.exhaustive ? 'fail' : 'suspect';
  const confidence: Confidence = input.exhaustive ? (relative > 0.005 ? 'confirmed' : 'probable') : 'suspected';
  return {
    verdict,
    expected: input.baseline,
    observed,
    delta,
    tolerance,
    formula,
    reason: input.exhaustive
      ? `Sum of the exhaustive partition differs from the total by ${formatNumber(delta, input.unit)} (${(
          relative * 100
        ).toFixed(2)}%), beyond the ±${round(tolerance, 2)} rounding tolerance.`
      : `Sum differs by ${formatNumber(delta, input.unit)}, but exhaustiveness of this option set is not established; reported as suspected.`,
    confidence,
    components,
    additivity: input.additivity,
    metricKind: input.kind,
    unit: input.unit,
  };
}

export type CoherenceVerdict = 'pass' | 'fail' | 'suspect' | 'not_applicable';

export interface CoherenceEvaluation {
  verdict: CoherenceVerdict;
  reason: string;
  confidence: Confidence;
  detail: string;
}

/**
 * Checks that are valid for non-additive metrics.
 *
 *  - A weighted mean/percentage of subgroups must lie between the subgroup min
 *    and max (this is a mathematical invariant, not an assumption).
 *  - Percentages must lie in [0, 100].
 *  - A distinct count of subgroups can exceed the total (overlap), but cannot be
 *    smaller than the largest subgroup.
 */
export function evaluateCoherence(input: {
  metricLabel: string;
  kind: MetricKind;
  additivity: Additivity;
  total: number;
  parts: Array<{ label: string; value: number }>;
}): CoherenceEvaluation {
  const { total, parts, kind } = input;
  if (parts.length === 0) {
    return { verdict: 'not_applicable', reason: 'No subgroup values to compare.', confidence: 'suspected', detail: '' };
  }
  const values = parts.map((part) => part.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (kind === 'percentage' || kind === 'average') {
    const tolerance = Math.max(0.05, Math.abs(max) * 0.001);
    if (total < min - tolerance || total > max + tolerance) {
      return {
        verdict: 'fail',
        reason: `The overall ${input.metricLabel} (${round(total, 2)}) lies outside the range of its subgroups (${round(
          min,
          2,
        )}–${round(max, 2)}). A weighted mean must fall inside the subgroup range.`,
        confidence: 'confirmed',
        detail: `total=${round(total, 2)}, min=${round(min, 2)}, max=${round(max, 2)}`,
      };
    }
    return {
      verdict: 'pass',
      reason: `Overall value is within the subgroup range (${round(min, 2)}–${round(max, 2)}), consistent with a weighted average.`,
      confidence: 'confirmed',
      detail: '',
    };
  }

  if (kind === 'distinct_count') {
    const largest = max;
    if (total < largest) {
      return {
        verdict: 'fail',
        reason: `Overall distinct count (${total}) is smaller than the largest subgroup (${largest}); impossible for a union.`,
        confidence: 'confirmed',
        detail: `total=${total}, max=${largest}`,
      };
    }
    return {
      verdict: 'pass',
      reason: 'Overall distinct count is at least the largest subgroup, consistent with overlapping sets.',
      confidence: 'probable',
      detail: '',
    };
  }

  return {
    verdict: 'not_applicable',
    reason: `No order-independent invariant is available for ${input.metricLabel} (${input.additivity}).`,
    confidence: 'suspected',
    detail: '',
  };
}

/**
 * Check a table footer total against the sum of the rows currently displayed.
 * Only additive columns are eligible; the caller supplies the footer label.
 */
export function evaluateTableTotal(input: {
  columnLabel: string;
  kind: MetricKind;
  additivity: Additivity;
  unit: string | null;
  footerValue: number;
  rowValues: number[];
}): PartitionEvaluation {
  return evaluatePartitionSum({
    metricLabel: input.columnLabel,
    kind: input.kind,
    additivity: input.additivity,
    unit: input.unit,
    baseline: input.footerValue,
    parts: input.rowValues.map((value, index) => ({ label: `row ${index + 1}`, value })),
    exhaustive: true,
  });
}

export function toCalculationDetail(evaluation: PartitionEvaluation, sampleSize: number): CalculationDetail {
  return {
    formula: evaluation.formula,
    expected: evaluation.expected,
    observed: evaluation.observed,
    delta: evaluation.delta,
    tolerance: round(evaluation.tolerance, 4),
    components: evaluation.components,
    additivity: evaluation.additivity,
    metricKind: evaluation.metricKind,
    unit: evaluation.unit,
    sampleSize,
    confidence: evaluation.confidence,
    reason: evaluation.reason,
  };
}

/** Stable map of metricKey -> value for state comparisons. */
export function metricValues(samples: MetricSample[]): Map<string, MetricSample> {
  const map = new Map<string, MetricSample>();
  for (const sample of samples) {
    if (sample.value === null) continue;
    const existing = map.get(sample.key);
    // Prefer page-level totals over table rows with the same label.
    if (!existing || scopeRank(sample.scope) > scopeRank(existing.scope)) map.set(sample.key, sample);
  }
  return map;
}

function scopeRank(scope: MetricScope): number {
  switch (scope) {
    case 'table_total':
      return 3;
    case 'filtered_total':
      return 4;
    case 'kpi':
      return 2;
    case 'page_total':
      return 1;
    case 'table_row':
      return 0;
    default:
      return 0;
  }
}

export interface SnapshotComparison {
  equal: boolean;
  differences: Array<{ key: string; left: number; right: number; delta: number }>;
  comparedKeys: string[];
}

/** Compare two metric states, ignoring display-only text differences. */
export function compareMetricStates(
  left: MetricSample[],
  right: MetricSample[],
  toleranceRatio = 0.001,
): SnapshotComparison {
  const leftMap = metricValues(left);
  const rightMap = metricValues(right);
  const comparedKeys: string[] = [];
  const differences: SnapshotComparison['differences'] = [];
  for (const [key, sample] of leftMap) {
    const other = rightMap.get(key);
    if (!other || sample.value === null || other.value === null) continue;
    comparedKeys.push(key);
    const tolerance = Math.max(0.5, Math.abs(sample.value) * toleranceRatio);
    if (Math.abs(sample.value - other.value) > tolerance) {
      differences.push({ key, left: sample.value, right: other.value, delta: round(other.value - sample.value, 4) });
    }
  }
  return { equal: differences.length === 0, differences, comparedKeys };
}

export function formatNumber(value: number, unit: string | null): string {
  const formatted = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 2 }).format(value);
  if (!unit) return formatted;
  return unit === '%' ? `${formatted}%` : `${unit}${formatted}`;
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
