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
  // ── exits (F4 branching-biome-map, Decision 1) ── the biome ids this node can lead to (the GRAPH edges).
  // A boundary roll picks the NEXT biome from here (the picker chooses when ≥2; advance() auto-picks exits[0]
  // when no choice was made — Decision 5). The boss biome is the UNIQUE terminal (`exits: []`). Every id must
  // resolve to a known biome in BIOMES (verifier-asserted, no dangling edge). `exits[0]` is the DEFAULT next
  // (the canonical linear path), so order SEWERS.exits = ['catacombs', …] keeps the default run === today's.
  exits: string[]
  // ── requiresRune (F8 traversal-runes, Decision 3) ── an OPTIONAL map of exit-biome-id → the rune id that
  // GATES that EDGE. An exit NOT in the map is ALWAYS traversable (rune-less). HARD INVARIANT (verifier-
  // asserted): exits[0] is NEVER a key here (the default path is never gated). A run filters its OFFERED exits
  // to (un-gated ∪ gated-and-owned) via runeOpenExits(); advance()'s default path (exits[0] / pendingBiomeId)
  // is UNTOUCHED, so the rune-less run always reaches the boss. Absent ⇒ all exits are open (the identity — the
  // generator never reads it, like miniboss/layoutWeights, so generated levels are byte-identical).
  requiresRune?: Record<string, string>
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
  exits: ['sewers'], // F4 (Decision 1) — single exit: the opener is a FIXED on-ramp (no choice at the very first boundary).
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
  // F4 (Decision 1/5) — THE 3-way choice now: CATACOMBS (the crypt) vs. OSSUARY (the rust galleries) vs.
  // FROSTWORKS (the ice cavern). All three tier 2 → every Sewers-exit route is tier-monotone. 'frostworks'
  // is APPENDED LAST so exits[0] === 'catacombs' is unchanged → the DEFAULT path (auto-pick / headless /
  // verifier) is Prison→Sewers→Catacombs→Ramparts === today's BIOME_ORDER (the additive-identity pin).
  exits: ['catacombs', 'ossuary', 'frostworks'],
  // ── F8 traversal-runes (Decision 3) ── the EXTRA siblings are rune-gated. exits[0] === 'catacombs' is NEVER a
  // key here (the default path is never gated), so a rune-less run sees ONLY ['catacombs'] ⇒ NO fork ⇒ the
  // auto-pick default path === today's run (the additive identity). Owning rune_vine opens Ossuary; owning
  // rune_frost opens Frostworks; both ⇒ the full 3-way fork (today's full picker). Each value is a real
  // RUNES_BY_ID id (verifier-asserted); each key is a real `exits` entry.
  requiresRune: { ossuary: 'rune_vine', frostworks: 'rune_frost' },
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
    { id: 'kamikaze', w: 1 }, // F4 enemy-roster (Decision 7) — a RARE suicide-rusher debut (a sharp but cheap threat that fits the kiting chaos).
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
  exits: ['ramparts'], // F4 (Decision 1) — converges on the boss biome (both mid routes lead to Ramparts).
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
    { id: 'bomber', w: 2 }, // F4 enemy-roster (Decision 7) — the lobbed-splash zoner fits the vertical crypt (moderate).
    { id: 'shielder', w: 1 }, // F4 enemy-roster (Decision 7) — a light frontal tank (a low-weight crypt debut).
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

