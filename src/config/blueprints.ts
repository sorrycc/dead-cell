// ── BLUEPRINT catalog (meta-progression design §6.5, Decision 6, AC6/AC9/AC10) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs node-imports it (the convention every
// config table follows). This is the SINGLE source of all blueprint ids the Hub LISTS and the in-run drop
// PICKS A LOCKED ONE FROM. It lives in its OWN module (not in weapons/skills/mutations) so the three pool
// tables stay independent (no circular import) and the Hub/drop read ONE list (DRY).
//
// WHAT A BLUEPRINT IS (Decision 6/7): a permanent RUN-POOL unlock, banked at run end like a Cell. The three
// run pools (weapons/skills/mutations) each tag a SMALL set of NEW rows (added this slice) with a blueprint
// id; the run draws starters ∪ the unlocked blueprints' rows (the pure resolvers in each table). The IDENTITY
// contract (Decision 6, AC11): every CURRENT pool row is a STARTER (untagged) — so a default save's run pool
// === the pre-slice tables exactly. Blueprints gate ONLY the new rows below, which are dead config until banked.
//
// Each catalog entry's `id` MUST match exactly one tagged pool row's `blueprint` tag, and its `kind` MUST be
// the table the tag lives in (weapon→config/weapons.js, skill→config/skills.js, mutation→config/mutations.js).
// The verifier asserts this catalog ↔ table-tags consistency both ways (no orphan tag, no orphan catalog
// entry) so a typo'd id fails loudly under node (verify-gen.mjs §5).

// The blueprint kind — WHICH run pool the unlocked row joins (the table its tag lives in).
export type BlueprintKind = 'weapon' | 'skill' | 'mutation'

// One blueprint catalog entry. The Hub lists it (name · kind · UNLOCKED/LOCKED); the drop picks a locked one.
export interface BlueprintEntry {
  id: string // the stable blueprint id (=== the matching pool row's `blueprint` tag; carried on RunState/MetaState).
  name: string // the human label the Hub shows.
  kind: BlueprintKind // which run pool the unlocked row joins (the table the tag lives in).
  desc: string // a one-line Hub summary of what unlocking this adds.
}

// ── BLUEPRINTS (the catalog) ── one entry per NEW blueprint-gated row shipped this slice: a new weapon, a
// new skill, a new mutation. Ids match the table tags exactly (verifier-asserted). Banking any of these (in a
// run) permanently joins its row to the matching run pool for FUTURE runs (the genre's run-to-run widening).
export const BLUEPRINTS: BlueprintEntry[] = [
  { id: 'bp_weapon_glaive', name: 'Glaive', kind: 'weapon', desc: 'A spinning reach weapon for the pool.' },
  { id: 'bp_skill_shockwave', name: 'Shockwave', kind: 'skill', desc: 'A heavy radial knockback blast.' },
  { id: 'bp_mutation_glasscannon', name: 'Glass Cannon', kind: 'mutation', desc: 'A high-damage glass-cannon perk.' },
  // ── F2 weapon-arsenal (§3 AC2) ── 4 new weapon blueprints, one per new gated WeaponSpec row. Each `id`
  // matches its weapon's `blueprint` tag exactly (verifier §13c asserts the 1:1 catalog ↔ tag consistency).
  { id: 'bp_weapon_daggers', name: 'Twin Daggers', kind: 'weapon', desc: 'A fast flurry assassin melee for the pool.' },
  { id: 'bp_weapon_crossbow', name: 'Crossbow', kind: 'weapon', desc: 'A slow, heavy piercing bolt for the pool.' },
  { id: 'bp_weapon_frostwand', name: 'Frost Wand', kind: 'weapon', desc: 'A charged shot that freezes, for the pool.' },
  { id: 'bp_weapon_flail', name: 'Flail', kind: 'weapon', desc: 'An AoE-stun crowd-stagger melee for the pool.' },
]

// id → entry lookup (the Hub resolves an id, the drop resolves a picked id — DRY, one source).
export const BLUEPRINTS_BY_ID: Record<string, BlueprintEntry> = Object.fromEntries(BLUEPRINTS.map((b) => [b.id, b]))

// The ordered ids (for any list rendering + the verifier sweep).
export const BLUEPRINT_IDS: string[] = BLUEPRINTS.map((b) => b.id)
