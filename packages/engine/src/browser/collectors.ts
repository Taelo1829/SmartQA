import type { Page } from 'playwright';
import type { LogLevel } from '@smartqa/shared';

/**
 * Browser signal collection.
 *
 * Everything the error-detection engine knows about console errors, uncaught
 * exceptions, HTTP failures and failed requests originates here, timestamped
 * so signals can be correlated with the action that triggered them.
 */

export interface ConsoleSignal {
  at: number;
  type: string;
  text: string;
  location: string;
}

export interface PageErrorSignal {
  at: number;
  message: string;
  stack: string;
  url: string;
}

export interface HttpErrorSignal {
  at: number;
  status: number;
  url: string;
  method: string;
  resourceType: string;
}

export interface RequestFailureSignal {
  at: number;
  url: string;
  method: string;
  reason: string;
  resourceType: string;
}

export interface DialogSignal {
  at: number;
  type: string;
  message: string;
}

export class SignalCollector {
  private consoleSignals: ConsoleSignal[] = [];
  private pageErrors: PageErrorSignal[] = [];
  private httpErrors: HttpErrorSignal[] = [];
  private requestFailures: RequestFailureSignal[] = [];
  private dialogs: DialogSignal[] = [];
  /** Timestamp of every completed/failed request, used for mark-relative counts. */
  private requestTimes: number[] = [];
  private attached = false;

  attach(page: Page): void {
    if (this.attached) throw new Error('SignalCollector can only be attached once');
    this.attached = true;

    page.on('console', (message) => {
      const type = message.type();
      if (type !== 'error' && type !== 'warning') return;
      const text = message.text();
      const location = message.location().url ?? '';
      this.consoleSignals.push({ at: Date.now(), type, text, location });
    });

    page.on('pageerror', (error) => {
      this.pageErrors.push({
        at: Date.now(),
        message: error.message,
        stack: (error.stack ?? '').split('\n').slice(0, 8).join('\n'),
        url: page.url(),
      });
    });

    page.on('response', (response) => {
      this.requestTimes.push(Date.now());
      const status = response.status();
      if (status < 400) return;
      const request = response.request();
      if (request.isNavigationRequest() && status >= 300 && status < 400) return;
      this.httpErrors.push({
        at: Date.now(),
        status,
        url: response.url(),
        method: request.method(),
        resourceType: request.resourceType(),
      });
    });

    page.on('requestfailed', (request) => {
      this.requestTimes.push(Date.now());
      const failure = request.failure();
      this.requestFailures.push({
        at: Date.now(),
        url: request.url(),
        method: request.method(),
        reason: failure?.errorText ?? 'unknown',
        resourceType: request.resourceType(),
      });
    });

    page.on('dialog', (dialog) => {
      this.dialogs.push({ at: Date.now(), type: dialog.type(), message: dialog.message() });
      // Never let a page trap the agent behind an alert: dismiss by default.
      dialog.dismiss().catch(() => undefined);
    });
  }

  mark(): number {
    return Date.now();
  }

  eventsSince(since: number): {
    console: ConsoleSignal[];
    pageErrors: PageErrorSignal[];
    http: HttpErrorSignal[];
    failures: RequestFailureSignal[];
    dialogs: DialogSignal[];
  } {
    return {
      console: this.consoleSignals.filter((signal) => signal.at >= since),
      pageErrors: this.pageErrors.filter((signal) => signal.at >= since),
      http: this.httpErrors.filter((signal) => signal.at >= since),
      failures: this.requestFailures.filter((signal) => signal.at >= since),
      dialogs: this.dialogs.filter((signal) => signal.at >= since),
    };
  }

  all(): {
    console: ConsoleSignal[];
    pageErrors: PageErrorSignal[];
    http: HttpErrorSignal[];
    failures: RequestFailureSignal[];
    dialogs: DialogSignal[];
  } {
    return this.eventsSince(0);
  }

  summarySince(since: number): {
    consoleErrors: number;
    pageErrors: number;
    failedRequests: number;
    httpErrors: number;
    networkRequests: number;
  } {
    const events = this.eventsSince(since);
    return {
      consoleErrors: events.console.filter((signal) => signal.type === 'error').length,
      pageErrors: events.pageErrors.length,
      failedRequests: events.failures.length,
      httpErrors: events.http.length,
      networkRequests: this.requestTimes.filter((time) => time >= since).length,
    };
  }

  clear(): void {
    this.consoleSignals = [];
    this.pageErrors = [];
    this.httpErrors = [];
    this.requestFailures = [];
    this.dialogs = [];
    this.requestTimes = [];
  }
}

/**
 * Init script installed in every context.
 *
 *  - Flags unhandled promise rejections on the console with a marker the
 *    collector can recognise (Playwright surfaces them as console errors on
 *    some Chromium versions but not all).
 *  - Records a stable build marker used by tests.
 *  - Provides a no-op `__name` helper. ESBuild (tsx / Next.js server bundle)
 *    rewrites named inner functions to `__name(fn, name)` calls; those calls are
 *    serialised into the page by Playwright, so the helper must exist there too.
 *    A site that defines its own helper is never overwritten.
 */
export const INIT_SCRIPT = `
(() => {
  if (typeof globalThis.__name !== 'function') globalThis.__name = (fn) => fn;
  if (window.__smartqaInstalled) return;
  window.__smartqaInstalled = true;
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event && event.reason;
    const message = reason && reason.message ? reason.message : String(reason);
    console.error('[smartqa:unhandledrejection] ' + message);
  });
  window.__smartqaReadyState = true;
})();
`;

/** Console noise that is not a product defect. */
export function isIgnorableConsoleError(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('favicon.ico') ||
    lower.includes('failed to load resource') ||
    lower.includes('net::err_blocked_by_client') ||
    lower.includes('download the react devtools') ||
    lower.includes('websocket connection') ||
    lower.includes('[vite] connecting') ||
    lower === ''
  );
}

export function logLevelForConsole(type: string): LogLevel {
  return type === 'error' ? 'error' : 'warn';
}
