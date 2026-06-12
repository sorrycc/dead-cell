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
import { COLS_MIN, COLS_MAX, ROWS_MIN, ROWS_MAX } from '../config/biomes.js'

// ── Tile enums (Decision 33) ── small ints so the grid serializes trivially (the regression pin)
// and generator/TileMap/verifier share ONE definition (DRY). EMPTY=0 so a fresh grid is all-empty.
export const TILE = { EMPTY: 0, SOLID: 1, ONEWAY: 2, HAZARD: 3 }

// Tile size in world px (Decision 35). The grid is the source of truth; world coords = tile·SIZE.
export const TILE_SIZE = 32

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
const APEX_H = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * G_UP) // ≈128.1 px — max climb.

// Safety margin (Decision 35): the envelope is scaled to this fraction so it UNDER-estimates true
// reach (a verifier PASS is then always sound). The whole point of the margin is to absorb the gap
// between theory and a real landing — keep it ≤ 1.
const REACH_MARGIN = 0.7

// ── rawReachPx(dyPx) — the COUPLED horizontal reach (px) to LAND ON TOP at vertical step dyPx ──
// dyPx < 0 ⇒ target is HIGHER by |dyPx| (a climb); dyPx > 0 ⇒ target is LOWER (a fall). Returns the
// SAFE (margin-scaled) horizontal reach, or 0 if the climb exceeds the apex (unreachable height).
// PURE + deterministic (no RNG) so the generator + verifier agree exactly.
function rawReachPx(dyPx) {
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
const MAX_GAP = 4 // tiles — max horizontal clear gap (128px). MUST be ≤ canReach at MAX_STEP_UP.

// ── canReachStep(dxTiles, dyTiles) → boolean (Decisions 35/36, the SHARED predicate) ──
// TRUE iff a player on platform A can jump to platform B whose near-edge gap is `dxTiles` tiles and
// whose top is `dyTiles` tiles away (negative = higher). The horizontal allowance is the COUPLED
// envelope rawReachPx(dy) (BLOCKER #1) — NOT a fixed MAX_GAP. The generator uses it to bound the
// walk; the verifier uses the SAME function to build the reachability graph (DRY, Decision 36).
// Conservative (margin) ⇒ a PASS is sound. NOTE: a downward step beyond MAX_STEP_DOWN is rejected
// here too — not because it's unreachable (falling always reaches) but because the generator never
// emits one (platforms must stay on-screen), so the graph + the walk agree on that bound as well.
export function canReachStep(dxTiles, dyTiles) {
  if (dyTiles < -MAX_STEP_UP) return false // climbs higher than the budget allows.
  if (dyTiles > MAX_STEP_DOWN) return false // falls farther than the generator ever places.
  const reachPx = rawReachPx(dyTiles * TILE_SIZE)
  return Math.abs(dxTiles) * TILE_SIZE <= reachPx
}

// ── platformStep(a, b) → { dx, dy } (the EXACT metric — review BLOCKER #2) ──
// dy = b.row − a.row (top-row to top-row; negative = b higher). dx = the NEAREST-EDGE column gap in
// the travel direction (0 if the spans overlap in columns). This is the ONE function both the
// generator's placement check AND the verifier's edge construction call, so they cannot disagree.
export function platformStep(a, b) {
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
export function canReachPlatform(a, b) {
  const { dx, dy } = platformStep(a, b)
  return canReachStep(dx, dy)
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
})()

// ── Helpers (pure) ──
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
// Seeded integer in [lo, hi] inclusive (the only integer draw the generator uses — keep it DRY).
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))

// Stamp a horizontal SOLID run of length `len` at (col,row) into the grid (the staircase platform).
// Clamps to the grid so a run near the edge never writes out of bounds (defensive — KISS).
function stampRun(tiles, cols, rows, col, row, len, type) {
  if (row < 0 || row >= rows) return
  const c0 = clampInt(col, 0, cols - 1)
  const c1 = clampInt(col + len - 1, 0, cols - 1)
  for (let c = c0; c <= c1; c++) tiles[row][c] = type
}

