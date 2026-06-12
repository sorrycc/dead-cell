import Phaser from 'phaser'
import { swingRect } from '../combat/hitbox.js'

// ── Base Enemy with a state-machine AI (design §6.3, Decisions 22/29/30, AC24) ──
// A plain class (Decision 10 shape, like the Player): it HOLDS an invisible `collider` (the Arcade
// body — its hurtbox + contact source), a visible `rect`, and a `frontMarker`, and is ticked by
// GameScene each frame with a ctx { player, effects }. ALL feel/AI tuning comes from a `spec`
// object so the class is reusable; we ship ONE concrete spec (a melee "Brute", BRUTE_SPEC below).
//
// FSM (Decision 22): an explicit string enum (idle/patrol/chase/attack/hurt/dead) driven by one
// switch in update(). Telegraph = a timed wind-up sub-phase inside `attack` (color-shift + pause)
// so the strike is readable + dodgeable — the genre's contract. `hurt` interrupts the current
// action; `dead` plays a pop then despawns.
//
// dt BOUNDARY (§6.3): every timer here is in SECONDS and decays by the GAMEPLAY dt GameScene
// passes (0 during hit-stop, so a hurt enemy's hitstun + a telegraph both freeze with the world —
// Decision 26). Eases use 1−exp(−k·dt).
//
// PIT SAFETY (Decision 29 — review MAJOR): the enemy's body IS added to the world + collided vs
// the room solids by GameScene (so it stands on floors/ledges like the player). Its patrol bounds
// `[patrolMinX, patrolMaxX]` are chosen to PRE-EXCLUDE the room's pit, and CHASE clamps its target
// x to those bounds too — so a chasing Brute can never walk off the span into the pit and out of
// the room. (The general ground-ahead probe is a Phase-4 concern for generated rooms; the
// bounds-clamp is the KISS correct answer for this hand-made room.)

const STATE = { IDLE: 'idle', PATROL: 'patrol', CHASE: 'chase', ATTACK: 'attack', HURT: 'hurt', DEAD: 'dead' }

let _nextEnemyId = 1 // monotonic id source (used by the per-swing hitSet dedup + ownerId tag).

// ── Concrete enemy spec: the melee "Brute" (Decision 22 — ONE config ships now). ──
// reach/damage/knockback for its strike reuse the SAME swing shape as the player (combat/hitbox).
export const BRUTE_SPEC = {
  maxHp: 60,
  bodyW: 38,
  bodyH: 54,
  color: 0xc0392b, // resting fill (brick red).
  colorTelegraph: 0xf1c40f, // wind-up flash (yellow) so the attack is readable (AC24).
  colorHurt: 0xffffff, // flash white on hit.
  patrolSpeed: 70, // px/s — slow patrol cruise.
  chaseSpeed: 160, // px/s — faster when locked on.
  chaseAccel: 900, // px/s² — how hard it ramps toward chase speed.
  detectRange: 360, // px — horizontal range to notice the player (and same-ish height).
  detectHeight: 140, // px — vertical band; player must be within this to detect/chase.
  loseRange: 480, // px — beyond this (for a grace period) it gives up → patrol.
  loseGrace: 1.2, // s — how long the player can be out of range before chase drops.
  attackRange: 70, // px — within this it commits an attack.
  attackCooldown: 1.0, // s — min gap between attacks.
  telegraph: 0.42, // s — wind-up before the strike (the dodge window, AC24).
  attackActive: 0.12, // s — the strike's live hitbox window.
  attackRecovery: 0.45, // s — recovery after the strike before re-engaging.
  contactDamage: 6, // hp — touch damage tick (separate from the strike).
  contactCooldown: 0.6, // s — min gap between contact ticks (don't shred HP every frame).
  // The strike's swing shape (reach/damage/knockback) — reuses the SWINGS row schema (DRY).
  swing: { reach: 56, halfHeight: 30, forward: 16, damage: 12, knockback: 320 },
  hitstun: 0.28, // s — how long a `hurt` reaction freezes the AI.
  hurtIframe: 0.12, // s — brief post-hit i-frame so one swing's dedup + this both stop re-hits.
  knockbackTakeMult: 1.0, // scales incoming knockback (heavier enemies could lower this).
}

const SQUASH_EASE_K = 16 // 1/s — death-pop + tint easing rate.

