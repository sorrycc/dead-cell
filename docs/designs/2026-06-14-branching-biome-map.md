# F4 Branching Map — a 2-way biome CHOICE at each transition, converging on the boss

## 1. Background

Today the run is a strictly LINEAR chain: `BIOME_ORDER = [PRISON, SEWERS, CATACOMBS, RAMPARTS]`, and
`RunState` walks it with a single `biomeIndex` that `advance()` does `+1` on at a biome boundary
(`core/RunState.ts:316`). Every run sees the exact same four biomes in the exact same order — no agency,
limited replayability.

This slice replaces the linear order with a **BRANCHING graph**: each non-boss biome declares `exits`
(the biome ids it can lead to), and at a biome boundary the player CHOOSES between **2** next biomes (a
safer route vs. a harder/richer one) via a reused frozen-modal picker. All paths converge on the boss
biome (`RAMPARTS`). The genre's "choose your route" map.

We already have **every seam** this needs — EXTEND, never duplicate:

- **Pure biome config.** `config/biomes.ts` is node-importable plain data (no Phaser) with per-biome
  `difficultyTier`, `levels`, `endsInBoss`, `enemyPool`, etc., plus `BIOME_ORDER` (the run sequence) and
  `BIOMES` (id→config map). The graph is one new field (`exits`) per node + one new alternate biome.
- **The run-only value object.** `core/RunState.ts` carries run-scoped position (`biomeIndex`,
  `levelInBiome`, `depth`) and the pure method surface (`biome()` / `advance()` / `isLastBiome()` /
  `isRunComplete()` / `isBossLevel()` / `isMinibossLevel()`). It is node-constructible (the verifier drives
  `advance()`). We swap the array index for an id + chosen-path model.
- **The frozen-modal picker idiom.** `entities/MutationOverlay.ts` and its trimmed clone
  `entities/ColorOverlay.ts` are camera-fixed modals drawn over a frozen GameScene (primitives + text only),
  with their own keyboard bus (up/down/confirm), an `onPick(id)` callback, and a `close()` teardown. The
  biome picker is a third such overlay, modelled identically.
- **The biome-transition hook.** `GameScene._nextLevel()` (`GameScene.ts:1060`) detects a biome ROLL
  (`biomeIndex !== prevBiomeIndex`), refills flasks, grants the biome power scroll, then offers the
  mutation + colour modals SEQUENTIALLY (`_offerMutation` → on close `_offerColorPick`). The biome CHOICE
  modal slots in as the FIRST of this sequence — but it must be offered BEFORE the next level is built
  (the choice DECIDES which biome to build), so the timing is restructured (Decision 6).
- **The pure verifier.** `scripts/verify-gen.mjs` node-imports the real config + RunState and re-derives
  every invariant. §4b sweeps biome-tier monotonicity along `BIOME_ORDER`; §4c walks the EXACT `advance()`
  chain asserting whole-run `effectiveDifficulty` is non-decreasing and ends on the last biome. This is the
  SENSITIVE part: the walk must be GENERALISED to traverse the GRAPH (every path), strengthened, never weakened.
- **i18n.** `i18n/zh-CN.ts` carries a `biome:` content block (`prison`/`sewers`/`catacombs`/`ramparts`
  name overrides); `en` reads the config `name` directly via `tName`. UI chrome lives in both `ui` blocks,
  read via `t()`. A new biome + the choice-prompt strings add to BOTH locales.

What is **missing**: there is no biome graph (only a linear array), no choice point, no choice overlay, and
the verifier proof is linear. We add exactly that. **A default run with no UI (headless / verifier) still
walks a deterministic LINEAR default path** byte-identically structured to today's run length.

## 2. Requirements Summary

- **Add a biome GRAPH to `config/biomes.ts`**: every biome node declares `exits: string[]` (the biome ids
  it can lead to). `difficultyTier` stays monotone non-decreasing along EVERY path. Add ONE new alternate
  mid biome (a parallel to `CATACOMBS`) so a real 2-way choice exists. ALL paths reach `RAMPARTS`.
- **`RunState` graph model**: replace `biomeIndex`-into-array with a `biomeId` + a chosen `path` (the
  ordered list of visited biome ids). `advance()` at a biome boundary consults the NEXT chosen biome (set by
  the picker) instead of `biomeIndex+1`. Determinism + monotonicity preserved.
