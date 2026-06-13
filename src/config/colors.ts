// ── Colour-scaling table (color-scaling-stats design §6, AC1) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs node-imports it under plain node and
// asserts the colour space is well-formed + the scaling math is monotone with an EXACT identity at level 0
// (the §14 sweep). Mirrors the project's other pure config tables (weapons/skills/scrolls): the colour is a
// fixed PROPERTY of a weapon/skill id (its `scaling` tag), and a run tracks a per-colour LEVEL that scales
// ITS items' damage. Dead Cells' signature build lever: a melee sword feeds Brutality, a bow feeds Tactics.
//
// THE THREE COLOURS (Decision 5 — every colour is USED by ≥1 weapon, so the space is not dead config):
//   brutality — RED, melee power (sword/hammer/glaive + the firebomb skill).
//   tactics   — PURPLE, ranged/skill power (bow + the 5 ranged/utility skills).
//   survival  — GREEN, sustain (the spear) — its primary payoff is the flat +max HP per level.
//
// THE SCALING MATH (the identity contract, §12):
//   colorMult(level)     = 1 + max(0, level) × PER_LEVEL          — monotone; colorMult(0) === 1 EXACTLY.
//   survivalHpBonus(lvl) = max(0, lvl) × SURVIVAL_HP_PER_LEVEL    — monotone; survivalHpBonus(0) === 0.
// At all-0 levels every weapon/skill mult is 1 and the survival HP bonus is 0, so a default run plays
// byte-identically to before this slice (the additive identity, AC).

// The three colour ids — a string union (matches SkillKind / weapon `type` style; no runtime enum, Decision 14).
export type ColorId = 'brutality' | 'tactics' | 'survival'

// A colour row: id + display name (the English source of truth; zh override keyed by id) + a HUD tint.
export interface ColorSpec {
  id: ColorId
  name: string
  tint: number // 0xRRGGBB — the HUD pip colour.
}

// The ordered colour ids (for the verifier sweep + the HUD pip row + the picker offers — exactly 3, no shuffle).
export const COLOR_IDS: ColorId[] = ['brutality', 'tactics', 'survival']

// id → row lookup (consumers resolve a colour id back to its name/tint — DRY, one source).
export const COLORS: Record<ColorId, ColorSpec> = {
  brutality: { id: 'brutality', name: 'Brutality', tint: 0xe74c3c }, // red — melee.
  tactics: { id: 'tactics', name: 'Tactics', tint: 0x9b59b6 }, // purple — ranged/skills.
  survival: { id: 'survival', name: 'Survival', tint: 0x2ecc71 }, // green — sustain/HP.
}

// ── Scaling constants (PINNED — the doc is the contract, §2/§3) ──
export const PER_LEVEL = 0.15 // +15% damage per colour level (linear — no diminishing curve, KISS).
export const SURVIVAL_HP_PER_LEVEL = 12 // flat +max HP per Survival level (the sustain payoff, Decision 6).

// ── colorMult(level) → ×damage for an item of this colour at the given run level (§3, identity@0) ──
// 1 + max(0,level) × PER_LEVEL. Monotone non-decreasing; colorMult(0) === 1 EXACTLY (the identity pin —
// load-bearing for byte-identity). A defensive max(0,…) clamps a (never-expected) negative level to 1.
export function colorMult(level: number): number {
  return 1 + Math.max(0, level) * PER_LEVEL
}

// ── survivalHpBonus(level) → flat +max HP from a Survival level (§3, identity@0) ──
// max(0,level) × SURVIVAL_HP_PER_LEVEL. Monotone non-decreasing; survivalHpBonus(0) === 0 (the identity —
// _syncPlayerScrollStats derives the same maxHp as today at level 0). Defensive max(0,…) clamp.
export function survivalHpBonus(level: number): number {
  return Math.max(0, level) * SURVIVAL_HP_PER_LEVEL
}
