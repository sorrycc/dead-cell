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
// Combat-phase PURE modules (design §6.3, Decision 28): these import NO Phaser, so a successful
// import here PROVES the purity convention (a Phaser-coupled module would throw under plain node).
import { SWINGS, COMBO_LEN, swingRect } from '../src/combat/hitbox.js'
import { resolveHit } from '../src/combat/damage.js'

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

// ── 3) Combat-phase PURE modules — purity + geometry/damage contracts (design §6.3, Decision 28) ──
// The fact that the imports at the top of this file SUCCEEDED already proves hitbox.js + damage.js
// are headlessly importable (no Phaser). These assertions pin their pure behavior so a regression
// (e.g. someone re-couples them to Phaser, or breaks the backstab predicate) fails loudly in CI.

// 3a) swingRect places the box in FRONT of the attacker by facing, with the table's width.
{
  const s = SWINGS[0]
  const right = swingRect({ cx: 100, cy: 50, facing: 1 }, s)
  const left = swingRect({ cx: 100, cy: 50, facing: -1 }, s)
  const expectedCx = 100 + (s.forward + s.reach / 2)
  if (right.x !== expectedCx) fail(`swingRect facing+1 x=${right.x}, expected ${expectedCx}`)
  if (left.x !== 200 - expectedCx) fail(`swingRect facing-1 x=${left.x}, expected ${200 - expectedCx}`)
  if (right.w !== s.reach || right.h !== s.halfHeight * 2) fail('swingRect size mismatch')
  if (COMBO_LEN !== SWINGS.length) fail(`COMBO_LEN=${COMBO_LEN} != SWINGS.length=${SWINGS.length}`)
}

// 3b) Backstab predicate (Decision 19): a hit from the side the victim is NOT facing crits; a hit
// from the side it IS facing does not; the allowBackstab=false flag gates the crit OFF entirely.
{
  const finisher = SWINGS[2]
  // Attacker at x=0, victim at x=50 facing RIGHT (+1) → attacker is on the victim's BACK → backstab.
  const back = resolveHit({ cx: 0, facing: 1 }, { cx: 50, facing: 1 }, finisher, { allowBackstab: true })
  if (!back.isBackstab) fail('backstab geometry should crit')
  if (back.damage !== finisher.damage * 2) fail(`backstab damage=${back.damage}, expected ${finisher.damage * 2}`)
  // Same geometry but victim facing LEFT (−1) toward the attacker → FRONTAL → no crit.
  const front = resolveHit({ cx: 0, facing: 1 }, { cx: 50, facing: -1 }, finisher, { allowBackstab: true })
  if (front.isBackstab) fail('frontal hit must not crit')
  if (front.damage !== finisher.damage) fail(`frontal damage=${front.damage}, expected ${finisher.damage}`)
  // Knockback is AWAY from the attacker (victim to the right → +x shove).
  if (front.knockbackX <= 0) fail('frontal knockback should push victim away (+x)')
  // Crit OFF (enemy→player fairness, Decision 19): backstab geometry but no crit applied.
  const off = resolveHit({ cx: 0, facing: 1 }, { cx: 50, facing: 1 }, finisher, { allowBackstab: false })
  if (off.isBackstab || off.damage !== finisher.damage) fail('allowBackstab=false must disable the crit')
}

console.log(
  `verify-gen OK: mulberry32 deterministic + pinned (seed 0x${SEED.toString(16)}, ${K} draws); ` +
    `combat hitbox.js + damage.js pure-importable + geometry/backstab contracts pinned`,
)
process.exit(0)
