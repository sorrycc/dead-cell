# F8 Traversal Runes — permanent meta-keys that unlock OPTIONAL routes + treasure doors

## 1. Background

Dead Cells' **traversal runes** are permanent, banked-between-runs unlocks that open *otherwise-locked*
parts of the world: an extra branch you couldn't take before, or a sealed door hiding guaranteed loot. The
default route is always walkable rune-less — a rune only ever ADDS reachable content. This is the meta loop
tying into the map: each run you bank widens what NEXT run's map can offer.

We already own **every seam** this needs — EXTEND, never duplicate:

- **The banked-unlock seam (blueprints).** `config/blueprints.ts` is a pure catalog
  (`id`/`name`/`kind`/`desc` + `BLUEPRINTS_BY_ID` lookup + `BLUEPRINT_IDS` ordered list). `MetaState`
  persists a `blueprints: string[]` (set-union merge in `bankRun`, defensive load/clone in
  `util/save.ts`). A rare in-run **pickup** drops a LOCKED blueprint (`GameScene._maybePlaceBlueprintPickup`,
  off a distinct off-pin RNG mix `0xb1ce9111`); collecting records it on `runState.blueprints`; `bankRun`
  merges it on BOTH the death + clear paths. The Hub lists each blueprint UNLOCKED/LOCKED generically.
  **Runes are a SECOND such catalog + a SECOND banked `Set`, modelled identically.**
