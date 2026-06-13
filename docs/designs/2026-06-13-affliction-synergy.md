# Affliction Synergy + HUD Legibility (bleed / poison / stun / burn)

## 1. Background

The status system shipped in the boss-status-parity + §6.13 slices is mechanically complete but
**flat**: bleed/poison/stun apply, tick, and expire (`src/combat/status.ts`, pure + pinned), and
they tint the enemy's resting fill (`Enemy._updateVisual` Enemy.ts:631-647, mirrored in
`Boss._updateVisual` Boss.ts:598-603). Weapons carry a status tag (spear→bleed weapons.ts:171,
hammer→stun weapons.ts:116, bow→poison weapons.ts:138), the `WEAPON_VENOMOUS` affix can ADD a
bleed (weapons.ts:232), the `Toxic`/`Venom` mutation/scroll already lengthen duration
(`scrollStatusDurationMult`), and skills can apply a status (skills.ts:90/116).

But two things are missing versus the genre's "affliction build":

1. **READ.** A status only changes the enemy's *resting* fill colour, which the urgent
   telegraph/hurt flashes override (Enemy.ts:635-646) — so during a fight you frequently can't
   tell *which* affliction is stacked, or that one is on at all. There is also **no cue on
   application** (the bow's poison lands silently; only DoT *ticks* pop a number via
   `effects.statusTick`, Effects.ts:74). The player cannot SEE the affliction land or read it
   mid-fight.
2. **BUILD ENGINE.** Nothing **scales damage versus an afflicted target**. The whole point of a
   DoT/CC build in this genre is the *synergy*: "+X% damage to bleeding enemies", "afflictions
   tick harder", "killing an afflicted enemy spreads it". The current tables (mutations, weapon
   affixes, scrolls) have no hook that reads the *victim's* status list, so an affliction build is
   just "the DoT chips a bit" — it never becomes a damage multiplier the player builds around.

The architecture already provides every seam this needs: the per-hit damage fold
(`GameScene._mutationDamageMult` GameScene.ts:1650, multiplied into `resolveHit`'s `damageMult` at
BOTH player hit sites GameScene.ts:1606/1677), the status-arming fold (`GameScene._scaleStatus`
GameScene.ts:1634, the single site that scales an applied status), the run-only perk-field pattern
on `RunState` (the `MutationRunState`/`ScrollRunState` "pure scalar defaulting to neutral identity"
idiom), and the `enemy.onDeath`/`onDrop` death hooks (GameScene.ts:1426-1442). `status.ts` already
has `hasStatus(statuses, kind)` for a clean victim-status read.

## 2. Requirements Summary

- **READ — per-enemy indicator + application cue.** Make bleed/poison/stun/burn legible on each
  enemy at a glance: a small per-enemy affliction **icon** (a tiny tinted marker above the body,
  pooled like `frontMarker`) that shows the dominant live affliction even *during* a telegraph,
  PLUS a **floating damage-type cue** ("BLEED"/"POISON"/"STUN"/"BURN") popped once when a status is
  first applied (not on every DoT tick — KISS, application-only).
- **BUILD ENGINE — amplification hooks.** Add hooks so mutations / weapon-affixes / scrolls can
  scale damage vs afflicted targets and make afflictions stronger:
  - `vsAfflictedDamageMult` — ×player damage when the struck enemy carries ANY live affliction
    ("+X% damage to afflicted enemies"), folded into the per-hit `_mutationDamageMult`.
  - `statusTickMult` — ×DoT `tickDmg` when arming a damaging status ("afflictions tick harder"),
    applied in `_scaleStatus` alongside the existing duration mult.
  - `spreadAffliction` (flag) — when an **afflicted** enemy dies, copy its dominant damaging
    affliction to nearby enemies ("killing an afflicted enemy spreads the affliction").
- **≥2 new synergy mutations and/or weapon affixes** that use the hooks (we ship **2 mutations**:
  `Hemorrhage` = +25% damage vs afflicted enemies + spread-on-kill; `Virulent` = afflictions tick
  +50% harder — AND **1 weapon affix**: `Searing` = ADD a **burn** DoT, so all three hooks ship
  with content).
- **Optional new BURN status** — a 4th damaging status kind (mechanically identical to bleed/poison
  — DoT — with its own tint/cue), added DELIBERATELY to the pinned `status.ts`. Burn gives the
  `Searing` affix a distinct identity and a 4th legible colour. (See Decision 1 — this is in scope
  but its cost is a deliberate pin update.)
- **Identity (the hard constraint).** A run that triggers no synergy plays **byte-identically** to
  round 1: every new field defaults to the neutral identity; an empty `statuses` list reads/spreads
  nothing; the new icon/cue are skipped when no status is live; `BURN` is dead until an affix adds
  it. The level regression pin is untouched (no generator change).
- **Non-goals (YAGNI).** No affliction stacking-count display (one dominant icon — KISS); no
  per-affliction-kind damage multipliers (one "vs afflicted" mult covers all kinds); no
  spread-radius tuning UI / spread-on-tick (spread only on KILL); no new boss-only affliction
  behaviour (Boss already has full status parity — it gets the icon/cue/spread for free).

