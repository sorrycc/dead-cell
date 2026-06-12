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

// ── Run-structure fields (Decision 43, AC43) — shared shape across biomes ──
// `levels`  : how many GENERATED levels this biome spans before the run rolls to the next biome
//             (BLOCKER 1 fix — a biome is NOT a single room; depth scales WITHIN a biome over its
//             `levels` rooms, so "rising difficulty" is observable, not a 3-room blink-and-miss).
// `name`    : human label for the GameOver run summary + the HUD depth/biome readout (AC46).
// `difficultyTier` : a MONOTONE-non-decreasing integer index (0/1/2 here) — a later biome is
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

// ── PRISON — the opening biome (Decision 39/43, tier 0). ──
// All fields are pure data. The generator clamps cols/rows into [MIN,MAX] (AC28) and reads the
// counts/chances to drive the seeded RNG. `colors` are consumed only by the Phaser-coupled TileMap
// (kept here so a biome is ONE object — the generator ignores them; the verifier never reads them).
export const PRISON = {
  id: 'prison',
  name: 'Prison',
  difficultyTier: 0, // tier 0 — the opener (monotone index, ≤ SEWERS ≤ RAMPARTS).
  endsInBoss: false, // not a boss biome.
  levels: 3, // BLOCKER 1: this biome spans 3 generated rooms before rolling to SEWERS.
  // Enemy archetype pool (Decision 68/AC59) — Prison is all melee Grunts (a fair opener).
  enemyPool: [{ id: 'grunt', w: 1 }],
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
export const SEWERS = {
  id: 'sewers',
  name: 'Sewers',
  difficultyTier: 1,
  endsInBoss: false,
  levels: 3,
  // Enemy pool (Decision 68/AC59) — Sewers adds ranged SHOOTERS to the grunt base (kiting pressure).
  enemyPool: [
    { id: 'grunt', w: 3 },
    { id: 'shooter', w: 2 },
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

// ── RAMPARTS — the third / LAST biome (Decision 43, tier 2). ──
// Grey-stone fortress. Longest + densest. tier 2 (the run's hardest). endsInBoss stays false until
// Phase 6 (when the last biome's flag flips to gate a boss before completion).
export const RAMPARTS = {
  id: 'ramparts',
  name: 'Ramparts',
  difficultyTier: 2,
  endsInBoss: true, // §6.6.2 (Decision 66) — the boss biome: its FINAL level is a boss arena (no Door).
  // §6.12 (Decision 78) — the boss biome's final gate is now a SEEDED PICK between TWO bosses (The Warden
  // OR The Hollow Sentinel), so different runs face a different fight (the variety win). `boss` is an ARRAY
  // of ids keyed into config/bosses.js BOSSES; GameScene picks one off the run seed (a run replays the same
  // boss). A single-id string is still accepted by GameScene (back-compat) — the array is the multi-boss form.
  boss: ['rampartsBoss', 'rampartsBoss2'], // The Warden | The Hollow Sentinel (AC57/AC65).
  levels: 3, // 2 normal generated levels + the boss arena as the last (levelInBiome === levels-1).
  // Enemy pool (Decision 68/AC59) — Ramparts adds CHARGERS + FLYERS (the full variety) over the base.
  enemyPool: [
    { id: 'grunt', w: 2 },
    { id: 'shooter', w: 2 },
    { id: 'charger', w: 2 },
    { id: 'flyer', w: 2 },
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
// verifier sweeps. Tiers are 0/1/2 (monotone non-decreasing). The array is trivially extendable;
// adding a 4th biome is one entry + a tier — no generator/RunState change (the run length derives
// from the per-biome `levels`). KISS: three biomes ship now (YAGNI on more).
export const BIOME_ORDER = [PRISON, SEWERS, RAMPARTS]

// The biome map (id → config) — kept for any id-keyed lookup; BIOME_ORDER is the run sequence.
export const BIOMES = { prison: PRISON, sewers: SEWERS, ramparts: RAMPARTS }
