import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Cryptography used by SmartQA.
 *
 *  - Password hashing: scrypt with a per-user random salt.
 *  - Session tokens: 32 random bytes; only a SHA-256 hash is persisted.
 *  - Captured browser sessions: AES-256-GCM with a 32-byte key derived from
 *    SESSION_ENCRYPTION_KEY, random 12-byte IV, authenticated ciphertext.
 */

const SCRYPT_KEYLEN = 64;
const IV_LENGTH = 12;

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

function resolveSecret(): string {
  const secret =
    process.env.SESSION_ENCRYPTION_KEY ||
    (process.env.NODE_ENV === 'production' ? '' : 'dev-only-insecure-key-change-me-0123456789abcdef');
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_ENCRYPTION_KEY must be set to at least 32 characters before capturing authenticated sessions.',
    );
  }
  return secret;
}

/** 32-byte AES key. Salt is fixed because the secret already has full entropy. */
function aesKey(): Buffer {
  return createHash('sha256').update(`smartqa:vault:v1:${resolveSecret()}`).digest();
}

export function encryptJson(value: unknown): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  // Import lazily so the module can be loaded in edge runtimes without Node crypto.
  const { createCipheriv } = require('node:crypto') as typeof import('node:crypto');
  const cipher = createCipheriv('aes-256-gcm', aesKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyVersion: 1,
  };
}

export function decryptJson<T>(payload: EncryptedPayload): T {
  const { createDecipheriv } = require('node:crypto') as typeof import('node:crypto');
  const decipher = createDecipheriv('aes-256-gcm', aesKey(), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = scryptSync(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(`smartqa:session:${token}`).digest('hex');
}

/** Constant-time comparison for API keys and signed values. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Short-lived signed token used for one-off PDF report rendering. */
export function signReportToken(runId: string, userId: string, ttlMs = 5 * 60_000): string {
  const expires = Date.now() + ttlMs;
  const body = `${runId}.${userId}.${expires}`;
  const signature = createHmac('sha256', resolveSecret()).update(body).digest('base64url');
  return `${Buffer.from(body).toString('base64url')}.${signature}`;
}

export function verifyReportToken(token: string, runId: string): boolean {
  try {
    const [bodyB64, signature] = token.split('.');
    if (!bodyB64 || !signature) return false;
    const body = Buffer.from(bodyB64, 'base64url').toString('utf8');
    const [tokenRunId, , expires] = body.split('.');
    if (tokenRunId !== runId) return false;
    if (Number(expires) < Date.now()) return false;
    const expected = createHmac('sha256', resolveSecret()).update(body).digest('base64url');
    return safeCompare(signature, expected);
  } catch {
    return false;
  }
}
