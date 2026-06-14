# F6 New Biome — a 6th biome (FROSTWORKS) as a second tier-2 alternate off the Sewers fork

## 1. Background

Today the biome GRAPH (F4 branching-biome-map) is:

```
PRISON(t0) ─▶ SEWERS(t1) ─┬─▶ CATACOMBS(t2) ─┐
                          └─▶ OSSUARY(t2)  ──┴─▶ RAMPARTS(t3, boss)
```

`SEWERS.exits = ['catacombs', 'ossuary']` — a 2-way fork. `BIOME_ORDER = [PRISON, SEWERS, CATACOMBS,
RAMPARTS]` is the canonical DEFAULT LINEAR PATH (auto-pick walks `exits[0]` at each node). `BIOMES` is the
authoritative graph node set the verifier sweeps. The whole machinery — graph model in `RunState`, the
`BiomeChoiceOverlay` picker (opens IFF `exits.length >= 2`), the verifier's every-path monotonicity proof,
the per-biome generation sweep over `Object.values(BIOMES)` — is ALREADY built and proves any extra node.

This slice **widens the Sewers fork to 3 choices** by adding a SIXTH biome, **FROSTWORKS** (an ICE/FROST
cavern), as ANOTHER tier-2 alternate alongside Catacombs and Ossuary, converging on Ramparts. It ships its
own cut-down 2-phase miniboss, **THE GLACIER WARDEN**, drawn from the existing five boss primitives.

This is a **PURE-CONFIG + i18n add**. There is NO engine change: the generator reads a biome by config keys,
the Boss FSM dispatches a miniboss spec by attack kind (all five primitives already handled), `RunState`
reads `BIOMES[id]` and rolls along `exits`, the picker already renders N offers, and the verifier already
sweeps every node in `BIOMES` + every spec in `BOSS_ORDER`. We add one biome object, one boss spec, wire two
graph edges, and add two locale names. Everything else is exercised, not modified.

We reuse **every seam** — EXTEND, never duplicate:

- **Pure biome config.** `config/biomes.ts` (node-importable, no Phaser): the CATACOMBS/OSSUARY pattern is
  the template. A biome is a plain object with `exits`, `difficultyTier`, `levels`, `endsInBoss`,
  `miniboss`, `enemyPool`, `layoutWeights`, size/count bands, and `colors`.
- **Pure boss config.** `config/bosses.ts` (node-importable): the three existing minibosses
  (PRISON/SEWERS/CATACOMBS) are the template for a cut-down 2-phase spec. Add to `BOSSES` + `BOSS_ORDER`.
- **The graph + picker.** `SEWERS.exits` gains a third id; the picker (`entities/BiomeChoiceOverlay.ts`)
  already renders all offers and opens on `exits.length >= 2` — NO overlay change (it iterates `offers`).
- **The verifier.** `scripts/verify-gen.mjs` §3 sweeps `Object.values(BIOMES)` (generation/pool/clearance/
  ≥2-layout-templates), §6b asserts every biome's `miniboss` resolves + every non-boss biome HAS a miniboss,
  §6c sweeps `BOSS_ORDER` for boss-table well-formedness, and §4c enumerates EVERY root→boss path for
  tier-monotonicity + boss-termination + full reachability. The new node + spec pass all of it with NO
  verifier edit — confirm, don't change.
- **i18n.** `zh-CN.ts` carries `boss:` + `biome:` content blocks (id→name overrides); `en` reads the config
  object's own `name` via `tName`. Add the new biome + miniboss zh names; en is the config `name`.

**What's missing:** the third Sewers alternate (FROSTWORKS) and its miniboss. We add exactly that.

## 2. Requirements Summary

