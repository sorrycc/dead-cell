import Phaser from 'phaser'
import { PLAYER_MAX_HP } from '../config/constants.js'
import { SWORD } from '../config/weapons.js'

// ── Player controller (design §6.1 + §6.3, Decisions 10/11/12/13/14 + 18/25/31/32, AC11–AC18 + AC20/AC23) ──
// A plain class (Decision 10) that HOLDS a Phaser.GameObjects.Rectangle + its Arcade body
// and owns ALL feel constants + the tiny RUN|DODGE state machine. GameScene news it up and
// ticks it each frame — same shape as crowd-runner's plain entities (Crowd/Obstacle) the
// loop ticks. Keeping the controller off the display-list lifecycle makes the feel logic
// readable in one place (SOLID).
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// dt UNITS (review BLOCKER #1) — read this before touching any formula below.
// Phaser passes `delta` (MILLISECONDS) to scene.update(time, delta). EVERY feel formula in
// this file — accel·dt, friction·dt, timer decays, gravity nudges, the 1−exp(−k·dt) easing —
// is written in SECONDS. GameScene is therefore REQUIRED to convert at the boundary:
//     player.update(delta / 1000, input)   // and clamp to MAX_DT (see GameScene)
// `update(dt, input)` below ALWAYS treats `dt` as SECONDS. If you wire raw `delta` straight
// from Phaser, every accel/decay/timer is off by 1000× — do not do it.
//
// GRAVITY INTEGRATION MODEL (review BLOCKER #2) — pinned, no ambiguity:
//   • Arcade world gravity STAYS ON (GameScene sets world.gravity.y = GRAVITY). Arcade
//     integrates it into `vy` every physics step. We do NOT hand-integrate vertical motion.
//   • HORIZONTAL: we integrate vx ourselves (accel/friction, Decision 11) and push it with
//     body.setVelocityX(vx) each frame. Arcade does not touch vx (no horizontal gravity).
//   • FALL SNAPPINESS: implemented as EXTRA per-body gravity, NOT by adding to vy in update
//     (that would double-count against Arcade's own gravity step). We call
//     body.setGravityY(FALL_GRAVITY_EXTRA) while descending and body.setGravityY(0)
//     otherwise. Arcade sums world.gravity + body.gravity, so this is a clean single source.
//   • TERMINAL FALL: body.setMaxVelocity(MAX_VX, MAX_FALL_SPEED) — the X/Y form is used
//     DELIBERATELY so the Y cap (terminal velocity) never clamps the horizontal dash/run.
//     MAX_VX is set generously above DODGE_SPEED so the dash is never throttled.
//
// SQUASH/STRETCH SCOPE (review issue #6): the physics body and the squash/stretch VISUAL are
// two SEPARATE GameObjects:
//   • `this.collider` — the rectangle that OWNS the Arcade body. Arcade owns ITS position
//     (it writes the resolved x/y back to it in postUpdate); we never scale it and never
//     reposition it by hand. Its body size/offset is FIXED at construction. It is invisible
//     (alpha 0) — purely the physics source of truth.
//   • `this.rect` — a separate visible rectangle we scale (squash/stretch) and position to the
//     collider's body each frame. Scaling/moving THIS never touches the body.
// This matters because Arcade derives the body position from the owning GameObject's
// transform: `position = transform.{x,y} + scale·(offset − displayOrigin)` (Body.js
// updateFromGameObject). If we scaled the body-owning object the body would drift; if we hand-
// set its x/y each frame we'd fight Arcade's own write-back → jitter. Decoupling kills both.
// The one-way predicate reads the COLLIDER's body (player.body.bottom), never the scaled rect.

// ── Run (Decision 11) — accel/friction integration, framerate-independent ──
const RUN_SPEED = 320 // px/s — top horizontal run speed (the vx target magnitude).
const RUN_ACCEL = 2600 // px/s² — ground accel toward ±RUN_SPEED (ramps, not snaps).
const RUN_FRICTION = 2600 // px/s² — ground decel toward 0 when no direction held.
const AIR_ACCEL = 1400 // px/s² — weaker mid-air control so direction changes feel weighty.
const AIR_FRICTION = 700 // px/s² — light air drag (keep momentum across a jump arc).

// ── Gravity + fall (Decision 12 juice) ──
const MAX_FALL_SPEED = 1100 // px/s — terminal velocity (Y cap) so long falls stay readable.
const FALL_GRAVITY_EXTRA = 900 // px/s² — extra gravity while descending (snappy "fast-fall").
const MAX_VX = 4000 // px/s — generous X velocity cap (> DODGE_SPEED), never throttles dash.

