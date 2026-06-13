# Meta that Changes the NEXT Run (Boss-Cell Tiers + Blueprints)

## 1. Background

The meta-progression loop today (`src/core/MetaState.ts`, `src/util/save.ts`) is the
**permadeath seam**: a run banks Cells + `bestDepth` at run end (`GameScene._onBossDefeated`
GameScene.ts:883, `_onPlayerDeath`), the Hub (`src/scenes/HubScene.ts`) spends Cells on permanent
`UPGRADES` (config/upgrades.ts), and `MetaState.startStats()` folds the owned upgrades into a
starting-stats object the next run's Player + RunState seed from (`applyUpgrades` MetaState.ts:58,
consumed in GameScene.ts:252/261/361). This is a real run-to-run loop — but everything it changes is
**your character** (more HP, more damage, a flask). Nothing a cleared run unlocks changes **the world
the next run drops you into**.

Dead Cells' run-to-run compulsion has two engines this slice is missing:

1. **Boss Cells (difficulty tiers).** Clearing the game unlocks a higher difficulty: enemies are
   tankier/denser/affixed, healing is scarcer, and the reward (and the brag) scale. The existing
   difficulty machine is *exactly* the right substrate: `effectiveDifficulty(depth, biome)`
   (difficulty.ts:170) stacks the biome tier and the depth curve into ONE scalar the verifier proves
   monotone (verify-gen.mjs §4c, AC42/AC43), and `scaleAtDepth(depth)` (difficulty.ts:51) produces
   the per-spawn `enemyHpMult/enemyDamageMult/enemySpeedMult/enemyCountBonus` every `scaleSpec`
   (difficulty.ts:66) / `scaleBossSpec` (difficulty.ts:110) fold reads. A tier is a *global multiplier
   on that curve* — the cleanest possible insertion point.

2. **Blueprints (run-pool unlocks).** In Dead Cells you find a blueprint, "bank" it at the
   collector, and it permanently joins the drop pool for future runs. Our run pools are already pure
   data tables drawn from at fixed seams: weapons (`WEAPON_PICKUP_POOL` GameScene.ts:131 →
   `_maybePlaceWeaponPickup` GameScene.ts:1512), skills (`SKILLS` skills.ts:66 →
   `_maybePlaceSkillPickup` GameScene.ts:1305), mutations (`MUTATION_ORDER` mutations.ts:172 →
   `_pickMutationOffers` GameScene.ts:2108). Today *every* row in those tables is always available.
   Blueprints turn that into "a starter set is always available; the rest unlock permanently when
   banked" — so a cleared run literally changes which weapons/skills/mutations the *next* run can roll.

The architecture already gives us every seam: `MetaState` is the persistence wrapper (a factory over
`util/save.ts`'s defensive try/catch get/set, MetaState.ts:86), the Hub renders meta GENERICALLY off
data tables (HubScene.ts:101-119, no per-row UI code), the difficulty math is one pure scalar set the
verifier owns, and the three run pools are pure tables drawn from at named scene-side sites. The
identity contract is also already established and verifier-pinned: **a fresh meta folds to
`BASE_PLAYER_STATS` unchanged (AC53) and the whole-run difficulty is monotone (AC42/AC43)**. This
slice extends both without breaking either.

## 2. Requirements Summary

- **Boss-Cell difficulty TIERS.** A persistent `tier` (0..N) that scales the EXISTING difficulty
  curve globally:
  - **Unlock-on-clear.** Completing a run (boss defeated → `_onBossDefeated`) on tier `T` unlocks
    tier `T+1` (capped). Persisted in `MetaState`.
  - **Selected tier.** The player picks which UNLOCKED tier to run at; persisted in `MetaState` and
    surfaced + chosen in the Hub.
  - **Scales the curve, not a parallel system.** A tier applies a `bossCellMult` to the per-depth
    `scaleAtDepth` scalars (HP/damage/count) PLUS fewer flask charges. Tier 0 = `×1` = the round-1
    curve byte-for-byte.
- **BLUEPRINT unlocks.** Permanent run-pool additions banked at run end (like Cells):
  - **Drops.** A blueprint pickup can drop in-run; collected blueprint ids are held on `RunState`
    (run-only) and BANKED to `MetaState.blueprints` at run end via the same single `bankRun` writer.
  - **Gate the run pools.** Weapons/skills/mutations split into an ALWAYS-AVAILABLE starter set + a
    BLUEPRINT-GATED set. A run's draw pool = starters + the unlocked blueprints' rows.
  - **Hub shows unlocked vs locked.** The Hub lists every blueprint with its unlock state.
- **Together → the run-to-run loop.** A cleared run unlocks a harder tier AND (over runs) widens the
  loot pool, so the NEXT run is harder *and* has new toys — the genre's compulsion loop.
- **Identity (the hard constraint).** **Tier 0 + zero blueprints unlocked = the round-1 game
  exactly.** Every new MetaState field defaults so a fresh save behaves byte-identically; the
  `bossCellMult` at tier 0 is exactly `1` (the curve is unchanged); the gated pools fall back to the
  CURRENT full tables' starter subset such that a default save still rolls from the same rows it does
  today (see Decision 6 for the precise "what is a starter" choice that keeps this true).
- **Persistence stays graceful.** `MetaState` continues to never throw (save.ts try/catch); new
  fields back-fill from `DEFAULT_META` for pre-existing saves (the established `loadMeta` spread
  pattern, save.ts:49).
- **Verifier owns the new contracts.** New sweeps for the tier table + blueprint tables; the existing
  whole-run monotonicity proof (§4c, AC42/AC43) is EXTENDED to assert it still holds **at every
  tier** (a `bossCellMult ≥ 1` keeps `effectiveDifficulty` non-decreasing across the run).
- **Do NOT modify `src/world/LevelGenerator.ts`.** The tier touches the per-spawn SCALE (scene-side),
  not level geometry; the blueprint drop is sourced scene-side off the level seed (the established
  off-the-pin discipline) so the level pin is untouched.
- **Non-goals (YAGNI).** No per-tier unique affixes/enemies (a tier is a SCALAR on the existing
  curve, not new content — KISS); no blueprint *cost* (banking is the unlock, like a Cell — no Cell
  price gate this slice); no fragment/partial-blueprint crafting; no blueprint for permanent UPGRADES
  (blueprints gate the RUN pools — weapons/skills/mutations — not the meta `UPGRADES` tree); no
  per-biome tier overrides (one run-global tier); no negative tiers / handicaps.

## 3. Acceptance Criteria

1. **`src/config/tiers.ts` (NEW, PURE) — the Boss-Cell tier table.** A pure data module (NO Phaser
   import — node-importable) exporting `BOSS_CELL_TIERS: BossCellTier[]` and `TIERS_BY_INDEX` /
   helpers. Each tier row: `{ index, name, bossCellMult, flaskDelta, desc }`. Tier 0 is the identity
   row (`bossCellMult: 1`, `flaskDelta: 0`). `bossCellMult` is MONOTONE non-decreasing in `index` and
   always `≥ 1`; `flaskDelta` is MONOTONE non-increasing (deeper tiers never give MORE flasks). The
   verifier sweeps these.
2. **`src/config/difficulty.ts` (PURE) — tier-scaled curve.** A new pure function
   `scaleAtDepthTiered(depth, bossCellMult)` (or `scaleAtDepth(depth, bossCellMult = 1)` with a
   default arg — see Decision 2) returns the SAME `DepthScale` shape with `enemyHpMult`,
   `enemyDamageMult`, `enemySpeedMult` (capped), and `enemyCountBonus` scaled by `bossCellMult`.
   **`bossCellMult === 1` returns byte-identical scalars to today's `scaleAtDepth(depth)`** (the
   identity). `effectiveDifficulty(depth, biome, bossCellMult = 1)` folds the tier in; with
   `bossCellMult = 1` it returns today's value exactly. Both stay PURE (no Phaser).
