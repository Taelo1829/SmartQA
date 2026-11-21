import { describe, expect, it } from 'vitest';
import { analyzeSnapshot, assessNoOpControl, isReliableFilterMetric, metricsFromSnapshot, rowCountFromSnapshot, toMetricSample } from '@smartqa/engine';
import type { PageSnapshot } from '@smartqa/engine';

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: 'https://app.example.com/dashboard/sales',
    title: 'Sales dashboard',
    readyState: 'complete',
    mainText: 'Sales dashboard with normal content',
    bodyTextLength: 100,
    elements: [],
    filters: [],
    metrics: [],
    tables: [],
    links: [],
    images: [],
    sentinels: [],
    overflow: { scrollWidth: 1000, clientWidth: 1000, offenders: [] },
    overlaps: [],
    spinners: [],
    emptyStateText: null,
    modal: null,
    domSignature: 'sig',
    elementCount: 1,
    ...overrides,
  };
}

const context = {
  runId: 'run-1',
  pageUrl: 'https://app.example.com/dashboard/sales',
  pageTitle: 'Sales dashboard',
  pageStateId: 'state-1',
  viewport: 'desktop' as const,
};

describe('detector regressions', () => {
  it('reports a dead Export control instead of silently suppressing it', () => {
    const assessment = assessNoOpControl('Export PDF');
    expect(assessment.hiddenEffectPossible).toBe(true);
    expect(assessment.title).toContain('no observable effect');
    expect(assessment.suspectedReason).toContain('Downloads');

    const regular = assessNoOpControl('Apply filters');
    expect(regular.hiddenEffectPossible).toBe(false);
    expect(regular.title).toContain('appears to do nothing');
  });

  it('detects a currency-prefixed undefined sentinel', () => {
    const analysis = analyzeSnapshot(
      snapshot({
        sentinels: [
          {
            token: 'undefined',
            text: 'Rundefined',
            selector: '[data-testid="table-footer-total"]',
            isolated: true,
            context: 'Total Rundefined',
            tag: 'td',
          },
        ],
      }),
      context,
    );
    const finding = analysis.findings.find(
      (item) => item.category === 'invalid_value' && item.observed === 'Rundefined',
    );
    expect(finding).toBeDefined();
    expect(finding?.confidence).toBe('confirmed');
  });

  it('reports a displayed breakdown mismatch as suspected, not confirmed', () => {
    const analysis = analyzeSnapshot(
      snapshot({
        metrics: [
          {
            label: 'Total sales',
            rawText: 'R72,000',
            value: 72000,
            unit: 'R',
            selector: '#total-sales',
            scope: 'kpi',
            groupKey: null,
          },
          {
            label: 'Johannesburg',
            rawText: 'R28,800',
            value: 28800,
            unit: 'R',
            selector: '#region-johannesburg-total',
            scope: 'kpi',
            groupKey: 'list:breakdown',
          },
          {
            label: 'Pretoria',
            rawText: 'R18,000',
            value: 18000,
            unit: 'R',
            selector: '#region-pretoria-total',
            scope: 'kpi',
            groupKey: 'list:breakdown',
          },
          {
            label: 'Cape Town',
            rawText: 'R14,400',
            value: 14400,
            unit: 'R',
            selector: '#region-cape-town-total',
            scope: 'kpi',
            groupKey: 'list:breakdown',
          },
          {
            label: 'Durban',
            rawText: 'R6,840',
            value: 6840,
            unit: 'R',
            selector: '#region-durban-total',
            scope: 'kpi',
            groupKey: 'list:breakdown',
          },
        ],
      }),
      context,
    );

    const finding = analysis.findings.find(
      (item) => item.category === 'calculation_error' && item.title.includes('breakdown'),
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('medium');
    expect(finding?.confidence).toBe('suspected');
    expect(finding?.calculation?.expected).toBe(72000);
    expect(finding?.calculation?.observed).toBe(68040);
  });

  it('keeps table cells and decorative copy out of filter metric comparisons', () => {
    const tableSample = toMetricSample(
      { label: 'Amount', rawText: 'R100', selector: '#cell', scope: 'table_row' },
      { pageUrl: context.pageUrl },
    );
    const copySample = toMetricSample(
      { label: '© Northwind Sales. Demo environment.', rawText: '2026', selector: '#footer', scope: 'kpi' },
      { pageUrl: context.pageUrl },
    );
    const kpiSample = toMetricSample(
      { label: 'Total sales', rawText: 'R100,000', selector: '#total', scope: 'kpi' },
      { pageUrl: context.pageUrl },
    );

    expect(tableSample && isReliableFilterMetric(tableSample)).toBe(false);
    expect(copySample && isReliableFilterMetric(copySample)).toBe(false);
    expect(kpiSample && isReliableFilterMetric(kpiSample)).toBe(true);

    const samples = metricsFromSnapshot(
      snapshot({
        metrics: [
          { label: 'Amount', rawText: 'R100', value: 100, unit: 'R', selector: '#cell', scope: 'table_row', groupKey: null },
          { label: 'Total sales', rawText: 'R100,000', value: 100000, unit: 'R', selector: '#total', scope: 'kpi', groupKey: null },
        ],
      }),
    );
    expect(samples.map((sample) => sample.label)).toEqual(['Total sales']);
  });

  it('counts only real data rows when a table contains skeleton rows', () => {
    const result = rowCountFromSnapshot(
      snapshot({
        tables: [
          {
            headers: ['Order', 'Date', 'Region', 'Status', 'Amount'],
            rows: [['Loading…']],
            rowCount: 5,
            dataRowCount: 0,
            footer: [],
            page: 1,
            totalPages: 1,
            paginationLabel: null,
          },
        ],
      }),
    );
    expect(result).toBe(0);
  });
});