- **A 2-way biome CHOICE at each transition** via a reused MutationOverlay-style picker. Default/auto-pick is
  DETERMINISTIC off the seed when no UI (headless safety + the verifier's pinned default path).
- **A `BiomeChoiceOverlay`** (`entities/BiomeChoiceOverlay.ts`) cloned from the picker idiom.
- **The verifier's whole-run monotonicity proof traverses the GRAPH**: assert EVERY reachable path has
  non-decreasing `effectiveDifficulty`, ENDS at the boss biome, and that every biome is reachable. Keep the
  per-tier walks. STRENGTHEN, do not weaken.
- **ADDITIVE IDENTITY**: a default run plays with the SAME number of levels-per-path and the SAME within-
  path difficulty curve. The DEFAULT path (auto-pick) is the canonical linear chain so the regression pin +
  determinism deep-equal are unaffected. New biome name + choice prompt add to BOTH locales.

## 3. The graph

### 3.1 Shape (decided — KISS)

A small DAG (directed acyclic graph), every node tier-monotone, converging on `RAMPARTS`:

```
                 ┌──────────────┐
PRISON ──▶ SEWERS ┤              ├──▶ RAMPARTS (boss)
 (t0)      (t1)   │  CATACOMBS   │      (t3)
                  │   (t2)       │
                  └──────────────┘
                  │  OSSUARY     │   ← NEW alternate mid biome (t2)
                  └──────────────┘
```

- `PRISON.exits = ['sewers']` (single exit — no choice at the very first boundary; KISS, the opener is
  fixed so a new player has a fixed on-ramp).
- `SEWERS.exits = ['catacombs', 'ossuary']` — **THE 2-way choice**: `CATACOMBS` (the existing crypt) vs.
  `OSSUARY` (the NEW parallel mid biome). Both tier 2.
- `CATACOMBS.exits = ['ramparts']` and `OSSUARY.exits = ['ramparts']` — both converge on the boss.
- `RAMPARTS.exits = []` (the boss biome — terminal, no exit).

This yields exactly **2 distinct paths**, both length 4 (Prison→Sewers→{Catacombs|Ossuary}→Ramparts), both
12 generated rooms + boss — IDENTICAL run length to today regardless of choice (the additive-identity
guarantee on run length). The 2-way choice happens at the Sewers→mid boundary.

> **YAGNI**: one choice point ships now (the integration map requires "at least one ALTERNATE mid biome so a
> real 2-way choice exists"). The `exits` model trivially supports more choice points later (give another
> node ≥2 exits) without touching RunState/GameScene/verifier — the architecture, not a feature.

### 3.2 The new biome — `OSSUARY` (tier 2, parallel to Catacombs)

A pure-data add mirroring the existing biome field SHAPE (DRY — the generator reads identical keys). It must
sit at **the same `difficultyTier` (2)** as `CATACOMBS` so BOTH `SEWERS`-exit routes are tier-monotone
(Sewers t1 → {Catacombs t2 | Ossuary t2} → Ramparts t3). Concretely:

- `id: 'ossuary'`, `name: 'Ossuary'`, `difficultyTier: 2`, `endsInBoss: false`,
  `miniboss: 'catacombsMiniboss'` (REUSE the Bone Warden — no new boss spec needed; YAGNI. A present
  miniboss id must resolve to a known boss, which it does), `levels: 3`.
- `enemyPool`: a DISTINCT mix from Catacombs (e.g. shooter-heavy + charger — a "ranged ambush galleries"
  feel vs. Catacombs' spitter/flyer crypt), referencing ONLY known archetype ids with positive weights.
- `layoutWeights`: a distinct tilt (e.g. islands-heavy) so it reads differently spatially.
- `cols`/`rows` within `[COLS_MIN,COLS_MAX]`/`[ROWS_MIN,ROWS_MAX]` (e.g. 82×25, like Catacombs).
- All count bands (`minEnemies`/`maxEnemies`/`minPickups`/`maxPickups`/`oneWayLedges`/`hazardPatches`) and
  `platformLenRange` filled like the others; a bone-and-rust `colors` palette (programmer-art ints).

> **Framing — "safer vs. richer"**: the integration map's example is "a safer route vs. a harder route with
> richer loot". Both routes are tier 2 (the proof requires monotone tiers, not EQUAL difficulty across
> siblings — but EQUAL tier is the simplest sound choice). The flavour difference is the **enemy/layout
> mix**, not the difficulty tier. Do NOT make one sibling a higher tier than the other expecting the proof
> to "average" — the proof checks EVERY path independently, so a tier-3 sibling feeding tier-3 Ramparts is
> still monotone, but then the choice is "harder now" not "richer". KISS: ship both at tier 2 with distinct
> mixes; richer-loot tuning (if wanted) rides the existing per-biome bands, not the tier.

### 3.3 Config exports (decided)

```ts
// each BiomeConfig gains:
exits: string[]   // biome ids this node can lead to (the boss biome = []).

// keep BOTH:
export const BIOME_ORDER: BiomeConfig[]  // the canonical DEFAULT LINEAR PATH (Prison→Sewers→Catacombs→Ramparts)
export const BIOMES: Record<string, BiomeConfig>  // id→config (now the GRAPH lookup — every node incl. Ossuary)
export const START_BIOME_ID = 'prison'             // the graph root.
```

`BIOME_ORDER` is REPURPOSED as **the default linear path** (the auto-pick path — see Decision 5). It must
remain a real path through the graph: `Prison→Sewers→Catacombs→Ramparts`, each consecutive pair satisfying
`BIOME_ORDER[i+1].id ∈ BIOME_ORDER[i].exits`. `BIOMES` becomes the authoritative graph node set (it MUST
now include `ossuary`). `START_BIOME_ID` names the root so RunState/verifier don't hard-code `'prison'`.

## 4. Numbered decisions

### Decision 1 — `exits: string[]` on every biome; the graph lives in `BIOMES`
Add `exits` to `BiomeConfig`. Every node's `exits` reference only known biome ids (verifier-asserted).
`PRISON.exits=['sewers']`, `SEWERS.exits=['catacombs','ossuary']`, `CATACOMBS.exits=['ramparts']`,
`OSSUARY.exits=['ramparts']`, `RAMPARTS.exits=[]`. The boss biome is the UNIQUE terminal (`exits===[]`,
`endsInBoss===true`).

### Decision 2 — ONE new alternate mid biome: `OSSUARY` (tier 2)
Mirror the existing biome shape; tier 2 (== Catacombs) so both Sewers-exit routes are tier-monotone. Reuse
`catacombsMiniboss`. Add to `BIOMES`. Do NOT add it to `BIOME_ORDER` (the default path takes Catacombs).

### Decision 3 — RunState graph model: `biomeId` + `path`, drop `biomeIndex`
Replace the `biomeIndex: number` field with:
- `biomeId: string` — the CURRENT biome's id (seeded to `START_BIOME_ID`).
- `path: string[]` — the ordered list of biome ids the run has DECIDED to walk, starting `[START_BIOME_ID]`.
  The picker (or the auto-pick) APPENDS the chosen next id BEFORE the boundary roll; `advance()` reads
  `path[currentPathIndex+1]` to roll. Equivalent KISS form: keep an internal cursor over `path` and a
  `nextBiomeId: string | null` set by the picker. **Chosen shape (KISS):**
  - `biomeId: string` (current), `path: string[]` (visited, for the HUD/summary route readout),
  - `pendingBiomeId: string | null` — the next biome the picker committed to (null = not yet chosen;
    `advance()` falls back to the DEFAULT next when null — Decision 5).

`biome()` returns `BIOMES[this.biomeId]`. `isLastBiome()` becomes `BIOMES[this.biomeId].endsInBoss === true`
(the boss biome is the unique terminal — exits empty) **OR** equivalently `exits.length === 0`. Keep ONE
definition: `isLastBiome()` ≡ current node is the boss biome (`endsInBoss === true`). `isRunComplete()` /
`isBossLevel()` / `isMinibossLevel()` are UNCHANGED in logic — they already key off `biome()` +
`levelInBiome` + `endsInBoss`/`miniboss`, which the graph model preserves. `depth` stays run-global +
monotone (never resets). `levelInBiome` semantics unchanged.

### Decision 4 — `advance()` consults the chosen next biome, not `+1`
```
advance():
  this.seed = nextSeed(this.seed)
  this.depth += 1
  this.levelInBiome += 1
  if (this.levelInBiome >= this.biome().levels && !this.isLastBiome()):
      const next = this.pendingBiomeId ?? defaultNextBiomeId(this.biomeId)   // Decision 5 fallback
      this.biomeId = next
      this.path.push(next)
      this.pendingBiomeId = null
      this.levelInBiome = 0
  return this
```
- The boundary roll uses `pendingBiomeId` (set by GameScene's picker BEFORE `advance()`), else the
  deterministic default (Decision 5). A defensive guard: if `next` is somehow not in `biome().exits`, fall
  back to `defaultNextBiomeId` (never roll to an unreachable node — keeps the invariant local).
- `isLastBiome()` guards the roll (the boss biome never rolls onward) exactly as today.

### Decision 5 — deterministic DEFAULT / auto-pick (headless + verifier safety)
`defaultNextBiomeId(biomeId)` returns a deterministic exit so a run with NO UI still advances:
- **The default path is the canonical linear chain.** `defaultNextBiomeId` returns `exits[0]` (the FIRST
  declared exit). Order `SEWERS.exits = ['catacombs', 'ossuary']` so `exits[0] === 'catacombs'` → the
  default path is `Prison→Sewers→Catacombs→Ramparts` === today's `BIOME_ORDER`. This makes the verifier's
  default-path walk byte-structurally identical to today's linear walk (the additive-identity pin).
- When GameScene HAS UI, the picker sets `pendingBiomeId` to the player's choice; auto-pick (`exits[0]`)
  is the fallback only when no choice was made (headless / a single-exit node like Prison/the mid→Ramparts
  legs, where there is no real choice anyway).
- A single-exit node (`exits.length === 1`) NEVER opens the picker (no real choice) — it just auto-rolls to
  `exits[0]`. The picker opens IFF `exits.length >= 2`.

### Decision 6 — GameScene: offer the CHOICE, then build the chosen biome (timing restructure)
Today `_nextLevel()` calls `advance()` FIRST, then builds, then offers mutation/colour. For a biome CHOICE
the order must be: **decide the next biome → advance into it → build it → offer mutation/colour**. The
clean seam:
- At a biome boundary (detected the same way today: the upcoming `advance()` will roll the biome — i.e.
  `levelInBiome+1 >= biome().levels && !isLastBiome()`), and the current node has `exits.length >= 2`,
  OPEN the `BiomeChoiceOverlay` with the 2 exit biomes. The overlay's `onPick(id)` sets
  `runState.pendingBiomeId = id`, then proceeds with the EXISTING transition (`advance()` + rebuild + the
  mutation/colour modals).
- Single-exit boundary (Prison→Sewers, mid→Ramparts): no choice overlay — `pendingBiomeId` stays null,
  `advance()` auto-picks `exits[0]`, then the existing mutation/colour modals fire. UNCHANGED flow.
- Headless / no input: the overlay still draws but the run can't progress without it — so the auto-pick
  fallback in `advance()` (Decision 5) covers any path that does not open the overlay. The verifier NEVER
  constructs GameScene; it drives `advance()` directly with `pendingBiomeId` left null → the deterministic
  default path. **GameScene is the only opener of the overlay; RunState is headless-safe by construction.**
- KISS sequencing: reuse the SAME frozen-modal + `_pauseLevelTimer`/`_resumeLevelTimer` machinery. The
  choice overlay is the FIRST modal in the boundary sequence; the existing mutation → colour modals follow
  on its close (so the player picks route, then perk, then colour). The flask refill + biome power scroll
  still fire on the roll, unchanged.

### Decision 7 — `BiomeChoiceOverlay` (a third frozen-modal picker, cloned)
`entities/BiomeChoiceOverlay.ts`, cloned from `ColorOverlay`/`MutationOverlay`:
- Camera-fixed modal, primitives + text only, own keyboard bus (UP/DOWN/W/S move, E/SPACE/ENTER confirm),
  no ESC bind (GameScene owns ESC → quit-confirm), `close()` teardown, depth band 200.
- Constructed with `{ offers: BiomeConfig[] (the 2 exits), onPick(id) }`. Each row shows the biome NAME
  (`tName('biome', b.id, b.name)`) + a short flavour/route hint (a tier/threat tell) so the choice reads.
- Title/subtitle/help from `t('biomechoice.*')`. A distinct frame colour (e.g. a route-cyan, distinct from
  mutation-green / colour-gold / shop-purple). KISS: 2 rows; the same cursor/render/teardown code.
- It knows NOTHING about RunState (SOLID) — GameScene's `onPick` sets `pendingBiomeId` + drives the roll.
- GameScene owns a `biomeChoiceOpen` flag + a live handle, mirroring `mutationOpen`/`colorPickOpen`: the
  `update()` gate freezes gameplay while open, and `_teardownLevel` force-closes any dangling handle.

### Decision 8 — HUD route readout (optional, KISS)
`hud.depth` already shows `DEPTH {depth} · {biome}`. The biome name now reflects the chosen branch
automatically (it reads `runState.biome().name` via the registry). NO new HUD wiring is strictly required.
**Optional**: append the route (`path` joined) to the GameOver summary line — but to stay tight, ship the
existing depth·biome readout unchanged (it already shows the live biome, which IS the visible branch). No new
HUD i18n key needed for the minimum.

### Decision 9 — i18n: new biome name + choice prompt, BOTH locales
- `OSSUARY.name = 'Ossuary'` is the `en` source (read via `tName` directly — no en.ts content block exists
  for biomes). Add `biome.ossuary = { name: '藏骸所' }` to `zh-CN.ts`'s `biome:` content block.
- Choice-prompt UI chrome — add to BOTH `ui` blocks (`en.ts` + `zh-CN.ts`), read via `t()`:
  - `biomechoice.title` ("CHOOSE YOUR ROUTE" / "选择路线"),
  - `biomechoice.subtitle` ("A fork in the descent — pick the next biome" / "前路分岔 —— 选择下一个生物群系"),
  - `biomechoice.help` (mirror the picker help: "UP/DOWN select · E/SPACE/ENTER confirm" / the zh form),
  - (optional per-row hint key if a flavour line is shown, e.g. `biomechoice.hint` with a `{tier}` param).
- NO bare English literals in the overlay; reuse the existing `t()`/`tName`/`UI_FONT` machinery.

### Decision 10 — verifier: traverse the GRAPH (the load-bearing strengthening)
This is the sensitive change. **Keep §4a/§4a'/§4b/§4d UNCHANGED** (curve monotonicity, tier curve identity,
biome-tier monotonicity along `BIOME_ORDER`, seed determinism). **Strengthen §4c (whole-run monotonicity)
to a graph traversal** plus add graph well-formedness sweeps:

1. **Graph well-formedness** (new sweep, mirroring the §6b enemyPool/boss checks):
   - Every biome in `BIOMES` has an `exits` array; every id in every `exits` resolves to a known biome in
     `BIOMES` (no dangling edge).
   - EXACTLY ONE terminal/boss biome: `Object.values(BIOMES).filter(b => b.endsInBoss === true)` has length
     1 AND that biome's `exits.length === 0`; every NON-boss biome has `exits.length >= 1` (no dead end
     before the boss). At least one node has `exits.length >= 2` (a real choice exists — AC: 2-way choice).
   - The graph is ACYCLIC and every node is REACHABLE from `START_BIOME_ID` (DFS/BFS from root; assert no
     back-edge revisits a node on the current stack → acyclic; assert visited set === all of `BIOMES`).
   - The default path: `BIOME_ORDER` is a valid path through the graph (`BIOME_ORDER[i+1].id ∈
     BIOME_ORDER[i].exits` for all i) starting at `START_BIOME_ID` and ending at the boss biome.

