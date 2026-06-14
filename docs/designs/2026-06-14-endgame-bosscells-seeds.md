# F7 Endgame & Seeds — deeper Boss-Cell tiers (with an elite ramp) + a custom/daily SEED launch

## 1. Background

Deepen replay at BOTH ends of a run:

- **(a) More Boss-Cell tiers + an elite ramp.** `config/tiers.ts` ships exactly THREE tiers (`0`/`1`/`2`).
  A Boss Cell is NOT new content — it is a GLOBAL SCALAR on the existing difficulty curve
  (`config/difficulty.ts:scaleAtDepth`): `bossCellMult` × the per-depth HP/damage/speed/count ramps,
  `flaskDelta` trims starting flasks, `eliteChanceMult` × the elite-affix roll. The shipped tiers leave
  `eliteChanceMult` NEUTRAL at `1` (wired but never turned on). We APPEND deeper tiers (tankier + denser)
  AND finally turn on the elite ramp on the new rows — so a deep run is not just statistically harder but
  visibly *denser with elites*. Tier 0 stays the EXACT identity (byte-for-byte).

- **(b) A custom/daily SEED launch.** The Hub ALREADY has a custom-seed entry: `HubScene._editSeed` prompts
  for a hex/decimal run seed, `HubScene.parseSeed` coerces it to an unsigned-32-bit int, `pinnedSeed` holds
  it, and `START RUN` passes it via `scene.start('Game', { seed })` → `GameScene._resolveSeed(data)`
  (`GameScene.ts:1521`). The GameOver/Victory screens already surface the run seed as a shareable hex id.
  What is MISSING is a **DAILY** seed: a *deterministic* seed derived from today's date, so every player who
  hits "Daily" on the same calendar day plays the SAME run (a shareable, comparable daily challenge). The
  date read is a BROWSER-only concern (the game can read `Date`; only the headless verifier can't) — so the
  date→seed *derivation* is a PURE helper the verifier can pin, and the date *read* lives at the scene
  boundary, exactly like the existing entropy mint.

We already have every seam this needs — EXTEND, never duplicate:

- **The tier table + its proofs.** `config/tiers.ts:BOSS_CELL_TIERS` is a pure, node-importable, monotone-
  by-construction table with module-load assertions (`tiers.ts:61-76`). `scaleAtDepth(depth, bossCellMult)`
  / `scaleBossSpec` / `effectiveDifficulty(depth, biome, bossCellMult)` already thread the tier multiplier
  (`config/difficulty.ts`). `GameScene` already reads `meta.startTier()`, folds `flaskDelta` into
  `startStats.maxFlasks` with a `>=1` floor (`GameScene.ts:356-358`), passes `bossCellMult` into
  `createRunState` (`GameScene.ts:369`), and multiplies `eliteChanceMult` into the elite roll
  (`GameScene.ts:1564`). `MetaState` owns `selectedTier`/`unlockedTier`/`startTier()` and bumps
  `unlockedTier` on a completed run (`MetaState.ts:184-186`). `HubScene` renders the tier selector row and
  cycles `selectedTier` within `0..unlockedTier` (`HubScene.ts:212-219`). **Adding rows touches ONLY the
  table + the two i18n `tier:` blocks — every consumer is generic over `BOSS_CELL_TIERS`.**
- **The seed seam.** `HubScene` owns `pinnedSeed` (`null` = RANDOM), `_editSeed()` (toggle/prompt),
  `parseSeed` (pure, total), and the `START RUN` launch that passes the chosen seed. `GameScene._resolveSeed`
  consumes `data.seed`. `GameScene.mintSeed()` is the ONE entropy recipe (reused by the Hub for RANDOM).
- **The pure-RNG util.** `util/rng.ts` is Phaser-free (`mulberry32`, `range`) — the natural home for a pure
  `dailySeed(dateKey)` derivation the verifier can node-import and pin.
- **i18n.** EN tier `name`/`desc` come from the config object's OWN strings (`tName('en')` short-circuits —
  `i18n/index.ts:82`), so EN needs NO new tier i18n; ZH needs the `tier:` rows added (`zh-CN.ts:299-303`).
  Seed/daily UI labels are `hub.*` `ui` keys in BOTH locales.

