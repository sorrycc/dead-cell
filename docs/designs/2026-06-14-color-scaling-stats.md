# F1 Color Scaling — Brutality / Tactics / Survival build engine

## 1. Background

Dead Cells' signature build lever is **colour scaling**: every weapon and skill is tagged one of three
stat colours — **Brutality** (red, melee), **Tactics** (purple, ranged/skills), **Survival** (green,
sustain/HP) — and a run tracks a per-colour LEVEL. An item's damage scales with ITS colour's level, so
loot becomes a *direction* ("a Brutality sword feeds my build, a Tactics bow does not") and a stat
choice is a real commitment.

This codebase already has every seam this needs:

- **The per-hit damage channel.** `combat/damage.ts:resolveHit` takes `opts.damageMult` PASSED IN and
  composes it `swing.damage × backstab × damageMult`, **rounded ONCE at the end** (damage.ts:91). It
  imports NO config (purity). GameScene computes the player's mult at both hit sites
  (`_onPlayerHitEnemy` GameScene.ts:1779, `_onProjectileHitEnemy` GameScene.ts:1951) as
  `meleeDamageMult × scrollDamageMult × _mutationDamageMult(enemy)` (melee) / `rangedDamageMult × …`
  (ranged). This is the exact insertion point for a colour mult.
- **The run-only value object.** `core/RunState.ts` holds run-scoped scalars, each defaulting to a
  neutral identity, carried across level rebuilds, seeded by `createRunState`. The
  `scrollDamageMult`/`scrollMaxHpBonus`/… fields and the `vsAfflictedDamageMult` (affliction-synergy)
  show the exact "pure scalar, neutral default, mirrored onto the live Player" idiom to copy.
- **The 3-of-N picker.** `entities/MutationOverlay.ts` is a frozen, programmer-art, i18n'd choice modal
  driven by `GameScene._offerMutation` (GameScene.ts:2287) at every biome transition
  (GameScene.ts:1041), with a seeded `_pickMutationOffers` (GameScene.ts:2306) shuffle of a per-run
  resolved pool and an `_applyMutation(id)` callback (GameScene.ts:2326).
- **The scroll table.** `config/scrolls.ts` is a pure `{ id, name, apply(run) }` set that mutates
  run-only fields in place; the Pickup grants by `scrollId`.
- **Pure config + verifier sweeps.** Every table (weapons/skills/scrolls/mutations) is node-imported by
  `scripts/verify-gen.mjs` and swept for well-formedness + never-weaken monotonicity (§5d weapons, §9
  scrolls, §11 skills, §12 mutations). New tables get the same guardrail.
- **i18n.** `i18n/en.ts` (`ui` chrome) + `i18n/zh-CN.ts` (chrome + per-category `name`/`desc`
  overrides keyed by id), read via `t()`/`tName()`/`tDesc()`.

What is **missing**: there is no colour tag on weapons/skills, no per-colour run level, and no
colour-scaled damage. We add exactly that, gated behind opt-in state so a default run is byte-identical.

## 2. Requirements Summary

- **Three colour ids** — `brutality` | `tactics` | `survival` — defined ONCE in a new pure
  `config/colors.ts` (id list + lookup map + display tints + the scaling math).
- **Per-colour run LEVEL** on RunState (`brutalityLevel` / `tacticsLevel` / `survivalLevel`), all
  default **0** (run-only, lost on death, carried across level rebuilds).
- **Damage scaling.** A weapon/skill's damage is multiplied by `colorMult(level) = 1 + level × PER_LEVEL`
  (PER_LEVEL = 0.15), monotone non-decreasing, **level 0 ⇒ exactly 1** (identity). The mult uses ITS
  OWN colour's run level (melee weapon → brutality; bow → tactics; etc.).
- **Survival also grants flat +max HP per level** (`SURVIVAL_HP_PER_LEVEL = 12`), derived on RunState
  and folded into the existing `scrollMaxHpBonus` channel so it heals-on-grow via the proven
  `_syncPlayerScrollStats` path.
