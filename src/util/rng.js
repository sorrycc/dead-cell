// Deterministic, seedable PRNG (mulberry32). A fresh instance from the same seed always
// yields the same sequence — the determinism foundation for ALL procedural generation
// (design Decision 5, §6.0, AC7/AC12). The ALGORITHM is byte-identical to the sibling
// crowd-runner's src/util/rng.js so seeds are cross-compatible and scripts/verify-gen.mjs
// can pin exact output sequences; only this comment is adapted to reference this doc.
export function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Convenience: random float in [min, max) from a generator.
export function range(rng, min, max) {
  return min + (max - min) * rng()
}
