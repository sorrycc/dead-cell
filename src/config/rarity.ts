// ── Item rarity table (item-rarity-forge design §6, AC1) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs node-imports it under plain node and
// asserts the tier space is well-formed + the rarity math is monotone with an EXACT identity at `common`
// (the byte-identity pin — load-bearing). Mirrors the project's other pure config tables (weapons/colors):
// rarity is a SCALAR tier id carried per weapon slot (on RunState), baked into a FRESH weapon object by a
// pure composing fold (foldRarity, mirroring foldWeaponAffix) — NEVER mutating the shared WEAPONS config.
//
// THE FOUR TIERS (Decision 1/2 — common is the IDENTITY tier, so a default run is byte-identical):
//   common    — WHITE (the current weapon-pickup fill), damageMult 1, NO extra affix. The identity.
//   rare      — CYAN, a small +damage, no affix bump.
//   epic      — MAGENTA/PURPLE, more +damage AND a stronger affix (extraAffix true).
//   legendary — GOLD, the biggest +damage AND a stronger affix.
//
// THE RARITY MATH (the identity contract):
//   foldRarity(w, common|null) === w EXACTLY (same ref — no clone, no damage change).
//   damageMult is monotone non-decreasing along RARITY_IDS and every >= 1 (never-weaken).
// At common (the wire value `null`) every weapon is unfolded, so a fresh run plays byte-identically to
// before this slice (the additive identity, §6).

import type { WeaponSpec } from './weapons.js'

// The four rarity tier ids — a string union (matches ColorId / weapon `type` style; no runtime enum).
export type RarityId = 'common' | 'rare' | 'epic' | 'legendary'

// A rarity tier row: id + display name (the English source of truth; zh override keyed by id) + a tint (the
// pickup/HUD colour), a damage mult (folded onto every swing + the projectile), an extra-affix flag (Decision 4
// — a stronger affix on high tiers), and a roll weight (the base weighted-pick weight before the depth bias).
export interface RaritySpec {
  id: RarityId
  name: string
  tint: number // 0xRRGGBB — the pickup fill/stroke + the (optional) HUD label tint.
  damageMult: number // ×damage on every swing row AND the projectile (>= 1; monotone — never weakens).
  extraAffix: boolean // true ⇒ this tier also STRENGTHENS the rolled affix (Decision 4 — the power bump).
  weight: number // base weighted-pick weight (the higher tiers are scaled UP with depth — see rollRarityId).
}

// The ordered rarity ids (lowest→highest — the verifier pins this exact order + length 4). common is index 0.
export const RARITY_IDS: RarityId[] = ['common', 'rare', 'epic', 'legendary']

// id → row lookup (consumers resolve a rarity id back to its name/tint/mult — DRY, one source). PINNED data
// (the design doc + the verifier are the contract — exactly as config/colors.ts pins PER_LEVEL).
export const RARITIES: Record<RarityId, RaritySpec> = {
  // common is the IDENTITY tier: damageMult 1, extraAffix false, tint = the CURRENT white weapon-pickup fill.
  common: { id: 'common', name: 'Common', tint: 0xecf0f1, damageMult: 1, extraAffix: false, weight: 70 },
  rare: { id: 'rare', name: 'Rare', tint: 0x4dd0e1, damageMult: 1.08, extraAffix: false, weight: 22 }, // cyan.
  epic: { id: 'epic', name: 'Epic', tint: 0xc26bff, damageMult: 1.18, extraAffix: true, weight: 7 }, // magenta/purple.
  legendary: { id: 'legendary', name: 'Legendary', tint: 0xf1c40f, damageMult: 1.32, extraAffix: true, weight: 1 }, // gold.
}

// ── Pinned constants (the doc is the contract, §2/§3/Decision 10) ──
// DEPTH_BIAS: each non-common tier's weight is scaled by (1 + depth × DEPTH_BIAS) so deeper levels roll
// higher rarity more often (common still the most likely tier at low depth). A small linear bias (KISS).
export const DEPTH_BIAS = 0.06
// EXTRA_AFFIX_POWER: an extraAffix tier (epic/legendary) multiplies the rolled affix's OWN contribution by
// this (Decision 4 — the "stronger affix" power bump, passed as foldWeaponAffix's optional powerMult). > 1.
export const EXTRA_AFFIX_POWER = 1.25

