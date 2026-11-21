import { describe, expect, it } from 'vitest';
import {
  classifyAdditivity,
  classifyMetricKind,
  compareMetricStates,
  evaluateCoherence,
  evaluatePartitionSum,
  evaluateTableTotal,
  normalizeMetricKey,
  parseNumberText,
  sumTolerance,
  toMetricSample,
} from '@smartqa/engine';

/**
 * The mathematical core of the product. If these tests are wrong the platform
 * either misses real calculation bugs or invents fake ones.
 */

describe('parseNumberText', () => {
  it('parses South African currency with comma thousands separators', () => {
    expect(parseNumberText('R100,000')).toMatchObject({ value: 100000, unit: 'R' });
    expect(parseNumberText('R 40 000.50')).toMatchObject({ value: 40000.5, unit: 'R' });
    expect(parseNumberText('$1,234.56')).toMatchObject({ value: 1234.56, unit: '$' });
  });

  it('parses European decimal commas', () => {
    expect(parseNumberText('1.234,56 €')).toMatchObject({ value: 1234.56 });
    expect(parseNumberText('R15 000,00')).toMatchObject({ value: 15000 });
  });

  it('parses percentages and negatives', () => {
    expect(parseNumberText('3.2%')).toMatchObject({ value: 3.2, unit: '%' });
    expect(parseNumberText('-12.5%')).toMatchObject({ value: -12.5, unit: '%' });
    expect(parseNumberText('R-1,200')).toMatchObject({ value: -1200, unit: 'R' });
  });

  it('rejects text without an unambiguous number', () => {
    expect(parseNumberText('No data')).toBeNull();
    expect(parseNumberText('')).toBeNull();
    expect(parseNumberText('ORD-1001')).toBeNull();
  });
});

describe('metric classification', () => {
  it('treats totals and counts as additive', () => {
    const sample = toMetricSample(
      { label: 'Total sales', rawText: 'R100,000', selector: '[data-testid=kpi-sales]', scope: 'kpi' },
      { pageUrl: 'https://example.com' },
    );
    expect(sample?.kind).toBe('currency');
    expect(sample?.additivity).toBe('additive');
    expect(sample?.value).toBe(100000);
  });

  it('never treats averages, percentages or distinct counts as additive', () => {
    const average = toMetricSample(
      { label: 'Average order value', rawText: 'R80', selector: '#aov', scope: 'kpi' },
      { pageUrl: 'https://example.com' },
    );
    expect(average?.kind).toBe('average');
    expect(average?.additivity).toBe('non_additive');

    const percent = toMetricSample(
      { label: 'Conversion rate', rawText: '3.2%', selector: '#conv', scope: 'kpi' },
      { pageUrl: 'https://example.com' },
    );
    expect(percent?.additivity).toBe('non_additive');

    const unique = toMetricSample(
      { label: 'Unique customers', rawText: '1,240', selector: '#unique', scope: 'kpi' },
      { pageUrl: 'https://example.com' },
    );
    expect(unique?.additivity).toBe('non_additive');
  });

  it('leaves ambiguous numbers as unknown so they are never summed', () => {
    const result = toMetricSample(
      { label: 'Engagement', rawText: '42', selector: '#x', scope: 'kpi' },
      { pageUrl: 'https://example.com' },
    );
    expect(result?.additivity).toBe('unknown');
  });

  it('normalises labels for cross-state comparison', () => {
    expect(normalizeMetricKey('Total Sales (R)')).toBe('total sales');
    expect(normalizeMetricKey('  Average Order Value  ')).toBe('average order value');
  });

  it('classifies kinds from labels and units', () => {
    expect(classifyMetricKind('Conversion rate', '%', 3.2)).toBe('percentage');
    expect(classifyMetricKind('Distinct users', null, 10)).toBe('distinct_count');
    expect(classifyMetricKind('Orders', null, 1250)).toBe('integer');
    expect(classifyMetricKind('Revenue', 'R', 10)).toBe('currency');
    expect(classifyAdditivity('Total revenue', 'currency', 'R').additivity).toBe('additive');
  });
});