// ── OSSUARY — the NEW alternate mid biome (F4 branching-biome-map, Decision 2, tier 2) ── a PARALLEL to
// CATACOMBS so the SEWERS boundary offers a real 2-way choice (Catacombs vs. Ossuary). Same field SHAPE as the
// others (DRY — the generator reads identical keys). It MUST sit at the SAME difficultyTier (2) as Catacombs so
// BOTH Sewers-exit routes are tier-monotone (Sewers t1 → {Catacombs t2 | Ossuary t2} → Ramparts t3 — the
// verifier proves EVERY path independently). The flavour difference is the ENEMY/LAYOUT mix, not the tier
// (the "safer vs. richer" framing rides the per-biome bands, not the difficulty index — Decision 2). It REUSES
// the Bone Warden miniboss (catacombsMiniboss — a present id must resolve to a known boss; no new spec, YAGNI).
// NOT added to BIOME_ORDER (the default path takes Catacombs) — it lives only in the GRAPH (BIOMES below).
export const OSSUARY: BiomeConfig = {
  id: 'ossuary',
  name: 'Ossuary',
  difficultyTier: 2, // tier 2 (== Catacombs) so BOTH Sewers-exit routes are tier-monotone (Decision 2/§7.6).
  endsInBoss: false,
  miniboss: 'catacombsMiniboss', // REUSE the Bone Warden — a present miniboss id resolves to a known boss (YAGNI, no new spec).
  exits: ['ramparts'], // F4 (Decision 1) — converges on the boss biome (the parallel route rejoins at Ramparts).
  levels: 3, // 3 generated rooms — SAME length as Catacombs (identical run length regardless of the choice).
  // Enemy pool (Decision 2/68/AC59) — a DISTINCT mix from Catacombs (which is spitter/flyer crypt): a SHOOTER-
  // heavy + CHARGER "ranged ambush galleries" feel (kiting fire + dashers down long halls), a light grunt base.
  // References ONLY known archetype ids with positive weights (verifier-asserted, like every pool).
  enemyPool: [
    { id: 'grunt', w: 2 },
    { id: 'shooter', w: 3 }, // the signature ranged-ambush tilt (vs. Catacombs' spitter spread).
    { id: 'charger', w: 2 }, // dashers down the galleries (a distinct pressure from the crypt's flyers).
    { id: 'flyer', w: 1 }, // a light aerial sprinkle so the roster still varies.
    { id: 'shielder', w: 2 }, // F4 enemy-roster (Decision 7) — a frontal tank pairs with the shooters (the ranged-ambush galleries feel; moderate).
    { id: 'bomber', w: 1 }, // F4 enemy-roster (Decision 7) — a light lobbed-splash zoner (kept DISTINCT from Catacombs' mix).
  ],
  // Layout mix (Decision 2) — ISLANDS-heavy (broken bone-bridges over the void) so it reads spatially distinct
  // from Catacombs' vertical SHAFT, with the stair + shaft as alternates (≥2 templates across the sweep — verified).
  layoutWeights: [
    { id: 'staircase', w: 2 },
    { id: 'shaft', w: 2 },
    { id: 'islands', w: 5 },
  ],
  cols: 82, // like Catacombs (within [COLS_MIN, COLS_MAX]).
  rows: 25,
  minEnemies: 4,
  maxEnemies: 7,
  minPickups: 2,
  maxPickups: 4,
  oneWayLedges: 8,
  hazardPatches: 8,
  platformLenRange: [3, 6],
  colors: {
    solid: 0x5a5048, // bone-and-rust stone (warmer than Catacombs' violet-grey).
    oneWay: 0x8a7a5a, // weathered bone ledges.
    hazard: 0xc97b30, // rust-orange hazards (a galleries-of-rust read).
    bg: 0x16120d, // dark amber-black backdrop.
    entrance: 0x2ecc71,
    exit: 0xf4d03f,
  },
}

// ── FROSTWORKS — the THIRD alternate mid biome (F6 sixth-biome, Decision 1, tier 2) ── a SECOND parallel to
// CATACOMBS/OSSUARY so the SEWERS boundary offers a real 3-way choice (Catacombs vs. Ossuary vs. Frostworks).
// Same field SHAPE as the others (DRY — the generator reads identical keys). It MUST sit at the SAME
// difficultyTier (2) as its siblings so EVERY Sewers-exit route is tier-monotone (Sewers t1 → {Catacombs t2 |
// Ossuary t2 | Frostworks t2} → Ramparts t3 — the verifier proves EVERY path independently). The flavour
// difference is the ENEMY/LAYOUT/palette mix (a FROST/ICE cavern — cold cyan/white), NOT the difficulty tier.
// It ships its OWN cut-down miniboss (frostworksMiniboss — The Glacier Warden, config/bosses.ts) so a present
// miniboss id resolves to a known boss. NOT added to BIOME_ORDER (the default path takes Catacombs) — it lives
// only in the GRAPH (BIOMES below).
export const FROSTWORKS: BiomeConfig = {
  id: 'frostworks',
  name: 'Frostworks', // en source (read via tName); zh override in zh-CN biome block.
  difficultyTier: 2, // tier 2 (== Catacombs/Ossuary) so every Sewers-exit route is tier-monotone (Decision 1/§7.6).
  endsInBoss: false,
  miniboss: 'frostworksMiniboss', // The Glacier Warden (Decision 2) — a present id resolves to a known boss.
  exits: ['ramparts'], // F4 (Decision 1) — converges on the boss biome (the third route rejoins at Ramparts).
  levels: 3, // 3 generated rooms — SAME length as the sibling mid biomes (identical run length regardless of the choice).
  // Enemy pool (Decision 1/68/AC59) — a DISTINCT mix from Catacombs (spitter/flyer crypt) and Ossuary (shooter/
  // charger galleries): a SHIELDER + KAMIKAZE "frozen press" feel (slow frontal tanks + brittle rushers down icy
  // halls) over a grunt base, with a light flyer + bomber. References ONLY known archetype ids with positive weights.
  enemyPool: [
    { id: 'grunt', w: 2 },
    { id: 'shielder', w: 3 }, // the signature frozen-tank tilt (a wall of ice-guards).
    { id: 'kamikaze', w: 2 }, // brittle rushers shatter into you (distinct from the siblings' pressure).
    { id: 'flyer', w: 2 }, // an aerial sprinkle so the roster still varies.
    { id: 'bomber', w: 1 }, // a light lobbed-splash zoner (kept distinct from the sibling mixes).
  ],
  // Layout mix (Decision 1) — a STAIRCASE-heavy descent (frozen terraces) so it reads spatially distinct from
  // Ossuary's islands + Catacombs' shaft, with shaft + islands as alternates (≥2 templates across the sweep — verified).
  layoutWeights: [
    { id: 'staircase', w: 5 },
    { id: 'shaft', w: 2 },
    { id: 'islands', w: 2 },
  ],
  cols: 82, // like Catacombs/Ossuary (within [COLS_MIN, COLS_MAX]).
  rows: 25,
  minEnemies: 4,
  maxEnemies: 7,
  minPickups: 2,
  maxPickups: 4,
  oneWayLedges: 8,
  hazardPatches: 8, // icy hazard patches (render-driven, in-band with the siblings).
  platformLenRange: [3, 6],
  colors: {
    solid: 0x3b5a6e, // cold steel-blue stone.
    oneWay: 0x7fb3c9, // frosted-ice ledges (pale cyan).
    hazard: 0x5dade2, // ice-spike hazard (bright cyan — reads as "cold = danger").
    bg: 0x0c1620, // deep frozen-night backdrop.
    entrance: 0x2ecc71, // green (shared marker — the goal reads consistently across biomes).
    exit: 0xf4d03f, // yellow exit slab (shared).
  },
}

