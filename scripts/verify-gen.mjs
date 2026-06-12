// ── Headless determinism + procedural-level verifier (design §6.0/§6.2/§8, AC7/AC19/AC27/AC28) ──
// Run by `npm run verify` under plain node — NO Phaser, NO browser. It imports the EXACT pure
// modules the game runs (rng.js, combat/hitbox.js, combat/damage.js, world/LevelGenerator.js,
// config/biomes.js) and asserts the contracts the procedural foundation depends on. A SUCCESSFUL
// import of those modules already RE-PROVES the purity convention (Decision 33): a Phaser-coupled
// module (TileMap/Door/HitboxPool) would throw under node — which is exactly why this script never
// imports them. The check is an INDEPENDENT proof, not self-certification (Decision 36): the
// reachability graph + spawn validity are RE-DERIVED from the emitted `tiles`/`platforms`, so a bug
// in the generator's walk that "intended" a solvable level is caught here, not trusted.
//
// Sections:
//   1. rng determinism + regression pin (AC7 — the foundation; unchanged from Phase 0).
//   2. Combat-phase pure-module contracts (AC20–22 — unchanged; proves hitbox.js/damage.js purity).
//   3. Procedural-level sweep over N=200 seeds (AC19/AC27/AC28):
//        a. Determinism — generateLevel(seed) twice → DEEP-EQUAL (element-wise over the int grid).
//        b. Regression pin — ONE fixed seed → a FULL reference description (deep-equal, like the rng
//           pin: the COMPUTED output of the real function, never hand-invented). The tiles are
//           pinned via a SPECIFIED row-major string serialization (review MAJOR — no vague "hash").
//        c. Bounds (AC28) — cols/rows within [MIN,MAX]; exit non-zero, in-bounds, ≠ entrance;
//           entrance/exit cells EMPTY; enemy count within the biome band.
//        d. No spawn in a wall (AC28) — every enemy/pickup maps to an EMPTY cell with a SOLID/ONEWAY
//           directly below (RE-derived from `tiles`, independent of the generator's intent).
//        e. Traversable (AC27) — build the platform reachability graph from `platforms` via the
//           SHARED canReachPlatform predicate, BFS entrance→exit, assert the exit is reached.
// Exits non-zero on ANY failure so `npm run verify` gates CI.

import { mulberry32 } from '../src/util/rng.js'
// Combat-phase PURE modules (Decision 28): importing them here proves they're node-importable.
import { SWINGS, COMBO_LEN, swingRect } from '../src/combat/hitbox.js'
import { resolveHit } from '../src/combat/damage.js'
// Procedural-level PURE modules (Decision 33/36): the generator + the SHARED reach predicate.
import { generateLevel, TILE, canReachPlatform } from '../src/world/LevelGenerator.js'
import { PRISON, COLS_MIN, COLS_MAX, ROWS_MIN, ROWS_MAX } from '../src/config/biomes.js'

function fail(msg) {
  console.error(`verify-gen FAILED: ${msg}`)
  process.exit(1)
}