## 3. Acceptance Criteria

1. **`src/combat/status.ts` (PURE, PINNED) extended to 4 kinds.** `StatusKind` gains `'burn'`;
   `STATUS_KINDS` becomes `['bleed', 'poison', 'stun', 'burn']`. `makeStatus`/`applyStatus`/
   `tickStatuses`/`hasStatus` are UNCHANGED in behaviour — burn is a damaging status that ticks
   exactly like bleed/poison via the existing `tickDmg`/`tickInterval` path. The module imports
   nothing from Phaser (still node-importable).
2. **Verifier pins updated DELIBERATELY (§8 of verify-gen.mjs).** `STATUS_KINDS.length` assertions
   become 4; a NEW behavioural pin asserts a `burn` DoT accumulates identically to the bleed pin
   (8b-style); the existing bleed/stun/poison pins are UNCHANGED. `npm run verify` green.
3. **Per-hit "vs afflicted" damage hook.** `GameScene._mutationDamageMult(enemy)` multiplies by
   `player.vsAfflictedDamageMult` when `hasStatus(enemy.statuses, …)` is true for ANY live damaging
   affliction (bleed/poison/burn). Default `1` ⇒ no change. Read at BOTH player hit sites (melee +
   projectile) — DRY (the existing one fold site).
4. **"Ticks harder" hook.** `GameScene._scaleStatus(spec)` scales a damaging status's `tickDmg` by
   `player.statusTickMult` (alongside the existing `duration × statusDurationMult`). Default `1` ⇒
   the spec is returned UNCHANGED (the identity clone rule preserved).
5. **Spread-on-kill hook.** When an enemy with a live **damaging** affliction dies, GameScene copies
   that dominant affliction (a fresh, slightly-weakened spec — see Decision 5) to up to
   `SPREAD_MAX_TARGETS` other live enemies within `SPREAD_RADIUS`, but ONLY when
   `runState.spreadAffliction` is armed. Default off ⇒ no spread (identity). Never re-spreads off a
   spread tick (KILL only — no chain explosion).
6. **≥2 new synergy content rows using the hooks.** Ship `Hemorrhage` + `Virulent` mutations (in
   `MUTATIONS`) and the `Searing` weapon affix (in `WEAPON_AFFIXES`). Each is verifier-swept by the
   EXISTING mutation/weapon-affix sweeps with the new fields added to the never-weaken checks.