// ── Variable-height jump (Decision 12) — launch full, cut on early release ──
const JUMP_VELOCITY = 620 // px/s — initial upward speed on a full jump (vy = −this).
const JUMP_CUT_VELOCITY = 180 // px/s — releasing while rising clamps rise to this (short hop).

// ── Forgiveness timers (Decision 13) — both decay by dt (SECONDS) ──
const COYOTE_TIME = 0.1 // s — jump still fires this long after walking off a ledge.
const JUMP_BUFFER_TIME = 0.12 // s — a jump pressed this long before landing fires on touchdown.

// ── Dodge-roll (Decision 14) — dash + i-frames + cooldown ──
const DODGE_SPEED = 560 // px/s — horizontal dash impulse magnitude.
const DODGE_DURATION = 0.22 // s — how long the DODGE state holds the dash (overrides control).
const DODGE_IFRAMES = 0.18 // s — invulnerability window (≤ duration); isInvulnerable() reads it.
const DODGE_COOLDOWN = 0.45 // s — gate before dodge can fire again (after the roll ends).

// ── Squash / stretch / tint (juice — primitives only) ──
const BODY_W = 36 // px — FIXED Arcade body width (set once; never per-frame).
const BODY_H = 52 // px — FIXED Arcade body height.
const SQUASH_EASE_K = 18 // 1/s — easing rate back to rest scale via 1−exp(−k·dt).
const JUMP_STRETCH_Y = 1.28 // scaleY on jump-launch (tall + thin reads "up").
const LAND_SQUASH_Y = 0.7 // scaleY impulse on landing (short + wide reads "impact").
const DODGE_SQUASH_Y = 0.6 // scaleY while dodging (flat + long reads "roll").
const BASE_COLOR = 0x58d68d // resting fill (green).
const IFRAME_COLOR = 0xf4d03f // tint while invulnerable (dodge — yellow flash).
const HURT_COLOR = 0xe74c3c // tint while hurt-iframed (red flash — distinct from dodge yellow).
const ATTACK_COLOR = 0xaed6f1 // brief swing color pop (light blue) so the swing reads.

// ── Combat (design §6.3, Decisions 18/25/31/32, AC20/AC23) ──
// player hit points (shown on the HUD). Imported from constants.js (the PURE cross-site owner) so
// core/RunState.js shares the EXACT number without importing Phaser-coupled Player (Decision 44).
const MAX_HP = PLAYER_MAX_HP
const ATTACK_MOVE_SCALE = 0.45 // accel + top-speed scale while attacking (committed but mobile).
const HURT_KNOCKBACK_LOCKOUT = 0.16 // s — how long onHit's knockback overrides control (Decision 32).
const HURT_IFRAME = 0.6 // s — invulnerability after taking a hit (no second hit during it, AC23).

// Tiny state enum: DODGE and ATTACK override normal horizontal control; HURT is a brief knockback
// lockout overlaid on whichever state you were in. RUN is the default (idle / running / airborne is
// just RUN reading the body each frame). Precedence (Decision 25): DODGE > ATTACK > RUN.
const STATE = { RUN: 'run', DODGE: 'dodge', ATTACK: 'attack' }