// ── RAMPARTS — the FIFTH / LAST biome (Decision 43, tier 3) ── tier bumped 2→3 with the Catacombs insert
// so the chain stays monotone. Grey-stone fortress. Longest + densest. The boss biome.
export const RAMPARTS: BiomeConfig = {
  id: 'ramparts',
  name: 'Ramparts',
  difficultyTier: 3,
  endsInBoss: true, // §6.6.2 (Decision 66) — the boss biome: its FINAL level is a boss arena (no Door).
  exits: [], // F4 (Decision 1) — the boss biome is the UNIQUE TERMINAL (empty exits — the graph's convergence point).
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
    { id: 'bomber', w: 2 }, // F4 enemy-roster (Decision 7) — the deepest biome throws the FULL bestiary at you (moderate).
    { id: 'kamikaze', w: 2 }, // F4 enemy-roster (Decision 7).
    { id: 'shielder', w: 2 }, // F4 enemy-roster (Decision 7).
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

// ── BIOME_ORDER (Decision 43 / F4 Decision 3.3) ── REPURPOSED as the canonical DEFAULT LINEAR PATH (the
// auto-pick path — Decision 5). It must remain a REAL path through the graph: each consecutive pair satisfies
// BIOME_ORDER[i+1].id ∈ BIOME_ORDER[i].exits (verifier-asserted), starting at START_BIOME_ID and ending at the
// boss biome. A run that makes NO choice (headless / auto-pick / the verifier) walks exactly this chain —
// Prison→Sewers→Catacombs→Ramparts — byte-structurally identical to today's run (the additive-identity pin).
// OSSUARY is NOT here (the default path takes Catacombs); it lives only in the GRAPH (BIOMES). Tiers 0/1/2/3.
export const BIOME_ORDER: BiomeConfig[] = [PRISON, SEWERS, CATACOMBS, RAMPARTS]

// ── BIOMES (F4 Decision 3.3) ── the authoritative GRAPH node set (id → config) — now INCLUDES `ossuary` +
// `frostworks` (F6 sixth-biome). RunState.biome() reads BIOMES[biomeId]; advance() rolls along `exits`; the
// verifier sweeps every node here (generation/pool/clearance) so an off-the-default-path biome is still
// proven generable + well-formed.
export const BIOMES: Record<string, BiomeConfig> = { prison: PRISON, sewers: SEWERS, catacombs: CATACOMBS, ossuary: OSSUARY, frostworks: FROSTWORKS, ramparts: RAMPARTS }

// ── START_BIOME_ID (F4 Decision 3.3) ── the graph ROOT, so RunState/verifier don't hard-code 'prison'.
export const START_BIOME_ID = 'prison'

// ── runeOpenExits(biome, runes) (F8 traversal-runes, Decision 3) ── the exit ids this biome OFFERS given the
// owned runes: exits[0] (the default) is ALWAYS included; a gated exit (one keyed in `requiresRune`) is included
// ONLY if its rune is owned. PURE (no Phaser) — the GameScene picker + the verifier BOTH call it, so "what a
// rune-less run sees" is proven against the real source. With NO `requiresRune` (any other biome) it returns all
// exits unchanged. runeOpenExits(b, new Set()) returns [exits[0], ...un-gated exits] (never empty for a non-boss
// biome — the rune-less invariant): today every Sewers exit beyond 'catacombs' is gated, so a rune-less Sewers
// returns exactly ['catacombs'] ⇒ no fork ⇒ the default path (the additive identity).
export function runeOpenExits(biome: BiomeConfig, runes: Set<string>): string[] {
  const gate = biome.requiresRune
  if (!gate) return biome.exits // no gates on this biome → every exit is open (the identity).
  return biome.exits.filter((id) => !gate[id] || runes.has(gate[id])) // un-gated, OR gated-and-owned.
}