7. **Per-enemy affliction indicator.** Each `Enemy`/`Boss` shows a small pooled `statusMarker`
   (a tiny rectangle above the body) tinted to the dominant live affliction (bleed dark-red, poison
   green, stun grey-blue, burn orange), VISIBLE even during a telegraph/hurt flash (it is a SEPARATE
   object from `rect`, so it doesn't fight the body-colour precedence). Hidden (alpha 0) when no
   status is live and on death.
8. **Application cue.** When a status is FIRST applied to an enemy/boss (a NEW entry, not a refresh),
   a one-shot floating kind label ("BLEED"/…) pops above the body via a new
   `effects.statusApply(x, y, kind)`. A refresh (re-hit on an already-afflicted enemy) does NOT
   re-pop (KISS — the cue marks the *onset*).
9. **RunState fields + sync.** `RunState` gains `vsAfflictedDamageMult: 1`, `statusTickMult: 1`,
   `spreadAffliction: false`, seeded neutral in `createRunState`; `_syncPlayerScrollStats` mirrors
   the two player-read scalars onto the live Player. `MutationRunState` declares the three fields.
10. **Identity.** With no synergy mutation/affix armed and no status applied: the icon stays hidden,
    no cue pops, `_mutationDamageMult`/`_scaleStatus` return their current values byte-for-byte, and
    `BURN` never appears. The level regression pin and `LevelGenerator.ts` are untouched. `npm run
    typecheck` + `npm run verify` both green.

## 4. Problem Analysis

- **Where does the "vs afflicted" multiplier belong?** Three candidate sites:
  - **A — inside `resolveHit` (damage.ts).** Rejected: `damage.ts` is PURE and must not read a
    victim's `statuses` list (it only takes `{cx,facing}` Combatant shapes — Decision 60). Passing
    the multiplier IN keeps it pure.
  - **B — a new fold function.** Rejected (YAGNI): `_mutationDamageMult(enemy)` ALREADY takes the
    struck enemy and folds conditional perks (Berserker low-HP, Assassin full-HP). It is the exact
    home for "a conditional multiplier that reads the victim". Add one more conditional there — DRY,
    one fold site, both hit handlers already call it.
  - **C (chosen) — extend `_mutationDamageMult(enemy)`** with a `hasStatus`-gated multiply. Minimal
    surface, composes multiplicatively with the existing perks, identity at mult=1.
- **Burn: new kind vs reuse bleed?**
  - **A — no new kind; `Searing` adds a `bleed`.** Cheapest (zero `status.ts`/pin change) but the
    affix has no identity (it's "another bleed") and the slice's "optional new burn" is dropped.
  - **B (chosen) — add `burn` as a 4th damaging kind.** Burn is *mechanically identical* to
    bleed/poison (a `tickDmg`/`tickInterval` DoT), so the only `status.ts` change is widening the
    kind set — the tick/expiry/refresh math is untouched. The cost is a DELIBERATE pin update
    (the constraint explicitly allows this). Gives a distinct 4th legible colour + a real affix
    identity. The risk is contained: every `status.ts` function already handles "a damaging status"
    generically; burn rides that path.
- **READ — recolour the body vs a separate marker?**
  - **A — fix the body-colour precedence** so a status shows over a telegraph. Rejected: the
    telegraph/hurt flashes are deliberately the *highest-precedence* cue (they're timing-critical,
    Enemy.ts:631-633) — hiding them behind a status would hurt readability of the dodge window.
  - **B (chosen) — a SEPARATE pooled `statusMarker`** above the body (a sibling of `frontMarker`).
    It coexists with any body colour, so the affliction reads at a glance WITHOUT stealing the
    telegraph's precedence. Mirrors the existing per-entity primitive-rect pattern (no new art —
    a tinted rectangle). The body tint stays as the *resting* cue (unchanged); the marker is the
    always-visible indicator.
- **Application cue vs tick cue.** The tick cue (`effects.statusTick`) already exists and fires on
  DoT damage. The *application* cue is new and fires ONCE on onset (a NEW status entry). Detecting
  "new entry" needs `applyStatus` to report whether it added vs refreshed — see Decision 4.
- **Spread-on-kill — engine site.** The `enemy.onDeath` hook (GameScene.ts:1426) already fires once
  per kill and has the scene + the dying enemy in scope. But it captures the death *coords* in
  `onDrop`; `onDeath` itself currently takes no args. We read the dying enemy's `statuses` BEFORE
  `_die()` clears nothing (statuses survive death — they're just a list), and we need the death
  center + the live-enemy list. The cleanest seam is a new GameScene method `_spreadAffliction(enemy)`
  called from the `onDeath` hook (the same site Predator's on-kill heal lives) — see Decision 5.

## 5. Decision Log

**1. Include the optional `burn` status (4th kind), updating the pinned `status.ts`.**
- Options: A) skip burn, `Searing` adds a bleed (no pin change) · B) add `burn` as a 4th damaging
  kind, update the pins deliberately.
- Decision: **B**. The constraint names burn "optional" and explicitly permits a deliberate pin
  update. Burn is a pure-DoT kind — `status.ts`'s only change is widening `StatusKind`/`STATUS_KINDS`;
  `makeStatus`/`applyStatus`/`tickStatuses`/`hasStatus` are byte-identical (they already branch on
  "a damaging status" via `tickDmg>0 && tickInterval>0`, not on the kind name). It buys a 4th legible
  colour + a real `Searing` identity. The pin update is: bump the two `STATUS_KINDS.length`
  expectations (4) and ADD a burn-DoT accumulation pin mirroring the bleed pin (8b). The existing
  bleed/poison/stun pins are UNCHANGED — burn does not perturb them.

**2. The "vs afflicted" multiplier reads ANY damaging affliction, not a per-kind table.**
- Options: A) one `vsAfflictedDamageMult` gated by `hasStatus(bleed||poison||burn)` · B) a
  per-kind map (`vsBleedMult`, `vsPoisonMult`, …).
- Decision: **A** (KISS/YAGNI). One multiplier covers the build fantasy ("hit afflicted enemies
  harder") with one field + one `hasStatus` OR. A per-kind table is more config + more sync + more
  verifier surface for no clearer player value. Stun is INCLUDED as "afflicted" too (a stunned enemy
  is afflicted — the bonus reads while you wail on a stun-locked target), which is a desirable combo;
  if a future slice wants "only DoT counts" it's a one-line gate change.

**3. The marker shows the DOMINANT affliction (one icon), with a fixed precedence.**
- Options: A) one icon, dominant kind · B) a row of icons (one per active kind).
- Decision: **A**. One tinted rectangle is enough to READ "this enemy is afflicted, and with what".
  Precedence: **burn → bleed → poison → stun** (the damaging kinds first so the DoT reads; stun last
  since it's already cued by the body grey + the FSM freeze). A row of icons is per-frame layout
  churn + more pooled objects for marginal value (YAGNI). The dominant-kind helper extends the
  existing `_dominantDotKind()` into a `_dominantStatusKind()` that includes burn + stun for the
  marker tint (the DoT FX still uses the DoT-only `_dominantDotKind`, unchanged).

**4. The application cue needs `applyStatus` to report "added vs refreshed".**
- Options: A) caller diffs `statuses.length` before/after the apply · B) `applyStatus` returns a
  boolean/added flag · C) keep `applyStatus` returning the list, add a sibling pure helper.
