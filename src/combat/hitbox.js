// ── Swing geometry + tuning (design §6.3, Decisions 16/18/20/28, AC20) ──
// 100% PURE module — NO Phaser import — so it is headlessly importable under plain node
// (scripts/verify-gen.mjs may grow to assert swing geometry without a browser). This is the
// resolution of review MAJOR #28: the prior single `hitbox.js` mixed pure math with a
// Phaser-coupled pool, which contradicted the project's "pure generator/config" convention.
// The pool now lives in combat/HitboxPool.js (Phaser-coupled); ONLY the math lives here.
//
// What this owns:
//   • SWINGS — the per-swing tuning table for the 2–3 hit light combo (Decision 18). Each row
//     is one swing in the chain; the table IS the combo (KISS — a combo is "which row am I on").
//   • swingRect(attacker, swing) — the world-space AABB of a swing placed in FRONT of the
//     attacker by its facing. A stateless function of data both the Player and the Enemy already
//     expose (center x/y + facing), so it is reused by player→enemy AND enemy→player (DRY).

// ── The light combo (Decision 18, AC20) ──
// THREE swings: two quick jabs then a heavier finisher. Each row is self-contained tuning so the
// whole combo reads as a table you can re-balance in one place. All times are SECONDS (the dt
// boundary contract, §6.1/§6.3) and all distances are world pixels.
//
// Per-swing fields:
//   reach        px  — how far in FRONT of the attacker the hitbox extends (its width).
//   halfHeight   px  — half the hitbox's vertical extent (centered on the attacker).
//   forward      px  — how far the hitbox's NEAR edge sits ahead of the attacker center
//                      (a small standoff so the box reads as "in front", not "inside").
//   damage       hp  — base damage subtracted from the victim (before backstab crit).
//   knockback    px/s— horizontal impulse magnitude away from the attacker (damage.js signs it).
//   active       s   — how long the hitbox is LIVE (can register overlaps) for this swing.
//   recovery     s   — committed recovery AFTER active before the next swing/attack is allowed.
//   comboWindow  s   — after the swing ends, how long a follow-up press still chains (else reset).
//   lunge        px/s— a one-shot forward velocity nudge applied at swing start (finisher = big).
export const SWINGS = [
  // Swing 1 — quick jab. Short reach, low commit, generous chain window.
  { reach: 46, halfHeight: 26, forward: 18, damage: 8, knockback: 220, active: 0.08, recovery: 0.12, comboWindow: 0.34, lunge: 80 },
  // Swing 2 — second jab. Slightly more reach + damage, still snappy.
  { reach: 52, halfHeight: 28, forward: 20, damage: 10, knockback: 280, active: 0.09, recovery: 0.14, comboWindow: 0.34, lunge: 110 },
  // Swing 3 — FINISHER. Bigger box, harder hit + knockback, heavier commit, longer pre-lunge.
  { reach: 64, halfHeight: 32, forward: 22, damage: 16, knockback: 460, active: 0.11, recovery: 0.22, comboWindow: 0.0, lunge: 230 },
]

// Number of swings in the chain (derived — never hand-typed, so the table is the single source).
export const COMBO_LEN = SWINGS.length

// ── swingRect(attacker, swing) → { x, y, w, h } ──
// PURE. Returns the CENTER (x,y) + size (w,h) of the swing's AABB, placed in front of the
// attacker along its facing. `attacker` only needs { cx, cy, facing } where cx/cy are the body
// CENTER (the collider's body.center) and facing ∈ {-1,+1}. The caller (HitboxPool.acquire)
// stamps these onto a pooled Arcade body. No Phaser here — testable with plain objects.
//
// Geometry: the box width is `reach`; its near edge sits `forward` px ahead of the attacker
// center along facing, so its CENTER is `forward + reach/2` px ahead. Vertically it is centered
// on the attacker with half-extent `halfHeight`.
export function swingRect(attacker, swing) {
  const w = swing.reach
  const h = swing.halfHeight * 2
  const cx = attacker.cx + attacker.facing * (swing.forward + w / 2)
  const cy = attacker.cy
  return { x: cx, y: cy, w, h }
}
