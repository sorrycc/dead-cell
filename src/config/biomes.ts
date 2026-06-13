// ── Biome configs (design §6.2/§6.4, Decision 39/43) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node
// and sweeps the SAME config the game uses (the verifier's bounds + the ordered run are read from
// the real source, AC28/AC43). A biome is a plain object the generator (LevelGenerator.js) reads to
// size the grid, pick enemy/decoration counts, and color the tiles. The Run-structure phase (§6.4)
// turns the single opener into an ORDERED list of THREE biomes the run walks (Decision 43); the
// generator signature `generateLevel(seed, biomeConfig)` is UNCHANGED (a biome is still just config).

// ── Size BOUNDS (AC28) ── the verifier asserts every generated level's cols/rows fall inside these.
// They live HERE (the config owner) so "within bounds" is checked against the real source, not a
// magic literal duplicated in the verifier. EVERY biome's own cols/rows must lie within them (the
// §6.4 sweep now runs for the whole BIOME_ORDER, not just PRISON — AC28 across the list).
export const COLS_MIN = 40
export const COLS_MAX = 120
export const ROWS_MIN = 18
export const ROWS_MAX = 30

// ── Shared data shapes (FOUNDATION exports) — consumer modules import these to read a biome config. ──
// A WEIGHTED choice: an archetype/layout/etc id paired with its integer weight (Decision 68/AC59).
export interface WeightedChoice {
  id: string
  w: number
}

// The biome COLOR palette consumed only by the Phaser-coupled TileMap (programmer-art primitives).
export interface BiomeColors {
  solid: number // floor/walls/platforms.
  oneWay: number // one-way ledges.
  hazard: number // hazard tiles.
  bg: number // a subtle backdrop band behind the room.
  entrance: number // entrance marker.
  exit: number // exit Door slab.
}

// A BIOME config — a plain object the generator reads to size the grid, pick enemy/decoration counts,
// and color the tiles (see the field docs above). `boss`/`miniboss`/`layoutWeights` are OPTIONAL.
export interface BiomeConfig {
  id: string
  name: string
  difficultyTier: number
  endsInBoss: boolean
  miniboss?: string
  boss?: string | string[]
  levels: number
  enemyPool: WeightedChoice[]
  layoutWeights?: WeightedChoice[]
  cols: number
  rows: number
  minEnemies: number
  maxEnemies: number
  minPickups: number
  maxPickups: number
  oneWayLedges: number
  hazardPatches: number
  platformLenRange: [number, number]
  colors: BiomeColors
}

// ── Run-structure fields (Decision 43, AC43) — shared shape across biomes ──
// `levels`  : how many GENERATED levels this biome spans before the run rolls to the next biome
//             (BLOCKER 1 fix — a biome is NOT a single room; depth scales WITHIN a biome over its
//             `levels` rooms, so "rising difficulty" is observable, not a 3-room blink-and-miss).
// `name`    : human label for the GameOver run summary + the HUD depth/biome readout (AC46).
// `difficultyTier` : a MONOTONE-non-decreasing integer index (0/1/2/3 here) — a later biome is
//             intrinsically denser WITHOUT touching the depth curve (the two STACK in
//             effectiveDifficulty, Decision 43). The verifier asserts it's non-decreasing along the
//             ordered list (AC43).
// `endsInBoss` : the LAST biome (RAMPARTS) flips to true in Phase 6 (§6.6.2, Decision 66) — its FINAL
//             level becomes a boss arena gated by RunState.isBossLevel(); the boss IS the run's gate
//             (no exit Door). The other biomes stay false. `boss` (on the boss biome) keys into
//             config/bosses.js (BOSSES[id]). Present as a populated field so the boss plugs into this
//             seam, not a rewrite.
// `enemyPool` : a WEIGHTED list of archetype ids ([{id,w}, …], Decision 68/AC59) the SCENE picks from
//             per spawn off a FRESH seeded RNG (NOT the generator's pinned draw — so the level pin +
//             determinism deep-equal stay intact). Each biome spawns a DIFFERENT mix (Prison = grunts;
//             Sewers adds shooters; Ramparts adds chargers/flyers) → visibly distinct biomes. The
//             verifier asserts every pool is non-empty + references only known archetype ids.
// `miniboss` : (OPTIONAL — Enrichment round-2, §6.6.8) a boss id (config/bosses.js BOSSES[id]) spawned as a
//             SET-PIECE on this biome's LAST NORMAL level (levelInBiome === levels-1) so the run has an
//             ESCALATING climax per biome, not just the one finale. A miniboss is a cut-down boss spec; it
//             rides the EXISTING Boss FSM + scaleBossSpec depth fold + boss HP bar (zero engine change). The
//             room KEEPS its exit Door (the miniboss guards the way out but isn't the finale's hard gate).
//             Absent ⇒ no miniboss (the boss biome has none — its finale IS the set-piece). The verifier
//             asserts a present id resolves to a known boss.
// `layoutWeights` : (OPTIONAL — Enrichment round-2) a WEIGHTED list of LAYOUT-TEMPLATE ids
//             ([{id:'staircase'|'shaft'|'islands', w}, …]) the GENERATOR picks the room SHAPE from off a
//             seeded sub-RNG (off the main draw thread — pin-safe). Absent ⇒ a shared default mix. This
//             FLAVOURS each biome's spatial feel (the Prison reads as a readable stair, the Catacombs as a
//             vertical descent, the Ramparts as a sprawl of floating islands) on top of the colour/enemy
//             mix — so "every run feels different" is about SHAPE, not just palette. The generator forces
//             'staircase' below LAYOUT_MIN_COLS regardless (so the narrow regression-pin grid is byte-stable).