- Decision: **A** (KISS, zero `status.ts` API change). The hit-handler (and Enemy/Boss `applyStatus`)
  can check `hasStatus(this.statuses, spec.kind)` BEFORE calling `applyStatus` — if it was absent
  and is now present, it's a NEW application → pop the cue. This keeps `status.ts`'s signature pinned
  (the verifier's 8d refresh pin reads the list, not a return flag) and confines the "is this new?"
  logic to the entity. Concretely: `Enemy.applyStatus(spec)`/`Boss.applyStatus(spec)` compute
  `const isNew = !!spec && !hasStatus(this.statuses, spec.kind)` before the pure `applyStatus`, then
  pop `effects.statusApply` when `isNew` (the effects ctx is the SAME the DoT tick uses — but the
  apply cue fires from the hit path, where the scene already has effects, so we pass `(x,y,kind)`
  from the hit handler instead of threading effects into `applyStatus`). **Refinement (chosen): the
  cue is popped by GameScene at the hit site**, NOT inside `applyStatus`, because the hit site
  already owns `effects` + the victim center and already calls `_scaleStatus` there — so we compute
  `isNew` against `enemy.statuses` at the hit site, apply, then pop. This keeps Enemy/Boss
  `applyStatus` byte-identical (no effects coupling) and avoids touching their signatures.

**5. Spread-on-kill: a fresh, slightly-weakened spec; KILL-only; bounded; deterministic enough.**
- Options: A) copy the dying enemy's exact remaining status · B) re-derive a fresh spec from the
  dominant kind with a small "spread tax" (shorter duration / same tickDmg).
- Decision: **B**. Re-deriving a *fresh* spec (a new `{kind,duration,tickInterval,tickDmg}` from a
  small `SPREAD_SPEC` table keyed by kind, with a reduced duration) avoids copying the dying
  enemy's internal `_accum`/`timer` (an implementation detail of the live `Status`) and prevents a
  full-strength chain. The spread applies the SAME `_scaleStatus` path so a Virulent/Toxic build's
  multipliers still apply to the spread (consistent). **KILL-only, no re-spread:** spread fires from
  the `onDeath` hook (which only fires on a real `_die()`), and the spread *application* never
  triggers another death this frame, so there is no chain explosion. Targets: up to
  `SPREAD_MAX_TARGETS` nearest live enemies within `SPREAD_RADIUS` (iterate `this.enemies`, filter
  `isHittable`, sort by distance — bounded, no per-frame cost since it's once-per-kill). Determinism:
  spread reads no RNG (it copies a fixed spec to the nearest N — deterministic given the enemy list),
  so it does not perturb the seed chain or the level pin.

**6. New `RunState` fields default to the neutral identity (the identity guarantee).**
- Decision: `vsAfflictedDamageMult: 1`, `statusTickMult: 1`, `spreadAffliction: false`, seeded in
  `createRunState`. `MutationRunState extends ScrollRunState` declares them (the verifier types the
  live RunState against it). The never-weaken sweep adds: `vsAfflictedDamageMult` /
  `statusTickMult` are bigger-is-better (≥ before); `spreadAffliction` is a boolean flag (a mutation
  may only turn it ON, never off — asserted as "not turned off"). Empty mutation list = all neutral
  = byte-identical run (AC10).

**7. The two synergy mutations + one affix — content that exercises all three hooks.**
- Decision:
  - **`Hemorrhage`** (mutation): `vsAfflictedDamageMult = Math.max(…, 1.25)` (+25% vs afflicted) AND
    `spreadAffliction = true` (kills spread). Uses hooks 1 + 3. `Math.max`/`= true` so re-pick is a
    no-op (never-weaken clean).
  - **`Virulent`** (mutation): `statusTickMult *= 1.5` (afflictions tick +50% harder). Uses hook 2.
  - **`Searing`** (weapon affix): `addStatus: { kind: 'burn', duration, tickInterval, tickDmg }` —
    folds a burn DoT onto ANY weapon (even the sword), via the EXISTING `foldWeaponAffix` addStatus
    path (weapons.ts:300) → the existing GameScene status-on-hit path applies it (zero new wiring).
    Uses the new `burn` kind. A small `damageMult` bump so the affix "does something" beyond the
    DoT (mirrors `WEAPON_VENOMOUS`). This makes burn live config (the verifier asserts an addStatus
    kind is a KNOWN status kind — `burn` now is).
- Two mutations + one affix = the "≥2 new synergy rows" ask, and together they exercise every hook
  (vs-afflicted damage, tick-harder, spread, and the burn kind).

**8. Boss parity is free.** `Boss` already mirrors Enemy's status surface (Boss.ts:155-388). The new
  `statusMarker` + `_dominantStatusKind` are added to BOTH (the same ~10 lines, mirrored — the
  boss-status-parity slice's chosen "port method-for-method" pattern, Decision 5 of that doc). The
  hit-site cue + the spread read off `enemy.statuses`/`boss.statuses` identically (the hit handlers
  already resolve `enemyRef` for both). No new boss-specific logic.

**9. `statusTick` tick FX is rerouted through the SHARED `STATUS_TINT` table (DRY consolidation that
  re-tints the pre-existing bleed/poison ticks).** §6.8 originally framed the burn tint as additive
  ("bleed/poison unchanged"). In implementation, `statusTick` had its OWN third copy of the tick hex
  (bleed spark `0xc0392b` / number `#e74c3c`, poison `0x2ecc71`), distinct from both the body cascade
  and the marker. Hand-adding only a burn branch would have left THREE parallel colour tables for the
  four kinds.
- Options: A) add ONLY a burn branch, keep `statusTick`'s original bleed/poison hex byte-identical
  (strict additive — old DoT-tick FX unchanged) · B) route ALL tick tints through the single
  `STATUS_TINT` table (one source for body cascade + marker + apply cue + tick cue).