3. **Whole-run monotonicity holds at EVERY tier (AC42/AC43 preserved + extended).** verify-gen.mjs
   §4c walks the EXACT `RunState.advance()` chain for the full run AND for EVERY tier in
   `BOSS_CELL_TIERS`, asserting `effectiveDifficulty(depth, biome, tier.bossCellMult)` is
   non-decreasing across the entire run at each tier. A new assertion also proves the tier is a
   NON-WEAKENING global lift: at every depth, the tiered scalars are `≥` the tier-0 scalars (a higher
   tier never makes the game easier). The existing tier-0 walk is UNCHANGED.
4. **`src/util/save.ts` — extended `MetaState` shape, graceful.** `MetaState` gains
   `unlockedTier: number`, `selectedTier: number`, `blueprints: string[]`. `DEFAULT_META` seeds
   `unlockedTier: 0, selectedTier: 0, blueprints: []`. `loadMeta` back-fills these for pre-existing
   saves via the existing spread (a pre-slice save loads tier 0 / no blueprints = the identity). The
   try/catch graceful-degrade is untouched (still never throws).
5. **`src/core/MetaState.ts` (PURE w.r.t. Phaser) — tier + blueprint API.** New methods on
   `MetaStateInstance`: `getUnlockedTier()`, `getSelectedTier()`, `setSelectedTier(i)` (clamped to
   `0..unlockedTier`, saves), `getBlueprints()`, `isBlueprintUnlocked(id)`. `bankRun` is extended to
   ALSO (a) raise `unlockedTier` when a run COMPLETED at the current selected tier
   (`unlockedTier = max(unlockedTier, min(selectedTier + 1, MAX_TIER))`), and (b) merge banked
   blueprint ids into `MetaState.blueprints` (set-union, dedup). `startTier()` returns the selected
   tier's row (clamped to unlocked). All pure (imports only save.ts + pure configs — node-importable;
   the verifier imports `applyUpgrades`/`BASE_PLAYER_STATS` today, this keeps that working).
6. **Run pools split into starters + blueprint-gated rows; the run draws starters ∪ unlocked.** The
   three pure pool tables (`config/weapons.ts`, `config/skills.ts`, `config/mutations.ts`) each tag
   rows as starter vs blueprint-gated. A pure resolver per table — e.g.
   `runWeaponPool(unlocked)` / `runSkillPool(unlocked)` / `runMutationPool(unlocked)` — returns the
   rows available given the unlocked-blueprint set: ALWAYS the starters, PLUS any gated row whose id
   is unlocked. **With an empty unlocked set the resolver returns exactly the starter rows, which are
   chosen so a default save rolls from the SAME rows it does today (Decision 6).** The resolvers are
   PURE (node-importable) and verifier-swept.
7. **GameScene draws from the resolved pools (no generator change).** `_maybePlaceWeaponPickup`,
   `_maybePlaceSkillPickup`, and `_pickMutationOffers` draw from the per-run resolved pools computed
   ONCE in `create()` from `meta.getBlueprints()` (stored on a scene field, mirroring `runState`).
   The off-the-pin level-seed RNG discipline is unchanged (the level pin stays intact). A run with no
   blueprints unlocked draws from the identical set as today.
8. **Tier applied to the live run.** `create()` reads `meta.startTier()`; the run stores its
   `bossCellMult` (on `RunState` as a run-only scalar seeded from the tier) and the scene passes it to
   every `scaleAtDepth`/`scaleBossSpec`/`effectiveDifficulty` call site (the enemy spawn loop
   GameScene.ts:564, the boss/miniboss builds GameScene.ts:719/804). The tier's `flaskDelta` adjusts
   the run's starting `maxFlasks/flasks` (clamped `≥` a floor of 1 so a run is never unwinnable —
   Decision 4). Tier 0 ⇒ `bossCellMult 1` + `flaskDelta 0` ⇒ byte-identical to today.
9. **Blueprint drops banked via the single writer.** A new `'blueprint'` pickup kind (Pickup.ts
   `PickupKind` + `PICKUP_COLORS`) carrying a `blueprintId`. A sparse `_maybePlaceBlueprintPickup`
   (off the level seed, off-the-pin — the weapon-pickup discipline) places ONE locked-blueprint drop
   when any remain locked. Collecting it (`_onPickup` `case 'blueprint'`) records the id on
   `runState.blueprints` (run-only). `bankRun` merges `runState.blueprints` into the meta at run end
   (BOTH the death and boss-clear paths — the existing single `bankRun` writer, GameScene.ts:883 and
   the death path). Like Cells, blueprints are only PERMANENT once banked; dropping them on death
   before reaching the run end means they are lost (Decision 7 — they bank on BOTH paths, so a death
   still banks what you carried).
10. **Hub shows + selects tier; lists blueprints.** `HubScene` gains (a) a TIER row showing
    `selectedTier / unlockedTier` that Left/Right (or Buy-to-cycle) changes within `0..unlockedTier`
    (saved via `setSelectedTier`); and (b) a BLUEPRINTS section listing each blueprint id with
    `UNLOCKED`/`LOCKED`. Rendered GENERICALLY off the tables (no per-row code), consistent with the
    existing upgrade-row rendering. The header still reads Cells + best depth.