export class Player {
  // scene: the GameScene; (x, y): spawn position in world coords. hitboxPool: a HitboxPool tagged
  // 'player' whose MELEE swings draw from (null in a Phase-1 context). projectilePool: a
  // ProjectilePool the RANGED weapon fires from (§6.5; null = ranged shots are cosmetic-only).
  constructor(scene, x, y, hitboxPool = null, projectilePool = null) {
    this.scene = scene
    this.hitboxPool = hitboxPool
    this.projectilePool = projectilePool // §6.5 Decision 62 — ranged weapon fires from this.
    this.id = 'player' // stable id for the per-swing hitSet dedup + ownerId tag (Decision 20).

    // ── Injected run-start modifiers (design §6.5, Decision 60, AC53) ── seeded to the IDENTITY here
    // (1× / default sword), so a fresh Player with no applyStartStats() call plays EXACTLY like Phase 4
    // (the additive identity). GameScene calls applyStartStats(startStats) at run start to fold in the
    // permanent META upgrades; run-only scrolls multiply scrollDamageMult LIVE (read at the hit site).
    this.meleeDamageMult = 1 // permanent meta melee-damage multiplier (Decision 60).
    this.rangedDamageMult = 1 // §6.9 (Decision 73) — permanent meta RANGED (bow) damage multiplier.
    this.scrollDamageMult = 1 // run-only scroll damage multiplier (read LIVE; never saved).
    this.dodgeCooldownMult = 1 // META factor on DODGE_COOLDOWN (≤1 → dodge sooner; Decision 60).
    this.dodgeIframeBonus = 0 // §6.9 (Decision 73) — META flat extra dodge i-frame seconds (0 = neutral).
    // ── Run-only scroll dodge/sustain/status fields (Enrichment round 3) ── kept SEPARATE from the meta
    // factors above so meta × scroll compose at the read site (no double-fold). All default to the neutral
    // identity (1× / 0) so a fresh run with no scroll plays exactly as before. Synced from RunState by
    // GameScene._syncPlayerScrollStats; lifesteal/status are read at the melee-hit site.
    this.scrollDodgeCdMult = 1 // run-only ×factor on the dodge cooldown (Alacrity scroll; stacks on the meta one).
    this.scrollDodgeIframeBonus = 0 // run-only flat extra dodge i-frame seconds (Alacrity scroll).
    this.lifestealFrac = 0 // fraction of MELEE damage dealt healed back (Vampirism scroll; read at the hit site).
    this.statusDurationMult = 1 // ×applied status duration (Venom scroll; read when arming a weapon's status).
    this.equippedWeapon = SWORD // the active weapon (its swings table + type drive attacks, Decision 61).

    // ── Physics collider (owns the body) + separate visual rect (review issue #6) ──
    // `collider` owns the Arcade body and is INVISIBLE (alpha 0). Arcade owns its position;
    // we never scale or hand-move it, so the body never drifts. Its size/offset is FIXED here.
    this.collider = scene.add.rectangle(x, y, BODY_W, BODY_H, BASE_COLOR).setAlpha(0)
    scene.physics.add.existing(this.collider)
    /** @type {Phaser.Physics.Arcade.Body} */
    this.body = this.collider.body
    this.body.setCollideWorldBounds(true)

    // The VISIBLE rectangle: same rest size, scaled (squash/stretch) + positioned to the body
    // each frame. Scaling/moving this never touches the body (decoupled per review issue #6).
    this.rect = scene.add.rectangle(x, y, BODY_W, BODY_H, BASE_COLOR)
    // X/Y maxVelocity form (review BLOCKER #2): cap terminal FALL on Y without ever
    // clamping the horizontal run/dash on X.
    this.body.setMaxVelocity(MAX_VX, MAX_FALL_SPEED)

    // ── Controller state ──
    this.state = STATE.RUN
    this.facing = 1 // +1 right, −1 left (drives dodge direction + the facing cue).

    // Timers (all in SECONDS, decayed by dt). 0 ⇒ inactive/expired.
    this.coyoteTimer = 0 // refreshed to COYOTE_TIME while grounded, decays airborne.
    this.jumpBufferTimer = 0 // set to JUMP_BUFFER_TIME on a press, decays.
    this.dodgeTimer = 0 // > 0 while the DODGE dash is active.
    this.iframeTimer = 0 // > 0 while invulnerable (subset of the dodge).
    this.dodgeCooldownTimer = 0 // > 0 while dodge is gated.

    // ── Combat state (design §6.3, Decisions 18/31/32) ── seeded to MAX_HP (the Phase-4 identity). A
    // +maxHP meta upgrade flows in via applyStartStats() at run start (Decision 60) — it raises BOTH
    // this.maxHp AND this.hp so a fresh run begins at the upgraded full HP. (review MAJOR: this is the
    // injection point for maxHp; GameScene also seeds RunState.maxHp/hp from the SAME startStats so the
    // carried HP reflects the upgrade — see GameScene.create / RunState.)
    this.hp = MAX_HP
    this.maxHp = MAX_HP
    this.dead = false // death edge guard (fires the scene callback exactly once, AC26).
    this.onDeath = null // scene-supplied callback fired once when hp reaches 0.
    // Combo: comboIndex is which swing (−1 = chain reset; next attack() pre-increments to 0).
    this.comboIndex = -1
    this.comboWindowTimer = 0 // decays ONLY while RUN && attackTimer<=0; 0 → chain resets (Decision 31).
    this.attackTimer = 0 // active+recovery lock; next attack() allowed only at ≤0.
    this.attackColorTimer = 0 // > 0 while the swing color pop shows (cosmetic, on the visual).
    // Hurt reaction (Decision 32): hurtTimer is the knockback lockout; hurtIframeTimer the i-frame.
    this.hurtTimer = 0 // > 0 while knockback overrides control (so it survives the vx write).
    this.hurtIframeTimer = 0 // > 0 while invulnerable after a hit.
    this._pendingAttack = false // set by attack() (scene calls it on the edge); consumed in update.

    // Squash/stretch easing target. We track a current scaleY that eases toward 1 and is
    // KICKED by jump/land/dodge events; scaleX is derived to preserve apparent volume.
    this.scaleY = 1
    this.wasOnFloor = false // edge-detect landing (airborne → grounded) for the land squash.

    // A thin "front" marker so facing reads even when the body is symmetric (cosmetic only,
    // NOT a physics body). It's parented in world space and repositioned each frame.
    this.frontMarker = scene.add.rectangle(x, y, 6, BODY_H * 0.5, 0x2c3e50)
  }

