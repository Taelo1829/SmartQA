import {
  CATEGORY_LABELS,
  nowIso,
  shortId,
  type CalculationDetail,
  type Confidence,
  type EvidenceRef,
  type Finding,
  type FindingCategory,
  type FindingStatus,
  type RecordedStep,
  type Severity,
} from '@smartqa/shared';
import type { Store } from '@smartqa/db';
import { EvidenceService } from './evidence';

/**
 * Finding creation, deduplication and severity assignment.
 *
 * Dedupe is fingerprint-based so a console error that fires on every page is
 * one finding with an occurrence count, not two hundred findings.
 */

export interface FindingDraft {
  category: FindingCategory;
  title: string;
  description: string;
  observed: string;
  expected?: string | null;
  severity?: Severity;
  confidence?: Confidence;
  status?: FindingStatus;
  pageUrl: string;
  pageTitle?: string | null;
  pageStateId?: string | null;
  actionId?: string | null;
  elementLabel?: string | null;
  selector?: string | null;
  calculation?: CalculationDetail | null;
  evidence?: EvidenceRef[];
  tags?: string[];
  suspectedReason?: string | null;
  steps?: RecordedStep[];
  /** Extra fingerprint input, e.g. the failing URL or the metric key. */
  fingerprintKey?: string;
  reproduceSteps?: string[];
}

/** Baseline severity by category; specific detectors may escalate. */
const BASE_SEVERITY: Record<FindingCategory, Severity> = {
  console_error: 'high',
  unhandled_rejection: 'high',
  network_failure: 'medium',
  http_error: 'medium',
  broken_image: 'low',
  missing_content: 'medium',
  infinite_loading: 'high',
  nonfunctional_control: 'medium',
  broken_navigation: 'high',
  broken_pagination: 'medium',
  filter_inconsistency: 'high',
  calculation_error: 'high',
  invalid_value: 'high',
  layout_overflow: 'low',
  element_overlap: 'low',
  responsive_breakage: 'medium',
  runtime_exception: 'critical',
  accessibility: 'low',
};

export function inferSeverity(category: FindingCategory, hint?: Severity): Severity {
  return hint ?? BASE_SEVERITY[category] ?? 'medium';
}

export class FindingService {
  private readonly known = new Map<string, string>();
  private count = 0;

  constructor(
    private readonly store: Store,
    private readonly runId: string,
    private readonly evidence: EvidenceService,
    private readonly onFinding: (finding: Finding) => void | Promise<void>,
  ) {}

  get total(): number {
    return this.count;
  }

  private fingerprintOf(draft: FindingDraft, pagePath: string): string {
    return EvidenceService.fingerprint([
      draft.category,
      draft.title.toLowerCase().replace(/\s+/g, ' ').trim(),
      pagePath,
      draft.fingerprintKey ?? draft.elementLabel ?? draft.selector ?? '',
    ]);
  }

  async record(draft: FindingDraft): Promise<Finding | null> {
    const pagePath = safePath(draft.pageUrl);
    const fingerprint = this.fingerprintOf(draft, pagePath);
    const existingId = this.known.get(fingerprint);
    if (existingId) {
      const existing = await this.store.findings.get(existingId);
      if (existing) {
        const updated = await this.store.findings.update(existingId, {
          lastSeenAt: nowIso(),
          occurrenceCount: existing.occurrenceCount + 1,
          observed: draft.observed,
        });
        await this.onFinding(updated);
        return null;
      }
    }

    const severity = inferSeverity(draft.category, draft.severity);
    const confidence = draft.confidence ?? 'probable';
    const finding: Finding = {
      id: shortId('fnd'),
      runId: this.runId,
      category: draft.category,
      severity,
      confidence,
      status: draft.status ?? (confidence === 'suspected' ? 'suspected' : 'open'),
      title: draft.title,
      description: draft.description,
      expected: draft.expected ?? null,
      observed: draft.observed,
      pageUrl: draft.pageUrl,
      pageTitle: draft.pageTitle ?? null,
      pageStateId: draft.pageStateId ?? null,
      actionId: draft.actionId ?? null,
      elementLabel: draft.elementLabel ?? null,
      selector: draft.selector ?? null,
      calculation: draft.calculation ?? null,
      reproduction: {
        attempts: 0,
        successes: 0,
        steps: draft.reproduceSteps ?? draft.steps?.map((step) => step.description) ?? [],
        recordedSteps: draft.steps ?? [],
        notes: '',
        lastAttemptAt: null,
      },
      evidence: draft.evidence ?? [],
      fingerprint,
      tags: draft.tags ?? [CATEGORY_LABELS[draft.category]],
      suspectedReason: draft.suspectedReason ?? null,
      occurrenceCount: 1,
      firstSeenAt: nowIso(),
      lastSeenAt: nowIso(),
    };

    await this.store.findings.create(finding);
    this.known.set(fingerprint, finding.id);
    this.count += 1;
    await this.onFinding(finding);
    return finding;
  }

  /** Attach a screenshot/DOM dump to an existing finding. */
  async addEvidence(finding: Finding, items: Parameters<EvidenceService['attach']>[1]): Promise<Finding> {
    return this.evidence.attach(finding, items);
  }

  async list(): Promise<Finding[]> {
    return this.store.findings.find({
      where: { runId: this.runId },
      orderBy: { field: 'firstSeenAt', direction: 'asc' },
      limit: 1_000,
    });
  }
}

function safePath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/\d+/g, '/:id').replace(/\/+$/, '') || '/';
  } catch {
    return url;
  }
}
