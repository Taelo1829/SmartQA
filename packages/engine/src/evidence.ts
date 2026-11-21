import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import type { Page } from 'playwright';
import type { ObjectStore, Store } from '@smartqa/db';
import {
  nowIso,
  shortId,
  type Evidence,
  type EvidenceKind,
  type EvidenceRef,
  type Finding,
} from '@smartqa/shared';

/**
 * Evidence capture.
 *
 * Screenshots/traces/DOM dumps are written to the object store and referenced
 * from the database by storage key + checksum. Binary content is never exposed
 * without an authenticated API request.
 */
export class EvidenceService {
  private captured = 0;

  constructor(
    private readonly store: Store,
    private readonly objects: ObjectStore,
    private readonly maxEvidencePerRun = 160,
  ) {}

  get count(): number {
    return this.captured;
  }

  private async persist(input: {
    runId: string;
    kind: EvidenceKind;
    label: string;
    data: Buffer | string;
    contentType: string;
    metadata?: Record<string, unknown>;
  }): Promise<Evidence> {
    const id = shortId('evd');
    const extension =
      input.kind === 'screenshot' || input.kind === 'full_page_screenshot'
        ? 'png'
        : input.kind === 'trace'
          ? 'zip'
          : input.kind === 'page_html'
            ? 'html'
            : input.kind === 'console_log' || input.kind === 'network_log'
              ? 'txt'
              : 'json';
    const storageKey = `${input.runId}/${input.kind}/${id}.${extension}`;
    const stored = await this.objects.put(storageKey, input.data, input.contentType);
    this.captured += 1;
    return this.store.evidence.create({
      id,
      runId: input.runId,
      findingId: null,
      kind: input.kind,
      label: input.label.slice(0, 160),
      contentType: stored.contentType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      storageKey,
      createdAt: nowIso(),
      metadata: input.metadata ?? {},
    });
  }

  private get budgetLeft(): boolean {
    return this.captured < this.maxEvidencePerRun;
  }

  async screenshot(
    runId: string,
    page: Page,
    label: string,
    options: { fullPage?: boolean } = {},
  ): Promise<Evidence | null> {
    if (!this.budgetLeft || page.isClosed()) return null;
    try {
      const data = await page.screenshot({
        fullPage: options.fullPage ?? false,
        type: 'png',
        timeout: 15_000,
        animations: 'disabled',
      });
      return await this.persist({
        runId,
        kind: options.fullPage ? 'full_page_screenshot' : 'screenshot',
        label,
        data,
        contentType: 'image/png',
        metadata: { url: page.url() },
      });
    } catch {
      return null;
    }
  }

  async json(runId: string, label: string, value: unknown): Promise<Evidence | null> {
    if (!this.budgetLeft) return null;
    try {
      return await this.persist({
        runId,
        kind: 'metrics_json',
        label,
        data: JSON.stringify(value, null, 2),
        contentType: 'application/json',
      });
    } catch {
      return null;
    }
  }

  async text(
    runId: string,
    kind: Extract<EvidenceKind, 'console_log' | 'network_log' | 'dom_snapshot'>,
    label: string,
    value: string,
  ): Promise<Evidence | null> {
    if (!this.budgetLeft) return null;
    try {
      return await this.persist({
        runId,
        kind,
        label,
        data: value,
        contentType: kind === 'dom_snapshot' ? 'text/html' : 'text/plain',
      });
    } catch {
      return null;
    }
  }

  async storeFile(input: {
    runId: string;
    filePath: string;
    kind: EvidenceKind;
    label: string;
    contentType: string;
    cleanup?: boolean;
  }): Promise<Evidence | null> {
    try {
      const data = await readFile(input.filePath);
      const evidence = await this.persist({
        runId: input.runId,
        kind: input.kind,
        label: input.label,
        data,
        contentType: input.contentType,
      });
      if (input.cleanup) await unlink(input.filePath).catch(() => undefined);
      return evidence;
    } catch {
      return null;
    }
  }

  toRef(evidence: Evidence): EvidenceRef {
    return { id: evidence.id, kind: evidence.kind, label: evidence.label, contentType: evidence.contentType };
  }

  async attach(finding: Finding, evidence: Array<Evidence | null>): Promise<Finding> {
    const refs = evidence.filter((item): item is Evidence => Boolean(item)).map((item) => this.toRef(item));
    if (refs.length === 0) return finding;
    const merged = [...finding.evidence];
    for (const ref of refs) if (!merged.some((existing) => existing.id === ref.id)) merged.push(ref);
    for (const item of evidence) {
      if (item) await this.store.evidence.update(item.id, { findingId: finding.id });
    }
    return this.store.findings.update(finding.id, { evidence: merged });
  }

  static fingerprint(parts: string[]): string {
    return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
  }
}
