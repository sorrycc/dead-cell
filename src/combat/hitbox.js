// ── Swing geometry + tuning (design §6.3 + §6.5, Decisions 16/18/20/28 + 61, AC20/AC54) ──
// 100% PURE module — NO Phaser import — so it is headlessly importable under plain node
// (scripts/verify-gen.mjs asserts swing geometry without a browser). This is the resolution of
// review MAJOR #28: the prior single `hitbox.js` mixed pure math with a Phaser-coupled pool, which
// contradicted the project's "pure generator/config" convention. The pool lives in combat/
// HitboxPool.js (Phaser-coupled); ONLY the math lives here.
//
// SWING-TABLE MIGRATION (§6.5, Decision 61): the per-swing TUNING TABLE moved to config/weapons.js
// (a weapon IS a swing table + a type). The light 3-hit combo is now the SWORD's `swings`. To keep
// every existing import working unchanged (HitboxPool/Player/the verifier all import `SWINGS`/
// `COMBO_LEN` from here), this module RE-EXPORTS the SWORD's table as `SWINGS` (DRY — one source, the
// sword keeps the Phase-4 feel byte-for-byte). The Player no longer reads the module-level COMBO_LEN
// for its combo wrap — it reads `equippedWeapon.swings.length` (Decision 61) — but COMBO_LEN stays
// exported for the verifier's `COMBO_LEN === SWINGS.length` pin and any back-compat reader.
//
// What this owns now:
//   • SWINGS / COMBO_LEN — re-exports of the SWORD's swing table (back-compat; the SWORD is the default).
//   • swingRect(attacker, swing) — the world-space AABB of a swing placed in FRONT of the attacker by
//     its facing. A stateless function of data both the Player and the Enemy already expose
//     (center x/y + facing), reused by player→enemy AND enemy→player AND every weapon's swing (DRY).

import { SWORD } from '../config/weapons.js'

// The SWORD's swing table re-exported under the historic name so existing imports don't break. The
// per-swing field schema is documented on config/weapons.js (the new owner of the tuning data).
export const SWINGS = SWORD.swings

// Number of swings in the SWORD chain (derived — the verifier pins COMBO_LEN === SWINGS.length).
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