// ── rollRarityId(rng, depth) → a RarityId (PURE — takes a () => number RNG + the run depth) ──
// Biases toward higher rarity at deeper depth by scaling each NON-common tier's weight UP with depth (×
// (1 + depth × DEPTH_BIAS)), then does the standard weighted pick (the SAME idiom as _rollWeaponAffix /
// ELITE_AFFIXES — DRY). At depth 0 it can still return 'common' (and common is the most likely tier early
// on). Deterministic given the RNG + depth. May return 'common' — the placement code maps it to `null`.
export function rollRarityId(rng: () => number, depth = 0): RarityId {
  const d = Math.max(0, depth)
  let total = 0
  const weights = RARITY_IDS.map((id) => {
    const tier = RARITIES[id]
    // common keeps its flat weight; the rarer tiers grow with depth (the depth bias).
    const w = id === 'common' ? tier.weight : tier.weight * (1 + d * DEPTH_BIAS)
    total += w
    return w
  })
  let r = rng() * total
  for (let i = 0; i < RARITY_IDS.length; i++) {
    r -= weights[i]
    if (r <= 0) return RARITY_IDS[i]
  }
  return RARITY_IDS[RARITY_IDS.length - 1] // float-rounding fallthrough → the rarest tier (vanishingly rare).
}

// ── foldRarity(weapon, tier) → a NEW rarity-stamped weapon (PURE; mirrors foldWeaponAffix, Decision 3/5) ──
// Given an ALREADY-affixed (or plain) weapon and a RaritySpec (or null), bake the rarity's flat damage mult
// onto a FRESH weapon object + stamp the rarity metadata. The aliasing safety every fold keeps: deep-clone
// the swings rows + projectile so the input weapon (and the shared WEAPONS config) is NEVER mutated.
//   tier == null OR tier.id === 'common' ⇒ return the weapon UNCHANGED (same ref — the byte-identity guarantee).
//   otherwise ⇒ a NEW object with every swing.damage (+ the ranged projectile.damage) × tier.damageMult
//   (rounded once), plus rarityId/rarityName stamped (the HUD reads them). damageMult >= 1 → never weakens.
// foldRarity does NOT touch the affix — the affix POWER bump (Decision 4) is applied UPSTREAM via
// foldWeaponAffix's powerMult, so foldRarity stays purely about the rarity damage mult + the metadata (SRP).
export function foldRarity(weapon: WeaponSpec, tier: RaritySpec | null | undefined): WeaponSpec {
  if (!tier || tier.id === 'common') return weapon // common/null → the unfolded weapon (the identity, no clone).
  const dMult = tier.damageMult
  // Deep-clone each swing row with the rarity damage mult applied (rounded to a whole hp — resolveHit
  // re-rounds anyway, but keep the table clean, mirroring foldWeaponAffix).
  const swings = weapon.swings.map((s) => ({ ...s, damage: Math.round(s.damage * dMult) }))
  const folded: WeaponSpec & { rarityId: RarityId; rarityName: string } = {
    // The `...weapon` spread carries id/name/type/scaling/moveset/status + the affix metadata baked upstream
    // (foldRarity composes ON TOP of an already-affixed weapon — Decision 5, fold order affix-then-rarity).
    ...weapon,
    swings,
    rarityId: tier.id,
    rarityName: tier.name, // optional HUD convenience (the label resolves the i18n name from the id anyway).
  }
  // Ranged: scale the projectile damage by the same mult (a fresh projectile object — no mutation).
  if (weapon.type === 'ranged' && weapon.projectile) {
    folded.projectile = { ...weapon.projectile, damage: Math.round(weapon.projectile.damage * dMult) }
  }
  return folded
}