  // Public for combat (Decision 14): true during the DODGE i-frame window.
  isInvulnerable() {
    return this.iframeTimer > 0
  }

  // ── heal(amount) (design §6.9, Decision 72) ── restore HP up to maxHp; no-op if dead/full. Returns the
  // ACTUAL amount healed (0 if none) so the caller (flask/fountain/shop) can spend the charge only on a
  // real heal + pop the FX only when something happened. KISS — the single HP-up path (DRY).
  heal(amount) {
    if (this.dead || amount <= 0) return 0
    const before = this.hp
    this.hp = Math.min(this.maxHp, this.hp + amount)
    return this.hp - before
  }

  // ── Combat: can an incoming hit land? (design §6.3, Decisions 21/32, AC23) ──
  // False while EITHER the dodge i-frames (dodge-through is safe) OR the post-hit hurt i-frames are
  // active — incoming damage is blocked if either is true.
  isHittable() {
    return !this.dead && !this.isInvulnerable() && this.hurtIframeTimer <= 0
  }

  // ── Request an attack (the scene calls this on the attack edge). ──
  // It only LATCHES intent (`_pendingAttack`); update() resolves it in step (1.5) so the control-
  // flow order is deterministic (dodge-start can pre-empt it that same frame — Decision 25). We do
  // NOT spawn the hitbox here so a hit-stop's frozen frame can't double-fire it.
  attack() {
    this._pendingAttack = true
  }

  // ── Take a hit (design §6.3, Decisions 21/32, AC23). `result` from combat/damage.js resolveHit. ──
  // Ignored if not hittable (dodge/hurt i-frames). Otherwise: subtract HP, set the knockback velocity
  // directly AND arm `hurtTimer` (the lockout that lets the knockback survive update()'s per-frame vx
  // write — Decision 32), arm the hurt i-frame, flash red, and fire the death edge ONCE at hp≤0.
  onHit(result) {
    if (!this.isHittable()) return
    this.hp = Math.max(0, this.hp - result.damage)
    this.body.setVelocity(result.knockbackX, result.knockbackY)
    this.hurtTimer = HURT_KNOCKBACK_LOCKOUT
    this.hurtIframeTimer = HURT_IFRAME
    // Getting hit cancels an in-progress attack (interrupt) — release the live swing + clear timers.
    if (this.state === STATE.ATTACK) {
      if (this.hitboxPool) this.hitboxPool.releaseAll()
      this.state = STATE.RUN
      this.attackTimer = 0
    }
    this._kickScaleY(0.7) // a quick squash on impact.
    if (this.hp <= 0 && !this.dead) {
      this.dead = true
      if (this.onDeath) this.onDeath() // scene fires the placeholder death handoff (AC26).
    }
  }

