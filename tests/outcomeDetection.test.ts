import { describe, expect, it } from 'vitest';
import {
  BrowserSession,
  RunUrlGuard,
  pageOutcomeSignature,
  waitForActionOutcome,
} from '@smartqa/engine';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('action outcome detection', () => {
  const artifactsDir = mkdtempSync(path.join(tmpdir(), 'smartqa-outcome-test-'));
  const guard = new RunUrlGuard('http://127.0.0.1:3100', { allowPrivateNetworks: true });

  it('reports no_change for an unwired control and dom_changed for a working one', async () => {
    const session = await BrowserSession.launch({
      runId: 'outcome-test-run',
      headless: true,
      viewport: 'desktop',
      urlGuard: guard,
      artifactsDir,
    });

    try {
      await session.page.setContent(`
        <!DOCTYPE html>
        <html><head><title>Outcome Test</title></head><body><main>
          <h1 id="heading">Ready</h1>
          <button id="noop" type="button">Export PDF</button>
          <button id="working" type="button" onclick="document.getElementById('heading').textContent = 'Updated'">Load</button>
        </main></body></html>
      `);

      // An unwired button: the baseline must match the polled signature so the
      // action is classified as no_change (which enables dead-control reporting).
      const url = session.page.url();
      const beforeNoop = await pageOutcomeSignature(session.page);
      const mark = session.signals.mark();
      await session.page.locator('#noop').click();
      const noopOutcome = await waitForActionOutcome(session.page, url, beforeNoop, { timeoutMs: 800 });
      expect(noopOutcome).toBe('no_change');
      // A dead control has no network side effects. `summarySince` must report a
      // mark-relative delta (zero here), not a cumulative count since page load.
      expect(session.signals.summarySince(mark).networkRequests).toBe(0);

      // A working button that mutates deep text: must be classified dom_changed.
      const beforeWorking = await pageOutcomeSignature(session.page);
      await session.page.locator('#working').click();
      const workingOutcome = await waitForActionOutcome(session.page, url, beforeWorking, { timeoutMs: 800 });
      expect(workingOutcome).toBe('dom_changed');
    } finally {
      await session.close();
    }
  });
});
