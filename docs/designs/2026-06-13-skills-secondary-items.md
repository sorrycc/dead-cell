# Skills / Secondary Items (the loadout layer)

## 1. Background

The player carries **weapons only** — a primary + an optional second slot
(`Player.weapons`, `equippedWeapon`, `swapWeapon`). Dead Cells' signature loadout is
**2 weapons + 2 skills**: grenades, turrets, traps, ranged burst tools — cooldown-gated
abilities orthogonal to the weapon combo. They are half the combat depth and the genre's
core build lever. None exist here.

The architecture already has every primitive a skill needs:
- `combat/ProjectilePool.ts` (a `'player'`-tagged pool) — `acquire(attacker, projSpec,
  ownerId, status, aim?)` fires a pooled projectile with an optional `{ angle }` 2-D aim.
  This is the existing player→enemy projectile overlap (`_onProjectileHitEnemy`).
- `this.enemies: Enemy[]` + `this.boss` + the `enemyHurtboxes` group — the live target set.
- `combat/damage.ts` `resolveHit` + `effects.hit()` — the shared hit math + juice.
- `entities/Pickup.ts` (`PickupPool`) with a `kind` tag (cell/gold/scroll/weapon/heal) —
  the drop/treasure delivery channel, plus the seeded weapon-pickup placement path.
- `config/shop.ts` (`SHOP_ITEMS`, kind-dispatched `_buyShopItem`) — the gold sink.
- `core/RunState.ts` scalars (`weaponId2`, `weaponAffixId2`) carried across level rebuilds.
- `HUDScene` registry read-out + `core/Input.ts` edge-detected keys.
- `scripts/verify-gen.mjs` sweeps every pure config table for well-formedness.

So skills slot into the existing seams as a new **pure-data table + a kind-dispatched
`_useSkill`**, reusing the pools — not a new combat engine.

## 2. Requirements Summary

- **Goal:** A skill loadout: **2 skill slots**, **2 keys**, **per-skill cooldowns**, a small
  set of distinct, genre-faithful skills that reuse the existing combat primitives.
- **Skill kinds (3):**
  - **`volley`** — fire a fan of `count` pooled player projectiles at a `spread` along facing
    (pure `ProjectilePool` reuse), optional status. *e.g. Throwing Knives, Ice Shards (freeze).*
  - **`blast`** — instant radial AoE: damage every enemy/boss within `radius` of the player,
    knockback away, optional status + a particle ring (reuse `resolveHit` + `effects`). *e.g.
    Frost Grenade (stun), Firebomb (bleed).*
  - **`turret`** — deploy a stationary auto-firer for `duration` that shoots the nearest live
    enemy every `fireInterval` (reuse `ProjectilePool`). The ONE new pooled entity.
- **Acquisition:** skill pickups (a new `'skill'` `Pickup` kind), the shop (a `'skill'` shop
  kind), and as a treasure-branch reward option.
- **Carry/HUD/verify:** carried on `RunState` scalars across rebuilds; HUD shows both slots +
  cooldown state; the table is swept by the verifier.
- **Non-goals (YAGNI):** skill leveling/affixes, a meta gate on slots (start with 2 free
  empty slots), skill synergies. A meta "skill slot" gate is a trivial later add.

## 3. Acceptance Criteria

1. NEW pure `src/config/skills.ts` — `SKILLS` table (`id`, `name`, `desc`, `kind`,
   `cooldown`, kind-specific params) + `SKILLS_BY_ID` + `SKILL_ORDER` + `SKILL_KINDS`. **No
   Phaser import** (verifier-importable, like `shop.ts`/`weapons.ts`).
2. `Player` carries **2 skill slots** (`skills: (SkillSpec|null)[]`) + per-slot cooldown
   timers; two keys trigger `_useSkill(slot)`; a slot that's empty **or** on cooldown is a
   **no-op** (no double-fire, no crash).
3. `GameScene._useSkill` dispatches on `kind`: `volley` (projectile fan), `blast` (radial
   damage + optional status), `turret` (timed deployable). Each reuses
   `ProjectilePool`/`resolveHit`/`effects`/`sound` — no new combat math.
4. Skills are **carried across level rebuilds** (`RunState.skillId1/skillId2`) and
   re-equipped in `_buildLevel`; cooldowns reset on rebuild (KISS).
5. Skills are obtainable as **pickups** (`'skill'` kind), from the **shop** (`'skill'` kind),
   and as a **treasure-branch reward** option.
6. `HUDScene` shows both skill slots (name + a cooldown indicator), registry-only (decoupled).
7. `scripts/verify-gen.mjs` sweeps `SKILLS` (non-empty; every `kind ∈ SKILL_KINDS`; positive
   `cooldown`; kind-specific fields present + numeric). `npm run verify` green.
8. **Identity safety:** a run that never acquires a skill plays exactly as before — both slots
   empty, both keys no-op; existing pure tables + their verifier sections unchanged.

## 4. Problem Analysis

