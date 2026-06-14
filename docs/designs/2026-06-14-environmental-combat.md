# F5 Environmental Combat — two-way hazards + destructible blast barrels

## 1. Background

Dead Cells turns the *environment* into a weapon: knock an enemy into spikes and it dies; smash an oil/bomb
barrel and the blast clears (or kills) the pack — and you, if you stood too close. We have the player-side
half already (the player knockback shoves enemies, and hazard tiles already hurt the player). This slice adds
the two missing halves: **hazards damage ENEMIES too**, and a rare **destructible barrel** prop that detonates
a radial blast on break.

We already have **every seam** this needs — EXTEND, never duplicate:

- **The player×hazard overlap + tick-on-cooldown.** `GameScene._onHazardContact()` (`GameScene.ts:1071`)
  bites the player for `HAZARD_DAMAGE` on a `_hazardCooldown` gate (0.7s), reusing `resolveHit` + `_hurtPlayer`.
  `_hazardCollider` (`GameScene.ts:872`) is the `overlap(player.collider, tileMap.hazardBodies)`. The hazard
  bodies are promoted from render-only rects by `tileMap.enableHazardBodies()` in EVERY normal level, and the
  static body group is **already public** as `tileMap.hazardBodies` (`TileMap.ts:40`). We mirror this with an
  ENEMY×hazard overlap.
- **The radial-damage primitive.** `GameScene._radialDamage(x, y, radius, damage, knockback, status)`
  (`GameScene.ts:1695`) hits every live enemy + the boss within `radius`, shoving each away from the origin,
  reusing `resolveHit` + `enemy.onHit` + `_applyHitStatus(target, _scaleStatus(status))` + `effects.hit`. A
  `status: {kind:'burn', ...}` rides the existing DoT path with NO new math (`status.ts:35` — `burn` is a known
  kind). This is EXACTLY the barrel's enemy-side blast.
- **The enemy→player radial.** `GameScene._enemyRadialDamage(x, y, {radius, damage, knockback})`
  (`GameScene.ts:1728`) hits the PLAYER if within range, routing through `_hurtPlayer` (so the cursed-room /
  cursed-chest damage mults + parry/Second-Wind apply) and `isHittable()` (so dodge i-frames negate it). This
  is EXACTLY the barrel's "hurt the player if too close" half.
- **Player knockback already shoves enemies.** `enemy.onHit(result)` (`Enemy.ts:250`) does
  `body.setVelocity(result.knockbackX * knockbackTakeMult, result.knockbackY)`. The player's melee hit
  (`_onPlayerHitEnemy`, `GameScene.ts:2202`) and projectile hit (`_onProjectileHitEnemy`) already call it, so a
  hammer/spear swing already launches enemies horizontally — into spikes or a barrel. No new knockback code.
- **The placement idiom (off the pinned draw).** `_maybePlaceShop` (`GameScene.ts:2031`) /
  `_maybePlaceCursedChest` (`GameScene.ts:2059`) roll a fresh `mulberry32((desc.seed ^ <DISTINCT-MIX>) >>> 0)`
  — NOT on the generator's pinned RNG — pick a `desc.spawnCandidates[...]` spot, and store the live entity on a
  scene field destroyed by `_teardownLevel`. The barrel placement clones this idiom verbatim.
- **The collider teardown discipline.** `_teardownLevel` (`GameScene.ts:1277`) removes per-level colliders +
  destroys per-level entities, mirroring the hazard/shop/chest teardown. The new enemy×hazard collider + the
  barrels are torn down here.
- **Pure config + verifier.** `config/curses.ts` (`§16` in `verify-gen.mjs`) is the closest template for a new
  pure `config/props.ts` (barrel flavours): plain data, node-imported + swept for well-formedness.
- **i18n.** `i18n/en.ts` / `i18n/zh-CN.ts` via `t()`. Any barrel label/prompt adds BOTH locales.

What is **missing**: hazards do nothing to enemies (only the player), and there is no destructible prop. We add
exactly that — additively, so a default run is byte-identical (no barrel placed → no behaviour; the enemy×hazard
overlap is a NEW reachable-only tick that never touches the player path or the level RNG).

### What we are NOT changing (to avoid confusion)

- The **player×hazard** path (`_onHazardContact`) is untouched — its damage, cooldown, and feel stay exactly as
  today. We ADD a parallel ENEMY×hazard tick; the player path is one half of the existing system.
- The barrel reuses `_radialDamage` (enemy side) AND `_enemyRadialDamage` (player side) — NO new combat math.

## 2. Requirements Summary

### (a) Two-way hazards — hazard tiles damage enemies

