// ── Boss-Cell TIER table (meta-progression design §6.1, Decision 1/2, AC1) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs node-imports it and re-proves its
// monotonicity headlessly (the convention every config table follows: a Phaser-coupled module throws under
// node). Mirrors config/difficulty.js's "pure, node-importable, monotone BY CONSTRUCTION" discipline.
//
// WHAT A TIER IS (Decision 1, KISS/YAGNI): a Boss Cell is NOT new content — it is a GLOBAL SCALAR on the
// EXISTING difficulty curve (config/difficulty.js scaleAtDepth). A tier carries:
//   bossCellMult    — ×the per-depth HP/damage/speed-pre-cap/count ramps (>= 1; monotone non-decreasing).
//                     === 1 on tier 0 ⇒ the curve is byte-unchanged ⇒ the round-1 game exactly (the identity).
//   flaskDelta      — +/- the run's starting flask charges (<= 0 at higher tiers — the genre's "Boss Cells
//                     reduce healing"; monotone non-increasing — a deeper tier never gives MORE flasks). The
//                     run-seed site clamps the resulting maxFlasks to a >= 1 floor (Decision 4) so a run is
//                     never unwinnable (zero heals on a long descent is degenerate, not difficulty).
//   eliteChanceMult — ×the elite-affix roll chance (Decision 8; >= 1; monotone non-decreasing). 1 on the
//                     shipped MVP tiers (identity-neutral) — wired but neutral, so a later balance pass can
//                     turn it on per-tier with zero engine change.
//
// MONOTONE BY CONSTRUCTION (AC1): bossCellMult/eliteChanceMult rise (or hold), flaskDelta falls (or holds),
// across the index — so "a higher tier is never EASIER" is structural, asserted at module load (below) AND
// swept by the verifier (verify-gen.mjs §5). Because bossCellMult >= 1 multiplies an already non-decreasing
// depth ramp, the whole-run difficulty stays monotone at EVERY tier (AC3) — no parallel system to reconcile.

// A single Boss-Cell tier row (the verifier sweeps every field's contract — verify-gen.mjs §5).
export interface BossCellTier {
  index: number // 0-based tier index (0 = the identity / round-1 difficulty). === array position.
  name: string // human label the Hub shows (e.g. '0 Boss Cells', '1 Boss Cell').
  bossCellMult: number // ×scaleAtDepth ramps (HP/damage/speed-pre-cap/count). >= 1; monotone non-decreasing.
  flaskDelta: number // +/- starting flask charges. <= 0 at higher tiers; monotone non-increasing.
  eliteChanceMult: number // ×elite-affix roll chance (Decision 8). >= 1; monotone non-decreasing. 1 on MVP tiers.
  desc: string // a one-line Hub summary of what this tier changes.
}

// ── BOSS_CELL_TIERS ── the ordered tier table. Tier 0 is the EXACT identity row; each deeper tier lifts the
// curve globally (tankier/denser enemies) and trims a flask. The shipped table is sane by construction: the
// deepest tier's flaskDelta keeps BASE_PLAYER_STATS.maxFlasks (2) + flaskDelta >= 1 (verifier-asserted §5).
export const BOSS_CELL_TIERS: BossCellTier[] = [
  { index: 0, name: '0 Boss Cells', bossCellMult: 1.0, flaskDelta: 0, eliteChanceMult: 1, desc: 'Base difficulty.' },
  { index: 1, name: '1 Boss Cell', bossCellMult: 1.25, flaskDelta: -1, eliteChanceMult: 1, desc: 'Tougher, denser enemies; one fewer flask.' },
  { index: 2, name: '2 Boss Cells', bossCellMult: 1.55, flaskDelta: -1, eliteChanceMult: 1, desc: 'Far tougher; one fewer flask.' },
  // ── F7 endgame rows (indices 3/4/5) ── the curve keeps lifting (bossCellMult continues the 1.0/1.25/1.55
  // slope) AND the elite ramp finally turns on (eliteChanceMult > 1) so a deep run is visibly DENSER with
  // elites, not merely tankier. flaskDelta is HELD at -1 (NOT -2): the §13b flask-floor sweep requires
  // BASE_PLAYER_STATS.maxFlasks (2) + deepest flaskDelta >= 1, so -1 is the deepest sweep-safe delta — the
  // extra bite comes from bossCellMult + the elite ramp, never from removing the last heal (degenerate).
  { index: 3, name: '3 Boss Cells', bossCellMult: 1.85, flaskDelta: -1, eliteChanceMult: 1.5, desc: 'Brutal; far denser elites; one fewer flask.' },
  { index: 4, name: '4 Boss Cells', bossCellMult: 2.2, flaskDelta: -1, eliteChanceMult: 2.0, desc: 'Punishing; elites everywhere; one fewer flask.' },
  { index: 5, name: '5 Boss Cells', bossCellMult: 2.6, flaskDelta: -1, eliteChanceMult: 2.5, desc: 'The deepest descent; relentless elites; one fewer flask.' },
]