11. **Identity (the hard constraint).** With a fresh/default save (tier 0, no blueprints): the curve
    scalars, the whole-run `effectiveDifficulty`, the run pools drawn, the flask count, and the
    Player start stats are ALL byte-identical to the pre-slice game. The level regression pin and
    `LevelGenerator.ts` are untouched. `npm run typecheck` and `npm run verify` both pass.

## 4. Problem Analysis

- **Where does the tier multiplier belong in the difficulty math?** Candidates:
  - **A — a new parallel "tier scale" object** stacked next to `DepthScale`. Rejected (YAGNI): it
    duplicates the four scalars and forces every fold site to combine two objects. The verifier's
    monotonicity proof reads ONE scalar set today.
  - **B — multiply the tier INTO `scaleAtDepth`'s output** via an optional `bossCellMult` arg
    (default 1). Chosen. `scaleAtDepth(depth, mult=1)` returns the same `DepthScale` with each ramp
    multiplied by `mult`. Because `mult ≥ 1` and the per-depth ramps are already non-decreasing, the
    product is still non-decreasing in depth (monotonicity is preserved BY CONSTRUCTION), and
    `mult = 1` is the exact identity. `scaleSpec`/`scaleBossSpec` are UNCHANGED (they read a
    `DepthScale`; they don't care how it was built). `effectiveDifficulty(depth, biome, mult=1)`
    folds the tier into the curve term so the whole-run walk reads it.
  - **The speed cap subtlety.** `enemySpeedMult` is clamped at `SPEED_CAP` (difficulty.ts:36). A tier
    multiplies BEFORE the clamp, then re-clamps: `min(SPEED_CAP, (1 + SPEED_PER_DEPTH·d)·mult)`. This
    keeps "non-decreasing in depth" AND "non-decreasing in tier" (a bigger mult can only raise the
    pre-clamp value; the clamp is a non-decreasing function). Keeping the cap means a high tier
    doesn't produce an unreadable enemy speed — readability is preserved (the same philosophy as the
    base curve's cap, difficulty.ts:42-47).
- **Does multiplying the count bonus break the spawn cap?** `enemyCountBonus` is already capped at
  spawn time to the biome's standable surplus (`Math.min(scale.enemyCountBonus + roomExtra, …)`
  GameScene.ts:589). A tiered (larger) `enemyCountBonus` simply pushes harder against that same cap —
  no generator change, no new geometry. The verifier's monotonicity proof reads
  `effectiveDifficulty` (HP + damage curve terms), not the count, so the count multiply needs no new
  monotonicity assertion beyond "non-decreasing in depth" which `floor(d/COUNT_EVERY · mult)`
  preserves for `mult ≥ 1`.
- **Where do the tier unlock + blueprint bank happen?** The SINGLE `bankRun` writer
  (MetaState.ts:124, called once per run under the `gameOver` guard at GameScene.ts:883 and the death
  path) is the established run-end seam. Both new permanent state changes (tier unlock on a COMPLETED
  run, blueprint merge) belong there — one writer, one save, no double-bank (the guard already
  prevents a same-frame double-fire). The tier only RAISES `unlockedTier` on a *completed* run
  (`completed` is already threaded into the run-end path: `summary(now, completed, …)`
  RunState.ts:270, and `_onBossDefeated` is the completion edge); a death does not unlock a tier. To
  keep `bankRun` pure + decoupled it takes the new data as args (`{ cells, depth, blueprints,
  completedAtTier }`), exactly like it takes `{ cells, depth }` today.
- **What is a "starter" vs a "blueprint" row — without breaking identity?** This is the load-bearing
  identity question. Today ALL rows are always available. If we gate some EXISTING rows behind
  blueprints, a default save would roll from FEWER rows than today — an identity REGRESSION. Three
  options:
  - **A — gate some existing rows.** Rejected: breaks the identity contract (a fresh save would lose
    access to weapons/skills/mutations it has today).
  - **B — all existing rows are starters; blueprints are NEW rows added in this slice.** Chosen for
    the identity guarantee (a default save's pool = today's pool exactly), but it requires shipping
    new content rows to have anything to unlock.
  - **C — designate a small starter SUBSET = the rows that ship in round 1, and treat
    everything-added-since as blueprint-gated, but with a one-time DEFAULT-UNLOCK back-fill so
    existing saves keep what they had.** Rejected (over-engineered): a back-fill migration is YAGNI
    and risks subtle save-state bugs.
  - **Decision (Decision 6): B.** Every CURRENT row in weapons/skills/mutations is a STARTER (always
    available). Blueprints gate a small set of NEW rows added in THIS slice. A default save's run pool
    = the current rows exactly = the identity. The new rows are dead config until banked. This keeps
    the identity contract trivially true and the verifier can assert it (the empty-unlocked resolver
    returns exactly the starter set, and the starter set === the pre-slice tables by construction).
- **How does a blueprint drop avoid perturbing the level pin?** Same as every other scene-side drop
  (weapon/skill/shop/branch): a fresh `mulberry32` off `desc.seed ^ <distinct mix>`, NOT the
  generator's pinned draw thread (GameScene.ts:1306/1513/1535). The generator emits only cell/gold
  pickups; everything else is sourced scene-side. No `LevelGenerator.ts` change.
- **Flask floor.** `flaskDelta` is negative at high tiers (fewer heals — the genre's "Boss Cells
  reduce healing"). It must clamp so a run keeps `≥ 1` flask charge (Decision 4) — a run with zero
  heals across a long descent is a degenerate difficulty, not a fun one, and the constraint says
  "fewer heal charges", not "no heals". The clamp lives where the run seeds flasks.

## 5. Decision Log

**1. A tier is a SCALAR multiplier on the existing curve, not new content.**
- Options: A) per-tier new affixes/enemies/mechanics · B) a global `bossCellMult` on the
  `scaleAtDepth` ramps + a `flaskDelta`.
- Decision: **B** (KISS/YAGNI). The constraint says a tier "scales the EXISTING difficulty curve".
  A multiplier reuses the entire `scaleAtDepth`/`scaleSpec`/`scaleBossSpec`/`effectiveDifficulty`
  machine with one extra arg, preserves the verifier's monotonicity proof by construction
  (`mult ≥ 1` × a non-decreasing ramp is non-decreasing), and is the exact identity at tier 0. New
  per-tier content is a future slice's job. The "more affixes" the spec mentions is delivered
  *cheaply*: the existing elite-affix roll (`_rollEliteForRoom`) already exists — Decision 8 adds an
  OPTIONAL per-tier elite-chance lift to the tier row IF we want it, but the MVP tier is HP/damage/
  count + flask only (the elite lift is gated behind a tier-row field that defaults to neutral, so it
  stays identity-safe and YAGNI-cuttable).

