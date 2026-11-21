import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFileStore,
  decryptJson,
  encryptJson,
  hashPassword,
  hashToken,
  signReportToken,
  verifyPassword,
  verifyReportToken,
} from '@smartqa/db';
import type { TestRun } from '@smartqa/shared';

describe('encrypted session vault primitives', () => {
  it('round-trips JSON through AES-256-GCM', () => {
    const payload = { cookies: [{ name: 'session', value: 'secret' }], origins: ['https://app.example'] };
    const encrypted = encryptJson(payload);
    expect(encrypted.ciphertext).not.toContain('secret');
    expect(decryptJson(encrypted)).toEqual(payload);
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = encryptJson({ ok: true });
    const tampered = { ...encrypted, ciphertext: Buffer.from('tampered').toString('base64') };
    expect(() => decryptJson(tampered)).toThrow();
  });

  it('hashes passwords with scrypt and verifies them', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('hashes session tokens deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('signs and verifies short-lived report tokens', () => {
    const token = signReportToken('run_1', 'usr_1', 60_000);
    expect(verifyReportToken(token, 'run_1')).toBe(true);
    expect(verifyReportToken(token, 'run_2')).toBe(false);
    expect(verifyReportToken(`${token}x`, 'run_1')).toBe(false);
  });
});

describe('file store', () => {
  const makeStore = () => createFileStore({ dataDir: mkdtempSync(path.join(tmpdir(), 'smartqa-store-')) });

  it('creates, reads, updates and deletes entities', async () => {
    const store = makeStore();
    const now = new Date().toISOString();
    const run: TestRun = {
      id: 'run_1',
      userId: 'usr_1',
      url: 'https://example.com',
      origin: 'https://example.com',
      mode: 'background',
      status: 'queued',
      config: {
        url: 'https://example.com',
        mode: 'background',
        requireAuth: false,
        viewports: ['desktop'],
        budgets: {
          maxPages: 5,
          maxActions: 20,
          maxDepth: 2,
          actionsPerPage: 5,
          maxFilterCombinations: 4,
          maxDurationMs: 60_000,
        },
        seed: 42,
        allowDestructiveActions: false,
        approvedActionPatterns: [],
        focus: 'full',
        captureScreenshots: true,
        recordTrace: false,
        reproductionAttempts: 1,
      },
      authState: 'not_required',
      progress: {
        phase: 'queued',
        phaseLabel: 'Queued',
        percent: 0,
        message: '',
        pagesDiscovered: 0,
        pagesVisited: 0,
        actionsExecuted: 0,
        checksRun: 0,
        findings: 0,
        updatedAt: now,
      },
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      heartbeatAt: null,
      cancelRequestedAt: null,
      summary: null,
      coverage: null,
      error: null,
      workerId: null,
    };
    await store.runs.create(run);
    expect(await store.runs.get('run_1')).toMatchObject({ id: 'run_1', status: 'queued' });

    await store.runs.update('run_1', { status: 'running' });
    expect((await store.runs.get('run_1'))?.status).toBe('running');

    const found = await store.runs.find({ where: { userId: 'usr_1' }, limit: 10 });
    expect(found).toHaveLength(1);
    expect(await store.runs.count({ status: 'running' })).toBe(1);
    expect(await store.runs.count({ status: 'queued' })).toBe(0);

    await expect(store.runs.create(run)).rejects.toThrow(/Duplicate id/);
    await store.runs.delete('run_1');
    expect(await store.runs.get('run_1')).toBeNull();
  });

  it('persists across store instances', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'smartqa-persist-'));
    const first = createFileStore({ dataDir });
    await first.users.create({
      id: 'usr_1',
      email: 'a@b.co',
      name: 'A',
      passwordHash: 'scrypt$x$y',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const second = createFileStore({ dataDir });
    expect((await second.users.get('usr_1'))?.email).toBe('a@b.co');
  });

  it('supports range and exclusion filters used by the API', async () => {
    const store = makeStore();
    const base = {
      runId: 'run_x',
      seq: 1,
      level: 'info' as const,
      message: 'one',
      actionId: null,
      at: new Date('2026-01-01T00:00:00Z').toISOString(),
      data: null,
    };
    await store.logs.create({ ...base, id: 'log_1' });
    await store.logs.create({ ...base, id: 'log_2', seq: 2, at: new Date('2026-02-01T00:00:00Z').toISOString() });
    await store.logs.create({
      ...base,
      id: 'log_3',
      seq: 3,
      level: 'error',
      at: new Date('2026-03-01T00:00:00Z').toISOString(),
    });

    const later = await store.logs.find({
      where: { at: { gte: new Date('2026-01-15T00:00:00Z').toISOString() } },
      limit: 10,
    });
    expect(later.map((entry) => entry.id).sort()).toEqual(['log_2', 'log_3']);
    const errors = await store.logs.find({ where: { level: 'error' }, limit: 10 });
    expect(errors).toHaveLength(1);
    const excluded = await store.logs.find({ where: { level: { not: 'error' } }, limit: 10 });
    expect(excluded).toHaveLength(2);
  });
});
