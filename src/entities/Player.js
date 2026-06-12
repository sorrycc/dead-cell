import Phaser from 'phaser'

// ── Player controller (design §6.1, Decisions 10/11/12/13/14, AC11–AC18) ──
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
const IFRAME_COLOR = 0xf4d03f // tint while invulnerable (yellow flash).

// Tiny state enum: DODGE is the ONLY state that overrides horizontal control. Everything
// else (idle / running / airborne) is the RUN state simply reading the body each frame.
const STATE = { RUN: 'run', DODGE: 'dodge' }

export class Player {
  // scene: the GameScene; (x, y): spawn position in world coords.
  constructor(scene, x, y) {
    this.scene = scene

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

    // Squash/stretch easing target. We track a current scaleY that eases toward 1 and is
    // KICKED by jump/land/dodge events; scaleX is derived to preserve apparent volume.
    this.scaleY = 1
    this.wasOnFloor = false // edge-detect landing (airborne → grounded) for the land squash.

    // A thin "front" marker so facing reads even when the body is symmetric (cosmetic only,
    // NOT a physics body). It's parented in world space and repositioned each frame.
    this.frontMarker = scene.add.rectangle(x, y, 6, BODY_H * 0.5, 0x2c3e50)
  }

  // Public for Phase 3 combat (Decision 14): true during the dodge i-frame window.
  isInvulnerable() {
    return this.iframeTimer > 0
  }

  // ── Per-frame tick. `dt` is SECONDS (GameScene converts delta/1000 + clamps MAX_DT). ──
  // Update order (design §6.1): (1) timers, (2) horizontal control (dodge override OR
  // run accel/friction), (3) resolve jump (buffer ∧ (grounded ∨ coyote) → launch;
  // release-cut), (4) fall-gravity juice + (Y cap is on the body), (5) facing, (6) visuals.
  // Arcade has ALREADY run the physics step + collisions before this, so body.blocked.* and
  // body.velocity are fresh.
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

    // ── Dodge START (edge) ── can begin from RUN when off cooldown. Direction = held moveX
    // if any, else current facing (roll the way you point). Gravity stays on during the roll
    // so you can dodge off ledges (Decision 14).
    if (
      input.dodgePressed &&
      this.state === STATE.RUN &&
      this.dodgeCooldownTimer <= 0
    ) {
      this.state = STATE.DODGE
      this.facing = input.moveX !== 0 ? Math.sign(input.moveX) : this.facing
      this.dodgeTimer = DODGE_DURATION
      this.iframeTimer = DODGE_IFRAMES
      this.dodgeCooldownTimer = DODGE_COOLDOWN // gate measured from start; outlasts duration.
      this._kickScaleY(DODGE_SQUASH_Y)
    }

    // ── (2) Horizontal control ──
    if (this.state === STATE.DODGE) {
      // Override normal control: HOLD the dash speed, ignore moveX. Exit when the timer ends.
      body.setVelocityX(this.facing * DODGE_SPEED)
      if (this.dodgeTimer <= 0) this.state = STATE.RUN
    } else {
      // RUN: integrate vx toward the target by accel, or decay toward 0 by friction. Ground
      // vs. air picks the accel/friction pair (weaker air control = weighty jumps).
      const accel = onFloor ? RUN_ACCEL : AIR_ACCEL
      const friction = onFloor ? RUN_FRICTION : AIR_FRICTION
      let vx = body.velocity.x
      if (input.moveX !== 0) {
        const target = input.moveX * RUN_SPEED
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
    // marker doesn't snap to a default. Body stays symmetric — facing is cosmetic + dodge dir.
    if (this.state !== STATE.DODGE && input.moveX !== 0) {
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

    // Tint flashes while invulnerable so the i-frame window is visible NOW (Phase 1 testable).
    this.rect.setFillStyle(this.isInvulnerable() ? IFRAME_COLOR : BASE_COLOR)

    // Facing cue: park the front marker on the leading edge of the body.
    this.frontMarker.x = this.body.center.x + this.facing * (BODY_W * 0.5 - 3)
    this.frontMarker.y = this.body.center.y
  }

  // Kick the squash/stretch toward a target scaleY (the easing pulls it back to 1).
  _kickScaleY(targetY) {
    this.scaleY = targetY
  }
}
