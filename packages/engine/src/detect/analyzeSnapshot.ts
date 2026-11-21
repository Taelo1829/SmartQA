import type { CheckKind, CheckStatus, MetricSample, ViewportName } from '@smartqa/shared';
import { INVALID_TOKEN_PROSE_ALLOWLIST } from '@smartqa/shared';
import type { FindingDraft } from '../findings';
import type { PageSnapshot } from '../browser/domSnapshot';
import {
  classifyAdditivity,
  classifyMetricKind,
  evaluatePartitionSum,
  evaluateTableTotal,
  parseNumberText,
  toCalculationDetail,
  toMetricSample,
} from '../validate/metrics';
import type { CalculationDetail } from '@smartqa/shared';

/**
 * Deterministic analysis of one captured page snapshot.
 *
 * Every check here is evidence-based: it reports what the DOM actually shows,
 * and records a passing check as well as failures so coverage is honest.
 */

export interface SnapshotContext {
  runId: string;
  pageUrl: string;
  pageTitle: string;
  pageStateId: string;
  actionId?: string | null;
  viewport: ViewportName;
}

export interface CheckDraft {
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  detail: string;
  deterministic: boolean;
  calculation?: CalculationDetail | null;
}

export interface SnapshotAnalysis {
  metrics: MetricSample[];
  findings: FindingDraft[];
  checks: CheckDraft[];
}

