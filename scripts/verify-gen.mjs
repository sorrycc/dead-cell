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
import { generateLevel, TILE, canReachPlatform, LAYOUT_TEMPLATES } from '../src/world/LevelGenerator.js'
import { PRISON, BIOME_ORDER, COLS_MIN, COLS_MAX, ROWS_MIN, ROWS_MAX } from '../src/config/biomes.js'
// Run-structure PURE modules (§6.4, Decision 42/44/49): the depth curve + the RunState factory. A
// SUCCESSFUL node import here RE-PROVES their purity (no Phaser) — the same convention the level
// modules satisfy. The Bosses phase (§6.6, Decision 64/68) HOISTED the canonical enemy specs to the
// PURE config/enemies.js (Enemy.js re-exports GRUNT as BRUTE_SPEC for back-compat) so the verifier now
// imports the REAL grunt spec as the scaleSpec base — REPLACING the old duplicated BASE_SPEC_STUB
// (review MINOR — one source of truth, DRY). scaleBossSpec is the boss-specific depth fold (Decision 64).
import { scaleAtDepth, scaleSpec, scaleBossSpec, effectiveDifficulty } from '../src/config/difficulty.js'
import { createRunState } from '../src/core/RunState.js'
// Meta-loop PURE modules (§6.5, Decision 56/57/61, AC55): the upgrade + weapon tables + the pure
// applyUpgrades fold. A SUCCESSFUL node import RE-PROVES their purity (no Phaser, no top-level
// localStorage) — the same convention the level/run modules satisfy. core/MetaState.js imports only
// util/save.js (Phaser-free) + the pure configs, and applyUpgrades/BASE_PLAYER_STATS touch NO storage,
// so this import never throws under node (review MINOR — the purity-convention pin made explicit).
import { UPGRADES } from '../src/config/upgrades.js'
import { WEAPON_ORDER, WEAPON_AFFIXES, WEAPON_AFFIX_ORDER, WEAPON_AFFIX_CHANCE, foldWeaponAffix } from '../src/config/weapons.js'
import { applyUpgrades, BASE_PLAYER_STATS } from '../src/core/MetaState.js'
// Bosses-phase PURE modules (§6.6, Decision 64/68, AC56/AC59/AC61): the archetype specs + per-biome
// pools, the boss table, and the boss-arena generator branch. All node-importable (no Phaser) — the
// verifier asserts the enemy-pool/archetype + boss-table well-formedness + the boss-arena contract.
import { ENEMY_SPECS, ENEMY_ARCHETYPES, GRUNT, ELITE_AFFIXES, ELITE_AFFIX, ELITE_CHANCE } from '../src/config/enemies.js'
import { BOSS_ORDER, BOSS_ATTACK_KINDS, BOSSES } from '../src/config/bosses.js'
// Enrichment round-3 PURE tables: the expanded run-only scroll set + the weighted elite-affix set. Both are
// node-importable pure data — a successful import re-proves purity, and the §9 sweep below asserts each is
// well-formed (a non-empty list, an apply()/identity-safe shape) — the same guardrail every config table gets.
import { SCROLLS, SCROLL_IDS } from '../src/config/scrolls.js'
import { createRunState as createRunStateForScrolls } from '../src/core/RunState.js'
// Enrichment PURE modules (§6.10/§6.11/§6.12, Decision 76/77/78): the in-run shop catalog (the gold sink),
// the elite-affix table, and the status-effect table. All node-importable (no Phaser) — a successful import
// re-proves their purity, and the new sections below assert each table is well-formed (KISS guardrails).
import { SHOP_ITEMS, SHOP_ITEM_KINDS } from '../src/config/shop.js'
import { STATUS_KINDS, makeStatus, applyStatus, tickStatuses, hasStatus } from '../src/combat/status.js'
import { WEAPONS } from '../src/config/weapons.js'

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

