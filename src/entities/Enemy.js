import Phaser from 'phaser'
import { swingRect } from '../combat/hitbox.js'
import { GRUNT } from '../config/enemies.js'

// ── Base Enemy with a state-machine AI (design §6.3 + §6.6.4, Decisions 22/29/30/68, AC24/AC59) ──
// A plain class (Decision 10 shape, like the Player): it HOLDS an invisible `collider` (the Arcade
// body — its hurtbox + contact source), a visible `rect`, and a `frontMarker`, and is ticked by
// GameScene each frame with a ctx { player, effects }. ALL feel/AI tuning comes from a `spec`
// object so the class is reusable; the canonical specs live in the PURE config/enemies.js (Decision
// 68 — verifier-importable) and Enemy.js re-exports GRUNT as BRUTE_SPEC for back-compat (below).
//
// FSM (Decision 22): an explicit string enum (idle/patrol/chase/attack/hurt/dead) driven by one
// switch in update(). Telegraph = a timed wind-up sub-phase inside `attack` (color-shift + pause)
// so the strike is readable + dodgeable — the genre's contract. `hurt` interrupts the current
// action; `dead` plays a pop then despawns.
//
// ARCHETYPE VARIETY (Decision 68, AC59): the ONE FSM is kept; variety comes from `spec.behavior`
// ('melee'|'ranged'|'charge'|'fly') driving a few guarded branches in the existing chase/attack ticks
// — NOT four subclasses (which would duplicate the patrol/chase/hurt/dead scaffolding, a DRY
// violation). 'ranged' fires a pooled 'enemy' projectile on the attack beat (the SHOOTER kites);
// 'charge' dashes with a body-contact hitbox (the CHARGER); 'fly' hovers + swoops with gravity off
// (the FLYER). GameScene passes the enemy ProjectilePool in so 'ranged'/the boss can fire (Decision 65).
//
// dt BOUNDARY (§6.3): every timer here is in SECONDS and decays by the GAMEPLAY dt GameScene
// passes (0 during hit-stop, so a hurt enemy's hitstun + a telegraph both freeze with the world —
// Decision 26). Eases use 1−exp(−k·dt).
//
// PIT SAFETY (Decision 29 — review MAJOR): the enemy's body IS added to the world + collided vs
// the room solids by GameScene (so it stands on floors/ledges like the player). Its patrol bounds
// `[patrolMinX, patrolMaxX]` are chosen to PRE-EXCLUDE the room's pit, and CHASE clamps its target
// x to those bounds too — so a chasing Brute can never walk off the span into the pit and out of
// the room. (The FLYER ignores the pit — gravity off — so its bounds are the whole arena, set by
// GameScene; review MINOR.)

const STATE = { IDLE: 'idle', PATROL: 'patrol', CHASE: 'chase', ATTACK: 'attack', HURT: 'hurt', DEAD: 'dead' }

let _nextEnemyId = 1 // monotonic id source (used by the per-swing hitSet dedup + ownerId tag).

// ── BRUTE_SPEC re-export (Decision 68, review MINOR — DRY) ── the canonical specs MOVED to the PURE
// config/enemies.js (so the verifier can import them); Enemy.js re-exports GRUNT as BRUTE_SPEC so the
// existing GameScene import + the regression-pin `spec:'brute'` tag keep working unchanged (ONE source).
export const BRUTE_SPEC = GRUNT

const SQUASH_EASE_K = 16 // 1/s — death-pop + tint easing rate.

