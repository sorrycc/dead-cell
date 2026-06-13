# F3 Cursed Chests — a choice-driven interactable: guaranteed loot for a kill-N-to-clear curse

## 1. Background

Dead Cells' **cursed chest** is a rare interactable: open it for *guaranteed* strong loot, but you are
one-shot (or take greatly amplified damage) until you kill N enemies — each kill peels a curse stack. You
can always walk past it. The risk/reward is the whole point.

We already have **every seam** this needs — EXTEND, never duplicate:

- **The interact-on-E seam.** `entities/Shop.ts` is a stand-on interactable: a drawn rect + an Arcade
  SENSOR body, an overlap that calls `markInRange()` (sets `playerInRange` true for the frame), a
  floating prompt (`t('shop.prompt')`), and `resetInRange()` that drives the prompt + clears the flag.
  `GameScene` wires the overlap (`_maybePlaceShop`, `GameScene.ts:1796`), reads the E edge
  (`update()` → `if (inputState.interactPressed) this._tryOpenShop()`, `GameScene.ts:2773`), and resets
  the flag AFTER the read (`GameScene.ts:2791`, the shop-flag-reset-ordering fix). The cursed chest is a
  SECOND such interactable, modelled identically.
- **The single player-damage funnel.** `GameScene._hurtPlayer(result)` (`GameScene.ts:1874`) is the ONE
  place all four player-hit sites (enemy melee / enemy contact / enemy projectile / hazard) route through.
  It already scales `result.damage` by the per-room `roomDamageTakenMult` (the existing CURSED *room*
  debuff) BEFORE `player.onHit`. The chest curse composes a SECOND multiplicative factor here. Crucially,
  every caller checks `this.player.isHittable()` BEFORE calling `_hurtPlayer` (e.g. `GameScene.ts:2129`),
  and the parry window is consumed inside `player.onHit` — so the curse touches DAMAGE ONLY, never
  invulnerability. Dodge i-frames and parry keep negating hits while cursed, for free.
- **The run-only value object.** `core/RunState.ts` carries run-scoped scalars, each defaulting to a
  neutral identity (e.g. `scrollDamageMult: 1`, `weaponRarityId: null`). `curseStacks` is one more scalar
  (default `0` = no curse). Run-only — NOT banked to meta.
- **The enemy kill hook.** `enemy.onDeath` (`GameScene.ts:1672`) already bumps `runState.kills` and runs
  the Predator/Hemorrhage perks. Decrementing `curseStacks` on a kill is one more line in this hook.
- **The guaranteed-loot path.** `_equipWeaponWithAffix(weaponId, affixId, rarityId)` (`GameScene.ts:1297`)
  folds + equips a weapon at a given rarity and records it on RunState. `rollRarityId` / `RARITIES`
  (`config/rarity.ts`) give the high-rarity roll. `runState.gold += n` and the scroll pickup path
  (`SCROLLS_BY_ID[id].apply(runState)` + `_syncPlayerScrollStats`, `GameScene.ts:2153`) cover the
  "colour scroll + gold" alternative reward. NO new loot machinery.
- **The HUD.** `HUDScene` reads registry keys GameScene writes each frame (`registry.set(...)`,
  `GameScene.ts:332+`) and renders a label per line. A curse indicator is one more registry key + one
  more `Text` line (shown only while cursed — empty string hides it, like the mutations line).
- **Pure config + verifier.** `config/rarity.ts` / `config/roomTypes.ts` are the template for a new pure
  `config/curses.ts`; `scripts/verify-gen.mjs` node-imports every table and sweeps well-formedness +
  monotonicity (`§15` rarity is the closest mirror). The curse config gets the same guardrail.
- **i18n.** `i18n/en.ts` (`ui` chrome) + `i18n/zh-CN.ts`, read via `t()`. The chest prompt, the curse
  warning, and the HUD curse label add BOTH locales.

What is **missing**: there is no interactable chest, no run-only curse stack, no curse damage rule, and no
HUD curse tell. We add exactly that, gated behind `curseStacks > 0` so a default run is byte-identical.

### Distinct from the existing CURSED *room type* (do not confuse them)