// ── PRISON — the opening biome (Decision 39/43, tier 0). ──
// All fields are pure data. The generator clamps cols/rows into [MIN,MAX] (AC28) and reads the
// counts/chances to drive the seeded RNG. `colors` are consumed only by the Phaser-coupled TileMap
// (kept here so a biome is ONE object — the generator ignores them; the verifier never reads them).
export const PRISON: BiomeConfig = {
  id: 'prison',
  name: 'Prison',
  difficultyTier: 0, // tier 0 — the opener (monotone index, ≤ SEWERS ≤ RAMPARTS).
  endsInBoss: false, // not a boss biome.
  miniboss: 'prisonMiniboss', // round-2 (§6.6.8) — The Jailer guards this biome's last normal level (a gentle first set-piece).
  levels: 3, // BLOCKER 1: this biome spans 3 generated rooms before rolling to SEWERS.
  // Enemy archetype pool (Decision 68/AC59) — Prison is all melee Grunts (a fair opener).
  enemyPool: [{ id: 'grunt', w: 1 }],
  // Layout mix (Enrichment round-2) — the OPENER leans on the readable STAIRCASE (a gentle on-ramp) with a
  // light sprinkle of the other shapes, so a new player isn't dropped into a vertical shaft on level 1.
  layoutWeights: [
    { id: 'staircase', w: 5 },
    { id: 'shaft', w: 1 },
    { id: 'islands', w: 2 },
  ],
  cols: 64, // grid width in tiles (within [COLS_MIN, COLS_MAX]).
  rows: 22, // grid height in tiles (within [ROWS_MIN, ROWS_MAX]).
  // Enemy count band (AC28): the generator draws n ∈ [minEnemies, maxEnemies] standable spawns.
  minEnemies: 3,
  maxEnemies: 6,
  // Pickup count band (placeholder markers this phase; the economy is Phase 5 — YAGNI).
  minPickups: 2,
  maxPickups: 4,
  // Off-critical-path decoration (Decision: step 5). Counts, not per-tile chances, so the sweep is
  // deterministic + bounded (a chance-per-tile would scale with grid size unpredictably).
  oneWayLedges: 6, // extra ONE-WAY ledges scattered off the guaranteed route.
  hazardPatches: 5, // HAZARD tiles scattered off the route (render-only this phase).
  // Critical-path platform run length (tiles): each staircase platform is stamped this wide. A
  // MINIMUM of 3 keeps every platform wide enough to STAND + patrol on (review MAJOR — enemy
  // patrol needs room; see Decision 41 / §6.2). The generator picks len ∈ [min, max] per platform.
  platformLenRange: [3, 6],
  // Colors (TileMap only — programmer-art primitives).
  colors: {
    solid: 0x3a4658, // floor/walls/platforms (slate).
    oneWay: 0xb9770e, // one-way ledges (amber — matches the Phase-1 one-way platform).
    hazard: 0xc0392b, // hazard tiles (brick red).
    bg: 0x10141c, // a subtle backdrop band behind the room.
    entrance: 0x2ecc71, // entrance marker (green).
    exit: 0xf4d03f, // exit Door slab (yellow — the goal reads).
  },
}

