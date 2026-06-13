# Boss Status-Effect Parity (bleed / poison / stun)

## 1. Background

`enemy.applyStatus is not a function` crashes at `GameScene.js:1282` (melee) and
`GameScene.js:1332` (projectile) whenever the player hits a **boss** (or **miniboss**)
with any status-bearing weapon.

Root cause: `Boss` (`src/entities/Boss.js`) is a deliberate *sibling* of `Enemy`, not a
subclass (Boss.js:4-9). It shares the `enemyHurtboxes` group and sets the same
`this.collider.enemyRef = this` back-ref (Boss.js:57), so the player→enemy combat overlaps
hit it with no extra wiring. It mirrors `Enemy`'s combat surface — `onHit`, `isHittable`,
`attackerShape`, `contactDamage/Knockback`, `id`, `dead`, `body`, `collider` — but it never
implemented the status system (`statuses[]`, `applyStatus`, `_tickStatus`). So the
status-application call sites blow up on every boss encounter.

This is not a rare path: every weapon except a plain sword carries a status (hammer→stun
0.6s `weapons.js:51`, bow→poison `weapons.js:73`, spear→bleed `weapons.js:106`), and the
Venomous affix adds bleed to *any* weapon. The boss is effectively unfightable in most builds.

## 2. Requirements Summary

- **Goal:** Give `Boss` full status-effect parity with `Enemy` so bleed/poison/stun work on bosses.
- **Scope:** `src/entities/Boss.js` only. No changes to GameScene, Enemy, or status.js — the
  overlap callbacks already work the moment `Boss.applyStatus` exists.
- **Chosen behavior:** Full parity with `Enemy` (user decision). Bosses take DoT **and** can be
  stunned, identical to a normal enemy. Trade-offs are documented in the Decision Log.

## 3. Acceptance Criteria

1. Meleeing or shooting a boss/miniboss no longer throws `enemy.applyStatus is not a function`;
   `Boss` implements `applyStatus(spec)` with the same no-op-on-dead/null semantics as `Enemy`.
2. Bleed/poison DoT drains the boss's HP over time on the **gameplay dt** (frozen during
   hit-stop), using the pure `combat/status.js` tick math.
3. DoT that reduces boss HP to ≤0 kills it through `_die()`, so `onBossDeath` (Victory/bank) and
   `onDeath` (kill count) fire exactly once.
4. A `stun` status freezes the boss FSM (no choose/telegraph/strike/recover) for its window and
   plants the body; a live dash window is cleared so a frozen boss deals no *dash* contact damage.
   (Base `spec.contactDamage` on body overlap still applies — see Decision 6 — exactly as for a
   stunned `Enemy`; "frozen" means the FSM stops driving attacks, not full invulnerability.)
5. A live status tints the boss's resting fill (stun grey-blue, bleed dark red, poison sickly
   green); telegraph / phase-invuln / hurt flashes take precedence over the status tint.
6. A boss with no status applied behaves byte-identically to before (empty `statuses` list is the
   identity — no behavior change on a normal hit).
7. Both the final `Boss` and the `Miniboss` (same class, GameScene.js:557 / 635) get the behavior
   with no additional wiring.

## 4. Problem Analysis

- **Approach A — make `Boss` a subclass of `Enemy`** -> rejected: the boss is a
  choose→telegraph→strike→recover phase FSM, a different state set from Enemy's patrol/chase;
  subclassing would fight the state machine (the exact reason Boss.js:4-9 keeps them separate).
- **Approach B — extract a shared status mixin/base both classes use** -> rejected (YAGNI): the
  *pure* tick math is already shared via `combat/status.js`. Only ~25 lines of entity glue would
  be deduplicated across exactly two siblings — a mixin abstraction costs more than it saves.
- **Approach C — guard the call sites (`enemy.applyStatus?.()`), bosses immune** -> rejected by
  the user: kills the crash but gives DoT builds no payoff against the climactic fight.
- **Chosen approach — port `Enemy`'s status glue verbatim into `Boss`** -> mirrors the proven
  Enemy implementation method-for-method, keeps the dt boundary identical, and reuses the same
  pure `status.js` helpers + the same `effects.statusTick` FX. Smallest correct change that meets
  the user's "full parity" requirement.

## 5. Decision Log

**1. Should a stun freeze a committed telegraph/strike?**
- Options: A) stun never interrupts a committed strike (boss-design-preserving) · B) stun skips
  the FSM every frame regardless of state (full parity with Enemy)
- Decision: **B)** — user explicitly chose full parity. `Enemy.update` (Enemy.js:195) skips its
  FSM switch whenever `stunned`, leaving only HURT/DEAD alone; `Boss` mirrors this. Known
  consequences: (a) a hammer (0.6s stun, short cooldown) can stun-lock the boss — the "trivialise
  the fight" outcome Boss.js:28 warns about; (b) because the FSM is skipped *wholesale*, a stun
  landing on the same frame the boss enters its post-phase CHOOSE beat (`stateTimer = 0.4`) freezes
  that beat too — the phase-change tell visually stalls for the stun window. Both accepted as part
  of "full parity"; reversible later (cap/ignore stun on bosses).