// Merge each contiguous horizontal run of a given tile `type` per row into one {col,row,len,type}
// (Decision 37). Computed here so TileMap (bodies) + the verifier (graph) reuse it (DRY) instead of
// re-scanning. Walls/floor SOLID runs are included for SOLID; ONEWAY runs are merged separately.
function mergeRuns(tiles, cols, rows, type) {
  const runs = []
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

// ── generateLevel(seed, biomeConfig) → level description (the contract — design §6.2) ──
// PURE. ONE mulberry32(seed) threads the whole generation so the SAME (seed, biome) is byte-
// identical (AC19). Returns plain data (no functions) so it serializes for the regression pin.
export function generateLevel(seed, biomeConfig) {
  const rng = mulberry32(seed)

  // ── 1) Dimensions (AC28) ── clamp the biome's cols/rows into the GLOBAL bounds (config/biomes.js
  // owns COLS_MIN/MAX + ROWS_MIN/MAX — the single source the verifier also asserts against). The
  // shipped biome's values are already in range, but clamping makes the bound the source of truth,
  // so the verifier's "cols/rows within [MIN,MAX]" passes by construction (AC28).
  const cols = clampInt(biomeConfig.cols, COLS_MIN, COLS_MAX)
  const rows = clampInt(biomeConfig.rows, ROWS_MIN, ROWS_MAX)

  // Initialize the grid to EMPTY (a rows×cols Int array; row-major, tiles[row][col]).
  const tiles = []
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

  // ── 3) The reach-bounded STAIRCASE WALK (Decisions 34/35 — traversable by construction) ──
  // Start the entrance platform on the floor at the left; repeatedly place the next platform a
  // seeded (gap, step) away that platformStep+canReachStep ACCEPT, until the walk passes the right
  // margin. Each platform is a short SOLID run (len within the biome's platformLenRange — min ≥ 3 so
  // it's standable + patrol-able, Decision 41). The LAST platform holds the exit (AC27).
  const [lenMin, lenMax] = biomeConfig.platformLenRange
  const rightMargin = 3 // stop the walk this many cols before the right wall.
  const platformRows = floorRow - 1 // platforms live in rows [1 .. floorRow-1] (above the floor).

  // The playable interior columns: [1, cols-2] sit BETWEEN the side walls (col 0 + col cols-1 are
  // SOLID walls). Every platform run is clamped to this band so its emitted {col,len} record matches
  // EXACTLY what gets stamped (no record/grid drift — that drift was a real bug: cellAbove read a
  // pre-clamp len and emitted an out-of-bounds exit column). The clamp helper enforces it once.
  const interiorMax = cols - 2 // last interior column (cols-1 is the right wall).

  // Entrance platform: a run starting just inside the left wall, a couple rows up from the floor so
  // the player stands above the floor with room to descend too. Clamped to the interior band.
  const startRow = clampInt(platformRows - randInt(rng, 0, 2), 2, platformRows)
  const critical = [] // the critical-path platforms (entrance … exit), in order.
  critical.push(makeRun(2, startRow, randInt(rng, lenMin, lenMax), interiorMax))

  // Walk right. Each iteration draws a seeded (gap, step) INSIDE the budgets and places the next
  // platform's NEAR edge a clear `gap` past the previous run's right edge, `step` rows away. Because
  // the budgets are clamped to the reach envelope at module load, every in-budget pair satisfies
  // canReachStep — so the placement is jumpable BY CONSTRUCTION (AC27); we still assert it per-step
  // (defensive against a future budget widening). The walk stops once a platform reaches the right
  // margin; that LAST platform holds the exit.
  let guard = 0
  while (guard++ < 10000) {
    const prev = critical[critical.length - 1]
    const prevRight = prev.col + prev.len - 1
    if (prevRight >= interiorMax - rightMargin) break // reached the right side → done.

    const gap = randInt(rng, MIN_GAP, MAX_GAP)
    const drawnStep = randInt(rng, -MAX_STEP_UP, MAX_STEP_DOWN)
    const nextRow = clampInt(prev.row + drawnStep, 2, platformRows)
    // The next run's NEAR (left) edge = prev right edge + the clear gap. makeRun clamps the run to
    // the interior, and we recompute the ACTUAL metric from the EMITTED record (Decision 36) so the
    // reachability check sees exactly what's stamped — never a pre-clamp value.
    const next = makeRun(prevRight + gap, nextRow, randInt(rng, lenMin, lenMax), interiorMax)

    // PROOF (defensive): the emitted pair must pass the SHARED predicate. With sane budgets this
    // always holds; if a future widening breaks it, pull the gap to the minimum (always in-reach).
    if (!canReachPlatform(prev, next)) {
      const pulled = makeRun(prevRight + MIN_GAP, nextRow, next.len, interiorMax)
      if (!canReachPlatform(prev, pulled)) break // truly stuck (cannot happen with sane budgets).
      critical.push(pulled)
      continue
    }
    // If clamping fused the next run flush against the previous (no advance), stop — we're at the
    // wall (prevents an infinite guard spin in a pathologically narrow room).
    if (next.col <= prevRight) break
    critical.push(next)
  }

  // Stamp every critical platform into the grid as a SOLID run (records already match the interior).
  for (const p of critical) stampRun(tiles, cols, rows, p.col, p.row, p.len, TILE.SOLID)

  // ── 4) entrance / exit cells (Decision: step 4, AC28) ── the standable EMPTY cell directly ABOVE
  // the first/last platform's top tile (feet on the platform). Distinct + in-bounds by construction
  // (the walk always emits ≥2 platforms across a 40+ col room; asserted in the verifier too).
  const first = critical[0]
  const last = critical[critical.length - 1]
  const entrance = cellAbove(first)
  const exit = cellAbove(last)

  // ── 5) Off-critical-path decoration (Decision: step 5) ── scatter ONEWAY ledges + HAZARD tiles at
  // seeded positions that are NOT on the critical path, so they never block the guaranteed route. We
  // additionally keep HAZARDs out of the swept JUMP CORRIDOR between consecutive critical platforms
  // (review MINOR — the player's real trajectory, not just the platform graph), so the "traversable"
  // guarantee holds for the actual path the player walks, not merely the BFS abstraction.
  const occupied = buildOccupiedMask(tiles, cols, rows) // SOLID/ONEWAY/HAZARD cells (can't decorate).
  const corridor = buildJumpCorridorMask(critical, cols, rows) // airspace the player flies through.

  scatterOneWayLedges(tiles, cols, rows, rng, biomeConfig.oneWayLedges, occupied, corridor, lenMin, lenMax)
  scatterHazards(tiles, cols, rows, rng, biomeConfig.hazardPatches, occupied, corridor)

  // ── 6) Standable-cell set + spawns (Decision 38, AC28) ── scan ONCE for every EMPTY cell with a
  // SOLID/ONEWAY directly below = standable ground. Draw enemy + pickup spawns from it via the RNG,
  // excluding cells too near the entrance (no frame-1 ambush) and the exit. Enemy count is clamped
  // to the biome band. ENEMY spawns additionally require a MIN-WIDTH platform run under them so the
  // enemy has room to patrol (Decision 41 / review MAJOR) — see standableForEnemies().
  const standableAll = collectStandable(tiles, cols, rows, entrance, exit)
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

// Build a SOLID platform run clamped to the interior band [1, interiorMax] so its emitted {col,len}
// matches EXACTLY what stampRun writes (no record/grid drift). If the requested run would spill past
// interiorMax it is shortened (len ≥ 1). This single clamp site is why entrance/exit columns are
// always in-bounds + above a real stamped tile.
function makeRun(col, row, len, interiorMax) {
  const c0 = clampInt(col, 1, interiorMax)
  const c1 = clampInt(col + len - 1, c0, interiorMax)
  return { col: c0, row, len: c1 - c0 + 1, type: TILE.SOLID }
}

// A platform's standable cell (feet on top) = the EMPTY cell one row ABOVE the run's CENTER tile.
// The column is clamped to the run's span so it always sits above an actually-stamped tile (the
// support) and in-bounds — the door/spawn reads from the middle of the platform.
function cellAbove(p) {
  const col = clampInt(p.col + Math.floor(p.len / 2), p.col, p.col + p.len - 1)
  const row = p.row - 1
  return { col, row, x: (col + 0.5) * TILE_SIZE, y: (row + 0.5) * TILE_SIZE }
}

// Convert a standable cell record to a world spawn point (tile center x; feet on the platform top).
function worldFromStandable(cell) {
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
function enemySpawnFromCell(cell) {
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
function collectStandable(tiles, cols, rows, entrance, exit) {
  const out = []
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

const isSupport = (t) => t === TILE.SOLID || t === TILE.ONEWAY

// Deterministically pick `n` distinct entries from `list` via the RNG (Fisher–Yates partial shuffle
// — KISS, no rejection loop, fully seeded). Returns up to min(n, list.length) entries.
function pickSpawns(rng, list, n) {
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
function buildOccupiedMask(tiles, cols, rows) {
  const mask = []
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
function buildJumpCorridorMask(critical, cols, rows) {
  const mask = []
  for (let r = 0; r < rows; r++) mask.push(new Array(cols).fill(false))
  const mark = (c, r) => {
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
function scatterOneWayLedges(tiles, cols, rows, rng, count, occupied, corridor, lenMin, lenMax) {
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
function scatterHazards(tiles, cols, rows, rng, count, occupied, corridor) {
  for (let i = 0; i < count; i++) {
    let placed = false
    for (let tries = 0; tries < 16 && !placed; tries++) {
      const col = randInt(rng, 2, cols - 3)
      const row = randInt(rng, 3, rows - 2)
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
function regionFree(occupied, corridor, col, row, len) {
  for (let c = col; c < col + len; c++) {
    if (occupied[row][c] || corridor[row][c]) return false
  }
  return true
}
