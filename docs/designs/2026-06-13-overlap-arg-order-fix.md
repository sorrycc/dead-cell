# Fix Phaser Arcade overlap argument-order crash (Group-vs-Sprite swap)

## 1. Background

`GameScene` crashes with `Uncaught TypeError: Cannot read properties of undefined (reading 'active')`
the first time an enemy melee strike overlaps the player. The crash is in the processFilter of the
enemy-hitbox-vs-player overlap (`src/scenes/GameScene.js:262`).

## 2. Requirements Summary

Phaser's Arcade `collideHandler` normalizes a **Group(object1)-vs-Sprite(object2)** overlap by
internally swapping to `collideSpriteVsGroup(sprite, group)`. The collide/process callbacks therefore
ALWAYS fire as `(sprite, groupChild)` — regardless of the order the pair was registered. Two overlaps
register the GROUP first and the player SPRITE (`player.collider`, a single Rectangle — `Player.js:140`)
second, then read their callback/filter args as if the group child were arg0. So arg0 is actually the
player collider, which has no `.hb` / `.pj` → dereferencing `.active` throws.

Goal: fix both affected overlaps; leave the 8 correct ones untouched. No behavior change beyond "no
longer crashes and resolves the hit it always should have".

## 3. Acceptance Criteria

1. An enemy melee strike overlapping the player no longer throws `reading 'active'`; it resolves a hit
   on the player when the player is hittable.
2. An enemy projectile (Shooter / boss volley) overlapping the player resolves a hit instead of
   crashing — the identical swap bug in `enemyProjectilePool.group` × `player.collider` is fixed in the
   same pass.
3. Both fixed overlaps still honor their gates: per-strike/per-shot `hitSet` dedup, `player.isHittable()`
   (dodge/hurt i-frames), and the `hb.active` / `pj.active` live check.
4. No regression to the 8 already-correct overlaps; `npm run verify` still passes (it exercises only the
   pure-gen path, never this scene — so it confirms that path is untouched, not the fix itself; the fix is
   verified manually).

## 4. Problem Analysis

Audit of all 10 `physics.add.overlap` registrations in `GameScene.js` against Phaser's swap rule
(group-vs-group preserves order; sprite-vs-group and group-vs-sprite both deliver `(sprite, groupChild)`;
sprite-vs-sprite / no-arg callbacks are order-independent):

- L251 `playerHitboxes.group` × `enemyHurtboxes` — group×group, order preserved — OK
- **L258 `enemyHitboxes.group` × `player.collider` — group×sprite, SWAPPED — BUG (reported crash)**
- L265 `player.collider` × `enemyHurtboxes` — sprite first, callback `(_playerRect, enemyRect)` — OK
- L281 `projectilePool.group` × `enemyHurtboxes` — group×group, order preserved — OK
- **L300 `enemyProjectilePool.group` × `player.collider` — group×sprite, SWAPPED — BUG (latent, identical)**
- L315 `player.collider` × `pickupPool.group` — sprite first, callback `(_playerRect, pickupRect)` — OK
- L455 `player.collider` × `door.rect` — sprite×sprite, no-arg callback — OK
- L518 `player.collider` × `tileMap.hazardBodies` — no-arg callback — OK
- L645 `player.collider` × `tileMap.hazardBodies` (boss build) — no-arg callback — OK
- L1193 `player.collider` × `shop.rect` — sprite×sprite, no-arg callback — OK

Exactly two overlaps are broken, both the same root cause: the player sprite is registered as object2
behind a group, and the callback reads positional args.

## 5. Decision Log

**1. Fix style — reorder objects vs. re-index callback args**
- Options:
  - A) Reorder so `player.collider` is object1 and the group is object2; callbacks read `(playerRect, otherRect)`.
  - B) Keep registration order; change callbacks to read the group child as arg1 (`(_playerRect, hitboxRect)`).
- Decision: **A)** — both are runtime-equivalent, but A matches the sprite-first convention already used at
  L265 and L315, giving the file ONE rule ("when `player.collider` is a party, list it first"). Mixed
  conventions are exactly what produced this bug; KISS favors uniformity.

**2. Scope — fix only the reported melee overlap, or both swap instances**
- Options: A) only L258 (the reported crash) · B) both L258 and L300.
- Decision: **B)** — L300 (`enemyProjectilePool` × player) is the identical bug and crashes the same way
  the first time an enemy projectile overlaps the player. Fixing one and leaving its twin is a known
  time-bomb. YAGNI applies to features, not to a verified same-class defect already in hand.

**3. Comment / convention guard**
- Options: A) just fix the code · B) add a one-line note at the overlap block stating the sprite-first rule.
- Decision: **B)** — a single comment documenting why `player.collider` is listed first stops the next
  edit from reintroducing the swap. Cheap, high leverage.

## 6. Design

Phaser dispatch recap (`Phaser.Physics.Arcade.World#collideHandler`): when object1 is a Group and
object2 is a body-owning Sprite, it calls `collideSpriteVsGroup(object2, object1, ...)`, so the callback
signature becomes `(sprite, groupChild)`. The only robust way to know which arg is which is to control
registration order: list the single sprite first, then the group, and read `(sprite, groupChild)`.

### Change A — enemy melee hitbox → player (`GameScene.js:258`)

```js
this.physics.add.overlap(
  this.player.collider,        // sprite → object1
  this.enemyHitboxes.group,    // group  → object2
  (_playerRect, hitboxRect) => this._onEnemyHitPlayer(hitboxRect),
  (_playerRect, hitboxRect) => hitboxRect.hb.active && this.player.isHittable(),
  this,
)
```

### Change B — enemy projectile → player (`GameScene.js:300`)

```js
this.physics.add.overlap(
  this.player.collider,            // sprite → object1
  this.enemyProjectilePool.group,  // group  → object2
  (_playerRect, projRect) => this._onEnemyProjectileHitPlayer(projRect),
  (_playerRect, projRect) => {
    const pj = projRect.pj
    if (!pj.active || !this.player.isHittable()) return false
    return !pj.hitSet.has(this.player.id)
  },
  this,
)
```

`_onEnemyHitPlayer` and `_onEnemyProjectileHitPlayer` are unchanged — they already take the group child
and re-guard `hb.active` / `pj.active` internally.

## 7. Files Changed

- `src/scenes/GameScene.js` — reorder the two Group-vs-Sprite player overlaps so `player.collider` is
  object1; update their callback/filter signatures to `(_playerRect, X)`; add a one-line sprite-first note.

## 8. Verification

1. [AC1] Run `npm run dev`, let a Brute land a melee strike on the player → no console error; player HP
   drops and the hit FX fires (unless i-framed).
2. [AC2] Trigger a Shooter / boss volley to overlap the player → no `reading 'active'` crash; player takes
   the projectile hit when hittable.
3. [AC3] Dodge through an enemy strike → no damage (i-frames respected); a single strike damages at most
   once (hitSet dedup holds).
4. [AC4] `npm run verify` exits 0 — the pure-gen validator never loads this scene, so this confirms the
   pure-gen path is untouched (necessary, not sufficient; the fix itself is covered by steps 1-3).