- Decision: **B** (DRY > strict additive for a colour-only cosmetic). This is the ONLY deviation from
  the additive-identity guarantee in this slice, and it is **cosmetic-only**: gameplay bytes (damage,
  duration, RNG, level pin) are unaffected, the verifier does not sweep colours, and `npm run verify`
  stays green. The on-screen change to a pre-existing-content run (e.g. a spear-bleed / bow-poison run
  with NO synergy) is: bleed tick spark `0xc0392b`→`0xa93226` and number `#e74c3c`→`#a93226`; poison
  tick spark/number `0x2ecc71`→`0x27ae60`. We accept this so the four affliction colours have ONE
  source of truth (`combat/statusColors.ts`) and every cue — resting body tint, marker, apply cue,
  tick cue — agrees by construction. AC10's "byte-identical to round 1" continues to hold for all
  GAMEPLAY bytes; the carve-out is explicitly these four DoT-tick FX hex values, recorded here so the
  shift is read as an intentional consolidation, not an identity regression.

## 6. Design

All edits are code-level and named. PURE modules (`status.ts`, `RunState.ts`, `mutations.ts`,
`weapons.ts`) gain Phaser-free fields/data only. `LevelGenerator.ts` is untouched.

### 6.1 `src/combat/status.ts` (PURE, PINNED) — add the `burn` kind

- `StatusKind` union: `'bleed' | 'poison' | 'stun' | 'burn'`.
- `STATUS_KINDS`: `['bleed', 'poison', 'stun', 'burn']`.
- Comment block updated to note burn is a damaging DoT identical to bleed/poison (the genre's
  "ignite" — a different tint/cue, same math).
- **No other change.** `makeStatus`/`applyStatus`/`tickStatuses`/`hasStatus` already handle a
  damaging status generically (`s.tickDmg > 0 && s.tickInterval > 0`), so burn ticks/expires/
  refreshes via the existing path — this is the load-bearing reason adding the kind is safe.

### 6.2 `scripts/verify-gen.mjs` (§8 — the deliberate pin update)

- Change the two `${STATUS_KINDS.length}` references (lines ~1308 + the OK summary) — they read the
  length so they auto-update to 4; **add an explicit** `if (STATUS_KINDS.length !== 4) fail(...)`
  guard in §8 so the count is PINNED (a deliberate 4, not "whatever the array is").
- 8a (weapon status tags) already validates `STATUS_KINDS.includes(kind)` — the new `Searing` burn
  affix tag passes automatically (burn is now known); no change needed, but ADD a one-line assertion
  that `STATUS_KINDS.includes('burn')` (so dropping burn fails loudly).
- ADD **8f — burn DoT accumulation pin** (mirroring 8b): a `burn` of `tickDmg=4` every `0.4s`,
  ticked in `0.1s` steps over `0.4s`, deals EXACTLY 4 once and stays live — proving burn rides the
  same DoT math (the COMPUTED output, never hand-invented).
- The existing 8b/8c/8d/8e bleed/stun/poison pins are UNCHANGED (burn does not perturb them).

### 6.3 `src/core/RunState.ts` (PURE) — three neutral perk fields

Add to the `RunState` interface (near the mutation perk fields, RunState.ts:73-76) and to the
`createRunState` returned object (near RunState.ts:163-165), each seeded to the neutral identity:

```ts
vsAfflictedDamageMult: number  // ×player damage vs an AFFLICTED enemy (Hemorrhage). 1 = neutral.
statusTickMult: number         // ×applied DoT tickDmg (Virulent — "ticks harder"). 1 = neutral.
spreadAffliction: boolean      // killing an afflicted enemy spreads it (Hemorrhage). false = off.
```

Identity: a fresh run seeds `1/1/false` ⇒ no behaviour change.

### 6.4 `src/config/mutations.ts` (PURE) — declare fields + 2 synergy rows

- `MutationRunState` gains the three fields (so every site types against the same shape):
  ```ts
  vsAfflictedDamageMult: number
  statusTickMult: number
  spreadAffliction: boolean
  ```
- Two new rows in `MUTATIONS`:
  ```ts
  { id: 'hemorrhage', name: 'Hemorrhage', desc: '+25% damage vs afflicted enemies; kills spread the affliction',
    apply: (run) => { run.vsAfflictedDamageMult = Math.max(run.vsAfflictedDamageMult, 1.25); run.spreadAffliction = true } },
  { id: 'virulent', name: 'Virulent', desc: 'Afflictions tick 50% harder',
    apply: (run) => { run.statusTickMult *= 1.5 } },
  ```
  Both are never-weaken safe (`Math.max` / `*= 1.5` / `= true`).

