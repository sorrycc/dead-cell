import Phaser from 'phaser'

// ── Multi-phase Boss (design §6.6.1, Decision 64, AC56/AC57/AC58) ──
// A PLAIN class (Decision-10 shape, a near-sibling of Enemy — but a SEPARATE class, NOT an Enemy
// subclass: a boss is a choose→telegraph→strike→recover PATTERN FSM gated by HP-threshold PHASES, not
// patrol/chase, so subclassing would fight Enemy's state set). It HOLDS a big Arcade body (its hurtbox
// + contact source), a large `rect`, a telegraph overlay, and runs a phase/pattern FSM ticked by
// GameScene with the SAME (gdt, ctx) contract as Enemy (so the hit-stop dt boundary is identical,
// Decision 26).
//
// DRY WHERE IT MATTERS (Decision 64): the boss is added to the SAME enemyHurtboxes group (so the
// existing player→enemy/projectile overlaps hit it with NO new wiring), its melee/dash strikes acquire
// from the SAME enemyHitboxes pool, its volley fires from the enemy ProjectilePool (Decision 65), and it
// takes hits via the SAME onHit(result) shape Enemy uses. Only the FSM is bespoke.
//
// PHASES (AC56): spec.phases[] (≥2), descending hpThreshold ([1.0, 0.5] → phase 1 from 100%, phase 2
// from 50%). When hp/maxHp crosses the next phase's threshold the boss ADVANCES the phase ONCE (a
// guarded edge — like the gameOver guard), plays a phase-change tell (flash + brief invuln + a
// shockwave FX), and switches to the new (denser, tighter-telegraph) pattern.
//
// ATTACKS (AC56), each TELEGRAPHED: 'slam' (a big enemyHitboxes swing), 'volley' (N pooled 'enemy'
// projectiles in a small spread), 'dash' (a telegraphed lunge across the arena with a body-contact
// hitbox). The FSM is intro → choose → telegraph → strike → recover → choose …, plus hurt/dead. The
// telegraph is a timed wind-up (a distinct colour + a growing warning) so EVERY attack is dodgeable.
//
// DAMAGE IN/OUT (Decision 64): onHit mirrors Enemy (subtract HP, a TINY knockback — a boss is heavy,
// knockbackTakeMult low so it isn't juggled — arm a brief hit-iframe, a flinch). The boss does NOT
// enter a long hitstun (it would trivialise the fight): the flinch NEVER interrupts a committed,
// already-telegraphed strike, so the dodge-the-telegraph contract holds.

const STATE = { INTRO: 'intro', CHOOSE: 'choose', TELEGRAPH: 'telegraph', STRIKE: 'strike', RECOVER: 'recover', HURT: 'hurt', DEAD: 'dead' }

const SQUASH_EASE_K = 14 // 1/s — death-pop + flinch easing rate.
const INTRO_TIME = 0.8 // s — a brief intro beat (the boss "wakes up") before it starts attacking.
const PHASE_INVULN = 0.5 // s — brief invuln during the phase-change tell (so a burst can't skip phase 2).

