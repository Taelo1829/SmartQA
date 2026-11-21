import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfig, SESSION_COOKIE } from '@smartqa/db';

/**
 * Server-side PDF rendering.
 *
 * The report page is rendered in Chromium and printed with page.pdf(), which
 * reuses the same CSS the operator sees in the browser instead of maintaining a
 * second layout just for PDF.
 */

async function launchChromium() {
  const { bootstrapEnv } = await import('@smartqa/engine');
  bootstrapEnv();
  const { chromium } = await import('playwright');
  const attempts: Array<{ channel?: string; executablePath?: string }> = [{}, { channel: 'chrome' }, { channel: 'msedge' }];

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
        /* ignore */
      }
    }
  }

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await chromium.launch({
        headless: true,
        args: ['--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--mute-audio'],
        ...(attempt.channel ? { channel: attempt.channel } : {}),
        ...(attempt.executablePath ? { executablePath: attempt.executablePath } : {}),
      });
    } catch (error) {
      errors.push(`${attempt.channel ?? attempt.executablePath ?? 'bundled'}: ${(error as Error).message.split('\n')[0]}`);
    }
  }
  throw new Error(`No Chromium available for PDF rendering (${errors.join(' | ')})`);
}

export async function renderRunReportPdf(input: {
  runId: string;
  sessionToken: string | null;
}): Promise<Buffer> {
  const config = getConfig();
  const browser = await launchChromium();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
    if (input.sessionToken) {
      await context.addCookies([
        { name: SESSION_COOKIE, value: input.sessionToken, url: config.appUrl, httpOnly: true, sameSite: 'Lax' },
      ]);
    }
    const page = await context.newPage();
    await page.goto(`${config.appUrl}/runs/${input.runId}/report?print=1`, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
    // Let web fonts and recharts SVG layouts settle before printing.
    await page.waitForTimeout(600);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font-size:8px;color:#666;width:100%;text-align:center;">SmartQA report · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });
    return pdf;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