// ── Element-wise deep-equal (review MINOR — the tiles grid is a 2-D int array, so a `===` compare
// would test REFERENCE identity, not value; two fresh generations have different array objects).
// Handles plain objects, arrays (incl. the nested int grid), and primitives. KISS + sufficient for
// the pure-data descriptions (no functions/dates/maps on them).
function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false
    return true
  }
  return false // primitives that weren't === (incl. NaN) are unequal.
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 1) rng determinism + regression pin (AC7) — unchanged foundation.
// ════════════════════════════════════════════════════════════════════════════════════════════
const RNG_SEED = 0x1234abcd
const RNG_K = 5
// Pinned vector: mulberry32(0x1234abcd) → first 5 outputs (COMPUTED from the verbatim algorithm,
// never hand-invented; if rng.js changes algorithm this fails loudly — that's the point).
const RNG_EXPECTED = [
  0.10277144517749548, 0.5144855019170791, 0.07858735416084528, 0.6312816452700645,
  0.978210358414799,
]
{
  const a = mulberry32(RNG_SEED)
  const b = mulberry32(RNG_SEED)
  for (let i = 0; i < RNG_K; i++) {
    const va = a()
    const vb = b()
    if (va !== vb) fail(`rng determinism: draw ${i} differs (${va} !== ${vb})`)
  }
  const r = mulberry32(RNG_SEED)
  for (let i = 0; i < RNG_K; i++) {
    const v = r()
    if (v !== RNG_EXPECTED[i]) fail(`rng regression pin: draw ${i} = ${v}, expected ${RNG_EXPECTED[i]}`)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 2) Combat-phase pure-module contracts (AC20–22) — hitbox.js + damage.js purity/behavior.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const s = SWINGS[0]
  const right = swingRect({ cx: 100, cy: 50, facing: 1 }, s)
  const left = swingRect({ cx: 100, cy: 50, facing: -1 }, s)
  const expectedCx = 100 + (s.forward + s.reach / 2)
  if (right.x !== expectedCx) fail(`swingRect facing+1 x=${right.x}, expected ${expectedCx}`)
  if (left.x !== 200 - expectedCx) fail(`swingRect facing-1 x=${left.x}, expected ${200 - expectedCx}`)
  if (right.w !== s.reach || right.h !== s.halfHeight * 2) fail('swingRect size mismatch')
  if (COMBO_LEN !== SWINGS.length) fail(`COMBO_LEN=${COMBO_LEN} != SWINGS.length=${SWINGS.length}`)
}
{
  const finisher = SWINGS[2]
  const back = resolveHit({ cx: 0, facing: 1 }, { cx: 50, facing: 1 }, finisher, { allowBackstab: true })
  if (!back.isBackstab) fail('backstab geometry should crit')
  if (back.damage !== finisher.damage * 2) fail(`backstab damage=${back.damage}, expected ${finisher.damage * 2}`)
  const front = resolveHit({ cx: 0, facing: 1 }, { cx: 50, facing: -1 }, finisher, { allowBackstab: true })
  if (front.isBackstab) fail('frontal hit must not crit')
  if (front.damage !== finisher.damage) fail(`frontal damage=${front.damage}, expected ${finisher.damage}`)
  if (front.knockbackX <= 0) fail('frontal knockback should push victim away (+x)')
  const off = resolveHit({ cx: 0, facing: 1 }, { cx: 50, facing: 1 }, finisher, { allowBackstab: false })
  if (off.isBackstab || off.damage !== finisher.damage) fail('allowBackstab=false must disable the crit')
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 3) Procedural-level checks (AC19/AC27/AC28).
// ════════════════════════════════════════════════════════════════════════════════════════════

// ── Standability re-derived from the EMITTED tiles (Decision 38) — an INDEPENDENT check, not the
// generator's own standable list. A cell is standable iff it is EMPTY with a SOLID/ONEWAY below.
function isStandable(tiles, col, row, rows) {
  if (row < 0 || row >= rows - 1) return false
  if (tiles[row][col] !== TILE.EMPTY) return false
  const below = tiles[row + 1][col]
  return below === TILE.SOLID || below === TILE.ONEWAY
}

// ── Find the platform whose TOP supports a standable cell at (col, row): the merged run at row+1
// spanning col. Used to map entrance/exit cells to their platform nodes for the BFS.
function platformSupporting(platforms, col, row) {
  return platforms.find(
    (p) =>
      (p.type === TILE.SOLID || p.type === TILE.ONEWAY) &&
      p.row === row + 1 &&
      col >= p.col &&
      col < p.col + p.len,
  )
}

// ── Traversability BFS (AC27, Decision 36) ── build the platform graph from the EMITTED platforms
// via the SHARED canReachPlatform predicate (same math the generator placed with — DRY), then BFS
// from the entrance platform and assert the exit platform is reached.
function bfsTraversable(desc) {
  const plats = desc.platforms.filter((p) => p.type === TILE.SOLID || p.type === TILE.ONEWAY)
  const entry = platformSupporting(plats, desc.entrance.col, desc.entrance.row)
  const goal = platformSupporting(plats, desc.exit.col, desc.exit.row)
  if (!entry) return { ok: false, reason: 'entrance cell has no supporting platform' }
  if (!goal) return { ok: false, reason: 'exit cell has no supporting platform' }
  if (entry === goal) return { ok: true } // entrance + exit on the SAME platform (trivially reached).

  // Adjacency: a directed edge A→B when canReachPlatform(A,B) (the exact metric, Decision 36).
  const n = plats.length
  const adj = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && canReachPlatform(plats[i], plats[j])) adj[i].push(j)
    }
  }
  const startIdx = plats.indexOf(entry)
  const goalIdx = plats.indexOf(goal)
  const seen = new Uint8Array(n)
  seen[startIdx] = 1
  const queue = [startIdx]
  while (queue.length) {
    const u = queue.shift()
    if (u === goalIdx) return { ok: true }
    for (const v of adj[u]) if (!seen[v]) { seen[v] = 1; queue.push(v) }
  }
  return { ok: false, reason: 'exit platform not reachable from entrance' }
}

