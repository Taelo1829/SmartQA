import { describe, expect, it } from 'vitest';
import { metricsFromSnapshot } from '@smartqa/engine';
import type { PageSnapshot } from '@smartqa/engine';

describe('FilterEngine helpers', () => {
  it('extracts unique valid metrics from snapshot', () => {
    const snapshot: PageSnapshot = {
      url: 'https://example.com/dashboard',
      title: 'Dashboard',
      readyState: 'complete',
      mainText: 'Dashboard',
      bodyTextLength: 100,
      elements: [],
      filters: [],
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
      elementCount: 5,
      metrics: [
        {
          label: 'Total Sales',
          rawText: 'R100,000',
          value: 100000,
          unit: 'R',
          selector: '#kpi-sales',
          scope: 'kpi',
          groupKey: null,
        },
        {
          label: 'Total Sales', // Duplicate sample
          rawText: 'R100,000',
          value: 100000,
          unit: 'R',
          selector: '#kpi-sales-dup',
          scope: 'kpi',
          groupKey: null,
        },
        {
          label: 'Conversion Rate',
          rawText: '4.5%',
          value: 4.5,
          unit: '%',
          selector: '#kpi-cr',
          scope: 'kpi',
          groupKey: null,
        },
      ],
    };

    const samples = metricsFromSnapshot(snapshot);
    expect(samples).toHaveLength(2);
    expect(samples[0].label).toBe('Total Sales');
    expect(samples[0].additivity).toBe('additive');
    expect(samples[1].label).toBe('Conversion Rate');
    expect(samples[1].additivity).toBe('non_additive');
  });
});
