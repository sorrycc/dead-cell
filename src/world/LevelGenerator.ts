// ── Procedural level generator (design §6.2, Decisions 33–41, AC19/AC27/AC28) ──
// 100% PURE module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node and
// asserts determinism + solvability headlessly (the mandated convention, Decision 5/33). Given a
// (seed, biomeConfig) it returns a plain LEVEL DESCRIPTION object (pure data — no functions on it,
// so it serializes for the regression pin). The SAME (seed, biomeConfig) is byte-identical every
// time because ONE seeded mulberry32 threads the whole generation (Decision 5).
//
// ALGORITHM (Decision 34): a reach-bounded "platform STAIRCASE walk" — a deterministic left→right
// chain of solid platforms whose every (gap, step) is inside the player's MEASURED jump reach, so
// the entrance→exit path is traversable BY CONSTRUCTION (AC27). The verifier's BFS is then a PROOF,
// not a filter. We don't use a cave generator (it gives no jump-reach guarantee for free — you'd
// post-hoc verify + reject + retry, non-deterministic in spirit). YAGNI: one layout algorithm now;
// a cave/branching biome is a later phase behind the same `generateLevel` signature.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE JUMP-REACH ENVELOPE — the load-bearing soundness claim of this phase (review BLOCKER #1/#2).
// ─────────────────────────────────────────────────────────────────────────────────────────────
// AC27 requires that a verifier PASS is SOUND: if the BFS says "reachable", the REAL player can
// definitely make the jump. The prior design treated the two axes as INDEPENDENT (|dx|<=MAX_GAP
// AND dy>=-MAX_STEP_UP). That is WRONG in principle: a max-height jump leaves LESS horizontal
// reach and vice-versa — the axes are COUPLED. It happened to be safe only by luck of specific
// budgets, so a one-line budget re-tune could silently produce unreachable "verified" levels.
//
// FIX (BLOCKER #1): `canReachStep(dxTiles, dyTiles)` is a TRUE 2-D ENVELOPE — the available
// horizontal reach is a FUNCTION of the vertical step `dy`, derived from the REAL Player.js
// physics below. Re-tuning the player now stays sound automatically (the envelope recomputes).
//
// DERIVATION (from Player.js + constants.js — the actual numbers the controller runs):
//   JUMP_VELOCITY = 620 px/s   (Player.js — initial upward speed on a full jump)
//   GRAVITY       = 1500 px/s² (constants.js — world gravity, applied while RISING)
//   FALL_GRAVITY_EXTRA = 900 px/s² (Player.js — EXTRA gravity while DESCENDING, vy>0)
//   RUN_SPEED     = 320 px/s   (Player.js — top horizontal run speed)
// Ascent uses g_up = GRAVITY; descent uses g_down = GRAVITY + FALL_GRAVITY_EXTRA (the fast-fall).
// Apex climb height = v²/2·g_up = 620²/3000 ≈ 128.1 px (= 4.0 tiles) — the absolute max rise.
//
// To LAND ON TOP of a platform that is `up` px HIGHER than the launch foot, the body must be at
// height `up` with a DOWNWARD (real-landing) velocity — i.e. the DESCENDING crossing of height
// `up` after the apex. That crossing happens at the LATEST time (max horizontal travel), so it is
// the correct reach to use. Air time to that crossing:
//     t = t_up + t_downToTarget
//     t_up          = v / g_up                         (launch → apex)
//     drop          = apexH − up                       (apex → target height)
//     t_downToTarget = sqrt(2·drop / g_down)           (apex → target, fast-fall)
//     rawReach(up)  = RUN_SPEED · t                    (horizontal distance covered in that time)
// For a target LOWER (up<0, i.e. falling to it) the air time only grows, so reach only grows; we
// model it with the full apex→(launch+|down|) fall (more time → more reach). Either way the result
// is multiplied by a SAFETY MARGIN (Decision 35) so the envelope is a conservative UNDER-estimate
// of true reach — guaranteeing a verifier PASS implies the real player makes it (never a false
// PASS). The margin absorbs imperfect inputs + the difference between the theoretical apex and
// what a player actually lands.
//
// Worked corner case (the reviewer's load-bearing example, now PROVEN here not "by luck"):
//   up = 3 tiles (96 px): apexH≈128.1, drop≈32.1, t_up≈0.413s, t_down≈sqrt(2·32.1/2400)≈0.164s,
//   rawReach ≈ 320·0.577 ≈ 184.6 px → ×0.7 margin ≈ 129.2 px. MAX_GAP = 4 tiles = 128 px ≤ 129.2,
//   so the worst-case "max-up + max-across" corner is INSIDE the safe envelope WITH a margin. A
//   future budget re-tune cannot silently break this because MAX_STEP_UP/MAX_GAP are CLAMPED to
//   the envelope at module-load (see the assertions below) — an over-budget tune fails LOUDLY.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE EXACT METRIC — pinned so the generator + verifier check the SAME graph (review BLOCKER #2).
// ─────────────────────────────────────────────────────────────────────────────────────────────
// "gap" and "step" must measure ONE thing, byte-identically, in both the walk and the BFS, or the
// verifier checks a different graph than the player traverses. PINNED METRIC (used by BOTH because
// both import the SAME `canReachStep` + `platformStep` from THIS file — DRY, Decision 36):
//   • A platform is its merged SOLID run `{ col, row, len }`: its TOP walkable surface is row `row`,
//     spanning columns [col, col+len−1]. The player STANDS on top (feet at the top of row `row`).
//   • VERTICAL step  dyTiles = B.row − A.row   (platform-TOP row to platform-TOP row). Negative =
//     B is HIGHER (smaller row index = higher on screen). This is the "step" both sides measure.
//   • HORIZONTAL gap dxTiles = the NEAREST-EDGE column distance from A to B in the travel direction:
//     if B is to the RIGHT of A,  dx = B.col − (A.col + A.len − 1);
//     if B is to the LEFT  of A,  dx = (B.col + B.len − 1) − A.col;
//     if the spans overlap in columns, dx = 0 (you can step across without a jump).
//     This is near-edge-to-near-edge (the clear gap the player's leading foot must clear). It is
//     computed ONCE in `platformStep(A, B)` and consumed by BOTH the generator's placement AND the
//     verifier's edge construction — they CANNOT disagree because it is the same function.
// The generator places B such that platformStep(A,B) satisfies canReachStep; the verifier rebuilds
// the graph from the EMITTED platforms via platformStep + canReachStep and BFSes it. Identical math.

import { mulberry32 } from '../util/rng.js'
import type { RNG } from '../util/rng.js'
import { COLS_MIN, COLS_MAX, ROWS_MIN, ROWS_MAX } from '../config/biomes.js'
import type { BiomeConfig, BiomeColors, WeightedChoice } from '../config/biomes.js'

// ── Shared data shapes (FOUNDATION exports) — consumer modules import these to read a level. ──

// A platform-LIKE record: a merged horizontal run with a TOP walkable surface at row `row` spanning
// columns [col, col+len−1]. `type` is a TILE value (SOLID|ONEWAY). The reach metric + the placement
// walk + the verifier graph all measure these.
export interface Platform {
  col: number
  row: number
  len: number
  type: number
}

// The EXACT metric returned by platformStep(a, b): near-edge column gap `dx` + top-row step `dy`.
export interface LevelStep {
  dx: number
  dy: number
}

// A 2-D point on the grid + its world coords (tile center) — entrance/exit/treasure/bossSpawn shape.
export interface LevelPoint {
  col: number
  row: number
  x: number
  y: number
}

// A standable cell found by collectStandable: an EMPTY cell with support below, plus the OWNING run's
// col/len (so enemy patrol bounds derive from it, Decision 41).
export interface StandableCell {
  col: number
  row: number
  runCol: number
  runLen: number
}

// A full enemy SPAWN (world point + patrol bounds + spec) — see enemySpawnFromCell.
export interface EnemySpawn {
  col: number
  row: number
  x: number
  y: number
  patrolMinX: number
  patrolMaxX: number
  spec: string
}

// A pickup spawn (world point + placeholder kind) — see generateLevel step 6.
export interface Pickup {
  col: number
  row: number
  x: number
  y: number
  kind: string
}

// The shared context passed to each layout-template builder (see the LAYOUT TEMPLATES header).
export interface TemplateCtx {
  cols: number
  rows: number
  floorRow: number
  platformRows: number
  interiorMax: number
  lenMin: number
  lenMax: number
}

// The PURE level DESCRIPTION generateLevel/generateBossArena return — plain data (no functions) so it
// serializes for the regression pin (design §6.2). The boss-arena fields (`bossSpawn`/`isBossArena`)
// are OPTIONAL (a normal level omits them); a normal level omits nothing else.
export interface LevelDescription {
  cols: number
  rows: number
  tileSize: number
  worldWidth: number
  worldHeight: number
  tiles: number[][]
  entrance: LevelPoint
  exit: LevelPoint
  platforms: Platform[]
  enemies: EnemySpawn[]
  spawnCandidates: EnemySpawn[]
  pickups: Pickup[]
  branchTreasure: LevelPoint | null
  template?: string
  bossSpawn?: LevelPoint
  isBossArena?: boolean
  seed: number
  biomeId: string
  colors?: BiomeColors
}

// A biome config as the generator reads it, optionally carrying the boss-arena flag GameScene shallow-
// merges in for the boss level (design §6.6.2, Decision 66).
export type GeneratorBiomeConfig = BiomeConfig & { bossArena?: boolean }

// ── Tile enums (Decision 33) ── small ints so the grid serializes trivially (the regression pin)
// and generator/TileMap/verifier share ONE definition (DRY). EMPTY=0 so a fresh grid is all-empty.
export const TILE = { EMPTY: 0, SOLID: 1, ONEWAY: 2, HAZARD: 3 }

// Tile size in world px (Decision 35). The grid is the source of truth; world coords = tile·SIZE.
export const TILE_SIZE = 32

// ── Boss-arena width in tiles (missing-boss fix) ── the flat boss arena is a FIXED ~one-screen-plus width
// (50·32 = 1600px ≈ 1.25 viewports) instead of the biome's 88-col sprawl, so the boss (col ~36) is on screen
// when you drop in (it used to spawn a full screen off the right edge). Within [COLS_MIN, COLS_MAX] (AC28).
export const BOSS_ARENA_COLS = 50

// ── Player physics, MIRRORED from Player.js + constants.js for the reach envelope (Decision 35). ──
// These are the REAL controller numbers. They live here (next to the derivation) so re-tuning the
// player is a one-line update AND the assertions below re-prove soundness at module load. If these
// drift from Player.js the envelope is a lie — keep them in sync (a future RunState could share a
// single source; for now the duplication is explicit + asserted, not hidden).
const JUMP_VELOCITY = 620 // px/s — Player.js JUMP_VELOCITY.
const GRAVITY = 1500 // px/s² — constants.js GRAVITY (rising).
const FALL_GRAVITY_EXTRA = 900 // px/s² — Player.js FALL_GRAVITY_EXTRA (descending only).
const RUN_SPEED = 320 // px/s — Player.js RUN_SPEED.
const G_UP = GRAVITY // ascent gravity.
const G_DOWN = GRAVITY + FALL_GRAVITY_EXTRA // descent gravity (fast-fall).
export const APEX_H = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * G_UP) // ≈128.1 px — max climb. Exported for the verifier's swept-airspace (body-aware-clearance §6.4).