describe('partition additivity', () => {
  const base = {
    metricLabel: 'Total sales',
    kind: 'currency' as const,
    additivity: 'additive' as const,
    unit: 'R',
  };

  it('passes when the exhaustive regional split equals the total', () => {
    const evaluation = evaluatePartitionSum({
      ...base,
      baseline: 100000,
      parts: [
        { label: 'Johannesburg', value: 40000 },
        { label: 'Pretoria', value: 25000 },
        { label: 'Cape Town', value: 20000 },
        { label: 'Durban', value: 15000 },
      ],
      exhaustive: true,
    });
    expect(evaluation.verdict).toBe('pass');
    expect(evaluation.observed).toBe(100000);
    expect(evaluation.delta).toBe(0);
  });

  it('fails a confirmed mismatch beyond the rounding tolerance', () => {
    const evaluation = evaluatePartitionSum({
      ...base,
      baseline: 72000,
      parts: [
        { label: 'Johannesburg', value: 28800 },
        { label: 'Pretoria', value: 18000 },
        { label: 'Cape Town', value: 14400 },
        { label: 'Durban', value: 7300 },
      ],
      exhaustive: true,
    });
    expect(evaluation.verdict).toBe('fail');
    expect(evaluation.confidence).toBe('confirmed');
    expect(evaluation.delta).toBe(-3500);
    expect(evaluation.reason).toContain('differs');
  });

  it('reports a suspected inconsistency when exhaustiveness is unknown', () => {
    const evaluation = evaluatePartitionSum({
      ...base,
      baseline: 100000,
      parts: [
        { label: 'A', value: 30000 },
        { label: 'B', value: 20000 },
      ],
      exhaustive: false,
    });
    expect(evaluation.verdict).toBe('suspect');
    expect(evaluation.confidence).toBe('suspected');
  });

  it('does not sum non-additive metrics', () => {
    const evaluation = evaluatePartitionSum({
      metricLabel: 'Average order value',
      kind: 'average',
      additivity: 'non_additive',
      unit: 'R',
      baseline: 80,
      parts: [
        { label: 'A', value: 120 },
        { label: 'B', value: 60 },
      ],
      exhaustive: true,
    });
    expect(evaluation.verdict).toBe('not_applicable');
    expect(evaluation.reason).toContain('not a valid check');
  });

  it('allows rounding noise within the tolerance', () => {
    const tolerance = sumTolerance(100000, 4);
    const evaluation = evaluatePartitionSum({
      ...base,
      baseline: 100000,
      parts: [
        { label: 'A', value: 40000.4 },
        { label: 'B', value: 25000.2 },
        { label: 'C', value: 20000.2 },
        { label: 'D', value: 14999.1 },
      ],
      exhaustive: true,
    });
    expect(tolerance).toBeGreaterThan(0);
    expect(evaluation.verdict).toBe('pass');
  });
});

describe('non-additive invariants', () => {
  it('accepts an overall average inside the subgroup range', () => {
    const evaluation = evaluateCoherence({
      metricLabel: 'Average order value',
      kind: 'average',
      additivity: 'non_additive',
      total: 92,
      parts: [
        { label: 'A', value: 80 },
        { label: 'B', value: 120 },
      ],
    });
    expect(evaluation.verdict).toBe('pass');
  });

  it('rejects an overall average outside the subgroup range', () => {
    const evaluation = evaluateCoherence({
      metricLabel: 'Average order value',
      kind: 'average',
      additivity: 'non_additive',
      total: 300,
      parts: [
        { label: 'A', value: 80 },
        { label: 'B', value: 120 },
      ],
    });
    expect(evaluation.verdict).toBe('fail');
    expect(evaluation.reason).toContain('outside the range');
  });

  it('rejects a distinct count smaller than its largest subgroup', () => {
    const evaluation = evaluateCoherence({
      metricLabel: 'Unique visitors',
      kind: 'distinct_count',
      additivity: 'non_additive',
      total: 50,
      parts: [
        { label: 'A', value: 40 },
        { label: 'B', value: 90 },
      ],
    });
    expect(evaluation.verdict).toBe('fail');
  });
});

describe('table totals', () => {
  it('compares the footer against the visible rows', () => {
    const evaluation = evaluateTableTotal({
      columnLabel: 'Amount',
      kind: 'currency',
      additivity: 'additive',
      unit: 'R',
      footerValue: 3000,
      rowValues: [1000, 1000, 1000],
    });
    expect(evaluation.verdict).toBe('pass');
  });

  it('flags a footer that does not match its rows', () => {
    const evaluation = evaluateTableTotal({
      columnLabel: 'Amount',
      kind: 'currency',
      additivity: 'additive',
      unit: 'R',
      footerValue: 2500,
      rowValues: [1000, 1000, 1000],
    });
    expect(evaluation.verdict).toBe('fail');
  });
});

describe('state comparison', () => {
  const sample = (label: string, value: number, additivity: 'additive' | 'non_additive' = 'additive') => ({
    key: normalizeMetricKey(label),
    label,
    rawText: String(value),
    value,
    unit: null,
    kind: 'integer' as const,
    additivity,
    additivityReason: 'test',
    scope: 'kpi' as const,
    source: '#x',
    groupKey: null,
  });

  it('treats equal states as equal within tolerance', () => {
    const comparison = compareMetricStates([sample('Total sales', 100000)], [sample('Total sales', 100000)]);
    expect(comparison.equal).toBe(true);
    expect(comparison.comparedKeys).toEqual(['total sales']);
  });

  it('reports order-dependent differences', () => {
    const comparison = compareMetricStates([sample('Total sales', 100000)], [sample('Total sales', 96000)]);
    expect(comparison.equal).toBe(false);
    expect(comparison.differences[0]?.delta).toBe(-4000);
  });
});
