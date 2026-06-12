// ── Biome configs (design §6.2, Decision 39) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain
// node and sweeps the SAME config the game uses (the verifier's bounds are read from the real
// source, AC28). A biome is a plain object the generator (LevelGenerator.js) reads to size the
// grid, pick enemy/decoration counts, and color the tiles. We ship ONE biome now — PRISON, the
// Dead Cells opener — but the generator signature is multi-biome-ready (Phase 5 adds more behind
// the same `generateLevel(seed, biomeConfig)` contract). YAGNI: no speculative second biome.

// ── Size BOUNDS (AC28) ── the verifier asserts every generated level's cols/rows fall inside
// these. They live HERE (the config owner) so "within bounds" is checked against the real source,
// not a magic literal duplicated in the verifier. A biome's own cols/rows must lie within them.
export const COLS_MIN = 40
export const COLS_MAX = 120
export const ROWS_MIN = 18
export const ROWS_MAX = 30

// ── PRISON — the opening biome (Decision 39). ──
// All fields are pure data. The generator clamps cols/rows into [MIN,MAX] (AC28) and reads the
// counts/chances to drive the seeded RNG. `colors` are consumed only by the Phaser-coupled TileMap
// (kept here so a biome is ONE object — the generator ignores them; the verifier never reads them).
export const PRISON = {
  id: 'prison',
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

// The biome map (future-proof for Phase 5's multi-biome runs; one entry now — YAGNI).
export const BIOMES = { prison: PRISON }
