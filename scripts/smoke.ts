/**
 * SmartQA Platform Smoke Test.
 *
 * Verifies core platform invariants without external infrastructure:
 *  - Store & crypto vault (AES-256-GCM roundtrip)
 *  - Mathematical validation (exhaustive partition arithmetic, additive vs non-additive)
 *  - SSRF & security guardrails (destructive action blocking)
 *  - Deterministic snapshot analysis (NaN/undefined, broken images, overflow)
 *  - Chromium browser automation capability
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFileStore, decryptJson, encryptJson, hashPassword, verifyPassword } from '@smartqa/db';
import {
  analyzeSnapshot,
  assessActionRisk,
  assertSafeUrl,
  BrowserSession,
  classifyAdditivity,
  evaluatePartitionSum,
  parseNumberText,
  RunUrlGuard,
} from '@smartqa/engine';

async function main() {
  console.log('--- SmartQA Platform Smoke Test ---');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, label: string) {
    total += 1;
    if (condition) {
      passed += 1;
      console.log(`  ✔ ${label}`);
    } else {
      console.error(`  ✖ ${label}`);
      process.exitCode = 1;
    }
  }

  // 1. Store & Crypto Vault
  console.log('\n[1/5] Database & Encrypted Vault');
  const tempDir = mkdtempSync(path.join(tmpdir(), 'smartqa-smoke-'));
  const store = createFileStore({ dataDir: tempDir });
  const user = await store.users.create({
    id: 'smoke-usr',
    email: 'smoke@smartqa.local',
    name: 'Smoke Tester',
    passwordHash: await hashPassword('secret123'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert(user.id === 'smoke-usr', 'FileStore entity persistence');
  assert(await verifyPassword('secret123', user.passwordHash), 'Scrypt password hashing');

  const ciphertext = encryptJson({ cookies: ['sid=xyz'] });
  const decrypted = decryptJson<{ cookies: string[] }>(ciphertext);
  assert(decrypted.cookies[0] === 'sid=xyz', 'AES-256-GCM vault encryption roundtrip');

  // 2. Mathematical Validation & Partition Arithmetic
  console.log('\n[2/5] Mathematical Validation Engine');
  const southAfricanSplit = evaluatePartitionSum({
    metricLabel: 'Total sales',
    kind: 'currency',
    additivity: 'additive',
    unit: 'R',
    baseline: 100000,
    parts: [
      { label: 'Johannesburg', value: 40000 },
      { label: 'Pretoria', value: 25000 },
      { label: 'Cape Town', value: 20000 },
      { label: 'Durban', value: 15000 },
    ],
    exhaustive: true,
  });
  assert(southAfricanSplit.verdict === 'pass' && southAfricanSplit.observed === 100000, 'Regional partition sum matches baseline (R100k)');

  const mismatchSplit = evaluatePartitionSum({
    metricLabel: 'Total sales',
    kind: 'currency',
    additivity: 'additive',
    unit: 'R',
    baseline: 100000,
    parts: [
      { label: 'Johannesburg', value: 40000 },
      { label: 'Pretoria', value: 25000 },
      { label: 'Cape Town', value: 20000 },
      { label: 'Durban', value: 10000 }, // Short by R5,000
    ],
    exhaustive: true,
  });
  assert(mismatchSplit.verdict === 'fail' && mismatchSplit.delta === -5000, 'Discrepancy detected when parts do not sum to total');

  const averageCheck = classifyAdditivity('Average order value', 'average', 'R');
  assert(averageCheck.additivity === 'non_additive', 'Averages classified as non-additive (never blindly summed)');

  const percentageCheck = classifyAdditivity('Conversion rate', 'percentage', '%');
  assert(percentageCheck.additivity === 'non_additive', 'Percentages classified as non-additive');

  // 3. Security & Safety Guards
  console.log('\n[3/5] Security & Guardrails');
  let ssrfBlocked = false;
  try {
    await assertSafeUrl('http://169.254.169.254/latest/meta-data', { allowPrivateNetworks: false });
  } catch {
    ssrfBlocked = true;
  }
  assert(ssrfBlocked, 'SSRF protection blocks cloud metadata IP (169.254.169.254)');

  const deleteAccount = assessActionRisk({
    category: 'button',
    label: 'Delete account permanently',
    targetOrigin: 'https://app.example.com',
    allowDestructive: false,
    approvedPatterns: [],
  });
  assert(deleteAccount.risk === 'blocked', 'Destructive action blocked by default (account deletion)');

  const checkoutRisk = assessActionRisk({
    category: 'button',
    label: 'Complete purchase & Pay $499',
    targetOrigin: 'https://app.example.com',
    allowDestructive: false,
    approvedPatterns: [],
  });
  assert(checkoutRisk.risk === 'blocked', 'Destructive action blocked by default (financial transaction)');

  // 4. Snapshot Analysis & Error Detection
  console.log('\n[4/5] Snapshot Analysis & Defect Detection');
  const analysis = analyzeSnapshot(
    {
      url: 'https://app.example.com',
      title: 'Smoke Test',
      readyState: 'complete',
      mainText: 'Normal text',
      bodyTextLength: 20,
      elements: [],
      filters: [],
      metrics: [],
      tables: [],
      links: [],
      images: [{ src: 'https://app.example.com/missing.png', alt: 'Missing', broken: true, visible: true }],
      sentinels: [{ token: 'nan', text: 'NaN', selector: '.metric', isolated: true, context: 'Total: NaN', tag: 'span' }],
      overflow: { scrollWidth: 1000, clientWidth: 1000, offenders: [] },
      overlaps: [],
      spinners: [],
      emptyStateText: null,
      modal: null,
      domSignature: 'abc',
      elementCount: 5,
    },
    {
      runId: 'smoke-run',
      pageUrl: 'https://app.example.com',
      pageTitle: 'Smoke Test',
      pageStateId: 'smoke-state',
      viewport: 'desktop',
    },
  );
  assert(analysis.findings.some((f) => f.category === 'invalid_value'), 'Detects NaN sentinel token');
  assert(analysis.findings.some((f) => f.category === 'broken_image'), 'Detects broken image');

  // 5. Browser Automation Engine
  console.log('\n[5/5] Playwright Browser Launch & Automation');
  const browserSession = await BrowserSession.launch({
    runId: 'smoke-browser',
    headless: true,
    viewport: 'desktop',
    urlGuard: new RunUrlGuard('http://127.0.0.1:4173', { allowPrivateNetworks: true }),
    artifactsDir: tempDir,
  });
  await browserSession.page.setContent('<html><body><h1>SmartQA Ready</h1></body></html>');
  const h1 = await browserSession.page.textContent('h1');
  assert(h1 === 'SmartQA Ready', 'Playwright browser executes DOM and renders correctly');
  await browserSession.close();

  console.log(`\nSmoke Test Summary: ${passed}/${total} checks passed.`);
  if (passed === total) {
    console.log('✔ Platform is healthy and ready for autonomous testing.\n');
  } else {
    console.error('✖ Some smoke checks failed.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