- **Add FROSTWORKS to `config/biomes.ts`** following the CATACOMBS/OSSUARY pattern EXACTLY (every field).
  `difficultyTier: 2` (== Catacombs == Ossuary) so EVERY Sewers-exit route is tier-monotone. `exits:
  ['ramparts']` (converges on the boss). Add `frostworks` to `BIOMES`. Add `'frostworks'` to `SEWERS.exits`
  (appended LAST so `exits[0] === 'catacombs'` is unchanged → the default path is byte-identical).
- **Do NOT change `BIOME_ORDER`** (still `[PRISON, SEWERS, CATACOMBS, RAMPARTS]`) — preserves the additive
  identity (the default linear run is unchanged).
- **Add THE GLACIER WARDEN miniboss to `config/bosses.ts`**: a cut-down 2-phase spec (descending thresholds,
  the first 1.0), known attack kinds only, every referenced attack present, telegraph/active > 0. Add to
  `BOSSES` + `BOSS_ORDER`. Set `FROSTWORKS.miniboss = 'frostworksMiniboss'`.
- **i18n** (BOTH locales): biome name (`FROSTWORKS.name = 'Frostworks'` is the en source; add
  `biome.frostworks = { name: '冰封工坊' }` to zh-CN) + miniboss name
  (`name: 'The Glacier Warden'` en source; add `boss.frostworksMiniboss = { name: '冰川守望者' }` to zh-CN).
- **Verifier + build green.** Confirm the new node + spec pass every existing sweep; NO verifier edit needed.

## 3. The graph after this slice

```
PRISON(t0) ─▶ SEWERS(t1) ─┬─▶ CATACOMBS(t2)  ─┐
                          ├─▶ OSSUARY(t2)    ─┤
                          └─▶ FROSTWORKS(t2) ─┴─▶ RAMPARTS(t3, boss)
```

- `SEWERS.exits = ['catacombs', 'ossuary', 'frostworks']` — now a **3-way choice** at the Sewers fork.
  `exits[0] === 'catacombs'` is preserved (the default / auto-pick / verifier path is unchanged).
- `FROSTWORKS.exits = ['ramparts']` — the new alternate rejoins at the boss biome.
- All three mid biomes are tier 2; Ramparts is tier 3. EVERY path (Prison→Sewers→{Catacombs|Ossuary|
  Frostworks}→Ramparts) is length 4, tier-monotone (0→1→2→3), 12 generated rooms + boss — IDENTICAL run
  length regardless of choice.

> **YAGNI / KISS.** A third sibling at the SAME tier is the simplest sound add: the `exits` model + the
> picker + the verifier's path enumeration already support N alternates with ZERO code change. The flavour
> difference is the ENEMY/LAYOUT/palette mix, NOT the difficulty tier (the proof checks every path
> independently and requires monotone tiers, not equal-difficulty siblings). Do NOT raise FROSTWORKS to a
> higher tier "for variety" — that would make it "harder now", not a sibling, and is unnecessary.

## 4. Numbered decisions

### Decision 1 — FROSTWORKS biome config (tier 2, parallel to Catacombs/Ossuary)

Add to `config/biomes.ts`, mirroring the CATACOMBS/OSSUARY shape EXACTLY (DRY — the generator reads identical
keys). A FROST/ICE cavern aesthetic (cold cyan/white programmer-art ints), distinct from green Sewers,
violet Catacombs, rust Ossuary, grey Ramparts. Concrete spec:

