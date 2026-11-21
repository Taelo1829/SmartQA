/**
 * Small in-memory rate limiter.
 *
 * Adequate for a single-instance deployment; a multi-instance deployment should
 * use Redis (documented in docs/SECURITY.md). Limits protect login and run
 * creation from abuse and runaway browser launches.
 */

interface Bucket {
  hits: number[];
}

const KEY = Symbol.for('smartqa.rate-limits.v1');

function buckets(): Map<string, Bucket> {
  const global_ = globalThis as typeof globalThis & { [KEY]?: Map<string, Bucket> };
  if (!global_[KEY]) global_[KEY] = new Map();
  return global_[KEY]!;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets().get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((hit) => now - hit < windowMs);
  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0] ?? now;
    buckets().set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }
  bucket.hits.push(now);
  buckets().set(key, bucket);
  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterSeconds: 0 };
}

export function clientKey(request: Request, suffix: string): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip') || 'local';
  return `${suffix}:${ip}`;
}