**2. `scaleAtDepth` gains an optional `bossCellMult = 1` arg (default = identity).**
- Options: A) a NEW `scaleAtDepthTiered(depth, mult)` function · B) a default arg on `scaleAtDepth`.
- Decision: **B**. A default arg keeps ONE function (DRY), and every EXISTING caller
  (`scaleAtDepth(depth)`) is byte-identical because the default is 1. The verifier's existing tier-0
  walk calls `scaleAtDepth(depth)` unchanged. `effectiveDifficulty` likewise gains
  `bossCellMult = 1`. The risk (a caller forgetting to pass the tier) is contained: GameScene has a
  single run-scoped `bossCellMult` field it threads to all three fold sites, and the verifier proves
  the tiered walk monotone separately from the tier-0 walk.

**3. Tier unlock + blueprint bank go through the SINGLE `bankRun` writer.**
- Decision: extend `bankRun({ cells, depth })` → `bankRun({ cells, depth, blueprints,
  completedAtTier })`. On a COMPLETED run (`completedAtTier != null`), raise
  `unlockedTier = max(unlockedTier, min(completedAtTier + 1, MAX_TIER))`. Always merge
  `blueprints` (set-union) into `meta.blueprints`. One save, one writer (the `gameOver` guard already
  prevents a double-fire). A death passes `completedAtTier: null` (no tier unlock) but STILL banks
  carried blueprints (Decision 7). This mirrors how `bankRun` already takes run data as args to stay
  decoupled + node-constructible.

**4. `flaskDelta` is negative at high tiers, clamped to a `≥ 1` floor.**
- Options: A) no clamp (a tier could reach 0 flasks) · B) clamp the run's `maxFlasks` to `≥ 1`.
- Decision: **B**. "Fewer heal charges" is the genre feel; "zero heals on a 12-room descent" is a
  degenerate wall, not difficulty. The clamp lives at the run-seed site (where `maxFlasks` is set
  from `startStats.maxFlasks + tier.flaskDelta`). The verifier asserts `flaskDelta` is monotone
  non-increasing across tiers (deeper never gives MORE), and that base `maxFlasks + flaskDelta` of
  the deepest tier is still `≥ 1` for the shipped tier table (so the table is sane by construction).

**5. New MetaState fields default to the identity; pre-existing saves back-fill.**
- Decision: `DEFAULT_META` gains `unlockedTier: 0, selectedTier: 0, blueprints: []`. `loadMeta`'s
  spread (`{ ...DEFAULT_META, ...stored }`, save.ts:51) back-fills them for any older save — the
  SAME mechanism `bestDepth` relies on (save.ts:44-47). A pre-slice save loads tier 0 / no
  blueprints = the identity. `selectedTier` is always re-clamped to `0..unlockedTier` on read
  (a corrupt save with `selectedTier > unlockedTier` degrades to a valid run, never crashes).

**6. Every current pool row is a STARTER; blueprints gate NEW rows added this slice.**
- (Full analysis in §4.) Decision: **B** from §4. This makes the identity contract trivially true
  (a default save's run pool === the pre-slice tables) and verifier-assertable (the empty-unlocked
  resolver returns exactly the starter rows). We ship a small set of new blueprint-gated rows so the
  unlock has content: e.g. one new weapon, one new skill, one new mutation, each tagged
  `blueprint: '<id>'`. The starter rows carry no blueprint tag (or `blueprint: null`).

**7. Blueprints bank on BOTH run-end paths (death + clear); carried-but-unbanked are lost.**
- Options: A) blueprints unlock the instant you touch the pickup (no banking) · B) blueprints are
  run-only until banked at run end, banked on BOTH paths.