```ts
export const FROSTWORKS: BiomeConfig = {
  id: 'frostworks',
  name: 'Frostworks',                 // en source (read via tName); zh override in zh-CN biome block.
  difficultyTier: 2,                  // == Catacombs/Ossuary → every Sewers-exit route is tier-monotone.
  endsInBoss: false,
  miniboss: 'frostworksMiniboss',     // The Glacier Warden (Decision 2) — a present id must resolve to a known boss.
  exits: ['ramparts'],                // converges on the boss biome.
  levels: 3,                          // SAME length as the sibling mid biomes (identical run length per choice).
  // Enemy pool — a DISTINCT mix from Catacombs (spitter/flyer crypt) and Ossuary (shooter/charger galleries):
  // a SHIELDER + KAMIKAZE "frozen press" feel (slow frontal tanks + brittle rushers down icy halls) over a
  // grunt base, with a light flyer. References ONLY known archetype ids (grunt/shooter/charger/flyer/spitter/
  // bomber/kamikaze/shielder per ENEMY_ARCHETYPES) with positive weights.
  enemyPool: [
    { id: 'grunt', w: 2 },
    { id: 'shielder', w: 3 },         // the signature frozen-tank tilt (a wall of ice-guards).
    { id: 'kamikaze', w: 2 },         // brittle rushers shatter into you (distinct from the others' pressure).
    { id: 'flyer', w: 2 },            // an aerial sprinkle so the roster still varies.
    { id: 'bomber', w: 1 },           // a light lobbed-splash zoner (kept distinct from the sibling mixes).
  ],
  // Layout mix — a STAIRCASE-heavy descent (frozen terraces) so it reads spatially distinct from Ossuary's
  // islands + Catacombs' shaft, with shaft + islands as alternates (≥2 templates across the sweep — verified).
  layoutWeights: [
    { id: 'staircase', w: 5 },
    { id: 'shaft', w: 2 },
    { id: 'islands', w: 2 },
  ],
  cols: 82, rows: 25,                 // within [COLS_MIN=40, COLS_MAX=120] / [ROWS_MIN=18, ROWS_MAX=30].
  minEnemies: 4, maxEnemies: 7,       // same band as the sibling mid biomes (tier-2 density).
  minPickups: 2, maxPickups: 4,
  oneWayLedges: 8,
  hazardPatches: 8,                   // icy hazard patches (render-driven, in-band with the siblings).
  platformLenRange: [3, 6],
  colors: {
    solid: 0x3b5a6e,                  // cold steel-blue stone.
    oneWay: 0x7fb3c9,                 // frosted-ice ledges (pale cyan).
    hazard: 0x5dade2,                 // ice-spike hazard (bright cyan — reads as "cold = danger").
    bg: 0x0c1620,                     // deep frozen-night backdrop.
    entrance: 0x2ecc71,              // green (shared marker — keep consistent with the other biomes).
    exit: 0xf4d03f,                  // yellow exit slab (shared — the goal reads).
  },
}
```

> Exact colour ints are programmer-art and may be nudged for readability, but must stay distinct from the
> other five biomes and keep `entrance`/`exit` consistent (green/yellow) so the goal reads everywhere.

### Decision 2 — THE GLACIER WARDEN miniboss (cut-down 2-phase, the five primitives)

Add to `config/bosses.ts`, mirroring the existing miniboss specs (PRISON/SEWERS/CATACOMBS_MINIBOSS). A
miniboss is a cut-down boss spec — fewer HP, a 2-phase kit from the same five primitives
(`slam`/`volley`/`dash`/`sweep`/`summon`) — that rides the EXISTING Boss FSM + `scaleBossSpec` depth fold +
the boss HP bar with ZERO engine change. It guards FROSTWORKS's last normal level (the room KEEPS its exit
Door). HP sized between Ossuary's reused Bone Warden (270) and lighter than a finale (it's a tier-2 mid
set-piece) — pick **maxHp ≈ 255**. A frost identity = a **sweep**-led ranged zoner with a **slam** to
punish and a **dash** to close; phase 2 tightens telegraphs, moves faster, and adds a **summon** beat (it
"calls the frozen guards") — a genuinely new pressure than the spitter/shooter-led sibling minibosses.