- **The branching biome graph.** `config/biomes.ts` carries `BIOMES` (id→config), each with an
  `exits: string[]` edge list. `exits[0]` is the canonical DEFAULT next (auto-pick / headless / verifier
  walk it). `SEWERS.exits = ['catacombs', 'ossuary', 'frostworks']` — three siblings (all tier 2),
  converging on `RAMPARTS`. `BIOME_ORDER = [PRISON, SEWERS, CATACOMBS, RAMPARTS]` is the default path
  (`exits[0]` at each fork). `RunState.advance()` consults `pendingBiomeId` (the picker's commit), else
  `defaultNextBiomeId(biomeId)` (= `exits[0]`). `GameScene._offerBiomeChoice()` maps the current node's
  exits → `BiomeConfig[]` → the `BiomeChoiceOverlay`; `onPick` → `_applyBiomeChoice` sets `pendingBiomeId`.
- **The interact-on-E treasure interactable seam.** `entities/CursedChest.ts` (modelled on
  `entities/Shop.ts`) is a stand-on interactable: a drawn rect + Arcade SENSOR body, `markInRange()` /
  `resetInRange()`, a floating `[E]` prompt, an `opened` one-shot flag. `GameScene._maybePlaceCursedChest`
  places it off a distinct off-pin RNG mix (`0xc0bb1e`); `_tryOpenChest` reads the E edge AFTER
  `_tryOpenShop`; `_openCursedChest` grants loot via `_equipWeaponWithAffix(id, affixId, LOOT_RARITY)` +
  the F2 rarity fold. **A locked TREASURE DOOR is a THIRD such interactable, modelled on the chest minus
  the curse.**
- **The guaranteed-loot path.** `_openCursedChest` already shows the exact loot grant we want: pick a
  weapon not currently equipped, roll an affix (`_rollWeaponAffix`), equip at a high rarity
  (`_equipWeaponWithAffix(..., LOOT_RARITY)` where `LOOT_RARITY = 'epic'`). Reuse verbatim.
- **Pure config + verifier.** `scripts/verify-gen.mjs` node-imports `BLUEPRINTS` and sweeps catalog
  well-formedness (`§13`), and proves the biome graph sound + EVERY simple root→boss path tier-monotone +
  difficulty-monotone (`§4b'`, `enumeratePaths`, `walkPath`, `§4c`). The rune catalog gets the SAME
  guardrail; the path proof is STRENGTHENED to prove the rune-less graph stays fully traversable.
- **i18n.** `i18n/en.ts` + `i18n/zh-CN.ts` via `t()`/`tName`/`tDesc`. Rune names/descs + the
  treasure-door prompts add BOTH locales.

What is **missing**: there is no rune catalog, no banked rune `Set`, no rune-gated exit edges, no locked
treasure door, and no Hub rune readout. We add exactly that, all gated behind owning a rune so a fresh save
plays byte-identically.

### Distinct from BLUEPRINTS (do not confuse them)

A **blueprint** unlocks a run-POOL row (a new weapon/skill/mutation enters the seeded draw — it changes
your *character build options*, and MUST be blueprint-gated so the determinism pins hold). A **rune**
unlocks *world content* — an extra map branch and/or an in-level treasure door. A rune feeds NO seeded run
pool, so it does NOT touch `runWeaponPool`/`runSkillPool`/`runMutationPool` and is therefore exempt from
the §2/§13 pool-pin determinism contract (Decision 8 below makes this explicit). They share the catalog +
banked-`Set` + pickup + `bankRun`-merge SHAPE; their *effects* are independent.

## 2. Requirements Summary

- **A new pure `config/runes.ts`** (NO Phaser) mirroring `blueprints.ts`: a `RuneEntry`
  (`id`/`name`/`desc`) interface, an ordered `RUNES: RuneEntry[]`, `RUNES_BY_ID` lookup, `RUNE_IDS` list.
  PLAIN DATA, verifier-swept.
- **`MetaState` banks owned runes** as a `runes: string[]` persisted like `blueprints` (defensive
  load/clone in `util/save.ts`; set-union merge in `bankRun`; `getRunes()`/`isRuneUnlocked(id)` reads).
- **Runes are EARNED by a rare in-run drop** (Decision 8 — KISS, the proven blueprint path), banked at run
  end on BOTH death + clear paths. NOT bought with Cells (YAGNI — no new sink/cost machinery).
- **Some EXTRA exit edges are rune-gated** in `config/biomes.ts` via a `requiresRune?: string` tag on a
  NON-default exit. `SEWERS.exits[0]` (`catacombs`) is NEVER gated; `ossuary` + `frostworks` become
  rune-gated EXTRA routes. The default path (and every path the verifier walks rune-less) stays intact.
- **An in-level locked TREASURE DOOR** (`entities/TreasureDoor.ts`, modelled on `CursedChest`): placed
  rarely off a distinct off-pin RNG mix on NORMAL levels; opens with E ONLY when the player owns its
  required rune, granting GUARANTEED high-rarity loot (reuse the F2 fold). A clear locked/unlocked tell.
  No curse — pure upside (the rune was the cost).
- **HubScene lists owned/locked runes** (one read-only row per `RUNES` entry, generic — same pattern as the
  blueprint rows), with how they're earned in the desc.
- **`scripts/verify-gen.mjs` sweeps the rune catalog** (well-formed) AND STRENGTHENS the path proof: prove
  the DEFAULT (rune-less) graph is FULLY traversable to the boss + tier-monotone, and that gated edges
  never disconnect any biome on the rune-less path. The existing reachability/monotonicity proof is NOT
  weakened.
- **ADDITIVE IDENTITY**: a default save owns NO runes → all gated exits filtered out → the offered routes
  collapse to exactly today's (Sewers' picker shows only Catacombs ⇒ no fork ⇒ the auto-pick default path,
  byte-structurally === today's run). No treasure door opens (locked). Every config field defaults to the
  neutral identity.

## 3. Non-Goals (YAGNI)

- **No Cells purchase of runes.** One earning path (drop + bank), not two. (Integration map said "pick ONE".)
- **No new rune-gated BIOME.** Runes gate EXISTING extra siblings (`ossuary`/`frostworks`) + treasure
  doors. No new biome config.
- **No rune-gated weapons/skills/mutations.** Runes gate world content only; pool unlocks stay blueprints.
- **No multi-rune doors / rune tiers / consumable runes.** A rune is a permanent boolean unlock.
- **No new HUD line.** Runes are a meta/Hub readout + an in-world door tell; the run HUD is unchanged.

## 4. Decisions (the contract)

### Decision 1 — `config/runes.ts` is a pure catalog mirroring `blueprints.ts`

```ts
export interface RuneEntry { id: string; name: string; desc: string }
export const RUNES: RuneEntry[] = [
  // Two runes ship this slice — one per rune-gated EXTRA sibling so the Sewers fork is unlockable both ways.
  { id: 'rune_vine',  name: "Vine Rune",  desc: 'Opens the Ossuary branch + grappled treasure doors.' },
  { id: 'rune_frost', name: "Frost Rune", desc: 'Opens the Frostworks branch + frozen treasure doors.' },
]
export const RUNES_BY_ID: Record<string, RuneEntry> = Object.fromEntries(RUNES.map((r) => [r.id, r]))
export const RUNE_IDS: string[] = RUNES.map((r) => r.id)
```

NO Phaser import (node-importable — the CI gate node-imports it). Two runes, NOT one: the Sewers fork has
two rune-gated siblings (`ossuary`, `frostworks`), so two runes lets a run-to-run player widen the fork
from 1 → 2 → 3 routes. Each `requiresRune` tag in `biomes.ts` MUST reference a real `RUNES_BY_ID` id
(verifier-asserted, both ways — no orphan tag, no orphan catalog entry). The names are programmer-art
flavour; the *id* is the stable contract carried on Meta/Run state.

### Decision 2 — `MetaState` banks owned runes like blueprints (defensive)

`util/save.ts`:
- `MetaState` interface gains `runes: string[]` (the permanently-owned rune ids).
- `DEFAULT_META` seeds `runes: []` (the IDENTITY — no runes). A pre-slice save back-fills it via loadMeta's
  spread, exactly as `blueprints` does.
- `loadMeta` CLONES it defensively: `merged.runes = Array.isArray(merged.runes) ? merged.runes.slice() : []`
  (a back-filled field must NOT alias the frozen `DEFAULT_META.[]`, the same leak the blueprint clone fixes;
  a corrupt non-array degrades to empty).

`core/MetaState.ts` (`MetaStateInstance`):
- `getRunes(): string[]` → `meta.runes`.
- `isRuneUnlocked(id: string): boolean` → `meta.runes.includes(id)`.
- `bankRun` gains a `runes?: string[]` arg, merged set-union/dedup EXACTLY like `blueprints`:
  `for (const id of runes) if (!meta.runes.includes(id)) meta.runes.push(id)`. Defaults to `[]` (a caller
  that passes no runes is a no-op — additive).

### Decision 3 — `biomes.ts` marks EXTRA exits rune-gated (default exit NEVER gated)

The graph edge becomes a richer shape. **Keep `exits: string[]` but add a parallel optional gate map** so
the existing `exits[0]`-is-default invariant + every existing read site (`advance()`, `defaultNextBiomeId`,
`enumeratePaths`, `walkPath`) stays byte-identical for the rune-less case. New per-biome OPTIONAL field:

```ts
// requiresRune?: a map of exit-biome-id → the rune id that gates that EDGE. An exit NOT in the map is
// ALWAYS traversable (rune-less). HARD INVARIANT: exits[0] is NEVER a key here (the default path is never
// gated). A run filters its OFFERED exits to (un-gated ∪ gated-and-owned); advance()'s default path
// (exits[0] / pendingBiomeId) is untouched — the rune-less run always reaches the boss.
requiresRune?: Record<string, string>
```

`SEWERS` gains:
```ts
exits: ['catacombs', 'ossuary', 'frostworks'], // UNCHANGED — exits[0] === 'catacombs' (default, never gated).
requiresRune: { ossuary: 'rune_vine', frostworks: 'rune_frost' }, // the EXTRA siblings are rune-gated.
```

No other biome gets `requiresRune` this slice. The invariant the verifier enforces (Decision 9):
`requiresRune` NEVER contains `exits[0]`; every value is a real `RUNES_BY_ID` id; every key is a real
`exits` entry of that biome.

A small pure helper lives in `biomes.ts` (DRY — one source for "which exits are open given owned runes"):
```ts
// runeOpenExits(biome, runes: Set<string>) → the exit ids this biome offers given the owned runes:
// exits[0] (default) is ALWAYS included; a gated exit is included only if its rune is owned. PURE — the
// picker + the verifier both call it (so "what a rune-less run sees" is proven against the real source).
export function runeOpenExits(biome: BiomeConfig, runes: Set<string>): string[]
```
`runeOpenExits(b, new Set())` MUST return `[exits[0], ...un-gated exits]` (never empty for a non-boss
biome) — the rune-less invariant. (Today every Sewers exit beyond `catacombs` becomes gated, so a rune-less
Sewers returns exactly `['catacombs']` ⇒ no fork ⇒ the default path — the additive identity.)

### Decision 4 — `GameScene` filters offered exits by owned runes

`GameScene` already builds `this.unlockedBlueprints = new Set(this.meta.getBlueprints())` at run start.
Add `this.ownedRunes = new Set(this.meta.getRunes())` (a run-start snapshot — a rune banked mid-run only
matters NEXT run, like blueprints).

In `_offerBiomeChoice()`, REPLACE the raw exits map with the rune-filtered list:
```ts
const openIds = runeOpenExits(this.runState.biome(), this.ownedRunes)
const offers = openIds.map((id) => BIOMES[id]).filter((b): b is BiomeConfig => !!b)
```
The existing `if (offers.length < 2) { this._continueTransition(); return }` fallback then handles the
collapsed case for free: a rune-less Sewers yields `['catacombs']` ⇒ `offers.length === 1` ⇒ NO overlay ⇒
the inline auto-pick continuation (`pendingBiomeId` stays null ⇒ `advance()` walks `exits[0]`) — exactly
today's behaviour. Owning `rune_vine` ⇒ `['catacombs','ossuary']` ⇒ a real 2-way fork; both runes ⇒ a
3-way fork (today's full picker). The boundary predicate at the door (`rs.biome().exits.length >= 2`,
`_nextLevel`) must ALSO consult the filtered count so a rune-less run never opens an empty/1-row overlay —
change it to gate on `runeOpenExits(rs.biome(), this.ownedRunes).length >= 2`.

`_applyBiomeChoice` is UNCHANGED — `pendingBiomeId` is only ever set to an id the picker offered (always
rune-open), and `advance()`'s exits-guard already falls back to `exits[0]` if an unknown id slips in.

### Decision 5 — the in-level locked TREASURE DOOR (`entities/TreasureDoor.ts`)

A THIRD stand-on interactable, modelled on `entities/CursedChest.ts` minus the curse:
- a drawn rect (a distinct colour — e.g. a sealed-stone grey with a rune-coloured frame) + Arcade SENSOR
  body, `markInRange()` / `resetInRange()`, an `opened` one-shot flag, `setOpened()` dims it, `destroy()`.
- It carries `requiredRuneId` (the rune that opens it) and a `locked` boolean. The floating prompt shows
  `t('treasure.locked', { rune: <name> })` when the player lacks the rune, `t('treasure.prompt')` when they
  own it — the clear locked/unlocked TELL (Decision 7).

`GameScene`:
- `_maybePlaceTreasureDoor(desc)`: deterministic off a **distinct off-pin RNG mix** (a NEW constant, e.g.
  `0x7ea5e1` — uncorrelated with the weapon/skill/shop/chest/barrel/blueprint/branch mixes; off the
  generator's pinned draw so the level pin + determinism deep-equal stay intact). A LOW chance
  (`TREASURE_DOOR_CHANCE` pinned in `config/runes.ts`, verifier-swept). NEVER on a boss/miniboss level
  (guard like `_maybePlaceCursedChest`). Pick the gating rune deterministically from `RUNE_IDS` off the
  SAME RNG; place at a standable spawn candidate off the ends. Stash the placement seed (the open-time loot
  roll is deterministic per seed). Wire the in-range overlap exactly like the chest.
- `_tryOpenTreasureDoor()`: called on the SAME E edge as `_tryOpenChest`, RIGHT AFTER it (one E opens at
  most one interactable — guard `!this.shopOpen` + `!this.chest?.playerInRange-just-opened`; reuse the
  chest's guard set). Opens ONLY if `this.ownedRunes.has(door.requiredRuneId)`; if locked, show a brief
  "needs the X rune" banner + a denied SFX, leave it shut (the carrot you can come back for next run).
- `_openTreasureDoor()`: grant GUARANTEED high-rarity loot via the EXACT `_openCursedChest` weapon path
  (`_equipWeaponWithAffix(weaponId, affixId, LOOT_RARITY)`), OR the scroll+gold alternative — reuse the
  chest's two-outcome roll verbatim (DRY). NO curse (the rune was the cost; a treasure door is pure
  upside). Mark opened, banner + SFX cue.

The door is run-only world dressing; it banks nothing. (Runes are banked via the DROP, Decision 8.)

### Decision 6 — the locked/unlocked TELL

The door's FRAME colour + prompt encode its state at a glance (programmer-art):
- **Locked (no rune):** a dimmed fill + a grey/rune-tinted frame + prompt `t('treasure.locked', {rune})`.
- **Unlocked (rune owned):** a bright fill + a gold frame + prompt `t('treasure.prompt')` — reads like a
  reward you can take NOW.
- **Opened:** dimmed (`setOpened`), no prompt, no pulse (inert) — the spent look.
The prompt + frame are recomputed against `this.ownedRunes` at placement time (a run-start snapshot, so the
state is stable for the whole level).

### Decision 7 — i18n (BOTH locales)

`i18n/en.ts` + `i18n/zh-CN.ts` add, via the existing `ui`/`names`/`descs` machinery:
- `treasure.prompt` → `[E] TREASURE` / `[E] 宝藏`
- `treasure.locked` → `[{rune}] SEALED — needs a rune` / `【{rune}】封印 —— 需要符文`
- `treasure.opened` (banner) → `TREASURE!` / `获得宝藏！`
- `treasure.denied` (banner when locked + E) → `Sealed — you lack the rune.` / `已封印 —— 缺少符文。`
- rune NAMES via `names.rune.<id>` (read by `tName('rune', id, fallback)`) + rune DESCS via
  `descs.rune.<id>` (read by `tDesc('rune', id, fallback)`) — both locales, mirroring `blueprint`/`biome`.
- Hub rune rows reuse the existing `hub.unlocked` / `hub.locked` / a new `hub.runePrefix` (`RUNE` / `符文`).
NO bare English literals in UI. Hub column alignment stays pixel-anchored (the rune rows reuse the
blueprint rows' `COL_NAME/MID/AUX/DESC` x-anchors).

### Decision 8 — runes are EARNED by a rare in-run drop, banked at run end (KISS — the blueprint path)

Mirror `_maybePlaceBlueprintPickup` EXACTLY (the proven, lowest-risk earning path):
- `RunState` gains a run-only `runes: string[]` (default `[]` — the identity; banked at run end, like
  `blueprints`).
- `_maybePlaceRunePickup(desc)`: off a **distinct off-pin RNG mix** (a NEW constant, e.g. `0xb1ce92aa`),
  drop ONE LOCKED rune (not in `this.ownedRunes` AND not in `runState.runes`) at a low
  `RUNE_PICKUP_CHANCE` (pinned in `config/runes.ts`). Collecting records the id on `runState.runes` (dedup).
- The **pickup pool** (`entities/Pickup.ts`) gains a `'rune'` kind carrying a `runeId` (mirroring the
  `'blueprint'` kind's `blueprintId`) — a drawn glyph (programmer-art) + the touch-to-collect path that
  pushes `runState.runes`.
- `bankRun` calls pass `runes: this.runState.runes` on BOTH the death + the clear paths (the THREE existing
  `this.meta.bankRun({...})` call sites — death, complete, victory — each gain `runes:`), so a rune is
  permanent the instant it's banked, like a Cell/blueprint.

**Why a DROP, not a Cells buy:** the drop+bank machinery already exists end-to-end (pickup pool, RunState
list, bankRun merge, defensive load) — a Cells buy would need a new cost table + a Hub buy row + a sink
balance pass (YAGNI). The integration map said "Pick ONE" — this is it.

### Decision 9 — runes feed NO seeded run pool → exempt from the §2/§13 determinism pins

A rune unlocks WORLD content (exits, doors), never a `runWeaponPool`/`runSkillPool`/`runMutationPool` row.
So `config/runes.ts` carries NO `blueprint` tag, references NO pool table, and the §13 pool-pin sweeps are
UNTOUCHED. The verifier asserts this explicitly: the rune catalog ids are DISJOINT from the blueprint tags
(a rune id must not collide with a blueprint id — they live in separate banked Sets). This is the line that
keeps the seed-replay determinism pins (`runWeaponPool(new Set())` etc.) byte-stable — adding runes cannot
perturb them by construction.

### Decision 10 — `scripts/verify-gen.mjs` sweeps the rune catalog + STRENGTHENS the path proof

Import `RUNES`, `RUNES_BY_ID`, `RUNE_IDS`, `runeOpenExits`, `RUNE_PICKUP_CHANCE`, `TREASURE_DOOR_CHANCE`.

**(a) Rune catalog well-formedness** (a new sweep mirroring §13c's blueprint shape):
- `RUNES` non-empty; `RUNES_BY_ID` size === `RUNES.length` (no dup/missing id); `RUNE_IDS` matches order.
- every entry has a non-empty string `id`/`name`/`desc`.
- rune ids are DISJOINT from blueprint ids (Decision 9 — no banked-Set collision).
- `RUNE_PICKUP_CHANCE` ∈ (0, 1); `TREASURE_DOOR_CHANCE` ∈ (0, 1) (RARE — both well below 1, like the chest).

**(b) Rune-gate well-formedness** (extend the graph proof §4b'):
- for every biome with `requiresRune`: every KEY is a member of that biome's `exits`; every VALUE is a real
  `RUNES_BY_ID` id (no orphan tag); `exits[0]` is NEVER a key (the HARD invariant — default never gated).
- every rune in `RUNES` is referenced by ≥1 `requiresRune` value (no orphan catalog entry — a dead rune is
  a content bug). (Both runes this slice gate a Sewers sibling.)

**(c) Rune-LESS traversability + monotonicity (the load-bearing strengthening — do NOT weaken the existing
proof).** Build a **filtered graph** view: `runeLessExits(biome) = runeOpenExits(biome, new Set())`
(`= exits[0] + un-gated exits`). Re-run the EXISTING graph soundness + path enumeration + per-path
walk against THIS filtered view:
- the rune-less graph is still ACYCLIC, has exactly ONE boss terminal, every non-boss node has ≥1
  rune-less exit (no node is stranded — `runeLessExits` is never empty off the default), every node is
  REACHABLE from `START_BIOME_ID` via rune-less edges, and `BIOME_ORDER` is a valid rune-less root→boss
  path (each consecutive pair is a rune-less exit — by construction, since `exits[0]` is never gated).
- `enumeratePaths()` over the rune-less view yields ≥1 path; EVERY rune-less path is `walkPath`-driven
  through the REAL `advance()` chain and proven `effectiveDifficulty`-non-decreasing + `difficultyTier`-non-
  decreasing + boss-terminating + correct length (the existing §4c/§4c' walk, re-run on the filtered paths).
- the FULL graph proof (all runes owned — today's `BIOMES` exits) is UNCHANGED and STILL PASSES (the
  existing §4b'/§4c/§4c' run, untouched). So both extremes — rune-less (identity) and all-runes (today) —
  are proven traversable + monotone. (Owning *some* runes yields a path that is a subset of the all-runes
  paths, each already proven — no extra enumeration needed.)
- assert the rune-less Sewers offers exactly `['catacombs']` (`runeOpenExits(SEWERS, new Set())`) — the
  concrete additive-identity pin: a rune-less run sees NO Sewers fork ⇒ the default path ⇒ today's run.

This is an INDEPENDENT proof: the verifier re-derives the rune-less reachability from the real config +
the real `advance()` surface, so a mis-gated `exits[0]` or an unreachable rune-less biome fails LOUDLY
under node, not at runtime.

## 5. Additive-Identity Obligations (the byte-identity contract)

- `DEFAULT_META.runes = []`; `RunState.runes = []`; both default to the empty identity. A pre-slice save
  back-fills `runes: []` (loadMeta spread) → no runes → identity.
- `runeOpenExits(b, new Set())` returns `[exits[0], ...un-gated]`. With `SEWERS.requiresRune` gating BOTH
  non-default siblings, a rune-less Sewers returns `['catacombs']` → `_offerBiomeChoice`'s `< 2` fallback →
  the inline auto-pick → `advance()` walks `exits[0]` → `BIOME_ORDER` → today's run byte-structurally.
- `requiresRune` is an OPTIONAL field; every other biome omits it → `runeOpenExits` returns all exits
  (unchanged). The `BiomeConfig` shape gains one optional key — the generator never reads it (like
  `miniboss`/`layoutWeights`), so generated levels are byte-identical.
- The treasure door + rune pickup place off NEW distinct off-pin RNG mixes at LOW chances; they DO NOT
  touch the generator's pinned draw → the level regression pin + determinism deep-equal stay intact. A
  rune-less run still hits a locked door it can't open (no loot, no curse) — pure additive content, and the
  loot grant only fires for a rune-owner (gated state).
- Runes feed no run pool → `runWeaponPool(new Set())` / `runSkillPool(new Set())` / `runMutationPool(new
  Set())` are byte-unchanged (Decision 9).

## 6. Monotonicity / Never-Weaken Obligations

- `requiresRune` only ever ADDS reachable exits (a rune can only widen the offered fork, never remove the
  default). The rune-less path set ⊆ the all-runes path set; both proven tier- + difficulty-monotone.
- The treasure door is pure upside (guaranteed high loot, no penalty) — owning more runes never makes a run
  harder; the difficulty curve along EVERY rune-less AND all-runes path stays non-decreasing (the verifier
  re-runs the existing §4c/§4c' walk on both views).
- `RUNE_PICKUP_CHANCE` / `TREASURE_DOOR_CHANCE` are pinned constants (verifier-bounded), not scaling.

## 7. i18n Obligations

EVERY new user-facing string adds BOTH `en.ts` AND `zh-CN.ts`: `treasure.prompt`, `treasure.locked`,
`treasure.opened`, `treasure.denied`, `hub.runePrefix`, plus `names.rune.<id>` + `descs.rune.<id>` for each
rune. Read via `t()` / `tName('rune', …)` / `tDesc('rune', …)`. Hub rune rows reuse the blueprint rows'
pixel-anchored `COL_*` x-positions (CJK fallback isn't monospaced — keep the column math identical).

## 8. Verifier-Sweep Obligations

`scripts/verify-gen.mjs` MUST, in addition to everything it already proves (do NOT weaken):
1. Sweep `config/runes.ts` for catalog well-formedness + disjointness-from-blueprints + the chance bounds
   (Decision 10a).
2. Assert the `requiresRune` gates are well-formed (keys ∈ exits, values ∈ RUNES, `exits[0]` never gated,
   no orphan rune) (Decision 10b).
3. Prove the RUNE-LESS graph fully traversable to the boss + tier-monotone + difficulty-monotone via the
   filtered-graph re-run of the existing soundness + `enumeratePaths` + `walkPath` proof; AND keep the
   existing FULL-graph proof passing unchanged (Decision 10c).
4. Pin `runeOpenExits(SEWERS, new Set()) === ['catacombs']` (the concrete additive-identity assertion).

## 9. Files to Touch

- **NEW** `src/config/runes.ts` — the pure rune catalog (`RUNES` / `RUNES_BY_ID` / `RUNE_IDS`) +
  `RUNE_PICKUP_CHANCE` + `TREASURE_DOOR_CHANCE` (pinned constants).
- **NEW** `src/entities/TreasureDoor.ts` — the locked-treasure interactable (modelled on `CursedChest`).
- `src/util/save.ts` — `MetaState.runes` field + `DEFAULT_META.runes = []` + defensive clone in `loadMeta`.
- `src/core/MetaState.ts` — `getRunes()` / `isRuneUnlocked()` + `bankRun({ runes })` merge.
- `src/core/RunState.ts` — run-only `runes: string[]` field (default `[]`).
- `src/config/biomes.ts` — `requiresRune?` field on `BiomeConfig` + `SEWERS.requiresRune` + the pure
  `runeOpenExits(biome, runes)` helper.
- `src/entities/Pickup.ts` — a `'rune'` pickup kind carrying `runeId` (mirroring `'blueprint'`).
- `src/scenes/GameScene.ts` — `this.ownedRunes` snapshot; rune-filtered `_offerBiomeChoice` + the boundary
  predicate; `_maybePlaceRunePickup`; `_maybePlaceTreasureDoor` + `_tryOpenTreasureDoor` +
  `_openTreasureDoor`; the `runeId` collect path; `runes:` on the three `bankRun` calls.
- `src/scenes/HubScene.ts` — read-only rune rows (one per `RUNES`, generic, blueprint-row pattern).
- `src/i18n/en.ts` + `src/i18n/zh-CN.ts` — rune names/descs + treasure-door prompts + `hub.runePrefix`.
- `scripts/verify-gen.mjs` — the rune-catalog sweep + the rune-gate sweep + the STRENGTHENED rune-less
  path proof (Decision 10 / §8).

## 10. Acceptance Criteria

1. **Rune-less identity.** A default save (no runes) reaches every biome and completes the run; the Sewers
   boundary offers no fork (rune-less Sewers → `['catacombs']` → auto-pick) → the run is byte-structurally
   today's Prison→Sewers→Catacombs→Ramparts. `runWeaponPool/SkillPool/MutationPool(new Set())` byte-unchanged.
2. **Rune unlocks an extra branch.** Owning `rune_vine` makes the Sewers picker offer Catacombs + Ossuary
   (a real 2-way fork); owning both runes offers all three siblings. The default exit is always present.
3. **Rune unlocks a treasure door.** A locked treasure door shows a SEALED tell rune-less (E does nothing
   but a "need the rune" banner); owning its rune, E opens it for GUARANTEED high-rarity loot (F2 fold),
   no curse. Opened doors are inert.
4. **Runes are earned + banked.** A rare in-run rune drop is collectible; banking it (death OR clear)
   makes it permanent (Hub shows UNLOCKED next run); a run with all runes owned drops none.
5. **Hub readout.** HubScene lists every rune UNLOCKED/LOCKED (read-only) with how it's earned, in BOTH
   locales, columns pixel-aligned.
6. **i18n.** All new UI text exists in `en.ts` AND `zh-CN.ts`; no bare English literals.
7. **Verifier proves the rune-less graph.** `verify-gen.mjs` sweeps the rune catalog (well-formed, disjoint
   from blueprints, chance bounds), asserts the `requiresRune` gates well-formed (default never gated), and
   proves the RUNE-LESS graph fully traversable to the boss + tier-monotone + difficulty-monotone (the
   existing reachability/monotonicity proof is NOT weakened; the full-graph proof still passes).
8. **Verifier + build green.** `npm run verify` (or the project's verify task) + the TS build pass with no
   new errors; the level regression pin + determinism deep-equal are intact.
