# Build & Replay Systems (mutations + timed-clear bonus)

## 1. Background

The run already has solid build divergence: 6 run-scrolls, a 4-weapon + weapon-affix engine,
a 10-row meta tree, an in-run shop, tagged room types, and treasure branches. What it lacks vs
Dead Cells is a **choice-driven run-power system you pick between areas** — Dead Cells'
**mutations** (pick 1-of-3 perks at each level, occupying limited slots) are its signature
replay lever: every run you build a different perk loadout from the same pool.

This slice was selected as a bundle: *mutations + color-coded build scaling + timed doors +
hidden rooms*. Two of those are large, invasive, or generator-risky; this doc **scopes the
slice to the two highest-value, lowest-risk pieces** and explicitly defers the other two with
rationale (a decision for you to confirm — §5.6). The architecture already provides the seams:

- `config/scrolls.ts` — the `{ id, name, apply(run) }` pure-data pattern mutating run-only
  `RunState` fields **in place** (the exact shape a mutation needs).
- `RunState` — persists across level rebuilds (it is **not** re-created per level), so any field
  a mutation sets carries for the rest of the run for free; `GameScene._syncPlayerScrollStats`
  already pushes those fields to the live `Player`.
- `entities/ShopOverlay.ts` — a paused, registry-free, keyboard-navigated **choice overlay**
  (`_openShop` freezes gameplay via `shopOpen`; up/down/confirm). A mutation picker mirrors it.
- `_nextLevel` (`GameScene.ts:798`) already has a **biome-transition seam** (it refills flasks +
  grants a power scroll on `biomeIndex` change) — the natural place to offer a mutation choice.
- `Door` + the `transitioning` guard + `RunState` + `Pickup` — everything a timed-clear bonus
  needs (a level timer + a speed reward), with no door surgery.
- `scripts/verify-gen.mjs` sweeps every pure config table for well-formedness.

## 2. Requirements Summary

- **Primary — Mutations:** a pure `MUTATIONS` table; on each biome transition, offer a **seeded
  3-of-N choice** in a paused overlay; the picked mutation applies to the live `RunState` and
  persists for the rest of the run; the HUD lists active mutations.
- **Secondary — Timed-clear bonus:** a per-level timer; reaching the exit before a threshold
  grants bonus gold/cells (the speed-incentive "timed door" essence, without a new door entity).
- **Deferred (with rationale, §5.6):** **color-coded build scaling** (Brutality/Tactics/Survival)
  and **hidden rooms** — invasive to the core damage model / generator-soundness respectively;
  proposed as their own later slices. **No partial stubs shipped.**
- **Non-goals (YAGNI):** mutation rarity tiers, re-rolling, mutation removal/refund, a mutation
  shop.

## 3. Acceptance Criteria

1. NEW pure `src/config/mutations.ts` — `MUTATIONS` table (`{ id, name, desc, apply(run) }`)
   reusing the `ScrollRunState`-style field pattern + a few new simple live-read fields/flags;
   plus `MUTATIONS_BY_ID` + `MUTATION_ORDER`. **No Phaser import** (verifier-importable).
2. On each biome transition, the player is offered a **choice of 3** mutations drawn
   deterministically from the run seed (a paused overlay mirroring `ShopOverlay`); selecting one
   calls its `apply(runState)`.
3. A chosen mutation **persists for the rest of the run** (it sets `RunState` fields/flags that
   survive level rebuilds) and is reflected on the player via the existing sync; a run where no
   mutation is offered/chosen plays exactly as before (empty list = identity).
4. `HUDScene` lists the run's active mutations (registry-only, decoupled).
5. **Timed-clear bonus:** each normal level starts a timer; reaching the exit `Door` before
   `CLEAR_BONUS_TIME` grants a bonus (gold + cells) with an FX/HUD pop; over the threshold = no
   bonus (no penalty). HUD shows the running timer.
6. `scripts/verify-gen.mjs` sweeps `MUTATIONS`: non-empty; each `apply` is a function;
   identity-safe (applying every mutation to a fresh `RunState` never throws and never lowers a
   bigger-is-better field). `npm run verify` green.
7. Deferred items documented with rationale; nothing half-built committed.

## 4. Problem Analysis

- **Approach A — mutations as more meta-upgrades** (Hub-bought, permanent) → rejected: meta is
  *permanent cross-run* power; mutations are *per-run, in-run choices* — that's the replay value
  (a different loadout each run). They belong on `RunState`, not `MetaState`.
- **Approach B — auto-grant a random mutation per biome (no choice)** → rejected: the *choice*
  (1-of-3) is the build lever; auto-grant is just another scroll. The cost is one overlay,
  which mirrors `ShopOverlay`.