export class Enemy {
  // scene: GameScene. (x,y): spawn center. spec: a config object (BRUTE_SPEC). hitboxPool: a
  // HitboxPool tagged for THIS enemy (its strike acquires from it). patrol bounds default to a
  // span around spawn but the scene passes explicit, pit-excluding ones (Decision 29).
  constructor(scene, x, y, spec, hitboxPool, { patrolMinX = x - 160, patrolMaxX = x + 160 } = {}) {
    this.scene = scene
    this.spec = spec
    this.id = `enemy${_nextEnemyId++}`
    this.hitboxPool = hitboxPool

    // ── Physics collider (owns the body) + visual + facing marker (same shape as Player). ──
    this.collider = scene.add.rectangle(x, y, spec.bodyW, spec.bodyH, spec.color).setAlpha(0)
    scene.physics.add.existing(this.collider)
    /** @type {Phaser.Physics.Arcade.Body} */
    this.body = this.collider.body
    this.body.setCollideWorldBounds(true)
    this.body.setMaxVelocity(spec.chaseSpeed * 2, 1100) // X cap loose; Y cap = terminal fall.
    this.collider.enemyRef = this // back-ref so overlap callbacks resolve the Enemy from its body.

    this.rect = scene.add.rectangle(x, y, spec.bodyW, spec.bodyH, spec.color)
    this.frontMarker = scene.add.rectangle(x, y, 6, spec.bodyH * 0.5, 0x000000).setAlpha(0.4)

    // ── HP + AI state ──
    this.hp = spec.maxHp
    this.maxHp = spec.maxHp
    this.facing = -1 // start facing left (toward the room interior from a right-ish spawn).
    this.state = STATE.IDLE
    this.dead = false

    this.patrolMinX = patrolMinX
    this.patrolMaxX = patrolMaxX

    // Timers (SECONDS, decay by the gameplay dt).
    this.idleTimer = 0.4 + Math.random() * 0.4 // a short beat before patrolling.
    this.attackCooldownTimer = 0
    this.contactCooldownTimer = 0
    this.telegraphTimer = 0 // > 0 during the attack wind-up (the dodge window).
    this.strikeTimer = 0 // > 0 during the strike's active+recovery (after the telegraph).
    this.hitstunTimer = 0
    this.hurtIframeTimer = 0
    this.loseTimer = 0 // counts time the player has been out of range during chase.

    this.deathTimer = 0 // > 0 while the death pop plays before despawn.
    this.scaleX = 1
    this.scaleY = 1
  }

  // Hurtbox status for the player's overlap filter: dead/not-yet-spawned enemies aren't hittable,
  // and the brief post-hit i-frame stops a second swing from re-hitting too soon (Decision 20/21).
  isHittable() {
    return !this.dead && this.state !== STATE.DEAD && this.hurtIframeTimer <= 0
  }

  // ── Take a hit (the SAME entry both combatants use — DRY, Decision 21). `result` comes from
  // combat/damage.js resolveHit. Subtract HP, knock back, arm hitstun + hit-iframe, → hurt/dead.
  // Interrupts a telegraph/strike (cancels the pending hitbox) so a well-timed hit beats the
  // enemy's attack (AC24). ──
  onHit(result) {
    if (!this.isHittable()) return
    this.hp -= result.damage
    // Knockback survives because the AI tick is FROZEN during hurt (hitstunTimer) — no per-frame
    // velocity write fights it (the symmetric reason the player needs its hurt-lockout, Decision 32).
    this.body.setVelocity(result.knockbackX * this.spec.knockbackTakeMult, result.knockbackY)
    this.hurtIframeTimer = this.spec.hurtIframe

    // Cancel any in-progress attack (interrupt): release the live strike hitbox, clear its timers.
    // NOTE (Phase 4 seam): releaseAll() clears the WHOLE shared enemy pool. With ONE enemy (YAGNI,
    // Decision 22) that's exactly "release MY strike". When Phase 4 ships multiple enemies, give
    // each enemy its OWN pool (or have acquire() return the rect so we can release only ours) so one
    // enemy's interrupt doesn't cancel another's live strike.
    this.hitboxPool.releaseAll()
    this.telegraphTimer = 0
    this.strikeTimer = 0

    if (this.hp <= 0) {
      this._die()
    } else {
      this.state = STATE.HURT
      this.hitstunTimer = this.spec.hitstun
      this._kickScale(1.25, 0.8) // a quick squash on impact.
    }
  }

  // ── Per-frame tick. `dt` is the GAMEPLAY dt (0 during hit-stop). ctx = { player, effects }. ──
  update(dt, ctx) {
    // Decay shared timers every frame regardless of state.
    this.attackCooldownTimer = Math.max(0, this.attackCooldownTimer - dt)
    this.contactCooldownTimer = Math.max(0, this.contactCooldownTimer - dt)
    this.hurtIframeTimer = Math.max(0, this.hurtIframeTimer - dt)

    switch (this.state) {
      case STATE.IDLE:
        this._tickIdle(dt)
        break
      case STATE.PATROL:
        this._tickPatrol(dt, ctx)
        break
      case STATE.CHASE:
        this._tickChase(dt, ctx)
        break
      case STATE.ATTACK:
        this._tickAttack(dt, ctx)
        break
      case STATE.HURT:
        this._tickHurt(dt)
        break
      case STATE.DEAD:
        this._tickDead(dt)
        break
    }

    this._updateVisual(dt)
  }