**2. Should DoT tick during the phase-change invuln window?**
- Options: A) suppress DoT while `phaseInvulnTimer > 0` · B) DoT ticks regardless
- Decision: **B)** — full parity. DoT drains HP directly off the `statuses` list, never through
  `onHit`, so it never triggers `_advancePhase` (which lives in `onHit`, Boss.js:124). The invuln
  only gates the `onHit` path. Bleed continuing through the tell is accepted (matches Enemy, which
  has no invuln concept and lets DoT bypass `isHittable` by design — Enemy.js:367).

**3. Should DoT trigger phase advancement?**
- Options: A) check the phase threshold after DoT damage too · B) phase advance stays in `onHit`
  only
- Decision: **B)** — parity + KISS. Enemy has no phases, so parity gives no reference; keeping the
  threshold check in its current home (`onHit`) is simplest. Consequence: a boss bled out with no
  final direct hit can die skipping an un-entered phase. Rare (DoT magnitudes are small: bleed is
  3 HP / 0.4s) and self-corrects on the next direct hit. Accepted as a known limitation.

**4. Where to tick statuses in `Boss.update`?**
- Options: A) after timer-decay, before the FSM switch (mirrors Enemy.update:188) · B) elsewhere
- Decision: **A)** — identical placement to `Enemy.update` so the dt-boundary and the
  DoT-death / stun-freeze early-returns have the same semantics.

**5. Code reuse strategy.**
- Options: A) import the pure helpers from `combat/status.js`, mirror Enemy's three methods ·
  B) build a shared base/mixin
- Decision: **A)** — see Approach B in §4. KISS/DRY at the right level (the math is already
  shared); duplicate only the thin glue.

**6. Does a stunned boss still deal contact damage?**
- Options: A) add a stun check to `_onEnemyContact` so a stunned boss is fully harmless ·
  B) leave contact alone — base `spec.contactDamage` still applies on body overlap while stunned
- Decision: **B)** — parity. `GameScene._onEnemyContact` (GameScene.js:1567) gates only on
  `enemy.dead` / `contactCooldownTimer`, never on a stun flag, and the same is true for a stunned
  `Enemy`. The stun-freeze clears `dashActive` so the heavy *dash* contact damage stops (AC4), but
  a stunned boss the player stands on still bites for base contact damage each `contactCooldown`.
  Adding a stun check would diverge from Enemy; not done.

## 6. Design

All changes are in `src/entities/Boss.js`, ported method-for-method from `Enemy`.

**Import (top of file):**

```js
import { applyStatus, tickStatuses, hasStatus } from '../combat/status.js'
```

**Constructor state** (alongside the other timer inits, ~Boss.js:84):

```js
this.statuses = []       // live {kind,timer,...} list — bleed/poison/stun from weapon hits.
this._statusFxTimer = 0  // > 0 while a DoT FX pop is on cooldown (throttle particles).
```