- **Approach C (chosen) — a pure `MUTATIONS` table + a seeded 3-of-N picker overlay on the
  existing biome-transition seam, applied to `RunState`.** Maximum reuse of the scroll-field +
  overlay + RunState-persistence patterns; minimal new surface (one table, one overlay, a few
  `RunState` fields, one offer site).
- **Timed-clear:** reuse `Door`/`RunState`/`Pickup` — a level timer + a reward on the existing
  `_onDoorOverlap` path. No generator/door entity change (KISS).

## 5. Decision Log

**1. Choice cadence + offer site.**
- Decision: offer on **biome transition** (the `_nextLevel` `biomeIndex`-change branch,
  `GameScene.ts:811`, where flasks refill + the power scroll is granted). With 4 biomes that's 3
  offers/run — Dead-Cells-paced (a handful of meaningful picks), not one-per-room spam. KISS:
  reuses an existing seam. (A per-level cadence is a later tuning knob.)

**2. Choice UI.**
- Decision: a new `entities/MutationOverlay.ts` mirroring `ShopOverlay` — paused (reuse the
  `shopOpen`-style gameplay freeze so the world halts on the gameplay dt), 3 rows, up/down to
  move, confirm to pick. Reuses the shop's input keys/idiom (DRY). One pick, then close +
  unfreeze.

**3. Seeded 3-of-N pick.**
- Decision: draw 3 distinct mutations off an **off-the-main-thread sub-RNG** seeded from the run
  seed ⊕ a biome salt (same discipline as the weapon-pickup/room-type/template picks) so a run
  **replays the same offers** and the generator's pinned draw thread is untouched.

**4. Effect hooks (reuse first, add minimally).**
- Decision: most mutations reuse **existing** live-read `RunState` fields (`scrollDamageMult`,
  `scrollLifestealFrac`, `scrollStatusDurationMult`, `scrollDodgeCdMult`, `maxFlasks`, …) so
  they need zero new wiring (DRY with scrolls). A few add **simple** new live-read
  fields/flags read at one site each, e.g.:
  - `onKillHealAmount` (heal N HP on an enemy kill — read in the `enemy.onDeath` hook),
  - `lowHpDamageMult` (more damage while below a HP threshold — folded at the resolveHit site),
  - `firstHitBonusMult` (bonus damage vs a full-HP enemy).
  Each is a pure scalar/flag on `RunState`, defaulting to the neutral identity. KISS: ship
  ~6-8 mutations, biased toward the zero-new-wiring ones.

**5. Persistence + sync.**
- Decision: `RunState.mutations: string[]` records the picked ids (for the HUD + summary);
  `apply(run)` mutates the live fields in place. Because `RunState` survives level rebuilds and
  `_syncPlayerScrollStats` runs each build, effects persist + reach the player with no extra
  code. Cooldown/per-room mutation state (none this slice) would reset — N/A here.

**6. DEFERRED — color-coded scaling + hidden rooms (confirm the cut).**
- **Color-coded build scaling (Brutality/Tactics/Survival)** → deferred: it re-architects the
  *core damage model* — every weapon/skill/scroll would gain a color, and damage would scale by
  the matching color's invested scrolls (touching `damage.ts`'s callers, every weapon's
  identity, the scroll table, and the meta fold). High blast radius, low visibility next to
  mutations. Proposed as its own dedicated slice.
- **Hidden rooms** → deferred: secret areas need **generator** support (a concealed region +
  passage) under the strict soundness/pin discipline (`LevelGenerator` keeps the regression pin
  byte-stable, branches are off-the-main-thread + width-gated). The existing **treasure branch**
  already covers "optional reward detour"; a true hidden room is a generator slice of its own.