// ── Boss-arena assertions (design §6.6.2, Decision 66, AC57 — review BLOCKER) ── the boss arena is a
// DISTINCT generator branch with a DISTINCT contract: it has NO exit Door / no real exit, so it must
// NOT flow through checkDescription (whose exit≠entrance + exit-standable + entrance→exit BFS checks
// would REJECT it). This is its SEPARATE verification path: bounded, single-floor traversable (trivially
// — one floor), has a bossSpawn, enemies/pickups empty, isBossArena true, and NO meaningful exit (the
// exit is a harmless placeholder equal to the entrance, which this path does NOT forbid). Returns null
// on pass or a reason. (The N-seed sweep runs THIS for the boss-arena mode, NOT checkDescription.)
function checkBossArena(desc, biome) {
  // Bounded (AC28-style) — same size bounds as any level.
  if (desc.cols < COLS_MIN || desc.cols > COLS_MAX) return `boss arena cols ${desc.cols} out of bounds`
  if (desc.rows < ROWS_MIN || desc.rows > ROWS_MAX) return `boss arena rows ${desc.rows} out of bounds`
  if (desc.tiles.length !== desc.rows) return `boss arena tiles row count mismatch`
  if (desc.tiles[0].length !== desc.cols) return `boss arena tiles col count mismatch`
  // The DISTINCT boss-arena contract.
  if (desc.isBossArena !== true) return 'boss arena missing isBossArena flag'
  if (!desc.bossSpawn) return 'boss arena missing bossSpawn'
  if (desc.enemies.length !== 0) return `boss arena has ${desc.enemies.length} normal enemies (must be 0)`
  if (desc.pickups.length !== 0) return `boss arena has ${desc.pickups.length} pickups (must be 0)`
  // The entrance + bossSpawn must be STANDABLE (EMPTY with a support below) — the floor footing.
  const en = desc.entrance
  if (!isStandable(desc.tiles, en.col, en.row, desc.rows)) return 'boss arena entrance not standable'
  const bs = desc.bossSpawn
  if (!isStandable(desc.tiles, bs.col, bs.row, desc.rows)) return 'boss arena bossSpawn not standable'
  // Single-floor traversable: the entrance + bossSpawn share the floor (same row) so the player can
  // walk to the boss with no jump — trivially traversable by construction (one floor, nothing to fail).
  if (en.row !== bs.row) return 'boss arena entrance/bossSpawn not on the same floor (must be flat)'
  // There must be at least one HAZARD tile (the arena hazard — AC57).
  let hazardCount = 0
  for (let r = 0; r < desc.rows; r++) for (let c = 0; c < desc.cols; c++) if (desc.tiles[r][c] === TILE.HAZARD) hazardCount++
  if (hazardCount === 0) return 'boss arena has no HAZARD tiles (the arena hazard, AC57)'
  return null
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

  // (e) Traversable (AC27) — re-derived from the EMITTED platforms via the SHARED reach metric, so it
  // holds for ANY layout template (staircase/shaft/islands) by construction (Enrichment round-2).
  const t = bfsTraversable(desc)
  if (!t.ok) return `not traversable: ${t.reason}`

  // (e') Layout template well-formed (Enrichment round-2): the chosen `template` must be a KNOWN id. The
  // SWEEP below additionally asserts the SHAPE space is actually USED (no dead template) per real biome.
  if (!LAYOUT_TEMPLATES.includes(desc.template)) return `unknown layout template "${desc.template}"`

  // (f) §6.14 (Decision 80, AC67) — the OPTIONAL treasure branch: when present, its treasure ledge must be
  // STANDABLE (re-derived from tiles — GameScene places the reward there) AND REACHABLE from the entrance
  // (the branch only ADDS nodes, so the entrance→treasure BFS must succeed — the detour is takeable). The
  // main entrance→exit path is already proven by (e), so the branch never breaks the critical route.
  if (desc.branchTreasure) {
    const bt = desc.branchTreasure
    if (!isStandable(desc.tiles, bt.col, bt.row, desc.rows)) return `branch treasure (${bt.col},${bt.row}) not standable`
    const r = bfsReaches(desc, desc.entrance, bt)
    if (!r.ok) return `branch treasure not reachable from entrance: ${r.reason}`
  }

  return null
}

// ── bfsReaches(desc, fromCell, toCell) (§6.14, AC67) ── a generalized entrance→cell BFS over the platform
// graph (the SAME canReachPlatform metric the entrance→exit BFS uses — DRY). Used to prove the branch
// treasure is reachable from the entrance (the detour is takeable). Returns { ok, reason }.
function bfsReaches(desc, fromCell, toCell) {
  const plats = desc.platforms.filter((p) => p.type === TILE.SOLID || p.type === TILE.ONEWAY)
  const start = platformSupporting(plats, fromCell.col, fromCell.row)
  const goal = platformSupporting(plats, toCell.col, toCell.row)
  if (!start) return { ok: false, reason: 'from-cell has no supporting platform' }
  if (!goal) return { ok: false, reason: 'to-cell has no supporting platform' }
  if (start === goal) return { ok: true }
  const n = plats.length
  const adj = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && canReachPlatform(plats[i], plats[j])) adj[i].push(j)
    }
  }
  const startIdx = plats.indexOf(start)
  const goalIdx = plats.indexOf(goal)
  const seen = new Uint8Array(n)
  seen[startIdx] = 1
  const queue = [startIdx]
  while (queue.length) {
    const u = queue.shift()
    if (u === goalIdx) return { ok: true }
    for (const v of adj[u]) if (!seen[v]) { seen[v] = 1; queue.push(v) }
  }
  return { ok: false, reason: 'goal platform not reachable' }
}