## 2. Requirements Summary

### (a) Deeper tiers + elite ramp

- **Append rows to `BOSS_CELL_TIERS`** (currently `[0,1,2]`) for indices `3`, `4`, `5` — "3/4/5 Boss
  Cells". Each new row:
  - `bossCellMult` STRICTLY rises across the new rows AND `>=` the prior row (monotone non-decreasing; every
    `>= 1`). Pinned: `3 → 1.85`, `4 → 2.2`, `5 → 2.6` (continuing the existing `1.0 / 1.25 / 1.55` slope).
  - `flaskDelta = -1` on EVERY new row (monotone non-increasing vs. the prior `-1`; held at `-1`, NOT
    deeper). **This is forced by the flask-floor sweep** (`verify-gen.mjs §13b`):
    `BASE_PLAYER_STATS.maxFlasks (2) + deepestFlaskDelta >= 1` ⇒ deepest `flaskDelta >= -1`. So we CANNOT
    go to `-2` without falling below the shipped-table winnability floor. Held at `-1` (KISS, sweep-safe).
  - `eliteChanceMult > 1` ramped on the NEW rows only: `3 → 1.5`, `4 → 2.0`, `5 → 2.5` (monotone non-
    decreasing vs. the existing `1 / 1 / 1`). **Existing tiers 0/1/2 stay byte-identical** (their
    `eliteChanceMult` stays `1`) — the ramp begins at tier 3, which keeps the whole column non-decreasing
    (`1,1,1,1.5,2.0,2.5`) and leaves every shipped row untouched.
  - `name` (e.g. `'3 Boss Cells'`) + `desc` (a one-line Hub summary, e.g.
    `'Brutal; far denser elites; one fewer flask.'`).
- **Tier 0 stays the EXACT identity**: `{ bossCellMult: 1, flaskDelta: 0, eliteChanceMult: 1 }` — UNCHANGED
  bytes. The `tiers.ts` module-load assertion + `verify-gen.mjs §13a`/§4a enforce it; keep them green.
- **No engine change.** `scaleAtDepth`/`scaleBossSpec`/`effectiveDifficulty` already honour `bossCellMult`;
  the elite roll already honours `eliteChanceMult` (`GameScene.ts:1564`); the flask fold already clamps to a
  `>=1` floor (`GameScene.ts:358`); the Hub renders tiers generically off `BOSS_CELL_TIERS.length`. Adding
  rows is DATA + i18n only.

### (b) Custom + DAILY seed launch

- **Reuse the existing custom-seed entry as-is** (`pinnedSeed` / `_editSeed` / `parseSeed` / the `START RUN`
  pass-through). Do NOT rebuild it.
- **Add a pure `dailySeed(dateKey: string): number`** to `util/rng.ts`: hash a `YYYY-MM-DD` calendar-day
  string to a STABLE unsigned-32-bit seed. Same date ⇒ same seed (the daily-challenge contract). PURE +
  total (never throws; a junk/empty key still returns a finite unsigned int). Node-importable — the verifier
  pins it.
- **Add a DAILY action to the Hub seed row.** The SEEDED RUN row gains a way to pick "today's daily seed":
  the row becomes a 3-state cycle on the confirm key — `RANDOM → (typed) PINNED → DAILY → RANDOM` — OR a
  second key, see Decision 4. When DAILY is active, the row shows the daily seed (the hex id + a "DAILY"
  tag) and `START RUN` launches with `dailySeed(todayKey())`, where `todayKey()` reads the BROWSER date at
  the scene boundary (NOT in the pure helper). Pinning a typed seed or going RANDOM clears DAILY.
- **The launch path is UNCHANGED**: whatever seed the row resolves to (random mint / typed pin / daily) is
  passed via `scene.start('Game', { seed })` → `_resolveSeed` → deterministic run. A daily run is fully
  reproducible: re-pick "Daily" on the same date (or type the hex id it shows) → byte-identical run.
- **i18n** — the DAILY label + tag + cycle hint in BOTH `en.ts` and `zh-CN.ts`; the new tier `name`/`desc`
  rows in `zh-CN.ts` (EN reads from the config strings).
