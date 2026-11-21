import { describe, expect, it } from 'vitest';
import { createRng, hashString, normalizeUrl, seedFromString, waitFor } from '@smartqa/shared';
import { assessActionRisk } from '@smartqa/engine';
import { assertSafeUrl, isPrivateAddress, SsrfError } from '@smartqa/engine';

describe('seeded randomness', () => {
  it('is reproducible from the same seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const left = a.shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const right = b.shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(left).toEqual(right);
    expect(createRng(1234).int(0, 1_000_000)).toBe(createRng(1234).int(0, 1_000_000));
  });

  it('produces different orders for different seeds', () => {
    const left = createRng(1).shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const right = createRng(2).shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(left).not.toEqual(right);
  });

  it('samples distinct items', () => {
    const rng = createRng(99);
    const sample = rng.sample([1, 2, 3, 4, 5], 3);
    expect(new Set(sample).size).toBe(3);
  });

  it('derives stable seeds from strings', () => {
    expect(seedFromString('https://example.com')).toBe(hashString('https://example.com'));
    expect(seedFromString('x')).toBe(seedFromString('x'));
  });
});

describe('url normalisation', () => {
  it('sorts query parameters and drops tracking noise', () => {
    expect(normalizeUrl('https://Example.com/a/?b=2&a=1&utm_source=x#hash')).toBe('https://example.com/a?a=1&b=2');
    expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  });
});

describe('SSRF protection', () => {
  const policy = { allowPrivateNetworks: false };

  it('rejects private and link-local addresses', async () => {
    await expect(assertSafeUrl('http://127.0.0.1:3000', policy)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('http://10.0.0.5/', policy)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data', policy)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('http://[::1]/', policy)).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects non-http schemes and embedded credentials', async () => {
    await expect(assertSafeUrl('file:///etc/passwd', policy)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('javascript:alert(1)', policy)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('http://user:pass@example.com', policy)).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects local hostnames', async () => {
    await expect(assertSafeUrl('http://localhost:8080', policy)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('http://metadata.google.internal', policy)).rejects.toBeInstanceOf(SsrfError);
  });

  it('allows private targets only when explicitly enabled', async () => {
    const result = await assertSafeUrl('http://127.0.0.1:4173/', { allowPrivateNetworks: true });
    expect(result.private).toBe(true);
    expect(result.hostname).toBe('127.0.0.1');
  });

  it('classifies addresses correctly', () => {
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('fe80::1')).toBe(true);
  });
});

describe('destructive action policy', () => {
  const base = {
    category: 'button' as const,
    targetOrigin: 'https://app.example.com',
    allowDestructive: false,
    approvedPatterns: [],
  };

  it('blocks destructive operations by default', () => {
    expect(assessActionRisk({ ...base, label: 'Delete account' }).risk).toBe('blocked');
    expect(assessActionRisk({ ...base, label: 'Buy now' }).risk).toBe('blocked');
    expect(assessActionRisk({ ...base, label: 'Send message' }).risk).toBe('blocked');
    expect(assessActionRisk({ ...base, label: 'Place order' }).risk).toBe('blocked');
    expect(assessActionRisk({ ...base, label: 'Log out' }).risk).toBe('blocked');
  });

  it('allows safe filtering and navigation controls', () => {
    expect(assessActionRisk({ ...base, label: 'Reset filters' }).risk).toBe('none');
    expect(assessActionRisk({ ...base, label: 'Search' }).risk).toBe('none');
    expect(assessActionRisk({ ...base, label: 'Next page' }).risk).toBe('none');
  });

  it('never follows external links', () => {
    const assessment = assessActionRisk({ ...base, label: 'Partner site', href: 'https://evil.example' });
    expect(assessment.risk).toBe('blocked');
    expect(assessment.reason).toContain('External navigation');
  });

  it('blocks file uploads', () => {
    expect(assessActionRisk({ ...base, label: 'Upload', inputType: 'file' }).risk).toBe('blocked');
  });

  it('honours explicit operator approval', () => {
    expect(assessActionRisk({ ...base, label: 'Delete draft', approvedPatterns: ['delete draft'] }).risk).toBe('none');
    expect(assessActionRisk({ ...base, label: 'Delete draft', allowDestructive: true }).risk).toBe('none');
  });

  it('marks form submissions as possible risk rather than safe', () => {
    expect(assessActionRisk({ ...base, label: 'Save changes' }).risk).toBe('possible');
  });
});

describe('waitFor', () => {
  it('resolves as soon as the condition is true', async () => {
    let calls = 0;
    const result = await waitFor(() => {
      calls += 1;
      return calls >= 3;
    }, { timeoutMs: 2_000, intervalMs: 10 });
    expect(result).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('returns false on timeout', async () => {
    const result = await waitFor(() => false, { timeoutMs: 50, intervalMs: 10 });
    expect(result).toBe(false);
  });
});
