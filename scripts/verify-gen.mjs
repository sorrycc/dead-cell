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
import { generateLevel, TILE, TILE_SIZE, canReachPlatform, canReachStep, LAYOUT_TEMPLATES, isRemountRun, floorRecoveryGaps, RECOVERY_MIN_COLS, bodyFits, bodyStandClear, CLEAR_COLS, CLEAR_ROWS, APEX_H } from '../src/world/LevelGenerator.js'
import { PRISON, BIOME_ORDER, BIOMES, START_BIOME_ID, COLS_MIN, COLS_MAX, ROWS_MIN, ROWS_MAX } from '../src/config/biomes.js'
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
import { UPGRADES, UPGRADES_BY_ID } from '../src/config/upgrades.js'
import { WEAPON_ORDER, WEAPON_AFFIXES, WEAPON_AFFIX_ORDER, WEAPON_AFFIX_CHANCE, foldWeaponAffix, SWORD, WEAPON_KEEN, runWeaponPool } from '../src/config/weapons.js'
import { applyUpgrades, BASE_PLAYER_STATS } from '../src/core/MetaState.js'
// Meta-progression PURE modules (meta-progression §6.10, AC1/AC6/AC11): the Boss-Cell TIER table + the BLUEPRINT
// catalog + the three run-pool RESOLVERS. All node-importable (no Phaser, no top-level localStorage) — a
// successful import RE-PROVES their purity (the convention every config table satisfies). The §5 sweeps below
// assert the tier table is well-formed + monotone, the blueprint catalog ↔ table-tags are consistent, the
// resolvers return EXACTLY the starters on an empty set (the identity pin), and the bankRun unlock/merge math.
import { BOSS_CELL_TIERS, MAX_TIER, tierAt } from '../src/config/tiers.js'
import { BLUEPRINTS, BLUEPRINTS_BY_ID } from '../src/config/blueprints.js'
import { runSkillPool } from '../src/config/skills.js'
import { runMutationPool } from '../src/config/mutations.js'
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
// Build-&-replay slice PURE table: the MUTATIONS perk table (the choice-driven run-power layer). Node-importable
// (config/mutations.js imports NOTHING from Phaser — only a type from config/scrolls.js) — a successful import
// re-proves its purity, and the §12 sweep below asserts it's well-formed (a non-empty list, an apply()/identity-
// safe shape that never WEAKENS a bigger-is-better RunState field) — the same guardrail every config table gets.
import { MUTATIONS, MUTATIONS_BY_ID, MUTATION_ORDER } from '../src/config/mutations.js'
// Enrichment PURE modules (§6.10/§6.11/§6.12, Decision 76/77/78): the in-run shop catalog (the gold sink),
// the elite-affix table, and the status-effect table. All node-importable (no Phaser) — a successful import
// re-proves their purity, and the new sections below assert each table is well-formed (KISS guardrails).
import { SHOP_ITEMS, SHOP_ITEM_KINDS } from '../src/config/shop.js'
import { STATUS_KINDS, makeStatus, applyStatus, tickStatuses, hasStatus } from '../src/combat/status.js'
import { WEAPONS } from '../src/config/weapons.js'
// Skills slice PURE table: the SKILLS loadout table (the secondary-item layer). Node-importable (config/
// skills.js imports NOTHING from Phaser — only a type from config/weapons.js) — a successful import re-proves
// its purity, and the §11 sweep below asserts it's well-formed (a non-empty list, known kinds, positive
// cooldowns, kind-specific params present + numeric) — the same guardrail every config table gets.
import { SKILLS, SKILL_KINDS, SKILLS_BY_ID, SKILL_ORDER } from '../src/config/skills.js'
// Color-scaling-stats PURE table: the COLOURS table + the scaling math (§14). Node-importable (config/colors.js
// imports NOTHING — pure data + two pure functions) — a successful import re-proves its purity, and the §14
// sweep below asserts the colour space is well-formed + colorMult/survivalHpBonus are monotone with an EXACT
// identity at level 0 (the byte-identity pin) — the same guardrail every config table gets.
import { COLOR_IDS, COLORS, PER_LEVEL, SURVIVAL_HP_PER_LEVEL, colorMult, survivalHpBonus } from '../src/config/colors.js'
// Item-rarity-forge PURE table: the RARITIES tier table + the rarity math (§15). Node-importable (config/rarity.js
// imports only a TYPE from config/weapons.js — pure data + two pure functions) — a successful import re-proves its
// purity, and the §15 sweep below asserts the tier space is well-formed, damageMult is monotone with an EXACT
// identity at `common`, foldRarity never weakens, and the extended foldWeaponAffix(powerMult) is identity@1.
import { RARITY_IDS, RARITIES, DEPTH_BIAS, EXTRA_AFFIX_POWER, rollRarityId, foldRarity } from '../src/config/rarity.js'

// Cursed-chests PURE table: the CURSE config + the curse-damage math (§16). Node-importable (config/curses.js
// imports ONLY config/rarity.js — pure data + one pure function) — a successful import re-proves its purity,
// and the §16 sweep below asserts the curse is well-formed, effectiveCurseMult is the EXACT identity at 0
// stacks + clamps at/below 0, the curse mult is monotone non-decreasing + every >= 1 (never-weaken), and the
// loot tier is a known NON-common (guaranteed STRONG) rarity with positive loot gold.
import { CURSE, LOOT_RARITY, LOOT_GOLD, CURSED_CHEST_CHANCE, effectiveCurseMult } from '../src/config/curses.js'

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

  // (g) Floor-recovery LOCALITY + reconnection (floor-recovery-ledges design, AC1/AC2/AC4) — a player who
  // FELL to the floor must be able to climb back to the exit LOCALLY (bounded walk), not only via a
  // full-level backtrack. RE-derived from the EMITTED tiles/platforms (independent of the generator's intent).
  const fr = checkFloorRecovery(desc)
  if (fr) return fr

  // (h) Body-aware clearance (body-aware-clearance design, AC1/AC2) — the STRONGEST proof, layered after the
  // point-mass BFS (a cheap first gate): the REAL 36×52 collision body (not a point mass) is body-clear at every
  // node it stands on AND provably travels entrance→exit (no 1-tile wedge / low-ceiling trap). RE-derived from
  // the EMITTED tiles, independent of the generator's intent.
  const cl = checkClearance(desc)
  if (cl) return cl

  return null
}