// ── 3a) Determinism (AC19): generateLevel twice → DEEP-EQUAL (element-wise over the int grid). ──
// ── 3c/3d/3e) Per-seed bounds + spawn-validity + traversability over N seeds, for EVERY biome. ──
// §6.4 extends the sweep to the WHOLE BIOME_ORDER (not just PRISON) so AC28 (bounds / no-wall-spawn /
// traversable) holds for every biome the run can walk, not only the opener.
const N = 200
for (const biome of BIOME_ORDER) {
  // Enrichment round-2: track which LAYOUT TEMPLATES this biome's seed sweep actually produces, so we can
  // assert the SHAPE space is genuinely used (≥2 distinct templates) — i.e. the variety isn't dead config.
  const templatesSeen = new Set()
  for (let i = 0; i < N; i++) {
    // Spread the seeds (a Knuth multiplicative hash) so the sweep isn't a near-identical run of
    // adjacent integers — exercises a wide range of seeded layouts deterministically.
    const seed = (i * 2654435761) >>> 0
    const d1 = generateLevel(seed, biome)
    const d2 = generateLevel(seed, biome)
    if (!deepEqual(d1, d2)) fail(`determinism: biome ${biome.id} seed ${seed} produced two descriptions`)

    const reason = checkDescription(d1, biome)
    if (reason) fail(`biome ${biome.id} seed ${seed}: ${reason}`)
    templatesSeen.add(d1.template)
  }
  // Every real biome (≥ LAYOUT_MIN_COLS) must show MULTIPLE layout shapes across the sweep — the round-2
  // "every run feels different" guarantee. (All shipped biomes are ≥64 cols, well above the staircase-only
  // narrow-grid floor, so a single-template biome would be a regression in the weights/pick.)
  if (templatesSeen.size < 2) {
    fail(`biome ${biome.id}: only ${templatesSeen.size} layout template(s) across ${N} seeds (expected ≥2 — the variety win)`)
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

// The REAL grunt spec (config/enemies.js — Decision 68) is the scaleSpec monotonicity base. The Bosses
// phase hoisted the canonical specs to a PURE config so the verifier imports the SAME spec the game
// runs, REPLACING the old duplicated BASE_SPEC_STUB (review MINOR — DRY, one source of truth). scaleSpec
// only MULTIPLIES the numeric fields, so the grunt's real values prove "the scaled stat rises with depth".
const BASE_SPEC_STUB = GRUNT

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
    // ── ENRICHMENT (Decision 75) — the five deepened-table fields are ALL bigger-is-better (a meta tier
    // never weakens them). A max-level fold must leave each ≥ base on every upgrade (the rows that don't
    // touch a given field leave it at base = identity, which still satisfies ≥). This makes the new rows
    // verifier-proven non-weakening exactly like the original four.
    if (maxed.rangedDamageMult < BASE_PLAYER_STATS.rangedDamageMult) fail(`upgrade ${upg.id}: rangedDamageMult decreased`)
    if (maxed.dodgeIframeBonus < BASE_PLAYER_STATS.dodgeIframeBonus) fail(`upgrade ${upg.id}: dodgeIframeBonus decreased`)
    if (maxed.startGold < BASE_PLAYER_STATS.startGold) fail(`upgrade ${upg.id}: startGold decreased`)
    if (maxed.startScrolls < BASE_PLAYER_STATS.startScrolls) fail(`upgrade ${upg.id}: startScrolls decreased`)
    if (maxed.maxFlasks < BASE_PLAYER_STATS.maxFlasks) fail(`upgrade ${upg.id}: maxFlasks decreased`)
    if (maxed.flaskHealFrac < BASE_PLAYER_STATS.flaskHealFrac) fail(`upgrade ${upg.id}: flaskHealFrac decreased`)
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

// ════════════════════════════════════════════════════════════════════════════════════════════
// 6) Bosses + richness pure contracts (§6.6, Decision 64/66/68/69/70, AC56/AC57/AC59/AC60/AC61). An
//    INDEPENDENT proof of the enemy-pool/archetype + boss-table + 4-weapon + boss-arena contracts that
//    stay Phaser-free. NOTE on scope (review MAJOR — the HONEST claim): the WHOLE-RUN monotonicity walk
//    (§4c) reads effectiveDifficulty(depth, biome) = biome.tier + depth curve — it does NOT see boss
//    HP/attack tuning, so the boss BALANCE is NOT proven by that walk. What IS proven here for the boss
//    is a TABLE WELL-FORMEDNESS check (descending thresholds, known attack kinds, a non-empty pattern
//    per phase) + a depth-scaling GUARDRAIL (a deeper boss is never weaker) — guardrails, not a
//    winnability proof. The 4 enemy archetypes / 4 weapons / boss-arena contract ARE fully proven.
// ════════════════════════════════════════════════════════════════════════════════════════════

// ── 6a) Enemy archetypes well-formed (AC59): ≥4 archetypes, each with the shared numeric fields + a
// known behavior; the scaleSpec fold rises with depth on every archetype (not just the grunt). ──
{
  if (ENEMY_ARCHETYPES.length < 4) fail(`ENEMY_ARCHETYPES has ${ENEMY_ARCHETYPES.length}, expected ≥4 (AC59)`)
  const KNOWN_BEHAVIORS = ['melee', 'ranged', 'charge', 'fly']
  const SPEC_FIELDS = ['maxHp', 'bodyW', 'bodyH', 'patrolSpeed', 'chaseSpeed', 'attackRange', 'telegraph', 'contactDamage']
  for (const spec of ENEMY_ARCHETYPES) {
    if (!KNOWN_BEHAVIORS.includes(spec.behavior)) fail(`archetype ${spec.id}: unknown behavior ${spec.behavior}`)
    for (const f of SPEC_FIELDS) {
      if (typeof spec[f] !== 'number') fail(`archetype ${spec.id}: missing numeric field "${f}"`)
    }
    if (!spec.swing || typeof spec.swing.damage !== 'number') fail(`archetype ${spec.id}: missing swing.damage`)
    if (spec.telegraph <= 0) fail(`archetype ${spec.id}: telegraph must be > 0 (the dodge window, AC56)`)
    // A 'ranged' archetype MUST carry a projectile spec (it fires instead of swinging — Decision 65).
    if (spec.behavior === 'ranged') {
      if (!spec.projectile || typeof spec.projectile.damage !== 'number') {
        fail(`archetype ${spec.id}: ranged behavior but no projectile spec`)
      }
    }
    // scaleSpec rises with depth on THIS archetype (the scaling is real per-archetype).
    const s0 = scaleSpec(spec, scaleAtDepth(0)).maxHp
    const s10 = scaleSpec(spec, scaleAtDepth(10)).maxHp
    if (!(s10 > s0)) fail(`archetype ${spec.id}: scaled maxHp did not rise with depth (${s10} ≤ ${s0})`)
  }
}

// ── 6b) Per-biome enemyPool well-formed (AC59): every biome has a non-empty enemyPool referencing only
// KNOWN archetype ids with positive weights. The single source the SCENE picks archetypes from. ──
{
  for (const biome of BIOME_ORDER) {
    if (!Array.isArray(biome.enemyPool) || biome.enemyPool.length === 0) {
      fail(`biome ${biome.id}: enemyPool is empty (AC59)`)
    }
    for (const entry of biome.enemyPool) {
      if (!ENEMY_SPECS[entry.id]) fail(`biome ${biome.id}: enemyPool references unknown archetype "${entry.id}" (AC59)`)
      if (!(typeof entry.w === 'number') || entry.w <= 0) fail(`biome ${biome.id}: enemyPool weight for "${entry.id}" must be > 0`)
    }
  }
  // EXACTLY one biome ends in a boss (the last), and it carries a `boss` id keyed into a known boss.
  const bossBiomes = BIOME_ORDER.filter((b) => b.endsInBoss === true)
  if (bossBiomes.length !== 1) fail(`expected exactly 1 boss biome (endsInBoss), found ${bossBiomes.length} (AC57)`)
  if (bossBiomes[0] !== BIOME_ORDER[BIOME_ORDER.length - 1]) fail('the boss biome must be the LAST in BIOME_ORDER (AC57)')
  if (!bossBiomes[0].boss) fail(`boss biome ${bossBiomes[0].id} missing a boss id (AC57)`)
  // §6.12 (Decision 78, AC65) — the boss biome's `boss` may be a SINGLE id OR an ARRAY of ids (the seeded
  // multi-boss pick). EVERY id must resolve to a known boss in BOSSES (a typo / dangling id fails loudly,
  // mirroring the enemyPool unknown-id check). At least one id must be present (the gate needs a fight).
  const bossIds = Array.isArray(bossBiomes[0].boss) ? bossBiomes[0].boss : [bossBiomes[0].boss]
  if (bossIds.length === 0) fail(`boss biome ${bossBiomes[0].id}: empty boss list (AC65)`)
  for (const id of bossIds) {
    if (!BOSSES[id]) fail(`boss biome ${bossBiomes[0].id}: boss id "${id}" not in BOSSES (AC65)`)
  }
  // ── Round-2 (§6.6.8): a biome's OPTIONAL `miniboss` id must resolve to a known boss (a typo / dangling id
  // fails loudly, mirroring the boss-id check). EVERY non-boss biome SHOULD carry one (the per-biome set-piece
  // gate — so the run has an escalating climax per biome, not just the finale); we assert presence + validity. ──
  for (const biome of BIOME_ORDER) {
    if (biome.miniboss !== undefined && !BOSSES[biome.miniboss]) {
      fail(`biome ${biome.id}: miniboss id "${biome.miniboss}" not in BOSSES (round-2)`)
    }
    if (!biome.endsInBoss && !biome.miniboss) {
      fail(`biome ${biome.id}: a non-boss biome should declare a miniboss set-piece (round-2 §6.6.8)`)
    }
  }
}

// ── 6c) Boss table well-formed (AC56/AC61): ≥1 boss; each has ≥2 phases with DESCENDING hpThresholds
// (the first 1.0), each phase a non-empty pattern referencing only KNOWN attack kinds; every referenced
// attack exists in the boss's `attacks` map with the right params; the depth-scaling fold never weakens. ──
{
  if (BOSS_ORDER.length < 1) fail(`BOSS_ORDER has ${BOSS_ORDER.length} bosses, expected ≥1 (AC56)`)
  // Round-3: the boss kit grew from 3 → 4 primitives (the NEW 'sweep' radial ring). Assert the kind set
  // includes it AND that some boss actually USES it in a phase pattern (so the new kind isn't dead config).
  if (!BOSS_ATTACK_KINDS.includes('sweep')) fail(`BOSS_ATTACK_KINDS missing the round-3 'sweep' kind`)
  const sweepUsed = BOSS_ORDER.some((b) => b.phases.some((ph) => ph.attacks.includes('sweep')))
  if (!sweepUsed) fail(`no boss uses the new 'sweep' attack kind in any phase pattern (dead config)`)
  for (const boss of BOSS_ORDER) {
    if (!(typeof boss.maxHp === 'number') || boss.maxHp <= 0) fail(`boss ${boss.id}: maxHp must be > 0`)
    if (!Array.isArray(boss.phases) || boss.phases.length < 2) fail(`boss ${boss.id}: expected ≥2 phases (AC56)`)
    if (boss.phases[0].hpThreshold !== 1.0) fail(`boss ${boss.id}: phase 0 hpThreshold must be 1.0 (active from full HP)`)
    for (let i = 1; i < boss.phases.length; i++) {
      if (boss.phases[i].hpThreshold > boss.phases[i - 1].hpThreshold) {
        fail(`boss ${boss.id}: phase thresholds not descending at ${i}`)
      }
    }
    for (const phase of boss.phases) {
      if (!Array.isArray(phase.attacks) || phase.attacks.length === 0) fail(`boss ${boss.id}: a phase has an empty attack pattern (AC56)`)
      if (!(typeof phase.telegraphMult === 'number') || phase.telegraphMult <= 0) fail(`boss ${boss.id}: telegraphMult must be > 0`)
      for (const kind of phase.attacks) {
        if (!BOSS_ATTACK_KINDS.includes(kind)) fail(`boss ${boss.id}: phase pattern references unknown attack kind "${kind}" (AC56)`)
        const atk = boss.attacks[kind]
        if (!atk) fail(`boss ${boss.id}: phase references attack "${kind}" missing from the attacks map`)
        if (!(atk.telegraph > 0)) fail(`boss ${boss.id}: attack "${kind}" telegraph must be > 0 (dodgeable, AC56)`)
        if (!(atk.active > 0)) fail(`boss ${boss.id}: attack "${kind}" active must be > 0`)
      }
    }
    // Depth-scaling GUARDRAIL (review MAJOR — the HONEST claim): a deeper boss is never WEAKER. The
    // boss-specific fold (scaleBossSpec) scales maxHp + every attack's damage by the depth curve;
    // assert a depth-10 boss has ≥ the base maxHp + ≥ each attack's base damage (monotone, non-mutating).
    const base = boss
    const scaled0 = scaleBossSpec(boss, scaleAtDepth(0))
    const scaled10 = scaleBossSpec(boss, scaleAtDepth(10))
    if (scaled10.maxHp < scaled0.maxHp) fail(`boss ${boss.id}: scaled maxHp dropped with depth (${scaled10.maxHp} < ${scaled0.maxHp})`)
    if (scaled10.maxHp < base.maxHp) fail(`boss ${boss.id}: scaled maxHp below base (${scaled10.maxHp} < ${base.maxHp})`)
    // Non-mutation: snapshot a base attack damage, run the fold, re-read it (scaleBossSpec must clone).
    const baseSlamDmg = base.attacks.slam ? base.attacks.slam.swing.damage : null
    // Iterate the boss's OWN defined attacks (round-2: a miniboss may define only a subset of the four kinds —
    // it doesn't need every primitive, only the ones its phases reference, which 6c already proves exist).
    for (const kind of Object.keys(base.attacks)) {
      const a = base.attacks[kind]
      const a10 = scaled10.attacks[kind]
      if (a.swing && a10.swing.damage < a.swing.damage) fail(`boss ${boss.id}: scaled ${kind} slam damage dropped`)
      if (a.projectile && a10.projectile.damage < a.projectile.damage) fail(`boss ${boss.id}: scaled ${kind} volley damage dropped`)
      if (typeof a.contactDamage === 'number' && a10.contactDamage < a.contactDamage) fail(`boss ${boss.id}: scaled ${kind} dash damage dropped`)
    }
    // Non-mutation: the base table's slam damage must be UNCHANGED after the folds (scaleBossSpec clones).
    if (baseSlamDmg !== null && base.attacks.slam.swing.damage !== baseSlamDmg) {
      fail(`boss ${boss.id}: scaleBossSpec MUTATED the base attacks (aliasing bug)`)
    }
  }
}

// ── 6d) 4-weapon richness (AC60): WEAPON_ORDER grew to ≥4 (the §5d swing-table check already proves
// each is well-formed; here we just assert the COUNT requirement of the Bosses phase). ──
{
  if (WEAPON_ORDER.length < 4) fail(`WEAPON_ORDER has ${WEAPON_ORDER.length} weapons, expected ≥4 (AC60)`)
}

// ── 6e) Boss-arena generator branch (AC57, review BLOCKER): the boss-arena MODE is a DISTINCT pure
// generateLevel branch. Sweep N seeds for the boss biome's arena and run them through checkBossArena
// (NOT checkDescription — the no-exit arena would fail its exit/traversability checks). Also re-prove
// the arena is DETERMINISTIC (same seed → deep-equal) like every other generation. ──
{
  const bossBiome = BIOME_ORDER[BIOME_ORDER.length - 1]
  const arenaCfg = { ...bossBiome, bossArena: true }
  for (let i = 0; i < N; i++) {
    const seed = (i * 2654435761) >>> 0
    const a1 = generateLevel(seed, arenaCfg)
    const a2 = generateLevel(seed, arenaCfg)
    if (!deepEqual(a1, a2)) fail(`boss-arena determinism: seed ${seed} produced two descriptions`)
    const reason = checkBossArena(a1, bossBiome)
    if (reason) fail(`boss arena seed ${seed}: ${reason}`)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 7) Enrichment pure contracts (§6.10, Decision 76, AC63). An INDEPENDENT proof of the in-run shop
//    catalog (the GOLD SINK) that stays Phaser-free: a non-empty list, a positive gold price, a known
//    kind per item, and the kind-specific param present (weaponId for 'weapon', healFrac for 'heal').
//    Mirrors the upgrade-table / boss-table well-formedness checks — a malformed catalog fails loudly.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  if (!Array.isArray(SHOP_ITEMS) || SHOP_ITEMS.length === 0) fail('SHOP_ITEMS is empty (AC63 — the gold sink needs items)')
  for (const it of SHOP_ITEMS) {
    if (typeof it.id !== 'string' || !it.id) fail(`shop item missing id`)
    if (typeof it.name !== 'string' || !it.name) fail(`shop item ${it.id}: missing name`)
    if (!(typeof it.price === 'number') || it.price <= 0) fail(`shop item ${it.id}: price must be > 0 gold`)
    if (!SHOP_ITEM_KINDS.includes(it.kind)) fail(`shop item ${it.id}: unknown kind "${it.kind}" (AC63)`)
    // Kind-specific params (GameScene._buyShopItem reads these — assert the right one is present + sane).
    if (it.kind === 'weapon' && (typeof it.weaponId !== 'string' || !it.weaponId)) fail(`shop item ${it.id}: 'weapon' needs a weaponId`)
    if (it.kind === 'heal' && !(typeof it.healFrac === 'number' && it.healFrac > 0)) fail(`shop item ${it.id}: 'heal' needs a healFrac > 0`)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 8) Combat status effects (§6.13, Decision 79, AC66). An INDEPENDENT proof of the PURE status tick
//    math (bleed/poison/stun) + the weapon status tags. A successful import re-proves status.js is
//    Phaser-free; the asserts pin the DoT accumulation, the stun flag, expiry, and refresh-on-re-hit.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── 8a) Weapon status tags reference only KNOWN kinds, with sane params (a damaging status needs a
  // positive tickInterval + tickDmg; a stun is non-damaging). A malformed tag fails loudly. ──
  for (const w of Object.values(WEAPONS)) {
    if (!w.status) continue // a weapon with no status (sword) is fine — the identity.
    if (!STATUS_KINDS.includes(w.status.kind)) fail(`weapon ${w.id}: unknown status kind "${w.status.kind}" (AC66)`)
    if (!(w.status.duration > 0)) fail(`weapon ${w.id}: status duration must be > 0`)
    const damaging = w.status.kind === 'bleed' || w.status.kind === 'poison'
    if (damaging && !(w.status.tickInterval > 0 && w.status.tickDmg > 0)) {
      fail(`weapon ${w.id}: a damaging status needs tickInterval > 0 AND tickDmg > 0`)
    }
  }

  // ── 8b) tickStatuses accumulates DoT correctly: a bleed of tickDmg=3 every 0.4s, ticked in 0.1s steps
  // over 0.4s, emits EXACTLY 3 damage once (one full interval crossed), and is still live (timer > 0). ──
  {
    const list = []
    applyStatus(list, { kind: 'bleed', duration: 2.4, tickInterval: 0.4, tickDmg: 3 })
    let total = 0
    for (let i = 0; i < 4; i++) total += tickStatuses(list, 0.1).damage // 4 × 0.1 = 0.4s → one interval.
    if (total !== 3) fail(`status tick: 0.4s of a 0.4s/3 bleed should deal 3, got ${total}`)
    if (!hasStatus(list, 'bleed')) fail('status tick: bleed should still be live after 0.4s of 2.4s duration')
  }

  // ── 8c) A status EXPIRES + is DROPPED when its timer elapses (the list shrinks); a non-damaging stun
  // reports `stunned` true while live + false (and is gone) after it expires. ──
  {
    const list = []
    applyStatus(list, { kind: 'stun', duration: 0.5 })
    const mid = tickStatuses(list, 0.3) // 0.3 < 0.5 → still stunned.
    if (!mid.stunned) fail('status tick: a 0.5s stun should be stunned at 0.3s')
    const end = tickStatuses(list, 0.3) // total 0.6 > 0.5 → expired.
    if (end.stunned) fail('status tick: a 0.5s stun should NOT be stunned after 0.6s')
    if (list.length !== 0) fail(`status tick: an expired status should be dropped (list len ${list.length})`)
  }

  // ── 8d) applyStatus REFRESHES (does not stack) a same-kind status: two applies → ONE entry, with the
  // timer refreshed to the longer duration (re-poking extends, never multiplies the list). ──
  {
    const list = []
    applyStatus(list, { kind: 'poison', duration: 1.0, tickInterval: 0.5, tickDmg: 2 })
    tickStatuses(list, 0.6) // decay below the fresh duration.
    applyStatus(list, { kind: 'poison', duration: 1.0, tickInterval: 0.5, tickDmg: 2 }) // re-apply.
    if (list.length !== 1) fail(`status apply: a re-applied poison must refresh, not stack (len ${list.length})`)
    if (!(list[0].timer >= 1.0 - 1e-9)) fail(`status apply: re-apply should refresh the timer to the full duration`)
  }

  // ── 8e) makeStatus is pure (a fresh object) + identity-safe (a non-damaging stun has 0 tick params). ──
  {
    const a = makeStatus({ kind: 'stun', duration: 0.5 })
    const b = makeStatus({ kind: 'stun', duration: 0.5 })
    if (a === b) fail('makeStatus must return a fresh object each call')
    if (a.tickDmg !== 0 || a.tickInterval !== 0) fail('makeStatus: a stun must default to non-damaging (0 tick)')
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 9) Enrichment round-3 build-variety tables (the expanded SCROLLS + the weighted ELITE_AFFIXES). An
//    INDEPENDENT proof that the deepened run-only pool + elite-affix set are well-formed: a non-empty
//    list, a pure apply() that does not throw / does not leak (it only mutates the passed RunState's
//    run-only fields), and per-affix sane params. Mirrors the upgrade/shop/boss table well-formedness
//    checks — a malformed table fails loudly under node, never reaching the game.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── 9a) SCROLLS well-formed (AC52 — build variety): ≥4 scrolls (the round-3 ask), each with a string
  // id + name + a function apply; the id list is unique (SCROLL_IDS deduped). The genre's build divergence
  // needs a pool, not 2 flat bumps. ──
  if (!Array.isArray(SCROLLS) || SCROLLS.length < 4) {
    fail(`SCROLLS has ${SCROLLS?.length} entries, expected ≥4 (round-3 build variety)`)
  }
  const seenScrollIds = new Set()
  for (const s of SCROLLS) {
    if (typeof s.id !== 'string' || !s.id) fail('scroll missing id')
    if (typeof s.name !== 'string' || !s.name) fail(`scroll ${s.id}: missing name`)
    if (typeof s.apply !== 'function') fail(`scroll ${s.id}: apply is not a function`)
    if (seenScrollIds.has(s.id)) fail(`scroll ${s.id}: duplicate id`)
    seenScrollIds.add(s.id)
  }
  if (SCROLL_IDS.length !== SCROLLS.length) fail('SCROLL_IDS length != SCROLLS length (id list drift)')

  // ── 9b) Each scroll's apply() is PURE-effect (mutates ONLY the passed RunState's run-only fields) and a
  // never-weaken boost: applying it must not THROW and must leave the run a sane state. We apply EACH scroll
  // to a fresh RunState (constructed node-side — RunState is Phaser-free) and assert the run-only fields it
  // touches moved in the right direction (a boost never weakens — the same sense the upgrade fold proves). ──
  for (const s of SCROLLS) {
    const run = createRunStateForScrolls(0xc0ffee, 0)
    // Snapshot the run-only fields the scroll set can touch.
    const before = {
      dmg: run.scrollDamageMult,
      hp: run.scrollMaxHpBonus,
      life: run.scrollLifestealFrac,
      stat: run.scrollStatusDurationMult,
      cd: run.scrollDodgeCdMult,
      ifr: run.scrollDodgeIframeBonus,
      flasksMax: run.maxFlasks,
    }
    s.apply(run) // must not throw.
    // Damage / max-HP / lifesteal / status / flask are bigger-is-better; the dodge-cooldown mult is
    // smaller-is-better (a shorter cooldown). Assert NONE moved the wrong way (a boost never weakens).
    if (run.scrollDamageMult < before.dmg) fail(`scroll ${s.id}: scrollDamageMult decreased`)
    if (run.scrollMaxHpBonus < before.hp) fail(`scroll ${s.id}: scrollMaxHpBonus decreased`)
    if (run.scrollLifestealFrac < before.life) fail(`scroll ${s.id}: scrollLifestealFrac decreased`)
    if (run.scrollStatusDurationMult < before.stat) fail(`scroll ${s.id}: scrollStatusDurationMult decreased`)
    if (run.scrollDodgeIframeBonus < before.ifr) fail(`scroll ${s.id}: scrollDodgeIframeBonus decreased`)
    if (run.maxFlasks < before.flasksMax) fail(`scroll ${s.id}: maxFlasks decreased`)
    if (run.scrollDodgeCdMult > before.cd) fail(`scroll ${s.id}: scrollDodgeCdMult increased (a longer dodge cooldown is a weaken)`)
    // At least ONE field must have changed (a no-op scroll is a content bug — a found scroll must DO something).
    const changed =
      run.scrollDamageMult !== before.dmg || run.scrollMaxHpBonus !== before.hp ||
      run.scrollLifestealFrac !== before.life || run.scrollStatusDurationMult !== before.stat ||
      run.scrollDodgeCdMult !== before.cd || run.scrollDodgeIframeBonus !== before.ifr ||
      run.maxFlasks !== before.flasksMax
    if (!changed) fail(`scroll ${s.id}: apply() changed no run-only field (a no-op scroll)`)
  }

  // ── 9c) ELITE_AFFIXES well-formed (AC64 — elite variety): a weighted set of ≥3 affixes ({ affix, w }),
  // each with a string id, a positive weight, and sane modifier ranges (multipliers > 0; a death burst, if
  // present, has a positive count + a projectile spec). The single-affix ELITE_AFFIX back-compat export must
  // resolve to one of the set's affixes (DRY — not a divergent copy). ELITE_CHANCE is a probability in (0,1). ──
  if (!Array.isArray(ELITE_AFFIXES) || ELITE_AFFIXES.length < 3) {
    fail(`ELITE_AFFIXES has ${ELITE_AFFIXES?.length} entries, expected ≥3 (round-3 elite variety)`)
  }
  const seenAffixIds = new Set()
  for (const entry of ELITE_AFFIXES) {
    if (!(typeof entry.w === 'number') || entry.w <= 0) fail(`elite affix entry: weight must be > 0`)
    const a = entry.affix
    if (!a || typeof a.id !== 'string' || !a.id) fail('elite affix: missing id')
    if (seenAffixIds.has(a.id)) fail(`elite affix ${a.id}: duplicate id`)
    seenAffixIds.add(a.id)
    // Modifier sanity: any present multiplier must be > 0 (a 0/negative would zero/flip the stat).
    for (const f of ['hpMult', 'bodyScale', 'telegraphMult', 'speedMult', 'knockbackTakeMult', 'hpRegenPerSec', 'cellBonus']) {
      if (a[f] !== undefined && !(typeof a[f] === 'number' && a[f] >= 0)) fail(`elite affix ${a.id}: ${f} must be a number ≥ 0`)
    }
    if (a.hpMult !== undefined && a.hpMult <= 0) fail(`elite affix ${a.id}: hpMult must be > 0`)
    if (a.deathBurst) {
      if (!(a.deathBurst.count > 0)) fail(`elite affix ${a.id}: deathBurst.count must be > 0`)
      if (!a.deathBurst.projectile || !(a.deathBurst.projectile.speed > 0)) fail(`elite affix ${a.id}: deathBurst needs a projectile with speed > 0`)
    }
  }
  // The back-compat default must be one of the set's affixes (referential — DRY, not a stale copy).
  if (!ELITE_AFFIXES.some((e) => e.affix === ELITE_AFFIX)) fail('ELITE_AFFIX (back-compat) is not one of ELITE_AFFIXES')
  if (!(typeof ELITE_CHANCE === 'number' && ELITE_CHANCE > 0 && ELITE_CHANCE < 1)) fail(`ELITE_CHANCE must be in (0,1), got ${ELITE_CHANCE}`)
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 10) Weapon AFFIXES (Enrichment round-2 — the in-run weapon build engine). An INDEPENDENT proof that the
//     weighted affix set + the pure foldWeaponAffix fold are well-formed: a non-empty weighted set, sane
//     per-affix modifiers, and a fold that (a) never mutates the shared weapon config, (b) PRESERVES the
//     weapon schema (so the Player reads it unchanged), and (c) never WEAKENS the weapon's damage (an affix
//     is always a bonus). Mirrors the elite-affix / upgrade-table well-formedness checks — a malformed affix
//     table fails loudly under node, never reaching the game.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── 10a) WEAPON_AFFIXES well-formed: a weighted set of ≥3 affixes ({ affix, w }), each with a string
  // id + name + positive weight, sane modifier ranges (any present multiplier > 0; a lifesteal in [0,1]),
  // and a well-formed addStatus when present (a known damaging status shape). WEAPON_AFFIX_CHANCE ∈ (0,1). ──
  if (!Array.isArray(WEAPON_AFFIXES) || WEAPON_AFFIXES.length < 3) {
    fail(`WEAPON_AFFIXES has ${WEAPON_AFFIXES?.length} entries, expected ≥3 (round-2 weapon build engine)`)
  }
  const seenWAffix = new Set()
  for (const entry of WEAPON_AFFIXES) {
    if (!(typeof entry.w === 'number') || entry.w <= 0) fail('weapon affix entry: weight must be > 0')
    const a = entry.affix
    if (!a || typeof a.id !== 'string' || !a.id) fail('weapon affix: missing id')
    if (typeof a.name !== 'string' || !a.name) fail(`weapon affix ${a.id}: missing name`)
    if (seenWAffix.has(a.id)) fail(`weapon affix ${a.id}: duplicate id`)
    seenWAffix.add(a.id)
    for (const f of ['damageMult', 'knockbackMult', 'comboSpeedMult']) {
      if (a[f] !== undefined && !(typeof a[f] === 'number' && a[f] > 0)) fail(`weapon affix ${a.id}: ${f} must be > 0`)
    }
    if (a.lifestealFrac !== undefined && !(a.lifestealFrac >= 0 && a.lifestealFrac <= 1)) {
      fail(`weapon affix ${a.id}: lifestealFrac must be in [0,1]`)
    }
    if (a.addStatus) {
      if (typeof a.addStatus.kind !== 'string' || !a.addStatus.kind) fail(`weapon affix ${a.id}: addStatus needs a kind`)
      if (!(a.addStatus.duration > 0)) fail(`weapon affix ${a.id}: addStatus duration must be > 0`)
    }
    // The affix MUST do SOMETHING (a no-op affix is a content bug — a rolled affix must change the weapon).
    const doesSomething =
      (a.damageMult ?? 1) !== 1 || (a.knockbackMult ?? 1) !== 1 || (a.comboSpeedMult ?? 1) !== 1 ||
      (a.lifestealFrac ?? 0) !== 0 || !!a.addStatus
    if (!doesSomething) fail(`weapon affix ${a.id}: changes nothing about the weapon (a no-op affix)`)
  }
  if (!(typeof WEAPON_AFFIX_CHANCE === 'number' && WEAPON_AFFIX_CHANCE > 0 && WEAPON_AFFIX_CHANCE < 1)) {
    fail(`WEAPON_AFFIX_CHANCE must be in (0,1), got ${WEAPON_AFFIX_CHANCE}`)
  }

  // ── 10b) foldWeaponAffix is a PURE, schema-preserving, never-weaken fold: for EVERY (weapon, affix) pair
  // it must (a) return a NEW object that keeps the weapon schema (same type, a non-empty swings table, a
  // projectile IFF ranged, a status when addStatus is present), (b) never MUTATE the shared weapon config,
  // and (c) never reduce a swing's damage below the base (an affix only ever helps). Identity on a null affix. ──
  {
    // Identity: a null affix returns the SAME weapon ref (the plain weapon — no fold).
    for (const w of WEAPON_ORDER) {
      if (foldWeaponAffix(w, null) !== w) fail(`foldWeaponAffix(${w.id}, null) must return the plain weapon (identity)`)
    }
    for (const w of WEAPON_ORDER) {
      const baseDmgs = w.swings.map((s) => s.damage)
      const baseProjDmg = w.projectile ? w.projectile.damage : null
      for (const affix of WEAPON_AFFIX_ORDER) {
        const folded = foldWeaponAffix(w, affix)
        if (folded === w) fail(`foldWeaponAffix(${w.id}, ${affix.id}) must return a NEW object (no mutation)`)
        // Schema preserved.
        if (folded.type !== w.type) fail(`foldWeaponAffix(${w.id}, ${affix.id}): type changed`)
        if (!Array.isArray(folded.swings) || folded.swings.length !== w.swings.length) fail(`foldWeaponAffix(${w.id}, ${affix.id}): swings table malformed`)
        if (w.type === 'ranged' && !folded.projectile) fail(`foldWeaponAffix(${w.id}, ${affix.id}): ranged weapon lost its projectile`)
        if (w.type !== 'ranged' && folded.projectile) fail(`foldWeaponAffix(${w.id}, ${affix.id}): melee weapon gained a projectile`)
        if (affix.addStatus && (!folded.status || folded.status.kind !== affix.addStatus.kind)) {
          fail(`foldWeaponAffix(${w.id}, ${affix.id}): addStatus affix did not stamp the status`)
        }
        // active/recovery stay sane (a faster combo must not collapse the lock to 0 — a re-fire bug guard).
        for (const s of folded.swings) {
          if (!(s.active > 0)) fail(`foldWeaponAffix(${w.id}, ${affix.id}): a swing active collapsed to ≤0`)
          if (s.recovery < 0) fail(`foldWeaponAffix(${w.id}, ${affix.id}): a swing recovery went negative`)
        }
        // Never-weaken: every swing's damage ≥ the base (an affix only helps the player).
        folded.swings.forEach((s, i) => {
          if (s.damage < baseDmgs[i]) fail(`foldWeaponAffix(${w.id}, ${affix.id}): swing ${i} damage ${s.damage} < base ${baseDmgs[i]}`)
        })
        if (baseProjDmg !== null && folded.projectile.damage < baseProjDmg) {
          fail(`foldWeaponAffix(${w.id}, ${affix.id}): projectile damage dropped below base`)
        }
        // affixLifestealFrac is surfaced for the hit-site read (≥0).
        if (!(folded.affixLifestealFrac >= 0)) fail(`foldWeaponAffix(${w.id}, ${affix.id}): affixLifestealFrac must be ≥ 0`)
      }
      // Non-mutation: the base weapon's swing damages + projectile damage are UNCHANGED after all the folds.
      w.swings.forEach((s, i) => {
        if (s.damage !== baseDmgs[i]) fail(`foldWeaponAffix MUTATED ${w.id} base swing ${i} damage (aliasing bug)`)
      })
      if (baseProjDmg !== null && w.projectile.damage !== baseProjDmg) fail(`foldWeaponAffix MUTATED ${w.id} base projectile damage (aliasing bug)`)
    }
  }
}

console.log(
  `verify-gen OK: rng deterministic+pinned; combat hitbox/damage pure+pinned; ` +
    `${N} seeds × ${BIOME_ORDER.length} biomes → deterministic + bounds(AC28) + no-wall-spawn(AC28) + ` +
    `traversable(AC27) + branch-treasure standable&reachable(AC67) + layout-template variety (${LAYOUT_TEMPLATES.length} shapes, round-2); level pin OK; ` +
    `curve+tiers+whole-run monotonic (AC42/AC43) over ${totalLevels} ` +
    `levels; seed chain deterministic (AC47); upgrades/weapons pure+well-formed + applyUpgrades ` +
    `identity/non-mutating/never-weaker (AC55); ${ENEMY_ARCHETYPES.length} enemy archetypes + per-biome ` +
    `pools (AC59); boss table well-formed + depth-scaling guardrail (AC56/AC61); ${WEAPON_ORDER.length} ` +
    `weapons (AC60); boss-arena branch deterministic + valid over ${N} seeds (AC57); ` +
    `${SHOP_ITEMS.length} shop items well-formed (AC63); ${BOSS_ORDER.length} bosses+minibosses well-formed (AC65, round-2 roster); ` +
    `status tick/expiry/refresh pure+pinned (${STATUS_KINDS.length} kinds, AC66); ` +
    `${SCROLLS.length} scrolls + ${ELITE_AFFIXES.length} elite affixes well-formed (round-3 build variety); ` +
    `${WEAPON_AFFIXES.length} weapon affixes pure-fold/schema-preserving/never-weaken (round-2 build engine)`,
)
process.exit(0)
