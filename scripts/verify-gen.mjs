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
//   3. Procedural-level sweep over N=200 seeds × EVERY biome in BIOME_ORDER (AC19/AC27/AC28):
//        a. Determinism — generateLevel(seed) twice → DEEP-EQUAL (element-wise over the int grid).
//        b. Regression pin — ONE fixed seed → a FULL reference description (deep-equal, like the rng
//           pin: the COMPUTED output of the real function, never hand-invented). The tiles are
//           pinned via a SPECIFIED row-major string serialization (review MAJOR — no vague "hash").
//           (The pin is PRISON-shaped; adding name/tier/levels/endsInBoss to PRISON does NOT change
//           generateLevel output — the generator ignores them — and the pin's field allowlist excludes
//           the new `spawnCandidates`, so the pin is UNAFFECTED, re-run to confirm — review MINOR.)
//        c. Bounds (AC28) — cols/rows within [MIN,MAX]; exit non-zero, in-bounds, ≠ entrance;
//           entrance/exit cells EMPTY; enemy count within the biome band.
//        d. No spawn in a wall (AC28) — every enemy/pickup maps to an EMPTY cell with a SOLID/ONEWAY
//           directly below (RE-derived from `tiles`, independent of the generator's intent).
//        e. Traversable (AC27) — build the platform reachability graph from `platforms` via the
//           SHARED canReachPlatform predicate, BFS entrance→exit, assert the exit is reached.
//   4. Run-structure (§6.4, AC42/AC43/AC47): curve monotonicity + scaled-stat rise; biome-tier
//      monotonicity + per-biome bounds; WHOLE-RUN effectiveDifficulty non-decreasing across the exact
//      RunState.advance() chain the game walks; seed-chain + biome-sequence determinism.
// Exits non-zero on ANY failure so `npm run verify` gates CI.