// Safety margin (Decision 35): the envelope is scaled to this fraction so it UNDER-estimates true
// reach (a verifier PASS is then always sound). The whole point of the margin is to absorb the gap
// between theory and a real landing — keep it ≤ 1.
const REACH_MARGIN = 0.7

// ── rawReachPx(dyPx) — the COUPLED horizontal reach (px) to LAND ON TOP at vertical step dyPx ──
// dyPx < 0 ⇒ target is HIGHER by |dyPx| (a climb); dyPx > 0 ⇒ target is LOWER (a fall). Returns the
// SAFE (margin-scaled) horizontal reach, or 0 if the climb exceeds the apex (unreachable height).
// PURE + deterministic (no RNG) so the generator + verifier agree exactly.
function rawReachPx(dyPx: number): number {
  const up = -dyPx // how much HIGHER the target is (px); negative if target is lower.
  if (up > APEX_H) return 0 // cannot climb that high at all → no horizontal reach.
  const tUp = JUMP_VELOCITY / G_UP // launch → apex.
  // Fall distance from apex down to the target height: apex is APEX_H above launch; target is `up`
  // above launch (up may be negative = below launch), so the drop is APEX_H − up (always > 0 here).
  const drop = APEX_H - up
  const tDown = Math.sqrt((2 * drop) / G_DOWN)
  return RUN_SPEED * (tUp + tDown) * REACH_MARGIN
}

// ── Reach budgets (Decision 35) — NAMED constants, CLAMPED to the envelope so a re-tune is loud. ──
// These bound the staircase walk's seeded (gap, step) draws. They are conservative integers chosen
// to sit INSIDE the physical envelope at every step; the module-load assertions below PROVE that
// (so an over-budget edit fails immediately instead of producing unreachable "verified" levels).
const MAX_STEP_UP = 3 // tiles — max upward platform-to-platform climb (96px < 128px apex).
const MAX_STEP_DOWN = 6 // tiles — max downward step (falling is cheap; bounded so platforms stay on-screen).
const MIN_GAP = 1 // tiles — min horizontal clear gap (so platforms don't fuse into one run).
export const MAX_GAP = 4 // tiles — max horizontal clear gap (128px). MUST be ≤ canReach at MAX_STEP_UP. Exported for the verifier's wall-corner exit-keepout mirror.

// ── Body-clearance budget (body-aware-clearance design §6.1) — MIRRORED from Player.js so the generator
// + verifier can prove the REAL 36×52 collision body FITS the spaces it must traverse, not just that a
// point-mass reaches the platform TOPS (the original "hero wedged in a 1-tile slot" bug). Body width 36 >
// TILE_SIZE 32, so a 1-tile (32px) vertical channel is impassable; body height 52 needs ≥2 empty rows of
// headroom. CLEAR_COLS/CLEAR_ROWS are the body footprint in TILES (ceil), asserted sound at module load.
// These are an ADDITIVE clearance dimension — they touch none of the reach math above (AC7). Keep BODY_W/
// BODY_H in sync with Player.js (same explicit-duplication caveat as the physics mirror).
const BODY_W = 36 // px — MIRROR of Player.js BODY_W (the Arcade body width).
const BODY_H = 52 // px — MIRROR of Player.js BODY_H (the Arcade body height).
export const CLEAR_COLS = Math.ceil(BODY_W / TILE_SIZE) // = 2 — empty columns the body needs to occupy/pass.
export const CLEAR_ROWS = Math.ceil(BODY_H / TILE_SIZE) // = 2 — empty rows of headroom above a footing.

// ── Floor-recovery budgets (floor-recovery-ledges design) — guarantee a fallen player can climb back to
// the exit LOCALLY instead of backtracking the whole level. The entrance→exit chain is traversable BY
// CONSTRUCTION (AC27), but nothing stopped a player who FELL to the floor from being stranded far below a
// high chain stretch. These budgets drive a recovery pass (placeRecoveryBridges) that lays SOLID
// stepping-stones across any under-served floor stretch, and a verifier LOCALITY proof. Gated on grid
// WIDTH like the branch/layout features so the cols:40 regression pin emits nothing new.
export const RECOVERY_MIN_COLS = 50 // skip recovery on narrow grids (the pin is 40 → unaffected); shared with the verifier.
const RECOVERY_REMOUNT_UP = MAX_STEP_UP // tiles — a SOLID top ≤ this above the floor is re-mountable from it.
const MAX_FLOOR_RECOVERY_GAP = 10 // tiles — max consecutive interior floor columns with no re-mount near.

// ── Wall-corner escape (wall-corner-escape fix) — kill the "knocked into the bottom corner, jump bonks a low
// overhang, feel trapped" pocket. The floor-recovery proof above is POINT-MASS — it can call a re-mount usable
// even when a platform's edge overhangs the wall-corner floor slot, so the real 36×52 body bonks the overhang on
// a straight-up jump and the only escape is a non-obvious duck-walk + double-jump. openWallCorners (a deterministic
// post-pass, below) clears a CLEAR_COLS-wide clear-sky channel in the two interior columns beside EACH side wall
// across this low band — a full single-jump rise — so jumping straight out of either bottom corner always rises
// into open space. = the base-jump apex in tiles so the channel is exactly as tall as a floor jump can climb.
export const CORNER_OPEN_ROWS = Math.ceil(APEX_H / TILE_SIZE) // = 4 — wall-corner clear-sky band height (rows above the floor). Exported for the verifier's wall-corner-open assertion.

// ── Floor-recovery shared metric (Decision 8/13 — the ONE coverage definition both the generator's
// placement AND the verifier's locality proof call, so they cannot disagree; the platformStep DRY pattern). ──

// isRemountRun(p, floorRow, cols) → true iff `p` is a SOLID run in the re-mount BAND (top ≤
// RECOVERY_REMOUNT_UP tiles above the floor) with a NON-EMPTY interior overlap. It tests interior OVERLAP,
// not strict containment: mergeRuns fuses a band run that touches col 1 / cols-2 with the full-height side
// wall, so an emitted run can spill onto col 0 / cols-1 — the overlap test still accepts it while excluding
// the floor run (row === floorRow) and a pure 1-wide side-wall run (interior overlap empty).
export function isRemountRun(p: Platform, floorRow: number, cols: number): boolean {
  if (p.type !== TILE.SOLID) return false
  if (p.row < floorRow - RECOVERY_REMOUNT_UP || p.row >= floorRow) return false
  return Math.max(p.col, 1) <= Math.min(p.col + p.len - 1, cols - 2)
}

// floorRecoveryGaps(remounts, cols) → the maximal interior column intervals [lo,hi] in [1, cols-2] NOT
// covered by any re-mount AND longer than MAX_FLOOR_RECOVERY_GAP (a leading gap from col 1 and a trailing
// gap to col cols-2 are included). Coverage uses each re-mount's INTERIOR-CLAMPED span [max(col,1),
// min(col+len-1, cols-2)] so a wall-fused run contributes its interior columns — making the generator's
// un-merged view and the verifier's merged view yield the identical covered-column set (no boundary drift).
export function floorRecoveryGaps(remounts: Platform[], cols: number): Array<[number, number]> {
  const interiorMax = cols - 2
  if (interiorMax < 1) return []
  const covered: boolean[] = new Array(cols).fill(false)
  for (const p of remounts) {
    const lo = Math.max(p.col, 1)
    const hi = Math.min(p.col + p.len - 1, interiorMax)
    for (let c = lo; c <= hi; c++) covered[c] = true
  }
  const gaps: Array<[number, number]> = []
  let c = 1
  while (c <= interiorMax) {
    if (covered[c]) {
      c++
      continue
    }
    const start = c
    while (c <= interiorMax && !covered[c]) c++
    const end = c - 1
    if (end - start + 1 > MAX_FLOOR_RECOVERY_GAP) gaps.push([start, end])
  }
  return gaps
}

// ── canReachStep(dxTiles, dyTiles) → boolean (Decisions 35/36, the SHARED predicate) ──
// TRUE iff a player on platform A can jump to platform B whose near-edge gap is `dxTiles` tiles and
// whose top is `dyTiles` tiles away (negative = higher). The horizontal allowance is the COUPLED
// envelope rawReachPx(dy) (BLOCKER #1) — NOT a fixed MAX_GAP. The generator uses it to bound the
// walk; the verifier uses the SAME function to build the reachability graph (DRY, Decision 36).
// Conservative (margin) ⇒ a PASS is sound. NOTE: a downward step beyond MAX_STEP_DOWN is rejected
// here too — not because it's unreachable (falling always reaches) but because the generator never
// emits one (platforms must stay on-screen), so the graph + the walk agree on that bound as well.
export function canReachStep(dxTiles: number, dyTiles: number): boolean {
  if (dyTiles < -MAX_STEP_UP) return false // climbs higher than the budget allows.
  if (dyTiles > MAX_STEP_DOWN) return false // falls farther than the generator ever places.
  const reachPx = rawReachPx(dyTiles * TILE_SIZE)
  return Math.abs(dxTiles) * TILE_SIZE <= reachPx
}

// ── platformStep(a, b) → { dx, dy } (the EXACT metric — review BLOCKER #2) ──
// dy = b.row − a.row (top-row to top-row; negative = b higher). dx = the NEAREST-EDGE column gap in
// the travel direction (0 if the spans overlap in columns). This is the ONE function both the
// generator's placement check AND the verifier's edge construction call, so they cannot disagree.
export function platformStep(a: Platform, b: Platform): LevelStep {
  const aLeft = a.col
  const aRight = a.col + a.len - 1
  const bLeft = b.col
  const bRight = b.col + b.len - 1
  let dx
  if (bLeft > aRight) dx = bLeft - aRight // b entirely to the RIGHT: clear gap to b's left edge.
  else if (bRight < aLeft) dx = bRight - aLeft // b entirely to the LEFT: clear gap (negative dir).
  else dx = 0 // spans overlap in columns → step across, no jump gap.
  return { dx, dy: b.row - a.row }
}

// ── canReachPlatform(a, b) → boolean ── the platform-level reach test the verifier BFS uses:
// measure the exact metric then apply the shared envelope. Exported so game + verifier share it.
export function canReachPlatform(a: Platform, b: Platform): boolean {
  const { dx, dy } = platformStep(a, b)
  return canReachStep(dx, dy)
}

// ── bodyFits(tiles, cols, rows, leftCol, row) → boolean (body-aware-clearance §6.2 — the OCCUPANCY primitive) ──
// True iff the body's CLEAR_COLS×CLEAR_ROWS footprint anchored at columns [leftCol, leftCol+CLEAR_COLS-1] and
// occupying rows [row-CLEAR_ROWS+1 .. row] is in-bounds and free of SOLID. ONEWAY/HAZARD do NOT block occupancy
// (a ONEWAY collides only from ABOVE; HAZARD is damage-only) — only SOLID is a wall to the 36×52 body. This is
// the footprint unit the verifier BFS uses as a window node and the generator uses via bodyStandClear (DRY,
// the canReachStep pattern). PURE so both sides agree exactly.
export function bodyFits(tiles: number[][], cols: number, rows: number, leftCol: number, row: number): boolean {
  if (leftCol < 0 || leftCol + CLEAR_COLS - 1 >= cols) return false
  if (row - CLEAR_ROWS + 1 < 0 || row >= rows) return false
  for (let r = row - CLEAR_ROWS + 1; r <= row; r++) {
    for (let c = leftCol; c < leftCol + CLEAR_COLS; c++) {
      if (tiles[r][c] === TILE.SOLID) return false
    }
  }
  return true
}

