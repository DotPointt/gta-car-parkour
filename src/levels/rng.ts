/** Deterministic seeded randomness: the same seed always produces the same level. */

/** FNV-1a hash of any mix of numbers/strings -> 32-bit seed. */
export function hashSeed(...parts: (number | string)[]): number {
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** uniform [0, 1) */
  next(): number;
  range(a: number, b: number): number;
  /** integer in [a, b] inclusive */
  int(a: number, b: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  sign(): 1 | -1;
  weighted<T>(items: readonly { item: T; w: number }[]): T;
}

/** mulberry32 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    weighted: (items) => {
      const total = items.reduce((s, i) => s + Math.max(0, i.w), 0);
      let r = next() * total;
      for (const i of items) {
        r -= Math.max(0, i.w);
        if (r <= 0) return i.item;
      }
      return items[items.length - 1].item;
    },
  };
  return rng;
}

/** Round for signatures (so tiny float noise never makes two levels "different"). */
export const q = (x: number, step = 1) => Math.round(x / step) * step;