export class Boss {
  // scene: GameScene. (x,y): spawn center. spec: a DEPTH-SCALED boss spec (config/bosses.js folded by
  // scaleBossSpec — Decision 64/66). hitboxPool: the enemy HitboxPool (slam/dash strikes). projectilePool:
  // the enemy ProjectilePool (volley — Decision 65). bounds: { minX, maxX } the arena walls (dash clamps).
  constructor(scene, x, y, spec, hitboxPool, projectilePool, { minX = x - 400, maxX = x + 400 } = {}) {
    this.scene = scene
    this.spec = spec
    this.id = `boss_${spec.id}`
    this.hitboxPool = hitboxPool
    this.projectilePool = projectilePool
    this.minX = minX
    this.maxX = maxX

    // ── Physics collider (owns the body) + visual + telegraph overlay. ──
    this.collider = scene.add.rectangle(x, y, spec.bodyW, spec.bodyH, spec.color).setAlpha(0)
    scene.physics.add.existing(this.collider)
    /** @type {Phaser.Physics.Arcade.Body} */
    this.body = this.collider.body
    this.body.setCollideWorldBounds(true)
    this.body.setMaxVelocity(900, 1400)
    this.collider.enemyRef = this // SAME back-ref Enemy uses → the player→enemy overlaps resolve the boss.

    this.rect = scene.add.rectangle(x, y, spec.bodyW, spec.bodyH, spec.color).setDepth(5)
    this.rect.setStrokeStyle(3, 0x000000, 0.4)
    // A telegraph overlay (a growing warning where the strike lands) — primitives only; shown during
    // the telegraph window, hidden otherwise. Drawn above the boss so the wind-up is unmissable (AC56).
    this.telegraphFx = scene.add.rectangle(x, y, 10, 10, spec.colorTelegraph).setAlpha(0).setDepth(6)

    // ── HP + phase state ──
    this.hp = spec.maxHp
    this.maxHp = spec.maxHp
    this.facing = -1 // start facing left (toward the dropping-in player).
    this.phaseIndex = 0 // 0-based; advances at HP thresholds (guarded edge).
    this.state = STATE.INTRO
    this.dead = false
    this.removed = false
    // Scene hook fired ONCE on death (Decision 67): GameScene routes to Victory + banks the run.
    this.onBossDeath = null
    // Scene hook fired ONCE on death to bump the run kill count (parity with Enemy.onDeath).
    this.onDeath = null

    // Timers (SECONDS, decay by the gameplay dt — frozen during hit-stop, Decision 26).
    this.stateTimer = INTRO_TIME // generic per-state countdown (intro/telegraph/strike/recover).
    this.attackCooldownTimer = 0
    this.contactCooldownTimer = 0
    this.hurtIframeTimer = 0
    this.phaseInvulnTimer = 0 // > 0 during the phase-change tell (extra invuln so a burst can't skip).
    this.deathTimer = 0

    this._patternIndex = 0 // round-robin index into the current phase's attacks[] (deterministic).
    this._currentAttack = null // the attack entry chosen for the live telegraph→strike→recover cycle.
    this.strikeRect = null // our live slam/dash hitbox (released only by us — same discipline as Enemy).
    this.dashActive = false // true while the dash body-contact window is live.
    this.dashDir = 1

    this.scaleX = 1
    this.scaleY = 1
  }

  // The boss is hittable unless dead / in a hit-iframe / in the phase-change invuln window.
  isHittable() {
    return !this.dead && this.state !== STATE.DEAD && this.hurtIframeTimer <= 0 && this.phaseInvulnTimer <= 0
  }

  // The active phase row (Decision 64).
  _phase() {
    return this.spec.phases[this.phaseIndex]
  }

  // ── Take a hit (the SAME entry Enemy uses — DRY, Decision 64). A TINY knockback (heavy boss), a brief
  // hit-iframe + flinch; NO long hitstun (the flinch never interrupts a committed strike). Advances the
  // phase if HP crossed the next threshold (a guarded edge). Dies at 0 HP. ──
  onHit(result) {
    if (!this.isHittable()) return
    this.hp -= result.damage
    this.body.setVelocity(result.knockbackX * this.spec.knockbackTakeMult, 0) // tiny shove; never juggled.
    this.hurtIframeTimer = this.spec.hurtIframe
    this._kickScale(1.12, 0.9) // a quick flinch squash (NOT a state change — the strike continues).

    if (this.hp <= 0) {
      this._die()
      return
    }
    // ── Phase advance (AC56) — a guarded edge: when hp/maxHp drops to/below the NEXT phase's threshold,
    // advance ONCE, play the tell, switch pattern. Thresholds descend, so we only ever move forward.
    const frac = this.hp / this.maxHp
    const next = this.spec.phases[this.phaseIndex + 1]
    if (next && frac <= next.hpThreshold) this._advancePhase()
  }