// ── Per-description assertions (bounds + spawns + traversable). Returns null on pass or a reason. ──
function checkDescription(desc, biome) {
  // (c) Bounds (AC28).
  if (desc.cols < COLS_MIN || desc.cols > COLS_MAX) return `cols ${desc.cols} out of [${COLS_MIN},${COLS_MAX}]`
  if (desc.rows < ROWS_MIN || desc.rows > ROWS_MAX) return `rows ${desc.rows} out of [${ROWS_MIN},${ROWS_MAX}]`
  if (desc.tiles.length !== desc.rows) return `tiles row count ${desc.tiles.length} != rows ${desc.rows}`
  if (desc.tiles[0].length !== desc.cols) return `tiles col count ${desc.tiles[0].length} != cols ${desc.cols}`

  // exit non-zero (a meaningful position), in-bounds, distinct from entrance.
  const ex = desc.exit
  const en = desc.entrance
  if (ex.col <= 0 || ex.row <= 0) return `exit ${JSON.stringify(ex)} is zero/edge`
  if (ex.col >= desc.cols || ex.row >= desc.rows) return `exit ${JSON.stringify(ex)} out of bounds`
  if (ex.col === en.col && ex.row === en.row) return 'exit equals entrance'

  // entrance + exit cells must be EMPTY (standable, not buried).
  if (desc.tiles[en.row][en.col] !== TILE.EMPTY) return 'entrance cell is not EMPTY'
  if (desc.tiles[ex.row][ex.col] !== TILE.EMPTY) return 'exit cell is not EMPTY'
  // …and actually standable (a support directly below) — re-derived from tiles (Decision 38).
  if (!isStandable(desc.tiles, en.col, en.row, desc.rows)) return 'entrance cell is not standable'
  if (!isStandable(desc.tiles, ex.col, ex.row, desc.rows)) return 'exit cell is not standable'

  // Enemy count within the biome band (AC28).
  if (desc.enemies.length < 0 || desc.enemies.length > biome.maxEnemies) {
    return `enemy count ${desc.enemies.length} > maxEnemies ${biome.maxEnemies}`
  }

  // (d) No spawn in a wall (AC28) — every enemy/pickup maps to a standable cell (EMPTY + support
  // below), RE-derived from the emitted tiles (independent of the generator's intent, Decision 38).
  for (const e of desc.enemies) {
    if (!isStandable(desc.tiles, e.col, e.row, desc.rows)) {
      return `enemy spawn at (col ${e.col}, row ${e.row}) is not standable (in a wall / floating)`
    }
    // World coord must match the tile center (the contract: feet on the platform top).
    if (e.x !== (e.col + 0.5) * desc.tileSize) return `enemy world x mismatch at (${e.col},${e.row})`
  }
  for (const p of desc.pickups) {
    if (!isStandable(desc.tiles, p.col, p.row, desc.rows)) {
      return `pickup spawn at (col ${p.col}, row ${p.row}) is not standable`
    }
  }

  // (e) Traversable (AC27).
  const t = bfsTraversable(desc)
  if (!t.ok) return `not traversable: ${t.reason}`

  return null
}

// ── 3a) Determinism (AC19): generateLevel twice → DEEP-EQUAL (element-wise over the int grid). ──
// ── 3c/3d/3e) Per-seed bounds + spawn-validity + traversability over N seeds. ──
const N = 200
for (let i = 0; i < N; i++) {
  // Spread the seeds (a Knuth multiplicative hash) so the sweep isn't a near-identical run of
  // adjacent integers — exercises a wide range of seeded layouts deterministically.
  const seed = (i * 2654435761) >>> 0
  const d1 = generateLevel(seed, PRISON)
  const d2 = generateLevel(seed, PRISON)
  if (!deepEqual(d1, d2)) fail(`determinism: seed ${seed} produced two different descriptions`)

  const reason = checkDescription(d1, PRISON)
  if (reason) fail(`seed ${seed}: ${reason}`)
}

