// ── Cursed-chest config (cursed-chests design §6, AC1, Decision 4/7/8/10) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs node-imports it under plain node and
// asserts the curse is well-formed + the curse-damage math is monotone with an EXACT identity at 0 stacks
// (the byte-identity pin — load-bearing). Mirrors the project's other pure config tables (rarity/colors):
// the curse is a SCALAR stack count carried on RunState (runState.curseStacks); the damage-taken factor is
// computed by a PURE fold (effectiveCurseMult) folded into GameScene._hurtPlayer exactly where the per-room
// roomDamageTakenMult already is — NEVER mutating the shared config.
//
// WHAT A CURSED CHEST IS (genre): a rare E-to-open interactable. Opening it grants GUARANTEED strong loot,
// but applies a curse — you take greatly amplified damage until you KILL `killsToClear` enemies (each kill
// peels one stack). You can always walk past it: the curse is a deliberate risk/reward CHOICE, not forced.
//
// THE CURSE MATH (the identity contract, §6 / Decision 4):
//   effectiveCurseMult(0) === 1 EXACTLY (no curse → the byte-identity factor; _hurtPlayer is unchanged).
//   effectiveCurseMult(stacks <= 0) === 1 (clamp at/below 0 → the no-curse baseline).
//   effectiveCurseMult(stacks > 0) === CURSE.damageMult (a FLAT amplified factor while ANY stack remains —
//     KISS; the "kill N to clear" is the stack COUNT, not a per-stack ramp). Always >= 1 (never-weaken: a
//     curse only ever makes you take MORE damage than baseline, never less).
// A fresh run never opens a chest → curseStacks stays 0 → effectiveCurseMult(0) === 1 → byte-identical.

import { RARITIES } from './rarity.js'
import type { RarityId } from './rarity.js'

// The pinned curse parameters (the doc + the verifier are the contract — as config/rarity.ts pins its data).
export interface CurseConfig {
  killsToClear: number // how many enemy kills clear the curse (a positive INTEGER — the verifier pins this).
  damageMult: number // ×damage-taken while ANY stack remains (>= 1 — "greatly amplified", Decision 4).
}

// CURSE — the single pinned curse config. killsToClear 4 (a few kills to break it), damageMult 3 ("greatly
// amplified damage", NOT a literal one-shot — Decision 4: it reuses the EXACT _hurtPlayer mult math the
// cursed ROOM uses, is monotone-sweepable, and survives a chip tick without a feel-bad instant death).
export const CURSE: CurseConfig = {
  killsToClear: 4,
  damageMult: 3,
}

// ── Guaranteed loot tier + gold (Decision 7) ── opening a chest grants GUARANTEED strong loot: one of two
// outcomes rolled deterministically off the chest's placement seed — a high-rarity affixed weapon at
// LOOT_RARITY (the F2 rarity fold supplies the punch), OR a colour scroll + LOOT_GOLD gold. LOOT_RARITY must
// be a NON-common (guaranteed STRONG) tier; LOOT_GOLD > 0 (the verifier asserts both).
export const LOOT_RARITY: RarityId = 'epic' // the guaranteed high tier the chest weapon rolls at.
export const LOOT_GOLD = 40 // gold granted alongside the scroll (the non-weapon outcome).

// ── CURSED_CHEST_CHANCE (Decision 8/10) ── the per-NORMAL-level placement chance. RARE (the carrot is rare,
// like the genre). Rolled off a fresh mulberry32 with a DISTINCT mix constant (off the generator's pinned
// draw — the level pin stays intact, mirroring _maybePlaceShop). Pinned here as pure config (verifier-swept).
export const CURSED_CHEST_CHANCE = 0.12

// ── effectiveCurseMult(stacks) → the multiplicative damage-taken factor for the current stack count (PURE) ──
// stacks <= 0 ⇒ 1 EXACTLY (the no-curse identity); stacks > 0 ⇒ CURSE.damageMult (the flat amplified factor).
// Always >= 1 (never-weaken). Folded into _hurtPlayer next to roomDamageTakenMult; composes multiplicatively.
export function effectiveCurseMult(stacks: number): number {
  return stacks > 0 ? CURSE.damageMult : 1
}

// Defensive lookup re-export so the verifier (and any consumer) can resolve LOOT_RARITY's row in lockstep
// with the rarity table (a typo'd LOOT_RARITY would have no RARITIES entry — the verifier fails loudly).
export const LOOT_RARITY_SPEC = RARITIES[LOOT_RARITY]