  _advancePhase() {
    this.phaseIndex += 1
    this._patternIndex = 0
    this.phaseInvulnTimer = PHASE_INVULN // brief invuln so a damage burst can't skip the new phase.
    this._releaseStrike() // cancel any live strike (a clean phase boundary).
    this.dashActive = false
    this.telegraphFx.setAlpha(0)
    // Phase-change tell (AC56): a red flash + a shockwave FX so the escalation reads.
    this._kickScale(1.4, 1.4)
    this.scene.cameras.main.flash(220, 231, 76, 60)
    this.scene.cameras.main.shake(260, 0.012)
    if (this.scene.effects) this.scene.effects.hit(this.body.center.x, this.body.center.y, { damage: 0, isBackstab: true })
    // Re-enter CHOOSE after a short beat so the phase tell is readable before the next attack.
    this.state = STATE.CHOOSE
    this.stateTimer = 0.4
    this.body.setVelocity(0, 0)
  }

  // ── Per-frame tick. `dt` is the GAMEPLAY dt (0 during hit-stop). ctx = { player, effects }. ──
  update(dt, ctx) {
    // Decay shared timers every frame regardless of state.
    this.attackCooldownTimer = Math.max(0, this.attackCooldownTimer - dt)
    this.contactCooldownTimer = Math.max(0, this.contactCooldownTimer - dt)
    this.hurtIframeTimer = Math.max(0, this.hurtIframeTimer - dt)
    this.phaseInvulnTimer = Math.max(0, this.phaseInvulnTimer - dt)

    switch (this.state) {
      case STATE.INTRO:
        this._tickIntro(dt)
        break
      case STATE.CHOOSE:
        this._tickChoose(dt, ctx)
        break
      case STATE.TELEGRAPH:
        this._tickTelegraph(dt, ctx)
        break
      case STATE.STRIKE:
        this._tickStrike(dt, ctx)
        break
      case STATE.RECOVER:
        this._tickRecover(dt, ctx)
        break
      case STATE.DEAD:
        this._tickDead(dt)
        break
    }

    this._face(ctx)
    this._updateVisual(dt)
  }

  // ── intro: a brief wake-up beat, then start the pattern. ──
  _tickIntro(dt) {
    this.body.setVelocityX(0)
    this.stateTimer -= dt
    if (this.stateTimer <= 0) {
      this.state = STATE.CHOOSE
      this.stateTimer = 0.3
    }
  }

  // ── choose: step toward the player (a slow menacing approach), then pick the next attack. ──
  _tickChoose(dt, ctx) {
    this._stepTowardPlayer(ctx, this._phase().moveSpeed)
    this.stateTimer -= dt
    if (this.stateTimer > 0) return
    if (this.attackCooldownTimer > 0) {
      this.stateTimer = 0.1 // wait out the global cooldown, keep stepping.
      return
    }
    // Pick the next attack ROUND-ROBIN from the current phase's pattern (deterministic — Decision 64).
    const pattern = this._phase().attacks
    const kind = pattern[this._patternIndex % pattern.length]
    this._patternIndex += 1
    const atk = this.spec.attacks[kind]
    if (!atk) {
      // Defensive: an unknown kind (shouldn't happen — the verifier asserts known kinds) → just wait.
      this.stateTimer = 0.2
      return
    }
    this._currentAttack = atk
    this.dashDir = (ctx.player.body.center.x >= this.body.center.x) ? 1 : -1
    this.state = STATE.TELEGRAPH
    this.stateTimer = atk.telegraph * this._phase().telegraphMult // per-phase tightening (AC56).
    this._showTelegraph(atk, ctx)
  }

  // ── telegraph: plant (or for a dash, wind up in place), grow the warning, then fire the strike. ──
  _tickTelegraph(dt, ctx) {
    this.body.setVelocityX(0)
    this._updateTelegraphFx(this._currentAttack, ctx)
    this.stateTimer -= dt
    if (this.stateTimer <= 0) {
      this._fireAttack(this._currentAttack, ctx)
      this.telegraphFx.setAlpha(0)
      this.state = STATE.STRIKE
      this.stateTimer = this._currentAttack.active
      this.dashActive = this._currentAttack.kind === 'dash'
    }
  }

