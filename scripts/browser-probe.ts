/**
 * Browser launch probe: verifies which Chromium binary Playwright can drive in
 * this environment. Used during setup and by docs/SETUP.md troubleshooting.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

async function main(): Promise<void> {
  const { chromium } = await import('playwright');
  const candidates: Array<{ label: string; options: Record<string, unknown> }> = [];

  const msCache = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  if (existsSync(msCache)) {
    const builds = readdirSync(msCache)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort()
      .reverse();
    for (const build of builds.slice(0, 3)) {
      const exe = path.join(msCache, build, 'chrome-win64', 'chrome.exe');
      if (existsSync(exe)) candidates.push({ label: `cache:${build}`, options: { executablePath: exe } });
    }
  }
  candidates.push({ label: 'channel:chrome', options: { channel: 'chrome' } });
  candidates.push({ label: 'channel:msedge', options: { channel: 'msedge' } });
  candidates.push({ label: 'bundled', options: {} });

  for (const candidate of candidates) {
    const started = Date.now();
    try {
      const browser = await chromium.launch({ headless: true, ...candidate.options });
      const page = await browser.newPage();
      await page.setContent('<title>probe</title><h1>SmartQA probe</h1><button>Go</button>');
      const title = await page.title();
      const text = await page.textContent('h1');
      await browser.close();
      console.log(`OK ${candidate.label} title=${title} text=${text} ms=${Date.now() - started}`);
      return;
    } catch (error) {
      console.log(`FAIL ${candidate.label}: ${(error as Error).message.split('\n')[0]}`);
    }
  }
  process.exitCode = 1;
}

void main();