// ── bodyStandClear(tiles, cols, rows, col, row) → boolean (body-aware-clearance §6.2, Decision 1 — the SLIDING
// CLEAR_COLS-window) ── True iff a 36×52 body can STAND at/around the standable cell (col,row): the cell is EMPTY,
// and SOME CLEAR_COLS-window whose span CONTAINS `col` both bodyFits AND has support (SOLID|ONEWAY) directly below
// one of its columns. The window slides so a centered/edge body is found wherever it actually fits (the body is
// NOT forced to centre — it can shift within ≥CLEAR_COLS clear columns); a 1-tile channel (both neighbours SOLID)
// yields no clear window → false (the wedge is correctly rejected). PURE + deterministic so the generator
// (placement guard + spawn filter) and the verifier agree exactly.
export function bodyStandClear(tiles: number[][], cols: number, rows: number, col: number, row: number): boolean {
  if (row < 1 || row >= rows - 1) return false
  if (tiles[row][col] !== TILE.EMPTY) return false
  // The CLEAR_COLS-windows whose span contains `col` have anchors leftCol ∈ [col-CLEAR_COLS+1, col]. For
  // CLEAR_COLS=2 that's {col-1, col}; the loop generalizes so a future CLEAR_COLS>2 re-tune needs no edit here.
  for (let lc = col - CLEAR_COLS + 1; lc <= col; lc++) {
    if (!bodyFits(tiles, cols, rows, lc, row)) continue
    for (let c = lc; c < lc + CLEAR_COLS; c++) {
      const below = tiles[row + 1][c]
      if (below === TILE.SOLID || below === TILE.ONEWAY) return true
    }
  }
  return false
}

// ── headroomClear(runs, run) → boolean (body-aware-clearance §6.3/§7b — the builder-side DEFENSIVE guard) ──
// True iff no prior run sits within the body's headroom band — rows [run.row-CLEAR_ROWS .. run.row-1] — over
// columns that overlap `run`'s span, so a 36×52 body can stand on `run`'s top and jump. The builders place
// platform RECORDS and `tiles` is stamped only after they return, so this reasons about the same geometry on the
// records that bodyStandClear later sees in the emitted grid. DEAD CODE at current budgets — every builder places
// `next` horizontally gap-separated from `prev` and monotone/descending, so no prior run ever lands in the band
// (§7b) — but it makes a future overlap-introducing template fail safe (truncate) rather than emit a wedge.
function headroomClear(runs: Platform[], run: Platform): boolean {
  const lo = run.row - CLEAR_ROWS
  const hi = run.row - 1
  const rLeft = run.col
  const rRight = run.col + run.len - 1
  for (const p of runs) {
    if (p.row < lo || p.row > hi) continue // not in the headroom band above `run`.
    if (p.col + p.len - 1 < rLeft || p.col > rRight) continue // no column overlap → no ceiling over `run`.
    return false
  }
  return true
}

// ── Module-load soundness assertions (Decision 35) ── prove the named budgets sit INSIDE the
// physical envelope, so a future one-line re-tune that breaks reach fails LOUDLY here (not by
// silently emitting unreachable "verified" levels). Runs once at import (cheap; node + browser).
;(function assertBudgetsSound() {
  // The worst horizontal case is at the worst (max-up) vertical step: prove MAX_GAP fits there.
  const reachAtMaxUp = rawReachPx(-MAX_STEP_UP * TILE_SIZE)
  if (MAX_GAP * TILE_SIZE > reachAtMaxUp) {
    throw new Error(
      `LevelGenerator: MAX_GAP (${MAX_GAP} tiles = ${MAX_GAP * TILE_SIZE}px) exceeds the coupled ` +
        `reach at MAX_STEP_UP (${reachAtMaxUp.toFixed(1)}px). Re-tune MAX_GAP/MAX_STEP_UP or the ` +
        `player physics mirror — the staircase would emit unreachable jumps (AC27 violated).`,
    )
  }
  // MAX_STEP_UP must itself be physically climbable (within the apex), independent of horizontal.
  if (MAX_STEP_UP * TILE_SIZE > APEX_H) {
    throw new Error(
      `LevelGenerator: MAX_STEP_UP (${MAX_STEP_UP} tiles) exceeds the apex climb (${APEX_H.toFixed(1)}px).`,
    )
  }
  // ── Body-clearance budget (body-aware-clearance §6.1, AC4) ── prove the 36×52 body fits the tile-
  // discretized clearance footprint, so a future body/tile re-tune fails LOUD instead of silently emitting
  // wedges the point-mass reach proof can't see. CLEAR_COLS/CLEAR_ROWS are ceil-derived, so these guard a
  // hand-edit that breaks the derivation (e.g. hardcoding CLEAR_COLS=1 or bumping BODY_W past 2 tiles).
  if (CLEAR_COLS * TILE_SIZE < BODY_W) {
    throw new Error(`LevelGenerator: CLEAR_COLS (${CLEAR_COLS}) too small — body width ${BODY_W}px > ${CLEAR_COLS * TILE_SIZE}px clearance.`)
  }
  if (CLEAR_ROWS * TILE_SIZE < BODY_H) {
    throw new Error(`LevelGenerator: CLEAR_ROWS (${CLEAR_ROWS}) too small — body height ${BODY_H}px > ${CLEAR_ROWS * TILE_SIZE}px clearance.`)
  }
  // The recovery stone row (floorRow − RECOVERY_REMOUNT_UP) is LOAD-BEARING for CLEAR_ROWS headroom UNDER a
  // stone: a body on the floor occupies CLEAR_ROWS rows, so the stone must sit strictly above them ⇒
  // RECOVERY_REMOUNT_UP ≥ CLEAR_ROWS + 1. This keeps the point-mass floor-recovery proof and the body-aware
  // clearance proof from silently diverging — a re-tune of RECOVERY_REMOUNT_UP/BODY_H trips HERE first.
  if (RECOVERY_REMOUNT_UP < CLEAR_ROWS + 1) {
    throw new Error(`LevelGenerator: RECOVERY_REMOUNT_UP (${RECOVERY_REMOUNT_UP}) < CLEAR_ROWS+1 (${CLEAR_ROWS + 1}) — a body on the floor under a recovery stone would lack headroom.`)
  }
})()

// ── Helpers (pure) ──
const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
// Seeded integer in [lo, hi] inclusive (the only integer draw the generator uses — keep it DRY).
const randInt = (rng: RNG, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1))

// Stamp a horizontal SOLID run of length `len` at (col,row) into the grid (the staircase platform).
// Clamps to the grid so a run near the edge never writes out of bounds (defensive — KISS).
function stampRun(
  tiles: number[][],
  cols: number,
  rows: number,
  col: number,
  row: number,
  len: number,
  type: number,
): void {
  if (row < 0 || row >= rows) return
  const c0 = clampInt(col, 0, cols - 1)
  const c1 = clampInt(col + len - 1, 0, cols - 1)
  for (let c = c0; c <= c1; c++) tiles[row][c] = type
}