  // ── strike: the live window. A dash MOVES the body (the body-contact hitbox); slam/volley already
  // fired their pooled hitbox/projectiles, so they just hold. ──
  _tickStrike(dt, ctx) {
    if (this.dashActive && this._currentAttack.kind === 'dash') {
      const v = this.dashDir * this._currentAttack.speed
      this.body.setVelocityX(v)
    } else {
      this.body.setVelocityX(0)
    }
    this.stateTimer -= dt
    if (this.stateTimer <= 0) {
      this.dashActive = false
      this.body.setVelocityX(0)
      this.state = STATE.RECOVER
      this.stateTimer = this._currentAttack.recovery
      this._releaseStrike() // drop our slam/dash hitbox handle at strike end (defensive).
    }
  }

  // ── recover: the punish window — the boss is planted, vulnerable, before choosing again. ──
  _tickRecover(dt) {
    this.body.setVelocityX(0)
    this.stateTimer -= dt
    if (this.stateTimer <= 0) {
      this.attackCooldownTimer = 0.15 // a tiny gap so back-to-back attacks aren't frame-perfect.
      this.state = STATE.CHOOSE
      this.stateTimer = 0.25
    }
  }

  // ── dead: play the longer death pop, then despawn (the scene hooks already fired in _die). ──
  _tickDead(dt) {
    this.body.setVelocityX(0)
    this.deathTimer -= dt
    if (this.deathTimer <= 0) this._despawn()
  }

  // Fire the chosen attack at telegraph end (DISPATCH by kind, Decision 64; round-3 adds 'sweep').
  _fireAttack(atk, ctx) {
    if (atk.kind === 'slam') {
      const attacker = { cx: this.body.center.x, cy: this.body.center.y, facing: this.facing }
      this.strikeRect = this.hitboxPool.acquire(attacker, atk.swing, this.id)
    } else if (atk.kind === 'volley') {
      this._fireVolley(atk, ctx)
    } else if (atk.kind === 'sweep') {
      this._fireSweep(atk) // round-3 — a true-radial 360° ring (the new dodge pattern).
    } else if (atk.kind === 'dash') {
      // The dash body-contact damage is applied via GameScene's enemy-contact overlap (the boss body is
      // in enemyHurtboxes); we bump the spec's contactDamage for the dash window so the lunge hits hard.
      // (We latch dashDir at choose-time toward the player; the body moves in _tickStrike.)
    }
  }