### 6.5 `src/config/weapons.ts` (PURE) — the `Searing` burn affix

- A new `WeaponAffix` (mirroring `WEAPON_VENOMOUS`), added to `WEAPON_AFFIXES` with a weight:
  ```ts
  export const WEAPON_SEARING: WeaponAffix = {
    id: 'searing', name: 'Searing',
    damageMult: 1.05,
    addStatus: { kind: 'burn', duration: 2.4, tickInterval: 0.4, tickDmg: 4 },
  }
  // … WEAPON_AFFIXES: { affix: WEAPON_SEARING, w: 2 }
  ```
- `WeaponStatus.kind` is typed `string` (weapons.ts:37), so `'burn'` needs no type change; the
  GameScene status-on-hit path + `foldWeaponAffix`'s addStatus branch (weapons.ts:300) apply it with
  ZERO new wiring (DRY). The verifier's affix sweep (10a) + the addStatus shape check pass as-is.

### 6.6 `src/scenes/GameScene.ts` — the three engine hooks + the apply cue

- **`_mutationDamageMult(enemy)` (GameScene.ts:1650)** — append the vs-afflicted fold:
  ```ts
  if (this.player.vsAfflictedDamageMult !== 1 && enemy &&
      (hasStatus(enemy.statuses, 'bleed') || hasStatus(enemy.statuses, 'poison') || hasStatus(enemy.statuses, 'burn') || hasStatus(enemy.statuses, 'stun'))) {
    mult *= this.player.vsAfflictedDamageMult
  }
  ```
  (Import `hasStatus` from `../combat/status.js`.) Identity at mult=1 ⇒ byte-identical.
- **`_scaleStatus(spec)` (GameScene.ts:1634)** — scale `tickDmg` by `statusTickMult` alongside the
  existing duration scale; return the spec UNCHANGED when both mults are 1 (the identity rule):
  ```ts
  const dur = this.player.statusDurationMult ?? 1
  const tick = this.player.statusTickMult ?? 1
  if (dur === 1 && tick === 1) return spec
  const scaled = { ...spec, duration: (spec.duration ?? 0) * dur }
  if (spec.tickDmg) scaled.tickDmg = (spec.tickDmg) * tick
  return scaled
  ```
- **Application cue** at BOTH hit sites (melee GameScene.ts:1612, projectile GameScene.ts:1684):
  compute `isNew` BEFORE applying, then pop once:
  ```ts
  const sp = this._scaleStatus(this.player.equippedWeapon.status)  // (or pj.status)
  const isNew = !!sp && !hasStatus(enemy.statuses, sp.kind)
  enemy.applyStatus(sp)
  if (isNew) this.effects.statusApply(enemy.body.center.x, enemy.body.center.y, sp.kind)
  ```