// Merge each contiguous horizontal run of a given tile `type` per row into one {col,row,len,type}
// (Decision 37). Computed here so TileMap (bodies) + the verifier (graph) reuse it (DRY) instead of
// re-scanning. Walls/floor SOLID runs are included for SOLID; ONEWAY runs are merged separately.
function mergeRuns(tiles: number[][], cols: number, rows: number, type: number): Platform[] {
  const runs: Platform[] = []
  for (let row = 0; row < rows; row++) {
    let c = 0
    while (c < cols) {
      if (tiles[row][c] === type) {
        const start = c
        while (c < cols && tiles[row][c] === type) c++
        runs.push({ col: start, row, len: c - start, type })
      } else {
        c++
      }
    }
  }
  return runs
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// LAYOUT TEMPLATES (Enrichment round-2 — the level-shape variety) — see generateLevel step 3 header.
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Each builder consumes the MAIN rng + a shared `ctx` ({cols,rows,floorRow,platformRows,interiorMax,
// lenMin,lenMax}) and RETURNS a `critical[]` chain of {col,row,len,type:SOLID} platforms ordered
// entrance … exit, where EVERY consecutive pair satisfies the SHARED canReachStep (so the verifier's
// generic BFS proves traversability for ANY template — Decision 36/AC27). They reuse makeRun (interior
// clamp) + canReachPlatform (the reach proof) so a new template can never emit an unreachable jump.

// Below this grid width the template pick is FORCED to 'staircase' (the pinned 40-col config is below
// it, so its tiles are byte-unchanged). Every real biome (≥64 cols) is above it → gets the variety.
const LAYOUT_MIN_COLS = 50

// The known layout-template ids (Enrichment round-2) — exported so the verifier asserts every generated
// `template` is one of these AND that the SHAPE space is actually used (no dead template) across the sweep.
export const LAYOUT_TEMPLATES: string[] = ['staircase', 'shaft', 'islands']

// Default template WEIGHTS (Enrichment round-2). A biome may override via `layoutWeights` (config/biomes.js)
// to flavour its shape mix; absent ⇒ this shared default. Staircase keeps the highest weight (it's the
// readable baseline); shaft/islands add spatial surprise. Picked off the off-the-main-thread tplRng.
const DEFAULT_LAYOUT_WEIGHTS: WeightedChoice[] = [
  { id: 'staircase', w: 3 },
  { id: 'shaft', w: 2 },
  { id: 'islands', w: 2 },
]

// ── selectTemplate(cols, biomeConfig, rng) → a template id ── narrow grids (the pin) ALWAYS get the
// staircase (byte-stable); otherwise a weighted seeded pick over the biome's (or the default) weights.
// rng is the OFF-THE-MAIN-THREAD sub-RNG so the main draw sequence — and the pin — is untouched (header).
function selectTemplate(cols: number, biomeConfig: GeneratorBiomeConfig, rng: RNG): string {
  if (cols < LAYOUT_MIN_COLS) return 'staircase' // the pin grid + any tiny room → the stable default.
  const weights = biomeConfig.layoutWeights && biomeConfig.layoutWeights.length ? biomeConfig.layoutWeights : DEFAULT_LAYOUT_WEIGHTS
  const total = weights.reduce((s, e) => s + (e.w || 1), 0)
  let r = rng() * total
  for (const entry of weights) {
    r -= entry.w || 1
    if (r <= 0) return entry.id
  }
  return weights[weights.length - 1].id // float-rounding fallthrough → the last id (KISS).
}

// ── buildStaircase(rng, ctx) → critical[] ── the ORIGINAL left→right reach-bounded walk (verbatim, so a
// staircase level's main-rng draw sequence — and thus the regression pin — is byte-identical). Start the
// entrance platform on the left a couple rows up; repeatedly place the next platform a seeded (gap, step)
// away that canReachStep accepts, until the walk passes the right margin (the last platform holds the exit).
function buildStaircase(rng: RNG, { platformRows, interiorMax, lenMin, lenMax }: TemplateCtx): Platform[] {
  const rightMargin = 3 // stop the walk this many cols before the right wall.
  const startRow = clampInt(platformRows - randInt(rng, 0, 2), 2, platformRows)
  const critical = [makeRun(2, startRow, randInt(rng, lenMin, lenMax), interiorMax)]
  let guard = 0
  while (guard++ < 10000) {
    const prev = critical[critical.length - 1]
    const prevRight = prev.col + prev.len - 1
    if (prevRight >= interiorMax - rightMargin) break // reached the right side → done.

    const gap = randInt(rng, MIN_GAP, MAX_GAP)
    const drawnStep = randInt(rng, -MAX_STEP_UP, MAX_STEP_DOWN)
    const nextRow = clampInt(prev.row + drawnStep, 2, platformRows)
    const next = makeRun(prevRight + gap, nextRow, randInt(rng, lenMin, lenMax), interiorMax)

    // PROOF (defensive): the emitted pair must pass the SHARED predicate. With sane budgets this always
    // holds; if a future widening breaks it, pull the gap to the minimum (always in-reach).
    if (!canReachPlatform(prev, next)) {
      const pulled = makeRun(prevRight + MIN_GAP, nextRow, next.len, interiorMax)
      if (!canReachPlatform(prev, pulled)) break // truly stuck (cannot happen with sane budgets).
      if (!headroomClear(critical, pulled)) break // body-aware-clearance §6.3 (defensive — dead code at current budgets).
      critical.push(pulled)
      continue
    }
    if (next.col <= prevRight) break // clamp fused it flush against prev (at the wall) → stop.
    if (!headroomClear(critical, next)) break // body-aware-clearance §6.3 (defensive — dead code at current budgets).
    critical.push(next)
  }
  return critical
}

// ── buildShaft(rng, ctx) → critical[] ── a VERTICAL descent: the entrance sits HIGH on the left; each
// step drops DOWN a reach-bounded amount, zig-zagging left/right across the interior so the chain reads
// as a switchback shaft rather than a wall of ledges. The exit lands LOW on the right. Falling is always
// in reach (a downward step only grows air time), and every pair is re-proven via canReachPlatform, so
// the shaft is traversable BY CONSTRUCTION (AC27). Walks until it reaches near the floor OR a step cap.
function buildShaft(rng: RNG, { rows, platformRows, interiorMax, lenMin, lenMax }: TemplateCtx): Platform[] {
  const topRow = clampInt(2 + randInt(rng, 0, 1), 2, platformRows) // start near the ceiling.
  // Entrance on the LEFT third so the player drops in up high; the chain switchbacks down-right.
  const startCol = clampInt(2 + randInt(rng, 0, 3), 1, Math.max(2, Math.floor(interiorMax / 3)))
  const critical = [makeRun(startCol, topRow, randInt(rng, lenMin, lenMax), interiorMax)]
  const bottomRow = platformRows // the lowest a platform sits (one above the floor).
  let dir = 1 // current horizontal travel direction (1 = right, -1 = left); flips at the walls.
  let guard = 0
  while (guard++ < 10000) {
    const prev = critical[critical.length - 1]
    if (prev.row >= bottomRow - 1) break // reached the bottom band → the exit platform is placed.

    // Drop a seeded DOWN step (1..MAX_STEP_DOWN). Down steps are always reachable (more air time).
    const drop = randInt(rng, 2, MAX_STEP_DOWN)
    const nextRow = clampInt(prev.row + drop, 2, bottomRow)
    // Move horizontally by a reach-bounded gap in the current direction; flip at the interior edges so
    // the column zig-zags (a switchback). The gap is small (within MAX_GAP) so the diagonal is jumpable.
    const gap = randInt(rng, MIN_GAP, MAX_GAP)
    const len = randInt(rng, lenMin, lenMax)
    const prevLeft = prev.col
    const prevRight = prev.col + prev.len - 1
    let col = dir > 0 ? prevRight + gap : prevLeft - gap - len + 1
    // Flip direction if we'd spill past a wall; recompute the column on the new heading.
    if (col + len - 1 > interiorMax || col < 1) {
      dir = -dir
      col = dir > 0 ? prevRight + gap : prevLeft - gap - len + 1
    }
    const next = makeRun(col, nextRow, len, interiorMax)
    if (!canReachPlatform(prev, next)) {
      // Pull horizontally to the minimum gap on the current heading (a steeper but still-reachable drop).
      const pulledCol = dir > 0 ? prevRight + MIN_GAP : prevLeft - MIN_GAP - len + 1
      const pulled = makeRun(pulledCol, nextRow, len, interiorMax)
      if (!canReachPlatform(prev, pulled)) break // truly stuck (cannot happen with sane budgets).
      if (!headroomClear(critical, pulled)) break // body-aware-clearance §6.3 (defensive — dead code at current budgets).
      critical.push(pulled)
      continue
    }
    // Reject a no-advance clamp (the run fused onto prev's span at the same row) so the shaft progresses.
    if (next.row === prev.row && next.col + next.len - 1 >= prevLeft && next.col <= prevRight) break
    if (!headroomClear(critical, next)) break // body-aware-clearance §6.3 (defensive — dead code at current budgets).
    critical.push(next)
  }
  return critical
}

// ── buildIslands(rng, ctx) → critical[] ── a WIDE arena of floating islands at VARIED heights: the chain
// hops left→right like the staircase BUT each platform's row swings freely up AND down within the reach
// envelope (a bouncier, more open traverse than the monotone staircase), and the gaps trend a touch wider
// so the room reads as scattered islands rather than a continuous stair. Entrance low-left, exit right.
// Every hop is re-proven via canReachPlatform (AC27). The decoration scatter later hangs one-way ledges
// in the open airspace, completing the "floating islands" read.
function buildIslands(rng: RNG, { platformRows, interiorMax, lenMin, lenMax }: TemplateCtx): Platform[] {
  const rightMargin = 3
  const startRow = clampInt(platformRows - randInt(rng, 0, 1), 2, platformRows) // low-left entrance.
  const critical = [makeRun(2, startRow, randInt(rng, lenMin, lenMax), interiorMax)]
  let guard = 0
  while (guard++ < 10000) {
    const prev = critical[critical.length - 1]
    const prevRight = prev.col + prev.len - 1
    if (prevRight >= interiorMax - rightMargin) break

    // A WIDER gap bias (islands are scattered) but still ≤ MAX_GAP so it stays jumpable.
    const gap = randInt(rng, Math.min(2, MAX_GAP), MAX_GAP)
    // The height swings freely up/down within the envelope — try an up step OR a down step (a bouncy ride).
    const drawnStep = randInt(rng, -MAX_STEP_UP, MAX_STEP_DOWN)
    const nextRow = clampInt(prev.row + drawnStep, 2, platformRows)
    const len = randInt(rng, lenMin, lenMax)
    const next = makeRun(prevRight + gap, nextRow, len, interiorMax)
    if (!canReachPlatform(prev, next)) {
      // First try pulling the gap in; if the height swing itself is too steep, flatten the step toward prev.
      const pulled = makeRun(prevRight + MIN_GAP, nextRow, len, interiorMax)
      if (canReachPlatform(prev, pulled) && pulled.col > prevRight && headroomClear(critical, pulled)) {
        critical.push(pulled)
        continue
      }
      const flatRow = clampInt(prev.row - Math.min(MAX_STEP_UP, Math.abs(prev.row - nextRow)), 2, platformRows)
      const flattened = makeRun(prevRight + MIN_GAP, flatRow, len, interiorMax)
      if (!canReachPlatform(prev, flattened)) break
      if (flattened.col <= prevRight) break
      if (!headroomClear(critical, flattened)) break // body-aware-clearance §6.3 (defensive — dead code at current budgets).
      critical.push(flattened)
      continue
    }
    if (next.col <= prevRight) break
    if (!headroomClear(critical, next)) break // body-aware-clearance §6.3 (defensive — dead code at current budgets).
    critical.push(next)
  }
  return critical
}

// ── generateLevel(seed, biomeConfig) → level description (the contract — design §6.2) ──
// PURE. ONE mulberry32(seed) threads the whole generation so the SAME (seed, biome) is byte-
// identical (AC19). Returns plain data (no functions) so it serializes for the regression pin.
export function generateLevel(seed: number, biomeConfig: GeneratorBiomeConfig): LevelDescription {
  // ── BOSS-ARENA MODE (design §6.6.2, Decision 66, AC57) ── when GameScene passes a shallow-merged
  // { ...biome, bossArena: true } for the boss level, emit a SIMPLE flat walled room instead of the
  // staircase walk. It returns the SAME description SHAPE (so TileMap is unchanged) but with a DISTINCT
  // contract (NO exit Door point, enemies:[], pickups:[], a bossSpawn, isBossArena:true). The headless
  // verifier runs this branch through a SEPARATE assertion path (checkBossArena), NOT checkDescription
  // (whose exit/traversability checks would reject a no-exit arena — the review BLOCKER). KISS: one
  // floor → trivially traversable + reach-bounded by construction (nothing to fail).
  if (biomeConfig.bossArena === true) return generateBossArena(seed, biomeConfig)

  const rng = mulberry32(seed)

  // ── 1) Dimensions (AC28) ── clamp the biome's cols/rows into the GLOBAL bounds (config/biomes.js
  // owns COLS_MIN/MAX + ROWS_MIN/MAX — the single source the verifier also asserts against). The
  // shipped biome's values are already in range, but clamping makes the bound the source of truth,
  // so the verifier's "cols/rows within [MIN,MAX]" passes by construction (AC28).
  const cols = clampInt(biomeConfig.cols, COLS_MIN, COLS_MAX)
  const rows = clampInt(biomeConfig.rows, ROWS_MIN, ROWS_MAX)

  // Initialize the grid to EMPTY (a rows×cols Int array; row-major, tiles[row][col]).
  const tiles: number[][] = []
  for (let r = 0; r < rows; r++) tiles.push(new Array(cols).fill(TILE.EMPTY))

  // ── 2) Room shell: floor band + side walls (Decision: step 2) ──
  // Floor band = the BOTTOM row is SOLID (the ground the staircase sits above; catches falls). Side
  // columns are SOLID walls (room edges; keep spawns off the very edge + the player in-room — world
  // bounds also catch it). The floor is the player's ultimate footing if they miss a platform.
  const floorRow = rows - 1
  for (let c = 0; c < cols; c++) tiles[floorRow][c] = TILE.SOLID
  for (let r = 0; r < rows; r++) {
    tiles[r][0] = TILE.SOLID
    tiles[r][cols - 1] = TILE.SOLID
  }

  // ── 3) The reach-bounded CRITICAL PATH — picked from a seeded TEMPLATE set (Enrichment round-2) ──
  // The single deterministic left→right staircase was the #1 replay gap: every room across all biomes
  // had the SAME shape, only the enemy/colour mix varied. We now pick ONE of several LAYOUT TEMPLATES
  // off the seed (selectTemplate), each of which builds a `critical[]` chain of {col,row,len} platforms
  // (entrance … exit, in order) where EVERY consecutive pair satisfies the SHARED canReachStep predicate
  // — so traversability holds BY CONSTRUCTION for every template (the verifier's BFS re-proves it
  // generically, Decision 36, AC27). The templates are:
  //   • 'staircase'  — the original left→right reach-bounded walk (the pinned default).
  //   • 'shaft'      — a VERTICAL descent: a zig-zag column of ledges from a high entrance down to a low
  //                    exit (each step within the down-reach; falling is always in reach).
  //   • 'islands'    — a WIDE arena of floating one-way-topped SOLID islands at varied heights, chained
  //                    near-edge-to-near-edge so each hop is reach-bounded (a bouncy traverse).
  //
  // PIN SAFETY (the load-bearing constraint): the regression pin uses cols:40 (< LAYOUT_MIN_COLS), and
  // selectTemplate ALWAYS returns 'staircase' below that width — so the pinned 40-col grid is byte-
  // identical (the template pick never even draws for it). The template SELECTION uses an OFF-THE-MAIN-
  // THREAD sub-RNG (like the treasure branch) so it consumes NO draw from the main `rng` thread; each
  // template then threads the SAME main `rng` it always did, so a staircase level's draw sequence — and
  // thus the pin — is unchanged. New templates only widen the SHAPE space for real (≥ LAYOUT_MIN_COLS)
  // biomes (PRISON 64 / SEWERS 76 / CATACOMBS 82 / RAMPARTS 88 all qualify).
  const [lenMin, lenMax] = biomeConfig.platformLenRange
  const platformRows = floorRow - 1 // platforms live in rows [1 .. floorRow-1] (above the floor).
  const interiorMax = cols - 2 // last interior column (cols-1 is the right wall).
  const tplCtx = { cols, rows, floorRow, platformRows, interiorMax, lenMin, lenMax }

  // Pick the template off a seeded sub-RNG (off the main thread — pin-safe; see header). Below
  // LAYOUT_MIN_COLS it is forced to 'staircase' so the narrow pin grid is byte-unchanged.
  const tplRng = mulberry32((seed ^ 0x7e3415a7) >>> 0)
  const template = selectTemplate(cols, biomeConfig, tplRng)

  // Build the chosen template's critical chain off the MAIN rng (so the staircase path's draw sequence —
  // and the pin — is identical). Each builder RETURNS the {col,row,len} chain (entrance … exit).
  const critical =
    template === 'shaft'
      ? buildShaft(rng, tplCtx)
      : template === 'islands'
        ? buildIslands(rng, tplCtx)
        : buildStaircase(rng, tplCtx)

  // Stamp every critical platform into the grid as a SOLID run (records already match the interior).
  for (const p of critical) stampRun(tiles, cols, rows, p.col, p.row, p.len, TILE.SOLID)

  // ── 4) entrance / exit cells (Decision: step 4, AC28) ── the standable EMPTY cell directly ABOVE
  // the first/last platform's top tile (feet on the platform). Distinct + in-bounds by construction
  // (the walk always emits ≥2 platforms across a 40+ col room; asserted in the verifier too).
  const first = critical[0]
  const last = critical[critical.length - 1]
  const entrance = cellAbove(first)
  const exit = cellAbove(last)

  // ── 4.5) Optional TREASURE BRANCH (design §6.14, Decision 80, AC67) ── a seeded off-critical-path
  // detour: 1–2 SOLID platforms hung UP off a mid-critical platform (each step reach-bounded by the SHARED
  // canReachStep, so the branch is reachable BY CONSTRUCTION — the verifier BFS proves it), ending in a
  // treasure platform whose standable top is `branchTreasure`. The MAIN entrance→exit staircase is
  // UNTOUCHED (the branch only ADDS nodes), so the reachability guarantee for the critical path holds — the
  // branch is a risk/reward side path, not a gate. GameScene places a guaranteed reward (gold/scroll/weapon/
  // heal) at branchTreasure (sourced SCENE-SIDE off the seed, like the weapon pickup — so it's NOT a
  // generator pickup and the level pin stays intact). Uses a SEPARATE seeded sub-RNG (off the main `rng`
  // thread) so the main draw sequence — and thus the regression pin — is byte-unchanged, AND it is GATED on
  // a min grid width so the tiny 40-col PIN config emits NO branch (the pinned tiles are unaffected — the
  // pin's cols:40 < BRANCH_MIN_COLS). Stamped BEFORE the decoration scatter so the branch tiles are part of
  // the occupied mask (decoration never overwrites the branch).
  const branchRng = mulberry32((seed ^ 0xb2a4c11) >>> 0) // off-the-main-thread (pin-safe) branch RNG.
  const branchTreasure = placeBranch(tiles, cols, rows, critical, branchRng, lenMin, lenMax, entrance, exit)

  // ── 4.55) Wall-corner escape (wall-corner-escape fix) ── carve a clear-sky channel beside each side wall in the
  // low band so a player knocked/fallen into either bottom corner can jump STRAIGHT out (no overhang bonk). Runs
  // HERE — AFTER critical + branch are stamped, but BEFORE the floor-recovery pass — so recovery re-derives its
  // gaps from the CLEARED grid (its reconnection proof stays valid) and its stones + the later decoration both
  // STAY OUT of the corner columns (reserved below), leaving the corner provably clear. Trimming a platform's
  // wall-end never breaks the critical path: the staircase travels RIGHTWARD, so a near-wall left-edge trim leaves
  // every downstream near-edge gap (and the reach BFS) unchanged (the verifier re-proves it from the emitted tiles).
  openWallCorners(tiles, cols, rows, entrance, exit)

  // ── 4.6) Floor-recovery BRIDGES (floor-recovery-ledges design, AC1/AC2) ── stamp SOLID stepping-stones
  // across any floor stretch that lacks a nearby re-mount, so a player who falls to the floor can always
  // climb back to the exit LOCALLY (the verifier proves the locality bound). Off a SEPARATE seeded sub-RNG
  // (off the main `rng` thread) so the main draw sequence — and the regression pin — is byte-unchanged, and
  // gated on grid width so the cols:40 pin emits no stones. Stamped BEFORE the occupied mask + decoration so
  // the stones join the mask (decoration never overwrites them) and feed collectStandable.
  const recoveryRng = mulberry32((seed ^ 0x5eca1add) >>> 0) // off-the-main-thread (pin-safe) recovery RNG.
  const recovery = placeRecoveryBridges(tiles, cols, rows, recoveryRng, lenMin, lenMax, entrance, exit)

  // ── 5) Off-critical-path decoration (Decision: step 5) ── scatter ONEWAY ledges + HAZARD tiles at
  // seeded positions that are NOT on the critical path, so they never block the guaranteed route. We
  // additionally keep HAZARDs out of the swept JUMP CORRIDOR between consecutive critical platforms
  // (review MINOR — the player's real trajectory, not just the platform graph), so the "traversable"
  // guarantee holds for the actual path the player walks, not merely the BFS abstraction.
  const occupied = buildOccupiedMask(tiles, cols, rows) // SOLID/ONEWAY/HAZARD cells (can't decorate).
  const corridor = buildJumpCorridorMask(critical, cols, rows) // airspace the player flies through.

  // §6.14 (Decision 80, AC67) — RESERVE the branch treasure cell from decoration: it's EMPTY (so not in the
  // occupied mask), but a scattered ledge/hazard could otherwise land ON it and make the treasure ledge
  // un-standable (the verifier's standable check would fail). Mark it occupied so decoration skips it.
  if (branchTreasure) occupied[branchTreasure.row][branchTreasure.col] = true

  // Floor-recovery (AC4) — RESERVE each recovery stone's TOP row (the cell the player stands on while
  // climbing) from decoration, so a scattered hazard/ledge never lands on the recovery path. Same pattern
  // as the branch-treasure reservation above. (The floor walk lane itself is kept hazard-free in scatterHazards.)
  for (const s of recovery) {
    const topRow = s.row - 1
    if (topRow >= 0) for (let c = s.col; c < s.col + s.len; c++) occupied[topRow][c] = true
  }

  // Wall-corner escape (wall-corner-escape fix): RESERVE the cleared corner channel (the two interior columns beside
  // each side wall, across the low band) from decoration, so a scattered ONEWAY/HAZARD never re-fills the clear-sky
  // jump-out openWallCorners just carved. Gated on grid width like the pass (the cols:40 pin emits no corner clear).
  if (cols >= RECOVERY_MIN_COLS) {
    const floorRow = rows - 1
    const top = Math.max(1, floorRow - CORNER_OPEN_ROWS)
    for (const c of [1, 2, cols - 3, cols - 2]) {
      if (c < 1 || c > cols - 2) continue
      for (let r = top; r < floorRow; r++) occupied[r][c] = true
    }
  }

  scatterOneWayLedges(tiles, cols, rows, rng, biomeConfig.oneWayLedges, occupied, corridor, lenMin, lenMax)
  scatterHazards(tiles, cols, rows, rng, biomeConfig.hazardPatches, occupied, corridor)

  // ── 6) Standable-cell set + spawns (Decision 38, AC28) ── scan ONCE for every EMPTY cell with a
  // SOLID/ONEWAY directly below = standable ground. Draw enemy + pickup spawns from it via the RNG,
  // excluding cells too near the entrance (no frame-1 ambush) and the exit. Enemy count is clamped
  // to the biome band. ENEMY spawns additionally require a MIN-WIDTH platform run under them so the
  // enemy has room to patrol (Decision 41 / review MAJOR) — see standableForEnemies().
  // collectStandable excludes the entrance band + the exit cell + the branch TREASURE cell (so a normal
  // enemy/pickup never spawns ON the treasure spot — GameScene reserves it for the branch reward, §6.14).
  // body-aware-clearance §6.3 (AC2): filter the standable pool to BODY-clear cells so every enemy/pickup spawn
  // has the 36×52 footprint (≥CLEAR_ROWS headroom in a ≥CLEAR_COLS window) by construction — no spawn is buried
  // under a low ledge. Pure post-filter before pickSpawns; on the cols:40 staircase pin nothing sits above a
  // platform so it removes ZERO cells (pickSpawns gets an identical list → pin enemies/pickups unchanged).
  const standableAll = collectStandable(tiles, cols, rows, entrance, exit, branchTreasure).filter((s) =>
    bodyStandClear(tiles, cols, rows, s.col, s.row),
  )
  const standableEnemy = standableAll.filter((s) => s.runLen >= MIN_ENEMY_PLATFORM_TILES)

  const enemyCount = clampInt(randInt(rng, biomeConfig.minEnemies, biomeConfig.maxEnemies), 0, standableEnemy.length)
  const enemyCells = pickSpawns(rng, standableEnemy, enemyCount)
  const enemies = enemyCells.map(enemySpawnFromCell)

  // ── spawnCandidates[] (design §6.4, Decision 45 / review MAJOR — enemyCountBonus source) ── the
  // SURPLUS standable-enemy cells NOT already used by `enemies`, mapped to the SAME enemy-spawn shape
  // (DRY via enemySpawnFromCell). Phase 4's depth-scaled `enemyCountBonus` draws extra spawns from
  // THIS list (up to the biome's maxEnemies) so "more enemies at depth" is IMPLEMENTABLE without the
  // scene re-deriving standable cells (a DRY violation the review flagged) and without silently
  // no-op'ing. Derived AFTER the RNG pick (a pure set-difference) so it consumes NO extra RNG draws —
  // the enemies/pickups output + the regression pin are UNCHANGED. Order is deterministic (the
  // collectStandable scan order), so a given seed yields the same candidate sequence (AC47).
  const chosenKeys = new Set(enemyCells.map((c) => `${c.col},${c.row}`))
  const spawnCandidates = standableEnemy
    .filter((c) => !chosenKeys.has(`${c.col},${c.row}`))
    .map(enemySpawnFromCell)

  const pickupCount = clampInt(randInt(rng, biomeConfig.minPickups, biomeConfig.maxPickups), 0, standableAll.length)
  const pickups = pickSpawns(rng, standableAll, pickupCount).map((cell) => ({
    ...worldFromStandable(cell),
    kind: rng() < 0.5 ? 'cell' : 'gold', // placeholder kinds (the economy is Phase 5 — YAGNI).
  }))

  // ── 7) platforms[] (Decision 37) ── merge SOLID + ONEWAY runs for TileMap (bodies) + the verifier
  // (graph). Computed from the EMITTED grid so it reflects exactly what's there (independent check).
  const solidRuns = mergeRuns(tiles, cols, rows, TILE.SOLID)
  const oneWayRuns = mergeRuns(tiles, cols, rows, TILE.ONEWAY)
  const platforms = solidRuns.concat(oneWayRuns)

  return {
    cols,
    rows,
    tileSize: TILE_SIZE,
    worldWidth: cols * TILE_SIZE,
    worldHeight: rows * TILE_SIZE,
    tiles, // rows×cols Int array (EMPTY|SOLID|ONEWAY|HAZARD).
    entrance,
    exit,
    platforms, // merged SOLID + ONEWAY runs (Decision 37).
    enemies, // standable world spawn points + patrol bounds + spec.
    spawnCandidates, // SURPLUS enemy spawns for the depth-scaled enemyCountBonus (Decision 45).
    pickups, // standable world spawn points + kind.
    branchTreasure, // §6.14 (Decision 80) — the optional branch's treasure standable point, or null.
    template, // Enrichment round-2 — the layout template id chosen for this level ('staircase'|'shaft'|'islands').
    seed,
    biomeId: biomeConfig.id,
  }
}

// ── generateBossArena(seed, biomeConfig) → a boss-arena description (design §6.6.2, Decision 66, AC57) ──
// PURE. A FLAT walled room: a full-width SOLID floor, SOLID side walls + ceiling, NO staircase, NO
// normal enemy/pickup spawns, NO exit Door point. A central `entrance` (the player drops in here, HP
// carried), a `bossSpawn` to the right of it, and a band of HAZARD tiles along part of the floor (the
// arena hazard — AC57; GameScene gives THESE static bodies in the boss room so they deal contact damage,
// the BLOCKER #1 fix). Returns the SAME description shape as generateLevel so TileMap is unchanged, plus
// `isBossArena:true` + `bossSpawn` and `enemies:[]`/`pickups:[]`/`spawnCandidates:[]` (no normal pool).
// IMPORTANT (review BLOCKER): this description has NO meaningful `exit` for a Door — the boss is the
// gate. We still emit an `exit` field EQUAL to the entrance ONLY as a harmless placeholder so any code
// reading desc.exit doesn't crash; GameScene's _buildBossLevel does NOT place a Door (it branches on
// isBossArena). The verifier routes this through checkBossArena (its own assertions), NOT
// checkDescription — so the exit===entrance placeholder never trips the exit≠entrance check.
//
// HAZARD BODIES (review BLOCKER #1): the hazard tiles are emitted into the grid as TILE.HAZARD here, but
// TileMap renders hazards body-less by default (Decision 29 — render-only). For the arena to deal
// contact damage GameScene calls tileMap.enableHazardBodies() in the boss room, which promotes each
// hazard rect to a STATIC Arcade body so the player×hazards overlap can actually fire (a normal level
// never calls it, so normal hazards stay render-only — the §6.4 balance is preserved).
function generateBossArena(seed: number, biomeConfig: GeneratorBiomeConfig): LevelDescription {
  // ── Arena WIDTH (missing-boss fix) ── a FIXED ~one-screen-plus width (BOSS_ARENA_COLS), NOT the biome's full
  // 88-col sprawl. At 88 (2816px ≈ 2.2 screens) the boss spawned ~one full screen RIGHT of the entrance and read
  // as "no boss" on entry; 50 (1600px) keeps the whole arena — incl. the boss at col ~36 — on screen when you
  // drop in, while leaving room for the boss DASH. Clamped into the shared bounds (AC28). rows stay the biome's.
  const cols = clampInt(BOSS_ARENA_COLS, COLS_MIN, COLS_MAX)
  const rows = clampInt(biomeConfig.rows, ROWS_MIN, ROWS_MAX)

  const tiles: number[][] = []
  for (let r = 0; r < rows; r++) tiles.push(new Array(cols).fill(TILE.EMPTY))

  // ── Shell: a full-width SOLID floor, SOLID side walls + ceiling (a sealed arena — no pit). ──
  const floorRow = rows - 1
  for (let c = 0; c < cols; c++) {
    tiles[floorRow][c] = TILE.SOLID
    tiles[0][c] = TILE.SOLID // a ceiling so the flyer-less arena reads as enclosed.
  }
  for (let r = 0; r < rows; r++) {
    tiles[r][0] = TILE.SOLID
    tiles[r][cols - 1] = TILE.SOLID
  }

  // ── Entrance: the player drops in left-of-center, feet on the floor. bossSpawn: right-of-center. ──
  const standRow = floorRow - 1 // the EMPTY cell directly above the floor (feet on the floor top).
  const entranceCol = clampInt(Math.floor(cols * 0.28), 2, cols - 3)
  const bossCol = clampInt(Math.floor(cols * 0.72), 3, cols - 3)
  const entrance = {
    col: entranceCol,
    row: standRow,
    x: (entranceCol + 0.5) * TILE_SIZE,
    y: (standRow + 0.5) * TILE_SIZE,
  }
  const bossSpawn = {
    col: bossCol,
    row: standRow,
    x: (bossCol + 0.5) * TILE_SIZE,
    // The boss is a tall body; spawn its CENTER a little above the floor so its base rests on it.
    y: (standRow + 0.5) * TILE_SIZE,
  }

  // ── Arena HAZARD band (AC57) ── a contiguous strip of HAZARD tiles ON the floor row's surface in the
  // CENTER of the arena (between the entrance and the boss), so crossing/positioning is dangerous but
  // there's safe footing at both ends. Replace the floor TOP at those columns with a HAZARD tile sitting
  // ON the floor (the floor SOLID stays beneath as footing geometry; the hazard renders on standRow).
  const hazStart = clampInt(Math.floor(cols * 0.42), entranceCol + 2, cols - 4)
  const hazEnd = clampInt(Math.floor(cols * 0.58), hazStart, bossCol - 2)
  for (let c = hazStart; c <= hazEnd; c++) {
    // Place the hazard on the standable row (it sits on the floor SOLID just below — never floating).
    if (tiles[standRow][c] === TILE.EMPTY) tiles[standRow][c] = TILE.HAZARD
  }

  // ── platforms[] (Decision 37) ── merge the SOLID runs for TileMap bodies (the floor/walls/ceiling).
  const solidRuns = mergeRuns(tiles, cols, rows, TILE.SOLID)

  return {
    cols,
    rows,
    tileSize: TILE_SIZE,
    worldWidth: cols * TILE_SIZE,
    worldHeight: rows * TILE_SIZE,
    tiles,
    entrance,
    // Placeholder exit === entrance (the boss is the gate, NO Door — see the header). The verifier's
    // boss-arena path never asserts exit≠entrance, so this is harmless.
    exit: { ...entrance },
    platforms: solidRuns,
    enemies: [], // the boss replaces the normal pool (AC57).
    spawnCandidates: [],
    pickups: [],
    branchTreasure: null, // §6.14 — the boss arena has no branch (the boss is the room).
    bossSpawn, // GameScene spawns the Boss here (Decision 66/67).
    isBossArena: true, // GameScene branches on this (no Door; wire the hazard overlap).
    seed,
    biomeId: biomeConfig.id,
  }
}

// ── Spawn / placement constants (Decision 38/41) ──
const ENTRANCE_SAFE_TILES = 5 // no enemy/pickup within this many tiles of the entrance (no ambush).
// An enemy only spawns on a run ≥ this wide (Decision 41 — review MAJOR). The Brute is bodyW=38px
// (~1.2 tiles); on a tiny 2–3 tile span its patrol bounds would clamp almost immediately and it
// would jitter at the edges. 5 tiles = 160px run → ~110px patrol span ≫ bodyW, so the patrol reads
// as real movement, not a twitch. The full-width FLOOR band keeps wide standable runs plentiful, so
// requiring 5 never starves spawns (verified: every seed still has enemies).
const MIN_ENEMY_PLATFORM_TILES = 5
const ENEMY_PATROL_INSET = 6 // px — inset the patrol bounds from the run edges so it never clamps into a wall.

// ── Treasure-branch constants (design §6.14, Decision 80, AC67) ──
// BRANCH_MIN_COLS gates the branch on grid WIDTH: the tiny 40-col PIN config (cols:40) is BELOW it, so the
// pin emits NO branch (its tiles are byte-unchanged — the pin holds). Every real biome (PRISON 64 / SEWERS
// 76 / RAMPARTS 88) is above it, so they get branches. BRANCH_STEPS is how many platforms the detour adds
// (a short 1–2 step climb to a treasure ledge — KISS, never a maze).
const BRANCH_MIN_COLS = 50 // skip the branch on narrow grids (the pin is 40 → unaffected).
const BRANCH_STEP_UP_MIN = 2 // tiles — the branch climbs UP (a reward you must work for), within reach.
const BRANCH_STEP_UP_MAX = MAX_STEP_UP // never exceed the jump-reach envelope (canReachStep enforces it).

// ── placeBranch(tiles, cols, rows, critical, rng, lenMin, lenMax) → branchTreasure | null (Decision 80) ──
// Hang a short UPWARD detour off a MID critical platform: 1–2 SOLID branch platforms, each a reach-bounded
// jump above the previous (validated by the SHARED canReachStep — so the verifier's BFS reaches them BY
// CONSTRUCTION), ending in a treasure ledge. Returns the treasure's standable cell (cellAbove the last
// branch platform) or null if no branch was placed (narrow grid / no room). The MAIN staircase is never
// touched — the branch only ADDS platforms — so the critical entrance→exit path stays traversable. PURE +
// deterministic (off the passed sub-RNG). Stamps SOLID runs into `tiles` (clamped to the interior).
function placeBranch(
  tiles: number[][],
  cols: number,
  rows: number,
  critical: Platform[],
  rng: RNG,
  lenMin: number,
  lenMax: number,
  entrance: LevelPoint,
  exit: LevelPoint,
): LevelPoint | null {
  if (cols < BRANCH_MIN_COLS) return null // narrow grid (the pin) → no branch (pin tiles unchanged).
  if (critical.length < 3) return null // need a mid platform to hang off of (not the entrance/exit).

  const interiorMax = cols - 2
  // Pick a MID critical platform (not the first/entrance or last/exit) as the branch base.
  const baseIdx = 1 + Math.floor(rng() * (critical.length - 2))
  const base = critical[baseIdx]

  // Build 1–2 branch platforms climbing UP from the base. Each step: a seeded UP step + a small gap, the
  // run placed to one side of the base. Validate reach with canReachStep; abort cleanly on a bad draw.
  let prev = base
  let last: Platform | null = null
  const steps = 1 + (rng() < 0.5 ? 1 : 0) // 1 or 2 branch platforms (KISS — a short detour).
  for (let i = 0; i < steps; i++) {
    const up = BRANCH_STEP_UP_MIN + Math.floor(rng() * (BRANCH_STEP_UP_MAX - BRANCH_STEP_UP_MIN + 1))
    const nextRow = clampInt(prev.row - up, 2, rows - 2)
    const gap = randInt(rng, MIN_GAP, MAX_GAP)
    const len = randInt(rng, lenMin, lenMax)
    // Place the branch run to the RIGHT of the base's near edge (or left if it would spill past the wall).
    let col = prev.col + prev.len - 1 + gap
    if (col + len - 1 > interiorMax) col = clampInt(prev.col - gap - len, 1, interiorMax)
    const run = makeRun(col, nextRow, len, interiorMax)
    // The branch must be REACHABLE from prev (the SHARED predicate — the BFS will agree). Bad draw → stop
    // with whatever we've placed so far (a 1-step branch is still a valid reward; none placed → null).
    if (!canReachPlatform(prev, run) || run.col <= prev.col + prev.len - 1) break
    // The branch must NOT stamp over (or sit its treasure-clear zone over) the entrance/exit cells — a SOLID
    // there would bury the exit's standable cell (a verifier "exit cell is not EMPTY" failure). Reject such
    // a run (stop the branch). Checked against BOTH the run's own row and its top-clear row, across its span.
    if (runOverlapsCell(run, entrance) || runOverlapsCell(run, exit)) break
    // body-aware-clearance §6.3: the branch must not land in the CLEAR_ROWS HEADROOM BAND directly above the
    // entrance/exit OR any critical platform's standable top — a SOLID there leaves < CLEAR_ROWS clear rows so the
    // 36×52 body could no longer stand on / jump off that platform (the original "exit not body-clear" wedge). A
    // branch only ever ADDS reach (it must not degrade a platform the body relies on), so stop the branch here.
    if (runBuriesHeadroom(run, entrance) || runBuriesHeadroom(run, exit)) break
    if (critical.some((cp) => runBuriesHeadroom(run, cellAbove(cp)))) break
    // The branch's TOP must be CLEAR: every cell directly above the run (where the player stands + where
    // the treasure goes) must be EMPTY (no critical platform / wall overlapping it), else the treasure ledge
    // wouldn't be standable (the verifier's standable check). A bad overlap → stop (skip this + later steps).
    if (run.row - 1 < 0 || !runTopClear(tiles, run)) break
    stampRun(tiles, cols, rows, run.col, run.row, run.len, TILE.SOLID)
    last = run
    prev = run
  }
  if (!last) return null // no branch platform placed (a degenerate draw) → no treasure.
  return cellAbove(last) // the treasure stands on the LAST (highest) branch platform.
}

// True iff a run's SOLID body (run.row) OR its top-clear row (run.row-1) covers `cell` — used to keep a
// branch run from burying the entrance/exit standable cells (§6.14, Decision 80). Guards against a SOLID
// stamped over a goal cell AND against the branch's footing/treasure zone landing on one.
function runOverlapsCell(run: Platform, cell: LevelPoint | null): boolean {
  if (!cell) return false
  if (cell.col < run.col || cell.col >= run.col + run.len) return false
  return cell.row === run.row || cell.row === run.row - 1
}

// True iff `run`'s SOLID body sits in the CLEAR_ROWS-row body-HEADROOM band directly ABOVE `cell` (rows
// [cell.row-CLEAR_ROWS+1 .. cell.row]) over `cell`'s column — i.e. it would leave < CLEAR_ROWS clear rows above
// the standable `cell`, so the 36×52 body could no longer stand there. (A contiguous run that breaks the body's
// sliding window over cell.col must cover cell.col itself, so testing cell.col is exact.) body-aware-clearance §6.3.
function runBuriesHeadroom(run: Platform, cell: LevelPoint | null): boolean {
  if (!cell) return false
  if (cell.col < run.col || cell.col >= run.col + run.len) return false
  return run.row >= cell.row - CLEAR_ROWS + 1 && run.row <= cell.row
}

// True iff every cell in the body's headroom band ABOVE the run (rows [run.row-CLEAR_ROWS .. run.row-1],
// across its span) is EMPTY — so the run's top is a clear standable surface for the 36×52 body (no
// overlapping platform/wall within its standing height). Used so a branch platform's treasure ledge (and the
// player's footing on it) is guaranteed BODY-standable (§6.14 + body-aware-clearance §6.3): CLEAR_ROWS rows,
// not just 1, so a hung branch ledge always has real headroom. (At branch-placement time only shell + critical
// SOLID exist, so EMPTY here is equivalent to bodyFits' SOLID-free — scatter/one-ways come later.)
function runTopClear(tiles: number[][], run: Platform): boolean {
  const top = run.row - CLEAR_ROWS
  if (top < 0) return false
  for (let r = top; r < run.row; r++) {
    for (let c = run.col; c < run.col + run.len; c++) {
      if (tiles[r][c] !== TILE.EMPTY) return false
    }
  }
  return true
}

// ── placeRecoveryBridges(tiles, cols, rows, rng, lenMin, lenMax) → Platform[] (floor-recovery-ledges design) ──
// Lay horizontal SOLID stepping-stone BRIDGES across every floor stretch that lacks a nearby re-mount, so a
// player who FELL to the floor can always climb back to the exit LOCALLY instead of backtracking the whole
// level. Each stone sits at row floorRow-RECOVERY_REMOUNT_UP: the 52px player fits UNDER it (64px clearance),
// so the full-width floor stays contiguous (the floor→stone mount is an offset up-and-over hop launched from
// the open floor beside the stone), AND a SOLID top there is re-mountable from the floor (canReachStep(0,-3)
// is inside the envelope, proven by the module-load assertion). Stones are spaced ≤ MAX_GAP so consecutive
// stones are a canReachStep(≤4,0) hop (a same-row reach-chain), anchored within MAX_GAP of a bounding
// re-mount that is on the proven entrance→exit chain — so every stone reaches the exit (AC2).
//
// TOTAL by construction (Decision 9): a maximal uncovered gap's bottom band rows floorRow-1..floorRow-3 are
// provably EMPTY in the gap columns (any SOLID there would satisfy isRemountRun and cover the column,
// contradicting "uncovered"; only shell+critical+branch SOLID exist pre-decoration), so a stone is ALWAYS
// placeable; and every gap has ≥1 bounding re-mount (every layout template lands a SOLID critical platform in
// the band). Stones are confined to [2, cols-3] so they never fuse with a side wall in mergeRuns (Decision 13).
// PURE + deterministic (off the passed sub-RNG, off the main thread → pin-safe). Returns the stamped stones so
// the caller can reserve their tops from decoration. Gated on grid width so the cols:40 pin emits nothing.
function placeRecoveryBridges(
  tiles: number[][],
  cols: number,
  rows: number,
  rng: RNG,
  lenMin: number,
  lenMax: number,
  entrance: LevelPoint,
  exit: LevelPoint,
): Platform[] {
  if (cols < RECOVERY_MIN_COLS) return [] // narrow grid (the pin) → no recovery (pin tiles unchanged).
  const floorRow = rows - 1
  const stoneRow = floorRow - RECOVERY_REMOUNT_UP // the player fits UNDER this row; re-mountable from the floor.
  const stoneMax = cols - 3 // confine stones to [2, cols-3] so a stone never fuses with a side wall (Decision 13).
  if (stoneRow < 1 || stoneMax < 2) return [] // degenerate tiny grid (cannot happen for cols ≥ RECOVERY_MIN_COLS).

  // body-aware-clearance §6.3: when a goal cell (entrance/exit) is LOW enough that the stone row falls in its body
  // band [row-CLEAR_ROWS+1, row], a stone in its CLEAR_COLS-window would bury the goal's footprint (the
  // low-exit-at-stone-row wedge — the body bridges the gap beside the goal and the stone fills its window). Reserve
  // those columns so a stone never lands in a goal's body window. (The goal's own platform is its re-mount, so the
  // reserved column is covered for the floor-recovery locality proof.)
  const reservedCol = new Array(cols).fill(false)
  for (const g of [entrance, exit]) {
    if (stoneRow >= g.row - CLEAR_ROWS + 1 && stoneRow <= g.row) {
      for (let c = g.col - CLEAR_COLS + 1; c <= g.col + CLEAR_COLS - 1; c++) if (c >= 0 && c < cols) reservedCol[c] = true
    }
  }
  // Wall-corner escape (wall-corner-escape fix): the two interior columns beside each side wall are kept as a clear-sky
  // escape channel (openWallCorners clears them just above). The stone row sits IN that band, so a stone here would
  // re-introduce the corner overhang we just removed — reserve those columns so no stone lands in them. The corner is
  // covered for the floor-recovery LOCALITY proof by the clear-sky jump-out, not a stone (a ≤CLEAR_COLS leading/trailing
  // gap is within the recovery bound), so skipping them never strands the floor.
  for (const c of [1, 2, cols - 3, cols - 2]) if (c >= 0 && c < cols) reservedCol[c] = true

  // Re-derive the SOLID in-band re-mounts from the EMITTED grid (critical + branch + stones placed so far) so
  // the generator's gap view matches the verifier's, which reads the merged emitted tiles (DRY — same metric).
  const currentGaps = (): Array<[number, number]> =>
    floorRecoveryGaps(mergeRuns(tiles, cols, rows, TILE.SOLID).filter((p) => isRemountRun(p, floorRow, cols)), cols)

  const stones: Platform[] = []
  let guard = 0
  while (guard++ < 10000) {
    const gaps = currentGaps()
    if (gaps.length === 0) break // every floor stretch is within reach of a re-mount → done.
    let progressed = false
    for (const [lo, hi] of gaps) {
      // March stones left→right across [lo, min(hi, stoneMax)]: the first within MAX_GAP of the gap's left
      // bound (col lo-1 is covered, or the wall), each next MAX_GAP past the previous (a reach-chain hop +
      // a floor launch gap). The chain reaches within MAX_GAP of a bounding re-mount on at least one side.
      const right = Math.min(hi, stoneMax)
      let col = clampInt(lo, 2, stoneMax)
      while (col <= right) {
        while (col <= right && reservedCol[col]) col++ // skip a goal's reserved body-window columns (no stone there).
        if (col > right) break
        // Confine the stone to the gap [lo, hi] (clamp its right edge to `right`): a stone must NEVER spill
        // its length into a COVERED column, because a covered column is exactly where a re-mount AND any
        // standable cell (entrance/exit/branch) lives — spilling there would bury that cell (its support is
        // in the band, so its column is always covered, hence never in a gap). Confinement makes burial impossible.
        let len = randInt(rng, lenMin, lenMax)
        for (let k = 1; k < len; k++) if (reservedCol[col + k]) { len = k; break } // clip before a reserved column.
        const stone = makeRun(col, stoneRow, len, right)
        stampRun(tiles, cols, rows, stone.col, stone.row, stone.len, TILE.SOLID)
        stones.push(stone)
        progressed = true
        col = stone.col + stone.len - 1 + 1 + MAX_GAP // next stone ≤ MAX_GAP away (reach-chain + coverage + launch gap).
      }
    }
    if (!progressed) break // safety: nothing placeable (cannot happen by Decision 9) → never spin.
  }
  return stones
}

// ── openWallCorners(tiles, cols, rows, entrance, exit) (wall-corner-escape fix) ── carve a CLEAR_COLS-wide
// clear-sky channel in the two interior columns beside EACH side wall (cols 1..2 and cols-3..cols-2) across the
// low band [floorRow-CORNER_OPEN_ROWS, floorRow-1], so a player knocked/fallen into either bottom corner can jump
// STRAIGHT out (the obvious move) instead of bonking a platform edge that overhangs the corner. Clears SOLID/ONEWAY
// there EXCEPT the one cell directly supporting the entrance/exit (never strand a Door/spawn). PURE + deterministic
// (no RNG draw → the main rng sequence + the regression pin are untouched) and gated on grid width like the
// recovery/branch passes so the cols:40 pin emits nothing. Trimming a platform's wall-end never breaks the critical
// path: the staircase travels RIGHTWARD, so a near-wall left-edge trim leaves every downstream near-edge gap (and
// thus the reach BFS) unchanged — the headless verifier re-proves traversability + standability from the emitted tiles.
function openWallCorners(tiles: number[][], cols: number, rows: number, entrance: LevelPoint, exit: LevelPoint): void {
  if (cols < RECOVERY_MIN_COLS) return // narrow grid (the pin) → leave the corners as-is (pin tiles unchanged).
  const floorRow = rows - 1
  const top = Math.max(1, floorRow - CORNER_OPEN_ROWS) // never touch the ceiling row 0 / outside the band.
  // The EXIT is the reach-graph SINK: every entrance→exit and remount→exit climb funnels through the platforms in
  // its immediate neighbourhood (its approach within ~MAX_GAP). Trimming there can sever that final hop (and the
  // exit can itself sit in a corner — exit.col ∈ the cleared columns). So keep the clear ≥ EXIT_KEEPOUT columns from
  // the exit. The ENTRANCE is the SOURCE — trimming its platform's wall-end never disconnects a downstream node — so
  // the entrance corner (the reported bonk) IS cleared; its standable footing is preserved by the goal-support guard.
  const EXIT_KEEPOUT = MAX_GAP + 2
  const isGoalSupport = (c: number, r: number): boolean =>
    (c === entrance.col && r === entrance.row + 1) || (c === exit.col && r === exit.row + 1)
  for (const c of [1, 2, cols - 3, cols - 2]) {
    if (c < 1 || c > cols - 2) continue // clamp inside the interior (defensive — tiny grids are gated out above).
    if (Math.abs(c - exit.col) <= EXIT_KEEPOUT) continue // never trim the exit's approach (would break a climb to it).
    for (let r = top; r < floorRow; r++) {
      if (isGoalSupport(c, r)) continue // keep the tile a Door/spawn stands on (never strand the entrance/exit).
      if (tiles[r][c] === TILE.SOLID || tiles[r][c] === TILE.ONEWAY) tiles[r][c] = TILE.EMPTY
    }
  }
}

// Build a SOLID platform run clamped to the interior band [1, interiorMax] so its emitted {col,len}
// matches EXACTLY what stampRun writes (no record/grid drift). If the requested run would spill past
// interiorMax it is shortened (len ≥ 1). This single clamp site is why entrance/exit columns are
// always in-bounds + above a real stamped tile.
function makeRun(col: number, row: number, len: number, interiorMax: number): Platform {
  const c0 = clampInt(col, 1, interiorMax)
  const c1 = clampInt(col + len - 1, c0, interiorMax)
  return { col: c0, row, len: c1 - c0 + 1, type: TILE.SOLID }
}

// A platform's standable cell (feet on top) = the EMPTY cell one row ABOVE the run's CENTER tile.
// The column is clamped to the run's span so it always sits above an actually-stamped tile (the
// support) and in-bounds — the door/spawn reads from the middle of the platform.
function cellAbove(p: Platform): LevelPoint {
  const col = clampInt(p.col + Math.floor(p.len / 2), p.col, p.col + p.len - 1)
  const row = p.row - 1
  return { col, row, x: (col + 0.5) * TILE_SIZE, y: (row + 0.5) * TILE_SIZE }
}

// Convert a standable cell record to a world spawn point (tile center x; feet on the platform top).
function worldFromStandable(cell: StandableCell): LevelPoint {
  return {
    col: cell.col,
    row: cell.row,
    x: (cell.col + 0.5) * TILE_SIZE,
    y: (cell.row + 0.5) * TILE_SIZE,
  }
}

// Convert a standable-ENEMY cell record to a full enemy SPAWN (world point + patrol bounds + spec).
// Shared by the chosen `enemies` list AND the `spawnCandidates` surplus (Decision 45 — DRY, ONE shape
// so the scene treats a depth-bonus spawn identically to a base spawn). Patrol bounds = the OWNING
// platform run's world span (Decision 41); the generator KNOWS the run each enemy stands on
// (collectStandable recorded runCol/runLen), so the scene never maps a world coord back to a platform.
function enemySpawnFromCell(cell: StandableCell): EnemySpawn {
  return {
    ...worldFromStandable(cell),
    patrolMinX: (cell.runCol + 0.5) * TILE_SIZE + ENEMY_PATROL_INSET,
    patrolMaxX: (cell.runCol + cell.runLen - 0.5) * TILE_SIZE - ENEMY_PATROL_INSET,
    spec: 'brute',
  }
}

// Scan the grid ONCE for every standable cell: EMPTY with a SOLID/ONEWAY directly below (Decision
// 38). Records the OWNING run's col/len (so enemy patrol bounds derive from it, Decision 41) by
// scanning the contiguous SOLID/ONEWAY span beneath. Excludes cells within ENTRANCE_SAFE_TILES of
// the entrance and the exit cell itself (no ambush, keep the goal clear).
function collectStandable(
  tiles: number[][],
  cols: number,
  rows: number,
  entrance: LevelPoint,
  exit: LevelPoint,
  treasure: LevelPoint | null = null,
): StandableCell[] {
  const out: StandableCell[] = []
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      if (tiles[row][col] !== TILE.EMPTY) continue
      const below = tiles[row + 1][col]
      if (below !== TILE.SOLID && below !== TILE.ONEWAY) continue
      // Too close to the entrance (a Chebyshev band around it, any row — no frame-1 ambush from a
      // ledge above/below either), or it's the exit cell → skip (Decision 38).
      const nearEntrance =
        Math.abs(col - entrance.col) <= ENTRANCE_SAFE_TILES && Math.abs(row - entrance.row) <= ENTRANCE_SAFE_TILES
      if (nearEntrance) continue
      if (col === exit.col && row === exit.row) continue
      // §6.14 (Decision 80) — the branch TREASURE cell is RESERVED for the branch reward (GameScene places
      // it there); exclude it so a normal enemy/pickup never lands on the treasure spot.
      if (treasure && col === treasure.col && row === treasure.row) continue
      // Find the OWNING run beneath: extend left/right while the cell below stays the same support.
      let runCol = col
      while (runCol > 1 && isSupport(tiles[row + 1][runCol - 1]) && tiles[row][runCol - 1] === TILE.EMPTY) runCol--
      let runEnd = col
      while (runEnd < cols - 2 && isSupport(tiles[row + 1][runEnd + 1]) && tiles[row][runEnd + 1] === TILE.EMPTY) runEnd++
      out.push({ col, row, runCol, runLen: runEnd - runCol + 1 })
    }
  }
  return out
}

const isSupport = (t: number): boolean => t === TILE.SOLID || t === TILE.ONEWAY

// Deterministically pick `n` distinct entries from `list` via the RNG (Fisher–Yates partial shuffle
// — KISS, no rejection loop, fully seeded). Returns up to min(n, list.length) entries.
function pickSpawns<T>(rng: RNG, list: T[], n: number): T[] {
  const pool = list.slice()
  const take = clampInt(n, 0, pool.length)
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (pool.length - i))
    const tmp = pool[i]
    pool[i] = pool[j]
    pool[j] = tmp
  }
  return pool.slice(0, take)
}