`config/roomTypes.ts:ROOM_CURSED` is a per-ROOM debuff: on a cursed room the whole room sets
`roomDamageTakenMult = 1.4` for that level, with `lootMult 2.0` + a guaranteed scroll. It resets on the
next level. The **cursed CHEST** in this slice is a *choice-driven interactable OBJECT* the player opens
on E: it grants guaranteed loot ON OPEN and applies a curse that clears by KILLING enemies (not by
leaving the level). The two are independent and compose multiplicatively in `_hurtPlayer` (a cursed chest
opened in a cursed room is doubly dangerous — intended, both identity-gated).

## 2. Requirements Summary

- **A new pure `config/curses.ts`** (NO Phaser): a single pinned `CURSE` config object
  `{ killsToClear, damageMult }` (+ the loot-tier constants), an `effectiveCurseMult(stacks)` pure helper
  (the multiplicative damage-taken factor for the current stack count), and an `id→`-style export shape
  mirroring `config/rarity.ts`. PLAIN DATA, verifier-swept.
- **`curseStacks === 0` is the IDENTITY**: `effectiveCurseMult(0) === 1` EXACTLY → `_hurtPlayer` is
  byte-unchanged when not cursed. A fresh run never opens a chest → `curseStacks` stays 0 → byte-identical.
- **A `CursedChest` interactable** (`entities/CursedChest.ts`) modelled on `entities/Shop.ts`: a drawn
  rect + Arcade SENSOR body, `markInRange()` / `resetInRange()`, a floating `[E] CURSED CHEST` prompt, and
  an `opened` flag so it can only be opened once (after opening it reads as a spent chest — no prompt).
- **GameScene places it RARELY off the level seed** on NORMAL levels only (never boss/miniboss levels),
  off the SAME off-the-pin RNG discipline as the shop/weapon pickup (the level regression pin is untouched).
- **Opening (E) grants GUARANTEED strong loot AND applies the curse.** Loot is one of two guaranteed
  outcomes (rolled off the placement RNG so it is deterministic per seed): a HIGH-rarity affixed weapon
  (reuse the F2 rarity fold), OR a colour scroll + gold. Then set `curseStacks = CURSE.killsToClear`.
- **While cursed, the player takes greatly amplified damage** (the `damageMult` rule, applied in
  `_hurtPlayer`, composing with `roomDamageTakenMult`). Dodge/parry i-frames STILL negate hits (the curse
  only scales damage AFTER the `isHittable()` gate — no change to invulnerability).
- **Each enemy kill removes one curse stack** (`enemy.onDeath` decrements `curseStacks`, clamped ≥ 0).
  At 0 the curse is fully cleared (the damage rule reverts to identity).
- **The HUD shows curse stacks** while cursed (`CURSED — N kills left`, in a danger colour) and a clear
  tell that the player is in danger; nothing shown when `curseStacks === 0`.
- **Reset cleanly on rebuild**: `curseStacks` is a run scalar carried across level rebuilds (the curse
  persists between levels until killed off — that is the genre behaviour); the per-room `roomDamageTakenMult`
  continues to reset every level independently (the existing `_applyRoomType` reset, untouched).
- **i18n** — the prompt, the open-warning, and the HUD label in BOTH `en.ts` and `zh-CN.ts`.
- **Verifier sweep** — `config/curses.ts` is well-formed (positive integer `killsToClear`, sane
  `damageMult ≥ 1`), `effectiveCurseMult(0) === 1` EXACTLY (the identity), and the curse mult is monotone
  non-decreasing in stacks + never < 1 (never-weaken: a curse only ever HELPS the enemy / hurts you more,
  never makes you take LESS damage than baseline).

### Identity (the hard constraint)

A fresh run never touches a chest → `curseStacks` stays `0`. `effectiveCurseMult(0) === 1`, so the one new
line in `_hurtPlayer` (`result.damage = round(result.damage * curseMult)` guarded by `curseMult !== 1`)
is a no-op and `_hurtPlayer` is byte-identical. `enemy.onDeath`'s decrement is guarded by
`if (this.runState.curseStacks > 0)` → no-op at 0. `createRunState` seeds `curseStacks: 0`. The chest
placement is RARE and OFF the generator's pinned draw (a fresh `mulberry32` with a distinct mix constant,
exactly like `_maybePlaceShop`) → the level regression pin + the determinism deep-equal in
`verify-gen.mjs` are UNCHANGED. The HUD curse line renders empty (hidden) at 0 stacks → no chrome change.
The verifier's RunState determinism walk never opens a chest, so it is unaffected.

