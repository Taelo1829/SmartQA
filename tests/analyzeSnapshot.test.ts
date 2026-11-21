import { describe, expect, it } from 'vitest';
import { analyzeSnapshot } from '@smartqa/engine';
import type { PageSnapshot } from '@smartqa/engine';

function createMockSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: 'https://app.example.com/dashboard',
    title: 'Dashboard',
    readyState: 'complete',
    mainText: 'Dashboard summary with normal text and metrics',
    bodyTextLength: 50,
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
    domSignature: 'sig123',
    elementCount: 10,
    ...overrides,
  };
}

describe('analyzeSnapshot', () => {
  const ctx = {
    runId: 'run-1',
    pageUrl: 'https://app.example.com/dashboard',
    pageTitle: 'Dashboard',
    pageStateId: 'state-1',
    actionId: 'action-1',
    viewport: 'desktop' as const,
  };

  it('detects isolated NaN and undefined as high/medium invalid_value findings', () => {
    const snapshot = createMockSnapshot({
      sentinels: [
        {
          token: 'nan',
          text: 'NaN',
          selector: '#sales-value',
          isolated: true,
          context: 'Total Sales: NaN',
          tag: 'span',
        },
        {
          token: 'undefined',
          text: 'undefined',
          selector: '#user-name',
          isolated: true,
          context: 'Welcome, undefined',
          tag: 'div',
        },
      ],
    });

    const analysis = analyzeSnapshot(snapshot, ctx);
    const nanFinding = analysis.findings.find((f) => f.title.includes('nan'));
    const undefFinding = analysis.findings.find((f) => f.title.includes('undefined'));

    expect(nanFinding).toBeDefined();
    expect(nanFinding?.category).toBe('invalid_value');
    expect(nanFinding?.severity).toBe('high');
    expect(nanFinding?.confidence).toBe('confirmed');

    expect(undefFinding).toBeDefined();
    expect(undefFinding?.category).toBe('invalid_value');
    expect(undefFinding?.severity).toBe('medium');

    const check = analysis.checks.find((c) => c.kind === 'invalid_value');
    expect(check?.status).toBe('failed');
  });

  it('ignores legitimate prose containing undefined', () => {
    const snapshot = createMockSnapshot({
      sentinels: [
        {
          token: 'undefined',
          text: 'undefined behaviour is prevented',
          selector: '#doc-text',
          isolated: false,
          context: 'In standard SQL, undefined behaviour is prevented by schema validation.',
          tag: 'p',
        },
      ],
    });

    const analysis = analyzeSnapshot(snapshot, ctx);
    const findings = analysis.findings.filter((f) => f.category === 'invalid_value');
    expect(findings).toHaveLength(0);
  });

  it('identifies broken images as broken_image findings', () => {
    const snapshot = createMockSnapshot({
      images: [
        { src: 'https://app.example.com/logo.png', alt: 'Logo', broken: false, visible: true },
        { src: 'https://app.example.com/avatar-missing.jpg', alt: 'Avatar', broken: true, visible: true },
      ],
    });

    const analysis = analyzeSnapshot(snapshot, ctx);
    const imageFinding = analysis.findings.find((f) => f.category === 'broken_image');
    expect(imageFinding).toBeDefined();
    expect(imageFinding?.title).toContain('avatar-missing.jpg');

    const check = analysis.checks.find((c) => c.kind === 'image_load');
    expect(check?.status).toBe('failed');
  });

  it('flags layout overflow when document width exceeds client width', () => {
    const snapshot = createMockSnapshot({
      overflow: {
        scrollWidth: 1250,
        clientWidth: 1000,
        offenders: [
          { selector: '.wide-table', tag: 'table', text: 'Large data table', right: 1250, width: 1200 },
        ],
      },
    });

    const analysis = analyzeSnapshot(snapshot, ctx);
    const overflowFinding = analysis.findings.find((f) => f.category === 'layout_overflow');
    expect(overflowFinding).toBeDefined();
    expect(overflowFinding?.observed).toContain('scrollWidth=1250 vs clientWidth=1000');

    const check = analysis.checks.find((c) => c.kind === 'layout_overflow');
    expect(check?.status).toBe('failed');
  });

  it('flags overlapping interactive elements', () => {
    const snapshot = createMockSnapshot({
      overlaps: [
        {
          a: { selector: '#btn-submit', label: 'Submit', tag: 'button' },
          b: { selector: '#btn-cancel', label: 'Cancel', tag: 'button' },
          ratio: 0.75,
        },
      ],
    });

    const analysis = analyzeSnapshot(snapshot, ctx);
    const overlapFinding = analysis.findings.find((f) => f.category === 'element_overlap');
    expect(overlapFinding).toBeDefined();
    expect(overlapFinding?.description).toContain('75%');
  });

  it('validates table footer totals against column values', () => {
    const snapshot = createMockSnapshot({
      tables: [
        {
          headers: ['Product', 'Amount'],
          rows: [
            ['Apples', 'R100'],
            ['Oranges', 'R150'],
            ['Bananas', 'R250'],
          ],
          rowCount: 3,
          footer: ['Total', 'R600'], // Intentional bug: 100 + 150 + 250 = 500, but footer says 600
          page: 1,
          totalPages: 1,
          paginationLabel: null,
        },
      ],
    });

    const analysis = analyzeSnapshot(snapshot, ctx);
    const calcFinding = analysis.findings.find((f) => f.category === 'calculation_error');
    expect(calcFinding).toBeDefined();
    expect(calcFinding?.calculation?.expected).toBe(600);
    expect(calcFinding?.calculation?.observed).toBe(500);
  });
});