export class Enemy {
  // scene: GameScene. (x,y): spawn center. spec: a config object (an archetype from config/enemies.js).
  // hitboxPool: a HitboxPool tagged for THIS enemy (its melee strike acquires from it). projectilePool:
  // the enemy ProjectilePool the 'ranged' behaviour fires from (Decision 65; null = no ranged). patrol
  // bounds default to a span around spawn but the scene passes explicit, pit-excluding ones (Decision 29).
  constructor(scene, x, y, spec, hitboxPool, { patrolMinX = x - 160, patrolMaxX = x + 160, projectilePool = null } = {}) {
    this.scene = scene
    this.spec = spec
    this.behavior = spec.behavior || 'melee' // archetype behaviour tag (Decision 68); default melee.
    this.id = `enemy${_nextEnemyId++}`
    this.hitboxPool = hitboxPool
    this.projectilePool = projectilePool // enemy ProjectilePool ('ranged' fires from it — Decision 65).

    // ── Physics collider (owns the body) + visual + facing marker (same shape as Player). ──
    this.collider = scene.add.rectangle(x, y, spec.bodyW, spec.bodyH, spec.color).setAlpha(0)
    scene.physics.add.existing(this.collider)
    /** @type {Phaser.Physics.Arcade.Body} */
    this.body = this.collider.body
    this.body.setCollideWorldBounds(true)
    this.body.setMaxVelocity(spec.chaseSpeed * 2, 1100) // X cap loose; Y cap = terminal fall.
    // FLYER (Decision 68/AC59 — review MINOR): a 'fly' spec disables body gravity HERE so it hovers
    // instead of falling. GameScene additionally SKIPS the solids/oneWay colliders for a flyer (so it
    // isn't pulled by the group default + doesn't stand on the floor). The per-body setAllowGravity
    // overrides the enemyHurtboxes group's allowGravity:true default for THIS body only.
    if (spec.noGravity) this.body.setAllowGravity(false)
    this.collider.enemyRef = this // back-ref so overlap callbacks resolve the Enemy from its body.

    this.rect = scene.add.rectangle(x, y, spec.bodyW, spec.bodyH, spec.color)
    this.frontMarker = scene.add.rectangle(x, y, 6, spec.bodyH * 0.5, 0x000000).setAlpha(0.4)

    // ── HP + AI state ──
    this.hp = spec.maxHp
    this.maxHp = spec.maxHp
    this.facing = -1 // start facing left (toward the room interior from a right-ish spawn).
    this.state = STATE.IDLE
    this.dead = false
    // Optional scene hook fired ONCE when this enemy dies (Decision 47/AC46): GameScene sets it to
    // bump runState.kills for the run summary. Kept null by default so the Enemy stays self-contained.
    this.onDeath = null
    // ── Cells/loot DROP hook (design §6.5, Decision 54, AC48) ── fired ONCE from _die() with the death
    // CENTER coords + the count from dropCells(): `(x, y, count) => void`. GameScene sets it to
    // `(x,y,count) => pickupPool.spawnDrop(x,y,...)` so the death drops pooled pickups. Kept null by
    // default so the Enemy stays self-contained (NO Phaser/pool import here — the seam is just a
    // callback the scene supplies, exactly like onDeath). The coords MUST be captured at/before _die()
    // because _die() disables the body before the pop (so this.body.center is stale afterward).
    this.onDrop = null

    this.patrolMinX = patrolMinX
    this.patrolMaxX = patrolMaxX

    // Timers (SECONDS, decay by the gameplay dt).
    this.idleTimer = 0.4 + Math.random() * 0.4 // a short beat before patrolling.
    this.attackCooldownTimer = 0
    this.contactCooldownTimer = 0
    this.telegraphTimer = 0 // > 0 during the attack wind-up (the dodge window).
    this.strikeTimer = 0 // > 0 during the strike's active+recovery (after the telegraph).
    this.strikeRect = null // the pooled hitbox rect of OUR live strike (so we release only ours).
    this.hitstunTimer = 0
    this.hurtIframeTimer = 0
    this.loseTimer = 0 // counts time the player has been out of range during chase.
    // ── Archetype-specific state (Decision 68 — read ONLY by that behaviour's branch) ──
    this.dashDir = 1 // CHARGER: the dash direction, latched at telegraph end (a committed lunge).
    this.dashActive = false // CHARGER/FLYER: true while the body-contact dash/swoop hitbox is live.
    this.swoopVX = 0 // FLYER: the latched 2-D swoop velocity (x), set at telegraph end.
    this.swoopVY = 0 // FLYER: the latched 2-D swoop velocity (y).

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

    // Cancel any in-progress attack (interrupt): release ONLY this enemy's live strike hitbox, clear
    // its timers. Phase 4 ships MULTIPLE enemies sharing one pool, so releaseAll() (the old code)
    // would cancel a different enemy's live strike — the resolved review MAJOR. _releaseStrike()
    // targets the rect acquire() returned for OUR swing (stored in _fireStrike), nobody else's.
    this._releaseStrike()
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
  // The FLYER hovers + drifts horizontally (gravity off — it holds a height); ground enemies cruise.
  _tickPatrol(dt, ctx) {
    const cx = this.body.center.x
    // Turn at the patrol bounds (which exclude the pit, Decision 29).
    if (cx <= this.patrolMinX) this.facing = 1
    else if (cx >= this.patrolMaxX) this.facing = -1
    this.body.setVelocityX(this.facing * this.spec.patrolSpeed)
    // FLYER: hold altitude by zeroing vy (gravity is off, so nothing else moves it vertically).
    if (this.behavior === 'fly') this.body.setVelocityY(0)

    if (this._canDetect(ctx.player)) {
      this.state = STATE.CHASE
      this.loseTimer = 0
    }
  }

  // ── chase: move toward the player; attack in range; give up after a grace period out of range. ──
  // The FLYER does a 2-D hover-chase (gravity off); SHOOTER kites (backs off below preferredRange);
  // GRUNT/CHARGER do the original ground chase (target x CLAMPED to patrol bounds so they never walk
  // into the pit, Decision 29). The branch is a small per-behaviour guard — the FSM stays one switch.
  _tickChase(dt, ctx) {
    const player = ctx.player
    const cx = this.body.center.x
    const cy = this.body.center.y
    const px = player.body.center.x
    const py = player.body.center.y
    this.facing = px >= cx ? 1 : -1 // always face the player.

    if (this.behavior === 'fly') {
      // FLYER (Decision 68): a 2-D hover toward the player, targeting a point hoverHeight ABOVE it, so
      // it floats and swoops rather than walking. Gravity is off (constructor) — we drive BOTH axes.
      const targetX = px
      const targetY = py - (this.spec.hoverHeight || 140)
      const ax = Math.sign(targetX - cx)
      const ay = Math.sign(targetY - cy)
      this.body.setVelocity(ax * this.spec.chaseSpeed, ay * this.spec.patrolSpeed)
    } else {
      // GROUND chase (GRUNT/SHOOTER/CHARGER): accelerate vx toward chaseSpeed, clamped to the pit-safe
      // patrol span. SHOOTER kites: if the player is CLOSER than preferredRange, it backs AWAY instead.
      const targetX = Phaser.Math.Clamp(px, this.patrolMinX, this.patrolMaxX)
      let dir = Math.sign(targetX - cx) || this.facing
      if (this.behavior === 'ranged' && Math.abs(px - cx) < (this.spec.preferredRange || 0)) {
        dir = -Math.sign(px - cx) || -this.facing // retreat to keep its preferred spacing (kiting).
      }
      let vx = this.body.velocity.x
      const target = dir * this.spec.chaseSpeed
      if (vx < target) vx = Math.min(target, vx + this.spec.chaseAccel * dt)
      else if (vx > target) vx = Math.max(target, vx - this.spec.chaseAccel * dt)
      // At a clamp edge with the player past it, stop (don't grind into the pit/wall edge).
      if ((cx <= this.patrolMinX && dir < 0) || (cx >= this.patrolMaxX && dir > 0)) vx = 0
      this.body.setVelocityX(vx)
    }

    // In range + off cooldown → commit an attack (enter the telegraph). The range check uses the
    // archetype's attackRange (a SHOOTER's is large — it fires from afar; a CHARGER's commits the dash
    // from a distance) and a vertical band (the FLYER's detectHeight is tall so a swoop engages).
    const inRange = Math.abs(px - cx) <= this.spec.attackRange &&
      Math.abs(py - cy) <= this.spec.detectHeight
    if (inRange && this.attackCooldownTimer <= 0) {
      this.state = STATE.ATTACK
      this.telegraphTimer = this.spec.telegraph
      this.strikeTimer = 0
      if (this.behavior !== 'fly') this.body.setVelocityX(0) // ground enemies plant; flyer keeps hovering.
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

  // ── attack: telegraph (wind-up, dodgeable) → strike → recovery → chase ──
  // The strike DISPATCHES by behaviour (Decision 68): 'melee' → a pooled hitbox in front; 'ranged' →
  // a fired pooled 'enemy' projectile; 'charge'/'fly' → a latched body-contact DASH/SWOOP (the body IS
  // the hitbox — the existing contact overlap deals the high contact damage during the active window).
  _tickAttack(dt, ctx) {
    if (this.telegraphTimer > 0) {
      // Wind-up: plant (ground) / hold (flyer), tick down. The visual flashes the telegraph colour.
      if (this.behavior === 'fly') this.body.setVelocity(0, 0)
      else this.body.setVelocityX(0)
      this.telegraphTimer -= dt
      if (this.telegraphTimer <= 0) {
        this._fireStrike(ctx) // commit the strike ONCE (dispatched by behaviour).
        this.strikeTimer = this.spec.attackActive + this.spec.attackRecovery
        this.dashActive = this.behavior === 'charge' || this.behavior === 'fly' // body-contact window.
      }
      return
    }

    // Strike active+recovery window. For a dash/swoop the body MOVES (the latched velocity) while the
    // active window is live, then plants for the recovery; the body-contact hitbox is its strike.
    this.strikeTimer -= dt
    const recoveryStart = this.spec.attackRecovery
    const inActive = this.strikeTimer > recoveryStart // active phase precedes recovery (timer counts down).
    if (this.behavior === 'charge') {
      if (inActive && this.dashActive) this.body.setVelocityX(this.dashDir * (this.spec.chargeSpeed || 600))
      else { this.body.setVelocityX(0); this.dashActive = false } // recovery: plant.
    } else if (this.behavior === 'fly') {
      if (inActive && this.dashActive) this.body.setVelocity(this.swoopVX, this.swoopVY)
      else { this.body.setVelocity(0, 0); this.dashActive = false } // recovery: hover in place.
    } else {
      // MELEE/RANGED: planted while attacking (the original behaviour — the strike is a stationary swing
      // or shot). Keeps the grunt's Phase-4 feel byte-for-byte.
      this.body.setVelocityX(0)
    }

    if (this.strikeTimer <= 0) {
      this.attackCooldownTimer = this.spec.attackCooldown
      this.dashActive = false
      this.state = STATE.CHASE
      this.strikeRect = null // strike fully resolved — drop our handle (defensive; the ownerId guard
      //                        in _releaseStrike already prevents releasing a re-acquired rect).
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

  // Commit the strike at telegraph end — DISPATCHED by behaviour (Decision 68). 'melee' acquires a
  // pooled hitbox in front; 'ranged' fires a pooled 'enemy' projectile (Decision 65); 'charge'/'fly'
  // LATCH a dash/swoop velocity (the body becomes the hitbox — contact damage during the active window).
  // STORE the returned melee rect (review MAJOR / Phase-4 seam): with multiple enemies sharing one pool
  // we release only OUR live strike on an interrupt/death — never releaseAll() (that would cancel a
  // DIFFERENT enemy's live strike). acquire() returns the rect, so _releaseStrike() targets exactly ours.
  _fireStrike(ctx) {
    const attacker = { cx: this.body.center.x, cy: this.body.center.y, facing: this.facing }
    if (this.behavior === 'ranged') {
      // SHOOTER: fire a pooled 'enemy' projectile along facing (its hit is resolved by GameScene's
      // enemy-projectile overlap against the player — Decision 65). Null pool ⇒ cosmetic no-op (safe).
      if (this.projectilePool && this.spec.projectile) {
        this.projectilePool.acquire(attacker, this.spec.projectile, this.id)
      }
      return
    }
    if (this.behavior === 'charge') {
      // CHARGER: latch the dash direction toward the player (committed — you dodge the telegraph).
      const px = ctx?.player?.body?.center?.x ?? this.body.center.x
      this.dashDir = px >= this.body.center.x ? 1 : -1
      this.facing = this.dashDir
      return
    }
    if (this.behavior === 'fly') {
      // FLYER: latch a 2-D swoop velocity straight toward the player's CURRENT position (a lunge).
      const p = ctx?.player?.body?.center
      const dx = (p?.x ?? this.body.center.x) - this.body.center.x
      const dy = (p?.y ?? this.body.center.y) - this.body.center.y
      const len = Math.hypot(dx, dy) || 1
      const s = this.spec.swoopSpeed || 440
      this.swoopVX = (dx / len) * s
      this.swoopVY = (dy / len) * s
      return
    }
    // MELEE (GRUNT): the pooled hitbox in front (the original path).
    this.strikeRect = this.hitboxPool.acquire(attacker, this.spec.swing, this.id)
  }

  // Release ONLY this enemy's live strike hitbox (review MAJOR — never the whole shared pool). Guard
  // against a STALE handle: the pool may have already released our hitbox (after swing.active) and
  // RE-acquired that same rect for ANOTHER enemy — so we release it only if it is STILL active AND
  // still tagged as OURS (hb.ownerId === this.id). Otherwise we'd cancel a different enemy's live
  // strike via a dangling reference (the exact shared-pool bug, reintroduced through staleness).
  _releaseStrike() {
    const rect = this.strikeRect
    if (rect && rect.hb.active && rect.hb.ownerId === this.id) {
      this.hitboxPool.release(rect)
    }
    this.strikeRect = null
  }

  // Detect the player: within detectRange horizontally AND within the vertical band (so it doesn't
  // aggro across floors). `range` overridable for the wider lose-range check.
  _canDetect(player, range = this.spec.detectRange) {
    const dx = Math.abs(player.body.center.x - this.body.center.x)
    const dy = Math.abs(player.body.center.y - this.body.center.y)
    return dx <= range && dy <= this.spec.detectHeight
  }

  // ── Death: capture the drop point, disable physics, fire the drop + kill hooks, start the pop. ──
  // ORDER MATTERS (review BLOCKER): _die() disables the body, after which this.body.center is stale —
  // so we capture the death CENTER coords FIRST, then disable, then fire onDrop with those captured
  // coords + the count from dropCells(). (Decision 54 / §6.5.)
  _die() {
    if (this.dead) return // guard: runs exactly once.
    this.dead = true
    this.state = STATE.DEAD
    // Capture the drop point at the death center BEFORE disabling the body (review BLOCKER).
    const dropX = this.body.center.x
    const dropY = this.body.center.y
    this.body.enable = false // stop colliding/overlapping immediately (no post-death contact dmg).
    this.body.setVelocity(0, 0)
    this._releaseStrike() // release only OUR live strike (not the shared pool — review MAJOR).
    this.deathTimer = 0.35 // s — how long the pop plays before despawn.
    this._kickScale(1.5, 1.5)
    // Fire the drop hook ONCE with the captured coords + count (Decision 54). GameScene spawns pooled
    // pickups there; null in a non-economy context (the Enemy stays self-contained).
    const cells = this.dropCells()
    if (this.onDrop) this.onDrop(dropX, dropY, cells)
    if (this.onDeath) this.onDeath() // fire the scene's kill-count hook ONCE (Decision 47/AC46).
  }

  // HOOK (Decision 54): the number of Cells this enemy drops on death. RETURNED (not logged) so _die()
  // threads it to onDrop → the pooled pickups (§6.5). A future spec field could override the count.
  dropCells() {
    return this.spec.cellDrop ?? 3 // default drop count (spec can tune it per enemy type).
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
    this._releaseStrike() // release only OUR live strike (not the shared pool — review MAJOR).
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