### Non-goals (YAGNI)

- **No literal one-shot kill by default.** The integration map offers "one-shot OR greatly amplified
  damage". We pick **greatly amplified damage** (a large `damageMult`, e.g. 3×) as the pinned default — it
  is the same `_hurtPlayer` math as the cursed room (DRY), survives a chip-damage tick without an instant
  death surprise, and stays monotone-sweepable. (A literal `oneShot` boolean is a documented one-line
  alternative in Decision 4, but NOT shipped — KISS.) "Greatly amplified" reads as the curse; the player
  still feels the lethality.
- **No new combat math in `damage.ts`** — it stays pure; the curse mult is folded into `_hurtPlayer`
  exactly where `roomDamageTakenMult` already is.
- **No banked curse / meta curse.** `curseStacks` is run-only; permadeath drops it. A fresh run is never
  cursed.
- **No multiple live chests per level.** At most ONE chest per level (like the shop), rare.
- **No curse on the enemy side / no curse VFX system.** A camera tint/flash on open + the HUD tell is the
  whole feedback (programmer-art).
- **No new input system.** Reuse the E edge (`inputState.interactPressed`) the shop already reads. The E
  press is shared: standing on the chest opens it; standing on the vendor opens the shop. They are placed
  at different spots and the open handlers guard on their own in-range flag, so one E press resolves to at
  most one interactable (see Decision 3).

## 3. Acceptance Criteria

1. **`config/curses.ts` (NEW, PURE — no Phaser).** Exports:
   - `CurseConfig = { killsToClear: number; damageMult: number }`.
   - `CURSE: CurseConfig` — pinned: `killsToClear` a positive integer (e.g. `4`), `damageMult ≥ 1`
     (e.g. `3` — "greatly amplified"). The doc + verifier are the contract (mirrors `config/rarity.ts`'s
     pinned-data comment).
   - `LOOT_RARITY: RarityId` — the GUARANTEED high tier the chest weapon rolls at (e.g. `'epic'`),
     imported from `config/rarity.ts` (reuse F2). Plus `LOOT_GOLD` (the gold granted with the scroll
     alternative, e.g. `40`).
   - `effectiveCurseMult(stacks: number): number` — PURE. `stacks <= 0` ⇒ `1` EXACTLY (the identity).
     `stacks > 0` ⇒ `CURSE.damageMult` (a flat amplified factor while ANY stack remains — KISS; the
     "kill N to clear" is the stack COUNT, not a per-stack ramp). Always `≥ 1` (never-weaken).
2. **`entities/CursedChest.ts` (NEW).** A class mirroring `entities/Shop.ts`:
   - Ctor `(scene, spot: {x,y})` draws a chest rect (a distinct curse colour — a dark purple fill with a
     red/gold stroke, programmer-art) anchored on the platform top like the Shop slab; adds an Arcade
     SENSOR body (`setAllowGravity(false)`, `setImmovable(true)`), a back-ref (`(rect as any).chestRef`),
     a small marker glyph, and a floating prompt `t('chest.prompt')` hidden until in range.
   - `playerInRange: boolean` + `markInRange()` (set true) + `resetInRange()` (drive prompt visibility off
     the flag, then clear it) — EXACTLY the Shop lifecycle.
   - `opened: boolean` (default false). Once opened, `setOpened()` dims the rect (spent look), removes the
     pulse tween, and `resetInRange()` keeps the prompt hidden (an opened chest is inert).
   - `destroy()` tears down the rect/body/tag/prompt/tween (level→level rebuild discipline, like Shop).