// ── checkFloorRecovery(desc) (floor-recovery-ledges design, AC1/AC2/AC4) ── prove, independently from the
// EMITTED platforms, that a fallen player recovers LOCALLY. Gated to cols ≥ RECOVERY_MIN_COLS (the cols:40
// pin is exempt, mirroring the generator). Three checks:
//   (i)  LOCALITY (AC1): no interior floor run wider than the bound lacks a SOLID re-mount — via the SHARED
//        floorRecoveryGaps/isRemountRun the generator placed with (DRY — they cannot disagree).
//   (ii) RECONNECTION (AC2): every SOLID re-mount reaches the exit in the platform reach graph EXCLUDING the
//        floor run — so a climb-out leads to the exit by REAL platforming, not by walking the floor back to
//        the entrance (the very backtrack the feature removes). ONE reverse-BFS from the exit, then membership.
//   (iii) HAZARD-FREE LANE (AC4): no HAZARD tile on the floor walk lane (row floorRow-1).
// Returns null on pass or a reason string.
function checkFloorRecovery(desc) {
  if (desc.cols < RECOVERY_MIN_COLS) return null // narrow grids (the pin) exempt — mirrors the generator gate.
  const floorRow = desc.rows - 1

  // (i) Locality — re-derive SOLID band re-mounts from the emitted platforms and assert no over-budget gap.
  const remounts = desc.platforms.filter((p) => isRemountRun(p, floorRow, desc.cols))
  const gaps = floorRecoveryGaps(remounts, desc.cols)
  if (gaps.length > 0) {
    const [lo, hi] = gaps[0]
    return `floor not recoverable: interior columns [${lo},${hi}] (${hi - lo + 1} wide) have no nearby re-mount (locality)`
  }

  // (ii) Reconnection — the reach graph over SOLID+ONEWAY platforms EXCLUDING the floor run (row === floorRow),
  // so reaching the exit proves a real climb, not the floor backtrack. ONE reverse-BFS from the exit platform.
  const graph = desc.platforms.filter(
    (p) => (p.type === TILE.SOLID || p.type === TILE.ONEWAY) && p.row !== floorRow,
  )
  const goal = platformSupporting(graph, desc.exit.col, desc.exit.row)
  if (!goal) return 'floor recovery: exit cell has no supporting platform'
  const n = graph.length
  const radj = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // Forward edge i→j when canReachPlatform(i,j); record the REVERSE edge so a BFS from the exit finds
      // every node that can REACH the exit.
      if (i !== j && canReachPlatform(graph[i], graph[j])) radj[j].push(i)
    }
  }
  const goalIdx = graph.indexOf(goal)
  const reachesExit = new Uint8Array(n)
  reachesExit[goalIdx] = 1
  const queue = [goalIdx]
  while (queue.length) {
    const u = queue.shift()
    for (const v of radj[u]) if (!reachesExit[v]) { reachesExit[v] = 1; queue.push(v) }
  }
  for (const rm of remounts) {
    const idx = graph.indexOf(rm)
    if (idx < 0 || !reachesExit[idx]) {
      return `floor recovery: re-mount platform (col ${rm.col}, row ${rm.row}, len ${rm.len}) cannot reach the exit by climbing`
    }
  }

  // (iii) Hazard-free walk lane — no HAZARD on row floorRow-1 (the contiguous floor the player walks/recovers on).
  const laneRow = floorRow - 1
  for (let col = 0; col < desc.cols; col++) {
    if (desc.tiles[laneRow][col] === TILE.HAZARD) return `floor recovery: HAZARD on the floor walk lane at (col ${col}, row ${laneRow})`
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

// ── checkClearance(desc) (body-aware-clearance design, AC1/AC2) ── prove the REAL 36×52 collision body (not a
// point mass) (a) is body-clear at every node it stands on, and (b) can travel entrance→exit. Re-derived from the
// EMITTED tiles (independent of the generator). Two parts:
//   (a) bodyStandClear at entrance / exit / branch treasure / every enemy + pickup spawn cell.
//   (b) a body-aware flood-fill over WINDOW nodes W=(lc,r): columns {lc … lc+CLEAR_COLS-1}, feet row r (the body
//       occupies rows {r-CLEAR_ROWS+1 … r}, supported by row r+1). A REACH edge P→Q exists iff canReachStep(dx,dy)
//       — the SAME envelope the generator placed with, base-jump-only so it is CONSERVATIVE vs the player's
//       double-jump + wall-jump (which only ADD reach), making a PASS sound — AND the full SWEPT-AIRSPACE bounding
//       box is SOLID-free, so the real (arcing, overshooting) trajectory can never clip a ceiling over the gap.
// Returns null on pass or a reason string. (Only runs for normal levels — the boss arena goes through checkBossArena.)
function checkClearance(desc) {
  const { tiles, cols, rows } = desc

  // (a) Node clearance (AC2) — every cell the body stands on must fit the 36×52 footprint.
  const badNode = (cell, what) =>
    cell && !bodyStandClear(tiles, cols, rows, cell.col, cell.row)
      ? `${what} (${cell.col},${cell.row}) not body-clear (36×52 wedge)`
      : null
  const nodeChecks = [badNode(desc.entrance, 'entrance'), badNode(desc.exit, 'exit'), badNode(desc.branchTreasure, 'branch treasure')]
  for (const e of desc.enemies) nodeChecks.push(badNode(e, 'enemy spawn'))
  for (const p of desc.pickups) nodeChecks.push(badNode(p, 'pickup spawn'))
  for (const c of nodeChecks) if (c) return c

  // (b) Body-aware traversal — window-node flood-fill (design §6.4).
  const APEX_ROWS = Math.ceil(APEX_H / TILE_SIZE) // = 5 — a full base jump apexes this many rows above launch.
  const isSupport = (t) => t === TILE.SOLID || t === TILE.ONEWAY
  const grounded = (lc, r) =>
    bodyFits(tiles, cols, rows, lc, r) && (isSupport(tiles[r + 1][lc]) || isSupport(tiles[r + 1][lc + 1]))

  // Enumerate grounded windows into a compact node list (index unused — small N, all-pairs with a canReachStep prefilter).
  const nodes = [] // { lc, r }
  for (let r = 1; r < rows - 1; r++) {
    for (let lc = 0; lc + CLEAR_COLS - 1 < cols; lc++) {
      if (grounded(lc, r)) nodes.push({ lc, r })
    }
  }

  // near-edge column gap between two CLEAR_COLS-wide footprints (the platformStep near-edge metric — BLOCKER #2).
  const nearGap = (P, Q) => {
    const pR = P.lc + CLEAR_COLS - 1, qR = Q.lc + CLEAR_COLS - 1
    if (Q.lc > pR) return Q.lc - pR // Q to the right.
    if (qR < P.lc) return P.lc - qR // Q to the left.
    return 0 // footprints overlap in columns.
  }
  // an UP / LEVEL jump's swept airspace must be SOLID-free so the real (arcing, overshooting) trajectory can't
  // clip a ceiling over the gap (the reviewer's gap-1). DOWN jumps need no such check: the body simply falls
  // (always reaches, never rises above its launch) — exactly the existing point-mass BFS's treatment, so a SOLID
  // in the way just means the body lands on it (an intermediate node the BFS routes through). The body sweeps an
  // L-shape, NOT a rectangle: it rises in the LOWER (launch) column, and over the gap it flies ABOVE the HIGHER
  // (landing) platform — it lands ON TOP from the side, never through it. So below the landing row we check only
  // the launch column (the rise); above it, the whole gap span (the flight). Both endpoint footprints are
  // separately bodyFits-checked, so excluding the region under the landing avoids false rejection.
  const airspaceClear = (P, Q) => {
    const dx = nearGap(P, Q)
    const dy = Q.r - P.r
    if (dy > 0) return true // DOWN jump/fall — falls always reach (matches the point-mass BFS; no apex to clip).
    // ADJACENT WALK / STEP / BRIDGE (|dy| ≤ 1 and the body bridges a ≤1-tile gap): the move is between two
    // overlapping/adjacent footprints that are ALREADY grounded (bodyFits), so the body never sweeps a wider
    // region — no box needed. A 1-tile slot never qualifies (no grounded window), so this can't bridge a wedge.
    if (dx <= 1 && Math.abs(dy) <= 1) return true
    const lower = P.r >= Q.r ? P : Q // larger row = the LOWER (launch) platform (carries the vertical rise column).
    const rLo = lower.r // launch feet row (bottom of the swept region).
    const rHi = Math.min(P.r, Q.r) // landing (higher) feet row — the flight band sits above this.
    const loC0 = lower.lc, loC1 = lower.lc + CLEAR_COLS - 1
    const cLo = Math.min(P.lc, Q.lc)
    const cHi = Math.max(P.lc, Q.lc) + (CLEAR_COLS - 1)
    let rTop = rHi - APEX_ROWS - (CLEAR_ROWS - 1) // apex overshoot above the landing (conservative full-arc apex).
    if (rTop < 0) rTop = 0
    for (let r = rTop; r <= rLo; r++) {
      for (let c = cLo; c <= cHi; c++) {
        // Below the landing (r > rHi), only the LOWER (launch) column is swept — its rise; every other column
        // there is under the landing, which the body never enters from the side, so skip (no false reject).
        if (r > rHi && (c < loC0 || c > loC1)) continue
        if (tiles[r][c] === TILE.SOLID) return false
      }
    }
    return true
  }

  // Seed from every grounded window standing on the entrance's platform; PASS when one over the exit platform is reached.
  const plats = desc.platforms.filter((p) => p.type === TILE.SOLID || p.type === TILE.ONEWAY)
  const platUnder = (cell) => plats.find((p) => p.row === cell.row + 1 && cell.col >= p.col && cell.col < p.col + p.len)
  const startPlat = platUnder(desc.entrance)
  const goalPlat = platUnder(desc.exit)
  if (!startPlat) return 'clearance: entrance has no supporting platform'
  if (!goalPlat) return 'clearance: exit has no supporting platform'
  const onPlat = (nd, p) => nd.r === p.row - 1 && nd.lc + CLEAR_COLS - 1 >= p.col && nd.lc <= p.col + p.len - 1

  const seen = new Uint8Array(nodes.length)
  const queue = []
  for (let i = 0; i < nodes.length; i++) if (onPlat(nodes[i], startPlat)) { seen[i] = 1; queue.push(i) }
  if (queue.length === 0) return 'clearance: no body-clear footing on the entrance platform'
  while (queue.length) {
    const P = nodes[queue.shift()]
    if (onPlat(P, goalPlat)) return null // reached a body-clear footing on the exit platform.
    for (let v = 0; v < nodes.length; v++) {
      if (seen[v]) continue
      const Q = nodes[v]
      if (!canReachStep(nearGap(P, Q), Q.r - P.r)) continue // cheap reach prefilter.
      if (!airspaceClear(P, Q)) continue
      seen[v] = 1
      queue.push(v)
    }
  }
  return 'clearance: exit platform not body-reachable from entrance (36×52 body would wedge)'
}

// ── 3a) Determinism (AC19): generateLevel twice → DEEP-EQUAL (element-wise over the int grid). ──
// ── 3c/3d/3e) Per-seed bounds + spawn-validity + traversability over N seeds, for EVERY biome. ──
// §6.4 extends the sweep to the WHOLE BIOME_ORDER (not just PRISON) so AC28 (bounds / no-wall-spawn /
// traversable) holds for every biome the run can walk, not only the opener. F4 branching-biome-map (Decision
// 10.4) switches the sweep to Object.values(BIOMES) — EVERY GRAPH NODE incl. the new OSSUARY (which is NOT on
// the default path / not in BIOME_ORDER) — so an off-the-default-path biome is still bounds/spawn/traversable/
// clearance-checked like the rest. (generateLevel only emits the boss ARENA when handed a {…biome, bossArena:true}
// config — a per-call GameScene flag, NOT endsInBoss — so the plain biome config here always generates a NORMAL
// room; the boss arena keeps its OWN sweep via checkBossArena in §6, unchanged.)
const N = 200
for (const biome of Object.values(BIOMES)) {
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
  // Regenerated for body-aware-clearance: the spawn pool is now filtered by bodyStandClear, which excludes the
  // staircase pin's two 1-tile standable SLOTS — (col 1, row 16) between the left wall and a platform, and
  // (col 17, row 16) between two same-row platforms — where the 36×52 body cannot stand. Removing them shifts
  // the pickup pick from (col 20) to (col 19). The TILES are byte-unchanged (PIN_TILES holds); only the pickup
  // spawn moved to a body-clear cell — a deliberate, correct consequence of the filter (design Decision 5, §7b).
  pickups: [{ col: 19, row: 15, x: 624, y: 496, kind: 'cell' }],
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

// ── 4a') Boss-Cell tier curve: IDENTITY-at-tier-0 + per-tier monotonicity + non-weakening (meta-progression
// §6.10, AC2/AC3) ── (i) the IDENTITY pin (the load-bearing "tier 0 = round 1" proof for the curve):
// scaleAtDepth(d, 1) deep-equals scaleAtDepth(d) at every depth (the explicit-mult-1 call returns the BYTE-
// IDENTICAL scalars to the default call). (ii) for EVERY tier in BOSS_CELL_TIERS, each tiered scalar is
// non-decreasing IN DEPTH AND is >= the tier-0 scalar at the same depth (a higher tier never weakens the
// curve — a global LIFT). enemyCountBonus uses floor so a tiny mult could equal tier-0 at low depth — the
// check is `>=`, which holds (a tier ADDS or holds, never subtracts). ──
{
  for (let depth = 0; depth <= MAXD; depth++) {
    // (i) IDENTITY: the explicit-mult-1 call === the default call (the tier-0 curve is the round-1 curve).
    if (!deepEqual(scaleAtDepth(depth, 1), scaleAtDepth(depth))) {
      fail(`tier curve identity: scaleAtDepth(${depth}, 1) !== scaleAtDepth(${depth}) (tier 0 must be byte-identical)`)
    }
  }
  for (const tier of BOSS_CELL_TIERS) {
    let prevTiered = scaleAtDepth(0, tier.bossCellMult)
    for (let depth = 0; depth <= MAXD; depth++) {
      const s = scaleAtDepth(depth, tier.bossCellMult)
      const base = scaleAtDepth(depth) // the tier-0 scalar at the same depth (the non-weakening comparand).
      // (ii) non-decreasing IN DEPTH (each scalar).
      if (s.enemyHpMult < prevTiered.enemyHpMult) fail(`tier ${tier.index} curve: enemyHpMult dipped at depth ${depth}`)
      if (s.enemyDamageMult < prevTiered.enemyDamageMult) fail(`tier ${tier.index} curve: enemyDamageMult dipped at depth ${depth}`)
      if (s.enemySpeedMult < prevTiered.enemySpeedMult) fail(`tier ${tier.index} curve: enemySpeedMult dipped at depth ${depth}`)
      if (s.enemyCountBonus < prevTiered.enemyCountBonus) fail(`tier ${tier.index} curve: enemyCountBonus dipped at depth ${depth}`)
      // (ii) NON-WEAKENING vs tier 0 (a higher tier never makes the game easier at any depth).
      if (s.enemyHpMult < base.enemyHpMult) fail(`tier ${tier.index} curve: enemyHpMult below tier-0 at depth ${depth} (${s.enemyHpMult} < ${base.enemyHpMult})`)
      if (s.enemyDamageMult < base.enemyDamageMult) fail(`tier ${tier.index} curve: enemyDamageMult below tier-0 at depth ${depth}`)
      if (s.enemySpeedMult < base.enemySpeedMult) fail(`tier ${tier.index} curve: enemySpeedMult below tier-0 at depth ${depth}`)
      if (s.enemyCountBonus < base.enemyCountBonus) fail(`tier ${tier.index} curve: enemyCountBonus below tier-0 at depth ${depth}`)
      prevTiered = s
    }
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

// ── 4b') Graph well-formedness (F4 branching-biome-map, Decision 10.1 — new KISS guardrail mirroring §6b) ──
// The BRANCHING biome graph (BIOMES + exits) must be sound: all edges resolve, exactly one boss terminal with
// empty exits, every non-boss node has ≥1 exit (no dead end), ≥1 node has ≥2 exits (a real choice exists —
// AC1/AC4), the graph is ACYCLIC, every node is REACHABLE from START_BIOME_ID, and BIOME_ORDER is a valid
// root→boss path (so the default-path walks below are real paths). An INDEPENDENT proof: re-derived from the
// real config, so a dangling edge / mis-tiered sibling / unreachable biome fails LOUDLY here, not at runtime.
{
  const allIds = Object.keys(BIOMES)
  // (i) every exits array resolves to a known biome (no dangling edge).
  for (const b of Object.values(BIOMES)) {
    if (!Array.isArray(b.exits)) fail(`graph: biome ${b.id} has no exits array`)
    for (const eid of b.exits) {
      if (!BIOMES[eid]) fail(`graph: biome ${b.id} exits to unknown biome "${eid}" (dangling edge)`)
    }
  }
  // (ii) exactly ONE boss terminal, with EMPTY exits; every non-boss node has ≥1 exit (no dead end before boss).
  const terminals = Object.values(BIOMES).filter((b) => b.endsInBoss === true)
  if (terminals.length !== 1) fail(`graph: expected exactly 1 boss terminal (endsInBoss), found ${terminals.length}`)
  if (terminals[0].exits.length !== 0) fail(`graph: the boss terminal ${terminals[0].id} must have empty exits (got ${terminals[0].exits.length})`)
  for (const b of Object.values(BIOMES)) {
    if (!b.endsInBoss && b.exits.length < 1) fail(`graph: non-boss biome ${b.id} has no exit (a dead end before the boss)`)
  }
  // (iii) at least one node offers a REAL choice (≥2 exits) — the 2-way-choice AC (AC1/AC4) would be dead otherwise.
  if (!Object.values(BIOMES).some((b) => b.exits.length >= 2)) fail('graph: no biome has ≥2 exits (no real 2-way choice exists, AC1/AC4)')
  // (iv) ACYCLIC + every node REACHABLE from START_BIOME_ID (DFS; a back-edge to a node on the current stack = a cycle).
  if (!BIOMES[START_BIOME_ID]) fail(`graph: START_BIOME_ID "${START_BIOME_ID}" is not a known biome`)
  const visited = new Set()
  const onStack = new Set()
  const dfs = (id) => {
    if (onStack.has(id)) fail(`graph: cycle detected — back-edge revisits "${id}" on the current path (must be a DAG)`)
    if (visited.has(id)) return
    visited.add(id)
    onStack.add(id)
    for (const eid of BIOMES[id].exits) dfs(eid)
    onStack.delete(id)
  }
  dfs(START_BIOME_ID)
  for (const id of allIds) {
    if (!visited.has(id)) fail(`graph: biome "${id}" is not reachable from START_BIOME_ID "${START_BIOME_ID}"`)
  }
  // (v) BIOME_ORDER is a valid root→boss path through the graph (each consecutive pair an exit; root start; boss end).
  if (BIOME_ORDER[0].id !== START_BIOME_ID) fail(`graph: BIOME_ORDER must start at START_BIOME_ID (${START_BIOME_ID}), got ${BIOME_ORDER[0].id}`)
  if (!BIOME_ORDER[BIOME_ORDER.length - 1].endsInBoss) fail('graph: BIOME_ORDER must end on the boss biome')
  for (let i = 1; i < BIOME_ORDER.length; i++) {
    if (!BIOME_ORDER[i - 1].exits.includes(BIOME_ORDER[i].id)) {
      fail(`graph: BIOME_ORDER is not a valid path — ${BIOME_ORDER[i].id} ∉ ${BIOME_ORDER[i - 1].id}.exits`)
    }
  }
}

// ── enumeratePaths() (F4 Decision 10.2) ── every SIMPLE path from START_BIOME_ID to the boss terminal (the DAG
// is tiny — full enumeration is cheap). Returns a list of id-arrays, each a complete root→boss route. The
// acyclicity proven above guarantees this terminates. Used by the per-path monotonicity walks below.
function enumeratePaths() {
  const out = []
  const walk = (id, acc) => {
    const node = BIOMES[id]
    const next = [...acc, id]
    if (node.endsInBoss === true || node.exits.length === 0) {
      out.push(next)
      return
    }
    for (const eid of node.exits) walk(eid, next)
  }
  walk(START_BIOME_ID, [])
  return out
}

// ── walkPath(seed, path, bossCellMult) (F4 Decision 10.2/§7.5 — drive the REAL advance() chain down a chosen
// path) ── construct a FRESH createRunState(seed) and step it via the EXACT advance() the game runs, setting
// rs.pendingBiomeId = path[i+1] BEFORE each boundary advance() (exactly as GameScene's picker does). This is an
// INDEPENDENT proof (not self-certification, Decision 36): the verifier walks the real method surface for THIS
// path, so a broken advance()/exits-guard/levels re-tune fails loudly. Calls back per step so the caller asserts
// monotonicity. Returns the final RunState (for end-of-path assertions: boss-termination, run length, depth).
function walkPath(seed, path, bossCellMult, onStep) {
  const rs = createRunState(seed)
  // sanity: a walk must START on the path's root (the run always seeds to START_BIOME_ID).
  if (rs.biomeId !== path[0]) fail(`path walk: run starts on ${rs.biomeId}, path starts on ${path[0]}`)
  let pathIdx = 0
  let steps = 0
  const maxSteps = path.reduce((sum, id) => sum + BIOMES[id].levels, 0) + 5
  while (!rs.isRunComplete()) {
    // If the UPCOMING advance() will roll the biome (a boundary), commit the path's NEXT id to pendingBiomeId so
    // advance() rolls down THIS path (the same seam GameScene uses) — never relying on the default-exit fallback.
    const willRoll = rs.levelInBiome + 1 >= rs.biome().levels && !rs.isLastBiome()
    if (willRoll) {
      const nextId = path[pathIdx + 1]
      if (!nextId) fail(`path walk: boundary at ${rs.biomeId} but the path has no next id (path ${path.join('→')})`)
      rs.pendingBiomeId = nextId
    }
    rs.advance()
    if (willRoll) {
      pathIdx++
      // advance() must have rolled to EXACTLY the path's next id (the pendingBiomeId drive worked + the exits guard
      // did not silently fall back to the default — the proof that the choice is honoured).
      if (rs.biomeId !== path[pathIdx]) fail(`path walk: expected biome ${path[pathIdx]}, advance() rolled to ${rs.biomeId} (path ${path.join('→')})`)
    }
    steps++
    if (onStep) onStep(rs)
    if (steps > maxSteps) fail(`path walk did not terminate for path ${path.join('→')} (isRunComplete never true)`)
  }
  // The visited path RunState must match the requested path EXACTLY (the route readout proof).
  if (rs.path.join('→') !== path.join('→')) fail(`path walk: rs.path "${rs.path.join('→')}" != requested "${path.join('→')}"`)
  return rs
}

// ── 4c) EVERY-PATH whole-run monotonicity + boss-termination (F4 Decision 10.2 — the STRENGTHENED §4c; was a
// single linear walk) ── for EVERY simple root→boss path, drive the REAL advance() chain (walkPath) and assert
// effectiveDifficulty(depth, biome) is non-decreasing across the WHOLE path AND the path ENDS on the boss biome
// (isLastBiome() true, isRunComplete() fired). Plus a redundant-but-cheap direct difficultyTier-non-decreasing
// check per path (catches a mis-tiered sibling loudly). Plus per-path run length === sum of per-biome levels and
// depth at completion === that sum − 1. The load-bearing "visibly rising difficulty on EVERY route" proof. ──
const RUN_SEED = 0xc0ffee
const totalLevels = BIOME_ORDER.reduce((sum, b) => sum + b.levels, 0) // the DEFAULT-path length (the additive-identity pin).
const ALL_PATHS = enumeratePaths()
{
  if (ALL_PATHS.length < 2) fail(`expected ≥2 distinct root→boss paths (a real 2-way choice), found ${ALL_PATHS.length} (AC1/AC4)`)
  for (const path of ALL_PATHS) {
    // (i) difficultyTier non-decreasing along the path (the cheap direct check — a mis-tiered sibling fails loudly).
    for (let i = 1; i < path.length; i++) {
      if (BIOMES[path[i]].difficultyTier < BIOMES[path[i - 1]].difficultyTier) {
        fail(`path ${path.join('→')}: difficultyTier dipped at ${path[i]} (${BIOMES[path[i]].difficultyTier} < prior)`)
      }
    }
    // (ii) effectiveDifficulty non-decreasing across the WHOLE path (the real advance() walk).
    const rs0 = createRunState(RUN_SEED)
    let prevEff = effectiveDifficulty(rs0.depth, rs0.biome())
    const finalRs = walkPath(RUN_SEED, path, 1, (rs) => {
      const eff = effectiveDifficulty(rs.depth, rs.biome())
      if (eff < prevEff) fail(`path ${path.join('→')}: whole-run difficulty dipped at depth ${rs.depth} (${rs.biome().id}): ${eff} < ${prevEff}`)
      prevEff = eff
    })
    // (iii) boss-termination: the path ENDS on the boss biome (the unique terminal), and run length matches.
    if (!finalRs.isLastBiome()) fail(`path ${path.join('→')}: completed but not on the boss biome`)
    const pathLevels = path.reduce((sum, id) => sum + BIOMES[id].levels, 0)
    if (finalRs.depth !== pathLevels - 1) fail(`path ${path.join('→')}: depth ${finalRs.depth} at completion, expected ${pathLevels - 1}`)
  }
}

// ── 4c') EVERY-PATH × EVERY-TIER whole-run monotonicity + non-weakening (F4 Decision 10.3 — extends the per-tier
// §4c') ── for EACH tier in BOSS_CELL_TIERS and EACH simple path, drive the REAL advance() chain (walkPath) and
// assert effectiveDifficulty(depth, biome, tier.bossCellMult) is non-decreasing across the WHOLE path AND is >=
// the tier-0 value at every step (the tier is a global LIFT, never an easing). By construction (bossCellMult
// constant ≥1, the curve non-decreasing in depth, the biome tier non-decreasing along EVERY path — proven above)
// this is a PROOF, not a filter. The default-path tier-0 case is byte-identical to the pre-F4 §4c'/§4c walk.
{
  for (const tier of BOSS_CELL_TIERS) {
    for (const path of ALL_PATHS) {
      let prevEff = effectiveDifficulty(0, BIOMES[path[0]], tier.bossCellMult)
      walkPath(RUN_SEED, path, tier.bossCellMult, (rs) => {
        const eff = effectiveDifficulty(rs.depth, rs.biome(), tier.bossCellMult)
        if (eff < prevEff) fail(`tier ${tier.index} path ${path.join('→')}: difficulty dipped at depth ${rs.depth} (${rs.biome().id}): ${eff} < ${prevEff}`)
        const eff0 = effectiveDifficulty(rs.depth, rs.biome())
        if (eff < eff0) fail(`tier ${tier.index} path ${path.join('→')}: effectiveDifficulty below tier-0 at depth ${rs.depth} (${eff} < ${eff0})`)
        prevEff = eff
      })
    }
  }
}

// ── 4d) Seed-chain + biome-sequence determinism (AC47; F4 §7.5) ── two fresh RunStates from the SAME start seed,
// fed the SAME pending choices, advance in LOCKSTEP to the SAME (biomeId, path, levelInBiome, depth, seed)
// sequence — the run replays. F4 renames the old `biomeIndex` compare to `biomeId` (the index field is DELETED)
// and ADDS a `path` lockstep + a `pendingBiomeId` set on BOTH states identically before each boundary advance(),
// so the determinism proof covers the graph-model fields, not a now-undefined index (which would pass vacuously).
// Walks the DEFAULT path (pendingBiomeId left null → exits[0]) here; the per-path × per-tier walks above already
// prove every CHOSEN path replays (walkPath drives the same advance() chain deterministically per path).
{
  const a = createRunState(RUN_SEED)
  const b = createRunState(RUN_SEED)
  for (let step = 0; step < totalLevels; step++) {
    if (a.seed !== b.seed) fail(`seed chain diverged at step ${step}: ${a.seed} !== ${b.seed}`)
    if (a.biomeId !== b.biomeId) fail(`biomeId diverged at step ${step}: ${a.biomeId} !== ${b.biomeId}`)
    if (a.path.join('→') !== b.path.join('→')) fail(`path diverged at step ${step}: ${a.path.join('→')} !== ${b.path.join('→')}`)
    if (a.levelInBiome !== b.levelInBiome) fail(`levelInBiome diverged at step ${step}`)
    if (a.depth !== b.depth) fail(`depth diverged at step ${step}`)
    // Set the SAME pending choice on both (null = auto-pick the default exit) — the lockstep is over identical input.
    a.pendingBiomeId = null
    b.pendingBiomeId = null
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
    // ── ROUND-3 (item 3) — the second-weapon-slot field is bigger-is-better (more slots never weakens you).
    // A max-level fold must leave weaponSlots ≥ base on every upgrade (rows that don't touch it leave it at
    // base = identity, which still satisfies ≥). This makes the new qualitative tier verifier-proven non-weakening.
    if (maxed.weaponSlots < BASE_PLAYER_STATS.weaponSlots) fail(`upgrade ${upg.id}: weaponSlots decreased`)
  }
  // The 'weaponSlot' upgrade at max level must actually UNLOCK the second slot (≥2) — it'd be dead config
  // (the whole point of item 3) if it folded to 1. Asserted explicitly so a mis-tuned apply fails loudly.
  {
    const maxed = applyUpgrades(BASE_PLAYER_STATS, { weaponSlot: UPGRADES_BY_ID.weaponSlot.maxLevel })
    if (!(maxed.weaponSlots >= 2)) fail(`weaponSlot upgrade: max-level fold must yield weaponSlots ≥ 2 (it unlocks the 2nd slot)`)
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
    // ── per-weapon-movesets §6.7 (Decision 9, AC2) — validate the OPTIONAL `moveset` WHEN PRESENT. Every check
    // above is preserved VERBATIM; this is an ADDITIVE pass so a weapon with NO moveset (the headless/default
    // case) is unaffected (identity). A malformed mode fails LOUDLY: a charge needs chargeTime>0 + damageMult>=1
    // (an aoeRadius, when present, >=0); a flurry needs hits>=2 + interval>0; pierce needs maxTargets>=2; and the
    // mode must match the type (flurry/finisher/aoeRadius only on melee; pierce only on ranged). ──
    if (w.moveset) {
      const m = w.moveset
      if (m.charge) {
        if (!(m.charge.chargeTime > 0)) fail(`weapon ${w.id}: charge.chargeTime must be > 0`)
        if (!(m.charge.damageMult >= 1)) fail(`weapon ${w.id}: charge.damageMult must be >= 1`)
        if (m.charge.aoeRadius !== undefined && !(m.charge.aoeRadius >= 0)) fail(`weapon ${w.id}: charge.aoeRadius must be >= 0`)
        if (m.charge.chargeStunDuration !== undefined && !(m.charge.chargeStunDuration >= 0)) fail(`weapon ${w.id}: charge.chargeStunDuration must be >= 0`)
        // A MELEE-only smash (aoeRadius / chargeStunDuration) must not ride a ranged weapon (a malformed pairing).
        if (w.type !== 'melee' && (m.charge.aoeRadius !== undefined || m.charge.chargeStunDuration !== undefined)) {
          fail(`weapon ${w.id}: charge.aoeRadius/chargeStunDuration (a melee smash) only on a melee weapon`)
        }
      }
      if (m.flurry) {
        if (w.type !== 'melee') fail(`weapon ${w.id}: flurry only on a melee weapon`)
        if (!(m.flurry.hits >= 2)) fail(`weapon ${w.id}: flurry.hits must be >= 2`)
        if (!(m.flurry.interval > 0)) fail(`weapon ${w.id}: flurry.interval must be > 0`)
      }
      if (m.pierce) {
        if (w.type !== 'ranged') fail(`weapon ${w.id}: pierce only on a ranged weapon`)
        if (!(m.pierce.maxTargets >= 2)) fail(`weapon ${w.id}: pierce.maxTargets must be >= 2`)
      }
      if (m.finisher && w.type !== 'melee') fail(`weapon ${w.id}: finisher only on a melee weapon`)
    }
    // ── color-scaling-stats §6.2 (Decision 5/10, AC2) — every weapon carries a KNOWN scaling colour (a weapon
    // with no/unknown colour fails loudly). AND foldWeaponAffix PRESERVES the tag (it rides the `...weapon`
    // spread — a pattern tag, never scaled by an affix; a Keen sword is still a Brutality sword). ──
    if (!COLOR_IDS.includes(w.scaling)) fail(`weapon ${w.id}: scaling "${w.scaling}" not a known colour (${COLOR_IDS.join('/')})`)
    if (foldWeaponAffix(w, WEAPON_KEEN).scaling !== w.scaling) fail(`weapon ${w.id}: foldWeaponAffix did not preserve scaling`)
  }
  // Optional (Decision 5/10): every colour is USED by ≥1 weapon OR skill — no dead colour config. Brutality:
  // sword/hammer/glaive/firebomb; tactics: bow + 5 skills; survival: spear. Assert the colour space is live.
  const usedColors = new Set([...WEAPON_ORDER.map((w) => w.scaling), ...SKILLS.map((s) => s.scaling)])
  for (const c of COLOR_IDS) if (!usedColors.has(c)) fail(`colour "${c}" is not used by any weapon/skill (dead colour config)`)
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
  const ATTACK_KINDS = ['swing', 'shoot', 'dash', 'swoop'] // the EnemyAttackKind vocabulary (enemy-ai-telegraphs §6.1).
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
    // ── attacks[] well-formed (enemy-ai-telegraphs §6.6, AC6) ── the per-archetype attack table is a
    // NON-EMPTY array; each entry is a known kind with a POSITIVE telegraph (the dodge window), NON-NEGATIVE
    // active/recovery, a POSITIVE weight (the chooser), and the per-kind params present + numeric so
    // scaleSpec can fold them. A 'swing' attack MUST carry swing.damage; a 'shoot' attack MUST carry
    // projectile.damage (parity with the §6a ranged check). The verifier is an INDEPENDENT proof of the data
    // contract — the same role it plays for the boss attack tables.
    if (!Array.isArray(spec.attacks) || spec.attacks.length === 0) fail(`archetype ${spec.id}: empty attacks[] (AC3)`)
    for (const a of spec.attacks) {
      if (!ATTACK_KINDS.includes(a.kind)) fail(`archetype ${spec.id}: unknown attack kind ${a.kind}`)
      if (!(a.telegraph > 0)) fail(`archetype ${spec.id}: attack ${a.kind} telegraph must be > 0 (the dodge window)`)
      if (!(a.active >= 0) || !(a.recovery >= 0)) fail(`archetype ${spec.id}: attack ${a.kind} active/recovery must be ≥ 0`)
      if (!(a.weight > 0)) fail(`archetype ${spec.id}: attack ${a.kind} weight must be > 0 (the chooser)`)
      if (a.kind === 'swing' && (!a.swing || typeof a.swing.damage !== 'number')) {
        fail(`archetype ${spec.id}: 'swing' attack missing swing.damage`)
      }
      if (a.kind === 'shoot' && (!a.projectile || typeof a.projectile.damage !== 'number')) {
        fail(`archetype ${spec.id}: 'shoot' attack missing projectile.damage`)
      }
    }
    // scaleSpec rises with depth on THIS archetype (the scaling is real per-archetype).
    const s0 = scaleSpec(spec, scaleAtDepth(0)).maxHp
    const s10 = scaleSpec(spec, scaleAtDepth(10)).maxHp
    if (!(s10 > s0)) fail(`archetype ${spec.id}: scaled maxHp did not rise with depth (${s10} ≤ ${s0})`)
    // scaleSpec folds each attack's damage too (enemy-ai-telegraphs §6.7, AC6): a depth-scaled attack's
    // swing.damage / projectile.damage is ≥ the base (a re-tune that makes a deeper attack WEAKER fails
    // loudly — mirrors the boss-fold guardrail). Telegraph/timings stay unscaled (the dodge contract holds).
    const scaled = scaleSpec(spec, scaleAtDepth(10))
    for (let i = 0; i < spec.attacks.length; i++) {
      const base = spec.attacks[i]
      const sc = scaled.attacks[i]
      if (base.swing && !(sc.swing.damage >= base.swing.damage)) {
        fail(`archetype ${spec.id}: scaled attack[${i}] swing.damage dipped (${sc.swing.damage} < ${base.swing.damage})`)
      }
      if (base.projectile && !(sc.projectile.damage >= base.projectile.damage)) {
        fail(`archetype ${spec.id}: scaled attack[${i}] projectile.damage dipped (${sc.projectile.damage} < ${base.projectile.damage})`)
      }
    }
    // scaleSpec must NOT mutate the base attacks[] (the aliasing discipline — Decision 45).
    if (spec.attacks[0].swing && spec.attacks[0] === scaled.attacks[0]) {
      fail(`archetype ${spec.id}: scaleSpec aliased attacks[0] (must deep-clone, Decision 45)`)
    }
  }
}

// ── 6b) Per-biome enemyPool well-formed (AC59): every biome has a non-empty enemyPool referencing only
// KNOWN archetype ids with positive weights. The single source the SCENE picks archetypes from. ──
{
  // F4 (Decision 10.4) — iterate EVERY graph node (Object.values(BIOMES)), not just BIOME_ORDER, so OSSUARY's
  // pool/miniboss are well-formedness-checked like the rest (an off-the-default-path biome must still be valid).
  for (const biome of Object.values(BIOMES)) {
    if (!Array.isArray(biome.enemyPool) || biome.enemyPool.length === 0) {
      fail(`biome ${biome.id}: enemyPool is empty (AC59)`)
    }
    for (const entry of biome.enemyPool) {
      if (!ENEMY_SPECS[entry.id]) fail(`biome ${biome.id}: enemyPool references unknown archetype "${entry.id}" (AC59)`)
      if (!(typeof entry.w === 'number') || entry.w <= 0) fail(`biome ${biome.id}: enemyPool weight for "${entry.id}" must be > 0`)
    }
  }
  // EXACTLY one biome ends in a boss (the graph's unique terminal), and it carries a `boss` id keyed into a known
  // boss. F4 (Decision 1) — the boss biome is also the BIOME_ORDER tail AND the unique empty-exits terminal (the
  // graph well-formedness sweep below proves exits.length === 0 + reachability); here we check the boss id resolves.
  const bossBiomes = Object.values(BIOMES).filter((b) => b.endsInBoss === true)
  if (bossBiomes.length !== 1) fail(`expected exactly 1 boss biome (endsInBoss), found ${bossBiomes.length} (AC57)`)
  if (bossBiomes[0] !== BIOME_ORDER[BIOME_ORDER.length - 1]) fail('the boss biome must be the LAST in BIOME_ORDER (the default path ends on it, AC57)')
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
  for (const biome of Object.values(BIOMES)) {
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
  // Round-3 (item 5): the kit grew 4 → 5 with the NEW 'summon' kind (spawn enemy adds — a signature
  // "summoner" mechanic). Assert the kind set includes it AND some boss USES it (not dead config), so a
  // boss has a genuinely distinct mechanic, not just a 4th projectile/melee reskin.
  if (!BOSS_ATTACK_KINDS.includes('summon')) fail(`BOSS_ATTACK_KINDS missing the round-3 'summon' kind`)
  const summonUsed = BOSS_ORDER.some((b) => b.phases.some((ph) => ph.attacks.includes('summon')))
  if (!summonUsed) fail(`no boss uses the new 'summon' attack kind in any phase pattern (dead config)`)
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
        // Round-3 (item 5) — a 'summon' attack's params are well-formed: a positive add `count`, a positive
        // `maxAdds` live cap (≥ count so a single cast isn't pre-capped to nothing), and a `spec` that
        // resolves to a KNOWN archetype (a dangling id would spawn nothing — a content bug, fails loudly).
        if (kind === 'summon') {
          if (!(atk.count > 0)) fail(`boss ${boss.id}: summon count must be > 0`)
          if (!(atk.maxAdds > 0)) fail(`boss ${boss.id}: summon maxAdds must be > 0 (the live-add cap)`)
          if (atk.maxAdds < atk.count) fail(`boss ${boss.id}: summon maxAdds (${atk.maxAdds}) < count (${atk.count}) — a cast is pre-capped to nothing`)
          if (!ENEMY_SPECS[atk.spec]) fail(`boss ${boss.id}: summon spec "${atk.spec}" is not a known archetype (AC59)`)
        }
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
    // item-rarity-forge §6 (Decision 8) — a 'forge' row needs a known forgeAction ('reroll' | 'upgrade').
    if (it.kind === 'forge' && it.forgeAction !== 'reroll' && it.forgeAction !== 'upgrade') {
      fail(`shop item ${it.id}: 'forge' needs forgeAction 'reroll' or 'upgrade' (got "${it.forgeAction}")`)
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 8) Combat status effects (§6.13, Decision 79, AC66). An INDEPENDENT proof of the PURE status tick
//    math (bleed/poison/stun) + the weapon status tags. A successful import re-proves status.js is
//    Phaser-free; the asserts pin the DoT accumulation, the stun flag, expiry, and refresh-on-re-hit.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── 8·0) STATUS_KINDS PIN (affliction-synergy AC1/AC2 — the DELIBERATE pin update) ── the kind set is now
  // EXACTLY 4 (bleed/poison/stun/burn). Pinned to a literal 4 (not "whatever the array is") so dropping/adding
  // a kind fails loudly — a deliberate count, the slice constraint's "extend the pins deliberately". The
  // burn-includes assert makes dropping burn (regressing the Searing affix / the 4th colour) fail loudly too.
  if (STATUS_KINDS.length !== 4) fail(`STATUS_KINDS must be exactly 4 kinds (bleed/poison/stun/burn), got ${STATUS_KINDS.length} (AC1)`)
  if (!STATUS_KINDS.includes('burn')) fail(`STATUS_KINDS must include 'burn' (affliction-synergy AC1 — the 4th damaging kind)`)

  // ── 8a) Weapon status tags reference only KNOWN kinds, with sane params (a damaging status needs a
  // positive tickInterval + tickDmg; a stun is non-damaging). burn is a damaging DoT (affliction-synergy),
  // so the damaging check now includes it. A malformed tag fails loudly. ──
  for (const w of Object.values(WEAPONS)) {
    if (!w.status) continue // a weapon with no status (sword) is fine — the identity.
    if (!STATUS_KINDS.includes(w.status.kind)) fail(`weapon ${w.id}: unknown status kind "${w.status.kind}" (AC66)`)
    if (!(w.status.duration > 0)) fail(`weapon ${w.id}: status duration must be > 0`)
    const damaging = w.status.kind === 'bleed' || w.status.kind === 'poison' || w.status.kind === 'burn'
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

  // ── 8f) BURN DoT accumulation pin (affliction-synergy AC2 — NEW, mirrors 8b) ── prove burn rides the SAME
  // damaging-status path as bleed: a burn of tickDmg=4 every 0.4s, ticked in 0.1s steps over 0.4s, deals
  // EXACTLY 4 once (one full interval crossed) and is still live (timer > 0). The COMPUTED output (never
  // hand-invented) — if burn ever stopped ticking like bleed/poison (a status.js regression) this fails. The
  // existing 8b/8c/8d/8e bleed/stun/poison pins are UNCHANGED above (burn does not perturb them). ──
  {
    const list = []
    applyStatus(list, { kind: 'burn', duration: 2.4, tickInterval: 0.4, tickDmg: 4 })
    let total = 0
    for (let i = 0; i < 4; i++) total += tickStatuses(list, 0.1).damage // 4 × 0.1 = 0.4s → one interval.
    if (total !== 4) fail(`status tick: 0.4s of a 0.4s/4 burn should deal 4, got ${total}`)
    if (!hasStatus(list, 'burn')) fail('status tick: burn should still be live after 0.4s of 2.4s duration')
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
  // color-scaling-stats §6 (Decision 10, AC8) — the three colour scrolls grow the pool to ≥9.
  if (!Array.isArray(SCROLLS) || SCROLLS.length < 9) {
    fail(`SCROLLS has ${SCROLLS?.length} entries, expected ≥9 (round-3 build variety + 3 colour scrolls)`)
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
      // color-scaling-stats §6 (Decision 10) — the three colour levels are bigger-is-better (a level only helps).
      brut: run.brutalityLevel,
      tac: run.tacticsLevel,
      surv: run.survivalLevel,
    }
    s.apply(run) // must not throw.
    // Damage / max-HP / lifesteal / status / flask / colour levels are bigger-is-better; the dodge-cooldown mult
    // is smaller-is-better (a shorter cooldown). Assert NONE moved the wrong way (a boost never weakens).
    if (run.scrollDamageMult < before.dmg) fail(`scroll ${s.id}: scrollDamageMult decreased`)
    if (run.scrollMaxHpBonus < before.hp) fail(`scroll ${s.id}: scrollMaxHpBonus decreased`)
    if (run.scrollLifestealFrac < before.life) fail(`scroll ${s.id}: scrollLifestealFrac decreased`)
    if (run.scrollStatusDurationMult < before.stat) fail(`scroll ${s.id}: scrollStatusDurationMult decreased`)
    if (run.scrollDodgeIframeBonus < before.ifr) fail(`scroll ${s.id}: scrollDodgeIframeBonus decreased`)
    if (run.maxFlasks < before.flasksMax) fail(`scroll ${s.id}: maxFlasks decreased`)
    if (run.scrollDodgeCdMult > before.cd) fail(`scroll ${s.id}: scrollDodgeCdMult increased (a longer dodge cooldown is a weaken)`)
    if (run.brutalityLevel < before.brut) fail(`scroll ${s.id}: brutalityLevel decreased`)
    if (run.tacticsLevel < before.tac) fail(`scroll ${s.id}: tacticsLevel decreased`)
    if (run.survivalLevel < before.surv) fail(`scroll ${s.id}: survivalLevel decreased`)
    // At least ONE field must have changed (a no-op scroll is a content bug — a found scroll must DO something).
    const changed =
      run.scrollDamageMult !== before.dmg || run.scrollMaxHpBonus !== before.hp ||
      run.scrollLifestealFrac !== before.life || run.scrollStatusDurationMult !== before.stat ||
      run.scrollDodgeCdMult !== before.cd || run.scrollDodgeIframeBonus !== before.ifr ||
      run.maxFlasks !== before.flasksMax ||
      run.brutalityLevel !== before.brut || run.tacticsLevel !== before.tac || run.survivalLevel !== before.surv
    if (!changed) fail(`scroll ${s.id}: apply() changed no run-only field (a no-op scroll)`)
  }

  // ── color-scaling-stats §6 (Decision 10, AC8) — each colour scroll raises EXACTLY its own level by +1 and
  // leaves the other two unchanged (applied to a fresh createRunState). A miswired apply (bumps the wrong colour
  // or two at once) fails loudly. SCROLLS_BY_ID resolves them; the verifier maps each id → its expected field. ──
  const COLOR_SCROLLS = [
    { id: 'scrollBrutality', field: 'brutalityLevel' },
    { id: 'scrollTactics', field: 'tacticsLevel' },
    { id: 'scrollSurvival', field: 'survivalLevel' },
  ]
  const ALL_COLOR_FIELDS = ['brutalityLevel', 'tacticsLevel', 'survivalLevel']
  for (const { id, field } of COLOR_SCROLLS) {
    const sc = SCROLLS.find((s) => s.id === id)
    if (!sc) fail(`colour scroll "${id}" missing from SCROLLS (AC8)`)
    const run = createRunStateForScrolls(0xc0ffee, 0)
    sc.apply(run)
    if (run[field] !== 1) fail(`colour scroll ${id}: must raise ${field} to 1 (got ${run[field]})`)
    for (const other of ALL_COLOR_FIELDS) {
      if (other !== field && run[other] !== 0) fail(`colour scroll ${id}: must NOT change ${other} (got ${run[other]})`)
    }
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
      // The addStatus kind must be a KNOWN status kind (affliction-synergy §6.5 — burn is now known, so the
      // Searing affix passes; a typo'd / dropped kind fails loudly, mirroring the weapon/skill status checks).
      if (!STATUS_KINDS.includes(a.addStatus.kind)) fail(`weapon affix ${a.id}: addStatus kind "${a.addStatus.kind}" is not a known status kind (AC6)`)
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
    // ── per-weapon-movesets §6.7 (Decision 9, AC3) — the fold must PRESERVE the weapon's `moveset` (the `...weapon`
    // spread carries it; the affix never drops it). A folded weapon that lost its moveset would silently strip the
    // charge/flurry/finisher/pierce playstyle off any affixed weapon. The Sword carries a moveset, so a folded
    // Sword must too (shape-preserved — the SAME ref, since the moveset is immutable pattern data). ──
    if (SWORD.moveset && !foldWeaponAffix(SWORD, WEAPON_KEEN).moveset) fail('foldWeaponAffix dropped the moveset')
    if (foldWeaponAffix(SWORD, WEAPON_KEEN).moveset !== SWORD.moveset) fail('foldWeaponAffix should ref-preserve the moveset (immutable pattern data)')
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 11) Skills loadout table (skills/secondary-items design §6.7, AC7). An INDEPENDENT proof of the PURE
//     SKILLS table (the secondary-item layer) that stays Phaser-free: a non-empty list, every kind ∈
//     SKILL_KINDS, a positive cooldown, and the kind-specific fields present + numeric (volley: count > 0 +
//     a projectile; blast: radius > 0 + damage > 0; turret: duration > 0 + fireInterval > 0). Mirrors the
//     weapon / shop / boss table well-formedness checks — a malformed skill fails loudly under node.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  if (!Array.isArray(SKILLS) || SKILLS.length === 0) fail('SKILLS is empty (AC7 — the loadout layer needs skills)')
  // The lookup + ordered list must stay in lockstep with the table (no id drift / dead config).
  if (SKILL_ORDER.length !== SKILLS.length) fail('SKILL_ORDER length != SKILLS length (id list drift)')
  if (Object.keys(SKILLS_BY_ID).length !== SKILLS.length) fail('SKILLS_BY_ID size != SKILLS length (duplicate/missing id)')
  // Every kind in the table must be used by at least one skill (proves the 3 kinds aren't dead config), and
  // every kind a skill declares must be a KNOWN kind. Track which kinds appear to assert full coverage.
  const kindsSeen = new Set()
  const PROJ_FIELDS = ['speed', 'damage', 'knockback', 'lifetime']
  const seenSkillIds = new Set()
  for (const s of SKILLS) {
    if (typeof s.id !== 'string' || !s.id) fail('skill missing id')
    if (seenSkillIds.has(s.id)) fail(`skill ${s.id}: duplicate id`)
    seenSkillIds.add(s.id)
    if (typeof s.name !== 'string' || !s.name) fail(`skill ${s.id}: missing name`)
    if (typeof s.desc !== 'string' || !s.desc) fail(`skill ${s.id}: missing desc`)
    if (!SKILL_KINDS.includes(s.kind)) fail(`skill ${s.id}: unknown kind "${s.kind}" (AC7 — must be in SKILL_KINDS)`)
    kindsSeen.add(s.kind)
    // color-scaling-stats §6.3 (Decision 5/10, AC3) — every skill carries a KNOWN scaling colour (a skill with
    // no/unknown colour fails loudly; _useSkill bakes ITS colour mult into the fired damage).
    if (!COLOR_IDS.includes(s.scaling)) fail(`skill ${s.id}: scaling "${s.scaling}" not a known colour (${COLOR_IDS.join('/')})`)
    if (!(typeof s.cooldown === 'number') || s.cooldown <= 0) fail(`skill ${s.id}: cooldown must be > 0`)
    // SKILLS_BY_ID must resolve this id back to THIS spec (the lookup is the real source GameScene uses).
    if (SKILLS_BY_ID[s.id] !== s) fail(`skill ${s.id}: SKILLS_BY_ID does not resolve to the same spec`)
    // Kind-specific params (GameScene._useSkill reads these — assert the right ones are present + sane).
    if (s.kind === 'volley') {
      if (!(typeof s.count === 'number') || s.count <= 0) fail(`skill ${s.id}: volley needs count > 0`)
      if (typeof s.spread !== 'number') fail(`skill ${s.id}: volley needs a numeric spread`)
      if (!s.projectile) fail(`skill ${s.id}: volley needs a projectile spec`)
      for (const f of PROJ_FIELDS) {
        if (typeof s.projectile[f] !== 'number') fail(`skill ${s.id}: volley projectile missing numeric field "${f}"`)
      }
    } else if (s.kind === 'blast') {
      if (!(typeof s.radius === 'number') || s.radius <= 0) fail(`skill ${s.id}: blast needs radius > 0`)
      if (!(typeof s.damage === 'number') || s.damage <= 0) fail(`skill ${s.id}: blast needs damage > 0`)
      if (typeof s.knockback !== 'number') fail(`skill ${s.id}: blast needs a numeric knockback`)
    } else if (s.kind === 'turret') {
      if (!(typeof s.duration === 'number') || s.duration <= 0) fail(`skill ${s.id}: turret needs duration > 0`)
      if (!(typeof s.fireInterval === 'number') || s.fireInterval <= 0) fail(`skill ${s.id}: turret needs fireInterval > 0`)
      if (!s.projectile) fail(`skill ${s.id}: turret needs a projectile spec (what it fires)`)
      for (const f of PROJ_FIELDS) {
        if (typeof s.projectile[f] !== 'number') fail(`skill ${s.id}: turret projectile missing numeric field "${f}"`)
      }
    }
    // An OPTIONAL status (volley/blast/turret) must reference a KNOWN status kind with a positive duration when
    // present (a damaging status also needs positive tick params — the same shape weapon statuses are checked).
    if (s.status) {
      if (!STATUS_KINDS.includes(s.status.kind)) fail(`skill ${s.id}: unknown status kind "${s.status.kind}"`)
      if (!(s.status.duration > 0)) fail(`skill ${s.id}: status duration must be > 0`)
      const damaging = s.status.kind === 'bleed' || s.status.kind === 'poison'
      if (damaging && !(s.status.tickInterval > 0 && s.status.tickDmg > 0)) {
        fail(`skill ${s.id}: a damaging status needs tickInterval > 0 AND tickDmg > 0`)
      }
    }
  }
  // Every declared kind must actually be USED (no dead kind config) — the FULL scope ask (volley+blast+turret).
  for (const k of SKILL_KINDS) {
    if (!kindsSeen.has(k)) fail(`skill kind "${k}" is in SKILL_KINDS but no skill uses it (dead config / cut scope)`)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 12) MUTATIONS table (build-&-replay design §6.6, AC1/AC6). An INDEPENDENT proof of the PURE MUTATIONS
//     perk table (the choice-driven run-power layer): a non-empty list, each row with a string id/name/desc
//     + a function apply, a unique id set, and the lookup/order in lockstep with the table. The IDENTITY-
//     SAFETY check (AC6): applying EVERY mutation to a FRESH RunState never throws AND never lowers a
//     bigger-is-better field (nor raises the smaller-is-better dodge-cooldown mult) — the same "never
//     weakens" sense the upgrade + scroll sweeps use — so a malformed mutation fails loudly under node.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── 12a) MUTATIONS well-formed (AC1): non-empty; each row a string id/name/desc + a function apply; ids
  // unique; the MUTATIONS_BY_ID lookup + MUTATION_ORDER list stay in lockstep with the table (no id drift). ──
  if (!Array.isArray(MUTATIONS) || MUTATIONS.length === 0) fail('MUTATIONS is empty (AC1 — the choice layer needs perks)')
  // The seeded 3-of-N pick needs at least 3 distinct mutations to offer a real choice (else the overlay is dull).
  if (MUTATIONS.length < 3) fail(`MUTATIONS has ${MUTATIONS.length} entries, expected ≥3 (the 3-of-N choice, AC2)`)
  if (MUTATION_ORDER.length !== MUTATIONS.length) fail('MUTATION_ORDER length != MUTATIONS length (id list drift)')
  if (Object.keys(MUTATIONS_BY_ID).length !== MUTATIONS.length) fail('MUTATIONS_BY_ID size != MUTATIONS length (duplicate/missing id)')
  const seenMutationIds = new Set()
  for (const m of MUTATIONS) {
    if (typeof m.id !== 'string' || !m.id) fail('mutation missing id')
    if (typeof m.name !== 'string' || !m.name) fail(`mutation ${m.id}: missing name`)
    if (typeof m.desc !== 'string' || !m.desc) fail(`mutation ${m.id}: missing desc`)
    if (typeof m.apply !== 'function') fail(`mutation ${m.id}: apply is not a function`)
    if (seenMutationIds.has(m.id)) fail(`mutation ${m.id}: duplicate id`)
    seenMutationIds.add(m.id)
    // The lookup must resolve this id back to THIS spec (the real source GameScene._applyMutation uses).
    if (MUTATIONS_BY_ID[m.id] !== m) fail(`mutation ${m.id}: MUTATIONS_BY_ID does not resolve to the same spec`)
  }

  // ── 12b) Each mutation's apply() is PURE-effect + identity-safe (AC6): applying it to a FRESH RunState must
  // NOT throw, must change at least ONE run-only/perk field (a no-op mutation is a content bug), and must never
  // move a field the WRONG way. Bigger-is-better: scrollDamageMult / scrollMaxHpBonus / scrollLifestealFrac /
  // scrollStatusDurationMult / scrollDodgeIframeBonus / maxFlasks / onKillHealAmount / lowHpDamageMult /
  // firstHitBonusMult. Smaller-is-better: scrollDodgeCdMult (a shorter dodge cooldown). ──
  for (const m of MUTATIONS) {
    const run = createRunStateForScrolls(0xc0ffee, 0)
    const before = {
      dmg: run.scrollDamageMult,
      hp: run.scrollMaxHpBonus,
      life: run.scrollLifestealFrac,
      stat: run.scrollStatusDurationMult,
      cd: run.scrollDodgeCdMult,
      ifr: run.scrollDodgeIframeBonus,
      flasksMax: run.maxFlasks,
      kill: run.onKillHealAmount,
      lowHp: run.lowHpDamageMult,
      firstHit: run.firstHitBonusMult,
      // ── Affliction-synergy fields (affliction-synergy AC6) ── vsAfflictedDamageMult/statusTickMult are
      // bigger-is-better; spreadAffliction is a flag a mutation may only turn ON (never off).
      vsAffl: run.vsAfflictedDamageMult,
      tickMult: run.statusTickMult,
      spread: run.spreadAffliction,
    }
    m.apply(run) // must not throw.
    // Bigger-is-better fields must not DECREASE; the smaller-is-better dodge-cooldown mult must not INCREASE.
    if (run.scrollDamageMult < before.dmg) fail(`mutation ${m.id}: scrollDamageMult decreased`)
    if (run.scrollMaxHpBonus < before.hp) fail(`mutation ${m.id}: scrollMaxHpBonus decreased`)
    if (run.scrollLifestealFrac < before.life) fail(`mutation ${m.id}: scrollLifestealFrac decreased`)
    if (run.scrollStatusDurationMult < before.stat) fail(`mutation ${m.id}: scrollStatusDurationMult decreased`)
    if (run.scrollDodgeIframeBonus < before.ifr) fail(`mutation ${m.id}: scrollDodgeIframeBonus decreased`)
    if (run.maxFlasks < before.flasksMax) fail(`mutation ${m.id}: maxFlasks decreased`)
    if (run.onKillHealAmount < before.kill) fail(`mutation ${m.id}: onKillHealAmount decreased`)
    if (run.lowHpDamageMult < before.lowHp) fail(`mutation ${m.id}: lowHpDamageMult decreased`)
    if (run.firstHitBonusMult < before.firstHit) fail(`mutation ${m.id}: firstHitBonusMult decreased`)
    if (run.scrollDodgeCdMult > before.cd) fail(`mutation ${m.id}: scrollDodgeCdMult increased (a longer dodge cooldown is a weaken)`)
    // ── Affliction-synergy never-weaken (affliction-synergy AC6/Decision 6) ── the two mults are
    // bigger-is-better; spreadAffliction is a flag a mutation may only turn ON (false → true), never off.
    if (run.vsAfflictedDamageMult < before.vsAffl) fail(`mutation ${m.id}: vsAfflictedDamageMult decreased`)
    if (run.statusTickMult < before.tickMult) fail(`mutation ${m.id}: statusTickMult decreased`)
    if (before.spread === true && run.spreadAffliction === false) fail(`mutation ${m.id}: spreadAffliction was turned OFF (a flag may only be armed)`)
    // At least ONE field must have changed (a found mutation must DO something — a no-op perk is a content bug).
    const changed =
      run.scrollDamageMult !== before.dmg || run.scrollMaxHpBonus !== before.hp ||
      run.scrollLifestealFrac !== before.life || run.scrollStatusDurationMult !== before.stat ||
      run.scrollDodgeCdMult !== before.cd || run.scrollDodgeIframeBonus !== before.ifr ||
      run.maxFlasks !== before.flasksMax || run.onKillHealAmount !== before.kill ||
      run.lowHpDamageMult !== before.lowHp || run.firstHitBonusMult !== before.firstHit ||
      run.vsAfflictedDamageMult !== before.vsAffl || run.statusTickMult !== before.tickMult ||
      run.spreadAffliction !== before.spread
    if (!changed) fail(`mutation ${m.id}: apply() changed no run-only/perk field (a no-op mutation)`)
  }

  // ── 12c) Identity safety in AGGREGATE (AC3/AC6): applying EVERY mutation to ONE fresh RunState in sequence
  // never throws and the run still has sane perk fields (all bigger-is-better ≥ their neutral identity, the
  // dodge-cooldown mult ≤ its neutral 1). This proves the WHOLE table composes without weakening the run. ──
  {
    const run = createRunStateForScrolls(0xc0ffee, 0)
    for (const m of MUTATIONS) m.apply(run) // the full stack — must not throw.
    if (run.scrollDamageMult < 1) fail('mutations aggregate: scrollDamageMult below the neutral identity')
    if (run.scrollMaxHpBonus < 0) fail('mutations aggregate: scrollMaxHpBonus below the neutral identity')
    if (run.scrollLifestealFrac < 0) fail('mutations aggregate: scrollLifestealFrac below the neutral identity')
    if (run.scrollStatusDurationMult < 1) fail('mutations aggregate: scrollStatusDurationMult below the neutral identity')
    if (run.scrollDodgeIframeBonus < 0) fail('mutations aggregate: scrollDodgeIframeBonus below the neutral identity')
    if (run.maxFlasks < 2) fail('mutations aggregate: maxFlasks below the neutral identity')
    if (run.onKillHealAmount < 0) fail('mutations aggregate: onKillHealAmount below the neutral identity')
    if (run.lowHpDamageMult < 1) fail('mutations aggregate: lowHpDamageMult below the neutral identity')
    if (run.firstHitBonusMult < 1) fail('mutations aggregate: firstHitBonusMult below the neutral identity')
    if (run.scrollDodgeCdMult > 1) fail('mutations aggregate: scrollDodgeCdMult above the neutral identity (a longer dodge cooldown)')
    // ── Affliction-synergy aggregate (affliction-synergy AC6/AC10) ── the two mults stay ≥ their neutral 1;
    // spreadAffliction may only end UP armed (true) or stay false — never an impossible non-boolean.
    if (run.vsAfflictedDamageMult < 1) fail('mutations aggregate: vsAfflictedDamageMult below the neutral identity')
    if (run.statusTickMult < 1) fail('mutations aggregate: statusTickMult below the neutral identity')
    if (typeof run.spreadAffliction !== 'boolean') fail('mutations aggregate: spreadAffliction must remain a boolean flag')
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 13) Meta-progression: Boss-Cell TIERS + BLUEPRINTS + the run-pool resolvers (meta-progression design §6.10,
//     AC1/AC5/AC6/AC11). An INDEPENDENT proof of the PURE tier table + blueprint catalog + the three pool
//     resolvers that stay Phaser-free: the tier table is well-formed + monotone (mult >= 1 non-decreasing,
//     flaskDelta non-increasing, eliteChanceMult >= 1 non-decreasing), tier 0 is the EXACT identity, the
//     shipped flask floor is sane, the blueprint catalog ↔ table-tags are consistent both ways, the resolvers
//     return EXACTLY the starters on an empty set (the identity pin, AC11) + ALL rows on a full set, and the
//     bankRun unlock/merge math is proven on a small in-memory shim (MetaState.bankRun is save.js-coupled).
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── 13a) BOSS_CELL_TIERS well-formed + monotone (AC1) ── index === position; tier 0 is the EXACT identity
  // (bossCellMult 1, flaskDelta 0, eliteChanceMult 1); bossCellMult monotone non-decreasing + every >= 1;
  // flaskDelta monotone non-increasing; eliteChanceMult monotone non-decreasing + every >= 1. (The module-load
  // assertion in tiers.js ALSO enforces these — a re-tune throws on import; this re-proves them independently.)
  if (!Array.isArray(BOSS_CELL_TIERS) || BOSS_CELL_TIERS.length < 1) fail('BOSS_CELL_TIERS is empty (AC1)')
  if (MAX_TIER !== BOSS_CELL_TIERS.length - 1) fail(`MAX_TIER ${MAX_TIER} !== BOSS_CELL_TIERS.length-1 ${BOSS_CELL_TIERS.length - 1}`)
  const t0 = BOSS_CELL_TIERS[0]
  if (!(t0.bossCellMult === 1 && t0.flaskDelta === 0 && t0.eliteChanceMult === 1)) {
    fail('BOSS_CELL_TIERS[0] is not the EXACT identity (bossCellMult 1, flaskDelta 0, eliteChanceMult 1) (AC1)')
  }
  for (let i = 0; i < BOSS_CELL_TIERS.length; i++) {
    const t = BOSS_CELL_TIERS[i]
    if (t.index !== i) fail(`BOSS_CELL_TIERS[${i}].index ${t.index} !== position ${i}`)
    if (typeof t.name !== 'string' || !t.name) fail(`tier ${i}: missing name`)
    if (typeof t.desc !== 'string' || !t.desc) fail(`tier ${i}: missing desc`)
    if (!(t.bossCellMult >= 1)) fail(`tier ${i}: bossCellMult ${t.bossCellMult} < 1 (a tier never weakens the curve)`)
    if (!(t.eliteChanceMult >= 1)) fail(`tier ${i}: eliteChanceMult ${t.eliteChanceMult} < 1`)
    if (i > 0) {
      const p = BOSS_CELL_TIERS[i - 1]
      if (t.bossCellMult < p.bossCellMult) fail(`tier ${i}: bossCellMult dipped (${t.bossCellMult} < ${p.bossCellMult})`)
      if (t.flaskDelta > p.flaskDelta) fail(`tier ${i}: flaskDelta rose (${t.flaskDelta} > ${p.flaskDelta}) — a deeper tier must never give MORE flasks`)
      if (t.eliteChanceMult < p.eliteChanceMult) fail(`tier ${i}: eliteChanceMult dipped (${t.eliteChanceMult} < ${p.eliteChanceMult})`)
    }
  }
  // tierAt clamps an out-of-range index into [0, MAX_TIER] (Decision 5 — a corrupt selectedTier degrades).
  if (tierAt(-5) !== BOSS_CELL_TIERS[0]) fail('tierAt(-5) must clamp to tier 0')
  if (tierAt(999) !== BOSS_CELL_TIERS[MAX_TIER]) fail('tierAt(999) must clamp to MAX_TIER')

  // ── 13b) Flask-floor sanity (Decision 4) ── BASE_PLAYER_STATS.maxFlasks + flaskDelta of the DEEPEST tier is
  // >= 1 so the shipped table never reaches an unwinnable zero-heal run (the run-seed clamp floors it at 1, but
  // a SHIPPED table that needs the clamp to be winnable is a tuning smell — assert the table is sane by design).
  const deepestFlask = BASE_PLAYER_STATS.maxFlasks + BOSS_CELL_TIERS[MAX_TIER].flaskDelta
  if (!(deepestFlask >= 1)) fail(`flask floor: deepest tier leaves ${deepestFlask} flasks (< 1) — the shipped table is unwinnable by design (Decision 4)`)

  // ── 13c) Blueprint catalog ↔ table-tags consistency BOTH WAYS (AC6) ── every catalog id is referenced by
  // EXACTLY ONE tagged row across weapons/skills/mutations, with the catalog `kind` matching the table the tag
  // lives in; and every tagged row's blueprint id exists in the catalog (no orphan tag, no orphan entry).
  if (!Array.isArray(BLUEPRINTS) || BLUEPRINTS.length === 0) fail('BLUEPRINTS is empty (AC6 — the unlock needs content)')
  if (Object.keys(BLUEPRINTS_BY_ID).length !== BLUEPRINTS.length) fail('BLUEPRINTS_BY_ID size != BLUEPRINTS length (duplicate/missing id)')
  // Gather every (id, kind) a pool table TAGS, from the three tables (the resolvers expose the rows; we read the
  // tagged ones via a full-unlock resolve minus the empty-unlock resolve — but simplest: read the tables' tags
  // directly through the resolvers' inputs). Build the tag→kind map from the row sets each resolver can return.
  const fullUnlock = new Set(BLUEPRINTS.map((b) => b.id))
  const taggedWeapons = runWeaponPool(fullUnlock).filter((id) => !runWeaponPool(new Set()).includes(id))
  const taggedSkills = runSkillPool(fullUnlock).filter((s) => !runSkillPool(new Set()).includes(s))
  const taggedMutations = runMutationPool(fullUnlock).filter((m) => !runMutationPool(new Set()).includes(m))
  // Resolve each tagged row back to its blueprint tag + the kind of table it came from (one map, asserted 1:1).
  const tagToKind = {}
  // Weapons: tagged rows are extra weapon IDs beyond the starters — but we need the row's `blueprint` tag. Read
  // the WEAPON_ORDER directly (imported) so we have the tag. (The resolver proved which IDs are gated above.)
  for (const w of WEAPON_ORDER) {
    if (w.blueprint) {
      if (tagToKind[w.blueprint]) fail(`blueprint tag "${w.blueprint}" referenced by more than one row`)
      tagToKind[w.blueprint] = 'weapon'
    }
  }
  // Skills + mutations: re-derive their tagged rows + tags. We imported the resolvers; to read the `blueprint`
  // tag itself, resolve the full set and inspect each row's tag (a gated row carries it; a starter does not).
  for (const s of runSkillPool(fullUnlock)) {
    if (s.blueprint) {
      if (tagToKind[s.blueprint]) fail(`blueprint tag "${s.blueprint}" referenced by more than one row`)
      tagToKind[s.blueprint] = 'skill'
    }
  }
  for (const m of runMutationPool(fullUnlock)) {
    if (m.blueprint) {
      if (tagToKind[m.blueprint]) fail(`blueprint tag "${m.blueprint}" referenced by more than one row`)
      tagToKind[m.blueprint] = 'mutation'
    }
  }
  // Sanity: the number of distinct tags === the number of gated rows the resolvers found (no double-count).
  if (taggedWeapons.length + taggedSkills.length + taggedMutations.length !== Object.keys(tagToKind).length) {
    fail('blueprint tags: the gated-row count != the distinct-tag count (a tag mismatch)')
  }
  // Every catalog entry maps to EXACTLY one tagged row with the matching kind.
  for (const b of BLUEPRINTS) {
    if (typeof b.id !== 'string' || !b.id) fail('blueprint catalog: missing id')
    if (typeof b.name !== 'string' || !b.name) fail(`blueprint ${b.id}: missing name`)
    if (typeof b.desc !== 'string' || !b.desc) fail(`blueprint ${b.id}: missing desc`)
    if (!tagToKind[b.id]) fail(`blueprint catalog entry "${b.id}" is not referenced by any tagged pool row (orphan entry)`)
    if (tagToKind[b.id] !== b.kind) fail(`blueprint "${b.id}": catalog kind "${b.kind}" != the table it tags "${tagToKind[b.id]}"`)
  }
  // Every tagged row's id exists in the catalog (no orphan tag).
  for (const tag of Object.keys(tagToKind)) {
    if (!BLUEPRINTS_BY_ID[tag]) fail(`tagged pool row references blueprint "${tag}" missing from the catalog (orphan tag)`)
  }

  // ── 13d) Resolver IDENTITY at empty + completeness at full (AC11 — the blueprint identity pin) ── with an
  // EMPTY unlocked set each resolver returns EXACTLY the STARTER rows (untagged) === the pre-slice tables; with
  // the FULL set it returns ALL rows. This PROVES "a default save draws from the SAME rows as today" + "a full
  // unlock widens to everything". (The empty-set weapon resolver === WEAPON_ORDER's untagged ids, etc.)
  const startersW = WEAPON_ORDER.filter((w) => !w.blueprint).map((w) => w.id)
  if (!deepEqual(runWeaponPool(new Set()), startersW)) fail('runWeaponPool(empty) != the starter weapon ids (identity broken, AC11)')
  if (runWeaponPool(fullUnlock).length !== WEAPON_ORDER.length) fail('runWeaponPool(full) != ALL weapons')
  // ── PRE-SLICE DRAW-ORDER PIN (meta-progression review, AC7/AC11 — seed-replay determinism) ── the
  // weapon-pickup / branch-reward draws are ORDER-SENSITIVE (they pick pool[floor(rng()*len)] after filtering
  // out the equipped weapon), so the empty-unlock pool's ORDER — not just its SET — must equal the pre-slice
  // const `WEAPON_PICKUP_POOL = ['hammer','bow','sword','spear']`, or a non-sword start (the START_WEAPON
  // upgrade) draws a DIFFERENT weapon than before this slice for the SAME seed. Assert the EXACT order.
  const PRE_SLICE_WEAPON_POOL = ['hammer', 'bow', 'sword', 'spear']
  if (!deepEqual(runWeaponPool(new Set()), PRE_SLICE_WEAPON_POOL)) {
    fail(`runWeaponPool(empty) order != the pre-slice ${JSON.stringify(PRE_SLICE_WEAPON_POOL)} (AC7/AC11 — seed-replay determinism broken), got ${JSON.stringify(runWeaponPool(new Set()))}`)
  }
  // Skills/mutations: the empty-set resolve must contain NO tagged row (every returned row is a starter).
  if (runSkillPool(new Set()).some((s) => s.blueprint)) fail('runSkillPool(empty) returned a gated skill (identity broken, AC11)')
  if (runMutationPool(new Set()).some((m) => m.blueprint)) fail('runMutationPool(empty) returned a gated mutation (identity broken, AC11)')
  // …and the empty-set count === the count of untagged rows (no starter dropped, no gated row leaked).
  // (We can't import the raw SKILLS/MUTATIONS arrays' length here cheaply, so assert via the full-vs-gated split.)
  if (runSkillPool(new Set()).length + taggedSkills.length !== runSkillPool(fullUnlock).length) fail('skill resolver: starters + gated != full set')
  if (runMutationPool(new Set()).length + taggedMutations.length !== runMutationPool(fullUnlock).length) fail('mutation resolver: starters + gated != full set')
  // A PARTIAL set returns starters PLUS only the named gated row (set-membership, not all-or-nothing).
  if (BLUEPRINTS.length > 0) {
    const one = new Set([BLUEPRINTS[0].id])
    const kind = BLUEPRINTS[0].kind
    const got =
      kind === 'weapon' ? runWeaponPool(one).length :
      kind === 'skill' ? runSkillPool(one).length :
      runMutationPool(one).length
    const empty =
      kind === 'weapon' ? runWeaponPool(new Set()).length :
      kind === 'skill' ? runSkillPool(new Set()).length :
      runMutationPool(new Set()).length
    if (got !== empty + 1) fail(`resolver(partial): unlocking one ${kind} blueprint must add exactly one row (got ${got}, expected ${empty + 1})`)
  }

  // ── 13e) bankRun unlock/merge math on a PURE in-memory shim (AC5/AC9) ── MetaState.bankRun is coupled to
  // save.js (localStorage), so the verifier proves the documented RULE on a small shim mirroring the math:
  // (a) tier unlock = max(unlockedTier, min(completedAtTier+1, MAX_TIER)) — clamped at MAX_TIER, only on a
  // COMPLETED run (completedAtTier != null); (b) blueprint merge = set-union dedup; (c) a death (null) does
  // NOT unlock a tier. This pins the rule so a divergent bankRun impl is caught here (alongside typecheck).
  {
    const shimBank = (meta, { blueprints = [], completedAtTier = null }) => {
      for (const id of blueprints) if (!meta.blueprints.includes(id)) meta.blueprints.push(id)
      if (completedAtTier != null) meta.unlockedTier = Math.max(meta.unlockedTier, Math.min(completedAtTier + 1, MAX_TIER))
      return meta
    }
    // A completed run at tier 0 unlocks tier 1 (if MAX_TIER >= 1).
    const m1 = shimBank({ unlockedTier: 0, blueprints: [] }, { completedAtTier: 0 })
    if (m1.unlockedTier !== Math.min(1, MAX_TIER)) fail(`bankRun shim: completed@0 must unlock tier ${Math.min(1, MAX_TIER)}, got ${m1.unlockedTier}`)
    // A completed run at MAX_TIER stays clamped at MAX_TIER (never past the table).
    const m2 = shimBank({ unlockedTier: MAX_TIER, blueprints: [] }, { completedAtTier: MAX_TIER })
    if (m2.unlockedTier !== MAX_TIER) fail(`bankRun shim: completed@MAX must stay clamped at MAX_TIER, got ${m2.unlockedTier}`)
    // A DEATH (completedAtTier null) does NOT raise the tier but STILL merges blueprints.
    const m3 = shimBank({ unlockedTier: 0, blueprints: [] }, { blueprints: [BLUEPRINTS[0].id], completedAtTier: null })
    if (m3.unlockedTier !== 0) fail('bankRun shim: a death must NOT unlock a tier')
    if (!m3.blueprints.includes(BLUEPRINTS[0].id)) fail('bankRun shim: a death must still bank carried blueprints')
    // Set-union dedup: re-banking the SAME id does not duplicate it.
    const m4 = shimBank(m3, { blueprints: [BLUEPRINTS[0].id], completedAtTier: null })
    if (m4.blueprints.filter((id) => id === BLUEPRINTS[0].id).length !== 1) fail('bankRun shim: re-banking an id must dedup (set-union)')
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 14) COLOURS table + scaling math (color-scaling-stats §6, Decision 10, AC1/AC12). An INDEPENDENT proof of
//     the PURE colours table + the scaling functions: the colour space is well-formed (3 ids, lockstep lookup,
//     numeric tints), colorMult is monotone non-decreasing with an EXACT identity at level 0 (the byte-identity
//     pin — load-bearing), and survivalHpBonus is monotone non-decreasing from 0. Mirrors the other table
//     sweeps' style — a malformed colour table / a broken identity fails loudly under node, never reaching the game.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── 14a) Colour table well-formed: COLOR_IDS is EXACTLY the 3 colours (length 3); each id resolves in COLORS
  // with COLORS[id].id === id, a non-empty name, and a numeric tint. ──
  if (!Array.isArray(COLOR_IDS) || COLOR_IDS.length !== 3) fail(`COLOR_IDS must have exactly 3 colours, got ${COLOR_IDS?.length}`)
  const EXPECTED_COLOR_IDS = ['brutality', 'tactics', 'survival']
  for (let i = 0; i < EXPECTED_COLOR_IDS.length; i++) {
    if (COLOR_IDS[i] !== EXPECTED_COLOR_IDS[i]) fail(`COLOR_IDS[${i}] = "${COLOR_IDS[i]}", expected "${EXPECTED_COLOR_IDS[i]}" (the pinned order)`)
  }
  for (const id of COLOR_IDS) {
    const c = COLORS[id]
    if (!c) fail(`colour id "${id}" has no COLORS entry (lookup drift)`)
    if (c.id !== id) fail(`COLORS["${id}"].id = "${c.id}" (lookup not in lockstep)`)
    if (typeof c.name !== 'string' || !c.name) fail(`colour ${id}: missing name`)
    if (typeof c.tint !== 'number') fail(`colour ${id}: tint must be a number (0xRRGGBB)`)
  }

  // ── 14b) colorMult identity + monotonicity (AC12 — the byte-identity pin): colorMult(0) === 1 EXACTLY (the
  // load-bearing identity — composing × 1 at level 0 reproduces the pinned damages). PER_LEVEL > 0; over levels
  // 1..20 colorMult is monotone non-decreasing AND > 1 (a level actually helps). colorMult(<0) clamps to 1. ──
  if (colorMult(0) !== 1) fail(`colorMult(0) = ${colorMult(0)}, expected EXACTLY 1 (the identity pin)`)
  if (!(PER_LEVEL > 0)) fail(`PER_LEVEL must be > 0, got ${PER_LEVEL}`)
  if (colorMult(-1) !== 1) fail(`colorMult(-1) = ${colorMult(-1)}, expected 1 (defensive negative clamp)`)
  let prevMult = colorMult(0)
  for (let lvl = 1; lvl <= 20; lvl++) {
    const m = colorMult(lvl)
    if (m < prevMult) fail(`colorMult dipped at level ${lvl} (${m} < ${prevMult})`)
    if (!(m > 1)) fail(`colorMult(${lvl}) = ${m}, expected > 1 (a colour level must help)`)
    prevMult = m
  }

  // ── 14c) survivalHpBonus identity + monotonicity: SURVIVAL_HP_PER_LEVEL ≥ 0; survivalHpBonus(0) === 0 (the
  // identity — _syncPlayerScrollStats derives the same maxHp at level 0); monotone non-decreasing over 0..20. ──
  if (!(SURVIVAL_HP_PER_LEVEL >= 0)) fail(`SURVIVAL_HP_PER_LEVEL must be ≥ 0, got ${SURVIVAL_HP_PER_LEVEL}`)
  if (survivalHpBonus(0) !== 0) fail(`survivalHpBonus(0) = ${survivalHpBonus(0)}, expected EXACTLY 0 (the identity)`)
  if (survivalHpBonus(-1) !== 0) fail(`survivalHpBonus(-1) = ${survivalHpBonus(-1)}, expected 0 (defensive negative clamp)`)
  let prevHp = survivalHpBonus(0)
  for (let lvl = 1; lvl <= 20; lvl++) {
    const h = survivalHpBonus(lvl)
    if (h < prevHp) fail(`survivalHpBonus dipped at level ${lvl} (${h} < ${prevHp})`)
    prevHp = h
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 15) RARITY table + the rarity/affix-power folds (item-rarity-forge §6/§7, Decision 1-5, AC1/AC3/AC4/AC11).
//     An INDEPENDENT proof of the PURE rarity table + the composing folds: the tier space is well-formed
//     (4 pinned ids, lockstep lookup, numeric tints/weights, boolean extraAffix), `common` is the EXACT
//     identity (damageMult 1, no extra affix), damageMult is monotone non-decreasing + every >= 1 (never-
//     weaken), foldRarity is identity@common/null + a schema-preserving never-weaken fold otherwise, and the
//     extended foldWeaponAffix(w, affix, powerMult) is identity@powerMult=1 + never-weakens@powerMult>1.
//     Mirrors the §10 affix-fold / §14 colour sweeps — a malformed rarity table fails loudly under node.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── 15a) Rarity table well-formed: RARITY_IDS is EXACTLY the 4 tiers (length 4, pinned order); each id
  // resolves in RARITIES with RARITIES[id].id === id, a non-empty name, a numeric tint, a numeric weight > 0,
  // and a boolean extraAffix. DEPTH_BIAS / EXTRA_AFFIX_POWER are sane pinned constants. ──
  const EXPECTED_RARITY_IDS = ['common', 'rare', 'epic', 'legendary']
  if (!Array.isArray(RARITY_IDS) || RARITY_IDS.length !== 4) fail(`RARITY_IDS must have exactly 4 tiers, got ${RARITY_IDS?.length}`)
  for (let i = 0; i < EXPECTED_RARITY_IDS.length; i++) {
    if (RARITY_IDS[i] !== EXPECTED_RARITY_IDS[i]) fail(`RARITY_IDS[${i}] = "${RARITY_IDS[i]}", expected "${EXPECTED_RARITY_IDS[i]}" (the pinned order)`)
  }
  for (const id of RARITY_IDS) {
    const r = RARITIES[id]
    if (!r) fail(`rarity id "${id}" has no RARITIES entry (lookup drift)`)
    if (r.id !== id) fail(`RARITIES["${id}"].id = "${r.id}" (lookup not in lockstep)`)
    if (typeof r.name !== 'string' || !r.name) fail(`rarity ${id}: missing name`)
    if (typeof r.tint !== 'number') fail(`rarity ${id}: tint must be a number (0xRRGGBB)`)
    if (!(typeof r.weight === 'number' && r.weight > 0)) fail(`rarity ${id}: weight must be a number > 0`)
    if (typeof r.extraAffix !== 'boolean') fail(`rarity ${id}: extraAffix must be a boolean`)
    if (!(typeof r.damageMult === 'number')) fail(`rarity ${id}: damageMult must be a number`)
  }
  if (!(DEPTH_BIAS >= 0)) fail(`DEPTH_BIAS must be ≥ 0, got ${DEPTH_BIAS}`)
  if (!(EXTRA_AFFIX_POWER >= 1)) fail(`EXTRA_AFFIX_POWER must be ≥ 1 (never weakens an affix), got ${EXTRA_AFFIX_POWER}`)

  // ── 15b) common is the EXACT identity tier (the byte-identity pin): damageMult === 1 EXACTLY, extraAffix false. ──
  if (RARITIES.common.damageMult !== 1) fail(`RARITIES.common.damageMult = ${RARITIES.common.damageMult}, expected EXACTLY 1 (the identity tier)`)
  if (RARITIES.common.extraAffix !== false) fail(`RARITIES.common.extraAffix must be false (the identity tier)`)

  // ── 15c) damageMult monotone non-decreasing along RARITY_IDS, every >= 1 (never-weaken). ──
  let prevRarMult = -Infinity
  for (const id of RARITY_IDS) {
    const m = RARITIES[id].damageMult
    if (!(m >= 1)) fail(`rarity ${id}: damageMult ${m} must be >= 1 (never-weaken)`)
    if (m < prevRarMult) fail(`rarity damageMult dipped at "${id}" (${m} < ${prevRarMult})`)
    prevRarMult = m
  }

  // ── 15d) foldRarity identity@common/null + a schema-preserving never-weaken fold otherwise. For every
  // weapon: foldRarity(w, common) === w AND foldRarity(w, null) === w (same ref, no clone). For every
  // weapon × every NON-common tier: a NEW object, the schema preserved (type, swings length, projectile iff
  // ranged), no swing damage below the input, and the input weapon UNCHANGED (no mutation). ──
  for (const w of WEAPON_ORDER) {
    if (foldRarity(w, RARITIES.common) !== w) fail(`foldRarity(${w.id}, common) must return the SAME weapon ref (identity)`)
    if (foldRarity(w, null) !== w) fail(`foldRarity(${w.id}, null) must return the SAME weapon ref (identity)`)
    const baseDmgs = w.swings.map((s) => s.damage)
    const baseProjDmg = w.projectile ? w.projectile.damage : null
    for (const id of RARITY_IDS) {
      if (id === 'common') continue
      const tier = RARITIES[id]
      const folded = foldRarity(w, tier)
      if (folded === w) fail(`foldRarity(${w.id}, ${id}) must return a NEW object (no mutation)`)
      if (folded.type !== w.type) fail(`foldRarity(${w.id}, ${id}): type changed`)
      if (!Array.isArray(folded.swings) || folded.swings.length !== w.swings.length) fail(`foldRarity(${w.id}, ${id}): swings table malformed`)
      if (w.type === 'ranged' && !folded.projectile) fail(`foldRarity(${w.id}, ${id}): ranged weapon lost its projectile`)
      if (w.type !== 'ranged' && folded.projectile) fail(`foldRarity(${w.id}, ${id}): melee weapon gained a projectile`)
      if (folded.rarityId !== id) fail(`foldRarity(${w.id}, ${id}): must stamp rarityId`)
      folded.swings.forEach((s, i) => {
        if (s.damage < baseDmgs[i]) fail(`foldRarity(${w.id}, ${id}): swing ${i} damage ${s.damage} < base ${baseDmgs[i]} (never-weaken)`)
      })
      if (baseProjDmg !== null && folded.projectile.damage < baseProjDmg) fail(`foldRarity(${w.id}, ${id}): projectile damage dropped below base`)
    }
    // Non-mutation: the base weapon's swing + projectile damages are UNCHANGED after all the folds.
    w.swings.forEach((s, i) => {
      if (s.damage !== baseDmgs[i]) fail(`foldRarity MUTATED ${w.id} base swing ${i} damage (aliasing bug)`)
    })
    if (baseProjDmg !== null && w.projectile.damage !== baseProjDmg) fail(`foldRarity MUTATED ${w.id} base projectile damage (aliasing bug)`)
  }

  // ── 15e) Extended foldWeaponAffix(w, affix, powerMult): identity@powerMult=1 (deep-equals the legacy two-arg
  // fold — the additive-identity pin for the extended signature) AND never-weakens@powerMult>1 (each baked
  // affix damage/lifesteal/tick contribution >= the powerMult=1 value). Swept over every weapon × every affix. ──
  for (const w of WEAPON_ORDER) {
    for (const affix of WEAPON_AFFIX_ORDER) {
      const legacy = foldWeaponAffix(w, affix) // the two-arg fold (pre-change behaviour).
      const ident = foldWeaponAffix(w, affix, 1) // the extended fold at the identity powerMult.
      if (!deepEqual(legacy, ident)) fail(`foldWeaponAffix(${w.id}, ${affix.id}, 1) must deep-equal the legacy two-arg fold (the identity pin)`)
      // powerMult > 1 never weakens: each swing damage, the projectile damage, lifesteal, and a DoT tickDmg
      // must be >= the powerMult=1 value (a stronger affix only ever helps — the rarity power bump).
      const strong = foldWeaponAffix(w, affix, EXTRA_AFFIX_POWER)
      strong.swings.forEach((s, i) => {
        if (s.damage < ident.swings[i].damage) fail(`foldWeaponAffix(${w.id}, ${affix.id}, ${EXTRA_AFFIX_POWER}): swing ${i} damage weakened (${s.damage} < ${ident.swings[i].damage})`)
      })
      if (ident.projectile && strong.projectile.damage < ident.projectile.damage) fail(`foldWeaponAffix(${w.id}, ${affix.id}): power-bumped projectile damage weakened`)
      if (strong.affixLifestealFrac < ident.affixLifestealFrac) fail(`foldWeaponAffix(${w.id}, ${affix.id}): power-bumped lifesteal weakened`)
      if (strong.status && ident.status && strong.status.tickDmg !== undefined && strong.status.tickDmg < (ident.status.tickDmg ?? 0)) {
        fail(`foldWeaponAffix(${w.id}, ${affix.id}): power-bumped status tickDmg weakened`)
      }
    }
  }

  // ── 15f) rollRarityId is deterministic + in-range, and depth biases toward higher rarity (a property pin,
  // not a tight numeric pin — KISS): over a fixed sample the legendary count at high depth >= at depth 0. ──
  const sampleRarity = (depth, seed) => {
    let s = seed >>> 0
    const rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s / 4294967296
    }
    let legendary = 0
    for (let i = 0; i < 4000; i++) {
      const id = rollRarityId(rng, depth)
      if (!RARITY_IDS.includes(id)) fail(`rollRarityId returned an unknown id "${id}"`)
      if (id === 'legendary') legendary++
    }
    return legendary
  }
  // Determinism: the SAME RNG seed + depth replays the same draw (a single draw equality check).
  {
    const mk = () => {
      let s = 0xc0ffee >>> 0
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 4294967296
      }
    }
    if (rollRarityId(mk(), 5) !== rollRarityId(mk(), 5)) fail('rollRarityId is not deterministic for the same RNG seed + depth')
  }
  if (sampleRarity(20, 0x1234) < sampleRarity(0, 0x1234)) fail('rollRarityId depth bias regressed (deeper depth must not yield FEWER legendaries)')
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 16) CURSE config + the curse-damage math (cursed-chests §6/§7, Decision 4/7/8/10, AC1/AC10).
//     An INDEPENDENT proof of the PURE curse table + the composing fold: CURSE is well-formed (a positive
//     INTEGER killsToClear, a damageMult >= 1), effectiveCurseMult is the EXACT identity at 0 stacks (the
//     byte-identity pin — _hurtPlayer is unchanged when uncursed) + clamps at/below 0, the curse mult is
//     monotone non-decreasing over [0..killsToClear] + every value >= 1 (never-weaken: a curse never makes
//     the player take LESS damage than baseline), the guaranteed loot tier resolves in RARITIES and is a
//     NON-common (guaranteed STRONG) tier, and LOOT_GOLD / CURSED_CHEST_CHANCE are sane.
//     Mirrors the §15 rarity / §14 colour sweeps — a malformed curse table fails loudly under node.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── 16a) CURSE well-formed: killsToClear a positive INTEGER, damageMult a number >= 1 ("greatly amplified"). ──
  if (!(typeof CURSE.killsToClear === 'number' && Number.isInteger(CURSE.killsToClear) && CURSE.killsToClear > 0)) {
    fail(`CURSE.killsToClear must be a positive integer, got ${CURSE.killsToClear}`)
  }
  if (!(typeof CURSE.damageMult === 'number' && CURSE.damageMult >= 1)) {
    fail(`CURSE.damageMult must be a number >= 1 (never-weaken), got ${CURSE.damageMult}`)
  }

  // ── 16b) effectiveCurseMult identity at 0 stacks (the byte-identity pin) + clamp at/below 0. ──
  if (effectiveCurseMult(0) !== 1) fail(`effectiveCurseMult(0) = ${effectiveCurseMult(0)}, expected EXACTLY 1 (the no-curse identity)`)
  if (effectiveCurseMult(-1) !== 1) fail(`effectiveCurseMult(-1) = ${effectiveCurseMult(-1)}, expected EXACTLY 1 (clamp at/below 0)`)

  // ── 16c) effectiveCurseMult monotone non-decreasing over [0..killsToClear], every value >= 1 (never-weaken:
  // a curse only ever makes the player take MORE damage than baseline, never less). ──
  let prevCurseMult = -Infinity
  for (let stacks = 0; stacks <= CURSE.killsToClear; stacks++) {
    const m = effectiveCurseMult(stacks)
    if (!(m >= 1)) fail(`effectiveCurseMult(${stacks}) = ${m} must be >= 1 (never-weaken)`)
    if (m < prevCurseMult) fail(`effectiveCurseMult dipped at ${stacks} stacks (${m} < ${prevCurseMult})`)
    prevCurseMult = m
  }
  // The fully-cursed mult must actually amplify (> the identity) — the curse must BITE (a property pin).
  if (!(effectiveCurseMult(CURSE.killsToClear) > 1)) {
    fail(`effectiveCurseMult(${CURSE.killsToClear}) must be > 1 (a full curse must amplify damage taken)`)
  }

  // ── 16d) Loot tier well-formed: LOOT_RARITY resolves in RARITIES AND is NOT 'common' (guaranteed STRONG
  // loot); LOOT_GOLD a number > 0; CURSED_CHEST_CHANCE a probability in (0, 1] (rare but possible). ──
  if (!RARITIES[LOOT_RARITY]) fail(`LOOT_RARITY "${LOOT_RARITY}" has no RARITIES entry (lookup drift)`)
  if (LOOT_RARITY === 'common') fail(`LOOT_RARITY must NOT be 'common' (the chest grants guaranteed STRONG loot)`)
  if (!(typeof LOOT_GOLD === 'number' && LOOT_GOLD > 0)) fail(`LOOT_GOLD must be a number > 0, got ${LOOT_GOLD}`)
  if (!(typeof CURSED_CHEST_CHANCE === 'number' && CURSED_CHEST_CHANCE > 0 && CURSED_CHEST_CHANCE <= 1)) {
    fail(`CURSED_CHEST_CHANCE must be a probability in (0, 1], got ${CURSED_CHEST_CHANCE}`)
  }
}

console.log(
  `verify-gen OK: rng deterministic+pinned; combat hitbox/damage pure+pinned; ` +
    `${N} seeds × ${Object.keys(BIOMES).length} biomes (full graph) → deterministic + bounds(AC28) + no-wall-spawn(AC28) + ` +
    `traversable(AC27) + body-clearance: 36×52 body fits every node + entrance→exit (body-aware BFS, AC1/AC2) + ` +
    `branch-treasure standable&reachable(AC67) + layout-template variety (${LAYOUT_TEMPLATES.length} shapes, round-2) + ` +
    `floor-recovery locality+reconnect+hazard-free-lane (cols≥${RECOVERY_MIN_COLS}); level pin OK; ` +
    `biome graph well-formed (acyclic + all-reachable + 1 boss terminal + ≥1 fork, F4); ` +
    `curve+tiers monotonic + EVERY-PATH whole-run monotonic & boss-terminating over ${ALL_PATHS.length} root→boss paths (AC2/AC42/AC43); default-path ${totalLevels} ` +
    `levels; seed chain deterministic (AC47); upgrades/weapons pure+well-formed + applyUpgrades ` +
    `identity/non-mutating/never-weaker (AC55); ${ENEMY_ARCHETYPES.length} enemy archetypes + per-biome ` +
    `pools (AC59); boss table well-formed + depth-scaling guardrail (AC56/AC61); ${WEAPON_ORDER.length} ` +
    `weapons (AC60); boss-arena branch deterministic + valid over ${N} seeds (AC57); ` +
    `${SHOP_ITEMS.length} shop items well-formed (AC63); ${BOSS_ORDER.length} bosses+minibosses well-formed (AC65, round-2 roster); ` +
    `status tick/expiry/refresh pure+pinned (${STATUS_KINDS.length} kinds, AC66); ` +
    `${SCROLLS.length} scrolls + ${ELITE_AFFIXES.length} elite affixes well-formed (round-3 build variety); ` +
    `${WEAPON_AFFIXES.length} weapon affixes pure-fold/schema-preserving/never-weaken (round-2 build engine); ` +
    `${SKILLS.length} skills well-formed (${SKILL_KINDS.length} kinds, AC7 — the loadout layer); ` +
    `${MUTATIONS.length} mutations well-formed + identity-safe/never-weaken (build-&-replay AC1/AC6); ` +
    `${BOSS_CELL_TIERS.length} boss-cell tiers (curve identity@t0 + whole-run monotonic ∀ tier, AC42/AC43) + ` +
    `${BLUEPRINTS.length} blueprints (catalog↔tags consistent + resolver identity@empty, AC11); ` +
    `${COLOR_IDS.length} colours (mult identity@0 + monotone, +HP@survival); every weapon+skill colour-tagged; ` +
    `${RARITY_IDS.length} rarity tiers (common identity + monotone damageMult, fold never-weaken + powerMult identity@1); ` +
    `+ curse config (identity at 0 stacks + monotone damage mult, strong loot tier)`,
)
process.exit(0)