  // ── Per-frame tick. `dt` is the GAMEPLAY dt in SECONDS (GameScene converts delta/1000, clamps
  // MAX_DT, and drives it to 0 during a hit-stop — Decisions 24/26, so combo/attack/hurt timers
  // freeze with the world). ──
  // Update order (design §6.1 + §6.3 Decision 25): (1) timers + combat-timer decay + ATTACK→RUN
  // exit + combo-window decay/reset, dodge-start edge (cancels a live attack); (1.5) resolve the
  // pending attack() edge (start a swing if allowed); (2) horizontal control
  // (DODGE dash · HURT knockback-carry · ATTACK scaled-run · RUN); (3) resolve jump (NOT cancelled
  // by attacking); (4) fall-gravity juice; (5) facing; (6) visuals. Arcade has ALREADY run the
  // physics step + collisions, so body.blocked.* / body.velocity are fresh.
  update(dt, input) {
    const body = this.body
    const onFloor = body.blocked.down || body.touching.down

    // ── (1) Timers ──
    // Coyote: refresh on the floor, decay in the air. This lets a jump fire a few frames
    // AFTER leaving a ledge even though blocked.down is already false.
    if (onFloor) {
      this.coyoteTimer = COYOTE_TIME
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt)
    }
    // Jump buffer: arm on press, decay otherwise — lets a press a few frames BEFORE landing
    // fire on touchdown.
    if (input.jumpPressed) this.jumpBufferTimer = JUMP_BUFFER_TIME
    else this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt)
    // Dodge / i-frame / cooldown timers all decay by dt.
    this.dodgeTimer = Math.max(0, this.dodgeTimer - dt)
    this.iframeTimer = Math.max(0, this.iframeTimer - dt)
    this.dodgeCooldownTimer = Math.max(0, this.dodgeCooldownTimer - dt)
    // Hurt-reaction timers (Decision 32): the knockback lockout + the post-hit i-frame.
    this.hurtTimer = Math.max(0, this.hurtTimer - dt)
    this.hurtIframeTimer = Math.max(0, this.hurtIframeTimer - dt)
    this.attackColorTimer = Math.max(0, this.attackColorTimer - dt)

    // ── Attack lock + SYMMETRIC ATTACK→RUN exit (Decision 25). Decrement the active+recovery lock;
    // when a swing ends, return to RUN and OPEN the combo window so a follow-up press chains
    // (Decision 31 — the window is set HERE, at swing end). ──
    if (this.attackTimer > 0) {
      this.attackTimer = Math.max(0, this.attackTimer - dt)
      if (this.attackTimer <= 0 && this.state === STATE.ATTACK) {
        this.state = STATE.RUN
        // Read the EQUIPPED weapon's swing table (Decision 61) — not the module SWINGS (which would be
        // sword-only). comboIndex was set in _startSwing against the equipped table; GUARD for −1
        // defensively (a mid-swing equipWeapon() swap — collecting a weapon pickup while attacking —
        // resets comboIndex, so without this guard swings[−1] would throw). If reset, the chain simply
        // closes (no follow-up window) — the new weapon's combo starts fresh on the next press.
        const row = this.comboIndex >= 0 ? this.equippedWeapon.swings[this.comboIndex] : null
        this.comboWindowTimer = row ? row.comboWindow : 0
        // A swing whose comboWindow is 0 (the FINISHER, or a reset) ends the chain immediately: reset
        // the index now so there is no lingering state (Decision 31). Non-zero windows decay below.
        if (this.comboWindowTimer <= 0) this.comboIndex = -1
      }
    }
    // ── Combo window (Decision 31) — decays ONLY after recovery (RUN && attackTimer<=0); when it
    // lapses the chain resets so the next attack() starts at swing 0. During an active swing it does
    // NOT decay. This (+ the finisher reset above) is the ONLY place comboIndex resets → AC20's
    // "lapse resets to swing 1" is deterministic. ──
    if (this.state === STATE.RUN && this.attackTimer <= 0 && this.comboWindowTimer > 0) {
      this.comboWindowTimer = Math.max(0, this.comboWindowTimer - dt)
      if (this.comboWindowTimer <= 0) this.comboIndex = -1
    }

    // ── Dodge START (edge) ── relaxed guard `state !== DODGE` (Decision 25) so a dodge is honored
    // DURING attack recovery (defensive option always available; precedence DODGE > ATTACK > RUN).
    // Starting a dodge CANCELS any in-progress attack (release the live hitbox, clear timers) so the
    // two states never overlap. Direction = held moveX if any, else facing (roll the way you point).
    if (
      input.dodgePressed &&
      this.state !== STATE.DODGE &&
      this.dodgeCooldownTimer <= 0
    ) {
      if (this.state === STATE.ATTACK) {
        if (this.hitboxPool) this.hitboxPool.releaseAll()
        this.attackTimer = 0
        this.comboWindowTimer = 0
      }
      this.state = STATE.DODGE
      this.facing = input.moveX !== 0 ? Math.sign(input.moveX) : this.facing
      this.dodgeTimer = DODGE_DURATION
      // The dodge i-frame window = the base window + the META bonus (Decision 73) + the run-only scroll
      // bonus (Alacrity, round 3). Both default to 0 so a fresh run leaves it at the Phase-1 base; together
      // they widen the safe window (a more forgiving roll).
      this.iframeTimer = DODGE_IFRAMES + this.dodgeIframeBonus + this.scrollDodgeIframeBonus
      // Gate measured from start; outlasts duration. The cooldown folds the META factor (Decision 60) ×
      // the run-only scroll factor (Alacrity) — both ≤1 → dodge sooner. Identity at 1×1 (the Phase-4 value).
      this.dodgeCooldownTimer = DODGE_COOLDOWN * this.dodgeCooldownMult * this.scrollDodgeCdMult
      this._kickScaleY(DODGE_SQUASH_Y)
    }

    // ── (1.5) Resolve the pending attack() edge (Decision 25). Fires only if NOT dodging (a
    // dodge-start above pre-empts it this frame) and the active+recovery lock is clear. ──
    if (this._pendingAttack) {
      this._pendingAttack = false
      if (this.state !== STATE.DODGE && this.attackTimer <= 0) this._startSwing()
    }

    // ── (2) Horizontal control ──
    if (this.state === STATE.DODGE) {
      // Override normal control: HOLD the dash speed, ignore moveX. Exit when the timer ends.
      body.setVelocityX(this.facing * DODGE_SPEED)
      if (this.dodgeTimer <= 0) this.state = STATE.RUN
    } else if (this.hurtTimer > 0) {
      // HURT lockout (Decision 32): leave vx ALONE so onHit's knockback carries (the per-frame vx
      // write would otherwise overwrite it after one frame). Gravity still applies. Mirrors DODGE.
      // (No setVelocityX call here — the body keeps the knockback velocity.)
    } else {
      // RUN (or ATTACK with reduced mobility): integrate vx toward the target by accel, or decay
      // toward 0 by friction. ATTACK scales accel + top-speed (committed but mobile, Decision 18).
      const moveScale = this.state === STATE.ATTACK ? ATTACK_MOVE_SCALE : 1
      const accel = (onFloor ? RUN_ACCEL : AIR_ACCEL) * moveScale
      const friction = onFloor ? RUN_FRICTION : AIR_FRICTION
      const topSpeed = RUN_SPEED * moveScale
      let vx = body.velocity.x
      if (input.moveX !== 0) {
        const target = input.moveX * topSpeed
        // Move vx toward target by accel·dt, never overshooting the target.
        if (vx < target) vx = Math.min(target, vx + accel * dt)
        else if (vx > target) vx = Math.max(target, vx - accel * dt)
      } else {
        // No input → decay toward 0 by friction·dt (don't cross zero).
        if (vx > 0) vx = Math.max(0, vx - friction * dt)
        else if (vx < 0) vx = Math.min(0, vx + friction * dt)
      }
      body.setVelocityX(vx)
    }

    // ── (3) Resolve jump ──
    // CONSUME ON LAUNCH (review issue #3): when a buffered jump fires we ZERO both the buffer
    // AND the coyote timer so neither can re-fire a second jump on the next frame (the single
    // most common bug in this controller). The dodge does not block jumping out of a roll —
    // but a jump only fires when grounded-or-coyote, which a roll-off-ledge naturally allows.
    const canJump = this.coyoteTimer > 0 || onFloor
    if (this.jumpBufferTimer > 0 && canJump) {
      body.setVelocityY(-JUMP_VELOCITY)
      this.jumpBufferTimer = 0
      this.coyoteTimer = 0
      this._kickScaleY(JUMP_STRETCH_Y)
    }
    // Variable height: releasing jump while still RISING cuts the upward speed to a small
    // value → tap = short hop, hold = full jump (Decision 12). vy<0 is "rising" in Phaser
    // (y grows downward).
    if (!input.jumpHeld && body.velocity.y < -JUMP_CUT_VELOCITY) {
      body.setVelocityY(-JUMP_CUT_VELOCITY)
    }

    // ── (4) Fall-gravity juice (review BLOCKER #2 model) ──
    // Add EXTRA body gravity only while descending (vy>0) for a snappy fall; reset to 0 while
    // rising/grounded. This stacks onto Arcade's world gravity via body.gravity — we never
    // touch vy directly here, so there's no double-integration. Terminal velocity is the Y
    // maxVelocity set in the constructor.
    body.setGravityY(body.velocity.y > 0 ? FALL_GRAVITY_EXTRA : 0)

    // ── (5) Facing ── follows horizontal intent (or dash dir); preserved when idle so the
    // marker doesn't snap to a default. Body stays symmetric — facing is cosmetic + dodge/swing dir.
    // Frozen during DODGE (dash dir is locked) and ATTACK (so the swing's facing stays consistent
    // for the whole swing — important for the backstab geometry, Decision 19) and HURT (knockback).
    if (
      this.state !== STATE.DODGE &&
      this.state !== STATE.ATTACK &&
      this.hurtTimer <= 0 &&
      input.moveX !== 0
    ) {
      this.facing = Math.sign(input.moveX)
    }

    // ── (6) Visuals: squash/stretch + tint (display object ONLY — never the body) ──
    // Landing edge: airborne last frame, grounded now → a land-squash impulse.
    if (onFloor && !this.wasOnFloor) this._kickScaleY(LAND_SQUASH_Y)
    this.wasOnFloor = onFloor

    // Ease scaleY back to rest (1) framerate-independently: lerp factor = 1−exp(−k·dt).
    const ease = 1 - Math.exp(-SQUASH_EASE_K * dt)
    this.scaleY += (1 - this.scaleY) * ease
    // Preserve apparent volume: scaleX is the inverse so tall⇒thin, squat⇒wide.
    const scaleX = 1 / this.scaleY
    this.rect.setScale(scaleX, this.scaleY)
    // Keep the FEET planted: the visual height is BODY_H·scaleY, so to align the visual's
    // bottom edge with the body's bottom (center.y + BODY_H/2) the visual center must rise by
    // half the height growth. Hence MINUS the delta (a taller rect ⇒ smaller y). Cosmetic —
    // the body's own origin is untouched.
    this.rect.y = this.body.center.y - (BODY_H * this.scaleY - BODY_H) * 0.5
    this.rect.x = this.body.center.x

    // Tint priority (most-urgent-first): HURT flash (red) > dodge i-frame (yellow) > swing pop
    // (blue) > base. The hurt-iframe flash is DISTINCT from the dodge tint (design §6.3) so a hit
    // reads differently from a dodge.
    let tint = BASE_COLOR
    if (this.hurtIframeTimer > 0) tint = HURT_COLOR
    else if (this.isInvulnerable()) tint = IFRAME_COLOR
    else if (this.attackColorTimer > 0) tint = ATTACK_COLOR
    this.rect.setFillStyle(tint)

    // Facing cue: park the front marker on the leading edge. During the swing's active window it
    // EXTENDS to the swing reach + pops color so the swing telegraph reads (primitives only — the
    // hitbox body itself stays invisible; this is a cosmetic stand-in). Reads the EQUIPPED weapon's
    // swing reach (Decision 61) — a ranged Bow's draw row has a small reach so the marker stays
    // well-formed (no stale sword geometry on Hammer/Bow — review MAJOR). comboIndex is valid during
    // an active swing (set in _startSwing); guard for −1 defensively (no active swing → the 6px stub).
    const swingActive = this.attackColorTimer > 0
    const activeSwing = swingActive && this.comboIndex >= 0 ? this.equippedWeapon.swings[this.comboIndex] : null
    const markerLen = activeSwing ? activeSwing.reach : 6
    this.frontMarker.width = markerLen
    this.frontMarker.setFillStyle(swingActive ? ATTACK_COLOR : 0x2c3e50)
    // Anchor the marker so it grows FORWARD from the body's leading edge along facing.
    this.frontMarker.x = this.body.center.x + this.facing * (BODY_W * 0.5 + markerLen * 0.5 - 3)
    this.frontMarker.y = this.body.center.y
  }

  // ── Start a swing (Decision 18/25/31/61/62, AC20/AC54). Advances the combo on the EQUIPPED weapon's
  // swing table, enters ATTACK, arms the active+recovery lock, applies the lunge nudge, then DISPATCHES
  // by weapon TYPE: melee → a pooled hitbox in front; ranged → a fired pooled projectile. ──
  _startSwing() {
    const weapon = this.equippedWeapon
    const swings = weapon.swings
    // Advance the chain on THIS weapon's table (Decision 61): wrap against ITS length (not the module
    // COMBO_LEN, which is sword-only). The comboWindow reset (Decision 31) sends comboIndex back to −1
    // when it lapses (and equipWeapon resets it on a swap), so a fresh chain always starts at swing 0.
    this.comboIndex = (this.comboIndex + 1) % swings.length
    const swing = swings[this.comboIndex]
    this.state = STATE.ATTACK
    this.attackTimer = swing.active + swing.recovery // the lock; reset to RUN at 0 (step 1).
    this.comboWindowTimer = 0 // window opens at swing END, not now (Decision 31).
    this.attackColorTimer = swing.active // cosmetic swing pop duration (the visual telegraph).

    // Forward lunge nudge (juice): a one-shot velocity bump along facing (0 for the bow's draw row).
    const body = this.body
    body.setVelocityX(body.velocity.x + this.facing * swing.lunge)
    this._kickScaleY(1.12) // a small stretch on the swing.

    const attacker = { cx: this.body.center.x, cy: this.body.center.y, facing: this.facing }
    if (weapon.type === 'ranged') {
      // RANGED (Decision 62): fire a pooled projectile along facing per the weapon's projectile spec.
      // Its hit is resolved by GameScene's projectile-specific overlap (its own attacker shape = the
      // SHOT's position + dir — NOT the player's, review MAJOR). The pool may be null (cosmetic-only).
      if (this.projectilePool && weapon.projectile) {
        // Stamp the weapon's status (§6.13, Decision 79 — the bow's poison) on the shot so the hit handler
        // applies it to the struck enemy. null for a no-status weapon → no effect (the identity).
        this.projectilePool.acquire(attacker, weapon.projectile, this.id, weapon.status)
      }
    } else {
      // MELEE (Decision 16/20): acquire the transient hitbox; it lives for swing.active then the pool
      // releases it; its per-swing hitSet dedups multi-hit. Null pool = cosmetic-only (Phase-1).
      if (this.hitboxPool) this.hitboxPool.acquire(attacker, swing, this.id)
    }
  }

  // ── applyStartStats(startStats) (design §6.5, Decision 60, AC53) ── fold the run-start stats (the
  // META upgrades applied to BASE_PLAYER_STATS) into the live Player at run start. Raises maxHp AND
  // refills hp to it (so a +maxHP upgrade starts the run at the upgraded full HP), sets the melee
  // multiplier + dodge-cooldown factor, and equips the starting weapon. IDENTITY-safe: BASE_PLAYER_STATS
  // (no upgrades) leaves every field at its Phase-4 value. GameScene also seeds RunState from the SAME
  // startStats so the carried HP matches (review MAJOR — the HP-carry/upgrade reconciliation).
  applyStartStats(startStats, weapons) {
    this.maxHp = startStats.maxHp
    this.hp = startStats.maxHp // a fresh run starts at the upgraded FULL HP.
    this.meleeDamageMult = startStats.meleeDamageMult
    // §6.9 (Decision 73) — the deeper-meta fields. Defaulted (?? neutral) so a pre-§6.9 startStats object
    // (e.g. a bare fold) stays valid; a fresh meta leaves every value at its neutral base (the identity).
    this.rangedDamageMult = startStats.rangedDamageMult ?? 1
    this.dodgeCooldownMult = startStats.dodgeCooldownMult
    this.dodgeIframeBonus = startStats.dodgeIframeBonus ?? 0
    const w = weapons[startStats.startWeaponId] || SWORD
    this.equipWeapon(w)
  }

  // ── equipWeapon(weapon) (Decision 61/63) ── swap the active weapon. Resets the combo so the NEW
  // moveset starts clean at swing 0 (and so a stale index can never index a shorter table — e.g.
  // swapping sword(3)→hammer(2) while comboIndex was 2 would otherwise read undefined). CANCELS any
  // in-progress swing (release the live melee hitbox + clear the lock + return to RUN) so a mid-swing
  // swap — collecting a weapon pickup while attacking — takes effect immediately and leaves no dangling
  // hitbox or stale swing-end read. (A live projectile from a previous bow shot keeps flying — it's
  // already independent of the equipped weapon; only the pending MELEE swing is cancelled.)
  equipWeapon(weapon) {
    if (this.state === STATE.ATTACK) {
      if (this.hitboxPool) this.hitboxPool.releaseAll()
      this.state = STATE.RUN
      this.attackTimer = 0
    }
    this.equippedWeapon = weapon
    this.comboIndex = -1
    this.comboWindowTimer = 0
  }

  // Expose a plain attacker shape for damage.js (cx + facing — the pure resolveHit input).
  get attackerShape() {
    return { cx: this.body.center.x, facing: this.facing }
  }

  // Kick the squash/stretch toward a target scaleY (the easing pulls it back to 1).
  _kickScaleY(targetY) {
    this.scaleY = targetY
  }
}