**Three new methods** (verbatim from Enemy.js:136 / 370 / 388, with Boss's `_die`):

```js
applyStatus(spec) {
  if (this.dead || !spec) return
  applyStatus(this.statuses, spec)
}

_tickStatus(dt, ctx) {
  if (this._statusFxTimer > 0) this._statusFxTimer = Math.max(0, this._statusFxTimer - dt)
  if (this.statuses.length === 0) return false
  const { damage, stunned } = tickStatuses(this.statuses, dt)
  if (damage > 0 && !this.dead) {
    this.hp -= damage
    if (this._statusFxTimer <= 0 && ctx && ctx.effects) {
      ctx.effects.statusTick(this.body.center.x, this.body.center.y, damage, this._dominantDotKind())
      this._statusFxTimer = 0.18 // ~5 pops/s max — readable, not spammy.
    }
    if (this.hp <= 0) this._die() // DoT can finish a low-HP boss → Victory via onBossDeath.
  }
  return stunned
}

_dominantDotKind() {
  if (hasStatus(this.statuses, 'bleed')) return 'bleed'
  if (hasStatus(this.statuses, 'poison')) return 'poison'
  return 'bleed'
}
```

**Wire into `Boss.update(dt, ctx)`** — insert after the timer-decay block (Boss.js:151), before
the `switch`:

```js
const stunned = this._tickStatus(dt, ctx)
if (this.dead && this.state === STATE.DEAD) {
  // DoT just killed us → run only the death-pop visual this frame (the FSM is moot).
  this._tickDead(dt)
  this._updateVisual(dt)
  return
}
if (stunned) {
  // STUNNED: plant + skip the FSM. Clear the dash window so a frozen boss deals no contact dmg.
  this.body.setVelocity(0, 0)
  this.dashActive = false
  this._updateVisual(dt)
  return
}
```

Boss has no persisted HURT state (its flinch is instantaneous inside `onHit`), so the stun guard
is simpler than Enemy's `if (stunned && state !== DEAD && state !== HURT)` — it only needs to
exclude DEAD, already handled by the early return above.

Notes on the two early-returns (so a later reader doesn't "simplify" them away):

- **Two paths to `_tickDead`, both correct.** A DoT kill calls `_die()` inside `_tickStatus`
  (setting `state = DEAD`, `deathTimer = 0.7`), so from this frame on the `this.dead && state ===
  DEAD` early-return is the sole DEAD-tick path. An `onHit` kill instead flows through the
  `switch`'s `case STATE.DEAD` arm. Both routes call `_tickDead(dt)` → the same death pop / despawn;
  `_die()`'s once-guard (Boss.js:414) ensures `onBossDeath`/`onDeath` fire exactly once either way
  (AC3).
- **`_face(ctx)` is intentionally skipped in both early-returns.** The normal frame calls `_face`
  before `_updateVisual`; the early-returns omit it because facing is irrelevant when frozen
  (stun) or dead (and `_face` early-returns on `STATE.DEAD` anyway, Boss.js:399). Not a bug.

**Status tint in `_updateVisual`** — Boss's colour cascade is 3-deep (TELEGRAPH → `phaseInvulnTimer`
→ `hurtIframeTimer`, Boss.js:464-471) — one branch deeper than Enemy's, because Boss has a
phase-invuln cue Enemy lacks. Append the status branch as the **final `else if`** so all three
urgent cues (telegraph / phase-invuln / hurt) take precedence over the resting status tint (AC5):

```js
let color = this.spec.color
if (this.state === STATE.TELEGRAPH) {
  const blink = Math.floor(this.stateTimer * 18) % 2 === 0
  color = blink ? this.spec.colorTelegraph : this.spec.color
} else if (this.phaseInvulnTimer > 0) {
  color = this.spec.colorPhase
} else if (this.hurtIframeTimer > 0) {
  color = this.spec.colorHurt
} else if (this.statuses.length > 0) {        // NEW — lowest precedence
  if (hasStatus(this.statuses, 'stun')) color = 0x95a5a6
  else if (hasStatus(this.statuses, 'bleed')) color = 0xa93226
  else if (hasStatus(this.statuses, 'poison')) color = 0x27ae60
}
this.rect.setFillStyle(color)
```

Identical tint values to Enemy.js:569-571; only the new `else if` is added to the existing chain.

### Data flow

- Player melee/shot → `GameScene._onPlayerHitEnemy` / `_onProjectileHitEnemy` →
  `enemy.applyStatus(scaledSpec)` → pushes/refreshes a status on `Boss.statuses` (now exists).
- Each frame: `GameScene` ticks `boss.update(gdt, {player, effects})` (GameScene.js:1678) →
  `_tickStatus` drains DoT / reports stun → FSM either runs, freezes (stun), or yields to the
  death pop (DoT kill).

### Identity safety

A boss never struck by a status weapon keeps `statuses` empty → `_tickStatus` returns `false`
immediately, the new early-returns are never taken, and `_updateVisual`'s new branch is skipped.
Byte-identical to current behavior (AC6).

## 7. Files Changed

- `src/entities/Boss.js` — import the three `status.js` helpers; add `statuses[]` +
  `_statusFxTimer` ctor state; add `applyStatus`, `_tickStatus`, `_dominantDotKind`; wire
  `_tickStatus` + the stun-freeze + DoT-death early-returns into `update()`; add the status tint
  branch to `_updateVisual`.

## 8. Verification

1. [AC1] Equip a spear/hammer/bow (or any Venomous weapon), hit a boss — no `applyStatus` TypeError.
2. [AC2] Apply bleed/poison; boss HP ticks down over time without further hits; ticks pause during
   hit-stop (gameplay dt).
3. [AC3] Bring a boss low, apply bleed, stop attacking — boss bleeds out, Victory/bank fires once,
   kill count increments once (no double-fire).
4. [AC4] Hit a boss with the hammer mid-approach — its FSM freezes for ~0.6s, body planted; a stun
   landed during a dash clears the heavy *dash* contact damage (base `spec.contactDamage` may still
   bite on overlap — Decision 6).
5. [AC5] Visually confirm resting tint: bleed dark red, poison green, stun grey-blue; a telegraph
   flash overrides the tint during a wind-up.
6. [AC6] Fight a boss with a plain sword (no status) — behavior unchanged from before.
7. [AC7] Repeat AC1-AC2 against the miniboss — same behavior (same class).
8. Run `bun ready` (or the project readiness check) — passes.
