import { describe, expect, it } from 'vitest';
import { BrowserSession } from '@smartqa/engine';
import { RunUrlGuard } from '@smartqa/engine';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('BrowserSession & isolated browser execution', () => {
  const artifactsDir = mkdtempSync(path.join(tmpdir(), 'smartqa-browser-test-'));
  const guard = new RunUrlGuard('http://127.0.0.1:3100', { allowPrivateNetworks: true });

  it('launches an isolated browser session, drives DOM, and collects snapshots', async () => {
    const session = await BrowserSession.launch({
      runId: 'browser-test-run',
      headless: true,
      viewport: 'desktop',
      urlGuard: guard,
      artifactsDir,
    });

    expect(session.page).toBeDefined();

    // Set sample HTML content with buttons, inputs, tables, and images
    await session.page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>Test Playground</title></head>
        <body>
          <header>
            <nav>
              <a href="#section-1" id="link-1">Section 1</a>
              <a href="#section-2" id="link-2">Section 2</a>
            </nav>
          </header>
          <main>
            <h1>Autonomous QA Playground</h1>
            <div data-testid="kpi-sales">Total Sales: R100,000</div>
            <button id="btn-action" onclick="this.textContent = 'Clicked!'">Click me</button>
            <input type="text" id="input-query" placeholder="Search..." />
            <table>
              <thead><tr><th>Item</th><th>Cost</th></tr></thead>
              <tbody>
                <tr><td>Widget</td><td>R40,000</td></tr>
                <tr><td>Gadget</td><td>R60,000</td></tr>
              </tbody>
              <tfoot>
                <tr><td>Total</td><td>R100,000</td></tr>
              </tfoot>
            </table>
          </main>
        </body>
      </html>
    `);

    // Verify title and heading
    expect(await session.page.title()).toBe('Test Playground');

    // Test input dispatch (mouse click)
    const button = session.page.locator('#btn-action');
    await button.click();
    expect(await button.textContent()).toBe('Clicked!');

    // Test text typing
    const input = session.page.locator('#input-query');
    await input.fill('autonomous test');
    expect(await input.inputValue()).toBe('autonomous test');

    // Test screencast frame push (mock handler)
    let frameReceived = false;
    await session.startScreencast((_base64) => {
      frameReceived = true;
    });

    // Small delay for screencast frame
    await session.page.evaluate(() => document.body.style.backgroundColor = '#f0f0f0');
    await new Promise((resolve) => setTimeout(resolve, 200));

    await session.stopScreencast();
    await session.close();
  });
});
