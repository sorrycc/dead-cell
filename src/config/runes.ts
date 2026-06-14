// ── RUNE catalog (F8 traversal-runes design §4, Decision 1) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs node-imports it (the convention every
// config table follows). This is the SINGLE source of all rune ids the Hub LISTS, the in-run drop PICKS A
// LOCKED ONE FROM, the biome graph's `requiresRune` gates REFERENCE, and the treasure door's `requiredRuneId`
// resolves. It mirrors config/blueprints.ts in SHAPE (id/name/desc + a by-id lookup + an ordered id list) but
// its EFFECT is independent: a rune unlocks WORLD content (an extra map branch + an in-level treasure door),
// never a run-POOL row.
//
// DISTINCT FROM A BLUEPRINT (do not confuse them — Decision 9): a blueprint unlocks a seeded run-POOL row (a
// new weapon/skill/mutation enters the draw → it changes your character build options, and MUST be
// blueprint-gated so the §2/§13 determinism pins hold). A RUNE feeds NO seeded run pool — it touches NO
// runWeaponPool/runSkillPool/runMutationPool — so it is EXEMPT from the pool-pin contract by construction:
// adding runes cannot perturb runWeaponPool(new Set()) etc. The verifier asserts rune ids are DISJOINT from
// blueprint ids (they live in separate banked Sets — no collision).

// One rune catalog entry. The Hub lists it (name · UNLOCKED/LOCKED · desc); the in-run drop picks a locked one.
export interface RuneEntry {
  id: string // the stable rune id (carried on Meta/Run state; referenced by biomes.ts `requiresRune` + the door).
  name: string // the human label the Hub shows (en source; the zh override is keyed by id in zh-CN.ts).
  desc: string // a one-line Hub summary of what owning this rune opens (how it's earned is a separate Hub note).
}

// ── RUNES (the catalog) ── two runes ship this slice — ONE per rune-gated EXTRA Sewers sibling (Decision 1),
// so a run-to-run player can widen the Sewers fork from 1 → 2 → 3 routes. Each id is referenced by exactly one
// `requiresRune` value in config/biomes.ts (verifier-asserted both ways — no orphan tag, no orphan entry). The
// names are programmer-art flavour; the *id* is the stable contract.
export const RUNES: RuneEntry[] = [
  { id: 'rune_vine', name: 'Vine Rune', desc: 'Opens the Ossuary branch + grappled treasure doors.' },
  { id: 'rune_frost', name: 'Frost Rune', desc: 'Opens the Frostworks branch + frozen treasure doors.' },
]

// id → entry lookup (the Hub resolves an id, the door resolves its required id — DRY, one source).
export const RUNES_BY_ID: Record<string, RuneEntry> = Object.fromEntries(RUNES.map((r) => [r.id, r]))

// The ordered ids (for list rendering, the deterministic door-rune pick, + the verifier sweep).
export const RUNE_IDS: string[] = RUNES.map((r) => r.id)

// ── RUNE_PICKUP_CHANCE (Decision 8) ── the per-NORMAL-level chance to drop ONE locked rune. RARE (a rune is a
// permanent meta unlock — the carrot is sparse), well below 1 (the verifier asserts ∈ (0, 1)). Mirrors the
// blueprint-drop rate. Off a DISTINCT off-pin RNG mix so it never perturbs the level pin.
export const RUNE_PICKUP_CHANCE = 0.16

// ── TREASURE_DOOR_CHANCE (Decision 5) ── the per-NORMAL-level chance to place ONE locked treasure door. RARE
// (like the cursed chest), well below 1 (the verifier asserts ∈ (0, 1)). A rune-less run still hits a locked
// door it can't open (no loot, no penalty — pure additive content); the loot only fires for a rune-owner.
export const TREASURE_DOOR_CHANCE = 0.14