3. **GameScene places the chest RARELY on NORMAL levels only.** A new `_maybePlaceCursedChest(desc)`
   (called from `_buildLevel` next to `_maybePlaceShop`):
   - Returns immediately on a boss/miniboss level (`isBossLevel()` / `isMinibossLevel()`), and is NOT
     called from `_buildBossLevel`/`_buildMinibossLevel` paths (the chest never appears on set-pieces).
   - Rolls off a fresh `mulberry32((desc.seed ^ <distinct-mix>) >>> 0)` (a NEW mix constant, distinct from
     the weapon/shop/blueprint/room rolls so they don't correlate) — OFF the generator's pinned draw, so
     the level pin is intact. A LOW chance (`CURSED_CHEST_CHANCE`, e.g. `0.12` — rare).
   - Places it at a standable spawn candidate off the entrance/exit (the SAME spot-selection idiom as
     `_maybePlaceShop`), wires an overlap (`player.collider` × `chest.rect`) calling
     `chest.markInRange()` with a process callback `() => !this.shopOpen && !this.transitioning &&
     !this.gameOver && !this.chest.opened` (an opened chest stops flagging in-range).
   - Stores the live chest on `this.chest` (null on levels without one); `_teardownLevel` destroys it +
     nulls it (mirror the shop teardown at `GameScene.ts:1175`).
4. **Opening on E grants guaranteed loot + the curse.** `_tryOpenChest()` (mirrors `_tryOpenShop`):
   - Guard: `if (this.gameOver || this.transitioning || this.shopOpen) return`; then
     `if (this.chest && this.chest.playerInRange && !this.chest.opened) this._openCursedChest()`.
   - Called from `update()` on the SAME `inputState.interactPressed` edge, RIGHT AFTER `_tryOpenShop()`
     (Decision 3 pins the ordering + the mutual-exclusion guard so one E press opens at most one thing).
   - `_openCursedChest()`:
     - `this.chest.setOpened()` (so it cannot be re-opened / re-grant loot).
     - GRANT GUARANTEED LOOT — roll one of two outcomes off a deterministic RNG seeded from the chest's
       placement seed (so a replay grants the same loot): (a) a high-rarity affixed weapon — pick a weapon
       not currently equipped (the `weaponPool` filter idiom), roll an affix (`_rollWeaponAffix`), and call
       `_equipWeaponWithAffix(weaponId, affixId, LOOT_RARITY)` (the F2 fold gives a guaranteed
       `LOOT_RARITY` weapon); OR (b) a colour scroll + gold — `SCROLLS_BY_ID[id].apply(this.runState)` +
       `_syncPlayerScrollStats()` + `this.runState.gold += LOOT_GOLD`. EITHER way the player is
       meaningfully rewarded (guaranteed strong loot — AC target).
     - APPLY THE CURSE — `this.runState.curseStacks = CURSE.killsToClear`.
     - FEEDBACK — a camera flash/tint in the curse colour + a brief banner (reuse `_popRoomBanner`-style
       primitive or a one-off Text) using `t('chest.cursed')`, and `sfx` if a façade hook exists (a
       no-op-safe call; otherwise omit — no new asset).
     - `_emitHud()` / the next registry write surfaces the new curse stack count.
5. **Each kill removes a stack.** In `enemy.onDeath` (`GameScene.ts:1672`), after the existing
   `runState.kills += 1`, add: `if (this.runState.curseStacks > 0) this.runState.curseStacks -= 1`
   (clamped ≥ 0 by the guard). At 0 the curse is cleared. The boss `onDeath` hooks (`GameScene.ts:833`,
   `:914`) MAY also decrement for consistency (a boss kill is a kill) but a chest never spawns on a boss
   level, so a curse can only reach the boss room if carried in — decrementing there is a harmless
   correctness nicety (Decision 5).
6. **`_hurtPlayer` applies the curse (the SINGLE damage funnel).** In `_hurtPlayer(result)`
   (`GameScene.ts:1874`), compose the curse mult with the room mult:
   `const mult = (this.roomDamageTakenMult ?? 1) * effectiveCurseMult(this.runState.curseStacks)` then the
   existing `if (mult !== 1) result.damage = Math.round(result.damage * mult)`. The curse only scales
   DAMAGE (not knockback), AFTER every caller's `isHittable()` gate and BEFORE `player.onHit` (which
   consumes the parry window) — so dodge i-frames + parry still NEGATE hits while cursed (the AC target).
   Identity-safe: `curseStacks 0` → `effectiveCurseMult 0 === 1` → `mult` is the room mult alone → byte-
   identical to today.
7. **`core/RunState.ts` carries the curse.** Add `curseStacks: number` (default `0` = no curse),
   documented like the other run-only identity fields. Carried across level rebuilds (the scene reuses the
   persisted RunState). NOT seeded from meta. NOT banked. `createRunState` seeds `0` (the verifier's
   determinism walk never sets it → unaffected).
