// ── Depth→hardness CURVE (design §6.4, Decision 42/45, AC42/AC45) ──
// 100% PURE — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node and re-proves
// monotonicity headlessly (the convention: pure config/generator modules are node-importable). This
// mirrors crowd-runner/config/difficulty.js: ONE source of "how hard is depth N", imported by BOTH
// GameScene (to scale each enemy spawn) AND the verifier (to assert the curve is non-decreasing).
//
// SEPARATION OF CONCERNS (Decision 42, SOLID): a BIOME (config/biomes.js) says WHICH enemies + HOW
// LONG + a base TIER; this CURVE says HOW HARD at a given depth. effectiveDifficulty() stacks the two
// for the verifier's whole-run monotonicity proof (Decision 49).
//
// MONOTONIC BY CONSTRUCTION (AC42): every ramp below has a NON-NEGATIVE slope and any clamp is a
// non-decreasing clamp, so "rises with depth" is structural, not asserted-by-luck — the verifier's
// check is a proof, not a filter (same philosophy as the level generator's reach envelope).

// ── Ramp constants (NAMED + tunable; KISS — linear ramps, clamped so a long run stays sane) ──
// Each "per depth" slope is the fractional increase added for every level cleared. depth is 0-based
// (0 at the first level), so depth 0 yields the BASE (×1) and difficulty climbs from there.
const HP_PER_DEPTH = 0.18 // +18% enemy maxHp per depth (tanks rise steadily but stay killable).
const DMG_PER_DEPTH = 0.1 // +10% enemy damage per depth (hits hurt more the deeper you go).
const SPEED_PER_DEPTH = 0.04 // +4% enemy speed per depth — capped (a too-fast enemy reads badly).
const SPEED_CAP = 1.6 // hard ceiling on the speed multiplier (≈ reached by depth 15; see note).

// enemyCountBonus: add ONE extra enemy every COUNT_EVERY depths (a coarse density ramp, clamped at
// spawn time to the biome's standable surplus — see GameScene._buildLevel). floor() keeps it an int.
const COUNT_EVERY = 2 // +1 enemy every 2 depths cleared.

// SPEED note: SPEED_PER_DEPTH is applied to BOTH patrolSpeed and chaseSpeed (Decision 45 / review
// MINOR). This is INTENTIONAL: a deeper biome's Brute patrols + chases a bit faster, raising pressure
// uniformly. The cap (1.6×) keeps even a deep-run chaser from outrunning the player's dodge/run, and
// patrol stays a readable cruise (70px/s × 1.6 = 112px/s, well below the player's run speed). The
// detect/attack RANGES and the TELEGRAPH window are deliberately NOT scaled (Decision 45 / review
// MINOR): a faster enemy with the SAME telegraph stays dodgeable — readability is preserved at depth.

// ── scaleAtDepth(depth) → a fresh scalar set, each a monotone-non-decreasing ramp (AC42). ──
// Returns a NEW object each call (no shared mutable state) so a caller can't alias-corrupt the curve.
export function scaleAtDepth(depth) {
  const d = Math.max(0, depth | 0)
  return {
    enemyHpMult: 1 + HP_PER_DEPTH * d, // strictly increasing in d.
    enemyDamageMult: 1 + DMG_PER_DEPTH * d, // strictly increasing in d.
    enemySpeedMult: Math.min(SPEED_CAP, 1 + SPEED_PER_DEPTH * d), // non-decreasing (clamped).
    enemyCountBonus: Math.floor(d / COUNT_EVERY), // non-decreasing step function.
  }
}

// ── scaleSpec(baseSpec, scale) → a NEW scaled enemy spec (Decision 45 — NO mutation of baseSpec). ──
// Builds a shallow-cloned spec with maxHp/contactDamage/speeds/swing.damage multiplied by the depth
// scalars. Returning a fresh object per spawn (never mutating the shared BRUTE_SPEC) avoids the
// classic aliasing bug where every later spawn — or a regenerate — compounds the multiplied values.
// Lives HERE (pure) so the verifier can sanity-check a scaled spec's maxHp is ≥ the base (it rises).
export function scaleSpec(baseSpec, scale) {
  return {
    ...baseSpec,
    maxHp: Math.round(baseSpec.maxHp * scale.enemyHpMult),
    contactDamage: Math.round(baseSpec.contactDamage * scale.enemyDamageMult),
    patrolSpeed: baseSpec.patrolSpeed * scale.enemySpeedMult,
    chaseSpeed: baseSpec.chaseSpeed * scale.enemySpeedMult,
    swing: {
      ...baseSpec.swing,
      damage: Math.round(baseSpec.swing.damage * scale.enemyDamageMult),
    },
  }
}