// Build a mask of cells that already hold a tile (SOLID/ONEWAY/HAZARD) — decoration can't overwrite.
function buildOccupiedMask(tiles: number[][], cols: number, rows: number): boolean[][] {
  const mask: boolean[][] = []
  for (let r = 0; r < rows; r++) {
    mask.push(new Array(cols).fill(false))
    for (let c = 0; c < cols; c++) mask[r][c] = tiles[r][c] !== TILE.EMPTY
  }
  return mask
}

// Build a mask of the swept JUMP CORRIDOR between consecutive critical platforms (review MINOR): the
// airspace a player flies through between A and B. We mark the bounding rows/cols between each pair's
// near edges, plus the cells directly above each platform run (the launch + landing zones), so a
// HAZARD never lands where the player's real trajectory passes — not just off the platform graph.
function buildJumpCorridorMask(critical: Platform[], cols: number, rows: number): boolean[][] {
  const mask: boolean[][] = []
  for (let r = 0; r < rows; r++) mask.push(new Array(cols).fill(false))
  const mark = (c: number, r: number): void => {
    if (r >= 0 && r < rows && c >= 0 && c < cols) mask[r][c] = true
  }
  for (let i = 0; i < critical.length; i++) {
    const p = critical[i]
    // The launch/landing band: the row directly above the platform across its whole span.
    for (let c = p.col; c < p.col + p.len; c++) mark(c, p.row - 1)
    if (i === 0) continue
    const a = critical[i - 1]
    // The corridor between a's right edge and p's left edge, spanning the rows between their tops
    // (and one row above each, where the arc passes). A coarse rectangular sweep is sufficient +
    // conservative (it over-marks, never under-marks, so no hazard sneaks into the real path).
    const c0 = Math.min(a.col + a.len - 1, p.col)
    const c1 = Math.max(a.col + a.len - 1, p.col)
    const r0 = Math.min(a.row, p.row) - 2 // a couple rows above for the apex.
    const r1 = Math.max(a.row, p.row)
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) mark(c, r)
  }
  return mask
}