// The deepest unlockable tier index (index === array position, so this is the last index).
export const MAX_TIER = BOSS_CELL_TIERS.length - 1

// Index-keyed view — index === array position (asserted at module load below), so this IS the array. Kept as
// a named export for the Hub/MetaState to read "the row at index i" without re-deriving the relationship.
export const TIERS_BY_INDEX = BOSS_CELL_TIERS

// ── tierAt(index) → the tier row, CLAMPED into [0, MAX_TIER] (Decision 5 — a corrupt index degrades) ──
// A stored selectedTier > unlockedTier, a negative, or a non-integer never throws — it returns a valid row
// so the run/Hub keep working (graceful, mirroring loadMeta's defensive spread).
export function tierAt(index: number): BossCellTier {
  return BOSS_CELL_TIERS[Math.max(0, Math.min(index | 0, MAX_TIER))]
}

// ── Module-load assertions (mirrors difficulty.js's TIER_WEIGHT assertion) ── if a re-tune breaks the tier
// contract this throws on import — caught by the verifier's node import AND any browser load, so the
// monotonicity contract can't silently rot. (i) index === position; (ii) tier 0 is the EXACT identity;
// (iii) bossCellMult monotone non-decreasing + every >= 1; (iv) flaskDelta monotone non-increasing;
// (v) eliteChanceMult monotone non-decreasing + every >= 1.
for (let i = 0; i < BOSS_CELL_TIERS.length; i++) {
  const t = BOSS_CELL_TIERS[i]
  if (t.index !== i) throw new Error(`tiers.js: BOSS_CELL_TIERS[${i}].index ${t.index} !== position ${i}`)
  if (!(t.bossCellMult >= 1)) throw new Error(`tiers.js: tier ${i} bossCellMult ${t.bossCellMult} < 1 (a tier never weakens the curve)`)
  if (!(t.eliteChanceMult >= 1)) throw new Error(`tiers.js: tier ${i} eliteChanceMult ${t.eliteChanceMult} < 1`)
  if (i > 0) {
    const p = BOSS_CELL_TIERS[i - 1]
    if (t.bossCellMult < p.bossCellMult) throw new Error(`tiers.js: bossCellMult dipped at tier ${i} (${t.bossCellMult} < ${p.bossCellMult})`)
    if (t.flaskDelta > p.flaskDelta) throw new Error(`tiers.js: flaskDelta rose at tier ${i} (${t.flaskDelta} > ${p.flaskDelta}) — a deeper tier must never give MORE flasks`)
    if (t.eliteChanceMult < p.eliteChanceMult) throw new Error(`tiers.js: eliteChanceMult dipped at tier ${i} (${t.eliteChanceMult} < ${p.eliteChanceMult})`)
  }
}
const _t0 = BOSS_CELL_TIERS[0]
if (!(_t0.bossCellMult === 1 && _t0.flaskDelta === 0 && _t0.eliteChanceMult === 1)) {
  throw new Error(`tiers.js: tier 0 must be the EXACT identity (bossCellMult 1, flaskDelta 0, eliteChanceMult 1)`)
}