8. **HUD shows the curse.** GameScene writes `registry.set('curseStacks', this.runState.curseStacks)` in
   the create-time seed + every `_emitHud`. `HUDScene` adds ONE left-anchored `Text` line (a danger
   colour, e.g. red `#e74c3c`) that reads `t('hud.curse', { n })` while `curseStacks > 0` and the EMPTY
   string when `0` (so the line is hidden — the additive identity, the same idiom as the mutations line at
   `HUDScene.ts:194`). Pixel-anchored single Text — no column-alignment work.
9. **i18n (BOTH locales).** Add to `i18n/en.ts` (`ui`) AND `i18n/zh-CN.ts` (`ui`):
   - `chest.prompt` — the floating prompt, e.g. `[E] CURSED CHEST`.
   - `chest.cursed` — the on-open warning banner, e.g. `CURSED! Kill {n} enemies to break it.`
   - `hud.curse` — the HUD line, e.g. `CURSED — {n} kills left`.
   No bare English literals reach the UI (every string via `t()`).
10. **Verifier sweep (NEW section in `scripts/verify-gen.mjs`).** Node-import `config/curses.ts` and
    assert:
    - `CURSE.killsToClear` is an INTEGER `> 0`; `CURSE.damageMult` is a number `≥ 1`.
    - `effectiveCurseMult(0) === 1` EXACTLY (the identity) and `effectiveCurseMult(-1) === 1` /
      `effectiveCurseMult(0) === 1` (clamp at/below 0).
    - `effectiveCurseMult` is monotone non-decreasing over `stacks ∈ [0..killsToClear]` and every value
      `≥ 1` (never-weaken: a curse never makes the player take LESS than baseline).
    - `LOOT_RARITY` resolves in `RARITIES` and is a NON-common tier (the loot is guaranteed STRONG);
      `LOOT_GOLD` is a number `> 0`.
    - Update the final summary `console.log` to mention the curse config (e.g. `+ curse config (identity
      at 0 stacks + monotone mult)`).
11. **Build + verifier green.** `npm run verify` and the Vite/tsc build pass. The level regression pin and
    the determinism deep-equal are unchanged.

## 4. Numbered Decisions