```ts
export const FROSTWORKS_MINIBOSS: BossSpec = {
  id: 'frostworksMiniboss',
  name: 'The Glacier Warden',         // en source; zh override in zh-CN boss block.
  maxHp: 255,
  bodyW: 66, bodyH: 82,
  color: 0x5499c7,                    // resting fill (glacier blue — the Frostworks palette).
  colorTelegraph: 0xf5d76e,           // pale-gold wind-up tell (AC56).
  colorHurt: 0xffffff,
  colorPhase: 0xe74c3c,
  knockbackTakeMult: 0.26,
  contactDamage: 13,
  contactCooldown: 0.7,
  hitstun: 0.0,
  hurtIframe: 0.06,
  phases: [
    // Phase 1 (100%→50%): a sweep/dash/slam zoning rotation — readable telegraphs (the first MUST be 1.0).
    { hpThreshold: 1.0, telegraphMult: 0.92, moveSpeed: 90, attacks: ['sweep', 'dash', 'slam'] },
    // Phase 2 (≤50%): tightens telegraphs, moves faster, ADDS the summon beat (the back-half escalation, AC56).
    { hpThreshold: 0.5, telegraphMult: 0.74, moveSpeed: 120, attacks: ['sweep', 'summon', 'slam', 'dash'] },
  ],
  attacks: {
    slam: {
      kind: 'slam', telegraph: 0.66, active: 0.16, recovery: 0.55,
      swing: { reach: 108, halfHeight: 56, forward: 28, damage: 18, knockback: 470 },
    },
    dash: {
      kind: 'dash', telegraph: 0.66, active: 0.4, recovery: 0.72,
      speed: 720, contactDamage: 21, knockback: 520,
    },
    sweep: {
      kind: 'sweep', telegraph: 0.74, active: 0.13, recovery: 0.62,
      count: 12, projectile: { speed: 330, damage: 14, knockback: 200, lifetime: 2.3, w: 14, h: 14 },
    },
    summon: {
      kind: 'summon', telegraph: 0.85, active: 0.1, recovery: 0.65,
      count: 2, spec: 'grunt', maxAdds: 2,   // small adds; spec is a known archetype; cap matches the other minibosses.
    },
  },
}
```

Then wire the table:

```ts
export const BOSSES: Record<string, BossSpec> = { ...existing, frostworksMiniboss: FROSTWORKS_MINIBOSS }
export const BOSS_ORDER: BossSpec[] = [ ...existing, FROSTWORKS_MINIBOSS ]
```

> **Contract every entry must hold (verifier §6c):** ≥2 phases; `phases[0].hpThreshold === 1.0`; thresholds
> strictly descending; every `phase.telegraphMult > 0`; every attack kind in a phase pattern is in
> `BOSS_ATTACK_KINDS` AND present in the `attacks` map; every referenced attack has `telegraph > 0` and
> `active > 0`. The spec above satisfies all of it. `summon.spec` must be a known archetype (`grunt`).

### Decision 3 — wire the graph edges

In `SEWERS.exits`, APPEND `'frostworks'` LAST:

```ts
exits: ['catacombs', 'ossuary', 'frostworks'],   // exits[0] === 'catacombs' UNCHANGED → default path byte-identical.
```

Add to the `BIOMES` map:

```ts
export const BIOMES: Record<string, BiomeConfig> = { prison, sewers, catacombs, ossuary, frostworks, ramparts }
```

Leave `BIOME_ORDER` UNCHANGED (`[PRISON, SEWERS, CATACOMBS, RAMPARTS]`). FROSTWORKS lives ONLY in the graph
(`BIOMES`), like OSSUARY — the default path takes Catacombs.

### Decision 4 — i18n (BOTH locales)

- **Biome name.** `FROSTWORKS.name = 'Frostworks'` is the en source (read via `tName('biome', id, name)`).
  Add to `zh-CN.ts`'s `biome:` content block: `frostworks: { name: '冰封工坊' }`.
- **Miniboss name.** `FROSTWORKS_MINIBOSS.name = 'The Glacier Warden'` is the en source (read via
  `tName('boss', id, name)`). Add to `zh-CN.ts`'s `boss:` content block:
  `frostworksMiniboss: { name: '冰川守望者' }`.