- **Every weapon TAGGED** a colour (`config/weapons.ts:WeaponSpec.scaling`, required) and **every skill
  TAGGED** (`config/skills.ts:SkillSpec.scaling`, required). `foldWeaponAffix` carries `scaling` through
  (it rides the `...weapon` spread — a pattern tag, never scaled by an affix).
- **Three colour scrolls** added to `config/scrolls.ts` (Scroll of Brutality/Tactics/Survival), each
  `apply()` bumping its colour's run level by +1. Existing scrolls are **kept unchanged**.
- **3-of colour-up choice at biome transitions** — reuse the MutationOverlay picker seam to offer a
  +1-to-a-chosen-colour pick AND/OR a colour stat-scroll pickup (see Decision 7).
- **HUD** shows the three colour levels as small coloured pips/numbers, with the **equipped weapon's
  colour highlighted**.
- **i18n** — colour names + scroll names + picker chrome in BOTH `en.ts` and `zh-CN.ts`.
- **Verifier sweep** — every weapon AND skill has a KNOWN scaling colour; the colour table is
  well-formed; `colorMult` is monotone non-decreasing and `colorMult(0) === 1` (identity);
  `SURVIVAL_HP_PER_LEVEL ≥ 0`; the three colour scrolls only ever RAISE their level.

### Identity (the hard constraint)

A default run (no colour scrolls, all three levels 0) plays **byte-identically** to before: every
weapon/skill colour mult is `colorMult(0) === 1`, the survival HP derivation is `0`, and the colour
mult composes into the EXISTING `damageMult` channel that already defaults to 1 — so
`round(swing.damage × backstab × meleeDamageMult × scrollDamageMult × mutFold × 1)` reproduces the
pinned damages exactly. The level regression pin and `LevelGenerator.ts` are untouched (no generator
change). The mutation/scroll/weapon/skill verifier pins are unaffected except the deliberate additions
below.

### Non-goals (YAGNI)

- No per-colour gear *rarity*/affix interplay, no colour-locked weapons, no on-pickup re-roll of a
  weapon's colour (colour is a fixed property of the weapon id).
- No meta tier that seeds starting colour levels (the integration map flags this optional — **cut**,
  KISS; a fresh run always starts all 0).
- No separate "colour XP" or diminishing curve (linear `1 + level×0.15`, KISS).
- No new combat math in `damage.ts` (it stays pure; the mult is passed IN).
- No colour scaling on ENEMY damage (only the player's hits scale — same discipline as every existing
  player mult).

## 3. Acceptance Criteria

1. **`config/colors.ts` (NEW, PURE — no Phaser).** Exports: `ColorId = 'brutality'|'tactics'|'survival'`;
   `COLOR_IDS: ColorId[]` (ordered); `COLORS: Record<ColorId, ColorSpec>` lookup where `ColorSpec` =
   `{ id, name, tint }` (`tint` a `0xRRGGBB` number for HUD pips: brutality red `0xe74c3c`, tactics
   purple `0x9b59b6`, survival green `0x2ecc71`); `PER_LEVEL = 0.15`; `SURVIVAL_HP_PER_LEVEL = 12`;
   `colorMult(level: number): number` = `1 + Math.max(0, level) × PER_LEVEL` (monotone;
   `colorMult(0) === 1`); `survivalHpBonus(level: number): number` = `Math.max(0, level) ×
   SURVIVAL_HP_PER_LEVEL`. Node-importable (the verifier imports it).
