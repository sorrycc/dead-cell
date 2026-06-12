// ── Headless determinism verifier (design §6.0/§8, AC7) ──
// Run by `npm run verify` under plain node — no Phaser, no browser. It imports the EXACT
// mulberry32 the game runs (src/util/rng.js is pure) and asserts the determinism contract
// the procedural foundation depends on. Phase 2 GROWS this to import the real biome
// generator and assert solvability/structure; Phase 0 already ships a real, PASSING check.
//
// Two assertions:
//   1. Determinism — two fresh generators from the same seed produce identical sequences.
//   2. Regression pin — the first K outputs for a fixed seed match a KNOWN-GOOD vector.
//
// The pin below was COMPUTED from the verbatim mulberry32 (not hand-invented): it is the
// literal output of mulberry32(0x1234abcd) for the first 5 draws. If rng.js ever changes
// algorithm, this vector fails loudly — which is exactly the point. Regenerate it by
// running the same function; never edit it to make a failing test pass.

import { mulberry32 } from '../src/util/rng.js'

const SEED = 0x1234abcd
const K = 5

// Pinned reference vector: mulberry32(0x1234abcd) → first 5 outputs.
const EXPECTED = [
  0.10277144517749548,
  0.5144855019170791,
  0.07858735416084528,
  0.6312816452700645,
  0.978210358414799,
]

function fail(msg) {
  console.error(`verify-gen FAILED: ${msg}`)
  process.exit(1)
}

// ── 1) Determinism: same seed → identical sequence ──
const a = mulberry32(SEED)
const b = mulberry32(SEED)
for (let i = 0; i < K; i++) {
  const va = a()
  const vb = b()
  if (va !== vb) {
    fail(`determinism: draw ${i} differs (${va} !== ${vb})`)
  }
}

// ── 2) Regression pin: fixed seed → known vector ──
const r = mulberry32(SEED)
for (let i = 0; i < K; i++) {
  const v = r()
  if (v !== EXPECTED[i]) {
    fail(`regression pin: draw ${i} = ${v}, expected ${EXPECTED[i]}`)
  }
}

console.log(`verify-gen OK: mulberry32 deterministic + pinned (seed 0x${SEED.toString(16)}, ${K} draws)`)
process.exit(0)