- **Verifier** — the tier monotonicity/identity sweep (`§5`/`§13`) + the whole-run per-tier walk (`§4`)
  ALREADY cover the new rows; CONFIRM they pass. Add a SMALL `dailySeed` sweep (determinism + unsigned-32
  shape + distinctness across a few dates) since it is a new pure helper.

### Identity (the hard constraint)

- A DEFAULT save selects tier 0 (`selectedTier`/`unlockedTier` default 0) ⇒ `startTier()` returns the
  UNCHANGED tier-0 row ⇒ `bossCellMult 1 / flaskDelta 0 / eliteChanceMult 1` ⇒ `scaleAtDepth(d,1)` is
  byte-identical to `scaleAtDepth(d)` (the `§4a` identity pin) and the elite roll is byte-identical
  (`§13`/`GameScene.ts:1564` reduces to `ELITE_CHANCE × 1`). A fresh run plays exactly as before.
- The appended rows are UNREACHABLE by a fresh save: `unlockedTier` only rises by clearing a run AT the
  prior tier (`MetaState.ts:184-186`), so the deeper tiers gate behind genuine progression. They cannot
  perturb a default run.
- Existing tiers 1/2 are byte-UNCHANGED (their `eliteChanceMult` stays `1`); the ramp starts at tier 3.
- The DAILY seed adds a NEW launch SOURCE only; the default Hub state stays RANDOM (the existing default),
  and `dailySeed` is never called unless the player picks Daily. No pure module that the determinism walk
  touches changes its behaviour for existing inputs (`mulberry32`/`range` unchanged; `dailySeed` is additive).
- The level regression pin + determinism deep-equal in `verify-gen.mjs` are UNTOUCHED: no generator/RNG
  draw-order change; the seed is still resolved at the scene boundary and fed IN to the (unchanged) pure
  chain.

### Non-goals (YAGNI)

- **No daily leaderboard / daily-completion persistence / "already played today" lockout.** A Daily run is
  just a deterministic seed pick. Tracking/locking dailies is a separate feature (not in scope).
- **No timezone/UTC normalisation policy beyond "the player's local calendar day".** `todayKey()` reads the
  browser's local date (`YYYY-MM-DD`). Two players in different timezones near midnight may get different
  dailies — acceptable for a programmer-art clone (documented; not a leaderboard). KISS.
- **No new custom text-field widget.** The typed-seed path stays a `window.prompt` (the existing KISS choice
  under the primitives-only art constraint). Daily needs no text entry (it derives the seed).