2. **Every `WeaponSpec` carries a required `scaling: ColorId`.** SWORD → `brutality`, HAMMER →
   `brutality`, SPEAR → `survival` (it's the sustain/poke spacing weapon — bleed-over-time identity),
   GLAIVE → `brutality`, BOW → `tactics`. `foldWeaponAffix` preserves it (it rides the `...weapon`
   spread; the verifier asserts the fold keeps `scaling`). `FoldedWeaponSpec` inherits it via
   `extends WeaponSpec`.
   *(Decision 5 pins the exact per-weapon assignment; the implementer MUST use these so the doc is the
   contract.)*
3. **Every `SkillSpec` carries a required `scaling: ColorId`.** knives/iceShards/frostGrenade/turret/
   shockwave → `tactics` (ranged/skill tools); firebomb → `brutality` (the heavy-damage radial burn,
   fits a melee/brawler build). `import type { ColorId } from './colors.js'`.
4. **RunState fields + derivation.** `RunState` gains `brutalityLevel`, `tacticsLevel`,
   `survivalLevel` (all default **0** in `createRunState`, never seeded from meta). A pure helper
   `colorLevel(run, colorId)` (or inline switch) reads the level for a colour id. `createRunState`
   carries them across level rebuilds like every other run field (they live on the persisted RunState
   object the scene reuses). Survival's flat HP feeds the EXISTING `scrollMaxHpBonus` channel (Decision 6).
5. **Colour-scaled damage at the player hit sites (melee + ranged).** `GameScene._onPlayerHitEnemy`
   multiplies `damageMult` by `colorMult(brutality level)` **for a melee weapon** /
   `colorMult(tactics level)` **for a ranged weapon** — actually by `colorMult(<equipped weapon's
   scaling colour> level)` (Decision 8). `_onProjectileHitEnemy` (bow shot) multiplies by the equipped
   weapon's colour mult the same way. At all-0 levels every factor is `1` ⇒ byte-identical damage.
6. **Colour-scaled SKILL damage.** A fired skill scales by ITS `scaling` colour's level, applied at
   `_useSkill` fire time (Decision 9): a `volley`/`turret` bakes the colour mult into the fired
   projectile's `damage`; a `blast` passes a colour-scaled `damage` into `_radialDamage`. At level 0 the
   baked damage equals the spec damage (identity).
7. **Survival flat +max HP.** When a Survival level is gained, the player's max HP rises by
   `SURVIVAL_HP_PER_LEVEL` and tops up by that amount — reusing `_syncPlayerScrollStats`'s existing
   `scrollMaxHpBonus → maxHp + heal-on-grow` path (Decision 6). At level 0 the survival HP bonus is 0
   (identity).
8. **Three colour scrolls.** `config/scrolls.ts:SCROLLS` gains `scrollBrutality`, `scrollTactics`,
   `scrollSurvival`, each `apply(run)` doing `run.<colour>Level += 1` (and survival relying on the
   derivation, not a direct HP write). `ScrollRunState` declares the three level fields. The existing 6
   scrolls are byte-unchanged. `SCROLL_IDS` grows to 9.
9. **3-of colour-up choice at biome transitions.** A `ColorOverlay` (a trimmed clone of MutationOverlay,
   or MutationOverlay parameterised — Decision 7) offers a 3-of choice of "+1 Brutality / +1 Tactics /
   +1 Survival" on biome transition, OR a colour stat-scroll pickup spawns. The chosen colour's run
   level increments. Reuses the frozen-overlay + seeded-pick + `onPick(id)` idiom (programmer-art,
   i18n'd). Identity: a fresh run still plays the same until the player makes a pick.
10. **HUD shows the three colour levels.** `HUDScene` renders three small coloured pips/numbers
    ("B n · T n · S n", each tinted to its colour) reading three registry keys GameScene writes
    (`brutalityLevel`/`tacticsLevel`/`survivalLevel`), with the **equipped weapon's colour** visually
    highlighted (brighter / bracketed). Registry-only (decoupled). Empty default state shows `0/0/0`.
11. **i18n (both locales).** `en.ts` + `zh-CN.ts` gain: colour names (`color.brutality` = "Brutality"/
    "残暴", `color.tactics` = "Tactics"/"战术", `color.survival` = "Survival"/"生存"), the HUD colour-row
    label, the colour-picker overlay chrome (title/subtitle/help), and the three colour-scroll names. No
    bare English literal in any UI path. Hub/Shop column alignment untouched (no new Hub/Shop columns).
12. **Verifier green (`scripts/verify-gen.mjs`).** A NEW §14 sweep (Decision 10): the colour table is
    well-formed (3 ids, lookup lockstep, numeric tints); `colorMult(0) === 1` EXACTLY and `colorMult` is
    monotone non-decreasing over levels 0..20; `survivalHpBonus(0) === 0` and monotone non-decreasing;
    `PER_LEVEL > 0`, `SURVIVAL_HP_PER_LEVEL ≥ 0`. The §5d weapon sweep asserts every weapon has a
    `scaling ∈ COLOR_IDS` AND `foldWeaponAffix` preserves `scaling`. The §11 skill sweep asserts every
    skill has a `scaling ∈ COLOR_IDS`. The §9 scroll sweep's never-weaken check adds the three level
    fields (they only rise) and asserts each colour scroll raises exactly one level. `npm run typecheck`
    + `npm run verify` + `npm run build` all green.

## 4. Problem Analysis

**Where does the colour mult belong?** Same three-candidate analysis the affliction slice used:

- **A — inside `resolveHit` (damage.ts).** REJECTED: `damage.ts` is PURE and must not import
  `config/colors.ts` or read run state. The mult is PASSED IN — the codebase's pinned discipline
  (Decision 60). Keeps the round-once order and the identity pins intact.
- **B — a brand-new fold function per hit.** REJECTED (YAGNI): the hit sites ALREADY compose a product
  of mults into `damageMult`. Adding one more factor to that product is minimal surface, composes
  multiplicatively, and is identity at level 0.
- **C (chosen) — compute `colorMult(level)` for the equipped weapon's colour and multiply it into the
  existing `damageMult` product** at `_onPlayerHitEnemy` / `_onProjectileHitEnemy`. One small helper
  `GameScene._weaponColorMult()` reads `this.player.equippedWeapon.scaling` → its run level →
  `colorMult`. DRY, identity at 0.

**Why not scale skills via the same weapon path?** Skill projectiles share the PLAYER projectile pool
and resolve through `_onProjectileHitEnemy`, which reads the *equipped weapon's* colour — wrong for a
skill (a skill scales by ITS colour, e.g. Tactics, regardless of the held weapon). Two options:

- Stamp a per-projectile colour mult on the pooled shot and read it at the hit site. REJECTED: adds a
  new field to the hot projectile context + a branch at the hit site (a Tactics skill shot vs a Brutality
  weapon shot) — more surface, more identity risk.
- **(chosen) Bake the colour mult into the skill's fired damage at `_useSkill` time** (Decision 9): a
  volley/turret multiplies `spec.projectile.damage` by the skill's colour mult into the acquired shot's
  damage; a blast multiplies `spec.damage` before calling `_radialDamage`. The shot then resolves through
  the unchanged hit path with no per-shot weapon-colour fold polluting it. At level 0 the baked damage
  equals the spec damage (identity). KISS, no hot-path field.

**Survival's flat HP — new field or reuse `scrollMaxHpBonus`?** Reuse. `_syncPlayerScrollStats` already
turns `runState.scrollMaxHpBonus` into `player.maxHp = base + bonus` with a heal-on-grow
(GameScene.ts:2081-2084). Folding `survivalHpBonus(survivalLevel)` into that single derivation
(Decision 6) means zero new max-HP wiring and the heal-on-grow comes free. The neutral default
(`survivalLevel 0 → +0 HP`) preserves identity.

**Picker vs pickup for the colour-up choice.** The integration map allows "3-of choice at exit AND/OR a
colour stat-scroll pickup". Decision 7 ships the **3-of choice at biome transition** (the strongest
"real commitment" moment, reusing the proven overlay) AND keeps the three colour **scrolls** as
droppable/shop-able pickups (they already exist as a pure table — near-zero cost). Both feed the same
run-level fields. This maximises reuse and gives two acquisition vectors.

## 5. Decision 5 — Per-weapon / per-skill colour assignment (PINNED)

The implementer MUST use exactly these tags (the doc is the contract):

| Weapon  | scaling     | Rationale |
|---------|-------------|-----------|
| SWORD   | `brutality` | the default balanced melee |
| HAMMER  | `brutality` | heavy melee, big hits |
| SPEAR   | `survival`  | long-reach poke/bleed spacing — the sustain/attrition identity |
| GLAIVE  | `brutality` | sweeping melee crowd-control |
| BOW     | `tactics`   | the ranged weapon |

| Skill        | scaling     | Rationale |
|--------------|-------------|-----------|
| knives       | `tactics`   | ranged burst |
| iceShards    | `tactics`   | ranged spray |
| frostGrenade | `tactics`   | thrown CC |
| firebomb     | `brutality` | the heavy radial damage burn (brawler payoff) |
| turret       | `tactics`   | deployed ranged |
| shockwave    | `tactics`   | thrown radial knockback |

This guarantees **all three colours are USED by at least one weapon and the verifier can assert the
colour space is not dead config** (brutality: sword/hammer/glaive/firebomb; tactics: bow + 5 skills;
survival: spear). Survival's payoff is primarily the flat +HP (a Survival-spear bruiser).

## 6. Decision 6 — Survival HP via the existing `scrollMaxHpBonus` channel

`_syncPlayerScrollStats` computes `newMax = runState.maxHp + runState.scrollMaxHpBonus`. Change ONE
line: `newMax = runState.maxHp + runState.scrollMaxHpBonus + survivalHpBonus(runState.survivalLevel)`.
At `survivalLevel 0` this adds 0 (identity). When a Survival pick raises the level, the next
`_syncPlayerScrollStats()` call (the colour-pick/scroll apply already calls it — mirror
`_applyMutation`) grows max HP and heals by the delta. No new max-HP field, no new heal site.

## 7. Decision 7 — Colour-up picker: parameterise MutationOverlay vs clone

KISS choice: **add a tiny `ColorOverlay`** modelled byte-for-byte on `MutationOverlay`
(`entities/ColorOverlay.ts`) OR — preferred if it stays small — generalise `MutationOverlay` to take
`{ offers: { id, name, desc }[], onPick, title, subtitle, accentColor }`. Pick whichever keeps the diff
smaller; both are acceptable. The overlay:

- Offers exactly 3 rows (always the three colours, ordered `COLOR_IDS`; no shuffle needed since there
  are exactly 3 — but if a future 4th colour appears, seed the pick off the same
  `runSeed ⊕ biomeIndex` thread as `_pickMutationOffers`, OFF the generator's pinned RNG).
- Each row: colour name (`tName('color', id, …)`/`t('color.<id>')`) + a one-line desc ("+1 Brutality —
  red, melee damage"), tinted to the colour.
- `onPick(colorId)` → `GameScene._applyColorPick(colorId)`: `runState.<colour>Level += 1`,
  `_syncPlayerScrollStats()` (for survival HP), `_emitHud()`, a coloured camera flash, resume gameplay.
- Freezes gameplay via a `colorPickOpen` flag mirroring `mutationOpen` (gate `update`, hitstop dt,
  interact). Wired at the biome-transition site (GameScene.ts:1041) — **after** or **instead of** the
  mutation offer; the implementer threads it so both can fire across a run without conflicting (offer
  the mutation, then on its close offer the colour pick — or alternate by biome — KISS: offer BOTH in
  sequence, mutation first then colour, each its own frozen modal).

The colour **scrolls** (Decision 8) remain a separate, additive acquisition vector via the existing
Pickup/shop paths — no new wiring (they're just three more rows in the pure table the spawn/shop code
already reads).

## 8. Decision 8 — `_weaponColorMult()` at the player hit sites

```
_weaponColorMult(): number {
  const c = (this.player.equippedWeapon as any).scaling as ColorId
  return colorMult(this._colorLevel(c))   // colorMult(0) === 1 → identity
}
_colorLevel(c: ColorId): number {
  return c === 'brutality' ? this.runState.brutalityLevel
       : c === 'tactics'   ? this.runState.tacticsLevel
       : this.runState.survivalLevel
}
```

Melee (`_onPlayerHitEnemy` GameScene.ts:1781):
`damageMult: this.player.meleeDamageMult * this.player.scrollDamageMult * this._mutationDamageMult(enemy) * this._weaponColorMult()`

Ranged (`_onProjectileHitEnemy` GameScene.ts:1953): append `* this._weaponColorMult()` likewise.

Both are `× 1` at all-0 levels → byte-identical. (Charged-hammer AoE at GameScene.ts:1795 already reuses
`result.damage`, which now carries the colour mult — free.)

## 9. Decision 9 — Skill colour mult baked at `_useSkill` fire time

In `_useSkill(slot)` (GameScene.ts:1338), compute once:
`const m = colorMult(this._colorLevel(spec.scaling))`.

- **volley**: pass a colour-scaled projectile to `acquire` — `{ ...spec.projectile, damage:
  Math.round(spec.projectile.damage * m) }` (a fresh object; never mutate the shared spec). At `m === 1`
  → `Math.round(damage * 1)` === the spec damage (identity).
- **blast**: `this._radialDamage(cx, cy, spec.radius, Math.round((spec.damage ?? 0) * m), spec.knockback, spec.status)`.
  At `m === 1` identity.
- **turret**: bake `m` into the deployed turret's projectile damage. Since the turret reads
  `spec.projectile` over its lifetime, pass a colour-scaled COPY of the spec into
  `this.deployables.acquire(cx, cy, scaledSpec)` (clone spec with `projectile.damage` scaled — never
  mutate the shared SKILLS row). At `m === 1` identity (`Math.round(damage)` unchanged).

Rounding matches `foldWeaponAffix`'s `Math.round` convention so a level-0 skill is byte-identical.

## 10. Decision 10 — Verifier sweep (NEW §14 + additions to §5d / §9 / §11)

Mirror the existing table sweeps' style. Import from `config/colors.ts`:
`COLOR_IDS, COLORS, PER_LEVEL, SURVIVAL_HP_PER_LEVEL, colorMult, survivalHpBonus`.

**NEW §14 — colour table + scaling math:**
- `COLOR_IDS` is exactly `['brutality','tactics','survival']` (length 3); each id resolves in `COLORS`;
  `COLORS[id].id === id`; `name` a non-empty string; `tint` a number.
- `colorMult(0) === 1` EXACTLY (the identity pin — load-bearing for byte-identity).
- `PER_LEVEL > 0`; for `lvl` 1..20: `colorMult(lvl) >= colorMult(lvl-1)` (monotone non-decreasing) AND
  `colorMult(lvl) > 1` (a level actually helps); `colorMult(<0)` clamps to 1 (defensive).
- `SURVIVAL_HP_PER_LEVEL >= 0`; `survivalHpBonus(0) === 0`; monotone non-decreasing over 0..20.

**§5d (weapons) additions:** for every `w` in `WEAPON_ORDER`, assert `COLOR_IDS.includes(w.scaling)`
(a weapon with no/unknown colour fails loudly). After `foldWeaponAffix(w, WEAPON_KEEN)` assert the
folded weapon's `scaling === w.scaling` (the fold preserves the tag). Optionally assert all three
colours appear across the weapon+skill set (no dead colour).

**§11 (skills) additions:** for every `s` in `SKILLS`, assert `COLOR_IDS.includes(s.scaling)`.

**§9 (scrolls) additions:** `SCROLLS.length >= 9`; the never-weaken snapshot adds
`brutalityLevel`/`tacticsLevel`/`survivalLevel` (bigger-is-better — must not decrease); assert each of
the three colour scrolls raises EXACTLY its own level by +1 and leaves the other two unchanged (apply to
a fresh `createRunState`). `SCROLL_IDS.length === SCROLLS.length` (lockstep).

The summary line at the end of `verify-gen.mjs` grows a clause:
`"3 colours (mult identity@0 + monotone, +HP@survival); every weapon+skill colour-tagged"`.

## 11. Files to touch (the implementer's checklist)

- `src/config/colors.ts` — **NEW** pure table (ids, names, tints, `PER_LEVEL`, `SURVIVAL_HP_PER_LEVEL`,
  `colorMult`, `survivalHpBonus`).
- `src/config/weapons.ts` — add required `scaling: ColorId` to `WeaponSpec` (+ `FoldedWeaponSpec` via
  extends), set it on SWORD/HAMMER/SPEAR/GLAIVE/BOW (Decision 5), keep it through `foldWeaponAffix`
  (already rides the `...weapon` spread — add a comment + verify).
- `src/config/skills.ts` — add required `scaling: ColorId` to `SkillSpec`, set it on all 6 skills
  (Decision 5); `import type { ColorId }`.
- `src/config/scrolls.ts` — add the three colour-level fields to `ScrollRunState`; add `scrollBrutality`,
  `scrollTactics`, `scrollSurvival` rows (`apply` bumps the matching level by +1).
- `src/core/RunState.ts` — add `brutalityLevel`/`tacticsLevel`/`survivalLevel` to the `RunState`
  interface; seed all `0` in `createRunState`; (they auto-carry across rebuilds — same as every run
  field). Update the `ScrollRunState`/`MutationRunState` typing if RunState is typed against them.
- `src/scenes/GameScene.ts` — `_weaponColorMult()` + `_colorLevel()` helpers; multiply the colour mult
  into `damageMult` at `_onPlayerHitEnemy` + `_onProjectileHitEnemy`; bake the skill colour mult in
  `_useSkill` (volley/blast/turret); fold `survivalHpBonus` into `_syncPlayerScrollStats`; wire the
  colour-up overlay at the biome transition (`colorPickOpen` flag mirroring `mutationOpen`, gate
  `update`/dt/interact); `_applyColorPick`; emit the three colour levels to the registry in `_emitHud`
  + the create() seed.
- `src/entities/ColorOverlay.ts` — **NEW** (or generalise `MutationOverlay.ts`) — the 3-of colour picker
  (frozen modal, programmer-art, i18n'd, `onPick(colorId)`).
- `src/scenes/HUDScene.ts` — three small coloured pips/numbers reading the three registry keys, with the
  equipped weapon's colour highlighted (read an `equippedColor` registry key GameScene writes).
- `src/i18n/en.ts` + `src/i18n/zh-CN.ts` — colour names (chrome `color.*` + a `color` content category if
  using `tName`), the HUD colour-row label, the colour-picker chrome (title/subtitle/help), the three
  colour-scroll names (scrolls are apply-only today, so prefer chrome keys read where the scroll is shown,
  or a `scroll` content category if names render). Add `'color'` to `Category` in `i18n/index.ts` if a
  content category is used.
- `scripts/verify-gen.mjs` — import `config/colors.ts`; NEW §14 sweep; §5d/§9/§11 additions; summary
  clause (Decision 10).

## 12. Identity-Preservation Notes (must hold)

- Every new RunState field defaults to **0** (`brutalityLevel`/`tacticsLevel`/`survivalLevel`).
- `colorMult(0) === 1` is the pinned identity — verified EXACTLY (not approximately). Composing it into
  `damageMult` is `× 1` at level 0, so `resolveHit`'s round-once output is byte-identical to the pinned
  damages.
- Skill damage is `Math.round(damage × 1)` at level 0 — equals the spec damage exactly.
- `survivalHpBonus(0) === 0` — `_syncPlayerScrollStats` derives the same `maxHp` as today.
- `foldWeaponAffix` is unchanged in behaviour except carrying `scaling` (a tag, never scaled).
- No generator change ⇒ the **level regression pin** (`PIN_TILES`/`PIN_EXPECTED`) and the determinism
  deep-equal are **untouched**. Colour drops/picks are off the generator's pinned RNG (the colour scrolls
  drop like existing scrolls via `Math.random`/level-seed-off-pin; the overlay pick is a UI choice, not a
  generator input).
- A fresh run never offers a colour pick until a biome transition, and never spawns a colour scroll on
  level 0 unless the existing scroll-spawn path already would — additive only.

## 13. Monotonicity Notes (the never-weaken sweep)

- `colorMult` is monotone non-decreasing in level and `> 1` for level ≥ 1 (a colour level only ever
  HELPS). `survivalHpBonus` is monotone non-decreasing. Both verified over 0..20.
- The three colour scrolls only ever `+= 1` a level (bigger-is-better) — added to the §9 never-weaken
  snapshot.
- `PER_LEVEL` and `SURVIVAL_HP_PER_LEVEL` are positive/non-negative constants (no per-level decay).

## 14. Open Questions (defaulted, not blocking)

- **Overlay sequencing at a biome transition** — default: offer the mutation modal, then on its close
  offer the colour modal (two sequential frozen modals). If that feels heavy, alternate by biome. The
  implementer may pick the smoother UX; both satisfy the AC.
- **`scaling` storage as enum vs string union** — use the `ColorId` string union (matches
  `SkillKind`/weapon `type` style). No runtime enum.
