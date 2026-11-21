/**
 * Deterministic, reproducible pseudo-randomness.
 *
 * Every scheduling decision in the exploration and filter engines draws from a
 * seeded stream so that a run can be replayed exactly from its recorded seed.
 * The same seed must produce the same plan on every platform, therefore only
 * integer arithmetic on 32-bit values is used.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Fisher-Yates shuffle returning a new array. */
  shuffle<T>(items: readonly T[]): T[];
  /** Pick one element, or undefined for an empty array. */
  pick<T>(items: readonly T[]): T | undefined;
  /** Pick up to `count` distinct elements. */
  sample<T>(items: readonly T[], count: number): T[];
  /** True with probability p. */
  chance(p: number): boolean;
  /** Current internal state, for logging/debugging a run plan. */
  readonly seed: number;
}

/** FNV-1a 32-bit string hash - stable across runtimes. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32 PRNG: tiny, fast, good enough for exploration ordering. */
export function createRng(seed: number): Rng {
  let state = (seed >>> 0) || 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (max < min) return min;
    return min + Math.floor(next() * (max - min + 1));
  };

  return {
    next,
    int,
    shuffle<T>(items: readonly T[]): T[] {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = int(0, i);
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
      }
      return copy;
    },
    pick<T>(items: readonly T[]): T | undefined {
      if (items.length === 0) return undefined;
      return items[int(0, items.length - 1)];
    },
    sample<T>(items: readonly T[], count: number): T[] {
      return this.shuffle(items).slice(0, Math.max(0, Math.min(count, items.length)));
    },
    chance(p: number): boolean {
      return next() < p;
    },
    get seed() {
      return seed;
    },
  };
}

/** Create a seed from a string (used when a user pins a reproducible run). */
export function seedFromString(value: string): number {
  return hashString(value) || 1;
}

/** Stable key for a set of option ids, independent of selection order. */
export function unorderedKey(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim().toLowerCase())
    .sort()
    .join('|');
}