- **Approach A — model skills as just more "weapons"** → rejected: a weapon is a swing
  table dispatched by the attack key + combo state; a skill is a cooldown ability with its
  own delivery (AoE, deploy). Overloading the weapon path would bend `equippedWeapon`/combo
  semantics and the front-marker code. Skills are a distinct axis.
- **Approach B — a full skill engine with channels/charges/leveling** → rejected (YAGNI):
  out of scope; cooldown + kind-dispatch covers the genre's core feel.
- **Approach C (chosen) — a pure `SKILLS` table + a kind-dispatched `_useSkill` reusing the
  existing pools.** `volley`/`blast` need **zero** new entity code (ProjectilePool + a small
  radial-damage helper over `this.enemies`/`boss`). Only `turret` adds one pooled entity
  (`DeployablePool`) mirroring the mandated pooling convention. Data-driven + extensible (new
  kinds are new dispatch arms), matching how `shop.ts` dispatches on `kind`.

## 5. Decision Log

**1. Reuse pools vs new entities.**
- Decision: `volley` = `ProjectilePool.acquire` per fan shot with `aim:{angle}` (the round-3
  2-D aim already exists). `blast` = a new GameScene helper `_radialDamage(x, y, radius,
  damage, knockback, status)` iterating `this.enemies` + `this.boss`, calling `resolveHit` +
  `effects.hit` + a particle ring (no new primitive). `turret` = a new `DeployablePool` (a
  fixed set of pooled stationary rects that tick, find the nearest target, and fire via
  `ProjectilePool`). **`turret` is the explicit cut-line** if scope must shrink — `volley` +
  `blast` alone are a complete, shippable skill layer.

**2. Slot count + gating.**
- Decision: **2 slots, free, starting empty** (KISS, immediate fun). No meta gate this slice
  (the `weaponSlot` upgrade is the precedent if we want one later). Identity holds: empty
  slots = the keys do nothing.

**3. Input keys.**
- Decision: skill 1 = **F**, skill 2 = **C** (left-hand cluster, free — taken keys are
  arrows/WASD, Space, J/click, Shift/K, Q, E, R, and M from the audio slice). Edge-detected,
  sole-owned in `Input` (JustDown), two new `InputSnapshot` fields `skill1Pressed`/
  `skill2Pressed`. (Alternatives `1`/`2` or RMB noted but F/C avoids the number-row reach.)

**4. Cooldown ownership.**
- Decision: per-slot `skillCooldownTimer[2]` on `Player`, decayed by the **gameplay dt** in
  `update()` — so cooldowns freeze during hit-stop / the shop pause exactly like every other
  timer. `_useSkill` checks `timer <= 0` before firing, then sets `timer = spec.cooldown`.
  GameScene reads the timers → registry for the HUD.

**5. Turret targeting.**
- Decision: nearest live enemy by squared distance over `this.enemies` (+ `boss`) — a linear
  scan (≤ ~8 targets, cheap). Ticked off the gameplay dt. Fires `ProjectilePool` (player tag)
  so the existing projectile→enemy overlap resolves the hit with no new wiring.

**6. Determinism.**
- Decision: skill *use* fires off player input + `Math.random` jitter (like projectiles/
  particles) — cosmetic, off the seeded level RNG, so the level pin + verifier determinism are
  untouched. Skill *placement* as a seeded pickup (if a level seeds one) uses an
  **off-the-main-thread sub-RNG** exactly like the weapon-pickup placement, so the regression
  pin stays byte-stable.

**7. Carry shape.**
- Decision: `RunState.skillId1` / `skillId2` (string | null, null = empty) mirroring
  `weaponId2`. Re-equipped in `_buildLevel` (the same place weapons are re-folded). A fresh
  run seeds both null (the identity).

## 6. Design

### 6.1 `src/config/skills.ts` (new, pure)

```ts
export type SkillKind = 'volley' | 'blast' | 'turret'
export interface SkillSpec {
  id: string; name: string; desc: string; kind: SkillKind; cooldown: number
  // volley:
  count?: number; spread?: number; projectile?: { speed; damage; knockback; lifetime; w; h }
  // blast:
  radius?: number; damage?: number; knockback?: number
  // turret:
  duration?: number; fireInterval?: number
  // any kind:
  status?: { kind; duration; tickInterval?; tickDmg? }
}
export const SKILLS: SkillSpec[] = [ /* knives(volley), iceShards(volley+freeze... ->stun),
  frostGrenade(blast+stun), firebomb(blast+bleed), turret(turret) */ ]
export const SKILLS_BY_ID = Object.fromEntries(SKILLS.map(s => [s.id, s]))
export const SKILL_ORDER = SKILLS.map(s => s)
export const SKILL_KINDS: SkillKind[] = ['volley', 'blast', 'turret']
```

Mirrors `shop.ts`/`weapons.ts`: plain data, kind-specific fields optional + read only by that
kind's dispatch arm (undefined-safe).

### 6.2 `Player` (`src/entities/Player.ts`)

