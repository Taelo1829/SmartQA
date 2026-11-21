import { nowIso, shortId, type CheckCounts, type CheckKind, type CheckResult, type CheckStatus, type CalculationDetail } from '@smartqa/shared';
import type { Store } from '@smartqa/db';
import type { CheckDraft } from './detect/analyzeSnapshot';

/**
 * Persisted check results.
 *
 * Checks are the positive evidence of testing: a report that lists only bugs
 * cannot demonstrate coverage. Identical checks on revisit are deduplicated so
 * repeated navigation does not inflate the numbers.
 */
export class CheckService {
  private readonly seen = new Set<string>();
  private readonly counts: CheckCounts = { passed: 0, failed: 0, warning: 0, skipped: 0 };

  constructor(
    private readonly store: Store,
    private readonly runId: string,
    private readonly onCheck: (check: CheckResult) => void | Promise<void>,
  ) {}

  snapshotCounts(): CheckCounts {
    return { ...this.counts };
  }

  get total(): number {
    return this.counts.passed + this.counts.failed + this.counts.warning + this.counts.skipped;
  }

  async record(input: {
    kind: CheckKind;
    title: string;
    status: CheckStatus;
    detail: string;
    pageUrl: string;
    actionId?: string | null;
    pageStateId?: string | null;
    combinationId?: string | null;
    deterministic?: boolean;
    calculation?: CalculationDetail | null;
    durationMs?: number | null;
    evidenceIds?: string[];
  }): Promise<CheckResult | null> {
    const dedupeKey = `${input.kind}|${input.status}|${input.title}|${input.pageUrl}|${input.detail.slice(0, 120)}`;
    if (this.seen.has(dedupeKey)) return null;
    this.seen.add(dedupeKey);

    const check: CheckResult = {
      id: shortId('chk'),
      runId: this.runId,
      kind: input.kind,
      title: input.title,
      status: input.status,
      detail: input.detail.slice(0, 1_500),
      pageUrl: input.pageUrl,
      actionId: input.actionId ?? null,
      pageStateId: input.pageStateId ?? null,
      combinationId: input.combinationId ?? null,
      evidenceIds: input.evidenceIds ?? [],
      deterministic: input.deterministic ?? true,
      calculation: input.calculation ?? null,
      createdAt: nowIso(),
      durationMs: input.durationMs ?? null,
    };
    await this.store.checks.create(check);
    this.counts[input.status] += 1;
    await this.onCheck(check);
    return check;
  }

  async recordDrafts(drafts: CheckDraft[], context: { pageUrl: string; actionId?: string | null; pageStateId?: string | null }): Promise<void> {
    for (const draft of drafts) {
      await this.record({ ...draft, ...context });
    }
  }
}