// ── 3b) Regression pin (AC19): ONE fixed seed → a FULL reference description (deep-equal). ──
// COMPUTED from the real generator (like the rng pin) — never hand-invented. Uses a SMALL biome so
// the pinned grid is compact yet real. The tiles are pinned via a SPECIFIED, stable ROW-MAJOR string
// serialization (each row = its tile ints joined; review MAJOR — a pinned value + a named
// serialization, NOT a vague "hash"). If the algorithm changes, this fails loudly; regenerate by
// re-running the generator, never edit it to silence a failure.
const PIN_SEED = 0x1234abcd
const PIN_BIOME = {
  ...PRISON,
  cols: 40,
  rows: 18,
  minEnemies: 2,
  maxEnemies: 2,
  minPickups: 1,
  maxPickups: 1,
  oneWayLedges: 2,
  hazardPatches: 2,
}
// The reference grid, row-major, each row a string of tile ints (the SPECIFIED serialization).
const PIN_TILES = [
  '1000000000000000000000000000000000000001',
  '1000000000000000000000000000000000000001',
  '1000000000000000000000000000000000000001',
  '1000000000000000000000000000000000000001',
  '1000000000000000000000000000000000000001',
  '1000000000000000000000000000000300000001',
  '1000000000000000000000000000000222000001',
  '1000000000000000000000000000000000000001',
  '1000000000000000000000000000000000000001',
  '1000000000000000000000000000000000000001',
  '1000000000000000000000000000000000000001',
  '1000000000000000000000000000000222000001',
  '1000000000000000000000000000000000000001',
  '1000000000000000000000000000000000000001',
  '1000000000000000000000000000000000000001',
  '1000000000000000000000000000000000000001',
  '1011111111111111101111110001111111111111',
  '1111111111111111111111111111111111111111',
]
const PIN_EXPECTED = {
  cols: 40,
  rows: 18,
  tileSize: 32,
  worldWidth: 1280,
  worldHeight: 576,
  entrance: { col: 4, row: 15, x: 144, y: 496 },
  exit: { col: 37, row: 15, x: 1200, y: 496 },
  enemies: [
    { col: 14, row: 15, x: 464, y: 496, patrolMinX: 86, patrolMaxX: 522, spec: 'brute' },
    { col: 15, row: 15, x: 496, y: 496, patrolMinX: 86, patrolMaxX: 522, spec: 'brute' },
  ],
  pickups: [{ col: 20, row: 15, x: 656, y: 496, kind: 'cell' }],
  seed: PIN_SEED,
  biomeId: 'prison',
}
{
  const d = generateLevel(PIN_SEED, PIN_BIOME)
  // Pin the structured fields (deep-equal).
  const actual = {
    cols: d.cols,
    rows: d.rows,
    tileSize: d.tileSize,
    worldWidth: d.worldWidth,
    worldHeight: d.worldHeight,
    entrance: d.entrance,
    exit: d.exit,
    enemies: d.enemies,
    pickups: d.pickups,
    seed: d.seed,
    biomeId: d.biomeId,
  }
  if (!deepEqual(actual, PIN_EXPECTED)) {
    fail(`regression pin: description drifted →\n${JSON.stringify(actual)}\nexpected\n${JSON.stringify(PIN_EXPECTED)}`)
  }
  // Pin the tiles via the row-major string serialization.
  const actualTiles = d.tiles.map((row) => row.join(''))
  if (!deepEqual(actualTiles, PIN_TILES)) {
    fail(`regression pin: tiles grid drifted →\n${JSON.stringify(actualTiles)}`)
  }
}

console.log(
  `verify-gen OK: rng deterministic+pinned; combat hitbox/damage pure+pinned; ` +
    `${N} seeds → deterministic + bounds(AC28) + no-wall-spawn(AC28) + traversable(AC27); level pin OK`,
)
process.exit(0)