- **No new UI chrome keys.** The picker title/subtitle/help (`biomechoice.*`) already exist in both locales
  and render any number of offers; the new offer's name flows through `tName`. NO `ui` block change.
- No bare English literals anywhere — the name is config-sourced (en) / content-block-sourced (zh) via the
  existing `t()`/`tName` machinery.

### Decision 5 — verifier: confirm, don't change

The verifier ALREADY proves everything this slice needs because the graph/boss sweeps iterate the full sets:

- **§3 generation sweep** iterates `Object.values(BIOMES)` → FROSTWORKS is bounds/no-wall-spawn/traversable/
  body-clearance checked over N=200 seeds, AND its layout space is asserted to show ≥2 templates (the
  staircase-heavy mix above produces multiple shapes across the sweep — confirm).
- **§6b** asserts every biome's `enemyPool` references only known archetype ids with positive weights (the
  pool above does), every biome's `miniboss` (if present) resolves to a known boss (`frostworksMiniboss` will
  once added to `BOSSES`), and every non-boss biome DECLARES a miniboss (FROSTWORKS does).
- **§6c** sweeps `BOSS_ORDER` for the boss-table well-formedness contract → THE GLACIER WARDEN is checked
  (≥2 descending phases, first 1.0, known kinds present, telegraph/active > 0, scaleBossSpec never weakens /
  never aliases the base attacks).
- **§4c** enumerates EVERY root→boss path → the new Prison→Sewers→Frostworks→Ramparts path is proven
  tier-monotone (0→1→2→3), boss-terminating, with run length === Σ levels; full-graph reachability now
  includes `frostworks` (visited set === all of `BIOMES`); the graph stays acyclic; `BIOME_ORDER` is still a
  valid root→boss path.

**Implementer obligation:** run `npm run verify` and CONFIRM all of the above pass with the new node + spec.
Do NOT relax any assertion to make it pass — a failure is a real config bug (a mis-tier, a dangling
miniboss id, an unknown enemy id, a malformed phase). The ONLY verifier edit that could be warranted is the
descriptive count string at the tail (e.g. "N bosses+minibosses well-formed") if it hard-codes a count — it
reads `BOSS_ORDER.length`, so it self-updates; no edit expected.

## 5. Files to touch (implementer checklist)

- **`src/config/biomes.ts`** — add the `FROSTWORKS` config (Decision 1); append `'frostworks'` to
  `SEWERS.exits` (LAST — Decision 3); add `frostworks: FROSTWORKS` to the `BIOMES` map. Do NOT touch
  `BIOME_ORDER`. Do NOT reorder `SEWERS.exits` (keep `exits[0] === 'catacombs'`).
- **`src/config/bosses.ts`** — add the `FROSTWORKS_MINIBOSS` spec (Decision 2); add it to `BOSSES` +
  `BOSS_ORDER`.
- **`src/i18n/en.ts`** — NO change needed (biome + miniboss en names come from the config `name` via
  `tName`; the picker chrome keys already exist). (Listed for completeness; verify no edit is required.)
- **`src/i18n/zh-CN.ts`** — add `frostworks: { name: '冰封工坊' }` to the `biome:` block; add
  `frostworksMiniboss: { name: '冰川守望者' }` to the `boss:` block.
- **`scripts/verify-gen.mjs`** — NO edit expected; run it to CONFIRM the new node + spec pass §3/§4c/§6b/§6c.

> No `RunState`, no `GameScene`, no `BiomeChoiceOverlay`, no generator, no HUD change. The overlay already
> renders N offers and opens on `exits.length >= 2`; the FSM already dispatches all five primitives. This is
> additive config + two zh names.

## 6. Identity preservation (the additive-identity guarantee)

