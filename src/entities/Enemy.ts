import Phaser from 'phaser'
import { swingRect } from '../combat/hitbox.js'
import { GRUNT } from '../config/enemies.js'
import { applyStatus, tickStatuses, hasStatus } from '../combat/status.js'
import { STATUS_TINT } from '../combat/statusColors.js'
import type { EnemySpec, EliteAffixSpec, EnemyAttackSpec } from '../config/enemies.js'
import type { Status, StatusSpec, StatusKind } from '../combat/status.js'
import type { HitResult } from '../combat/damage.js'
import type { HitboxPool } from '../combat/HitboxPool.js'
import type { ProjectilePool } from '../combat/ProjectilePool.js'
import type { Player } from './Player.js'
import type { Effects } from '../effects/Effects.js'

// The per-frame tick context GameScene threads in (design §6.3): the player to chase/attack + the
// optional effects layer for the status-tick FX. Both Enemy and Boss share this (gdt, ctx) contract.
interface EnemyUpdateCtx {
  player: Player
  effects?: Effects
}

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
  // ── Field declarations (tsconfig useDefineForClassFields:false ⇒ these are PURE TYPES, zero runtime
  // effect; the constructor/init methods still do the assigning). Definite-assignment `!` where a field
  // is set in the constructor body or an init method rather than at the declaration site. ──
  scene: Phaser.Scene
  elite: EliteAffixSpec | null
  spec: EnemySpec
  behavior: string
  id: string
  hitboxPool: HitboxPool
  projectilePool: ProjectilePool | null
  collider!: Phaser.GameObjects.Rectangle
  body!: Phaser.Physics.Arcade.Body
  rect!: Phaser.GameObjects.Rectangle
  frontMarker!: Phaser.GameObjects.Rectangle
  statusMarker!: Phaser.GameObjects.Rectangle
  telegraphMarker!: Phaser.GameObjects.Rectangle
  hp: number
  maxHp: number
  facing: number
  state: string
  dead: boolean
  onDeath: (() => void) | null
  onDrop: ((x: number, y: number, count: number) => void) | null
  patrolMinX: number
  patrolMaxX: number
  idleTimer: number
  attackCooldownTimer: number
  contactCooldownTimer: number
  hazardTickTimer: number
  telegraphTimer: number
  strikeTimer: number
  strikeRect: ReturnType<HitboxPool['acquire']>
  hitstunTimer: number
  hurtIframeTimer: number
  loseTimer: number
  dashDir: number
  dashActive: boolean
  swoopVX: number
  swoopVY: number
  currentAttack: EnemyAttackSpec | null
  lastAttackKind: string
  strafeDir: number
  strafeTimer: number
  deathTimer: number
  scaleX: number
  scaleY: number
  statuses: Status[]
  _statusFxTimer: number
  removed?: boolean

  // scene: GameScene. (x,y): spawn center. spec: a config object (an archetype from config/enemies.js).
  // hitboxPool: a HitboxPool tagged for THIS enemy (its melee strike acquires from it). projectilePool:
  // the enemy ProjectilePool the 'ranged' behaviour fires from (Decision 65; null = no ranged). patrol
  // bounds default to a span around spawn but the scene passes explicit, pit-excluding ones (Decision 29).
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    spec: EnemySpec,
    hitboxPool: HitboxPool,
    {
      patrolMinX = x - 160,
      patrolMaxX = x + 160,
      projectilePool = null,
      elite = null,
    }: {
      patrolMinX?: number
      patrolMaxX?: number
      projectilePool?: ProjectilePool | null
      elite?: EliteAffixSpec | null
    } = {},
  ) {
    this.scene = scene
    // ── ELITE affix fold (design §6.11, Decision 77, AC64) ── if an elite modifier is passed in, build a
    // NEW spec with the affix baked in (more HP, a bigger body, a gold tint) — NEVER mutating the caller's
    // spec (the same aliasing safety scaleSpec keeps). A normal spawn (elite=null) is byte-identical to
    // before the enrichment (the additive identity). The affix's telegraphMult + deathBurst are kept on
    // `this.elite` and read by the attack/death code (so the FSM stays one switch — Decision 68).
    this.elite = elite
    this.spec = elite ? this._foldElite(spec, elite) : spec
    spec = this.spec // use the folded spec for all the ctor reads below (body size/colour/HP).
    this.behavior = spec.behavior || 'melee' // archetype behaviour tag (Decision 68); default melee.
    this.id = `enemy${_nextEnemyId++}`
    this.hitboxPool = hitboxPool
    this.projectilePool = projectilePool // enemy ProjectilePool ('ranged' fires from it — Decision 65).

    // ── Physics collider (owns the body) + visual + facing marker (same shape as Player). ──
    this.collider = scene.add.rectangle(x, y, spec.bodyW, spec.bodyH, spec.color).setAlpha(0)
    scene.physics.add.existing(this.collider)
    /** @type {Phaser.Physics.Arcade.Body} */
    this.body = this.collider.body as Phaser.Physics.Arcade.Body
    this.body.setCollideWorldBounds(true)
    this.body.setMaxVelocity(spec.chaseSpeed * 2, 1100) // X cap loose; Y cap = terminal fall.
    // FLYER (Decision 68/AC59 — review MINOR): a 'fly' spec disables body gravity HERE so it hovers
    // instead of falling. GameScene additionally SKIPS the solids/oneWay colliders for a flyer (so it
    // isn't pulled by the group default + doesn't stand on the floor). The per-body setAllowGravity
    // overrides the enemyHurtboxes group's allowGravity:true default for THIS body only.
    if (spec.noGravity) this.body.setAllowGravity(false)
    ;(this.collider as any).enemyRef = this // back-ref so overlap callbacks resolve the Enemy from its body.

    this.rect = scene.add.rectangle(x, y, spec.bodyW, spec.bodyH, spec.color)
    this.frontMarker = scene.add.rectangle(x, y, 6, spec.bodyH * 0.5, 0x000000).setAlpha(0.4)
    // ── Affliction indicator (affliction-synergy §6.7, AC7) ── a tiny pooled bar ABOVE the head, tinted to
    // the dominant live affliction. A SEPARATE object from `rect` (the body) so it shows even during a
    // telegraph/hurt flash WITHOUT stealing the body-colour precedence (the telegraph stays the highest cue).
    // Hidden (alpha 0) by default + when no status is live + on death (driven in _updateVisual). Drawn above
    // the body so it reads at a glance. Mirrors the existing per-entity primitive-rect pattern (no new art).
    this.statusMarker = scene.add.rectangle(x, y, 10, 6, 0xffffff).setAlpha(0).setDepth(7)
    // ── Spatial telegraph marker (enemy-ai-telegraphs §6.5, Decision 2, AC2/AC5) ── a long-lived per-entity
    // primitive rect (the frontMarker/statusMarker pattern — NOT a per-frame allocation) sized + placed for
    // the CHOSEN attack during the wind-up, mirroring the boss's telegraphFx (Boss.ts:487) so the enemy +
    // boss share ONE "where it lands" vocabulary (AC5). A SEPARATE object from the body `rect` so it never
    // fights the per-phase body flash. Hidden (alpha 0) by default + on active/recovery/idle/patrol/chase/
    // hurt/dead — it ONLY shows during the telegraph (driven in _updateVisual). Depth 6 = same as the boss's.
    this.telegraphMarker = scene.add.rectangle(x, y, 10, 10, this.spec.colorTelegraph).setAlpha(0).setDepth(6)

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
    // ── PER-ENEMY hazard tick gate (F5 environmental-combat, review BLOCKER — per-enemy, NOT a scene-global
    // scalar) ── > 0 while THIS enemy's spike bite is on cooldown. A scene-global cooldown would starve a PACK
    // on spikes (the first overlap each window ticks one enemy + locks out the rest); a per-enemy timer lets
    // every overlapping enemy take damage on its own gate. Decayed on the GAMEPLAY dt below, like every timer.
    this.hazardTickTimer = 0
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
    // ── Per-attack + spacing state (enemy-ai-telegraphs §6.2/§6.4, Decision 1/3/4 — RUNTIME, off the pin) ──
    this.currentAttack = null // the chosen EnemyAttackSpec driving the live telegraph→strike→recovery.
    this.lastAttackKind = '' // the previous attack kind (for the "don't repeat twice running" nudge, AC3).
    this.strafeDir = 1 // 'ranged' — the live strafe direction (flips on a runtime timer + at the clamp).
    this.strafeTimer = 0 // 'ranged' — counts down to the next strafe flip (RUNTIME random — Decision 4).

    this.deathTimer = 0 // > 0 while the death pop plays before despawn.
    this.scaleX = 1
    this.scaleY = 1

    // ── Status effects (design §6.13, Decision 79, AC66) ── the live list of {kind,timer,...} statuses
    // (bleed/poison/stun) applied by weapon hits. Ticked in update() on the gameplay dt: damaging statuses
    // (bleed/poison) drain HP over time; a 'stun' freezes the AI for its window. Empty by default (the
    // identity — a weapon with no status tag never touches it). status.js owns the pure tick math.
    this.statuses = []
    this._statusFxTimer = 0 // > 0 while a status tick FX pop is on cooldown (so DoT doesn't spam particles).
  }

  // ── applyStatus(spec) (design §6.13, Decision 79, AC66) ── arm/refresh a status on this enemy from a
  // weapon's status spec ({ kind, duration, tickInterval, tickDmg }). Called by GameScene's hit handlers.
  // No-op if dead (a corpse can't bleed) or spec is null (a weapon with no status — the identity). Refresh-
  // on-re-hit semantics live in status.js's applyStatus (re-poking extends, never stacks infinitely).
  applyStatus(spec: StatusSpec | null) {
    if (this.dead || !spec) return
    applyStatus(this.statuses, spec)
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
  onHit(result: HitResult) {
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
    this.currentAttack = null // drop the chosen attack — the interrupt cancels it (the marker hides next tick).

    if (this.hp <= 0) {
      this._die()
    } else {
      this.state = STATE.HURT
      this.hitstunTimer = this.spec.hitstun
      this._kickScale(1.25, 0.8) // a quick squash on impact.
    }
  }

  // ── Per-frame tick. `dt` is the GAMEPLAY dt (0 during hit-stop). ctx = { player, effects }. ──
  update(dt: number, ctx: EnemyUpdateCtx) {
    // Decay shared timers every frame regardless of state.
    this.attackCooldownTimer = Math.max(0, this.attackCooldownTimer - dt)
    this.contactCooldownTimer = Math.max(0, this.contactCooldownTimer - dt)
    this.hazardTickTimer = Math.max(0, this.hazardTickTimer - dt) // F5 — the per-enemy spike-bite gate.
    this.hurtIframeTimer = Math.max(0, this.hurtIframeTimer - dt)

    // ── Status tick (design §6.13, Decision 79, AC66) ── advance bleed/poison/stun on the gameplay dt:
    // drain DoT damage from HP (which can KILL — handled in _tickStatus) and read the stun flag. A STUN
    // freezes the AI: skip the FSM switch entirely this frame (the body is planted) so a hammered enemy is
    // briefly helpless. The DEAD state still runs its pop (a status can't keep ticking a corpse). Returns
    // early if the DoT killed us (the state is now DEAD and the visual tick below still plays the pop).
    const stunned = this._tickStatus(dt, ctx)
    if (this.dead && this.state === STATE.DEAD) {
      // DoT may have just killed us → run only the death-pop visual this frame (the FSM is moot).
      this._tickDead(dt)
      this._updateVisual(dt)
      return
    }
    if (stunned && this.state !== STATE.DEAD && this.state !== STATE.HURT) {
      // STUNNED: plant the body + skip the FSM (no patrol/chase/attack). HURT already plants (knockback
      // carries), so we leave it alone; the stun simply outlasts it. The visual still ticks (the tint cue).
      this.body.setVelocityX(0)
      this._updateVisual(dt)
      return
    }

    // ── ELITE HP REGEN (Decision 77, AC64; round-3 regenerating affix) ── a regenerating elite heals over
    // time while alive (on the gameplay dt, so it FREEZES with the world during a hit-stop — consistent).
    // Capped at maxHp; only a live (non-dead) enemy regens. No-op for a normal enemy / a non-regen affix
    // (this.elite.hpRegenPerSec absent ⇒ 0). This makes "kill it before it heals" a real DPS race.
    if (this.elite && this.elite.hpRegenPerSec! > 0 && !this.dead && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.elite.hpRegenPerSec! * dt)
    }

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
  _tickIdle(dt: number) {
    this.body.setVelocityX(0)
    this.idleTimer -= dt
    if (this.idleTimer <= 0) this.state = STATE.PATROL
  }

  // ── patrol: cruise between bounds; flip at a bound; detect player → chase (AC24) ──
  // The FLYER hovers + drifts horizontally (gravity off — it holds a height); ground enemies cruise.
  _tickPatrol(dt: number, ctx: EnemyUpdateCtx) {
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
  _tickChase(dt: number, ctx: EnemyUpdateCtx) {
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
      // patrol span.
      const targetX = Phaser.Math.Clamp(px, this.patrolMinX, this.patrolMaxX)
      let dir = Math.sign(targetX - cx) || this.facing
      let strafing = false // true ONLY on the in-band strafe frame (gates the clamp-reversal below).
      if (this.behavior === 'ranged') {
        // ── SPACING PRESSURE (enemy-ai-telegraphs §6.4, Decision 3, AC4) ── maintain the preferredRange
        // band so the shooter is NEVER a stationary turret: too CLOSE → retreat (the original kite); too FAR
        // → ADVANCE (don't passively let the player walk out of range); IN-BAND → STRAFE (a runtime left/
        // right jink that flips on a short timer — so it pressures the player to close or relocate). All of
        // this stays CLAMPED to the pit-safe span by the clamp-edge guard below (Decision 29), so a kiting
        // shooter reverses at the pit edge instead of grinding into it. The strafe direction uses RUNTIME
        // randomness (Math.random — off the level pin, Decision 4). `facing` keeps pointing at the player
        // each frame (set above), so it keeps AIMING while it strafes.
        const gap = Math.abs(px - cx)
        const band = this.spec.preferredRange || 0
        if (gap < band * 0.85) {
          dir = -Math.sign(px - cx) || -this.facing // too close → back away.
        } else if (gap > band * 1.15) {
          dir = Math.sign(px - cx) || this.facing // too far → close in (keep the player in range).
        } else {
          this.strafeTimer -= dt
          if (this.strafeTimer <= 0) {
            this.strafeDir = Math.random() < 0.5 ? -1 : 1
            this.strafeTimer = 0.5 + Math.random() * 0.6 // a short jink window (runtime — Decision 4).
          }
          dir = this.strafeDir // in-band → strafe (a runtime jink, flipped at the clamp by the guard below).
          strafing = true // mark this as the strafe frame (the ONLY case the clamp-reversal should fire).
        }
      }
      // A strafing shooter that reaches the pit-safe clamp REVERSES its jink (so it bounces along the band
      // instead of grinding into the edge — AC4 "flips at the patrol clamp"). Gated on the explicit `strafing`
      // flag — NOT `dir === this.strafeDir`, which can't tell the strafe branch from the retreat/advance ones
      // (all three set dir to ±1 and strafeDir is also ±1). With the old heuristic a too-close shooter
      // retreating toward a clamp whose retreat dir HAPPENED to equal strafeDir would flip strafeDir and get
      // overridden BACK toward the player at the edge (the opposite of AC4's spacing pressure). Now
      // retreat/advance at the clamp falls through to the clamp-stop below (line ~423) untouched. Decision 3/29.
      if (strafing) {
        if ((cx <= this.patrolMinX && dir < 0) || (cx >= this.patrolMaxX && dir > 0)) {
          this.strafeDir = -this.strafeDir
          this.strafeTimer = 0.5 + Math.random() * 0.6
          dir = this.strafeDir
        }
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
      // CHOOSE THE ATTACK (enemy-ai-telegraphs §6.2, Decision 1/4, AC3): a RUNTIME weighted pick from
      // spec.attacks (off the level pin). The chosen attack drives the telegraph duration, the strike
      // dispatch (_fireStrike keys on its kind), and the active/recovery split (_tickAttack). lastAttackKind
      // feeds the "don't repeat twice running" nudge. A 1-entry table is the identity (AC8).
      this.currentAttack = this._chooseAttack()
      this.lastAttackKind = this.currentAttack.kind
      // ELITE (Decision 77): a tighter telegraph (telegraphMult < 1) → a faster wind-up that punishes a
      // lazy dodge. The mult scales the CHOSEN attack's telegraph (so elites get tighter wind-ups on ANY
      // attack). A normal enemy (this.elite null) uses the base telegraph (the identity — mult 1).
      this.telegraphTimer = this.currentAttack.telegraph * (this.elite ? this.elite.telegraphMult ?? 1 : 1)
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
  // The strike DISPATCHES by the CHOSEN ATTACK's kind (enemy-ai-telegraphs §6.3, Decision 6 — NOT the
  // archetype's behaviour, so a 'charge' archetype can carry a 'swing' ground-pound): 'swing' → a pooled
  // hitbox in front; 'shoot' → fired pooled 'enemy' projectile(s); 'dash'/'swoop' → a latched body-contact
  // DASH/SWOOP (the body IS the hitbox). The timings (telegraph/active/recovery) come from currentAttack so
  // a heavy overhead reads slower than a quick jab. Defensive: a null currentAttack (e.g. an interrupt mid-
  // frame) falls back to the spec's legacy top-level timings (the identity).
  _tickAttack(dt: number, ctx: EnemyUpdateCtx) {
    const atk = this.currentAttack
    const isBodyDash = atk ? atk.kind === 'dash' || atk.kind === 'swoop' : this.behavior === 'charge' || this.behavior === 'fly'
    if (this.telegraphTimer > 0) {
      // Wind-up: plant (ground) / hold (flyer), tick down. The visual flashes the telegraph colour.
      if (this.behavior === 'fly') this.body.setVelocity(0, 0)
      else this.body.setVelocityX(0)
      this.telegraphTimer -= dt
      if (this.telegraphTimer <= 0) {
        this._fireStrike(ctx) // commit the strike ONCE (dispatched by the chosen attack's kind).
        this.strikeTimer = (atk ? atk.active + atk.recovery : this.spec.attackActive + this.spec.attackRecovery)
        this.dashActive = isBodyDash // the body-contact window (dash/swoop move the body during 'active').
      }
      return
    }

    // Strike active+recovery window. For a dash/swoop the body MOVES (the latched velocity) while the
    // active window is live, then plants for the recovery; the body-contact hitbox is its strike. The
    // boundary uses the CHOSEN attack's recovery (per-attack, AC3) instead of the spec's single value.
    this.strikeTimer -= dt
    const recoveryStart = atk ? atk.recovery : this.spec.attackRecovery
    const inActive = this.strikeTimer > recoveryStart // active phase precedes recovery (timer counts down).
    if (atk?.kind === 'dash') {
      // DASH (a charger's lunge): drive vx at the chosen attack's chargeSpeed during the active window.
      if (inActive && this.dashActive) this.body.setVelocityX(this.dashDir * (atk.chargeSpeed || this.spec.chargeSpeed || 600))
      else { this.body.setVelocityX(0); this.dashActive = false } // recovery: plant.
    } else if (atk?.kind === 'swoop') {
      // SWOOP (a flyer's 2-D lunge): drive the latched velocity during the active window, then hover.
      if (inActive && this.dashActive) this.body.setVelocity(this.swoopVX, this.swoopVY)
      else { this.body.setVelocity(0, 0); this.dashActive = false } // recovery: hover in place.
    } else if (this.behavior === 'fly') {
      // A flyer doing a STATIONARY attack (the hover-spit 'shoot'): hold altitude in place (gravity off).
      this.body.setVelocity(0, 0)
    } else {
      // MELEE/RANGED stationary strike ('swing'/'shoot', incl. a charger's ground-pound): planted while
      // attacking (the original behaviour — a stationary swing or shot). Keeps the grunt's feel byte-for-byte.
      this.body.setVelocityX(0)
    }

    if (this.strikeTimer <= 0) {
      this.attackCooldownTimer = this.spec.attackCooldown // cooldown stays a spec-level cadence (KISS).
      this.dashActive = false
      this.currentAttack = null // strike fully resolved — drop the chosen attack (the marker stays hidden).
      this.state = STATE.CHASE
      this.strikeRect = null // strike fully resolved — drop our handle (defensive; the ownerId guard
      //                        in _releaseStrike already prevents releasing a re-acquired rect).
    }
  }

  // ── _tickStatus(dt, ctx) → stunned (design §6.13, Decision 79, AC66) ── advance the status list (the
  // pure status.js math), apply any DoT damage to HP (which can KILL — fire _die() once at ≤0), pop a small
  // status FX on a damaging tick (throttled so DoT doesn't spam particles), and return whether a stun is
  // live. DoT BYPASSES the hit-iframe/knockback path on purpose: a bleed ticks while the enemy is otherwise
  // un-re-hittable (that's the value of DoT), and it must NOT re-trigger the hurt-reaction each tick (no
  // knockback/stagger from poison). _statusFxTimer gates the cue to ~5/s so it reads without churn.
  _tickStatus(dt: number, ctx: EnemyUpdateCtx): boolean {
    if (this._statusFxTimer > 0) this._statusFxTimer = Math.max(0, this._statusFxTimer - dt)
    if (this.statuses.length === 0) return false
    const { damage, stunned } = tickStatuses(this.statuses, dt)
    if (damage > 0 && !this.dead) {
      this.hp -= damage
      if (this._statusFxTimer <= 0 && ctx && ctx.effects) {
        // A small DoT pop (the kind tints it: bleed red, poison green) so the over-time damage reads.
        ctx.effects.statusTick(this.body.center.x, this.body.center.y, damage, this._dominantDotKind())
        this._statusFxTimer = 0.18 // ~5 pops/s max — readable, not spammy.
      }
      if (this.hp <= 0) this._die() // DoT can finish a low-HP enemy (the genre's "they bled out").
    }
    return stunned
  }

  // The kind of the active DAMAGING status for the DoT-tick FX tint (bleed / poison / burn — affliction-
  // synergy slice adds burn). Precedence burn → bleed → poison (KISS — a single dominant cue for the
  // primitive number pop). Damaging-only (stun excluded — it pops no DoT number); the marker uses the wider
  // _dominantStatusKind below. Default bleed keeps the old behaviour when somehow called with no DoT live.
  _dominantDotKind(): StatusKind {
    if (hasStatus(this.statuses, 'burn')) return 'burn'
    if (hasStatus(this.statuses, 'bleed')) return 'bleed'
    if (hasStatus(this.statuses, 'poison')) return 'poison'
    return 'bleed'
  }

  // ── _dominantStatusKind() (affliction-synergy §6.7, Decision 3, AC7) ── the dominant LIVE status for the
  // MARKER tint, precedence burn → bleed → poison → stun (the damaging DoTs first so the over-time threat
  // reads; stun last — it's already cued by the body grey + the FSM freeze). Returns null when NONE is live
  // ⇒ the marker is hidden (the identity — an un-afflicted enemy shows no marker). Distinct from
  // _dominantDotKind (which is DoT-only for the tick number) because the marker also surfaces a pure stun.
  _dominantStatusKind(): StatusKind | null {
    if (hasStatus(this.statuses, 'burn')) return 'burn'
    if (hasStatus(this.statuses, 'bleed')) return 'bleed'
    if (hasStatus(this.statuses, 'poison')) return 'poison'
    if (hasStatus(this.statuses, 'stun')) return 'stun'
    return null
  }

  // ── hurt: frozen by hitstun (knockback carries since we don't write vx here), then → chase ──
  _tickHurt(dt: number) {
    this.hitstunTimer -= dt
    if (this.hitstunTimer <= 0) this.state = STATE.CHASE // re-aggro after the stun.
  }

  // ── dead: play the pop, then remove from the scene's enemy list (guarded once). ──
  _tickDead(dt: number) {
    this.deathTimer -= dt
    if (this.deathTimer <= 0) this._despawn()
  }

  // ── _chooseAttack() → the next EnemyAttackSpec (enemy-ai-telegraphs §6.2, Decision 1/4, AC3/AC8) ──────
  // Pick from spec.attacks by WEIGHT, with a small nudge AGAINST repeating the last kind back-to-back so a
  // long fight visibly MIXES an archetype's attacks rather than spamming one (variety, AC3). Uses RUNTIME
  // randomness (Math.random) — NOT the level seed: the per-frame choice is explicitly OUTSIDE the level pin
  // (the verifier never imports Enemy.js — Decision 4), exactly like the idleTimer jitter. A SINGLE-entry
  // table returns that one entry → byte-identical legacy behaviour (the chooser over a 1-element table is the
  // identity, AC8). KISS: a weighted pick over a tiny array (no per-frame allocation beyond the two loops).
  _chooseAttack(): EnemyAttackSpec {
    const list = this.spec.attacks
    if (list.length === 1) return list[0]
    let total = 0
    for (const a of list) total += a.weight * (a.kind === this.lastAttackKind ? 0.5 : 1)
    let r = Math.random() * total
    for (const a of list) {
      r -= a.weight * (a.kind === this.lastAttackKind ? 0.5 : 1)
      if (r <= 0) return a
    }
    return list[list.length - 1] // float-rounding safety net (the weights summed to `total`).
  }

  // Commit the strike at telegraph end — DISPATCHED by behaviour (Decision 68). 'melee' acquires a
  // pooled hitbox in front; 'ranged' fires a pooled 'enemy' projectile (Decision 65); 'charge'/'fly'
  // LATCH a dash/swoop velocity (the body becomes the hitbox — contact damage during the active window).
  // STORE the returned melee rect (review MAJOR / Phase-4 seam): with multiple enemies sharing one pool
  // we release only OUR live strike on an interrupt/death — never releaseAll() (that would cancel a
  // DIFFERENT enemy's live strike). acquire() returns the rect, so _releaseStrike() targets exactly ours.
  _fireStrike(ctx: EnemyUpdateCtx) {
    const attacker = { cx: this.body.center.x, cy: this.body.center.y, facing: this.facing }
    // Dispatch on the CHOSEN attack's kind (Decision 6 — the unlock for cross-behaviour variety, e.g. a
    // 'charge' archetype's 'swing' ground-pound). Defensive: a null currentAttack falls back to the spec's
    // legacy single-strike path keyed on behaviour (the identity if attacks[] ever went missing).
    const kind = this.currentAttack?.kind ?? this._legacyKindForBehavior()
    if (kind === 'shoot') {
      // SHOOTER / SPITTER / FLYER-spit: fire pooled 'enemy' projectile(s) (the hit is resolved by
      // GameScene's enemy-projectile overlap against the player — Decision 65). Reads the CHOSEN attack's
      // projectile/count/spread (so a shooter's single bolt, its 2-shot burst, a spitter's fan + snipe, and
      // a flyer's spit are ALL this one branch). Null pool / no projectile ⇒ cosmetic no-op (safe).
      const projectile = this.currentAttack?.projectile ?? this.spec.projectile
      if (this.projectilePool && projectile) {
        const count = Math.max(1, this.currentAttack?.projectileCount ?? this.spec.projectileCount ?? 1)
        const spreadDeg = this.currentAttack?.projectileSpread ?? this.spec.projectileSpread ?? 0
        if (count === 1) {
          // A single bolt along facing (the SHOOTER's original path — byte-identical to before round 3).
          this.projectilePool.acquire(attacker, projectile, this.id)
        } else {
          // A FAN of `count` shots across `spreadDeg` degrees, aimed at the player's CURRENT position. Uses
          // the round-3 2-D projectile aim so the cone actually arcs (the SPITTER fan + the SHOOTER burst).
          const p = ctx?.player?.body?.center
          const dx = (p?.x ?? (this.body.center.x + this.facing)) - this.body.center.x
          const dy = (p?.y ?? this.body.center.y) - this.body.center.y
          const baseAngle = Math.atan2(dy, dx)
          const spreadRad = (spreadDeg * Math.PI) / 180
          for (let i = 0; i < count; i++) {
            const t = i / (count - 1) - 0.5 // −0.5 … +0.5 across the fan.
            const angle = baseAngle + t * spreadRad
            this.projectilePool.acquire(attacker, projectile, this.id, null, { angle })
          }
        }
      }
      return
    }
    if (kind === 'dash') {
      // CHARGER: latch the dash direction toward the player (committed — you dodge the telegraph).
      const px = ctx?.player?.body?.center?.x ?? this.body.center.x
      this.dashDir = px >= this.body.center.x ? 1 : -1
      this.facing = this.dashDir
      return
    }
    if (kind === 'swoop') {
      // FLYER: latch a 2-D swoop velocity straight toward the player's CURRENT position (a lunge).
      const p = ctx?.player?.body?.center
      const dx = (p?.x ?? this.body.center.x) - this.body.center.x
      const dy = (p?.y ?? this.body.center.y) - this.body.center.y
      const len = Math.hypot(dx, dy) || 1
      const s = this.currentAttack?.swoopSpeed || this.spec.swoopSpeed || 440
      this.swoopVX = (dx / len) * s
      this.swoopVY = (dy / len) * s
      return
    }
    // SWING (a grunt's jab/overhead, a charger's ground-pound): the pooled hitbox in front. Reads the
    // CHOSEN attack's swing geometry (so the overhead's wider reach + the ground-pound's tall halfHeight
    // both land), falling back to the spec's swing (the identity).
    const swing = this.currentAttack?.swing ?? this.spec.swing
    this.strikeRect = this.hitboxPool.acquire(attacker, swing as any, this.id)
  }

  // The legacy strike kind for a behaviour (the additive identity if currentAttack is ever null — Decision
  // 5): the mapping each archetype's attacks[0] reproduces. KISS — a tiny lookup, never hit in normal play.
  _legacyKindForBehavior(): string {
    if (this.behavior === 'ranged') return 'shoot'
    if (this.behavior === 'charge') return 'dash'
    if (this.behavior === 'fly') return 'swoop'
    return 'swing'
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
  _canDetect(player: Player, range: number = this.spec.detectRange) {
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
    // ELITE death burst (Decision 77/AC64): fire the radial projectile fan at the captured death center
    // BEFORE the drop hook (order is cosmetic; the body is already disabled). No-op for a normal enemy.
    this._fireDeathBurst(dropX, dropY)
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
    this.statusMarker.destroy()
    this.telegraphMarker.destroy() // the spatial telegraph cue (enemy-ai-telegraphs §6.5, AC2).
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
  _updateVisual(dt: number) {
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
      this.statusMarker.setAlpha(0) // hide the affliction indicator on death (AC7).
      this.telegraphMarker.setAlpha(0) // hide the spatial telegraph cue on death (AC2).
      return
    }

    this.rect.setScale(this.scaleX, this.scaleY)
    this.rect.setPosition(this.body.center.x, this.body.center.y)

    // ── Per-phase attack flash (enemy-ai-telegraphs §6.5, AC1) ── the body reads ALL THREE attack phases so
    // the player knows exactly WHEN to dodge AND when to punish: a blinking colorTelegraph WIND-UP (existing),
    // a bright colorActive flash on the strike's LIVE window, then a dim colorRecovery tint during the punish
    // window. The attack phases sit ABOVE the hurt + status tint (the urgent timing cue wins — matching the
    // existing ordering where the telegraph beat status). A non-attacking enemy is visually unchanged.
    let color = this.spec.color
    if (this.state === STATE.ATTACK && this.telegraphTimer > 0) {
      // Wind-up: blink the telegraph so it's unmissable (AC1/AC24).
      const blink = Math.floor(this.telegraphTimer * 16) % 2 === 0
      color = blink ? this.spec.colorTelegraph : this.spec.color
    } else if (this.state === STATE.ATTACK && this.strikeTimer > (this.currentAttack?.recovery ?? this.spec.attackRecovery)) {
      // Active: a bright flash on the strike's live window (the "dodge NOW" moment, AC1).
      color = this.spec.colorActive ?? this.spec.colorTelegraph
    } else if (this.state === STATE.ATTACK) {
      // Recovery: a dim tint during the punish window (the "punish NOW" moment, AC1).
      color = this.spec.colorRecovery ?? this.spec.color
    } else if (this.hurtIframeTimer > 0) {
      color = this.spec.colorHurt
    } else if (this.statuses.length > 0) {
      // Status tint (the resting cue): stun grey-blue, bleed dark red, poison sickly green, burn orange.
      // Stun first (it has no DoT number, so the body grey is its main cue); else the dominant DoT colour.
      // Reads the SHARED STATUS_TINT table (DRY — one source for body cascade + marker + Effects).
      if (hasStatus(this.statuses, 'stun')) color = STATUS_TINT.stun
      else color = STATUS_TINT[this._dominantDotKind()]
    }
    this.rect.setFillStyle(color)

    // Facing marker on the leading edge.
    this.frontMarker.setAlpha(0.4)
    this.frontMarker.setPosition(this.body.center.x + this.facing * (this.spec.bodyW * 0.5 - 3), this.body.center.y)

    // ── Affliction indicator (affliction-synergy §6.7, AC7) ── drive the always-visible marker ABOVE the
    // head, tinted to the dominant live affliction (burn→bleed→poison→stun). VISIBLE even during a telegraph/
    // hurt flash (it's a SEPARATE object from `rect`, so it never fights the body-colour precedence). Hidden
    // when no status is live (the identity — an un-afflicted enemy shows nothing).
    const sk = this._dominantStatusKind()
    if (sk) {
      this.statusMarker.setAlpha(0.95)
      this.statusMarker.setFillStyle(STATUS_TINT[sk])
      this.statusMarker.setPosition(this.body.center.x, this.body.center.y - this.spec.bodyH * 0.5 - 8)
    } else {
      this.statusMarker.setAlpha(0)
    }

    // ── Spatial telegraph marker (enemy-ai-telegraphs §6.5, Decision 2/7, AC2/AC5) ── drive the "where it
    // lands" cue ONLY during the wind-up, sized + placed for the CHOSEN attack's kind (the boss's
    // telegraphFx idea, mirrored inline — Boss.ts:487). Hidden on active/recovery/idle/patrol/chase/hurt
    // (the death case returns above). Blinks the alpha at the SAME 16 Hz cadence as the body flash + the
    // boss overlay so the player reads enemy + boss wind-ups with ONE vocabulary (AC5).
    if (this.state === STATE.ATTACK && this.telegraphTimer > 0 && this.currentAttack) {
      this._updateTelegraphMarker(this.currentAttack)
    } else {
      this.telegraphMarker.setAlpha(0)
    }
  }

  // ── _updateTelegraphMarker(atk) (enemy-ai-telegraphs §6.5, Decision 2/7, AC2/AC5) ── size + place the
  // spatial cue for the chosen attack's footprint, mirroring the boss's _updateTelegraphFx per-kind sizing
  // (Decision 7 — bias to the inline mirror over a shared module so the two entity files don't entangle,
  // KISS over premature DRY). A forward box for a 'swing', a thin long aim line for a 'shoot', a long
  // horizontal bar along the lunge for a 'dash', a box at the swoop target for a 'swoop'. Blinks at 16 Hz.
  _updateTelegraphMarker(atk: EnemyAttackSpec) {
    const cx = this.body.center.x
    const cy = this.body.center.y
    const bodyW = this.spec.bodyW
    let w = 12
    let h = 12
    let x = cx + this.facing * (bodyW * 0.5 + 8)
    let y = cy
    if (atk.kind === 'swing') {
      // A forward box = the strike footprint (the grunt's jab/overhead, the charger's ground-pound).
      const sw = atk.swing ?? this.spec.swing
      w = sw.reach
      h = sw.halfHeight * 2
      x = cx + this.facing * (bodyW * 0.5 + sw.reach * 0.5)
      y = cy
    } else if (atk.kind === 'shoot') {
      // A thin long aim line along facing = the bolt's path (the shooter/spitter/flyer-spit).
      w = 220
      h = 6
      x = cx + this.facing * (bodyW * 0.5 + 110)
      y = cy
    } else if (atk.kind === 'dash') {
      // A long horizontal bar along `facing` = the lunge path (mirrors the boss's dash cue, which derives the
      // bar direction from the player each telegraph frame — Boss.ts:501). We use `facing` (NOT `dashDir`)
      // because `dashDir` is only latched at telegraph END in _fireStrike (line ~636), so DURING the wind-up
      // — the exact window this marker is shown — it still holds the PREVIOUS dash's dir (or the ctor default
      // 1), pointing the cue the wrong way (a charger's FIRST dash would always cue RIGHT). `facing` is set to
      // point at the player on the chase frame that committed the attack (line ~369) and is frozen through the
      // telegraph, and _fireStrike latches dashDir from the SAME player-relative test — so facing agrees with
      // where the dash will go and gives an accurate lunge-path cue throughout the wind-up (AC2/AC5).
      w = 300
      h = this.spec.bodyH * 0.8
      x = cx + this.facing * (bodyW * 0.5 + 150)
      y = cy
    } else if (atk.kind === 'swoop') {
      // A box at the latched swoop target = the impact point (the flyer's 2-D lunge destination). swoopVX/VY
      // are only set at telegraph END, so DURING the wind-up we aim the cue along facing toward the player.
      w = this.spec.bodyW + 16
      h = this.spec.bodyH + 16
      x = cx + this.facing * (bodyW * 0.5 + 60)
      y = cy
    }
    this.telegraphMarker.setSize(w, h)
    this.telegraphMarker.setPosition(x, y)
    // Blink at the SAME 16 Hz cadence as the body flash + the boss overlay (AC5).
    const blink = Math.floor(this.telegraphTimer * 16) % 2 === 0
    this.telegraphMarker.setAlpha(blink ? 0.45 : 0.2)
  }

  _kickScale(sx: number, sy: number) {
    this.scaleX = sx
    this.scaleY = sy
  }

  // ── _foldElite(spec, affix) → a NEW elite-folded spec (design §6.11, Decision 77, AC64; round-3 set) ──
  // bake the affix's HP/body/tint/speed/knockback modifiers into a fresh shallow-clone (NEVER mutating the
  // caller's spec — the aliasing safety scaleSpec keeps). telegraphMult + deathBurst + hpRegenPerSec are NOT
  // folded into the spec (they're read off this.elite by the attack/regen/death code), so the spec shape the
  // rest of Enemy reads is unchanged. cellDrop gains the affix bonus here so dropCells() rewards the kill —
  // DRY. Every affix field is optional (?? the neutral default) so an absent field leaves the base value —
  // a frost elite (no speedMult) keeps base speed, a fast elite (no knockbackTakeMult) keeps base knockback.
  _foldElite(spec: EnemySpec, affix: EliteAffixSpec): EnemySpec {
    const speedMult = affix.speedMult ?? 1
    return {
      ...spec,
      maxHp: Math.round(spec.maxHp * (affix.hpMult ?? 1)),
      bodyW: Math.round(spec.bodyW * (affix.bodyScale ?? 1)),
      bodyH: Math.round(spec.bodyH * (affix.bodyScale ?? 1)),
      color: affix.tint ?? spec.color, // the per-affix elite tell (over the archetype's resting fill).
      patrolSpeed: spec.patrolSpeed * speedMult, // a fast affix harasses (≥1 → quicker); identity at 1.
      chaseSpeed: spec.chaseSpeed * speedMult,
      knockbackTakeMult: affix.knockbackTakeMult ?? spec.knockbackTakeMult, // a frost elite is unbudgeable.
      cellDrop: (spec.cellDrop ?? 3) + (affix.cellBonus ?? 0), // a richer reward for the harder kill.
    }
  }

  // ── _fireDeathBurst() (design §6.11, Decision 77, AC64; Enrichment round 3 — the radial-fan fix) ── an
  // ELITE's signature: on death, fire a TRUE radial ring of pooled 'enemy' projectiles (the SAME pool +
  // overlap the SHOOTER/boss volley use — Decision 65, no new wiring) so the corpse is a "step back" tell.
  // Evenly spaced over 360°. Called from _die() at the captured death center (the body is already disabled,
  // so we pass the coords in). Null burst / null pool ⇒ no-op (safe). The projectile spec's damage is low
  // (a tell, not a one-shot). Each shot is fired with an `angle` aim so the ProjectilePool gives it a true
  // 2-D velocity (cos/sin·speed) — the ring now actually ARCS in every direction (the old code collapsed
  // each shot to ±facing horizontal, flattening the "360° fan" into a flat left/right line — the bug).
  _fireDeathBurst(cx: number, cy: number) {
    // F4 enemy-roster (Decision 5) — read a BASE-spec death burst (the KAMIKAZE's signature) OR the rolled
    // elite affix burst, base FIRST. A normal non-Kamikaze enemy with no explosive elite has neither ⇒ no-op
    // (the additive identity — only an elite roll bursts today, that path preserved). A Kamikaze that ALSO
    // rolls explosive fires ONLY its base burst (base wins via ?? — one burst, not two; KISS, intentional).
    const burst = this.spec.deathBurst ?? (this.elite && this.elite.deathBurst)
    if (!burst || !this.projectilePool || !burst.projectile) return
    const count = Math.max(1, burst.count || 1)
    const attacker = { cx, cy, facing: this.facing }
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 // even spacing around the full ring.
      this.projectilePool.acquire(attacker, burst.projectile, this.id, null, { angle })
    }
  }

  // Expose a plain attacker shape for damage.js (cx + facing — matches the pure resolveHit input).
  get attackerShape() {
    return { cx: this.body.center.x, facing: this.facing }
  }
}