- Wire a NEW `overlap(enemyHurtboxes, tileMap.hazardBodies)` in `_buildLevel` (and `_buildBossLevel`), right
  next to the existing player×hazard overlap, on a SEPARATE cooldown (`_enemyHazardCooldown`) so the spike bite
  doesn't shred enemy HP every frame.
- The overlap callback ticks the OVERLAPPING enemy's HP via `enemy.onHit(...)` (a synthetic upward-pop hit,
  mirroring `_onHazardContact`'s shape) — so an enemy standing on / knocked onto spikes takes damage and
  eventually dies.
- **FLYERS are exempt.** Guard with the SAME `_enemyNotFlyer(enemyRect)` predicate the solids/oneWay colliders
  already use (`GameScene.ts:853/959`) — a `noGravity` flyer hovers, never touching the floor spikes, so it
  skips the tick (consistent with the solids collider that already lets flyers pass through).
- The boss IS in `enemyHurtboxes` (`enemyHurtboxes.add(boss.collider)`), so the enemy×hazard overlap wired in
  `_buildBossLevel` WOULD see it — and the boss has a `dash` attack that moves its body across the arena on a
  gravity-frozen body. So the enemy×hazard PROCESS callback EXCLUDES the boss (`_isBoss(enemyRect)` → skip): a
  dashing boss crossing a hazard tile must NOT take a free synthetic hazard hit + an upward-pop knockback on a
  frozen body (review BLOCKER). The AC's enemy-hazard death targets NORMAL-level enemies, not the set-piece boss.
  The overlap is still wired in the boss arena (consistent with the player×hazard overlap there), but the boss is
  gated out; any normal arena enemies (boss adds — none today) would still tick.

### (b) Destructible blast barrels

- A new pure **`config/props.ts`** table of barrel FLAVOURS (`explosive` / `oil`): each a `{ radius, damage,
  knockback, status? }` blast spec. PLAIN DATA (no Phaser), verifier-swept.
- A new **`entities/Prop.ts`** — a destructible barrel: a drawn rectangle (programmer-art, flavour-tinted) + an
  Arcade body, an `hp` (small — one or two hits), a `flavour` tag, a `broken` flag, an `onHit(result)` that
  subtracts HP and breaks at ≤ 0, and `destroy()` (level→level teardown discipline).
- `GameScene._maybePlaceBarrels(desc)` places barrels **RARELY** on NORMAL levels off `desc.spawnCandidates`
  using a **DISTINCT mix-constant** seeded RNG (OFF the generator's pinned draw — the `_maybePlaceShop` /
  cursed-chest idiom), so the level regression pin + the determinism deep-equal stay intact.