- State: `skills: (SkillSpec|null)[] = [null, null]`, `skillCooldown: number[] = [0, 0]`.
- `update()`: decay both cooldown timers by `dt` (alongside the existing timer block).
- `equipSkill(spec, slot)` / `tryUseSkill(slot): SkillSpec | null` — returns the spec to fire
  if the slot is filled + off cooldown (and arms the cooldown), else null. **Player does not
  spawn the effect** (same discipline as `attack()` → GameScene owns pools/world).
- `applyStartStats`: reset `skills = [null, null]`, cooldowns 0 (run-start identity).

### 6.3 `GameScene._useSkill(slot)` dispatch

```ts
_useSkill(slot) {
  const spec = this.player.tryUseSkill(slot); if (!spec) return
  const a = this.player.attackerShape           // { cx, facing } (+ body center for y)
  if (spec.kind === 'volley') { /* N × projectilePool.acquire with fanned aim:{angle} + status */ }
  else if (spec.kind === 'blast') { this._radialDamage(cx, cy, spec.radius, spec.damage, spec.knockback, spec.status); /* ring FX */ }
  else if (spec.kind === 'turret') { this.deployables.acquire(cx, floorY, spec) }
  this.sound?.skill(spec.kind)                  // doc 1
}
```
Called in `update()` input handling: `if (input.skill1Pressed) this._useSkill(0)` / slot 1.

`_radialDamage` reuses `resolveHit({cx,facing}, enemy.attackerShape, syntheticSwing, ...)` per
in-range target + `enemy.applyStatus(scaled)` (the boss now has `applyStatus` parity) +
`effects.hit`.

### 6.4 `DeployablePool` (`src/entities/DeployablePool.ts`, new — turret; cut-line)

A pooled fixed set of stationary rects (the pooling convention: acquire/release, zero churn).
`tick(dt, ctx)` decays each live turret's lifetime + fire timer; on a fire beat finds the
nearest of `ctx.enemies`/`ctx.boss` and calls `ctx.projectilePool.acquire` aimed at it.
`GameScene` ticks it in `update()` on the gameplay dt and `releaseAll()`s on teardown.

### 6.5 Acquisition

- **Pickup** (`entities/Pickup.ts`): add `'skill'` to `PickupKind`, a `skillId` field, a color;
  `_collectPickup` fills the first empty skill slot (else replaces slot 0) via `equipSkill`.
- **Shop** (`config/shop.ts`): add `kind: 'skill'` + `skillId` to `ShopItemKind`/`ShopItem`
  and a couple of catalog rows; `_buyShopItem` dispatches `'skill'` → `equipSkill`.
- **Treasure branch**: `branchTreasure` reward roll (already gold/scroll/weapon/heal) gains a
  `skill` option (scene-side, off the seed — `placeBranch` is unchanged).

### 6.6 HUD (`src/scenes/HUDScene.ts`) + registry

GameScene writes `skill1`/`skill2` (names) + `skill1Cd`/`skill2Cd` (0..1 fraction). HUD adds
two labels under the weapon line, e.g. `SKILL F: Knives` / `[####----]` for cooldown.

### 6.7 Verifier (`scripts/verify-gen.mjs`)

Add a section (mirroring 5d weapons / the shop sweep): import `SKILLS`, `SKILL_KINDS`; assert
non-empty; every `kind ∈ SKILL_KINDS`; `cooldown > 0`; `volley` has `count > 0` + a
projectile; `blast` has `radius > 0` + `damage > 0`; `turret` has `duration > 0` +
`fireInterval > 0`.

### Identity safety

Empty slots + `tryUseSkill` returning null on empty/cooldown means a skill-less run is
byte-identical. The existing pickup/shop/weapon paths only **gain** an arm; their current
behavior is unchanged. No existing pure-table contract changes.

## 7. Files Changed

- **NEW** `src/config/skills.ts`
- **NEW** `src/entities/DeployablePool.ts` (turret — the cut-line entity)
- `src/entities/Player.ts` — skill slots, cooldowns, equip/try-use, start-stats reset
- `src/core/Input.ts` — `f`/`c` keys + `skill1Pressed`/`skill2Pressed`
- `src/core/RunState.ts` — `skillId1`/`skillId2` scalars
- `src/config/shop.ts` — `'skill'` kind + rows
- `src/entities/Pickup.ts` — `'skill'` kind + `skillId`
- `src/scenes/GameScene.ts` — `_useSkill`, `_radialDamage`, pickup/shop/branch wiring,
  deployable tick + teardown, HUD registry, re-equip in `_buildLevel`
- `src/scenes/HUDScene.ts` — two skill-slot labels
- `scripts/verify-gen.mjs` — `SKILLS` sweep

## 8. Verification

1. `npm run verify` — green (new `SKILLS` sweep passes; level pin/determinism unchanged).
2. `npm run typecheck` — passes.
3. Manual (`npm run dev`): pick up a volley + a blast (+ turret) skill; **F**/**C** fire them;
   each on cooldown after use (HUD bar drains/refills); blast damages nearby enemies + applies
   its status; turret auto-fires at the nearest enemy for its duration; carry skills through a
   level transition (still equipped, cooldowns reset); buy a skill from the vendor; a run with
   no skill picked up plays unchanged.
