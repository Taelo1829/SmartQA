import type { Page } from 'playwright';

/**
 * Readiness helpers.
 *
 * The engine never sleeps for a fixed "magic" duration when a real signal is
 * available: it waits for load state, network quiescence and DOM quiescence,
 * each with a bounded timeout so a hanging page cannot stall a run.
 */

export interface ReadyOptions {
  timeoutMs?: number;
  quietMs?: number;
  requireText?: boolean;
}

export async function waitForDomQuiet(page: Page, quietMs = 350, timeoutMs = 4_000): Promise<boolean> {
  try {
    return await page.evaluate(
      async ({ quietMs: quiet, timeoutMs: timeout }) => {
        return await new Promise<boolean>((resolve) => {
          let done = false;
          const finish = (value: boolean) => {
            if (done) return;
            done = true;
            observer.disconnect();
            clearTimeout(timer);
            resolve(value);
          };
          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => finish(true), quiet);
          });
          let timer = setTimeout(() => finish(true), quiet);
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });
          setTimeout(() => finish(false), timeout);
        });
      },
      { quietMs, timeoutMs },
    );
  } catch {
    return false;
  }
}

/**
 * Wait until the page is usable: DOM content loaded, network reasonably idle,
 * and the DOM has stopped mutating. Returns the readiness notes for logging.
 */
export async function waitForPageReady(page: Page, options: ReadyOptions = {}): Promise<string[]> {
  const notes: string[] = [];
  const timeout = options.timeoutMs ?? 20_000;

  await page
    .waitForLoadState('domcontentloaded', { timeout: Math.min(timeout, 15_000) })
    .then(() => notes.push('domcontentloaded'))
    .catch(() => notes.push('domcontentloaded:timeout'));

  const idle = await Promise.race([
    page
      .waitForLoadState('networkidle', { timeout: Math.min(timeout, 8_000) })
      .then(() => true)
      .catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), Math.min(timeout, 8_000))),
  ]);
  notes.push(idle ? 'networkidle' : 'networkidle:timeout');

  const quiet = await waitForDomQuiet(page, options.quietMs ?? 300, 3_500);
  notes.push(quiet ? 'dom-quiet' : 'dom-quiet:timeout');

  if (options.requireText) {
    const hasText = await page.evaluate(() => (document.body?.innerText ?? '').trim().length > 0).catch(() => false);
    notes.push(hasText ? 'text-present' : 'text-missing');
  }
  return notes;
}

/**
 * Fast, stable fingerprint of the current DOM used to decide whether an action
 * had an observable effect. Hashing the whole `innerHTML` captures element,
 * text and attribute changes (including deep in the tree) without the cost of
 * a full snapshot. The caller must capture this BEFORE performing the action
 * and pass it to {@link waitForActionOutcome}; both sides then compare values
 * produced by the exact same function.
 */
export async function pageOutcomeSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const html = document.body?.innerHTML ?? '';
    let hash = 0x811c9dc5;
    for (let i = 0; i < html.length; i += 1) {
      hash ^= html.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return `${html.length}:${hash >>> 0}`;
  });
}

/** Wait for either a URL change or a meaningful DOM change after an action. */
export async function waitForActionOutcome(
  page: Page,
  previousUrl: string,
  previousSignature: string,
  opts: { timeoutMs?: number } = {},
): Promise<'navigated' | 'dom_changed' | 'no_change'> {
  const timeout = opts.timeoutMs ?? 4_000;
  const started = Date.now();
  let navigated = false;
  let changed = false;

  while (Date.now() - started < timeout) {
    if (page.isClosed()) break;
    try {
      if (page.url() !== previousUrl) {
        navigated = true;
        break;
      }
      if ((await pageOutcomeSignature(page)) !== previousSignature) {
        changed = true;
        break;
      }
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  if (navigated) {
    await waitForPageReady(page, { timeoutMs: 15_000 });
    return 'navigated';
  }
  return changed ? 'dom_changed' : 'no_change';
}