  // ── 'volley' — fire `count` pooled 'enemy' projectiles in a real angular spread toward the player
  // (Decision 65; Enrichment round 3 — the true-2-D-arc fix). Each shot's spec is the attack's projectile;
  // the spread fans the launch ANGLE so the volley arcs as a genuine cone, not a flat horizontal line. ──
  _fireVolley(atk, ctx) {
    if (!this.projectilePool || !atk.projectile) return
    const count = Math.max(1, atk.count || 1)
    const spreadRad = ((atk.spreadDeg || 0) * Math.PI) / 180
    const p = ctx.player.body.center
    const cx = this.body.center.x
    const cy = this.body.center.y
    // Aim the CENTER shot at the player; fan the rest evenly across the spread cone.
    const baseAngle = Math.atan2(p.y - cy, p.x - cx)
    const attacker = { cx, cy, facing: this.facing }
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5 // −0.5 … +0.5 across the burst.
      const angle = baseAngle + t * spreadRad
      // Fire with an `angle` aim so the ProjectilePool builds a TRUE 2-D velocity (cos/sin·speed) — the fan
      // arcs toward the player + spreads vertically, the readable-but-dodgeable cone the spec intends.
      this.projectilePool.acquire(attacker, atk.projectile, this.id, null, { angle })
    }
  }

  // ── 'sweep' (Enrichment round 3 — the NEW attack kind) ── fire a TRUE-radial 360° RING of pooled 'enemy'
  // projectiles all at once, evenly spaced around the boss. You dodge by weaving the gap between bolts (or
  // jumping the ring), NOT by side-stepping — a genuinely new pattern the 2-D ProjectilePool unlocked. Uses
  // the SAME pool + the enemy-projectile→player overlap as the volley (NO new wiring — Decision 65). Each
  // shot gets an `angle` aim so the pool gives it a real 2-D velocity (the ring actually radiates outward).
  _fireSweep(atk) {
    if (!this.projectilePool || !atk.projectile) return
    const count = Math.max(1, atk.count || 1)
    const attacker = { cx: this.body.center.x, cy: this.body.center.y, facing: this.facing }
    // A small per-boss phase offset so consecutive rings don't align bolt-for-bolt (varies the gap).
    const offset = (this._patternIndex % 2) * (Math.PI / count)
    for (let i = 0; i < count; i++) {
      const angle = offset + (i / count) * Math.PI * 2 // even spacing around the full ring.
      this.projectilePool.acquire(attacker, atk.projectile, this.id, null, { angle })
    }
  }

  // Show the telegraph overlay sized/placed for the chosen attack (a growing warning — AC56).
  _showTelegraph(atk, ctx) {
    this.telegraphFx.setAlpha(0.0)
    this._updateTelegraphFx(atk, ctx)
  }

  // Update the telegraph overlay each frame so it GROWS (reads as an imminent strike).
  _updateTelegraphFx(atk, ctx) {
    if (!atk) return
    const cx = this.body.center.x
    const cy = this.body.center.y
    let w = 60
    let h = 40
    let x = cx + this.facing * (this.spec.bodyW * 0.5 + 30)
    let y = cy
    if (atk.kind === 'slam') {
      w = atk.swing.reach
      h = atk.swing.halfHeight * 2
      x = cx + this.facing * (this.spec.bodyW * 0.5 + atk.swing.reach * 0.5)
    } else if (atk.kind === 'dash') {
      // A long horizontal bar showing the lunge path.
      const dir = ctx?.player ? (ctx.player.body.center.x >= cx ? 1 : -1) : this.facing
      w = 360
      h = this.spec.bodyH * 0.8
      x = cx + dir * (this.spec.bodyW * 0.5 + 180)
    } else if (atk.kind === 'volley') {
      w = 70
      h = 70
      x = cx + this.facing * (this.spec.bodyW * 0.5 + 40)
    } else if (atk.kind === 'sweep') {
      // A big CENTERED warning box around the boss (the ring radiates outward in all directions, so the
      // tell is "the whole area around the boss is about to spray") — distinct from the directional cues.
      w = this.spec.bodyW + 140
      h = this.spec.bodyH + 140
      x = cx
      y = cy
    }
    this.telegraphFx.setSize(w, h)
    this.telegraphFx.setPosition(x, y)
    // Pulse the alpha so the warning blinks brighter as the strike nears (the unmissable tell).
    const blink = Math.floor(this.stateTimer * 16) % 2 === 0
    this.telegraphFx.setAlpha(blink ? 0.45 : 0.2)
  }

  // Step horizontally toward the player at `speed` (the slow approach between attacks). Clamped to the
  // arena walls so the boss never grinds into a wall.
  _stepTowardPlayer(ctx, speed) {
    const cx = this.body.center.x
    const px = ctx.player.body.center.x
    const dir = Math.sign(px - cx) || this.facing
    let vx = dir * speed
    if ((cx <= this.minX && dir < 0) || (cx >= this.maxX && dir > 0)) vx = 0
    this.body.setVelocityX(vx)
  }

  // Face the player (frozen during telegraph/strike so the swing geometry stays consistent).
  _face(ctx) {
    if (this.state === STATE.TELEGRAPH || this.state === STATE.STRIKE || this.state === STATE.DEAD) return
    if (!ctx || !ctx.player) return
    this.facing = ctx.player.body.center.x >= this.body.center.x ? 1 : -1
  }

  // Release ONLY our live slam/dash hitbox (never the shared pool — same guard as Enemy._releaseStrike).
  _releaseStrike() {
    const rect = this.strikeRect
    if (rect && rect.hb.active && rect.hb.ownerId === this.id) this.hitboxPool.release(rect)
    this.strikeRect = null
  }

  // ── Death (AC58): capture nothing special (no drops beyond the standard run bank), disable the body,
  // fire the scene hooks ONCE, start the longer death pop. GameScene routes to Victory. ──
  _die() {
    if (this.dead) return // guard: runs exactly once.
    this.dead = true
    this.state = STATE.DEAD
    this.body.enable = false
    this.body.setVelocity(0, 0)
    this._releaseStrike()
    this.telegraphFx.setAlpha(0)
    this.deathTimer = 0.7 // a longer death pop than a normal enemy (it's the boss).
    this._kickScale(1.6, 1.6)
    if (this.onDeath) this.onDeath() // bump the run kill count (parity with Enemy).
    if (this.onBossDeath) this.onBossDeath() // → GameScene._onBossDefeated (Victory + bank, Decision 67).
  }

  // Force immediate teardown (level rebuild / scene shutdown) — no pop, no hooks.
  forceDespawn() {
    this.dead = true
    this.state = STATE.DEAD
    if (this.body) this.body.enable = false
    this._releaseStrike()
    this._despawn()
  }

  _despawn() {
    if (this.removed) return
    this.removed = true
    this.collider.destroy()
    this.rect.destroy()
    this.telegraphFx.destroy()
  }

  _updateVisual(dt) {
    if (this.removed) return
    const ease = 1 - Math.exp(-SQUASH_EASE_K * dt)
    this.scaleX += (1 - this.scaleX) * ease
    this.scaleY += (1 - this.scaleY) * ease

    if (this.state === STATE.DEAD) {
      const k = Math.max(0, this.deathTimer / 0.7)
      this.rect.setAlpha(k)
      this.rect.setScale((2 - k) * 1.2, (2 - k) * 1.2)
      this.rect.setPosition(this.body.center.x, this.body.center.y)
      return
    }

    this.rect.setScale(this.scaleX, this.scaleY)
    this.rect.setPosition(this.body.center.x, this.body.center.y)

    // State colour: telegraph amber during the wind-up, hurt white on a hit, phase-invuln a red tint,
    // else the resting boss colour.
    let color = this.spec.color
    if (this.state === STATE.TELEGRAPH) {
      const blink = Math.floor(this.stateTimer * 18) % 2 === 0
      color = blink ? this.spec.colorTelegraph : this.spec.color
    } else if (this.phaseInvulnTimer > 0) {
      color = this.spec.colorPhase
    } else if (this.hurtIframeTimer > 0) {
      color = this.spec.colorHurt
    }
    this.rect.setFillStyle(color)
  }

  _kickScale(sx, sy) {
    this.scaleX = sx
    this.scaleY = sy
  }

  // ── Dynamic contact damage/knockback (read by GameScene._onEnemyContact, §6.6.1) ── while a DASH is
  // live the body-contact IS the strike, so it hits with the dash's heavy damage + shove; otherwise the
  // base contact bite. (A normal enemy has no such methods → the scene falls back to spec.contactDamage.)
  contactDamage() {
    if (this.dashActive && this._currentAttack && this._currentAttack.kind === 'dash') {
      return this._currentAttack.contactDamage ?? this.spec.contactDamage
    }
    return this.spec.contactDamage
  }

  contactKnockback() {
    if (this.dashActive && this._currentAttack && this._currentAttack.kind === 'dash') {
      return this._currentAttack.knockback ?? 280
    }
    return 280
  }

  // Expose a plain attacker shape for damage.js (cx + facing — matches the pure resolveHit input).
  get attackerShape() {
    return { cx: this.body.center.x, facing: this.facing }
  }
}