  // ── idle → patrol after a beat ──
  _tickIdle(dt) {
    this.body.setVelocityX(0)
    this.idleTimer -= dt
    if (this.idleTimer <= 0) this.state = STATE.PATROL
  }

  // ── patrol: cruise between bounds; flip at a bound; detect player → chase (AC24) ──
  _tickPatrol(dt, ctx) {
    const cx = this.body.center.x
    // Turn at the patrol bounds (which exclude the pit, Decision 29).
    if (cx <= this.patrolMinX) this.facing = 1
    else if (cx >= this.patrolMaxX) this.facing = -1
    this.body.setVelocityX(this.facing * this.spec.patrolSpeed)

    if (this._canDetect(ctx.player)) {
      this.state = STATE.CHASE
      this.loseTimer = 0
    }
  }

  // ── chase: accelerate toward the player (target x CLAMPED to patrol bounds so it never walks
  // into the pit, Decision 29); attack in range; give up after a grace period out of range. ──
  _tickChase(dt, ctx) {
    const player = ctx.player
    const cx = this.body.center.x
    const px = player.body.center.x
    // Target x clamped to the pit-excluding patrol span — the concrete "don't fall out" fix.
    const targetX = Phaser.Math.Clamp(px, this.patrolMinX, this.patrolMaxX)
    const dir = Math.sign(targetX - cx) || this.facing
    this.facing = px >= cx ? 1 : -1 // face the player even while clamped.

    // Accelerate vx toward chaseSpeed in `dir`, capped (frame-rate independent).
    let vx = this.body.velocity.x
    const target = dir * this.spec.chaseSpeed
    if (vx < target) vx = Math.min(target, vx + this.spec.chaseAccel * dt)
    else if (vx > target) vx = Math.max(target, vx - this.spec.chaseAccel * dt)
    // If we're at the clamp edge and the player is past it, stop (don't grind into the pit edge).
    if ((cx <= this.patrolMinX && dir < 0) || (cx >= this.patrolMaxX && dir > 0)) vx = 0
    this.body.setVelocityX(vx)

    // In range + off cooldown → commit an attack (enter the telegraph).
    const inRange = Math.abs(px - cx) <= this.spec.attackRange &&
      Math.abs(player.body.center.y - this.body.center.y) <= this.spec.detectHeight
    if (inRange && this.attackCooldownTimer <= 0) {
      this.state = STATE.ATTACK
      this.telegraphTimer = this.spec.telegraph
      this.strikeTimer = 0
      this.body.setVelocityX(0)
      return
    }

    // Lose the player if it's out of range for a grace period → back to patrol.
    if (!this._canDetect(player, this.spec.loseRange)) {
      this.loseTimer += dt
      if (this.loseTimer >= this.spec.loseGrace) this.state = STATE.PATROL
    } else {
      this.loseTimer = 0
    }
  }

  // ── attack: telegraph (wind-up, dodgeable) → strike (live hitbox) → recovery → chase ──
  _tickAttack(dt, ctx) {
    this.body.setVelocityX(0) // committed: planted while attacking.

    if (this.telegraphTimer > 0) {
      // Wind-up: just tick down. The visual flashes the telegraph color (see _updateVisual).
      this.telegraphTimer -= dt
      if (this.telegraphTimer <= 0) {
        // Telegraph done → fire the strike hitbox ONCE (Decision 30 — same pooled mechanism).
        this._fireStrike()
        this.strikeTimer = this.spec.attackActive + this.spec.attackRecovery
      }
      return
    }

    // Strike active+recovery window: the hitbox lives on the pool (released by HitboxPool.tick).
    this.strikeTimer -= dt
    if (this.strikeTimer <= 0) {
      this.attackCooldownTimer = this.spec.attackCooldown
      this.state = STATE.CHASE
    }
  }

  // ── hurt: frozen by hitstun (knockback carries since we don't write vx here), then → chase ──
  _tickHurt(dt) {
    this.hitstunTimer -= dt
    if (this.hitstunTimer <= 0) this.state = STATE.CHASE // re-aggro after the stun.
  }

  // ── dead: play the pop, then remove from the scene's enemy list (guarded once). ──
  _tickDead(dt) {
    this.deathTimer -= dt
    if (this.deathTimer <= 0) this._despawn()
  }