- **No tier-specific REWARDS / new content per tier.** A tier is a global difficulty scalar only (the
  existing model). No bespoke loot/enemies/affixes per tier (that breaks the "global lift, no parallel
  system" invariant + the determinism pins).
- **No new starter weapons/skills/mutations/enemies.** This slice adds ZERO content that feeds a seeded run
  pool — so the determinism pins (`§13` `runWeaponPool/runSkillPool/runMutationPool`) are untouched. (No
  blueprint needed — we add no pool content.)
- **No deeper `flaskDelta` (`-2`).** Forbidden by the flask-floor sweep with `BASE maxFlasks = 2`. Held at
  `-1`. (If a future slice raises base flasks, deeper deltas become possible — out of scope.)
- **No TitleScene seed entry.** The integration map offered "TitleScene OR HubScene". We keep the seed
  controls in the HUB (where they already live + where START RUN is) — adding a parallel Title path is
  duplication (YAGNI). Title → Hub → Game stays the one entry flow.

## 3. Acceptance Criteria

1. **`config/tiers.ts` — three rows appended (indices 3,4,5), tier 0 byte-identical.** `BOSS_CELL_TIERS`
   becomes length 6. New rows:
   - `index 3`: `bossCellMult 1.85`, `flaskDelta -1`, `eliteChanceMult 1.5`, name `'3 Boss Cells'`.
   - `index 4`: `bossCellMult 2.2`, `flaskDelta -1`, `eliteChanceMult 2.0`, name `'4 Boss Cells'`.
   - `index 5`: `bossCellMult 2.6`, `flaskDelta -1`, `eliteChanceMult 2.5`, name `'5 Boss Cells'`.
   Each row has a non-empty `desc`. `MAX_TIER` becomes `5` (it derives from `.length - 1` — no manual edit).
   Tier 0's row is UNCHANGED bytes; tiers 1/2 are UNCHANGED bytes (their `eliteChanceMult` stays `1`).
2. **The `tiers.ts` module-load assertions stay GREEN** (`tiers.ts:61-76`): index===position; tier 0 is the
   exact identity; `bossCellMult` monotone non-decreasing + every `>=1`; `flaskDelta` monotone non-
   increasing; `eliteChanceMult` monotone non-decreasing + every `>=1`. The pinned numbers satisfy all of
   these by construction — VERIFY at import.
3. **The flask floor holds (`§13b`).** `BASE_PLAYER_STATS.maxFlasks (2) + BOSS_CELL_TIERS[5].flaskDelta
   (-1) = 1 >= 1` — the shipped table is winnable by design (no reliance on the runtime clamp).
4. **The verifier tier sweeps pass UNCHANGED.** `§13a` (well-formed + monotone + identity + `tierAt` clamp),
   `§4a` (per-tier curve non-weakening + identity-at-tier-0), and the per-path × per-tier whole-run walk
   (`§4c'`) ALL iterate `BOSS_CELL_TIERS`, so the new rows are swept automatically. CONFIRM `npm run verify`
   is green with the 6-row table. `tierAt(999)` clamps to the new `MAX_TIER (5)` row.
5. **The elite ramp is live at depth.** A run at tier `>=3` rolls elites at `min(1, ELITE_CHANCE ×
   eliteChanceMult)` (`GameScene.ts:1564`) — visibly denser elites. Tier 0/1/2 unchanged
   (`eliteChanceMult 1`). No engine edit (the multiply is already wired).
6. **The Hub shows all six tiers.** `HubScene`'s tier selector reads `MAX_TIER` + `meta.startTier()`
   generically (`HubScene.ts:286-287`), so the rows surface with no Hub edit; cycling `selectedTier` reaches
   `0..unlockedTier` up to 5. CONFIRM the row renders the new tier name/desc (EN from config, ZH from
   i18n). No layout regression (the tier row is a single existing row — its count doesn't grow the list).
7. **`util/rng.ts` — a NEW pure `dailySeed(dateKey: string): number`.** Hashes a `YYYY-MM-DD` string to a
   STABLE unsigned-32-bit int. PURE + total: never throws; `dailySeed('')` / a junk key returns a finite
   unsigned int; identical input ⇒ identical output; distinct dates ⇒ (overwhelmingly) distinct seeds.
   Returns `>>> 0` (the unsigned-32 shape RunState's chain expects), never `0` (fallback `1`, mirroring
   `mintSeed`). No Phaser, no `Date` read inside (the date is passed IN).
8. **`HubScene` — a DAILY seed mode on the SEEDED RUN row.** The row gains a DAILY state alongside RANDOM
   and (typed) PINNED. A new `dailyKey: string | null` field (null = not-daily). The confirm cycle on the
   seed row is `RANDOM → PINNED(prompt) → DAILY → RANDOM` (Decision 4 — single key, KISS):
   - When DAILY is active, `_render` shows `t('hub.seedDaily')` + the daily hex id (e.g.
     `DAILY 0x<seed>`), and `START RUN` resolves the seed to `dailySeed(HubScene.todayKey())`.
   - `HubScene.todayKey()` (a static, browser-boundary helper) returns the LOCAL `YYYY-MM-DD` from `new
     Date()` (guarded so a missing `Date` degrades — never throws). This is the ONLY date read.
   - Picking DAILY clears `pinnedSeed`; pinning a typed seed or going RANDOM clears the daily state — the
     three are mutually exclusive (one resolved seed at START RUN).
   - START RUN seed resolution (Decision 4): `dailyKey != null ? dailySeed(todayKey()) : pinnedSeed != null
     ? pinnedSeed : GameScene.mintSeed()`.
9. **A daily run is deterministic + reproducible.** Two launches of Daily on the same calendar day produce
   byte-identical runs (same `dailySeed` → same `_resolveSeed` → same RunState chain). The hex id the row
   shows can be typed back via the PINNED path to replay that exact daily later (the shareable-id contract).
10. **i18n (BOTH locales).**
    - `zh-CN.ts` `tier:` block gains rows `'3'`/`'4'`/`'5'` (name + desc). EN reads the config strings
      (no EN tier i18n needed — `tName('en')` short-circuits).
    - `en.ts` + `zh-CN.ts` `ui` gain: `hub.seedDaily` (the DAILY row label/value prefix) and any new cycle
      hint text the seed row shows for the DAILY state. No bare English literal reaches the UI.
11. **Verifier sweep for `dailySeed` (NEW small section).** Node-import `util/rng.js`; assert: `dailySeed`
    is deterministic (same input twice → equal), returns an unsigned-32-bit int (`>>> 0 === itself`, finite,
    `>= 0`), is total on junk (`dailySeed('')`, `dailySeed('not-a-date')` return finite unsigned ints), and
    is distinct across a small fixed set of dates (e.g. 5 consecutive days → 5 distinct seeds, or document
    the collision tolerance). Update the final summary `console.log`.
12. **Build + verifier green.** `npm run verify` and the Vite/tsc build pass. The level regression pin + the
    determinism deep-equal are unchanged (no pure module that the walk touches changed behaviour for
    existing inputs).

## 4. Numbered Decisions

1. **Tiers are DATA-only — no engine change.** Every consumer (`scaleAtDepth`/`scaleBossSpec`/
   `effectiveDifficulty`/the elite roll/the flask fold/the Hub/`MetaState.startTier`) is already generic
   over `BOSS_CELL_TIERS` and already threads `bossCellMult`/`eliteChanceMult`/`flaskDelta`. Appending rows
   is the ENTIRE behavioural change for part (a). This is the existing "a Boss Cell is a global scalar, not a
   parallel system" model (DRY/KISS).

2. **The elite ramp begins at tier 3 (existing rows byte-unchanged).** The feature asks to turn on the
   `eliteChanceMult` ramp that ships neutral at 1. The monotone-non-decreasing column constraint allows TWO
   shapes: (a) ramp from tier 1, or (b) ramp from tier 3. We pick (b) — ramp on the NEW rows only
   (`1,1,1,1.5,2.0,2.5`) — because it keeps EVERY shipped row (0/1/2) byte-identical (the additive-identity
   spirit: don't silently re-tune existing reachable content), still satisfies "ramped > 1 on higher tiers",
   and concentrates the new "denser elites" feel where the new difficulty lives. (Bumping tier 1/2 too is a
   documented one-line alternative if a balance pass later wants it — NOT shipped.)

3. **`flaskDelta` held at `-1` on every new row (the flask-floor sweep forbids `-2`).** `§13b` asserts
   `BASE_PLAYER_STATS.maxFlasks (2) + deepest flaskDelta >= 1`, so the deepest delta can be at most `-1`.
   Going `-2` would make the SHIPPED table rely on the runtime `>=1` clamp to be winnable — a tuning smell
   the sweep rejects. Held at `-1` (still monotone non-increasing vs. the prior `-1`). The harder feel comes
   from `bossCellMult` + the elite ramp, NOT from removing the last heal (which would be degenerate, not
   difficulty — the design's stated rationale).

4. **The seed row is a single-key 3-state cycle (RANDOM → PINNED → DAILY → RANDOM).** Reuse the ONE confirm
   key (SPACE/ENTER) the row already uses (KISS — no new key wiring, mirroring the tier-cycle idiom at
   `HubScene.ts:212-219`). State machine on confirm:
   - From RANDOM (`pinnedSeed==null && dailyKey==null`): open the typed-seed prompt (`_editSeed`'s existing
     path). A valid entry → PINNED; a blank/cancel → STAY random... **refinement:** to make all three
     reachable by one key, the cycle is: RANDOM → (prompt; valid→PINNED, blank→DAILY) is confusing. So we
     pin the cleaner machine: **confirm CYCLES `RANDOM → DAILY → RANDOM` UNLESS a typed seed is set**, and a
     SEPARATE affordance sets/clears the typed seed. To keep it ONE key + KISS, ship: confirm cycles
     `RANDOM → PINNED(prompt) → DAILY → RANDOM`. On the PINNED step we prompt; an empty/cancelled prompt
     falls THROUGH to DAILY (so the user is never stuck), a valid entry lands on PINNED. Each state's
     `_render` shows its label (RANDOM / `0x<hex>` / `DAILY 0x<hex>`) + the next-action hint. START RUN reads
     whichever state is active (Decision 8 resolution order). The exact cycle wording is the implementer's
     to keep crisp in `_render`/the hints — the CONTRACT is: all three states reachable by the one confirm
     key, mutually exclusive, and START RUN resolves to exactly one seed.

5. **The date is read at the SCENE boundary, the derivation is PURE.** `dailySeed(dateKey)` (in
   `util/rng.ts`) takes the date STRING and is node-pinnable/deterministic; `HubScene.todayKey()` does the
   browser `new Date()` read (the impure part) and lives in the scene, guarded so a missing `Date` degrades
   to a stable fallback key (never throws — mirroring `_editSeed`'s `prompt` guard + `save.ts` discipline).
   This keeps the verifier's determinism story intact: no pure module reads wall-clock; entropy/date reads
   are confined to the scene seam, exactly like `mintSeed`.

6. **`dailySeed` is total + collision-light, not cryptographic.** A simple string hash (e.g. an FNV-1a /
   xmur-style mix over the chars, `>>> 0`, `|| 1`) is sufficient — consecutive days produce distinct seeds
   (the verifier asserts distinctness over a small fixed set). It is NOT a CSPRNG (YAGNI — a daily-challenge
   seed needs only "same day → same run, different days → different run", not unpredictability).

7. **No content, no blueprint, no determinism-pin touch.** This slice adds ZERO weapons/skills/mutations/
   enemies, so `runWeaponPool/runSkillPool/runMutationPool` (`§13`) are byte-unchanged and need no blueprint
   gate. The only new pure code is `dailySeed` (additive — never called by the determinism walk's existing
   inputs). The level regression pin + deep-equal stay green.

8. **The Hub seed controls stay in the HUB (not TitleScene).** The seed UI already lives next to START RUN;
   the daily mode is a natural extension of the same row. A parallel Title-screen seed path is duplication
   (YAGNI) and the entry flow is fixed at Title → Hub → Game. KISS.

## 5. Integration Map (files the implementer will touch)

- **`src/config/tiers.ts`** — append three `BossCellTier` rows (indices 3/4/5) to `BOSS_CELL_TIERS` with the
  pinned `bossCellMult`/`flaskDelta`/`eliteChanceMult`/`name`/`desc` (Decision 1/2/3). Tier 0/1/2 rows
  UNCHANGED. `MAX_TIER`/`TIERS_BY_INDEX`/`tierAt` derive automatically — no other edit. The module-load
  assertions must stay satisfied (they are, by the pinned numbers).
- **`src/util/rng.ts`** — add a pure, node-importable `dailySeed(dateKey: string): number` (string-hash →
  unsigned-32, total, never 0). No Phaser, no `Date` read.
- **`src/scenes/HubScene.ts`** — add `dailyKey: string | null` state (null = not-daily); a static
  `todayKey()` (browser `new Date()` → `YYYY-MM-DD`, guarded); extend the seed-row confirm into the 3-state
  cycle (Decision 4); extend `_render` to show the DAILY state (label + daily hex id + hint); update the
  `START RUN` seed resolution to prefer `dailyKey` → `dailySeed(todayKey())`, else the existing
  pinned/random path. Import `dailySeed` from `util/rng.js`. (The tier rows surface with NO Hub change.)
- **`src/i18n/en.ts`** — add `ui` keys for the DAILY label/value prefix + any DAILY-state hint
  (`hub.seedDaily`, etc.). NO EN tier keys needed (config strings are the EN source).
- **`src/i18n/zh-CN.ts`** — add the same new `hub.*` `ui` keys (zh) AND append `tier:` rows `'3'`/`'4'`/`'5'`
  (name + desc) so deeper tiers render in Chinese.
- **`scripts/verify-gen.mjs`** — CONFIRM the existing tier sweeps (`§4a`/`§4c'`/`§13a`/`§13b`) pass with the
  6-row table (they iterate `BOSS_CELL_TIERS` — no edit needed, just verify). ADD a small `dailySeed` sweep
  (node-import `util/rng.js`; assert determinism + unsigned-32 shape + totality on junk + distinctness over a
  fixed date set). Update the final summary `console.log` to mention the daily-seed helper.

## 6. Identity-Preservation Checklist (the implementer MUST verify)

- [ ] `BOSS_CELL_TIERS[0]` is byte-identical (`bossCellMult 1, flaskDelta 0, eliteChanceMult 1`); tiers 1/2
      are byte-identical (`eliteChanceMult` stays `1`). The diff ADDS rows 3/4/5 only.
- [ ] `MAX_TIER` is now `5` purely via `.length - 1` (no hand-edit); `tierAt` clamps to the new max.
- [ ] A default save (`selectedTier`/`unlockedTier` = 0) launches at tier 0 ⇒ `scaleAtDepth(d,1)` byte-
      identical to `scaleAtDepth(d)`; the elite roll reduces to `ELITE_CHANCE × 1`; flasks unchanged.
- [ ] The deeper tiers are UNREACHABLE on a fresh save (gated behind `unlockedTier`, which only rises on a
      completed run at the prior tier).
- [ ] `tiers.ts` module-load assertions + `verify-gen.mjs §13a/§13b/§4a/§4c'` are GREEN with 6 rows.
- [ ] `dailySeed` is additive (never called by the determinism walk's existing inputs); `mulberry32`/`range`
      are unchanged; the level regression pin + determinism deep-equal stay green.
- [ ] The Hub default seed state is still RANDOM; `dailySeed`/`todayKey` are only reached when the player
      picks DAILY. The typed-seed and random paths are unchanged.
- [ ] `todayKey()` is the ONLY new wall-clock read and is at the scene boundary (guarded — never throws); the
      pure `dailySeed` reads no clock.
- [ ] No new weapons/skills/mutations/enemies ⇒ `runWeaponPool/runSkillPool/runMutationPool` pins untouched;
      no blueprint added.
- [ ] All new UI strings go through `t()` in BOTH locales; ZH tier rows 3/4/5 added; EN reads config strings.

## 7. Verifier Notes (the CI gate)

- **Tier sweeps — CONFIRM (no edit expected).** `§13a` re-proves the 6-row table (index===position, tier-0
  identity, `bossCellMult` non-decreasing/`>=1`, `flaskDelta` non-increasing, `eliteChanceMult` non-
  decreasing/`>=1`, `tierAt` clamps). `§13b` asserts the deepest-tier flask floor (`2 + (-1) = 1 >= 1`).
  `§4a` re-proves per-tier curve non-weakening + the tier-0 identity. `§4c'` walks EVERY path × EVERY tier
  for whole-run monotonicity. All iterate `BOSS_CELL_TIERS`, so they cover the new rows automatically — the
  job is to RUN them green, not to add tier assertions. If any sweep references the tier COUNT it adapts via
  `BOSS_CELL_TIERS.length`/`MAX_TIER` (already the case).
- **`dailySeed` sweep — NEW small section** (node-import `util/rng.js`, `fail(...)`-on-violation style):
  - Determinism: `dailySeed('2026-06-14') === dailySeed('2026-06-14')`.
  - Unsigned-32 shape: the result `=== (result >>> 0)`, is finite, `>= 0`, and never `0` (fallback `1`).
  - Totality on junk: `dailySeed('')`, `dailySeed('not-a-date')` return finite unsigned ints (never throw /
    NaN).
  - Distinctness: a small fixed set of dates (e.g. `2026-06-14`..`2026-06-18`) maps to all-distinct seeds
    (catches a degenerate hash).
  - Update the final summary `console.log` to mention the daily-seed helper (e.g. `+ dailySeed (deterministic
    date→seed, unsigned-32, total)`).