- A barrel breaks **on a player hit** (the player melee/projectile overlap also hits the barrel) **OR on an
  enemy knocked into it** (the enemy contact also breaks it). On break → `_breakBarrel(barrel)`:
  - `_radialDamage(x, y, radius, damage, knockback, status)` damages nearby enemies + boss; `oil` passes
    `status: {kind:'burn', ...}` so the blast applies burn (DoT via the existing path).
  - `_enemyRadialDamage(x, y, {radius, damage, knockback})` hurts the PLAYER if within the blast radius (the
    risk: don't stand too close). Routed through `_hurtPlayer` + `isHittable()` for free (dodge negates it).
  - A camera flash + spark pop (reuse `effects.hit` / `_blastRingFx`-style primitives) — programmer-art only.
- The barrel is torn down by `_teardownLevel` (destroyed + the list cleared), like the shop/chest.

### Identity (the hard constraint)

- A default run with **no barrel placed** and **no enemy ever touching a hazard** is BYTE-IDENTICAL: the new
  enemy×hazard tick only fires when a (reachable-side) enemy overlaps a hazard body, which never perturbs the
  level RNG, the player path, or any seeded pool. The placement is RARE and OFF the pinned draw.
- The enemy×hazard overlap + barrel placement are **scene-side, off the pinned RNG** (a fresh `mulberry32` with
  a NEW distinct mix constant), so `verify-gen.mjs`'s level regression pin + determinism deep-equal are UNCHANGED.
- `config/props.ts` is NEW pure data; it feeds NO seeded run pool (it is not a weapon/skill/mutation), so the
  `runWeaponPool/runSkillPool/runMutationPool` identity pins (§13/§5) are untouched — **no blueprint gating
  needed** (a barrel is a world prop, not a banked unlock).
- No new STARTER weapon/skill/mutation. No change to enemy biome pools (a barrel is a prop, not an enemy). The
  difficulty curve is unchanged — barrels are *player-favouring* environmental tools (a free kill if used well),
  and the enemy×hazard tick only ever HELPS the player (an extra way to kill enemies).

### Non-goals (YAGNI)

- **No barrel that the enemy can trigger against you on purpose.** Barrels are neutral props; an enemy only
  breaks one by being knocked into it (player agency). No enemy AI to seek/throw barrels.
- **No chain reactions** (a barrel blast does not break OTHER barrels). KISS — one break, one blast; a chain is
  a re-entrancy footgun (breaking a barrel inside `_breakBarrel`'s own radial) for no real gameplay gain. The
  blast damages ENEMIES + the player, never other barrels (the radial helpers don't see barrels).
- **No new combat math.** The blast reuses `_radialDamage` (enemies) + `_enemyRadialDamage` (player). `oil` burn
  reuses the existing `burn` status kind + DoT path.
- **No HUD chrome / no banner / no prompt** for barrels — a barrel is hit-to-break, not E-to-interact, so no
  in-range flag and no HUD line. (The one minimal i18n string we add is a barrel LABEL, see §3.8 — kept tiny;
  if review prefers zero new UI text, the label is droppable since a barrel has no on-screen text by default.)
- **No banked/meta barrel state.** Barrels are per-level world dressing; they do not persist or bank.
- **No two-way damage for the player×hazard path beyond what exists** — that half already ships.

## 3. Acceptance Criteria

1. **`config/props.ts` (NEW, PURE — no Phaser).** Exports:
   - `BarrelFlavourId = 'explosive' | 'oil'` and a `BarrelFlavour` interface
     `{ id: BarrelFlavourId; color: number; radius: number; damage: number; knockback: number; hp: number;
     status?: { kind: 'burn'; duration: number; tickInterval: number; tickDmg: number } }`.
   - `BARREL_FLAVOURS: Record<BarrelFlavourId, BarrelFlavour>` + an ordered `BARREL_FLAVOUR_IDS: BarrelFlavourId[]`
     (the id→lookup map + ordered list shape, mirroring `weapons.ts` / `curses.ts`).
   - `explosive`: a punchy bomb blast — a larger `damage`, NO `status` (pure damage). `oil`: a slightly
     wider/lower-damage blast that carries `status: { kind: 'burn', ... }` (the burn flavour).
   - All numeric fields sane: `radius > 0`, `damage > 0`, `knockback >= 0`, `hp` a positive integer; `oil` MUST
     have a `burn` status, `explosive` MUST NOT (the verifier asserts both). Doc + verifier are the contract.
2. **`entities/Prop.ts` (NEW).** A `Barrel` class:
   - Ctor `(scene, spot: {x,y}, flavour: BarrelFlavour)` draws a flavour-tinted rectangle (programmer-art)
     anchored on the platform top (the Shop/Chest anchoring idiom), adds an Arcade body
     (`setAllowGravity(false)`, `setImmovable(true)` — it sits on its tile, the player/enemies bump it), a
     back-ref `(rect as any).barrelRef = this`, and stores `flavour`, `hp = flavour.hp`, `broken = false`,
     plus `body` + `rect` handles.
   - `onHit(result: HitResult): void` — subtract `result.damage` from `hp`; if `hp <= 0` and not already
     broken, set `broken = true` and return a "should break" signal (or expose `broken` for GameScene to act
     on). The actual blast lives in `GameScene._breakBarrel` (the scene owns `_radialDamage` + effects — the
     entity stays decoupled, like Pickup/Shop). Idempotent: a second hit on a broken barrel is a no-op.
   - `destroy()` tears down the rect/body (level→level rebuild discipline, like Shop/CursedChest).
3. **GameScene places barrels RARELY on NORMAL levels only.** A new `_maybePlaceBarrels(desc)` called from
   `_buildLevel` (next to `_maybePlaceCursedChest`):
   - Returns immediately on a boss/miniboss level (`isBossLevel()` / `isMinibossLevel()`); not called from
     `_buildBossLevel` (no barrels on set-pieces — KISS).
   - Rolls off a fresh `mulberry32((desc.seed ^ 0xba22e1) >>> 0)` (a NEW mix constant, distinct from the
     weapon/shop/blueprint/room/chest/skill mixes so the rolls don't correlate) — OFF the generator's pinned
     draw, so the level pin is intact.
   - Per the roll, place 0–2 barrels at distinct `desc.spawnCandidates[...]` spots (the `_maybePlaceShop`
     spot-selection idiom, off the entrance/exit ends), each with a flavour picked off the SAME RNG. RARE: a
     low chance (`BARREL_CHANCE`, e.g. `0.30`) gates whether ANY barrel appears; the count is small.
   - Push each live barrel onto `this.barrels: Barrel[]` (a per-level list, init `[]` in `_buildLevel`,
     mirroring `_levelObjects`).
4. **A barrel breaks on a PLAYER hit.** The player melee + projectile overlaps must also be able to hit a
   barrel. KISS approach (Decision 4): give each barrel a hurtbox in the EXISTING `enemyHurtboxes` group is
   WRONG (it would make enemies treat it as a target / be folded into kill counts). Instead the barrel exposes
   its `rect` and GameScene wires a dedicated `overlap(playerHitboxes.group, barrelGroup)` +
   `overlap(projectilePool.group, barrelGroup)` (a small `physics.add.group()` of the barrels) whose callbacks
   call `barrel.onHit(synthetic-result)` then, if `broken`, `_breakBarrel(barrel)`. (See Decision 4 for the
   exact wiring choice — a per-level barrel group cleaned up in teardown.)
5. **A barrel breaks when an ENEMY is knocked into it.** Wire `overlap(enemyHurtboxes, barrelGroup)` whose
   callback breaks the barrel on contact (an enemy bumping the barrel — knocked or walked — breaks it). KISS:
   contact = break (no enemy-damage-to-barrel accounting; the barrel is fragile). The player knockback that
   shoves enemies already exists (`enemy.onHit` → `setVelocity`), so a hammer hit that launches an enemy into a
   barrel triggers this overlap with no new knockback code.
6. **`_breakBarrel(barrel)` deals the radial blast (the AC target).** Once (guard on `broken` so it fires
   exactly once even on a multi-frame overlap):
   - `const f = barrel.flavour; const x = barrel.body.center.x; const y = barrel.body.center.y`.
   - `this._radialDamage(x, y, f.radius, f.damage, f.knockback, f.status ?? null)` — damages every live
     enemy + boss in range, shoving them out; `oil` passes `f.status` (`{kind:'burn',...}`) so the blast applies
     burn through the existing `_applyHitStatus(target, _scaleStatus(status))` path inside `_radialDamage`.
   - `this._enemyRadialDamage(x, y, { radius: f.radius, damage: f.damage, knockback: f.knockback })` — hurts the
     PLAYER if within the blast radius (the risk). Routed through `_hurtPlayer` + `isHittable()` so dodge
     i-frames negate it and the cursed mults apply (DRY — the existing player-damage funnel).
   - FEEDBACK — `this.effects.hit(x, y, { damage: 0 })` (a spark pop) + `this.cameras.main.flash(...)`
     (flavour-tinted) — programmer-art only. Optionally `this.sfx.hit(...)` (a no-op-safe façade call).
   - **IN-CALLBACK SAFETY (review BLOCKER — the body-destruction footgun):** `_breakBarrel` fires from INSIDE an
     Arcade overlap callback (player/projectile/enemy × barrel). Destroying a collider's body while Arcade
     iterates `world.step` is the classic crash/UB footgun the project guards against (the door-transition defers
     it via `time.delayedCall(0)`; the `broken` one-shot flag prevents a double-blast but does NOT make in-callback
     body destruction safe). So `_breakBarrel` sets `broken` (already set by the caller) + DISABLES the body
     (`barrel.disableBody()` — so the overlap can't re-fire the blast) + runs the radial/FX, then DEFERS
     `barrel.destroy()` + the `this.barrels`/barrel-group removal to `time.delayedCall(0)` (matching the
     door-transition discipline). `_teardownLevel` also destroys any survivor (a pending deferred call is a no-op
     on the destroyed entity via its active guards).
   - The blast NEVER breaks other barrels (Decision 5 — no chain; `_radialDamage`/`_enemyRadialDamage` don't see
     barrels).
7. **Two-way hazards — enemies take hazard damage (flyers exempt, boss excluded).** A new
   `_enemyHazardCollider = overlap(enemyHurtboxes, tileMap.hazardBodies)` wired (via the shared
   `_wireEnemyHazardCollider()` helper) in `_buildLevel` AND `_buildBossLevel` next to the player×hazard overlap:
   - The PROCESS callback gates on `!this.gameOver && _enemyNotFlyer(enemyRect) && !_isBoss(enemyRect) &&
     enemy.isHittable() && enemy.hazardTickTimer <= 0`. Flyers skip (the `noGravity` exemption, mirroring the
     solids collider). The BOSS is EXCLUDED (`_isBoss` — review BLOCKER: a dashing boss over a hazard must NOT
     take free DoT / an upward-pop on a frozen body).
   - **PER-ENEMY cooldown (review BLOCKER — NOT a scene-global scalar):** the gate uses the enemy's OWN
     `hazardTickTimer` (a per-enemy timer on `Enemy`, init `0`, decayed on the GAMEPLAY dt in `Enemy.update()`
     next to `contactCooldownTimer`). A single shared scene cooldown would STARVE a PACK on spikes (the first
     overlap each window ticks ONE enemy + locks out the rest, round-robining arbitrarily by overlap order). With
     a per-enemy timer, EVERY overlapping enemy takes damage on its own gate — so a pack on spikes actually dies
     (the intended environmental-kill feel).
   - The COLLIDE callback `_onEnemyHazardContact(enemyRect)` resolves the enemy, sets its `hazardTickTimer` to a
     small gap (`0.5s`), builds a synthetic upward-pop `resolveHit` (the `_onHazardContact` shape,
     `allowBackstab:false`), calls `enemy.onHit(result)` (subtracts HP, pops the enemy up off the spikes — and
     kills it via the existing death path at ≤ 0 HP), and pops `effects.hit(...)`.
   - The new collider field (`_enemyHazardCollider`) is removed in `_teardownLevel` next to the player
     `_hazardCollider` teardown. (No scene cooldown field exists — the cooldown lives per-enemy and dies with the
     enemy on teardown.)
   - **Acceptance**: an enemy (or a whole pack) standing on or knocked onto a hazard takes damage on its own
     cooldown and eventually dies; a flyer never does; the boss never does.
8. **i18n (BOTH locales) — minimal.** If a barrel label is shown (Decision 6 keeps it tiny / optional), add
   `prop.barrel` (e.g. `BARREL` / `油桶`) to `i18n/en.ts` AND `i18n/zh-CN.ts` via `t()`. If the implementer
   ships barrels with NO on-screen text (programmer-art rectangle only — the preferred KISS path), NO i18n
   string is added and this AC is vacuously satisfied. No bare English literal reaches the UI either way.
9. **`_teardownLevel` cleans up.** Remove `_enemyHazardCollider` (mirror the `_hazardCollider` block), destroy
   every `this.barrels[i]` + clear the list, and remove/destroy the barrel group + its overlaps. Nothing
   dangles across a rebuild (the Decision 40 discipline).
10. **Verifier sweep (NEW §17 section in `scripts/verify-gen.mjs`).**
    - Add `import { BARREL_FLAVOURS, BARREL_FLAVOUR_IDS } from '../src/config/props.js'` to the EXISTING
      pure-config import block at the TOP of `verify-gen.mjs` (alongside the curses/rarity/colors imports — the
      §17 template imports at file top, NOT inline; the exact relative path is `../src/config/props.js`, matching
      every other `../src/config/*.js` import the script uses).
    - Add the §17 sweep AFTER the §16 curse sweep, before the final `console.log`, asserting:
      - `BARREL_FLAVOUR_IDS` is a non-empty list; each id resolves in `BARREL_FLAVOURS` and the entry's `id`
        matches its key (no lookup drift).
      - For every flavour: `radius > 0`, `damage > 0`, `knockback >= 0`, `hp` an INTEGER `> 0`, `color` a number.
      - `oil` HAS a `status` with `kind === 'burn'` and sane DoT fields (`duration > 0`, `tickInterval > 0`,
        `tickDmg > 0`); `explosive` has NO `status` (pure damage — the flavour contract).
      - Flavours are SIBLINGS (not a tier) → NO monotonicity required; a simple well-formedness sweep (we DO ship
        `oil.radius >= explosive.radius` as the chosen relationship, but the sweep does not assert it).
    - Update the final summary `console.log` string (`verify-gen.mjs:2248-2271`) to mention the props table:
      `+ ${BARREL_FLAVOUR_IDS.length} barrel flavours (well-formed; oil burns, explosive pure damage)`.
    - The verifier adds `config/props.js` ONLY to the well-formedness sweep — it does NOT add props to any seeded
      pool sweep (the `runWeaponPool/runSkillPool/runMutationPool` pins are untouched; props feed no run pool).
      `tsc` (the build step) also sees `config/props.ts` and re-proves it is Phaser-free (no Phaser import).
11. **Build + verifier green.** `npm run verify` and the Vite/tsc build pass. The level regression pin and the
    determinism deep-equal are UNCHANGED (the new RNG is off-the-pin; the new table feeds no seeded pool). The
    verifier MUST NOT add `config/props.js` to any seeded run-pool sweep (the
    `runWeaponPool/runSkillPool/runMutationPool` identity pins stay byte-identical) — props get ONLY the §17
    well-formedness sweep.

## 4. Numbered Decisions

1. **Two-way hazards = a NEW enemy×hazard overlap, NOT a change to `_onHazardContact`.** The player path stays
   exactly as today (DRY: it is the existing half). We add a parallel `overlap(enemyHurtboxes,
   tileMap.hazardBodies)` with a PER-ENEMY cooldown (the enemy's own `hazardTickTimer`, NOT a scene-global
   scalar — review BLOCKER: a shared scalar starves a PACK on spikes) and its OWN callback
   (`_onEnemyHazardContact(enemyRect)`), shaped on `_onHazardContact` (synthetic upward-pop `resolveHit`,
   `allowBackstab:false`, `enemy.onHit`). The cooldown lives on `Enemy` (init `0`, decayed on the gameplay dt in
   `Enemy.update()` next to `contactCooldownTimer`), so each overlapping enemy ticks on its OWN gate — a pack on
   spikes actually dies. The hazard body group is already public (`tileMap.hazardBodies`), so `TileMap.ts` needs
   NO change. We do NOT unify the two paths into one generic "hazardable" interface — two call sites don't justify
   the abstraction (YAGNI; the player path routes through `_hurtPlayer`, the enemy path through `enemy.onHit` —
   different funnels by design).

2. **Flyers are exempt via `_enemyNotFlyer`; the BOSS is excluded via `_isBoss`.** The flyer predicate the
   solids/oneWay colliders already use (`GameScene.ts:853/959`) reads the per-body `_noSolids` flag set in
   `_spawnEnemy` from `spec.noGravity`. A flyer hovers and never touches the floor spikes, so the enemy×hazard
   process callback returns false for it — no tick. The BOSS, however, IS in `enemyHurtboxes` and has a `dash`
   attack that crosses the arena on a gravity-frozen body — so the process callback ALSO excludes it
   (`_isBoss(enemyRect)` → `enemyRect.enemyRef === this.boss`). Without that gate, a dashing boss crossing a
   hazard tile would take a free synthetic hazard hit + an upward-pop knockback on a frozen body (review BLOCKER:
   unintended free DoT/displacement). The enemy×hazard overlap IS still wired in the boss arena (consistent with
   the player×hazard overlap there), but the boss is gated out — the AC's enemy-hazard death targets normal-level
   enemies.

3. **The barrel reuses BOTH radial helpers — enemy side AND player side.** `_radialDamage` hits enemies+boss
   (with the optional `oil` burn status); `_enemyRadialDamage` hits the player if too close. Calling both from
   `_breakBarrel` gives the full "damage enemies + risk the player" blast with ZERO new combat math (DRY). We do
   NOT extend `_radialDamage` to also hit the player (it is used by the blast SKILL + the charged-hammer AoE,
   which must NOT hit the player) — composing the two existing helpers is the correct, non-invasive choice.

4. **Barrels live in a dedicated per-level `barrelGroup`, NOT in `enemyHurtboxes`.** Putting a barrel in
   `enemyHurtboxes` would make it count as an enemy (kill counts, affliction spread, the boss-room clear gate —
   all wrong). Instead a small `this.barrelGroup = this.physics.add.group({ allowGravity: false })` holds the
   barrel bodies, and GameScene wires three overlaps against it:
   `overlap(playerHitboxes.group, barrelGroup)` (player melee), `overlap(projectilePool.group, barrelGroup)`
   (player ranged), and `overlap(enemyHurtboxes, barrelGroup)` (enemy knocked in). Each callback breaks the
   barrel (`barrel.onHit` for the hit-to-break paths; contact-break for the enemy path). The group + its
   overlaps are per-level (created in `_buildLevel`, removed/destroyed in `_teardownLevel`) — the same lifecycle
   the per-level hazard collider has. A barrel is fragile (`hp` small) so even one swing breaks it; the `hp`
   field lets the implementer tune toughness without code change.

5. **No chain reactions (KISS + a re-entrancy guard) + DEFERRED body destruction (review BLOCKER).** A barrel
   blast damages enemies + the player only — the radial helpers never see barrels, so one barrel never breaks
   another. This avoids the footgun of mutating the barrel list while iterating it inside `_breakBarrel`, and
   keeps the feature legible. The `broken` flag makes `_breakBarrel` fire exactly once even if a multi-frame
   overlap re-enters the callback (the same one-shot discipline the door/transition uses). CRUCIALLY,
   `_breakBarrel` fires from INSIDE an Arcade overlap callback, so it does NOT destroy the barrel body
   synchronously (destroying a collider's body while Arcade iterates `world.step` is the classic crash/UB
   footgun the project guards against — `GameScene.ts:91-93`, `_onDoorOverlap`). It DISABLES the body (so the
   overlap can't re-fire) + runs the blast/FX, then DEFERS `barrel.destroy()` + the `this.barrels`/group removal
   to `time.delayedCall(0)` (matching the door-transition discipline). `_teardownLevel` destroys any survivor.

6. **Minimal-to-zero new UI text.** A barrel is hit-to-break, not E-to-interact — no in-range flag, no prompt,
   no HUD line. The preferred KISS path ships a programmer-art rectangle with NO on-screen text (so NO i18n
   string is needed). If the implementer wants a tiny label glyph on the barrel, it MUST go through `t()` in
   BOTH locales (`prop.barrel`) — never a bare literal. Pick ONE; the doc allows either, defaulting to "no text".

7. **`config/props.ts` is pure data, feeds NO seeded run pool → no blueprint gate.** A barrel flavour is a world
   prop, not a weapon/skill/mutation that feeds `runWeaponPool/runSkillPool/runMutationPool`. The determinism
   pins (§13/§5) sweep those three pools — props are not in them, so adding `config/props.ts` requires NO
   blueprint tag and NO `blueprints.ts` entry. It gets the same well-formedness verifier sweep every pure table
   gets (§4 invariant), nothing more.

8. **Placement is RARE, NORMAL-levels-only, OFF the pinned draw.** A fresh `mulberry32((desc.seed ^ 0xba22e1)
   >>> 0)` (a NEW distinct mix constant) gates barrel placement and picks spots + flavours — NOT on the
   generator's pinned RNG, so the level regression pin + determinism deep-equal are untouched (the
   `_maybePlaceShop` discipline). Never on boss/miniboss levels. A given run seed always places the same barrels
   (deterministic replay).

9. **Pinned constants.** `BARREL_CHANCE` (placement gate, e.g. `0.30`) + `BARREL_MAX_COUNT` (e.g. `2`) may live
   next to the other GameScene chance consts (`GameScene.ts:144+`, locality with `SHOP_LEVEL_CHANCE` /
   `BLUEPRINT_PICKUP_CHANCE`), while the per-flavour blast numbers (radius/damage/knockback/hp/status) live in
   `config/props.ts` (the verifier-swept pure data). The doc + verifier are the contract for the pure ones.

## 5. Integration Map (files the implementer will touch)

- **`src/config/props.ts`** — NEW pure table: `BarrelFlavourId`, `BarrelFlavour`, `BARREL_FLAVOURS`,
  `BARREL_FLAVOUR_IDS`. (Imports nothing from Phaser; the `status` shape mirrors `StatusSpec`'s burn fields but
  is declared inline so the table stays Phaser-free + self-contained, like `curses.ts`.)
- **`src/entities/Prop.ts`** — NEW `Barrel` class: drawn rect + Arcade body, `flavour`/`hp`/`broken`,
  `onHit(result)` (subtract hp, set `broken`), `destroy()`. Decoupled — the blast lives in GameScene.
- **`src/scenes/GameScene.ts`** —
  - Import `BARREL_FLAVOURS`, `BARREL_FLAVOUR_IDS` from `config/props.js`; import `Barrel` from
    `entities/Prop.js`; pin `BARREL_CHANCE` / `BARREL_MAX_COUNT` near the other chance consts.
  - Fields: `barrels: Barrel[]`, `barrelGroup: Phaser.Physics.Arcade.Group | null`,
    `_enemyHazardCollider: Collider | null`, `_barrelColliders: Collider[]` — all declared + null/`[]`-initialized
    in `create()` next to the existing hazard/shop fields. (NO scene-global `_enemyHazardCooldown` — the hazard
    cooldown is PER-ENEMY: a `hazardTickTimer` field on `Enemy`, decayed in `Enemy.update()`.)
  - `_maybePlaceBarrels(desc)` — called from `_buildLevel` next to `_maybePlaceCursedChest`; rolls off the new
    mix-constant RNG; builds the `barrelGroup`, places barrels, wires the three break overlaps
    (playerHitboxes / projectilePool / enemyHurtboxes × barrelGroup).
  - `_breakBarrel(barrel)` — the blast (`_radialDamage` + `_enemyRadialDamage` + FX), one-shot on `broken`,
    destroy + delist.
  - Two-way hazards: `_wireEnemyHazardCollider()` builds `_enemyHazardCollider = overlap(enemyHurtboxes,
    tileMap.hazardBodies)` (shared, called from `_buildLevel` AND `_buildBossLevel`, next to the player
    `_hazardCollider`); the process callback excludes flyers (`_enemyNotFlyer`) AND the boss (`_isBoss`) and
    gates on the PER-ENEMY `enemy.hazardTickTimer`; `_onEnemyHazardContact(enemyRect)` is the enemy spike tick
    (shaped on `_onHazardContact`). The cooldown decays per-enemy in `Enemy.update()` (no scene-side decay).
  - `_teardownLevel`: remove `_enemyHazardCollider` + `_barrelColliders`, destroy `this.barrels` + the
    `barrelGroup`, clear both lists (mirror the `_hazardCollider` / shop / chest teardown).
- **`src/entities/Enemy.ts`** — add a per-enemy `hazardTickTimer` field (init `0`, decayed in `update()` next to
  `contactCooldownTimer`) — the PER-ENEMY hazard-tick gate (review BLOCKER — not a scene-global scalar).
- **`src/world/TileMap.ts`** — NO CHANGE needed: `hazardBodies` is already a public static group
  (`TileMap.ts:40`). (The integration map flagged this as a possibility; verified it is already reachable.)
- **`src/i18n/en.ts` + `src/i18n/zh-CN.ts`** — `prop.barrel` in BOTH locales ONLY IF the implementer ships a
  barrel label (Decision 6 defaults to no text → no i18n change). Whichever path, NO bare English literal.
- **`scripts/verify-gen.mjs`** — node-import `config/props.js`; NEW sweep (well-formed flavours: positive
  radius/damage/hp, knockback ≥ 0; `oil` has a `burn` status with sane DoT fields, `explosive` has none;
  id↔key consistency); update the final summary `console.log`.

## 6. Identity-Preservation Checklist (the implementer MUST verify)

- [ ] A default run with no barrel placed plays byte-identically; the new placement is RARE and OFF the
      generator's pinned RNG (fresh `mulberry32`, NEW distinct mix `0xba22e1`).
- [ ] The new enemy×hazard overlap fires ONLY when a reachable-side enemy overlaps a hazard body — it never
      touches the player path, the level RNG, or any seeded pool, so the level regression pin + determinism
      deep-equal in `verify-gen.mjs` are UNCHANGED.
- [ ] `config/props.ts` feeds NO seeded run pool (not a weapon/skill/mutation) → the
      `runWeaponPool/runSkillPool/runMutationPool` identity pins (§13/§5) are untouched; NO blueprint gate.
- [ ] FLYERS (`noGravity` → `_noSolids`) are exempt from the enemy×hazard tick via `_enemyNotFlyer` (the same
      predicate the solids collider uses).
- [ ] Barrels are NORMAL-levels-only (guarded by `isBossLevel()`/`isMinibossLevel()`, not called from
      `_buildBossLevel`); the enemy×hazard overlap is added on every level incl. the boss arena (consistent with
      the player×hazard overlap there).
- [ ] `_breakBarrel` fires EXACTLY once per barrel (the `broken` one-shot guard), never breaks other barrels (no
      chain), and routes player damage through `_hurtPlayer` + `isHittable()` (dodge i-frames negate it).
- [ ] The blast reuses `_radialDamage` (enemies + `oil` burn) + `_enemyRadialDamage` (player) — NO new combat
      math; `burn` rides the existing DoT path.
- [ ] `_teardownLevel` removes `_enemyHazardCollider` + the barrel colliders/group + destroys all barrels — no
      dangling colliders/bodies across a rebuild.
- [ ] Difficulty is monotone: the enemy×hazard tick + barrels only ever HELP the player (extra ways to kill
      enemies); no early biome is made harder; no enemy biome pool changes.

## 7. Verifier Notes (the CI gate)

Add a new numbered section (after `§16` curses) that node-imports `config/props.js` and asserts, in the existing
`fail(...)`-on-violation style (mirroring the `§16` curse / `§15` rarity sweeps):

- **Well-formedness:** `BARREL_FLAVOUR_IDS` non-empty; every id resolves in `BARREL_FLAVOURS` and
  `BARREL_FLAVOURS[id].id === id` (no lookup drift); per flavour `radius > 0`, `damage > 0`, `knockback >= 0`,
  `hp` an INTEGER `> 0`, `color` a number.
- **Flavour contract:** `BARREL_FLAVOURS.oil.status` exists with `kind === 'burn'` and `duration > 0`,
  `tickInterval > 0`, `tickDmg > 0`; `BARREL_FLAVOURS.explosive.status` is undefined/null (pure damage).
- Update the final summary `console.log` to include the props table (e.g.
  `+ ${BARREL_FLAVOUR_IDS.length} barrel flavours (well-formed; oil burns, explosive pure damage)`).

The two-way-hazard tick + the barrel placement are entirely scene-side (Phaser-coupled), off the pinned RNG, so
the verifier needs NO change beyond the pure-table sweep — the level regression pin + determinism deep-equal
stay intact by construction.