export function analyzeSnapshot(snapshot: PageSnapshot, ctx: SnapshotContext): SnapshotAnalysis {
  const findings: FindingDraft[] = [];
  const checks: CheckDraft[] = [];
  const metrics: MetricSample[] = [];
  const base = {
    pageUrl: snapshot.url || ctx.pageUrl,
    pageTitle: snapshot.title || ctx.pageTitle,
    pageStateId: ctx.pageStateId,
    actionId: ctx.actionId ?? null,
  };

  // ------------------------------------------------------------------ metrics
  const seenMetric = new Set<string>();
  for (const raw of snapshot.metrics) {
    const sample = toMetricSample(raw, { pageUrl: base.pageUrl });
    if (!sample) continue;
    const key = `${sample.key}::${sample.value}::${sample.scope}`;
    if (seenMetric.has(key)) continue;
    seenMetric.add(key);
    metrics.push(sample);
  }

  // A visible list of related values (regional breakdown, category split…)
  // must add up to the headline total when both use the same additive unit.
  // Exhaustiveness cannot be proven from the DOM alone, so mismatches stay
  // suspected rather than being presented as confirmed bugs.
  const totalCandidates = metrics.filter(
    (metric) =>
      metric.value !== null &&
      metric.unit &&
      metric.scope !== 'table_row' &&
      /total|overall|grand/i.test(metric.label),
  );
  const groupedMetrics = new Map<string, MetricSample[]>();
  for (const metric of metrics) {
    if (!metric.groupKey || metric.value === null || !metric.unit) continue;
    if (totalCandidates.some((candidate) => candidate.key === metric.key)) continue;
    // Labelled averages/ratios are never summed. A grouped currency or count
    // with an ambiguous label can still be a partition; any mismatch remains
    // suspected because the DOM does not declare exhaustiveness.
    if (metric.additivity === 'non_additive') continue;
    const list = groupedMetrics.get(metric.groupKey) ?? [];
    list.push(metric);
    groupedMetrics.set(metric.groupKey, list);
  }

  let reportedGroupMismatch = false;
  for (const total of totalCandidates) {
    if (reportedGroupMismatch) break;
    for (const [groupKey, parts] of groupedMetrics) {
      if (parts.length < 2 || parts.some((part) => part.unit !== total.unit)) continue;
      if (new Set(parts.map((part) => part.key)).size !== parts.length) continue;
      const evaluation = evaluatePartitionSum({
        metricLabel: total.label,
        kind: total.kind,
        additivity: 'additive',
        unit: total.unit ?? null,
        baseline: total.value as number,
        parts: parts.map((part) => ({ label: part.label, value: part.value as number })),
        exhaustive: false,
      });
      if (evaluation.verdict === 'not_applicable') continue;
      const calculation = toCalculationDetail(evaluation, parts.length);
      checks.push({
        kind: 'filter_additivity',
        title: `Displayed breakdown adds up to ${total.label}`,
        status: evaluation.verdict === 'pass' ? 'passed' : 'warning',
        detail: evaluation.formula,
        deterministic: true,
        calculation,
      });
      if (evaluation.verdict !== 'pass') {
        reportedGroupMismatch = true;
        findings.push({
          ...base,
          category: 'calculation_error',
          severity: 'medium',
          confidence: 'suspected',
          title: `Displayed breakdown does not add up to ${total.label}`,
          description:
            `${evaluation.reason} The page displays ${evaluation.observed} across its grouped values but ${evaluation.expected} ` +
            'as the headline total. The grouping is inferred from page structure, so this is reported for review rather than as a confirmed bug.',
          observed: evaluation.formula,
          expected: `${total.label} equals the sum of the displayed breakdown`,
          selector: total.source,
          calculation,
          fingerprintKey: `breakdown:${groupKey}:${total.key}`,
          tags: ['calculation', 'breakdown'],
          suspectedReason: 'The page does not explicitly declare that the grouped values partition the headline total.',
          reproduceSteps: [
            `Open ${base.pageUrl}`,
            `Read the displayed ${total.label}.`,
            `Sum the values shown in the related breakdown list.`,
            'Compare the two numbers.',
          ],
        });
      }
    }
  }

  // ------------------------------------------------------------ broken images
  const brokenImages = snapshot.images.filter((image) => image.visible && image.broken);
  if (brokenImages.length > 0) {
    for (const image of brokenImages.slice(0, 3)) {
      findings.push({
        ...base,
        category: 'broken_image',
        severity: 'low',
        confidence: 'confirmed',
        title: `Broken image: ${shorten(image.src)}`,
        description: `The image element resolved but no bitmap was decoded (naturalWidth = 0). Source: ${image.src}`,
        observed: `naturalWidth=0 for ${image.src}`,
        expected: 'Image loads and renders a bitmap',
        fingerprintKey: image.src,
        tags: ['image', 'asset'],
      });
    }
    checks.push({
      kind: 'image_load',
      title: 'Images load successfully',
      status: 'failed',
      detail: `${brokenImages.length} broken image(s): ${brokenImages.map((image) => shorten(image.src)).join(', ')}`,
      deterministic: true,
    });
  } else if (snapshot.images.some((image) => image.visible)) {
    checks.push({
      kind: 'image_load',
      title: 'Images load successfully',
      status: 'passed',
      detail: `${snapshot.images.filter((image) => image.visible).length} visible image(s) rendered.`,
      deterministic: true,
    });
  }

  // ------------------------------------------------------------- invalid text
  const blockingModalOpen = Boolean(snapshot.modal);
  for (const sentinel of snapshot.sentinels.slice(0, 6)) {
    if (INVALID_TOKEN_PROSE_ALLOWLIST.some((pattern) => pattern.test(sentinel.context))) continue;
    const wordCount = sentinel.text.split(/\s+/).filter(Boolean).length;
    // "undefined" inside a sentence ("undefined behaviour") is prose, not a bug.
    if (!sentinel.isolated && wordCount > 3) continue;
    // Values such as NaN/undefined can be expected placeholders while a required
    // selection dialog is open (e.g. supplier group must be chosen before data
    // loads). Do not report them as defects in that precondition state.
    if (blockingModalOpen) continue;
    const severeToken = ['nan', 'infinity', '-infinity'].includes(sentinel.token);
    findings.push({
      ...base,
      category: 'invalid_value',
      severity: severeToken ? 'high' : 'medium',
      confidence: sentinel.isolated ? 'confirmed' : 'probable',
      title: `Invalid value "${sentinel.token}" displayed`,
      description:
        `The page renders the literal token "${sentinel.token}"` +
        (sentinel.isolated ? ' as a standalone value' : ' inside a numeric-looking value') +
        `. Context: "${sentinel.context}".`,
      observed: sentinel.text,
      expected: 'A valid number or an explicit empty state',
      selector: sentinel.selector,
      fingerprintKey: `${sentinel.token}@${sentinel.selector}`,
      tags: ['data-quality', 'rendering'],
      suspectedReason: sentinel.isolated
        ? null
        : 'Token appears within surrounding text; could be intentional.',
    });
  }
  checks.push({
    kind: 'invalid_value',
    title: 'No invalid numeric tokens rendered',
    status: blockingModalOpen
      ? snapshot.sentinels.some((sentinel) => sentinel.isolated)
        ? 'warning'
        : 'passed'
      : snapshot.sentinels.some((sentinel) => sentinel.isolated)
        ? 'failed'
        : 'passed',
    detail:
      snapshot.sentinels.length === 0
        ? 'No NaN/undefined/null/Infinity tokens found in visible text.'
        : `${snapshot.sentinels.length} token occurrence(s) found, ${snapshot.sentinels.filter((s) => s.isolated).length} standalone.` +
          (blockingModalOpen
            ? ' An open dialog requires input before values populate; placeholders are not reported as defects.'
            : ''),
    deterministic: true,
  });

  // ---------------------------------------------------------- layout overflow
  const overflowAmount = snapshot.overflow.scrollWidth - snapshot.overflow.clientWidth;
  const hasOverflow = overflowAmount > 8 && snapshot.overflow.offenders.length > 0;
  if (hasOverflow) {
    const offenders = snapshot.overflow.offenders
      .slice(0, 4)
      .map((item) => `${item.tag} "${item.text}" (right=${item.right}px, width=${item.width}px)`)
      .join('; ');
    findings.push({
      ...base,
      category: ctx.viewport === 'mobile' ? 'responsive_breakage' : 'layout_overflow',
      severity: ctx.viewport === 'mobile' ? 'medium' : 'low',
      confidence: 'confirmed',
      title: `Horizontal overflow at ${ctx.viewport} width`,
      description: `The document scrolls ${overflowAmount}px wider than the viewport. Offending elements: ${offenders}`,
      observed: `scrollWidth=${snapshot.overflow.scrollWidth} vs clientWidth=${snapshot.overflow.clientWidth}`,
      expected: 'Content fits within the viewport without horizontal scrolling',
      fingerprintKey: `overflow:${ctx.viewport}`,
      tags: ['layout', ctx.viewport],
    });
    checks.push({
      kind: 'layout_overflow',
      title: 'No horizontal overflow',
      status: 'failed',
      detail: `Overflow of ${overflowAmount}px (${offenders})`,
      deterministic: true,
    });
  } else {
    checks.push({
      kind: 'layout_overflow',
      title: 'No horizontal overflow',
      status: 'passed',
      detail: `Document width ${snapshot.overflow.scrollWidth}px fits viewport ${snapshot.overflow.clientWidth}px.`,
      deterministic: true,
    });
  }

  // --------------------------------------------------------------- overlapping
  if (snapshot.overlaps.length > 0) {
    const largest = snapshot.overlaps[0];
    findings.push({
      ...base,
      category: 'element_overlap',
      severity: 'low',
      confidence: 'probable',
      title: `Interactive elements overlap: "${largest.a.label}" / "${largest.b.label}"`,
      description: `Two interactive elements intersect by ${Math.round(largest.ratio * 100)}% of the smaller element, which can make one unclickable.`,
      observed: `${largest.a.selector} overlaps ${largest.b.selector} (${Math.round(largest.ratio * 100)}%)`,
      expected: 'Interactive elements occupy distinct hit areas',
      selector: largest.a.selector,
      fingerprintKey: `overlap:${largest.a.selector}:${largest.b.selector}`,
      tags: ['layout', 'hit-area'],
    });
    checks.push({
      kind: 'element_overlap',
      title: 'Interactive elements do not overlap',
      status: 'warning',
      detail: `${snapshot.overlaps.length} overlapping pair(s); largest ${Math.round(largest.ratio * 100)}%.`,
      deterministic: true,
    });
  } else {
    checks.push({
      kind: 'element_overlap',
      title: 'Interactive elements do not overlap',
      status: 'passed',
      detail: 'No significant intersection between visible interactive elements.',
      deterministic: true,
    });
  }

  // ---------------------------------------------------------------- content
  const mainTextLength = snapshot.mainText.trim().length;
  const spinnerVisible = snapshot.spinners.some((spinner) => spinner.visible);
  if (mainTextLength < 15 && !snapshot.emptyStateText) {
    if (!spinnerVisible) {
      findings.push({
        ...base,
        category: 'missing_content',
        severity: 'medium',
        confidence: 'probable',
        title: 'Page rendered with almost no content',
        description: `The main region contains only ${mainTextLength} characters and no empty-state message.`,
        observed: `${mainTextLength} characters of visible main content`,
        expected: 'Rendered content or an explicit empty state',
        fingerprintKey: `blank:${base.pageUrl}`,
        tags: ['content', 'rendering'],
      });
    }
    checks.push({
      kind: 'content_present',
      title: 'Page has visible content',
      status: spinnerVisible ? 'warning' : 'failed',
      detail: spinnerVisible ? 'Content is empty while a loading indicator is visible.' : 'Main content is effectively empty.',
      deterministic: true,
    });
  } else {
    checks.push({
      kind: 'content_present',
      title: 'Page has visible content',
      status: 'passed',
      detail: snapshot.emptyStateText
        ? `Explicit empty state rendered: "${snapshot.emptyStateText}"`
        : `${mainTextLength} characters of visible content.`,
      deterministic: true,
    });
  }

  // ------------------------------------------------------------ table totals
  for (const table of snapshot.tables) {
    if (table.rows.length < 2 || table.footer.length === 0) continue;
    for (let column = 0; column < table.footer.length; column += 1) {
      const footerParsed = parseNumberText(table.footer[column] ?? '');
      if (!footerParsed) continue;
      const rowValues: number[] = [];
      for (const row of table.rows) {
        const parsed = parseNumberText(row[column] ?? '');
        if (parsed) rowValues.push(parsed.value);
      }
      if (rowValues.length < 2) continue;
      if (rowValues.filter((value) => value < 0).length > 0) continue;
      const headerLabel = table.headers[column] || `column ${column + 1}`;
      if (/\b(id|order|phone|code|date|year)\b/i.test(headerLabel)) continue;
      const kind = classifyMetricKind(headerLabel, footerParsed.unit, footerParsed.value);
      const additivity = classifyAdditivity(headerLabel, kind, footerParsed.unit).additivity;
      if (additivity !== 'additive') continue;
      const evaluation = evaluateTableTotal({
        columnLabel: headerLabel,
        kind,
        additivity,
        unit: footerParsed.unit,
        footerValue: footerParsed.value,
        rowValues,
      });
      if (evaluation.verdict === 'pass') {
        checks.push({
          kind: 'table_totals',
          title: `Table "${headerLabel}" total matches visible rows`,
          status: 'passed',
          detail: evaluation.formula,
          deterministic: true,
          calculation: toCalculationDetail(evaluation, rowValues.length),
        });
      } else if (evaluation.verdict === 'fail') {
        const calculation = toCalculationDetail(evaluation, rowValues.length);
        findings.push({
          ...base,
          category: 'calculation_error',
          severity: 'medium',
          confidence: 'confirmed',
          title: `Table footer total for "${headerLabel}" does not equal the sum of its rows`,
          description: `${evaluation.formula}. ${evaluation.reason}`,
          observed: `${evaluation.observed}`,
          expected: `${evaluation.expected}`,
          calculation,
          fingerprintKey: `table:${headerLabel}`,
          tags: ['calculation', 'table'],
        });
        checks.push({
          kind: 'table_totals',
          title: `Table "${headerLabel}" total matches visible rows`,
          status: 'failed',
          detail: evaluation.reason,
          deterministic: true,
          calculation,
        });
      }
    }
  }

  // --------------------------------------------------------------- pagination
  const paginated = snapshot.tables.find((table) => (table.totalPages ?? 0) > 1);
  if (paginated) {
    checks.push({
      kind: 'pagination',
      title: 'Paginated table detected',
      status: 'passed',
      detail: `Page ${paginated.page ?? '?'} of ${paginated.totalPages}; pagination controls present.`,
      deterministic: true,
    });
  }

  return { metrics, findings, checks };
}

function shorten(url: string, max = 80): string {
  if (url.length <= max) return url;
  return `${url.slice(0, max - 1)}…`;
}
