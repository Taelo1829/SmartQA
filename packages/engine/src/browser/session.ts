import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';
import type { LiveInput, ViewportName } from '@smartqa/shared';
import { SignalCollector, INIT_SCRIPT } from './collectors';
import { RunUrlGuard } from '../security/ssrf';
import { waitForPageReady } from './readiness';

/**
 * Env bootstrap.
 *
 * Next.js loads .env from the app directory, but this monorepo keeps one .env
 * at the root. Loading it here (and lazily importing Playwright afterwards)
 * guarantees PLAYWRIGHT_BROWSERS_PATH is set before Playwright's registry is
 * initialised.
 */
export function bootstrapEnv(): void {
  const global_ = globalThis as { __smartqaEnvLoaded?: boolean };
  if (global_.__smartqaEnvLoaded) return;
  global_.__smartqaEnvLoaded = true;
  const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '..', '..', '.env')];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const loader = (process as NodeJS.Process & { loadEnvFile?: (file: string) => void }).loadEnvFile;
      loader?.call(process, file);
    } catch {
      /* malformed env file: keep going with process env */
    }
    break;
  }
}

export const VIEWPORT_SIZES: Record<ViewportName, { width: number; height: number; isMobile: boolean }> = {
  desktop: { width: 1440, height: 900, isMobile: false },
  mobile: { width: 390, height: 844, isMobile: true },
};

export interface BrowserSessionOptions {
  runId: string;
  headless: boolean;
  channel?: string;
  viewport: ViewportName;
  storageState?: unknown;
  urlGuard: RunUrlGuard;
  traceDir?: string;
  artifactsDir: string;
  /** Receives base64 JPEG frames when live streaming is enabled. */
  onScreencastFrame?: (base64: string) => void;
}

export interface NavigationResult {
  url: string;
  status: number | null;
  readiness: string[];
  durationMs: number;
}

export class BrowserSession {
  readonly signals = new SignalCollector();
  private cdp: CDPSession | null = null;
  private tracingActive = false;
  private closed = false;

  private constructor(
    readonly browser: Browser,
    readonly context: BrowserContext,
    readonly page: Page,
    readonly options: BrowserSessionOptions,
  ) {
    this.signals.attach(page);
  }

