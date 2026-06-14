// Deterministic, seedable PRNG (mulberry32). A fresh instance from the same seed always
// yields the same sequence — the determinism foundation for ALL procedural generation
// (design Decision 5, §6.0, AC7/AC12). The ALGORITHM is byte-identical to the sibling
// crowd-runner's src/util/rng.js so seeds are cross-compatible and scripts/verify-gen.mjs
// can pin exact output sequences; only this comment is adapted to reference this doc.
export type RNG = () => number

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Convenience: random float in [min, max) from a generator.
export function range(rng: RNG, min: number, max: number): number {
  return min + (max - min) * rng()
}

// ── dailySeed(dateKey) (F7 endgame-bosscells-seeds §2b, Decision 6, AC7) ── hash a calendar-day string
// (e.g. 'YYYY-MM-DD') to a STABLE unsigned-32-bit run seed: the daily-challenge contract — same date ⇒ same
// run for every player, different dates ⇒ (overwhelmingly) different runs. PURE + total (never throws; reads
// NO clock — the date is passed IN at the scene boundary), Phaser-free, node-importable (the verifier pins
// it). An FNV-1a string hash >>> 0; a falsy/empty/junk key still yields a finite unsigned int, falling back
// to 1 (never 0 — a degenerate seed, mirroring GameScene.mintSeed). It is NOT cryptographic (YAGNI — a daily
// seed needs only determinism + distinctness, not unpredictability).
export function dailySeed(dateKey: string): number {
  const s = typeof dateKey === 'string' ? dateKey : String(dateKey ?? '')
  let h = 0x811c9dc5 // FNV-1a 32-bit offset basis.
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) // FNV prime.
  }
  return (h >>> 0) || 1 // unsigned 32-bit; never 0 (1 is a fine fallback for an empty/degenerate key).
}
