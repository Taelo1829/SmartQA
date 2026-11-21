import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureBootstrapUser, getStore, resetRuntimeForTests } from '@smartqa/db';
import { BrowserSession, RunUrlGuard, analyzeSnapshot, evaluatePartitionSum, classifyAdditivity } from '@smartqa/engine';

describe('Autonomous Engine E2E Capabilities', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'smartqa-e2e-suite-'));

  it('proves end-to-end DOM discovery, interactive state tracking, and defect detection', async () => {
    const session = await BrowserSession.launch({
      runId: 'e2e-synthetic-run',
      headless: true,
      viewport: 'desktop',
      urlGuard: new RunUrlGuard('http://127.0.0.1:4173', { allowPrivateNetworks: true }),
      artifactsDir: tempDir,
    });

    // Provide a rich synthetic web page with interactive elements, filters, KPI cards, and seeded bugs
    await session.page.setContent(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <title>Sales Analytics Dashboard</title>
          <style>
            .kpi { padding: 10px; margin: 5px; border: 1px solid #ccc; }
            .filter-group { margin: 15px 0; }
            .broken-layout { width: 2000px; }
          </style>
        </head>
        <body>
          <nav>
            <a href="/dashboard">Dashboard</a>
            <a href="/reports">Reports</a>
            <a href="/settings">Settings</a>
          </nav>

          <header>
            <h1>Sales Performance</h1>
            <!-- Seeded Defect: NaN rendered in KPI -->
            <div class="kpi" data-testid="kpi-nan">
              <span class="label">Refund Rate</span>
              <span class="value">NaN%</span>
            </div>
            <div class="kpi" data-testid="kpi-sales">
              <span class="label">Total Sales</span>
              <span class="value">R100,000</span>
            </div>
          </header>

          <section class="filter-group">
            <label for="region-select">Region</label>
            <select id="region-select" data-testid="filter-region">
              <option value="all">All Regions</option>
              <option value="jhb">Johannesburg</option>
              <option value="pta">Pretoria</option>
              <option value="cpt">Cape Town</option>
              <option value="dbn">Durban</option>
            </select>

            <button id="btn-reset" onclick="document.getElementById('region-select').value='all'">Reset</button>
            <!-- Seeded Defect: dead button -->
            <button id="btn-dead-export">Export Excel</button>
            <!-- Seeded Defect: crashing button -->
            <button id="btn-crash" onclick="throw new Error('Uncaught simulator crash')">Simulate Crash</button>
          </section>

          <section>
            <!-- Seeded Defect: broken image -->
            <img src="/assets/non-existent-chart.png" alt="Missing quarterly trend chart" />
          </section>

          <table>
            <thead>
              <tr><th>Region</th><th>Sales</th></tr>
            </thead>
            <tbody>
              <tr><td>Johannesburg</td><td>R40,000</td></tr>
              <tr><td>Pretoria</td><td>R25,000</td></tr>
              <tr><td>Cape Town</td><td>R20,000</td></tr>
              <tr><td>Durban</td><td>R15,000</td></tr>
            </tbody>
            <tfoot>
              <!-- Seeded Defect: footer total does not match sum: 40+25+20+15 = 100k, footer says 105k -->
              <tr><td>Total</td><td>R105,000</td></tr>
            </tfoot>
          </table>
        </body>
      </html>
    `);

    // Verify navigation and title
    expect(await session.page.title()).toBe('Sales Analytics Dashboard');

    // 1. Interactive Element testing
    const select = session.page.locator('#region-select');
    await select.selectOption('jhb');
    expect(await select.inputValue()).toBe('jhb');

    // Reset button
    const resetBtn = session.page.locator('#btn-reset');
    await resetBtn.click();
    expect(await select.inputValue()).toBe('all');

    // 2. Mathematical Validation:
    // Johannesburg (40k) + Pretoria (25k) + Cape Town (20k) + Durban (15k) = 100k
    // Footer says R105,000 -> Detected discrepancy!
    const tableEvaluation = evaluatePartitionSum({
      metricLabel: 'Sales',
      kind: 'currency',
      additivity: 'additive',
      unit: 'R',
      baseline: 105000,
      parts: [
        { label: 'Johannesburg', value: 40000 },
        { label: 'Pretoria', value: 25000 },
        { label: 'Cape Town', value: 20000 },
        { label: 'Durban', value: 15000 },
      ],
      exhaustive: true,
    });
    expect(tableEvaluation.verdict).toBe('fail');
    expect(tableEvaluation.delta).toBe(-5000);

    // 3. Mathematical Validation non-additive:
    const avgCheck = classifyAdditivity('Refund Rate', 'percentage', '%');
    expect(avgCheck.additivity).toBe('non_additive');

    // 4. Runtime Error Collection:
    // Triggering the crashing button should be captured by signal collectors
    try {
      await session.page.click('#btn-crash');
    } catch {
      // Browser or page may throw or record
    }
    const pageErrors = session.signals.all().pageErrors;
    expect(pageErrors.length).toBeGreaterThanOrEqual(1);
    expect(pageErrors[0].message).toContain('Uncaught simulator crash');

    await session.close();
  });
});
