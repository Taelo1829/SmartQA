import path from 'node:path';
import {
  nowIso,
  type Evidence,
  type Finding,
  type RecordedStep,
  type TestRun,
  type ViewportName,
} from '@smartqa/shared';
import type { Store } from '@smartqa/db';
import type { BrowserSession } from '../browser/session';
import { collectPageSnapshot, type PageSnapshot } from '../browser/domSnapshot';
import { waitForDomQuiet } from '../browser/readiness';
import type { EvidenceService } from '../evidence';
import { metricsFromSnapshot } from '../validate/filters';

/**
 * Automated bug reproduction.
 *
 * A finding is replayed from a fresh browser context using the recorded action
 * path. Repeating it separates "the app is broken" from "I could not make it
 * happen again", which is a meaningful part of a QA report.
 */

export interface ReproSessionOptions {
  viewport: ViewportName;
  traceDir?: string;
  storageState?: unknown;
}

export interface ReproducerDeps {
  store: Store;
  run: TestRun;
  evidence: EvidenceService;
  tracesDir: string;
  createSession: (options: ReproSessionOptions) => Promise<BrowserSession>;
  getStorageState: () => Promise<unknown>;
  log: (level: 'info' | 'warn' | 'debug', message: string) => Promise<void>;
}

export interface ReproductionResult {
  findingId: string;
  status: 'reproducible' | 'intermittent' | 'not_reproduced' | 'skipped';
  attempts: number;
  successes: number;
  notes: string;
  evidence: Evidence[];
}

export class Reproducer {
  constructor(private readonly deps: ReproducerDeps) {}

  async reproduce(finding: Finding): Promise<ReproductionResult> {
    const attemptsWanted = Math.min(this.deps.run.config.reproductionAttempts, 3);
    if (attemptsWanted <= 0) {
      return this.skip(finding, 'Reproduction attempts were disabled for this run.');
    }

    const steps = finding.reproduction.recordedSteps.length
      ? finding.reproduction.recordedSteps
      : await this.buildSteps(finding);
    if (steps.length === 0) {
      return this.skip(finding, 'No recorded action path was available to replay.');
    }

    let successes = 0;
    let attempts = 0;
    const evidence: Evidence[] = [];
    const notes: string[] = [];

    for (let attempt = 0; attempt < attemptsWanted; attempt += 1) {
      attempts += 1;
      let session: BrowserSession | null = null;
      const tracePath = path.join(this.deps.tracesDir, `repro-${finding.id}-${attempt + 1}.zip`);
      try {
        const storageState = await this.deps.getStorageState().catch(() => undefined);
        session = await this.deps.createSession({
          viewport: this.deps.run.config.viewports[0] ?? 'desktop',
          traceDir: this.deps.run.config.recordTrace ? tracePath : undefined,
          storageState,
        });
        await session.navigate(this.deps.run.url);
        await this.replay(session, steps);
        const snapshot = (await session.page.evaluate(collectPageSnapshot as never)) as PageSnapshot;
        const matched = this.matchesFinding(session, finding, snapshot);

        if (matched) {
          successes += 1;
          if (this.deps.run.config.captureScreenshots) {
            const shot = await this.deps.evidence.screenshot(
              this.deps.run.id,
              session.page,
              `Reproduction attempt ${attempt + 1}: ${finding.title}`,
              { fullPage: true },
            );
            if (shot) evidence.push(shot);
          }
          notes.push(`Attempt ${attempt + 1}: reproduced.`);
        } else {
          notes.push(`Attempt ${attempt + 1}: signal not observed.`);
        }

        if (this.deps.run.config.recordTrace) {
          const traceFile = await session.stopTracing(tracePath).catch(() => null);
          if (traceFile) {
            const stored = await this.deps.evidence.storeFile({
              runId: this.deps.run.id,
              filePath: traceFile,
              kind: 'trace',
              label: `Playwright trace - reproduction ${attempt + 1}`,
              contentType: 'application/zip',
              cleanup: true,
            });
            if (stored) evidence.push(stored);
          }
        }
      } catch (error) {
        notes.push(`Attempt ${attempt + 1}: replay failed (${(error as Error).message.split('\n')[0]}).`);
      } finally {
        await session?.close().catch(() => undefined);
      }
    }

    const status: ReproductionResult['status'] =
      successes === attempts ? 'reproducible' : successes > 0 ? 'intermittent' : 'not_reproduced';
    const findingStatus: Finding['status'] =
      status === 'reproducible' ? 'reproducible' : status === 'intermittent' ? 'intermittent' : 'not_reproduced';
    const confidence: Finding['confidence'] =
      status === 'reproducible' ? 'confirmed' : status === 'intermittent' ? 'probable' : 'suspected';

    const evidenceRefs = evidence.map((item) => this.deps.evidence.toRef(item));
    const updated = await this.deps.store.findings.update(finding.id, {
      status: status === 'not_reproduced' && finding.confidence === 'suspected' ? 'suspected' : findingStatus,
      confidence,
      reproduction: {
        ...finding.reproduction,
        attempts,
        successes,
        steps: steps.map((step) => step.description),
        recordedSteps: steps,
        notes: notes.join(' '),
        lastAttemptAt: nowIso(),
        reproducedBy: 'fresh-context replay',
      },
      evidence: [
        ...finding.evidence,
        ...evidenceRefs.filter((ref) => !finding.evidence.some((existing) => existing.id === ref.id)),
      ],
    });
    for (const item of evidence) await this.deps.store.evidence.update(item.id, { findingId: updated.id });

    await this.deps.log(
      'info',
      `Reproduction ${status} for "${finding.title}" (${successes}/${attempts} attempts)`,
    );
    return { findingId: finding.id, status, attempts, successes, notes: notes.join(' '), evidence };
  }

