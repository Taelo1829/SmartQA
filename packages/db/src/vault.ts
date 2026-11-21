import { nowIso, shortId, type SessionVaultEntry } from '@smartqa/shared';
import { decryptJson, encryptJson } from './crypto';
import type { Store } from './store/types';

/**
 * Encrypted browser-session vault.
 *
 * The agent never receives a password: a human signs in inside the isolated
 * browser, the resulting Playwright storage state is encrypted with
 * AES-256-GCM and stored with an expiry. The engine loads it into a fresh
 * context, so cookies/tokens are never exposed through the API.
 */

export interface SaveSessionInput {
  userId: string;
  siteId: string;
  runId?: string | null;
  origin: string;
  storageState: unknown;
  ttlDays?: number;
}

export class SessionVaultService {
  constructor(
    private readonly store: Store,
    private readonly defaultTtlDays = 7,
  ) {}

  async save(input: SaveSessionInput): Promise<SessionVaultEntry> {
    const encrypted = encryptJson({
      origin: input.origin,
      capturedAt: nowIso(),
      storageState: input.storageState,
    });
    const ttlDays = input.ttlDays ?? this.defaultTtlDays;
    const createdAt = new Date();
    const entry: SessionVaultEntry = {
      id: shortId('vlt'),
      userId: input.userId,
      siteId: input.siteId,
      runId: input.runId ?? null,
      origin: input.origin,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlDays * 86_400_000).toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    };

    // One active entry per (user, origin): revoke superseded sessions so a
    // fresh manual login always wins and old cookies cannot be replayed.
    const existing = await this.store.vault.find({
      where: { userId: input.userId, origin: input.origin, revokedAt: null },
      limit: 50,
    });
    for (const old of existing) {
      await this.store.vault.update(old.id, { revokedAt: nowIso() });
    }
    return this.store.vault.create(entry);
  }

  async load(
    userId: string,
    origin: string,
  ): Promise<{ entry: SessionVaultEntry; storageState: unknown } | null> {
    const candidates = await this.store.vault.find({
      where: { userId, origin, revokedAt: null },
      orderBy: { field: 'createdAt', direction: 'desc' },
      limit: 5,
    });
    const now = Date.now();
    for (const entry of candidates) {
      if (new Date(entry.expiresAt).getTime() <= now) continue;
      try {
        const decrypted = decryptJson<{ storageState: unknown }>({
          ciphertext: entry.ciphertext,
          iv: entry.iv,
          authTag: entry.authTag,
          keyVersion: entry.keyVersion,
        });
        await this.store.vault.update(entry.id, { lastUsedAt: nowIso() });
        return { entry, storageState: decrypted.storageState };
      } catch {
        // Wrong/rotated key or tampered ciphertext: mark revoked, continue.
        await this.store.vault.update(entry.id, { revokedAt: nowIso() });
      }
    }
    return null;
  }

  async revoke(id: string, userId: string): Promise<void> {
    const entry = await this.store.vault.get(id);
    if (!entry || entry.userId !== userId) return;
    await this.store.vault.update(id, { revokedAt: nowIso() });
  }

  async revokeForOrigin(userId: string, origin: string): Promise<void> {
    const entries = await this.store.vault.find({ where: { userId, origin, revokedAt: null }, limit: 50 });
    for (const entry of entries) await this.store.vault.update(entry.id, { revokedAt: nowIso() });
  }

  /** Metadata only - ciphertext is never returned to callers of this method. */
  async listForOrigin(userId: string, origin: string): Promise<Array<Omit<SessionVaultEntry, 'ciphertext' | 'iv' | 'authTag'>>> {
    const entries = await this.store.vault.find({
      where: { userId, origin },
      orderBy: { field: 'createdAt', direction: 'desc' },
      limit: 20,
    });
    return entries.map(({ ciphertext: _c, iv: _i, authTag: _a, ...metadata }) => metadata);
  }

  async cleanupExpired(now = Date.now()): Promise<number> {
    const entries = await this.store.vault.find({ where: { revokedAt: null }, limit: 500 });
    let count = 0;
    for (const entry of entries) {
      if (new Date(entry.expiresAt).getTime() <= now) {
        await this.store.vault.update(entry.id, { revokedAt: nowIso() });
        count += 1;
      }
    }
    return count;
  }
}