import { mulberry32 } from '../src/util/rng.js'
// Combat-phase PURE modules (Decision 28): importing them here proves they're node-importable.
import { SWINGS, COMBO_LEN, swingRect } from '../src/combat/hitbox.js'
import { resolveHit } from '../src/combat/damage.js'
// Procedural-level PURE modules (Decision 33/36): the generator + the SHARED reach predicate.
import { generateLevel, TILE, canReachPlatform } from '../src/world/LevelGenerator.js'
import { PRISON, BIOME_ORDER, COLS_MIN, COLS_MAX, ROWS_MIN, ROWS_MAX } from '../src/config/biomes.js'
// Run-structure PURE modules (§6.4, Decision 42/44/49): the depth curve + the RunState factory. A
// SUCCESSFUL node import here RE-PROVES their purity (no Phaser) — the same convention the level
// modules satisfy. (BRUTE_SPEC lives in the Phaser-coupled Enemy.js, so we DON'T import it; the
// scaleSpec monotonicity proof uses a minimal PURE base stub below — scaleSpec only multiplies
// numeric fields, so any base with those fields proves the "scaled stat rises" property.)
import { scaleAtDepth, scaleSpec, effectiveDifficulty } from '../src/config/difficulty.js'
import { createRunState } from '../src/core/RunState.js'
// Meta-loop PURE modules (§6.5, Decision 56/57/61, AC55): the upgrade + weapon tables + the pure
// applyUpgrades fold. A SUCCESSFUL node import RE-PROVES their purity (no Phaser, no top-level
// localStorage) — the same convention the level/run modules satisfy. core/MetaState.js imports only
// util/save.js (Phaser-free) + the pure configs, and applyUpgrades/BASE_PLAYER_STATS touch NO storage,
// so this import never throws under node (review MINOR — the purity-convention pin made explicit).
import { UPGRADES } from '../src/config/upgrades.js'
import { WEAPON_ORDER } from '../src/config/weapons.js'
import { applyUpgrades, BASE_PLAYER_STATS } from '../src/core/MetaState.js'

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
// ── 3c/3d/3e) Per-seed bounds + spawn-validity + traversability over N seeds, for EVERY biome. ──
// §6.4 extends the sweep to the WHOLE BIOME_ORDER (not just PRISON) so AC28 (bounds / no-wall-spawn /
// traversable) holds for every biome the run can walk, not only the opener.
const N = 200
for (const biome of BIOME_ORDER) {
  for (let i = 0; i < N; i++) {
    // Spread the seeds (a Knuth multiplicative hash) so the sweep isn't a near-identical run of
    // adjacent integers — exercises a wide range of seeded layouts deterministically.
    const seed = (i * 2654435761) >>> 0
    const d1 = generateLevel(seed, biome)
    const d2 = generateLevel(seed, biome)
    if (!deepEqual(d1, d2)) fail(`determinism: biome ${biome.id} seed ${seed} produced two descriptions`)

    const reason = checkDescription(d1, biome)
    if (reason) fail(`biome ${biome.id} seed ${seed}: ${reason}`)
  }
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

// ════════════════════════════════════════════════════════════════════════════════════════════
// 4) Run-structure: difficulty curve + biome tiers + whole-run monotonicity + seed determinism
//    (design §6.4, Decision 49, AC42/AC43/AC47). An INDEPENDENT proof (not self-certification): the
//    verifier walks the EXACT advance() chain the game walks and re-derives every property.
// ════════════════════════════════════════════════════════════════════════════════════════════

// A minimal PURE base spec for the scaleSpec monotonicity proof (BRUTE_SPEC lives in Phaser-coupled
// Enemy.js — see the import note). scaleSpec only MULTIPLIES these numeric fields, so any base with
// them proves "the scaled stat rises with depth"; the exact base values don't matter to the property.
const BASE_SPEC_STUB = {
  maxHp: 60,
  contactDamage: 6,
  patrolSpeed: 70,
  chaseSpeed: 160,
  swing: { reach: 56, damage: 12, knockback: 320 },
}

// ── 4a) Curve monotonicity (AC42): each scaleAtDepth scalar is non-decreasing in depth, AND the
// scaled stat (scaleSpec(...).maxHp) actually rises — the scaling is real, not just the multiplier. ──
const MAXD = 60 // a generous run length the curve must stay monotone over (far past real runs).
{
  let prev = scaleAtDepth(0)
  let prevHp = scaleSpec(BASE_SPEC_STUB, prev).maxHp
  for (let depth = 1; depth <= MAXD; depth++) {
    const s = scaleAtDepth(depth)
    if (s.enemyHpMult < prev.enemyHpMult) fail(`curve: enemyHpMult dipped at depth ${depth}`)
    if (s.enemyDamageMult < prev.enemyDamageMult) fail(`curve: enemyDamageMult dipped at depth ${depth}`)
    if (s.enemySpeedMult < prev.enemySpeedMult) fail(`curve: enemySpeedMult dipped at depth ${depth}`)
    if (s.enemyCountBonus < prev.enemyCountBonus) fail(`curve: enemyCountBonus dipped at depth ${depth}`)
    const hp = scaleSpec(BASE_SPEC_STUB, s).maxHp
    if (hp < prevHp) fail(`curve: scaled maxHp dipped at depth ${depth} (${hp} < ${prevHp})`)
    // scaleSpec must NOT mutate the base (Decision 45) — re-read a field after scaling.
    if (BASE_SPEC_STUB.maxHp !== 60) fail('scaleSpec mutated the base spec (aliasing bug)')
    prev = s
    prevHp = hp
  }
}

// ── 4b) Biome-tier monotonicity (AC43): difficultyTier is non-decreasing along BIOME_ORDER, and
// every biome's cols/rows are within the size bounds (so AC28 holds for the whole list). ──
{
  if (BIOME_ORDER.length < 3) fail(`BIOME_ORDER has ${BIOME_ORDER.length} biomes, expected ≥3 (AC43)`)
  for (let i = 1; i < BIOME_ORDER.length; i++) {
    if (BIOME_ORDER[i].difficultyTier < BIOME_ORDER[i - 1].difficultyTier) {
      fail(`biome tier dipped: ${BIOME_ORDER[i].id} tier ${BIOME_ORDER[i].difficultyTier} < prior`)
    }
  }
  for (const b of BIOME_ORDER) {
    if (b.cols < COLS_MIN || b.cols > COLS_MAX) fail(`biome ${b.id} cols ${b.cols} out of bounds`)
    if (b.rows < ROWS_MIN || b.rows > ROWS_MAX) fail(`biome ${b.id} rows ${b.rows} out of bounds`)
    if (!(b.levels >= 1)) fail(`biome ${b.id} levels ${b.levels} must be ≥1 (BLOCKER 1 model)`)
  }
}

// ── 4c) Whole-run monotonicity (AC42/AC49): drive a fresh RunState through advance() for the FULL run
// (every biome's every level) and assert effectiveDifficulty(depth, biome) is non-decreasing across
// the ENTIRE run — the load-bearing "visibly rising difficulty" proof. Walks the EXACT chain the game
// walks (Decision 49), so a curve/biome/levels re-tune that breaks the AC fails LOUDLY here. ──
const RUN_SEED = 0xc0ffee
const totalLevels = BIOME_ORDER.reduce((sum, b) => sum + b.levels, 0)
{
  const rs = createRunState(RUN_SEED)
  let prevEff = effectiveDifficulty(rs.depth, rs.biome())
  // Step through every level of the run via advance() until the last biome's last level is cleared.
  let steps = 0
  while (!rs.isRunComplete()) {
    rs.advance()
    steps++
    const eff = effectiveDifficulty(rs.depth, rs.biome())
    if (eff < prevEff) {
      fail(`whole-run difficulty dipped at depth ${rs.depth} (${rs.biome().id}): ${eff} < ${prevEff}`)
    }
    prevEff = eff
    if (steps > totalLevels + 5) fail('whole-run walk did not terminate (isRunComplete never true)')
  }
  // The run length = sum of per-biome levels; depth at completion = totalLevels − 1 (0-based start).
  if (rs.depth !== totalLevels - 1) {
    fail(`run length mismatch: depth ${rs.depth} at completion, expected ${totalLevels - 1}`)
  }
  // And we must have ended on the LAST biome (BLOCKER 1 — not looping/short-circuiting).
  if (!rs.isLastBiome()) fail('run completed but not on the last biome (BLOCKER 1 regression)')
}

// ── 4d) Seed-chain + biome-sequence determinism (AC47): two fresh RunStates from the SAME start seed
// advance in lockstep to the SAME (biomeIndex, levelInBiome, seed) sequence — the run replays. ──
{
  const a = createRunState(RUN_SEED)
  const b = createRunState(RUN_SEED)
  for (let step = 0; step < totalLevels; step++) {
    if (a.seed !== b.seed) fail(`seed chain diverged at step ${step}: ${a.seed} !== ${b.seed}`)
    if (a.biomeIndex !== b.biomeIndex) fail(`biome index diverged at step ${step}`)
    if (a.levelInBiome !== b.levelInBiome) fail(`levelInBiome diverged at step ${step}`)
    if (a.depth !== b.depth) fail(`depth diverged at step ${step}`)
    a.advance()
    b.advance()
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 5) Meta-loop pure contracts (§6.5, Decision 56/57/61, AC55). An INDEPENDENT proof of the economy/
//    weapon math that stays Phaser-free: upgrade-cost monotonicity, the pure non-mutating applyUpgrades
//    fold (identity + never-weaker), and well-formed weapon movesets. The successful imports above
//    already re-proved purity (a Phaser/storage-coupled module would throw under node).
// ════════════════════════════════════════════════════════════════════════════════════════════

// ── 5a) Upgrade table well-formed (AC55): costs non-decreasing per upgrade + length === maxLevel. ──
{
  for (const upg of UPGRADES) {
    if (!Array.isArray(upg.costs) || upg.costs.length === 0) fail(`upgrade ${upg.id}: empty costs`)
    if (upg.costs.length !== upg.maxLevel) {
      fail(`upgrade ${upg.id}: costs.length ${upg.costs.length} !== maxLevel ${upg.maxLevel}`)
    }
    for (let i = 1; i < upg.costs.length; i++) {
      if (upg.costs[i] < upg.costs[i - 1]) {
        fail(`upgrade ${upg.id}: costs not monotone at ${i} (${upg.costs[i]} < ${upg.costs[i - 1]})`)
      }
    }
    if (typeof upg.apply !== 'function') fail(`upgrade ${upg.id}: apply is not a function`)
  }
}

// ── 5b) applyUpgrades is a PURE non-mutating fold (AC55): identity on empty + never mutates BASE. ──
{
  // Identity: empty upgrades → a deep-equal CLONE of BASE (not the frozen base itself).
  const id = applyUpgrades(BASE_PLAYER_STATS, {})
  if (!deepEqual(id, { ...BASE_PLAYER_STATS })) fail('applyUpgrades({}) is not the identity clone of BASE')
  if (id === BASE_PLAYER_STATS) fail('applyUpgrades({}) returned the SAME ref as BASE (must be a clone)')
  // Non-mutation: a full-stack fold must not touch BASE_PLAYER_STATS.
  const baseSnapshot = { ...BASE_PLAYER_STATS }
  for (const upg of UPGRADES) applyUpgrades(BASE_PLAYER_STATS, { [upg.id]: upg.maxLevel })
  if (!deepEqual(BASE_PLAYER_STATS, baseSnapshot)) fail('applyUpgrades MUTATED BASE_PLAYER_STATS (aliasing bug)')
}

// ── 5c) An upgrade never WEAKENS you (AC55): max-level fold yields stats ≥ base on the field it
// touches. The sense differs per field: maxHp + meleeDamageMult are "bigger is better" (≥ base);
// dodgeCooldownMult is "SMALLER is better" (≤ base — a shorter cooldown); startWeaponId is a string
// (an unlock, not a numeric weaken). We assert the right sense per upgrade so the proof is meaningful. ──
{
  for (const upg of UPGRADES) {
    const maxed = applyUpgrades(BASE_PLAYER_STATS, { [upg.id]: upg.maxLevel })
    if (maxed.maxHp < BASE_PLAYER_STATS.maxHp) fail(`upgrade ${upg.id}: maxHp decreased`)
    if (maxed.meleeDamageMult < BASE_PLAYER_STATS.meleeDamageMult) fail(`upgrade ${upg.id}: meleeDamageMult decreased`)
    if (maxed.dodgeCooldownMult > BASE_PLAYER_STATS.dodgeCooldownMult) {
      fail(`upgrade ${upg.id}: dodgeCooldownMult increased (a longer cooldown is a weaken)`)
    }
    if (typeof maxed.startWeaponId !== 'string') fail(`upgrade ${upg.id}: startWeaponId is not a string`)
  }
}

// ── 5d) Weapons well-formed (AC54/AC55): type ∈ {melee,ranged}, a non-empty swings table with the
// required per-row fields, and a projectile spec IFF ranged. ──
{
  const SWING_FIELDS = ['reach', 'halfHeight', 'forward', 'damage', 'knockback', 'active', 'recovery', 'comboWindow', 'lunge']
  const PROJ_FIELDS = ['speed', 'damage', 'knockback', 'lifetime']
  if (WEAPON_ORDER.length < 3) fail(`WEAPON_ORDER has ${WEAPON_ORDER.length} weapons, expected ≥3 (AC54)`)
  for (const w of WEAPON_ORDER) {
    if (w.type !== 'melee' && w.type !== 'ranged') fail(`weapon ${w.id}: type ${w.type} not melee/ranged`)
    if (!Array.isArray(w.swings) || w.swings.length === 0) fail(`weapon ${w.id}: empty swings table`)
    for (const s of w.swings) {
      for (const f of SWING_FIELDS) {
        if (typeof s[f] !== 'number') fail(`weapon ${w.id}: swing missing numeric field "${f}"`)
      }
      if (s.active <= 0 || s.recovery < 0) fail(`weapon ${w.id}: swing active/recovery out of range`)
    }
    // projectile IFF ranged.
    if (w.type === 'ranged') {
      if (!w.projectile) fail(`weapon ${w.id}: ranged but no projectile spec`)
      for (const f of PROJ_FIELDS) {
        if (typeof w.projectile[f] !== 'number') fail(`weapon ${w.id}: projectile missing numeric field "${f}"`)
      }
    } else if (w.projectile) {
      fail(`weapon ${w.id}: melee weapon must NOT carry a projectile spec`)
    }
  }
}

console.log(
  `verify-gen OK: rng deterministic+pinned; combat hitbox/damage pure+pinned; ` +
    `${N} seeds × ${BIOME_ORDER.length} biomes → deterministic + bounds(AC28) + no-wall-spawn(AC28) + ` +
    `traversable(AC27); level pin OK; curve+tiers+whole-run monotonic (AC42/AC43) over ${totalLevels} ` +
    `levels; seed chain deterministic (AC47); upgrades/weapons pure+well-formed + applyUpgrades ` +
    `identity/non-mutating/never-weaker (AC55)`,
)
process.exit(0)