- **Spread-on-kill** — extend the `enemy.onDeath` hook (GameScene.ts:1426). The hook currently takes
  no args; we capture the dying enemy in the closure (it's the `enemy` the factory just built):
  ```ts
  enemy.onDeath = () => {
    this.runState.kills += 1
    if (this.player.onKillHealAmount > 0) this.player.heal(this.player.onKillHealAmount)
    if (this.runState.spreadAffliction) this._spreadAffliction(enemy)  // NEW
    this.sfx.enemyDie()
  }
  ```
  New method `_spreadAffliction(dying)`:
  - early-return unless `runState.spreadAffliction` AND the dying enemy carries a live DAMAGING
    affliction (`hasStatus(dying.statuses, 'bleed'|'poison'|'burn')` — stun does not spread, KISS).
  - pick the dominant damaging kind (`dying._dominantDotKind()` extended for burn — see §6.7), build
    a fresh spread spec from a small const `SPREAD_SPEC[kind]` (a reduced-duration DoT), run it
    through `_scaleStatus` (so the build's tick/duration mults apply), and apply to up to
    `SPREAD_MAX_TARGETS` nearest live OTHER enemies within `SPREAD_RADIUS`. The scan reuses the SAME
    `this.enemies` iteration idiom the skill blast already uses (`_radialDamage` over `this.enemies`,
    GameScene.ts:1267 — DRY): skip `dying` + non-`isHittable`, sort by distance, slice to N. Pop
    `effects.statusApply` on each new application (compute `isNew` per target via `hasStatus`).
    Bosses are the SEPARATE `this.boss` reference, not in `this.enemies`; spread targets the normal
    horde (KISS — a boss death has no "nearby pack"), so a boss-kill spread is a harmless no-op.
  - constants near the other tuning consts: `SPREAD_RADIUS = 140`, `SPREAD_MAX_TARGETS = 2`.
- **`_syncPlayerScrollStats()` (GameScene.ts:1769)** — mirror the two player-read scalars:
  ```ts
  this.player.vsAfflictedDamageMult = this.runState.vsAfflictedDamageMult
  this.player.statusTickMult = this.runState.statusTickMult
  ```
  (`spreadAffliction` is read off `runState` directly in the onDeath hook — no player mirror needed.)

### 6.7 `src/entities/Enemy.ts` + `src/entities/Boss.ts` — the per-enemy indicator

- **Player fields** (`src/entities/Player.ts`): add `vsAfflictedDamageMult = 1` + `statusTickMult = 1`
  (the live-read mirrors, next to `lowHpDamageMult`/`firstHitBonusMult`). Neutral defaults.
- **Enemy/Boss `statusMarker`**: a new pooled rectangle created in the ctor next to `frontMarker`
  (`scene.add.rectangle(x, y, 10, 6, 0xffffff).setAlpha(0)` — a tiny bar above the head). Destroyed
  in `_despawn`.
- **`_dominantStatusKind()`** (a sibling of `_dominantDotKind`, in both Enemy + Boss): returns the
  dominant LIVE status for the MARKER tint, precedence burn → bleed → poison → stun, or `null` when
  none. (`_dominantDotKind` is unchanged — it stays DoT-only for the tick FX, but extended to
  include `burn` so a burn tick pops an orange number.)
- **`_updateVisual(dt)`** (both): after positioning `frontMarker`, drive the marker:
  ```ts
  const sk = this._dominantStatusKind()
  if (sk && this.state !== STATE.DEAD) {
    this.statusMarker.setAlpha(0.95)
    this.statusMarker.setFillStyle(STATUS_MARKER_COLOR[sk])
    this.statusMarker.setPosition(this.body.center.x, this.body.center.y - this.spec.bodyH * 0.5 - 8)
  } else {
    this.statusMarker.setAlpha(0)
  }
  ```
  `STATUS_MARKER_COLOR` = `{ bleed: 0xa93226, poison: 0x27ae60, stun: 0x95a5a6, burn: 0xe67e22 }`
  (a module const in each entity, or a shared export from a tiny `combat/statusColors.ts` — see
  Decision below). The body-colour cascade (Enemy.ts:634-647 / Boss.ts:598-603) is UNCHANGED: the
  marker is a SEPARATE object, so it shows over a telegraph (AC7) without stealing precedence.
- **Reuse note (DRY):** the four tint colours appear in the body cascade AND the marker. To avoid a
  third copy, hoist them to a tiny **PURE** `src/combat/statusColors.ts` (`export const STATUS_TINT =
  {bleed,poison,stun,burn}` — Phaser-free, just hex ints) imported by Enemy/Boss/Effects. KISS: one
  source for the four hex values. (Optional but recommended; if cut, duplicate the const — the verifier
  doesn't sweep colours.)

### 6.8 `src/effects/Effects.ts` — `statusApply` cue + burn tint in `statusTick`

- `statusTick`'s `kind` param widens to include `'burn'` (orange `0xe67e22` / `#e67e22`). **Implementation
  refinement (see Decision 9):** rather than ADDING a burn branch alongside hand-coded bleed/poison hex,
  the tick tint is rerouted through the SHARED `STATUS_TINT` table (DRY — one source for the body cascade,
  marker, apply cue AND tick cue). This re-tints the pre-existing bleed/poison ticks to the body-cascade
  values (bleed `0xc0392b`/`#e74c3c` → `0xa93226`; poison `0x2ecc71` → `0x27ae60`) — a deliberate cosmetic
  consolidation, NOT additive on the old colours. (No new allocation — same pooled sparks/number path.)
- NEW `statusApply(x, y, kind)`: a one-shot floating label ("BLEED"/"POISON"/"STUN"/"BURN") in the
  kind's tint, NO shake/hit-stop (it marks onset, not an impact). REUSES `ParticlePool.spawnNumber`
  as-is — its signature is `spawnNumber(x, y, value: number | string, {color, scale})`
  (ParticlePool.ts:105), so it already renders an arbitrary string (the kind label). No new pool
  method needed. KISS: one short-lived label that floats up + fades.

### 6.9 `src/scenes/HUDScene.ts` — surface the build (registry-only)

- The mutations list already renders (HUDScene.ts:175). Hemorrhage/Virulent appear there for free
  (their names join the existing `mutations` registry string). The weapon affix already shows in the
  weapon label ("Weapon ✦ Searing"). **No new HUD wiring required** for the build to READ on the HUD
  beyond what the per-enemy marker + cue provide — the per-enemy indicator (§6.7) IS the
  "see the build working" surface the spec asks for. (YAGNI: no separate HUD affliction panel.)

### Data flow (end to end)

1. Player picks `Hemorrhage` at a biome transition → `apply(runState)` sets
   `vsAfflictedDamageMult=1.25` + `spreadAffliction=true` → `_syncPlayerScrollStats` mirrors the mult
   onto the Player.
2. Player picks up a `Searing` sword → `foldWeaponAffix` stamps `status:{kind:'burn',…}` → the melee
   hit handler applies it via `_scaleStatus` → enemy `statuses` gains a burn → `statusMarker` turns
   orange + a "BURN" cue pops (isNew).
3. Next hits on that enemy: `_mutationDamageMult` sees `hasStatus(burn)` → ×1.25 damage (the build
   reads: bigger numbers vs the burning enemy).
4. The enemy dies → `onDeath` → `_spreadAffliction` copies a fresh burn to the 2 nearest enemies
   (their markers turn orange + cues pop) → the affliction cascades through the pack.
5. A `Virulent` pick makes every applied DoT tick 50% harder (`statusTickMult` in `_scaleStatus`).

### Identity safety (the hard constraint)

- No synergy armed: `vsAfflictedDamageMult=1` (the `!== 1` guard skips the fold),
  `statusTickMult=1` (`_scaleStatus` returns the spec unchanged), `spreadAffliction=false`
  (`_spreadAffliction` never runs). Burn never appears (no affix adds it).
- No status applied: `statuses` empty ⇒ `_dominantStatusKind()` null ⇒ marker alpha 0; no apply cue;
  `hasStatus` reads false ⇒ no vs-afflicted fold. Byte-identical body visuals.
- `status.ts` adds a kind to a SET but changes NO tick math ⇒ the bleed/poison/stun pins hold.
- `LevelGenerator.ts` untouched ⇒ the level regression pin is unaffected.
- The spread reads no RNG ⇒ the seed chain + biome-sequence determinism pins are unaffected.

## 7. Files Changed

- `src/combat/status.ts` — add `'burn'` to `StatusKind` + `STATUS_KINDS` (PINNED — deliberate). No
  tick-math change.
- **NEW** `src/combat/statusColors.ts` (PURE) — the four affliction tint hex ints (one source for the
  body cascade + the marker + Effects). [Optional — may inline if cut; see §6.7.]
- `src/core/RunState.ts` — `vsAfflictedDamageMult`/`statusTickMult`/`spreadAffliction` fields + neutral
  seeds.
- `src/config/mutations.ts` — declare the 3 fields on `MutationRunState`; add `Hemorrhage` + `Virulent`.
- `src/config/weapons.ts` — add `WEAPON_SEARING` (burn affix) to `WEAPON_AFFIXES`.
- `src/entities/Enemy.ts` — `statusMarker` field/ctor/despawn; `_dominantStatusKind()`; extend
  `_dominantDotKind` for burn; drive the marker in `_updateVisual`.
- `src/entities/Boss.ts` — mirror the Enemy `statusMarker` + `_dominantStatusKind` + `_updateVisual`
  marker (method-for-method, the boss-parity pattern).
- `src/entities/Player.ts` — `vsAfflictedDamageMult`/`statusTickMult` live-read mirror fields.
- `src/scenes/GameScene.ts` — vs-afflicted fold in `_mutationDamageMult`; tick scale in `_scaleStatus`;
  apply-cue at both hit sites; `_spreadAffliction` + the `onDeath` call + `SPREAD_*` consts; sync the
  two scalars in `_syncPlayerScrollStats`; import `hasStatus`.
- `src/effects/Effects.ts` — `statusApply(x,y,kind)` (reuses `ParticlePool.spawnNumber`, which
  already accepts a string value — ParticlePool.ts:105, no pool change); widen `statusTick` kind to
  include burn.
- `scripts/verify-gen.mjs` — pin `STATUS_KINDS.length === 4` + `includes('burn')`; ADD the burn-DoT
  accumulation pin (8f); extend the mutation never-weaken sweep with `vsAfflictedDamageMult` /
  `statusTickMult` (bigger-is-better) + `spreadAffliction` (flag never turned off). The weapon-affix
  sweep needs no change (burn is now a known addStatus kind).
- `src/scenes/HUDScene.ts` — none required (mutations list + weapon affix label already render).

## 8. Verification

1. `npm run typecheck` — passes (the new fields/params are typed; `StatusKind` widened).
2. `npm run verify` — green: the deliberate `STATUS_KINDS.length === 4` + burn-includes pins pass;
   the NEW burn-DoT accumulation pin (8f) proves burn ticks like bleed; the bleed/poison/stun pins
   are UNCHANGED; the mutation sweep proves `Hemorrhage`/`Virulent` never weaken + do something; the
   weapon-affix sweep proves `Searing` is well-formed (a known burn addStatus); the level regression
   pin + determinism pins are unaffected (no generator/RNG change).
3. Manual (`npm run dev`):
   - [AC7] Hit an enemy with a status weapon (spear/bow/hammer) → a tinted marker appears above its
     head, VISIBLE during its telegraph flash; it clears on expiry/death.
   - [AC8] The status's kind label ("BLEED"/…) pops ONCE on application; re-hitting (a refresh) does
     not re-pop.
   - [AC1/AC6] Equip a `Searing` weapon → enemies get an orange burn marker + "BURN" cue + burn DoT
     ticks (orange numbers).
   - [AC3] Pick `Hemorrhage` → afflict an enemy → damage numbers vs it are visibly larger (+25%);
     identity check: an UN-afflicted enemy takes normal damage.
   - [AC5] With `Hemorrhage`, kill an afflicted enemy in a pack → the 2 nearest enemies gain the
     affliction (markers + cues) without you hitting them.
   - [AC4] Pick `Virulent` → DoT tick numbers are ~50% larger.
   - [AC10] Decline all synergy + use a plain sword (no status) → no marker, no cue, no spread,
     identical damage; the run plays as before.