  // Acquire the strike hitbox from this enemy's pool, placed in front by facing (Decision 30).
  _fireStrike() {
    const attacker = { cx: this.body.center.x, cy: this.body.center.y, facing: this.facing }
    this.hitboxPool.acquire(attacker, this.spec.swing, this.id)
  }

  // Detect the player: within detectRange horizontally AND within the vertical band (so it doesn't
  // aggro across floors). `range` overridable for the wider lose-range check.
  _canDetect(player, range = this.spec.detectRange) {
    const dx = Math.abs(player.body.center.x - this.body.center.x)
    const dy = Math.abs(player.body.center.y - this.body.center.y)
    return dx <= range && dy <= this.spec.detectHeight
  }

  // ── Death: disable physics, fire the Cells drop HOOK, start the death pop (Decision 22). ──
  _die() {
    if (this.dead) return // guard: runs exactly once.
    this.dead = true
    this.state = STATE.DEAD
    this.body.enable = false // stop colliding/overlapping immediately (no post-death contact dmg).
    this.body.setVelocity(0, 0)
    this.hitboxPool.releaseAll()
    this.deathTimer = 0.35 // s — how long the pop plays before despawn.
    this._kickScale(1.5, 1.5)
    this.dropCells()
  }

  // HOOK (Decision 22): Phase 4 spawns real Cell pickups here. Now it just reports the count so the
  // economy seam is visible/testable (AC24 — "the dropCells() hook fires (logged)").
  dropCells() {
    const cells = 3 // placeholder drop count (a future spec field).
    // eslint-disable-next-line no-console
    console.log(`[Enemy ${this.id}] dropCells(${cells}) — Phase 4 spawns pickups here.`)
    return cells
  }

  // Remove all GameObjects + tell the scene to drop us from its enemy list (guarded by `removed`).
  _despawn() {
    if (this.removed) return
    this.removed = true
    this.collider.destroy()
    this.rect.destroy()
    this.frontMarker.destroy()
  }

  // ── Force immediate teardown (design §6.2, Decision 40) ── used by the level→level rebuild to
  // destroy an enemy REGARDLESS of its FSM state (no death pop). Releases any live strike hitbox
  // first so a frozen/in-flight strike doesn't dangle across the rebuild, then despawns. Distinct
  // from _die() (which plays the pop + drops Cells) — a rebuild is not a kill.
  forceDespawn() {
    this.dead = true
    this.state = STATE.DEAD
    if (this.body) this.body.enable = false
    if (this.hitboxPool) this.hitboxPool.releaseAll()
    this._despawn()
  }

  // ── Visual: follow the body, flash the state color, ease the death/impact pop. ──
  _updateVisual(dt) {
    if (this.removed) return
    // Ease scale back to rest (death/impact pop kicks it; this pulls it home).
    const ease = 1 - Math.exp(-SQUASH_EASE_K * dt)
    this.scaleX += (1 - this.scaleX) * ease
    this.scaleY += (1 - this.scaleY) * ease

    if (this.state === STATE.DEAD) {
      // Death pop: fade + grow as deathTimer runs out.
      const k = Math.max(0, this.deathTimer / 0.35)
      this.rect.setAlpha(k)
      this.rect.setScale((2 - k), (2 - k))
      this.rect.setPosition(this.body.center.x, this.body.center.y)
      this.frontMarker.setAlpha(0)
      return
    }

    this.rect.setScale(this.scaleX, this.scaleY)
    this.rect.setPosition(this.body.center.x, this.body.center.y)

    // State color: telegraph flash (yellow wind-up), hurt flash (white), else resting color.
    let color = this.spec.color
    if (this.state === STATE.ATTACK && this.telegraphTimer > 0) {
      // Blink the telegraph so the wind-up is unmissable (AC24).
      const blink = Math.floor(this.telegraphTimer * 16) % 2 === 0
      color = blink ? this.spec.colorTelegraph : this.spec.color
    } else if (this.hurtIframeTimer > 0) {
      color = this.spec.colorHurt
    }
    this.rect.setFillStyle(color)

    // Facing marker on the leading edge.
    this.frontMarker.setAlpha(0.4)
    this.frontMarker.setPosition(this.body.center.x + this.facing * (this.spec.bodyW * 0.5 - 3), this.body.center.y)
  }

  _kickScale(sx, sy) {
    this.scaleX = sx
    this.scaleY = sy
  }

  // Expose a plain attacker shape for damage.js (cx + facing — matches the pure resolveHit input).
  get attackerShape() {
    return { cx: this.body.center.x, facing: this.facing }
  }
}