  private skip(finding: Finding, reason: string): ReproductionResult {
    return { findingId: finding.id, status: 'skipped', attempts: 0, successes: 0, notes: reason, evidence: [] };
  }

  private async buildSteps(finding: Finding): Promise<RecordedStep[]> {
    const steps: RecordedStep[] = [];
    if (!finding.actionId) {
      return [
        {
          index: 0,
          kind: 'navigate',
          description: `Open ${finding.pageUrl}`,
          url: finding.pageUrl,
          selector: null,
          value: null,
        },
      ];
    }
    let actionId: string | null = finding.actionId;
    const guard = new Set<string>();
    while (actionId && !guard.has(actionId) && steps.length < 30) {
      guard.add(actionId);
      const action = await this.deps.store.actions.get(actionId);
      if (!action) break;
      steps.unshift({
        index: 0,
        kind: action.kind,
        description: action.description,
        url: action.urlBefore,
        selector: action.element?.selector ?? null,
        value: action.value ?? null,
      });
      const state = action.pageStateId ? await this.deps.store.pages.get(action.pageStateId) : null;
      actionId = state?.viaActionId ?? null;
    }
    steps.forEach((step, index) => {
      step.index = index;
    });
    return steps;
  }

  private async replay(session: BrowserSession, steps: RecordedStep[]): Promise<void> {
    for (const step of steps) {
      if (!step.selector) continue;
      try {
        const locator = session.page.locator(step.selector).first();
        if ((await locator.count()) === 0) continue;
        if (step.kind === 'fill') {
          await locator.fill(step.value ?? 'test', { timeout: 6_000 });
          await locator.press('Enter').catch(() => undefined);
        } else if (step.kind === 'select') {
          await locator.selectOption({ index: 1 }, { timeout: 6_000 }).catch(() => undefined);
        } else {
          await locator.click({ timeout: 6_000 });
        }
        await session.page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
        await waitForDomQuiet(session.page, 200, 1_500);
      } catch {
        // A step that no longer resolves shows up as a failed reproduction.
      }
    }
  }

  private matchesFinding(session: BrowserSession, finding: Finding, snapshot: PageSnapshot): boolean {
    const signals = session.signals.all();
    const observed = finding.observed.toLowerCase().trim();

    if (finding.category === 'console_error' || finding.category === 'unhandled_rejection') {
      return signals.console.some((signal) => {
        if (signal.type !== 'error') return false;
        const text = signal.text.toLowerCase();
        return text.includes(observed.slice(0, 40)) || observed.includes(text.slice(0, 40));
      });
    }
    if (finding.category === 'runtime_exception') {
      return signals.pageErrors.some((error) => {
        const message = error.message.toLowerCase();
        return message.includes(observed.slice(0, 40)) || observed.includes(message.slice(0, 40));
      });
    }
    if (finding.category === 'http_error') {
      return signals.http.some((http) => observed.includes(String(http.status)));
    }
    if (finding.category === 'network_failure') {
      return signals.failures.some((failure) => observed.includes(failure.reason.toLowerCase()));
    }
    if (finding.category === 'broken_image') {
      return snapshot.images.some((image) => image.broken);
    }
    if (finding.category === 'invalid_value') {
      const token = finding.observed.match(/\b(nan|undefined|null|infinity|-infinity)\b/i)?.[1]?.toLowerCase() ?? '';
      return Boolean(token) && snapshot.sentinels.some((sentinel) => sentinel.token === token);
    }
    if (finding.category === 'layout_overflow' || finding.category === 'responsive_breakage') {
      return snapshot.overflow.scrollWidth > snapshot.overflow.clientWidth + 8;
    }
    if (finding.category === 'element_overlap') {
      return snapshot.overlaps.length > 0;
    }
    if (finding.category === 'infinite_loading') {
      return snapshot.spinners.some((spinner) => spinner.visible);
    }
    if (finding.category === 'missing_content') {
      return snapshot.mainText.trim().length < 15;
    }
    if (finding.category === 'calculation_error' || finding.category === 'filter_inconsistency') {
      const target = finding.calculation?.observed ?? finding.calculation?.expected ?? null;
      if (target === null) return snapshot.metrics.length > 0;
      return metricsFromSnapshot(snapshot).some(
        (metric) => metric.value !== null && Math.abs(metric.value - target) < 0.5,
      );
    }
    return snapshot.sentinels.length > 0;
  }
}