  static async launch(options: BrowserSessionOptions): Promise<BrowserSession> {
    bootstrapEnv();
    const { chromium } = await import('playwright');
    const size = VIEWPORT_SIZES[options.viewport];
    const args = ['--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--mute-audio'];

    const attempts: Array<{ channel?: string; executablePath?: string }> = [];
    if (options.channel) attempts.push({ channel: options.channel });
    attempts.push({});
    attempts.push({ channel: 'chrome' });
    attempts.push({ channel: 'msedge' });

    const msCacheCandidates = [
      process.env.PLAYWRIGHT_BROWSERS_PATH,
      path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
      path.join(os.homedir(), '.cache', 'ms-playwright'),
    ].filter(Boolean) as string[];

    for (const msCache of msCacheCandidates) {
      if (existsSync(msCache)) {
        try {
          const builds = readdirSync(msCache)
            .filter((name) => /^chromium-\d+$/.test(name))
            .sort()
            .reverse();
          for (const build of builds) {
            const winExe = path.join(msCache, build, 'chrome-win64', 'chrome.exe');
            if (existsSync(winExe)) attempts.push({ executablePath: winExe });
            const linuxExe = path.join(msCache, build, 'chrome-linux', 'chrome');
            if (existsSync(linuxExe)) attempts.push({ executablePath: linuxExe });
          }
        } catch {
          /* ignore directory read error */
        }
      }
    }

    let browser: Browser | null = null;
    const errors: string[] = [];
    for (const attempt of attempts) {
      try {
        browser = await chromium.launch({
          headless: options.headless,
          args,
          ...(attempt.channel ? { channel: attempt.channel } : {}),
          ...(attempt.executablePath ? { executablePath: attempt.executablePath } : {}),
        });
        break;
      } catch (error) {
        errors.push(`${attempt.channel ?? attempt.executablePath ?? 'bundled'}: ${(error as Error).message.split('\n')[0]}`);
      }
    }
    if (!browser) {
      throw new Error(
        `No Chromium browser could be launched. Tried: ${errors.join(' | ')}. ` +
          'Run `npx playwright install chromium` or set PLAYWRIGHT_CHANNEL=chrome.',
      );
    }

    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      isMobile: size.isMobile,
      hasTouch: size.isMobile,
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
      locale: 'en-US',
      ...(options.storageState ? { storageState: options.storageState as never } : {}),
    });
    context.setDefaultTimeout(10_000);
    context.setDefaultNavigationTimeout(30_000);
    await context.addInitScript(INIT_SCRIPT);

    // Request-level SSRF guard: covers redirects and every subresource.
    await context.route('**/*', async (route) => {
      const request = route.request();
      const rawUrl = request.url();
      if (!/^https?:/i.test(rawUrl)) {
        await route.continue().catch(() => undefined);
        return;
      }
      try {
        await options.urlGuard.assertRequestAllowed(rawUrl, request.isNavigationRequest());
        await route.continue();
      } catch (error) {
        await route.abort('blockedbyclient').catch(() => undefined);
        void error;
      }
    });

    const page = await context.newPage();
    const session = new BrowserSession(browser, context, page, options);
    if (options.traceDir) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      session.tracingActive = true;
    }
    return session;
  }

  get currentUrl(): string {
    return this.page.url();
  }

  async navigate(url: string): Promise<NavigationResult> {
    const started = Date.now();
    const response = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const readiness = await waitForPageReady(this.page, { timeoutMs: 20_000 });
    return {
      url: this.page.url(),
      status: response?.status() ?? null,
      readiness,
      durationMs: Date.now() - started,
    };
  }

  async waitUntilReady(): Promise<string[]> {
    return waitForPageReady(this.page, { timeoutMs: 20_000 });
  }

  async takeScreenshot(fullPage = false): Promise<Buffer> {
    return this.page.screenshot({ fullPage, type: 'png', timeout: 20_000 });
  }

  async storageState(): Promise<unknown> {
    return this.context.storageState();
  }

  async setViewport(viewport: ViewportName): Promise<void> {
    const size = VIEWPORT_SIZES[viewport];
    await this.page.setViewportSize({ width: size.width, height: size.height });
  }

  /** Forward a human's input from the live-view canvas into the browser. */
  async dispatchInput(input: LiveInput): Promise<void> {
    if (this.closed) throw new Error('Browser session is closed');
    if (!this.cdp) this.cdp = await this.context.newCDPSession(this.page);
    const cdp = this.cdp;

    if (input.type === 'mouse') {
      await cdp.send('Input.dispatchMouseEvent', {
        type: input.event,
        x: Math.round(input.x),
        y: Math.round(input.y),
        button: input.event === 'mouseMoved' ? 'none' : input.button,
        clickCount: input.clickCount,
        modifiers: input.modifiers,
        ...(input.event === 'mouseWheel' ? { deltaX: input.deltaX ?? 0, deltaY: input.deltaY ?? 0 } : {}),
      } as never);
      return;
    }
    if (input.type === 'scroll') {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: Math.round(input.x),
        y: Math.round(input.y),
        deltaX: input.deltaX,
        deltaY: input.deltaY,
      } as never);
      return;
    }
    if (input.type === 'type') {
      await cdp.send('Input.insertText', { text: input.text } as never);
      return;
    }
    const keyCodes: Record<string, number> = {
      Enter: 13,
      Tab: 9,
      Backspace: 8,
      Escape: 27,
      ArrowUp: 38,
      ArrowDown: 40,
      ArrowLeft: 37,
      ArrowRight: 39,
      Delete: 46,
      Home: 36,
      End: 35,
    };
    const isChar = input.event === 'char';
    await cdp.send('Input.dispatchKeyEvent', {
      type: isChar ? 'char' : input.event === 'keyDown' ? 'keyDown' : 'keyUp',
      key: input.key,
      code: input.code ?? input.key,
      text: isChar ? input.text ?? input.key : input.text,
      windowsVirtualKeyCode: keyCodes[input.key] ?? input.key.toUpperCase().charCodeAt(0),
      nativeVirtualKeyCode: keyCodes[input.key] ?? input.key.toUpperCase().charCodeAt(0),
      modifiers: input.modifiers,
    } as never);
  }

  /** Start a CDP screencast; frames are delivered as base64 JPEG. */
  async startScreencast(onFrame: (base64: string) => void): Promise<void> {
    if (this.closed) return;
    if (!this.cdp) this.cdp = await this.context.newCDPSession(this.page);
    const cdp = this.cdp;
    cdp.on('Page.screencastFrame', (event: { data: string; sessionId: number }) => {
      onFrame(event.data);
      cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 55,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    } as never);
  }

  async stopScreencast(): Promise<void> {
    if (!this.cdp) return;
    await this.cdp.send('Page.stopScreencast').catch(() => undefined);
  }

  /** Stop tracing and return the trace zip path, if tracing was enabled. */
  async stopTracing(targetPath: string): Promise<string | null> {
    if (!this.tracingActive) return null;
    this.tracingActive = false;
    await this.context.tracing.stop({ path: targetPath });
    return targetPath;
  }

  async pauseTracing(): Promise<void> {
    if (!this.tracingActive) return;
    await this.context.tracing.stop().catch(() => undefined);
    this.tracingActive = false;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.stopScreencast().catch(() => undefined);
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