// ── SEWERS — the second biome (Decision 43, tier 1). ──
// Same field SHAPE as PRISON (DRY — the generator reads identical keys); distinct name/colors
// (green-tinted), a touch longer + denser enemy band. tier 1 > PRISON's 0 (monotone).
export const SEWERS: BiomeConfig = {
  id: 'sewers',
  name: 'Sewers',
  difficultyTier: 1,
  endsInBoss: false,
  miniboss: 'sewersMiniboss', // round-2 (§6.6.8) — The Drowned guards this biome's last normal level (a ranged zoner set-piece).
  levels: 3,
  // Enemy pool (Decision 68/AC59) — Sewers adds ranged SHOOTERS to the grunt base (kiting pressure), plus a
  // LIGHT sprinkle of the CHARGER + FLYER (Enrichment round-3 front-loaded-variety fix). The old pool was
  // grunt+shooter, so the first 6 of 12 rooms (half the run — the part new players see most) showed only 2
  // of 5 archetypes, and the charger never appeared before the LAST biome. A low weight on charger/flyer
  // here lets the 2nd biome surprise you with a dasher/swooper without overwhelming its grunt+shooter
  // identity — the variety isn't all back-loaded into the deepest pool. Pure-config (the verifier already
  // asserts every pool id is a known archetype) — no engine change.
  enemyPool: [
    { id: 'grunt', w: 3 },
    { id: 'shooter', w: 2 },
    { id: 'charger', w: 1 }, // round-3 — a rare dasher debuts in the Sewers (was Ramparts-only before).
    { id: 'flyer', w: 1 }, // round-3 — an occasional swooper (front-loads the aerial threat).
  ],
  // Layout mix (Enrichment round-2) — the Sewers tilt toward floating ISLANDS over open water/sludge (a
  // bouncier traverse that pairs with the kiting shooters), with the stair + shaft as the alternates.
  layoutWeights: [
    { id: 'staircase', w: 3 },
    { id: 'shaft', w: 2 },
    { id: 'islands', w: 4 },
  ],
  cols: 76, // longer than PRISON (still within bounds) — a denser, twistier descent.
  rows: 24,
  minEnemies: 4, // denser than PRISON.
  maxEnemies: 7,
  minPickups: 2,
  maxPickups: 4,
  oneWayLedges: 8,
  hazardPatches: 7,
  platformLenRange: [3, 6],
  colors: {
    solid: 0x2f4a3a, // mossy slate-green.
    oneWay: 0x4e8d5a, // algae ledges.
    hazard: 0x16a085, // toxic sludge (teal).
    bg: 0x0b1410, // dark green-black backdrop.
    entrance: 0x2ecc71,
    exit: 0xf4d03f,
  },
}

// ── CATACOMBS — the FOURTH biome (Enrichment round 3, tier 2) ── inserted BETWEEN Sewers and Ramparts to
// EXTEND the descent (a run was fairly short: 9 rooms + boss). Same field SHAPE as the others (DRY — the
// generator reads identical keys); a bone-grey crypt aesthetic distinct from the green Sewers + grey
// Ramparts. It introduces the round-3 5th archetype (the SPITTER shotgunner) + the FLYER to the mid-run
// pool, so the new rooms feel different from both neighbours AND the deepest pool isn't the only place the
// full variety appears. tier 2 > Sewers' 1; Ramparts bumps to tier 3 (the chain stays monotone — the
// verifier asserts non-decreasing tiers along BIOME_ORDER). A pure-data add: no generator/RunState change
// (the run length derives from the per-biome `levels`, the architecture biomes.js explicitly invites).
export const CATACOMBS: BiomeConfig = {
  id: 'catacombs',
  name: 'Catacombs',
  difficultyTier: 2, // tier 2 — between Sewers (1) and the bumped Ramparts (3); monotone.
  endsInBoss: false,
  miniboss: 'catacombsMiniboss', // round-2 (§6.6.8) — The Bone Warden guards the last set-piece before the finale.
  levels: 3, // 3 generated rooms before rolling to Ramparts (extends the run by a biome).
  // Enemy pool (Decision 68/AC59) — Catacombs leans on the new SPITTER shotgunner + the FLYER over a grunt
  // base (a ranged-spread + aerial mix — distinct from the Sewers' grunt+shooter kiting feel), with a light
  // CHARGER (round-3 front-loaded-variety fix) so the mid-run biomes COLLECTIVELY show all 5 archetypes
  // before the finale — the charger is no longer hidden until the deepest pool.
  enemyPool: [
    { id: 'grunt', w: 2 },
    { id: 'spitter', w: 3 }, // the round-3 5th archetype debuts here (its signature biome).
    { id: 'flyer', w: 2 },
    { id: 'charger', w: 1 }, // round-3 — a rare dasher in the crypt (collective full-roster coverage mid-run).
  ],
  // Layout mix (Enrichment round-2) — the Catacombs lean into the vertical SHAFT (a switchback descent into
  // the crypt — its signature spatial feel), with the stair + islands as the alternates.
  layoutWeights: [
    { id: 'staircase', w: 2 },
    { id: 'shaft', w: 4 },
    { id: 'islands', w: 2 },
  ],
  cols: 82, // between Sewers (76) and Ramparts (88) — within bounds.
  rows: 25,
  minEnemies: 4,
  maxEnemies: 7,
  minPickups: 2,
  maxPickups: 4,
  oneWayLedges: 8,
  hazardPatches: 8, // a touch more environmental danger (the round-3 hazards now bite — a crypt of spikes).
  platformLenRange: [3, 6],
  colors: {
    solid: 0x4a4458, // bone-grey/violet stone.
    oneWay: 0x7d6b8a, // weathered crypt ledges.
    hazard: 0x9b59b6, // necrotic spikes (violet).
    bg: 0x130f18, // dark crypt backdrop.
    entrance: 0x2ecc71,
    exit: 0xf4d03f,
  },
}