- **Default path === today's run.** `SEWERS.exits[0]` stays `'catacombs'`, so a run that makes no choice
  (headless / auto-pick / the verifier) walks `Prison→Sewers→Catacombs→Ramparts` — the exact `BIOME_ORDER`
  chain, same biomes, same `levels`, same depth curve, same seed chain. `BIOME_ORDER` is byte-unchanged.
- **Regression pin untouched.** The level regression pin (`PIN_*`) is PRISON-shaped and reads generation
  output; adding a new biome object + a new boss spec does NOT touch PRISON or `generateLevel`. The
  determinism deep-equal sweep regenerates every `BIOMES` node twice — the new node passes by construction
  (the generator is deterministic). Re-run `npm run verify` to confirm the pin holds.
- **Determinism pins (verify-gen §13/§5) untouched.** FROSTWORKS feeds NO seeded run pool — it adds NO
  weapon/skill/mutation, so `runWeaponPool(new Set())` / `runSkillPool(new Set())` /
  `runMutationPool(new Set())` are unaffected (the starter-identity pin holds). New ENEMIES are NOT
  introduced — the pool reuses the EXISTING 8 archetypes (established practice to add known ids to a biome
  pool). NO blueprint gating is needed (nothing new feeds a run pool).
- **Monotonicity / never-weaken.** FROSTWORKS is tier 2 (== its siblings) so EVERY path stays tier-monotone;
  it does NOT make any earlier biome harder (it's a NEW mid node, not a retune). The miniboss only adds a
  spec; `scaleBossSpec` is unchanged and never-weakens. No cost/curve is touched.
- **New fields default to neutral.** There are NO new fields — FROSTWORKS uses the existing `BiomeConfig`
  shape and `FROSTWORKS_MINIBOSS` the existing `BossSpec` shape. No interface change.
- **The picker is opt-in.** The 3-way fork only opens for a player with input; a headless/auto-pick run
  never sees it and never deviates from the default Catacombs path.

## 7. Acceptance criteria

- **AC1** A 6th biome FROSTWORKS (tier 2, FROST/ICE palette, distinct enemy + layout mix) exists in
  `config/biomes.ts` following the CATACOMBS/OSSUARY pattern (all fields), in `BIOMES`, with
  `exits: ['ramparts']`.
- **AC2** The Sewers fork offers FROSTWORKS: `SEWERS.exits === ['catacombs', 'ossuary', 'frostworks']`
  (a 3-way choice), with `exits[0] === 'catacombs'` unchanged.
- **AC3** A cut-down 2-phase miniboss THE GLACIER WARDEN (`frostworksMiniboss`) exists in `config/bosses.ts`
  (descending thresholds, the first 1.0, known attack kinds, every referenced attack present, telegraph &
  active > 0), is in `BOSSES` + `BOSS_ORDER`, and is set as `FROSTWORKS.miniboss`.
- **AC4** FROSTWORKS generates within bounds over the N-seed sweep (cols/rows in range, no wall spawns,
  traversable, body-clear, ≥2 layout templates) — verifier-proven for the new `BIOMES` node.
- **AC5** EVERY reachable path (incl. Prison→Sewers→Frostworks→Ramparts) is tier-monotone (0→1→2→3) and
  reaches the boss; every biome (incl. `frostworks`) is reachable from `START_BIOME_ID`; the graph stays
  acyclic — verifier-proven.
- **AC6** The DEFAULT linear run is byte-unchanged: `BIOME_ORDER` is identical, `SEWERS.exits[0]` is
  `'catacombs'`, the level regression pin + determinism deep-equal + starter-pool identity pins are
  unaffected.
- **AC7** i18n: the biome name + miniboss name add BOTH locale strings (en via config `name`/`tName`;
  zh-CN via the `biome:` + `boss:` content blocks); no bare English literals in the picker (it renders the
  offer via `tName`).
- **AC8** `npm run build` + `npm run verify` are green, with NO verifier edit (confirm-only).