1. **The chest is a SECOND interactable, modelled on `entities/Shop.ts` — NOT a Pickup.** A Pickup is a
   touch-to-collect drop; a cursed chest is a deliberate E-to-open CHOICE (you can walk past it). The Shop
   already proves the "stand-on + prompt + E edge + in-range flag" pattern; we clone its shape into a small
   `CursedChest` class. We do NOT extend Pickup (wrong semantics) and do NOT build a generic interactable
   framework (YAGNI — two interactables don't justify an abstraction; if a THIRD lands, refactor then).

2. **Reuse the existing E edge — no new input.** `update()` already reads `inputState.interactPressed`
   (`GameScene.ts:2773`) and calls `_tryOpenShop()`. We add `_tryOpenChest()` on the same edge. KISS.

3. **One E press opens at most one interactable (mutual exclusion + ordering).** The shop and the chest are
   placed at different standable spots, so the player is rarely in range of both. Defensively: `update()`
   calls `_tryOpenShop()` THEN `_tryOpenChest()`; `_tryOpenChest()` guards `!this.shopOpen` (so if the E
   just opened the shop, the chest's open is skipped that frame), and `_openCursedChest()` sets the chest
   `opened` immediately so a held-overlap can't re-fire. After the read, `chest.resetInRange()` runs in the
   SAME place the shop's reset runs (`GameScene.ts:2791`), AFTER `_tryOpenChest`, so the flag follows the
   correct Phaser UPDATE-before-sceneUpdate lifecycle (the shop-flag-reset-ordering fix applies verbatim).
   The chest open does NOT pause the world (unlike the shop overlay) — it is an instantaneous grant, so
   there is no close→reopen race and no `consumeInteract()` needed.

4. **"Greatly amplified damage", not a literal one-shot (the integration map's OR).** We pin
   `damageMult = 3` (×3 damage taken while cursed) rather than a `oneShot` boolean. Rationale: it reuses
   the EXACT `_hurtPlayer` mult math the cursed room already uses (DRY), it is monotone-sweepable by the
   verifier (a boolean one-shot is not a "scaling"), and it avoids a feel-bad instant death from a 1-damage
   chip tick while still being lethal (a ×3 hit from a depth-scaled enemy is near-fatal — it reads as a
   curse). Documented one-line alternative if a literal one-shot is later wanted: an `oneShot: boolean` on
   `CurseConfig` and `effectiveCurseMult` returning a huge sentinel (or `_hurtPlayer` special-casing it to
   `result.damage = this.player.hp`). NOT shipped — KISS/YAGNI.

5. **The curse clears by KILLS, persists across levels (genre behaviour), and is run-only.** `curseStacks`
   counts DOWN on `enemy.onDeath`. It is carried across level rebuilds (the curse follows you to the next
   level until you've killed enough — you can't escape it by leaving), distinct from the per-ROOM
   `roomDamageTakenMult` which resets every level. Boss `onDeath` hooks may also decrement (a boss is a
   kill — harmless correctness), but since chests never spawn on set-pieces this only matters if a curse is
   carried INTO a boss room. `curseStacks` is run-only (permadeath drops it) and never banked to meta.

6. **The two damage-taken mults compose multiplicatively in `_hurtPlayer`.** `roomMult × curseMult`. Both
   default to 1, so the product is 1 when neither is active (identity). A cursed chest opened inside a
   cursed room stacks the danger — intended (and the verifier proves each factor is `≥ 1`, so the product
   never weakens). The composition lives in the ONE funnel — no second hit site to keep in sync (DRY).

7. **Loot is GUARANTEED strong, rolled deterministically off the placement seed.** Two outcomes (a
   high-rarity affixed weapon OR a colour scroll + gold), chosen off a deterministic RNG seeded from the
   chest's placement seed so a replay grants the same loot (the off-the-pin determinism discipline the
   weapon/branch placements already follow). Reuses `_equipWeaponWithAffix(..., LOOT_RARITY)` and the
   scroll-apply / `runState.gold +=` paths — NO new loot machinery (DRY). Both outcomes are meaningfully
   strong (the AC requires "guaranteed strong loot"); the weapon outcome leans on F2 rarity for the punch.

8. **The chest is RARE and NORMAL-levels-only, OFF the generator's pinned draw.** A LOW
   `CURSED_CHEST_CHANCE` (the carrot is rare, like the genre). Off a fresh `mulberry32` with a DISTINCT mix
   constant (uncorrelated with the weapon/shop/blueprint/room rolls), NOT on the generator's pinned RNG —
   so the level regression pin + determinism deep-equal are untouched (Decision 8 discipline, mirroring
   `_maybePlaceShop`). Never on boss/miniboss levels (guarded by `isBossLevel()`/`isMinibossLevel()` and
   not called from the set-piece build paths).

9. **HUD: ONE danger-coloured line, shown only while cursed.** A single registry key (`curseStacks`) + one
   `Text` line in `HUDScene` that reads `t('hud.curse', { n })` when `> 0` and the empty string at `0`
   (hidden — the additive identity, the mutations-line idiom). KISS — no new widget, no column work. The
   on-open banner + camera tint give the immediate "you are cursed" tell; the HUD line is the persistent
   counter.

10. **Pinned constants live in `config/curses.ts` (the doc is the contract).** `CURSE.killsToClear`,
    `CURSE.damageMult`, `LOOT_RARITY`, `LOOT_GOLD`, and `CURSED_CHEST_CHANCE` (placement chance — may live
    next to the other GameScene chance consts at `GameScene.ts:138/158` for locality, OR in
    `config/curses.ts`; pick ONE — the verifier sweeps the pure-config ones). Comment that the design doc +
    the verifier are the contract, exactly as `config/rarity.ts` pins its data.

## 5. Integration Map (files the implementer will touch)

- **`src/config/curses.ts`** — NEW pure table: `CurseConfig`, `CURSE`, `LOOT_RARITY`, `LOOT_GOLD`,
  `effectiveCurseMult(stacks)`. (Imports `RarityId`/`RARITIES` from `config/rarity.js` for `LOOT_RARITY`.)
- **`src/entities/CursedChest.ts`** — NEW interactable class (mirrors `entities/Shop.ts`): drawn rect +
  SENSOR body, `markInRange`/`resetInRange`, prompt via `t('chest.prompt')`, `opened`/`setOpened`,
  `destroy`.
- **`src/core/RunState.ts`** — add `curseStacks: number` (default `0`), documented + seeded in
  `createRunState`.
- **`src/scenes/GameScene.ts`** — `this.chest` field + null init; `_maybePlaceCursedChest(desc)` called
  from `_buildLevel` (next to `_maybePlaceShop`); the overlap wiring; `_tryOpenChest()` +
  `_openCursedChest()` (grant loot + set `curseStacks`); the E-edge call in `update()` after
  `_tryOpenShop()`; `chest.resetInRange()` next to the shop reset; `_teardownLevel` destroy + null; the
  `enemy.onDeath` decrement; the `_hurtPlayer` curse-mult composition; the `curseStacks` registry write in
  the create-time seed + `_emitHud`. Import `CURSE`, `LOOT_RARITY`, `LOOT_GOLD`, `effectiveCurseMult` from
  `config/curses.js` (+ `CURSED_CHEST_CHANCE` wherever it is pinned).
- **`src/scenes/HUDScene.ts`** — one `curseLabel` Text (danger colour); in `update()` read
  `registry.get('curseStacks')` and set `t('hud.curse', { n })` while `> 0`, else `''` (hidden).
- **`src/i18n/en.ts`** — `chest.prompt`, `chest.cursed`, `hud.curse` in `ui`.
- **`src/i18n/zh-CN.ts`** — the same three keys in `ui` (zh translations).
- **`scripts/verify-gen.mjs`** — node-import `config/curses.js`; NEW sweep (well-formed `CURSE`,
  `effectiveCurseMult(0) === 1` identity + clamp ≤ 0, monotone-non-decreasing + every `≥ 1`, `LOOT_RARITY`
  is a known non-common tier, `LOOT_GOLD > 0`); update the final summary `console.log`.

## 6. Identity-Preservation Checklist (the implementer MUST verify)

- [ ] A fresh run never opens a chest → `curseStacks` stays `0`; `_hurtPlayer` is byte-identical (the
      `mult` reduces to `roomDamageTakenMult` alone, and `effectiveCurseMult(0) === 1`).
- [ ] `enemy.onDeath`'s decrement is guarded by `curseStacks > 0` → a no-op at 0 stacks.
- [ ] `createRunState` seeds `curseStacks: 0`; a default save plays byte-identically.
- [ ] The chest placement is RARE and OFF the generator's pinned RNG (fresh `mulberry32`, distinct mix) →
      the level regression pin + determinism deep-equal in `verify-gen.mjs` are unchanged.
- [ ] The chest NEVER spawns on boss/miniboss levels (guarded + not called from set-piece build paths).
- [ ] The HUD curse line renders EMPTY (hidden) at 0 stacks → no chrome change for an uncursed run.
- [ ] While cursed, a dodge-roll / a parry still NEGATES a hit (the `isHittable()` gate + the parry window
      run BEFORE the curse mult in `_hurtPlayer` — the curse touches damage only, never invulnerability).
- [ ] Opening grants loot ONCE (the `opened` flag); a held E / re-overlap cannot re-grant or re-curse.
- [ ] Walking past the chest leaves the run unchanged (no loot, no curse — the identity for the skip path).

## 7. Verifier Notes (the CI gate)

Add a new numbered section (after `§15` rarity) that node-imports `config/curses.js` and asserts, in the
existing `fail(...)`-on-violation style (mirroring the `§14` colours / `§15` rarity sweeps):

- **Well-formedness:** `CURSE.killsToClear` is an integer `> 0`; `CURSE.damageMult` is a number `≥ 1`;
  `LOOT_GOLD` is a number `> 0`; `LOOT_RARITY` resolves in `RARITIES` AND is NOT `'common'` (guaranteed
  STRONG loot).
- **Identity at 0 stacks:** `effectiveCurseMult(0) === 1` EXACTLY; `effectiveCurseMult(-1) === 1` (clamp
  at/below 0 → the no-curse baseline).
- **Monotone never-weaken:** `effectiveCurseMult` is non-decreasing over `stacks ∈ [0..killsToClear]` and
  every value is `≥ 1` (a curse never makes the player take LESS damage than baseline).
- Update the final summary `console.log` to include the curse config (e.g. `+ curse config (identity at 0
  stacks + monotone damage mult, strong loot tier)`).