- Decision: **B**. The constraint says blueprints are "banked at run end (like cells)". Cells are
  run-only (`runState.cells`) until `bankRun` (MetaState.ts:122-129). Blueprints mirror this exactly:
  carried on `runState.blueprints`, merged at run end. Banking on the DEATH path too (not just
  boss-clear) means a death still banks what you collected this run — generous but consistent with
  Cells, which also bank on death. (If a stricter "lose-on-death" feel is wanted later, it's a
  one-line change to the death path's `bankRun` call to omit `blueprints`.) The tier unlock is
  stricter (clear-only) because that is the explicit spec ("clearing a run unlocks a higher tier").

**8. The "more affixes" tier knob is an OPTIONAL, identity-neutral tier-row field (cut for MVP).**
- Decision: the tier row MAY carry an `eliteChanceMult` (default 1) that GameScene multiplies into
  the elite-affix roll chance. It defaults to 1 (identity) on tier 0 and the MVP tiers can leave it
  1 (HP/damage/count/flask is enough difficulty texture). Shipping it as a defaulted field means a
  later balance pass can turn it on per-tier with zero new wiring, while the MVP stays minimal. The
  verifier asserts it is `≥ 1` and monotone IF present. (KISS: implement the field + the multiply;
  set it to 1 on the shipped tiers — so it is wired but neutral, avoiding a future engine change.)

**9. The Hub renders tier + blueprints GENERICALLY off the tables (no per-row UI code).**
- Decision: a TIER row (Left/Right cycles selected within `0..unlockedTier`, or Buy-cycles) + a
  BLUEPRINTS list (one text row per blueprint id, colored by unlock state) follow the EXACT
  pattern of the existing generic upgrade rows (HubScene.ts:101-119, `_render` HubScene.ts:185). No
  per-tier or per-blueprint bespoke code. The cursor/row-count math extends the existing
  `seedRowIndex/startRowIndex` synthetic-row scheme (HubScene.ts:74-77).

**10. Tier scales the per-spawn fold AND the boss fold; one run-scoped `bossCellMult`.**
- Decision: GameScene stores `this.bossCellMult` (from `meta.startTier().bossCellMult`) in
  `create()` and threads it to the three fold sites: the enemy spawn `scaleAtDepth(depth)`
  (GameScene.ts:564) → `scaleAtDepth(depth, this.bossCellMult)`; the miniboss/boss builds
  `scaleBossSpec(spec, scaleAtDepth(depth))` (GameScene.ts:719/804) →
  `scaleBossSpec(spec, scaleAtDepth(depth, this.bossCellMult))`. `scaleSpec`/`scaleBossSpec` are
  UNCHANGED. This keeps the tier a SCALE on the curve, not a parallel system — so the boss is
  tankier + hits harder at a high tier exactly as the curve already makes a deep boss tankier (the
  `scaleBossSpec` HONEST-scope note, difficulty.ts:104-109, still holds — the tier just feeds a
  bigger `DepthScale`).

## 6. Design

All edits are code-level and named. PURE modules (`save.ts`, `MetaState.ts`, `difficulty.ts`,
`tiers.ts`, `weapons.ts`, `skills.ts`, `mutations.ts`) gain Phaser-free fields/data only.
`LevelGenerator.ts` is untouched.

### 6.1 `src/config/tiers.ts` (NEW, PURE) — the Boss-Cell tier table

A new pure data module (mirrors `config/difficulty.ts`'s "pure, node-importable, monotone by
construction" discipline):

```ts
export interface BossCellTier {
  index: number          // 0-based tier index (0 = the identity / round-1 difficulty).
  name: string           // human label the Hub shows (e.g. '0 BC', '1 Boss Cell').
  bossCellMult: number   // ×scaleAtDepth ramps (HP/damage/speed-pre-cap/count). >= 1; monotone non-decreasing.
  flaskDelta: number     // +/- starting flask charges. <= 0 at higher tiers; monotone non-increasing.
  eliteChanceMult: number // ×elite-affix roll chance (Decision 8). >= 1; monotone non-decreasing. 1 on MVP tiers.
  desc: string           // a one-line Hub summary of what changes.
}

export const BOSS_CELL_TIERS: BossCellTier[] = [
  { index: 0, name: '0 Boss Cells', bossCellMult: 1.0,  flaskDelta: 0,  eliteChanceMult: 1, desc: 'Base difficulty.' },
  { index: 1, name: '1 Boss Cell',  bossCellMult: 1.25, flaskDelta: -1, eliteChanceMult: 1, desc: 'Tougher, denser enemies; one fewer flask.' },
  { index: 2, name: '2 Boss Cells', bossCellMult: 1.55, flaskDelta: -1, eliteChanceMult: 1, desc: 'Far tougher; one fewer flask.' },
]
export const MAX_TIER = BOSS_CELL_TIERS.length - 1
export const TIERS_BY_INDEX = BOSS_CELL_TIERS // index === array position (asserted at module load).
export function tierAt(index: number): BossCellTier {
  return BOSS_CELL_TIERS[Math.max(0, Math.min(index | 0, MAX_TIER))] // clamp — a corrupt index degrades.
}
```

- Tier 0 is the EXACT identity row (`bossCellMult 1`, `flaskDelta 0`, `eliteChanceMult 1`).
- A module-load assertion (mirroring difficulty.ts:158) checks `index === position`,
  `bossCellMult` monotone non-decreasing + `≥ 1`, `flaskDelta` monotone non-increasing,
  `eliteChanceMult` monotone non-decreasing + `≥ 1` — so a re-tune that breaks the contract throws on
  import (caught by the verifier's node import AND any browser load).

### 6.2 `src/config/difficulty.ts` (PURE) — tier-scaled curve

- `scaleAtDepth(depth, bossCellMult = 1)`:
  ```ts
  export function scaleAtDepth(depth: number, bossCellMult = 1): DepthScale {
    const d = Math.max(0, depth | 0)
    const m = bossCellMult >= 1 ? bossCellMult : 1 // defensive: a tier never weakens the curve.
    return {
      enemyHpMult: (1 + HP_PER_DEPTH * d) * m,
      enemyDamageMult: (1 + DMG_PER_DEPTH * d) * m,
      enemySpeedMult: Math.min(SPEED_CAP, (1 + SPEED_PER_DEPTH * d) * m), // multiply BEFORE the clamp.
      enemyCountBonus: Math.floor((d / COUNT_EVERY) * m), // floor keeps it an int; m>=1 only adds.
    }
  }
  ```
  `bossCellMult === 1` ⇒ byte-identical to today (the identity). Monotone in depth preserved
  (`m ≥ 1` × non-decreasing ramp). Monotone in tier preserved (bigger `m` ⇒ each scalar `≥`).
- `effectiveDifficulty(depth, biome, bossCellMult = 1)`:
  ```ts
  export function effectiveDifficulty(depth: number, biome: BiomeConfig, bossCellMult = 1): number {
    return biome.difficultyTier * TIER_WEIGHT + _curveTerm(depth, bossCellMult)
  }
  ```
  where `_curveTerm(depth, m)` reads the tiered `scaleAtDepth(depth, m)` (`enemyHpMult +
  enemyDamageMult`). With `m = 1` it returns today's value exactly. The `TIER_WEIGHT` lower-bound
  derivation (difficulty.ts:145-163) is UNCHANGED: the biome-tier term doesn't depend on
  `bossCellMult`, and within a run `bossCellMult` is CONSTANT (run-global), so the curve term stays
  non-decreasing across a biome boundary for any fixed tier (the existing proof generalizes — see
  §7).
- `scaleSpec`/`scaleBossSpec` are UNCHANGED (they consume a `DepthScale`).

### 6.3 `src/util/save.ts` (PURE) — extended MetaState shape

```ts
export interface MetaState {
  cells: number
  upgrades: Record<string, number>
  bestDepth: number
  unlockedTier: number      // highest tier ever unlocked (0 = base; raised on a completed run).
  selectedTier: number      // the tier the next run launches at (clamped 0..unlockedTier).
  blueprints: string[]      // permanently-unlocked blueprint ids (run pools draw from starters ∪ these).
}
export const DEFAULT_META: Readonly<MetaState> = Object.freeze({
  cells: 0, upgrades: {}, bestDepth: 0, unlockedTier: 0, selectedTier: 0, blueprints: [],
})
```

`loadMeta` is UNCHANGED in code — its `{ ...DEFAULT_META, ...stored }` spread back-fills the three
new keys for any pre-slice save (the established pattern; save.ts:49-54). `saveMeta` unchanged. The
try/catch graceful-degrade is untouched.

### 6.4 `src/core/MetaState.ts` (PURE w.r.t. Phaser) — tier + blueprint API

- Import `tierAt`, `MAX_TIER`, `BOSS_CELL_TIERS` from `../config/tiers.js` (pure).
- `MetaStateInstance` gains:
  ```ts
  getUnlockedTier(): number
  getSelectedTier(): number
  setSelectedTier(i: number): void   // clamp 0..unlockedTier, save.
  getBlueprints(): string[]
  isBlueprintUnlocked(id: string): boolean
  startTier(): BossCellTier           // tierAt(min(selectedTier, unlockedTier)).
  ```
- `bankRun` is extended (Decision 3):
  ```ts
  bankRun({ cells = 0, depth = 0, blueprints = [], completedAtTier = null }: {
    cells?: number; depth?: number; blueprints?: string[]; completedAtTier?: number | null
  } = {}) {
    meta.cells += cells
    meta.bestDepth = Math.max(meta.bestDepth || 0, depth)
    // Merge banked blueprints (set-union, dedup).
    for (const id of blueprints) if (!meta.blueprints.includes(id)) meta.blueprints.push(id)
    // Unlock the next tier ONLY on a completed run at the run's tier.
    if (completedAtTier != null) {
      meta.unlockedTier = Math.max(meta.unlockedTier || 0, Math.min(completedAtTier + 1, MAX_TIER))
    }
    saveMeta(meta)
    return meta.cells
  }
  ```
- `getSelectedTier()` returns `Math.min(meta.selectedTier || 0, meta.unlockedTier || 0)` (always
  valid). `setSelectedTier(i)` clamps to `0..unlockedTier` then saves.
- Stays node-importable (imports only save.ts + pure configs). The verifier already imports
  `applyUpgrades`/`BASE_PLAYER_STATS` from here — the new pure-config import keeps that working
  (tiers.ts is Phaser-free).

### 6.5 `src/config/{weapons,skills,mutations}.ts` (PURE) — starter/blueprint tagging + resolvers

Each table's row interface gains an OPTIONAL `blueprint?: string` (absent/`undefined` ⇒ a STARTER,
always available; a non-empty id ⇒ gated behind that blueprint unlock). All CURRENT rows stay
starters (no tag) ⇒ identity (Decision 6). A few NEW rows are shipped tagged:

- `config/weapons.ts`: a new `WeaponSpec` row tagged `blueprint: 'bp_weapon_<id>'`, added to
  `WEAPON_ORDER`/`WEAPONS`. The `WEAPON_PICKUP_POOL` in GameScene is REPLACED by a pure resolver:
  ```ts
  export function runWeaponPool(unlocked: ReadonlySet<string>): string[] {
    return WEAPON_ORDER.filter((w) => !w.blueprint || unlocked.has(w.blueprint)).map((w) => w.id)
  }
  ```
- `config/skills.ts`: a new `SkillSpec` row tagged `blueprint: 'bp_skill_<id>'`. Resolver:
  ```ts
  export function runSkillPool(unlocked: ReadonlySet<string>): SkillSpec[] {
    return SKILLS.filter((s) => !s.blueprint || unlocked.has(s.blueprint))
  }
  ```
- `config/mutations.ts`: a new `MutationSpec` row tagged `blueprint: 'bp_mutation_<id>'`. Resolver:
  ```ts
  export function runMutationPool(unlocked: ReadonlySet<string>): MutationSpec[] {
    return MUTATION_ORDER.filter((m) => !m.blueprint || unlocked.has(m.blueprint))
  }
  ```
- A SINGLE source of all blueprint ids for the Hub + the drop placement:
  ```ts
  // config/blueprints.ts (NEW, PURE) — the catalog the Hub lists + the drop picks a locked id from.
  export interface BlueprintEntry { id: string; name: string; kind: 'weapon'|'skill'|'mutation'; desc: string }
  export const BLUEPRINTS: BlueprintEntry[] = [ /* one per new gated row, ids matching the table tags */ ]
  export const BLUEPRINTS_BY_ID: Record<string, BlueprintEntry> = Object.fromEntries(BLUEPRINTS.map((b) => [b.id, b]))
  ```
  (Keeping the catalog in its OWN pure module avoids a circular import between the three pool tables
  and keeps the Hub/drop reading ONE list — DRY.)

With an empty unlocked set every resolver returns exactly the starter rows = today's tables = the
identity (verifier-asserted, §7).

### 6.6 `src/core/RunState.ts` (PURE) — two run-only fields

Add to the `RunState` interface + the `createRunState` returned object, seeded to the identity:

```ts
bossCellMult: number   // the run's Boss-Cell tier multiplier (seeded from the tier; 1 = tier 0 identity).
blueprints: string[]   // blueprint ids collected THIS run (run-only — banked at run end via bankRun).
```

`createRunState(startSeed, startedAt, startStats, bossCellMult = 1)` gains an optional
`bossCellMult` arg (default 1 — the verifier constructs `createRunState(0xc0ffee)` with NO tier, so
its determinism + monotonicity walks are unaffected). The run's `maxFlasks`/`flasks` are seeded with
the tier's `flaskDelta` applied + clamped (Decision 4) — but to keep RunState PURE of the tier table,
GameScene computes the final flask count and passes the already-folded `maxFlasks` via `startStats`
(the cleanest seam: `startStats.maxFlasks` is ALREADY where the run reads flasks, RunState.ts:152) —
see §6.7. So RunState only needs `bossCellMult` (read by the scene's fold sites) + `blueprints` (the
run-only collection); the flask math is folded into `startStats` upstream. Identity: a fresh run with
no tier gets `bossCellMult 1` + the unchanged `startStats.maxFlasks` = today.

### 6.7 `src/scenes/GameScene.ts` — wire the tier + the blueprint drop/draw

- **`create()`** (near GameScene.ts:251-261):
  - `const tier = this.meta.startTier()` ; `this.bossCellMult = tier.bossCellMult`.
  - Fold `flaskDelta` into the start stats BEFORE constructing the run/player:
    `startStats.maxFlasks = Math.max(1, startStats.maxFlasks + tier.flaskDelta)` (the `≥ 1` floor,
    Decision 4) — `applyStartStats`/`createRunState` then seed flasks from the folded value (no new
    flask wiring; `startStats` is the existing seam). NOTE: `startStats` is a fresh object from
    `applyUpgrades` (a clone, MetaState.ts:59), so mutating it here is safe (it never touches
    `BASE_PLAYER_STATS`).
  - `this.runState = createRunState(this.runSeed, this.time.now, startStats, this.bossCellMult)`.
  - `this.unlockedBlueprints = new Set(this.meta.getBlueprints())` ; compute the per-run pools ONCE:
    `this.weaponPool = runWeaponPool(this.unlockedBlueprints)` (replaces the const
    `WEAPON_PICKUP_POOL`), `this.skillPool = runSkillPool(...)`, `this.mutationPool =
    runMutationPool(...)`.
- **Enemy spawn loop** (GameScene.ts:564): `const scale = scaleAtDepth(this.runState.depth,
  this.bossCellMult)`. (The two spawn loops at 564-595 both read `scale`.)
- **Miniboss/boss builds** (GameScene.ts:719/804): `scaleBossSpec(spec, scaleAtDepth(depth,
  this.bossCellMult))`.
- **Elite roll** (Decision 8): multiply the elite-roll chance by `tier.eliteChanceMult` in
  `_rollEliteForRoom` (MVP tiers leave it 1 ⇒ identity).
- **`_maybePlaceWeaponPickup`** (GameScene.ts:1512): draw from `this.weaponPool` instead of the
  const `WEAPON_PICKUP_POOL` (same off-the-pin RNG, same filter-out-equipped logic).
- **`_maybePlaceSkillPickup`** (GameScene.ts:1305): draw `skillId` from `this.skillPool` instead of
  the full `SKILLS`.
- **`_pickMutationOffers`** (GameScene.ts:2108): shuffle a COPY of `this.mutationPool` instead of
  `MUTATION_ORDER`.
- **Blueprint drop** — a new sparse placement (off the level seed, off-the-pin; mirrors
  `_maybePlaceWeaponPickup`):
  ```ts
  const BLUEPRINT_PICKUP_CHANCE = 0.18 // rare — a blueprint is a special find.
  _maybePlaceBlueprintPickup(desc: LevelDescription): void {
    // Only locked blueprints are worth dropping (don't re-drop an already-unlocked / already-carried id).
    const locked = BLUEPRINTS.filter((b) => !this.unlockedBlueprints.has(b.id) && !this.runState.blueprints.includes(b.id))
    if (locked.length === 0) return
    const rng = mulberry32((desc.seed ^ 0xb1ce9111) >>> 0) // distinct mix from weapon/skill/shop/branch RNGs.
    if (rng() >= BLUEPRINT_PICKUP_CHANCE) return
    const bp = locked[Math.floor(rng() * locked.length)]
    const spot = desc.pickups[0] || { x: (desc.entrance.x + desc.exit.x) / 2, y: desc.entrance.y }
    this.pickupPool.acquire(spot.x, spot.y - TILE_SIZE, 'blueprint', { blueprintId: bp.id })
  }
  ```
  Called from `_buildLevel` alongside the other sparse placements (GameScene.ts:608-624).
- **`_onPickup`** (GameScene.ts:1866) — new arm:
  ```ts
  case 'blueprint':
    if (pk.blueprintId && !this.runState.blueprints.includes(pk.blueprintId)) {
      this.runState.blueprints.push(pk.blueprintId) // run-only — banked at run end via bankRun.
    }
    break
  ```
- **Bank the run** — extend BOTH `bankRun` call sites:
  - `_onBossDefeated` (GameScene.ts:883): `this.meta.bankRun({ cells: this.runState.cells, depth:
    this.runState.depth, blueprints: this.runState.blueprints, completedAtTier:
    this.meta.getSelectedTier() })` — a COMPLETED run unlocks the next tier.
  - The death path (`_onPlayerDeath`): `this.meta.bankRun({ cells, depth, blueprints:
    this.runState.blueprints })` — `completedAtTier` omitted (null) ⇒ no tier unlock; blueprints
    still bank (Decision 7).

### 6.8 `src/entities/Pickup.ts` — the `'blueprint'` kind

- `PickupKind` union gains `'blueprint'`.
- `PICKUP_COLORS` gains a `blueprint` color (a distinct hue — a tinted rect, no new art).
- The pooled `pk` shape gains `blueprintId: string | null` (seeded null in the pool init,
  Pickup.ts:91; set in `acquire` from `meta.blueprintId`, cleared on release Pickup.ts:176) — mirrors
  the existing `weaponId/scrollId/skillId` meta fields exactly.

### 6.9 `src/scenes/HubScene.ts` — tier selector + blueprint list

- New synthetic rows, extending the existing `seedRowIndex/startRowIndex` scheme (HubScene.ts:74-77):
  a TIER row (above SEEDED RUN) and N BLUEPRINT rows (one per `BLUEPRINTS` entry). The cursor/row
  math stays a single clamp (the existing KISS pattern).
- The TIER row shows `TIER  selected/unlocked  · <tier.name> · <tier.desc>`; Buy (Space/Enter) on it
  CYCLES `selectedTier` within `0..unlockedTier` (wrapping to 0 past the unlocked max), saving via
  `meta.setSelectedTier`. (Left/Right could also adjust it; cycle-on-Buy reuses the existing single
  confirm key — KISS, no new key wiring.)
- The BLUEPRINT rows render GENERICALLY off `BLUEPRINTS`: `<name> · <kind> · UNLOCKED|LOCKED`,
  colored green (unlocked) / grey (locked) via `meta.isBlueprintUnlocked(id)`. Read-only (banked
  in-run, not bought here — Decision 7).
- `_render` (HubScene.ts:185) is extended to paint the new rows; the header (Cells + best depth) is
  unchanged. No per-tier/per-blueprint bespoke code.

### 6.10 `scripts/verify-gen.mjs` — new sweeps + extended monotonicity (see §7)

## 7. Verification

`npm run typecheck` (tsc) and `npm run verify` (the headless gen/contract sweep) must BOTH pass.
The verifier extensions (all node-importable pure modules — the established discipline):

- **Imports.** Add `BOSS_CELL_TIERS, MAX_TIER, tierAt` from `config/tiers.js`; `runWeaponPool,
  runSkillPool, runMutationPool` from the three tables; `BLUEPRINTS, BLUEPRINTS_BY_ID` from
  `config/blueprints.js`. A successful node import RE-PROVES their purity (a Phaser/storage-coupled
  module throws under node).

- **§4a (curve monotonicity) extended — tier identity + tier non-weakening.** For `mult = 1`,
  `scaleAtDepth(depth, 1)` deep-equals `scaleAtDepth(depth)` at every depth (the IDENTITY pin — the
  load-bearing "tier 0 = round 1" proof for the curve). For each `tier` in `BOSS_CELL_TIERS`, walk
  `depth 0..MAXD` and assert each tiered scalar is non-decreasing in depth AND `≥` the tier-0 scalar
  at the same depth (a higher tier never weakens the curve).

- **§4c (whole-run monotonicity) extended to EVERY tier (AC42/AC43 preserved).** Keep the existing
  tier-0 walk UNCHANGED (it calls `effectiveDifficulty(depth, biome)` — default mult 1 — so it is
  byte-identical). ADD: for each `tier` in `BOSS_CELL_TIERS`, drive a fresh `createRunState(RUN_SEED)`
  through `advance()` for the FULL run, asserting `effectiveDifficulty(depth, biome,
  tier.bossCellMult)` is non-decreasing across the entire run. Because `bossCellMult` is CONSTANT
  within a run and `≥ 1`, and the curve term is non-decreasing in depth and the biome tier is
  non-decreasing along `BIOME_ORDER`, the tiered `effectiveDifficulty` is non-decreasing BY
  CONSTRUCTION — the walk is a proof, not a filter. Also assert, at every step, the tiered
  `effectiveDifficulty ≥` the tier-0 value (the tier is a global lift, never an easing).

- **§5 (meta-loop) extended — applyUpgrades unchanged; tiers + blueprints + resolvers swept.**
  - **Tier table well-formed:** `index === position`; `BOSS_CELL_TIERS[0]` is the identity
    (`bossCellMult === 1 && flaskDelta === 0 && eliteChanceMult === 1`); `bossCellMult` monotone
    non-decreasing + every `≥ 1`; `flaskDelta` monotone non-increasing; `eliteChanceMult` monotone
    non-decreasing + every `≥ 1`; `tierAt(out-of-range)` clamps into `[0, MAX_TIER]`.
  - **Flask-floor sanity (Decision 4):** `BASE_PLAYER_STATS.maxFlasks + flaskDelta` of the DEEPEST
    tier is `≥ 1` (the shipped table never reaches an unwinnable zero-heal run).
  - **Blueprint catalog ↔ table tags consistency:** every `BLUEPRINTS[i].id` is referenced by exactly
    one tagged row across weapons/skills/mutations, and every tagged row's `blueprint` id exists in
    `BLUEPRINTS` (no orphan tag / no orphan catalog entry). `kind` matches the table the tag lives in.
  - **Resolver identity (the blueprint identity pin — AC11):** `runWeaponPool(new Set())` returns
    exactly the STARTER weapon ids === the pre-slice `WEAPON_ORDER` ids that carry no blueprint tag;
    likewise `runSkillPool`/`runMutationPool` with an empty set return exactly the untagged rows. A
    full-unlock set returns ALL rows. This PROVES "a default save draws from the same rows as today".
  - **`bankRun` semantics (pure, via a `loadMeta`-free harness):** since `MetaState.bankRun` is
    coupled to `save.ts` (localStorage), the verifier proves the UNLOCK/MERGE math by importing the
    pure pieces it can — `MAX_TIER` + the clamp — and asserting the documented rule
    (`min(completedAtTier + 1, MAX_TIER)`, set-union dedup) on a small in-memory shim. (The Hub/
    GameScene wiring is exercised by `typecheck` + manual run; the PURE math is verifier-pinned.)

- **OK-line update.** The summary line (verify-gen.mjs:1416-1418) gains a fragment, e.g.
  `+ N boss-cell tiers (curve identity@t0 + whole-run monotonic ∀ tier, AC42/AC43) + M blueprints
  (resolver identity@empty)`.

- **Manual check (the one thing the headless sweep can't):** in the browser, a fresh save shows
  TIER 0/0 and all blueprints LOCKED and plays identically; after a boss clear the Hub shows TIER
  0/1 selectable, a banked blueprint flips to UNLOCKED, and the next run at tier 1 visibly spawns
  tankier/denser enemies with one fewer flask. Tier 0 remains byte-identical.

## 8. Files Changed

- **`src/config/tiers.ts`** (NEW) — the `BossCellTier` shape + `BOSS_CELL_TIERS` table + `tierAt`/
  `MAX_TIER` + the module-load monotonicity assertion. PURE.
- **`src/config/blueprints.ts`** (NEW) — the `BlueprintEntry` catalog (`BLUEPRINTS`/
  `BLUEPRINTS_BY_ID`) the Hub lists + the drop picks from. PURE.
- **`src/config/difficulty.ts`** — `scaleAtDepth(depth, bossCellMult = 1)` +
  `effectiveDifficulty(depth, biome, bossCellMult = 1)` + `_curveTerm(depth, mult)`. PURE.
- **`src/config/weapons.ts`** — optional `blueprint?` on `WeaponSpec`; one new gated weapon row;
  `runWeaponPool(unlocked)` resolver. PURE.
- **`src/config/skills.ts`** — optional `blueprint?` on `SkillSpec`; one new gated skill row;
  `runSkillPool(unlocked)` resolver. PURE.
- **`src/config/mutations.ts`** — optional `blueprint?` on `MutationSpec`; one new gated mutation row;
  `runMutationPool(unlocked)` resolver. PURE.
- **`src/util/save.ts`** — `MetaState` + `DEFAULT_META` gain `unlockedTier`/`selectedTier`/
  `blueprints`. PURE (try/catch graceful-degrade untouched).
- **`src/core/MetaState.ts`** — tier + blueprint read/select API; `bankRun` extended
  (`blueprints` + `completedAtTier`); `startTier()`. PURE w.r.t. Phaser.
- **`src/core/RunState.ts`** — run-only `bossCellMult` + `blueprints`; optional `bossCellMult` ctor
  arg (default 1 — verifier-safe). PURE.
- **`src/entities/Pickup.ts`** — `'blueprint'` `PickupKind` + color + `blueprintId` pooled field.
- **`src/scenes/GameScene.ts`** — read `startTier()`; thread `bossCellMult` to the spawn/boss folds;
  fold `flaskDelta` into `startStats.maxFlasks` (clamped `≥ 1`); compute per-run resolved pools; draw
  from them in the weapon/skill/mutation placement sites; `_maybePlaceBlueprintPickup`; `_onPickup`
  `'blueprint'` arm; extend both `bankRun` calls.
- **`src/scenes/HubScene.ts`** — a TIER selector row + a BLUEPRINTS list, rendered generically;
  cursor/row-count extended; `_render` paints them.
- **`scripts/verify-gen.mjs`** — imports + the new tier/blueprint/resolver sweeps + the extended
  whole-run monotonicity walk at every tier + the curve identity-at-tier-0 pin + the resolver
  identity-at-empty pin; OK-line fragment.
- **`src/world/LevelGenerator.ts`** — **UNCHANGED** (the constraint; the tier scales scene-side, the
  blueprint drop is sourced off-the-pin).