- Decision: **defer both**; build mutations + timed-clear now. *(This is the one item I want
  confirmed before implementing — if you'd rather fold one in now, say so.)*

## 6. Design

### 6.1 `src/config/mutations.ts` (new, pure)

```ts
import type { ScrollRunState } from './scrolls.js'
// MutationRunState = ScrollRunState + the few new live-read fields (all neutral by default).
export interface MutationRunState extends ScrollRunState {
  onKillHealAmount: number; lowHpDamageMult: number; /* … */
}
export interface MutationSpec { id: string; name: string; desc: string; apply: (run: MutationRunState) => void }
export const MUTATIONS: MutationSpec[] = [
  { id: 'berserker', name: 'Berserker', desc: '+30% damage below 40% HP',
    apply: r => { r.lowHpDamageMult = Math.max(r.lowHpDamageMult, 1.3) } },
  { id: 'vampire', name: 'Vampire', desc: 'Heal 12% of melee damage',
    apply: r => { r.scrollLifestealFrac += 0.12 } },              // reuses an existing field.
  { id: 'predator', name: 'Predator', desc: 'Heal 3 HP per kill',
    apply: r => { r.onKillHealAmount += 3 } },
  { id: 'toxic', name: 'Toxic', desc: '+50% status duration',
    apply: r => { r.scrollStatusDurationMult *= 1.5 } },          // reuses an existing field.
  { id: 'nimble', name: 'Nimble', desc: '-20% dodge cooldown',
    apply: r => { r.scrollDodgeCdMult *= 0.8 } },                 // reuses an existing field.
  // … ~6-8 total.
]
export const MUTATIONS_BY_ID = Object.fromEntries(MUTATIONS.map(m => [m.id, m]))
export const MUTATION_ORDER = MUTATIONS.map(m => m)
```

### 6.2 `RunState` (`src/core/RunState.ts`)

- Add `mutations: string[] = []` + the new live-read fields (`onKillHealAmount: 0`,
  `lowHpDamageMult: 1`, …) seeded to neutral in `createRunState` (the identity).
- Extend the `ScrollRunState` consumers / `_syncPlayerScrollStats` to carry the reused fields
  (they already are) + the player reads the new ones at their single sites.

### 6.3 `GameScene` wiring

- **Offer:** in `_nextLevel`'s biome-change branch (after `_grantBiomePowerScroll`), call
  `_offerMutation()` → seed a sub-RNG, pick 3 distinct `MUTATION_ORDER` entries, open
  `MutationOverlay` (freeze gameplay); on pick → `spec.apply(this.runState)`,
  `runState.mutations.push(id)`, `_syncPlayerScrollStats()`, close + unfreeze + `sound.uiSelect()`.
- **New effect sites (one each):**
  - `enemy.onDeath` hook → `this.player.heal(runState.onKillHealAmount)` (if > 0).
  - resolveHit damage fold → multiply by `lowHpDamageMult` when `player.hp/maxHp < THRESH`
    (alongside the existing `meleeDamageMult × scrollDamageMult`).
- **HUD registry:** write `mutations` (joined names) for the HUD.

### 6.4 Timed-clear bonus

- `_buildLevel`: stamp `this.levelStartedAt = this.time.now` (skip on boss/miniboss levels).
- `_onDoorOverlap`/`_nextLevel`: if `now - levelStartedAt <= CLEAR_BONUS_TIME` (e.g. 45s),
  grant `runState.gold += BONUS_GOLD` and `runState.cells += BONUS_CELLS`, pop an FX + a HUD
  flash + `sound.pickup('gold')`. Over the threshold → nothing (no penalty).
- HUD: a small per-level timer (registry `levelTime`) that turns amber as it nears the
  threshold (so the incentive reads).

### 6.5 `entities/MutationOverlay.ts` (new)

A trimmed clone of `ShopOverlay`: a centered panel listing the 3 offered `{name, desc}`, a
cursor, up/down to move, confirm to pick (calls an `onPick(id)` callback), no "leave" (you must
pick one — the offer is a gift). Paused via the same gameplay-freeze flag GameScene already uses
for the shop.

### 6.6 Verifier (`scripts/verify-gen.mjs`)

Add a section (mirroring the scrolls/shop sweeps): import `MUTATIONS`; assert non-empty; each
has a string `id`/`name` + a function `apply`; build a fresh `RunState`, snapshot the
bigger-is-better fields, run **every** `apply`, and assert none threw and none *decreased* a
bigger-is-better field / increased a smaller-is-better one (the same "never weakens" sense the
upgrade sweep uses) — so a malformed mutation fails loudly under node.

### Identity safety

`mutations: []` + neutral new fields = a run with no mutation is byte-identical. Reused scroll
fields already compose at their hit sites. The timed bonus only **adds** currency on a fast
clear (never subtracts). No existing pure-table contract changes; deferred features ship
nothing.

## 7. Files Changed

- **NEW** `src/config/mutations.ts`
- **NEW** `src/entities/MutationOverlay.ts`
- `src/core/RunState.ts` — `mutations[]` + new neutral live-read fields
- `src/scenes/GameScene.ts` — `_offerMutation`, the two effect sites, timed-clear bonus +
  `levelStartedAt`, HUD registry
- `src/scenes/HUDScene.ts` — mutations list + level timer
- `scripts/verify-gen.mjs` — `MUTATIONS` sweep
- (input nav reused from the shop overlay idiom — no new keys)

## 8. Verification

1. `npm run verify` — green (new `MUTATIONS` sweep + identity-safety pass; level pin unchanged).
2. `npm run typecheck` — passes.
3. Manual (`npm run dev`): cross a biome boundary → a 3-mutation overlay (gameplay frozen);
   pick one → its effect is live (e.g. lifesteal heals on hit; predator heals on kill;
   berserker boosts damage at low HP); the pick persists across the next levels + shows on the
   HUD; the same run seed offers the same mutations (replay); clear a level fast → the
   timed bonus pops; clear slowly → no bonus, no penalty; a run where you decline nothing extra
   behaves as before.