// Scatter ONEWAY ledges off the critical path (Decision: step 5). Each is a short run on an EMPTY
// band not in the occupied/corridor masks. Bounded by `count`; deterministic via the RNG. Tries a
// bounded number of seeded positions per ledge then gives up (so the grid size never inflates work).
function scatterOneWayLedges(
  tiles: number[][],
  cols: number,
  rows: number,
  rng: RNG,
  count: number,
  occupied: boolean[][],
  corridor: boolean[][],
  lenMin: number,
  lenMax: number,
): void {
  for (let i = 0; i < count; i++) {
    let placed = false
    for (let tries = 0; tries < 12 && !placed; tries++) {
      const len = randInt(rng, lenMin, lenMax)
      const col = randInt(rng, 2, cols - 2 - len)
      const row = randInt(rng, 3, rows - 4)
      if (!regionFree(occupied, corridor, col, row, len)) continue
      stampRun(tiles, cols, rows, col, row, len, TILE.ONEWAY)
      for (let c = col; c < col + len; c++) occupied[row][c] = true // claim the cells.
      placed = true
    }
  }
}

// Scatter HAZARD tiles off the critical path AND out of the jump corridor (Decision: step 5 + review
// MINOR). Each is a single tile sitting ON a support (so it reads as ground spikes, not floating),
// never in the corridor. Render-only this phase (no damage — Phase 5; YAGNI).
function scatterHazards(
  tiles: number[][],
  cols: number,
  rows: number,
  rng: RNG,
  count: number,
  occupied: boolean[][],
  corridor: boolean[][],
): void {
  // Floor-recovery (AC4): keep the floor WALK LANE (row floorRow-1 = rows-2) hazard-free so the recovery
  // backtrack is never a damage gauntlet. Gated on grid width so the cols:40 pin's hazard draws are unchanged
  // (the narrow pin has no recovery pass either). rows-2 is exactly the max `row` the draw below can pick.
  const floorLane = rows - 2
  for (let i = 0; i < count; i++) {
    let placed = false
    for (let tries = 0; tries < 16 && !placed; tries++) {
      const col = randInt(rng, 2, cols - 3)
      const row = randInt(rng, 3, rows - 2)
      if (cols >= RECOVERY_MIN_COLS && row === floorLane) continue // floor walk stays safe (recovery lane).
      if (occupied[row][col] || corridor[row][col]) continue
      if (tiles[row][col] !== TILE.EMPTY) continue
      if (!isSupport(tiles[row + 1][col])) continue // must sit on ground (no floating hazard).
      tiles[row][col] = TILE.HAZARD
      occupied[row][col] = true
      placed = true
    }
  }
}

// A region [col, col+len) at `row` is free if no cell is occupied or in the jump corridor.
function regionFree(occupied: boolean[][], corridor: boolean[][], col: number, row: number, len: number): boolean {
  for (let c = col; c < col + len; c++) {
    if (occupied[row][c] || corridor[row][c]) return false
  }
  return true
}