// ── RAMPARTS — the FIFTH / LAST biome (Decision 43, tier 3) ── tier bumped 2→3 with the Catacombs insert
// so the chain stays monotone. Grey-stone fortress. Longest + densest. The boss biome.
export const RAMPARTS: BiomeConfig = {
  id: 'ramparts',
  name: 'Ramparts',
  difficultyTier: 3,
  endsInBoss: true, // §6.6.2 (Decision 66) — the boss biome: its FINAL level is a boss arena (no Door).
  // §6.12 (Decision 78) — the boss biome's final gate is now a SEEDED PICK between TWO bosses (The Warden
  // OR The Hollow Sentinel), so different runs face a different fight (the variety win). `boss` is an ARRAY
  // of ids keyed into config/bosses.js BOSSES; GameScene picks one off the run seed (a run replays the same
  // boss). A single-id string is still accepted by GameScene (back-compat) — the array is the multi-boss form.
  boss: ['rampartsBoss', 'rampartsBoss2', 'rampartsBoss3'], // The Warden | The Hollow Sentinel | The Iron Tyrant (round-2, AC57/AC65).
  levels: 3, // 2 normal generated levels + the boss arena as the last (levelInBiome === levels-1).
  // Enemy pool (Decision 68/AC59) — Ramparts is the FULL roster: every archetype incl. the round-3 Spitter,
  // so the deepest biome throws the whole bestiary at you (the hardest, most varied rooms).
  enemyPool: [
    { id: 'grunt', w: 2 },
    { id: 'shooter', w: 2 },
    { id: 'charger', w: 2 },
    { id: 'flyer', w: 2 },
    { id: 'spitter', w: 2 },
  ],
  // Layout mix (Enrichment round-2) — the deepest biome throws the FULL shape variety at you in roughly even
  // measure (every room a fresh spatial puzzle), tilted a touch toward the sprawling ISLANDS read (a fortress
  // of broken ramparts you leap between).
  layoutWeights: [
    { id: 'staircase', w: 3 },
    { id: 'shaft', w: 3 },
    { id: 'islands', w: 4 },
  ],
  cols: 88, // longest (within bounds).
  rows: 26,
  minEnemies: 5, // densest base band.
  maxEnemies: 8,
  minPickups: 2,
  maxPickups: 5,
  oneWayLedges: 9,
  hazardPatches: 8,
  platformLenRange: [3, 6],
  colors: {
    solid: 0x4a4f5a, // cold grey stone.
    oneWay: 0x8a6d3b, // weathered timber ledges.
    hazard: 0xc0392b, // brazier-red hazards.
    bg: 0x121419, // slate-night backdrop.
    entrance: 0x2ecc71,
    exit: 0xf4d03f,
  },
}

// ── BIOME_ORDER (Decision 43, AC43) ── THE ordering the run walks (RunState indexes into it) and the
// verifier sweeps. Tiers are 0/1/2/3 (monotone non-decreasing). The array is trivially extendable; the
// round-3 CATACOMBS insert (one entry + a tier bump on the following biome) proves the architecture's
// claim — no generator/RunState change (the run length derives from the per-biome `levels`). FOUR biomes
// ship now → 12 generated rooms + the boss (a longer descent).
export const BIOME_ORDER: BiomeConfig[] = [PRISON, SEWERS, CATACOMBS, RAMPARTS]

// The biome map (id → config) — kept for any id-keyed lookup; BIOME_ORDER is the run sequence.
export const BIOMES: Record<string, BiomeConfig> = { prison: PRISON, sewers: SEWERS, catacombs: CATACOMBS, ramparts: RAMPARTS }