// ── scaleBossSpec(bossSpec, scale) → a NEW depth-scaled boss spec (design §6.6.1, Decision 64/66, AC61
// — review MAJOR: the HONEST boss-scaling fold) ──────────────────────────────────────────────────────
// The enemy scaleSpec above only touches maxHp/contactDamage/speeds/swing.damage — a Boss spec also has
// `phases[]` + per-attack damage (slam.swing.damage, volley.projectile.damage, dash.contactDamage) that
// scaleSpec does NOT see, so reusing it would make "a deeper boss is tankier" scale HP only, leaving its
// ATTACKS at base (the review's MAJOR point). scaleBossSpec is a BOSS-SPECIFIC fold: it scales maxHp +
// contactDamage by the curve AND every attack's damage, returning a fresh deep-cloned spec (NEVER
// mutating the shared BOSSES table — the aliasing bug scaleSpec also avoids). Telegraph/cadence/counts
// are deliberately UNSCALED so a deeper boss is tankier + hits harder but stays EQUALLY readable
// (the dodge-the-telegraph contract holds at depth — same philosophy as the enemy ranges being unscaled).
//
// HONEST VERIFICATION SCOPE (Decision 70, review MAJOR): the verifier's whole-run monotonicity walk reads
// effectiveDifficulty(depth, biome) = biome.tier + the depth curve — it does NOT read boss HP/attack
// tuning, so the boss BALANCE is NOT proven by that walk. What IS proven for the boss is a TABLE
// WELL-FORMEDNESS check (verify-gen.mjs §6: descending phase thresholds, known attack kinds, a non-empty
// pattern per phase). This fold's OUTPUT is also asserted ≥ the base boss HP at depth (a re-tune that
// makes a deeper boss WEAKER fails loudly) — but that is a guardrail, not a winnability proof.
export function scaleBossSpec(bossSpec, scale) {
  // Deep-clone the attack params so scaling never mutates the shared BOSSES table (referential safety).
  const attacks = {}
  for (const [id, atk] of Object.entries(bossSpec.attacks)) {
    const next = { ...atk }
    if (atk.swing) next.swing = { ...atk.swing, damage: Math.round(atk.swing.damage * scale.enemyDamageMult) }
    if (atk.projectile) {
      next.projectile = { ...atk.projectile, damage: Math.round(atk.projectile.damage * scale.enemyDamageMult) }
    }
    if (typeof atk.contactDamage === 'number') next.contactDamage = Math.round(atk.contactDamage * scale.enemyDamageMult)
    attacks[id] = next
  }
  return {
    ...bossSpec,
    maxHp: Math.round(bossSpec.maxHp * scale.enemyHpMult),
    contactDamage: Math.round(bossSpec.contactDamage * scale.enemyDamageMult),
    // phases[] is value-data (thresholds/patterns) — clone the array shallowly so the scaled spec owns it.
    phases: bossSpec.phases.map((p) => ({ ...p, attacks: [...p.attacks] })),
    attacks,
  }
}

// ── TIER_WEIGHT derivation (review MAJOR — an EXPLICIT lower bound + a module-load assertion, not a
// "large enough" magic constant) ────────────────────────────────────────────────────────────────
// effectiveDifficulty(depth, biome) = biome.difficultyTier·TIER_WEIGHT + curveTerm(depth), where
// curveTerm(depth) = enemyHpMult + enemyDamageMult (the two unbounded ramps). For the whole-run
// monotonicity proof (Decision 49) to hold across a BIOME BOUNDARY, the tier jump must never let the
// combined value DIP. In THIS phase depth never resets per biome (RunState.depth is run-global), so
// the curve term is itself non-decreasing across a boundary and the tier (also non-decreasing) only
// ADDS — monotonicity is structural even with TIER_WEIGHT = 0. But to make the property ROBUST to a
// future curve that resets per biome (where the curve term could DROP by at most its full intra-biome
// gain), we derive and PIN a lower bound: TIER_WEIGHT must dominate the maximum the curve term can
// fall at a boundary, i.e. the largest curve term reachable within a run. We bound that by the curve
// term at a generous MAX depth and require a +1 tier step to cover it. This keeps the constant
// principled (not "feels big enough") and a module-load assertion fails LOUDLY if a re-tune breaks it.
const TIER_BOUND_MAX_DEPTH = 100 // a generous run length the bound must cover (far past real runs).
const _curveTerm = (depth) => {
  const s = scaleAtDepth(depth)
  return s.enemyHpMult + s.enemyDamageMult
}
// Lower bound: one tier step (the smallest, +1) must be ≥ the max the curve term could fall at a
// boundary = the full curve term at the deepest depth (the worst-case reset drop). Round UP.
const TIER_WEIGHT_MIN = Math.ceil(_curveTerm(TIER_BOUND_MAX_DEPTH))
export const TIER_WEIGHT = TIER_WEIGHT_MIN // pinned AT the derived bound (KISS — minimal sufficient).

// Module-load assertion (mirrors the LevelGenerator reach-envelope assertions): if a future curve
// re-tune makes TIER_WEIGHT < its derived bound, this throws on import — caught by the verifier's
// node import AND any browser load, so the monotonicity contract can't silently rot.
if (TIER_WEIGHT < TIER_WEIGHT_MIN) {
  throw new Error(
    `difficulty.js: TIER_WEIGHT ${TIER_WEIGHT} < derived lower bound ${TIER_WEIGHT_MIN} — a tier ` +
      `step could no longer dominate the curve term at a biome boundary (monotonicity broken).`,
  )
}

// ── effectiveDifficulty(depth, biome) → ONE scalar stacking the biome tier + the depth curve. ──
// The quantity the verifier proves non-decreasing across the whole run (Decision 49). Because depth
// is run-global (never resets) AND difficultyTier is non-decreasing along BIOME_ORDER, this is
// non-decreasing BY CONSTRUCTION; TIER_WEIGHT (≥ the derived bound) keeps it so even if a later
// re-tune resets the curve per biome.
export function effectiveDifficulty(depth, biome) {
  return biome.difficultyTier * TIER_WEIGHT + _curveTerm(depth)
}