2. **EVERY-PATH monotonicity + boss-termination** (the strengthened §4c): enumerate EVERY simple path from
   `START_BIOME_ID` to the boss biome (the DAG is tiny — full enumeration is cheap). For EACH path:
   - Drive a FRESH `createRunState(RUN_SEED)` and, at each boundary, set `pendingBiomeId` to the path's next
     id BEFORE `advance()` (so the verifier WALKS the real `advance()` chain for that path — an independent
     proof, not self-certification), OR construct the path equivalently and assert
     `effectiveDifficulty(depth, biome)` is non-decreasing across the WHOLE path AND the path ENDS on the
     boss biome (`isLastBiome()` true at completion, `isRunComplete()` fires).
   - Assert biome `difficultyTier` is non-decreasing along the path (a redundant-but-cheap direct check on
     top of the effectiveDifficulty walk — catches a mis-tiered sibling loudly).
   - Run length per path === sum of per-biome `levels` along it; depth at completion === that sum − 1.

3. **EVERY-PATH × EVERY-TIER** (extend §4c'): for each `BOSS_CELL_TIERS` tier, run the per-path walk and
   assert `effectiveDifficulty(depth, biome, tier.bossCellMult)` is non-decreasing AND >= the tier-0 value
   at every step (the tier is a global lift, never an easing) — for EVERY path. By construction
   (`bossCellMult` constant ≥1, curve non-decreasing in depth, tier non-decreasing along every path) this is
   a PROOF, not a filter.

4. **Per-biome generation sweep** (§3 / §6b extension): the N-seed generation sweep + the enemyPool/miniboss
   well-formedness checks must iterate **every node in `BIOMES`** (incl. `OSSUARY`), not just `BIOME_ORDER`
   — so the new biome is bounds/spawn/traversable/clearance/pool-checked like the rest. (Today §3 iterates
   `BIOME_ORDER`; switch the generation + pool sweeps to `Object.values(BIOMES)` so an unreachable-from-the-
   default-path biome is still proven generable.)

> The verifier change is a STRENGTHENING: it now proves monotonicity over EVERY path (not one linear walk),
> proves boss-reachability and full-graph reachability, and proves the new biome generates correctly. Do NOT
> relax any existing assertion to make a path pass — a failing path is a real graph/tier bug.

## 5. Files to touch (implementer checklist)

- **`src/config/biomes.ts`** — add `exits: string[]` to `BiomeConfig`; populate `exits` on PRISON/SEWERS/
  CATACOMBS/RAMPARTS; add the `OSSUARY` config; add `ossuary` to `BIOMES`; keep `BIOME_ORDER` as the
  default linear path (Prison→Sewers→Catacombs→Ramparts); export `START_BIOME_ID`.
- **`src/core/RunState.ts`** — replace `biomeIndex` with `biomeId` + `path` + `pendingBiomeId`; seed to
  `START_BIOME_ID`/`[START_BIOME_ID]`/`null`; rewrite `biome()` to `BIOMES[biomeId]`; rewrite `isLastBiome()`
  to the boss-terminal test; add `defaultNextBiomeId`; rewrite `advance()` to roll via `pendingBiomeId ??
  defaultNextBiomeId` with the exits guard. `isRunComplete`/`isBossLevel`/`isMinibossLevel`/`summary`
  logically unchanged. (Update the `RunSummary`/`RunState` interface fields accordingly.)
- **`src/entities/BiomeChoiceOverlay.ts`** — NEW. Cloned frozen-modal picker (2 biome offers + onPick).
- **`src/scenes/GameScene.ts`** — at a biome boundary with `exits.length >= 2`, open `BiomeChoiceOverlay`
  (set `pendingBiomeId` on pick) BEFORE the `advance()`+rebuild+mutation/colour sequence; add a
  `biomeChoiceOpen` flag + handle mirroring `mutationOpen`; gate `update()`; force-close in `_teardownLevel`.
  Any reference to `runState.biomeIndex` (the `prevBiomeIndex` roll-detection in `_nextLevel`,
  `GameScene.ts:1073`/`:1079`/`:1093`, and the `_grantBiomePowerScroll`/`_offerMutation` salts that read
  `biomeIndex`, `GameScene.ts:2585`/`:2602`) must switch to a stable id-based salt (e.g.
  `path.length` or a hash of `biomeId`) so seeded offers stay deterministic.
- **`src/scenes/HUDScene.ts`** — no change required (the depth·biome readout already shows the live branch).
  Optional: nothing for the minimum.
- **`src/i18n/en.ts`** — add `biomechoice.title`/`.subtitle`/`.help` (+ optional `.hint`) to `ui`.
- **`src/i18n/zh-CN.ts`** — same `biomechoice.*` keys in `ui`; add `biome.ossuary = { name: '藏骸所' }` to
  the `biome:` content block.
- **`scripts/verify-gen.mjs`** — import `BIOMES`/`START_BIOME_ID`; switch the §3 generation sweep + §6b
  enemyPool/miniboss sweep to iterate `Object.values(BIOMES)`; add the graph well-formedness sweep; replace
  the linear §4c walk with the EVERY-PATH monotonicity + boss-termination + full-graph-reachability proof;
  extend §4c' to per-path × per-tier. Keep §4a/§4a'/§4b/§4d unchanged.

## 6. Identity preservation (the additive-identity guarantee)

- **Default path === today's run.** `defaultNextBiomeId` returns `exits[0]`, and `SEWERS.exits[0] ===
  'catacombs'`, so a run that makes no choice (headless / auto-pick / the verifier) walks
  `Prison→Sewers→Catacombs→Ramparts` — the exact `BIOME_ORDER` chain, same biomes, same `levels`, same depth
  curve, same seed chain. The whole-run length and within-path difficulty are byte-structurally identical.
- **Regression pin untouched.** The level regression pin (`PIN_*`) and determinism deep-equal sweep are
  PRISON-shaped and read generation output; adding `exits` to a biome config does not change `generateLevel`
  output (the generator ignores `exits`, as it ignores `name`/`tier`/`levels`). Re-run `npm run verify` to
  confirm the pin holds; if the pin's field allowlist needs `exits` excluded, exclude it (do not let a pure
  metadata field drift the pin).
- **No biomeIndex consumers left stale.** Every read of `runState.biomeIndex` (GameScene roll-detection +
  seeded-offer salts) migrates to the id/path model with an EQUIVALENT deterministic salt so seeded mutation/
  power-scroll offers replay identically for the default path.
- **The picker is opt-in.** It only opens when `exits.length >= 2` AND GameScene has input. A headless or
  auto-pick run never sees it and never deviates from the default path.
- **New fields default to neutral identity.** `pendingBiomeId: null` (auto-pick), `path:
  [START_BIOME_ID]` (the root), `biomeId: START_BIOME_ID` (the opener). No behaviour changes until a choice
  is made.

## 7. Verifier notes (explicit obligations the implementer cannot skip)

1. **Do NOT weaken the proof.** The whole-run monotonicity walk MUST cover EVERY path (full DAG path
   enumeration from root to boss), each asserting non-decreasing `effectiveDifficulty` AND boss-termination.
2. **Graph well-formedness sweep** (new, KISS guardrail mirroring §6b): all `exits` resolve; exactly one boss
   terminal with empty exits; every non-boss node has ≥1 exit; ≥1 node has ≥2 exits (a real choice); the
   graph is acyclic; every node reachable from `START_BIOME_ID`; `BIOME_ORDER` is a valid root→boss path.
3. **Per-tier × per-path** monotonicity + non-weakening-vs-tier-0 holds for EVERY path (extend §4c').
4. **Generation + pool sweeps iterate `BIOMES`** (every node, incl. `OSSUARY`) — bounds, no-wall-spawn,
   traversable, body-clearance, ≥2 layout templates, enemyPool well-formed, miniboss id resolves.
5. **Determinism (§4d)** holds: two fresh RunStates from the same seed with the same pending choices advance
   in lockstep (extend the lockstep check to set `pendingBiomeId` identically on both).
6. **`OSSUARY.difficultyTier === 2`** (== Catacombs) so BOTH Sewers-exit routes are tier-monotone; the
   per-path walk fails loudly if a sibling is mis-tiered.

## 8. Acceptance criteria

- **AC1** Each biome transition with ≥2 exits offers a 2-way biome CHOICE via a reused MutationOverlay-style
  picker; the chosen biome is the one built next.
- **AC2** Every reachable path from the start to the boss biome has non-decreasing `effectiveDifficulty`
  (verifier-proven over every path) and ENDS at the boss biome (Ramparts).
- **AC3** A linear DEFAULT path (auto-pick / headless / verifier) still works and is byte-structurally
  identical in run length + within-path difficulty to today's run (`Prison→Sewers→Catacombs→Ramparts`).
- **AC4** A new alternate mid biome (`OSSUARY`, tier 2) exists so a real 2-way choice (Catacombs vs.
  Ossuary) is offered at the Sewers boundary; both converge on Ramparts.
- **AC5** Determinism preserved: a seeded run with the same choices replays the same biome/seed/depth
  sequence; the level regression pin + determinism deep-equal are unaffected.
- **AC6** The verifier's path-monotonicity proof, graph well-formedness sweep, full-graph reachability,
  per-biome generation sweep over `BIOMES`, and per-tier × per-path walks all pass; the existing per-tier
  + biome-tier + seed-determinism walks are unchanged and pass.
- **AC7** i18n: the new biome name + the choice-prompt chrome add BOTH locale strings (`en` via config
  `name`/`ui`; `zh-CN` via the `biome:` content block + `ui`); no bare English literals in the overlay.
- **AC8** `npm run build` + `npm run verify` are green.
