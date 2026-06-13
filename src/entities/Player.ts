import Phaser from 'phaser'
import { PLAYER_MAX_HP } from '../config/constants.js'
import { SWORD } from '../config/weapons.js'
import type { WeaponSpec } from '../config/weapons.js'
import type { SkillSpec } from '../config/skills.js'
import type { InputSnapshot } from '../core/Input.js'
import type { HitResult } from '../combat/damage.js'
import type { PlayerStats } from '../config/upgrades.js'
import type { HitboxPool } from '../combat/HitboxPool.js'
import type { ProjectilePool } from '../combat/ProjectilePool.js'
import type { Sound } from '../audio/Sound.js'

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

// ── Movement depth (movement-depth design §6, Decisions 2/3/4, AC1–AC6) — ADDITIVE REACH ONLY ──
// Double-jump + wall-slide + wall-jump bolt onto the UNCHANGED single-jump base. The cardinal rule:
// these moves only ever INCREASE reach — JUMP_VELOCITY/GRAVITY/FALL_GRAVITY_EXTRA/RUN_SPEED are
// untouched, so LevelGenerator's jump-reach envelope (keyed to the single full jump) and the verifier
// BFS stay sound with zero edits: every level remains beatable with the base jump alone, and the new
// moves are a strict SUPERSET of reachability (comfort + combat utility, never a gate).
const AIR_JUMPS_MAX = 1 // one mid-air jump (Decision 2 — matches Dead Cells' default; KISS, not N).
const WALL_SLIDE_SPEED = 140 // px/s — clamped descent while clinging a wall (≪ MAX_FALL_SPEED 1100).
const WALL_JUMP_VX = 360 // px/s — horizontal kick AWAY from the wall on a wall-jump (Decision 4).
const WALL_JUMP_LOCKOUT = 0.12 // s — ignore into-wall input this long after a wall-jump (no re-stick).

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
const WALL_SLIDE_COLOR = 0x5d6d7e // tint while wall-sliding (slate — a quiet "clinging" tell, AC2).

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
  scene: Phaser.Scene
  hitboxPool: HitboxPool | null
  projectilePool: ProjectilePool | null
  sound: Sound | null
  id: string
  meleeDamageMult: number
  rangedDamageMult: number
  scrollDamageMult: number
  dodgeCooldownMult: number
  dodgeIframeBonus: number
  scrollDodgeCdMult: number
  scrollDodgeIframeBonus: number
  lifestealFrac: number
  statusDurationMult: number
  onKillHealAmount: number
  lowHpDamageMult: number
  firstHitBonusMult: number
  weapons: (WeaponSpec | null)[]
  activeWeaponIndex: number
  secondSlotUnlocked: boolean
  skills: (SkillSpec | null)[]
  skillCooldown: number[]
  collider: Phaser.GameObjects.Rectangle
  body: Phaser.Physics.Arcade.Body
  rect: Phaser.GameObjects.Rectangle
  state: string
  facing: number
  coyoteTimer: number
  jumpBufferTimer: number
  airJumpsLeft: number
  wallDir: number
  wallJumpLockoutTimer: number
  dodgeTimer: number
  iframeTimer: number
  dodgeCooldownTimer: number
  hp: number
  maxHp: number
  dead: boolean
  onDeath: (() => void) | null
  comboIndex: number
  comboWindowTimer: number
  attackTimer: number
  attackColorTimer: number
  hurtTimer: number
  hurtIframeTimer: number
  _pendingAttack: boolean
  scaleY: number
  wasOnFloor: boolean
  frontMarker: Phaser.GameObjects.Rectangle

  // scene: the GameScene; (x, y): spawn position in world coords. hitboxPool: a HitboxPool tagged
  // 'player' whose MELEE swings draw from (null in a Phase-1 context). projectilePool: a
  // ProjectilePool the RANGED weapon fires from (§6.5; null = ranged shots are cosmetic-only).
  // sound: the procedural-SFX façade (audio §6.2, Decision 2) — OPTIONAL + null-safe (default null),
  // injected like the pools. Every call site below is `this.sound?.x()`, so a Player built WITHOUT a
  // sound (a Phase-1 / headless context) is byte-identical to before (the additive identity, AC8).
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    hitboxPool: HitboxPool | null = null,
    projectilePool: ProjectilePool | null = null,
    sound: Sound | null = null,
  ) {
    this.scene = scene
    this.hitboxPool = hitboxPool
    this.projectilePool = projectilePool // §6.5 Decision 62 — ranged weapon fires from this.
    this.sound = sound // audio §6.2 — the SFX façade (null-safe; a null sound is a silent no-op).
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
    // ── Run-only MUTATION perks (build-&-replay design §6.3, AC3) ── the few NEW live-read fields a mutation
    // arms, mirrored from RunState by GameScene._syncPlayerScrollStats. All default to the neutral identity
    // (0 / 1×) so a fresh Player with no mutation plays EXACTLY as before. Read at ONE site each in GameScene:
    // onKillHealAmount in the enemy.onDeath hook; lowHp/firstHit folds at the resolveHit site.
    this.onKillHealAmount = 0 // flat HP healed on each enemy kill (Predator).
    this.lowHpDamageMult = 1 // ×damage while below the low-HP threshold (Berserker).
    this.firstHitBonusMult = 1 // ×damage vs a FULL-HP enemy (Assassin — the opener bonus).
    // ── TWO weapon SLOTS (Enrichment round 3, item 3 — the build-identity lever) ── the run carries up to
    // TWO weapons (a primary + a secondary) and a SWAP key toggles which is active, so a run can hold
    // melee+ranged or two movesets — turning a loot pickup into a BUILD decision (carry the new weapon in
    // the free slot vs replace the active one). `weapons[activeWeaponIndex]` IS the active weapon (the
    // `equippedWeapon` getter below reads it, so every existing hit-site read is unchanged). The SECOND slot
    // is LOCKED until a meta upgrade unlocks it (secondSlotUnlocked) — until then the player is single-slot,
    // EXACTLY the Phase-4/round-2 behaviour (the additive identity: weapons[1] stays null, swap is a no-op).
    this.weapons = [SWORD, null] // [primary, secondary]; null = an empty/locked slot.
    this.activeWeaponIndex = 0 // which slot drives attacks (0 = primary; toggled by swapWeapon).
    this.secondSlotUnlocked = false // a meta upgrade flips this on (applyStartStats); else single-slot.

    // ── TWO SKILL SLOTS (skills/secondary-items design §6.2, AC2) ── the loadout layer orthogonal to the
    // weapon combo: up to TWO cooldown-gated abilities (volley/blast/turret), triggered by two keys (F/C),
    // each with its OWN cooldown timer. Both slots start EMPTY (free, no meta gate — KISS) so a fresh run
    // is byte-identical to before: an empty slot OR a slot on cooldown is a no-op (tryUseSkill returns null),
    // so the two keys do NOTHING until a skill is acquired (the additive identity, AC8). The Player only
    // ARMS the cooldown + returns the spec to fire — GameScene owns the pools/world (same discipline as
    // attack() → GameScene._startSwing spawns the effect). The cooldown timers decay by the gameplay dt in
    // update() alongside every other timer (so they freeze during hit-stop / the shop pause — Decision 4).
    this.skills = [null, null] // [slot 0 (F), slot 1 (C)]; null = an empty slot.
    this.skillCooldown = [0, 0] // s — per-slot cooldown remaining (0 = ready). Decayed by dt in update().

    // ── Physics collider (owns the body) + separate visual rect (review issue #6) ──
    // `collider` owns the Arcade body and is INVISIBLE (alpha 0). Arcade owns its position;
    // we never scale or hand-move it, so the body never drifts. Its size/offset is FIXED here.
    this.collider = scene.add.rectangle(x, y, BODY_W, BODY_H, BASE_COLOR).setAlpha(0)
    scene.physics.add.existing(this.collider)
    /** @type {Phaser.Physics.Arcade.Body} */
    this.body = this.collider.body as Phaser.Physics.Arcade.Body
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
    // ── Movement-depth state (movement-depth §6, Decisions 2/3/4) ── ADDITIVE on top of the base jump.
    // airJumpsLeft: how many mid-air jumps remain (refilled to AIR_JUMPS_MAX on ground/coyote AND on a
    // wall-jump, consumed by an air-jump). wallDir: which wall the player is into THIS frame (−1 left /
    // +1 right / 0 none), recomputed every frame from body.blocked + held moveX. wallJumpLockoutTimer:
    // > 0 briefly after a wall-jump → into-wall input is ignored so the player arcs away (no re-stick).
    // Seeded to the airborne/no-wall identity so a fresh Player that never uses the moves is unchanged.
    this.airJumpsLeft = 0 // refilled on the first grounded frame (step 1) — starts spent (no free air jump).
    this.wallDir = 0 // 0 = not clinging a wall this frame.
    this.wallJumpLockoutTimer = 0 // > 0 → ignore into-wall input (post-wall-jump re-stick guard).
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
  heal(amount: number) {
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
  onHit(result: HitResult) {
    if (!this.isHittable()) return
    // audio §6.2 (AC2) — the hurt blip. Played only on a NON-fatal hit; a fatal hit plays the death
    // knell instead (GameScene._onPlayerDeath), so the two don't stack on the killing blow.
    if (this.hp - result.damage > 0) this.sound?.hurt()
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
  update(dt: number, input: InputSnapshot) {
    const body = this.body
    const onFloor = body.blocked.down || body.touching.down

    // ── (1) Timers ──
    // Coyote: refresh on the floor, decay in the air. This lets a jump fire a few frames
    // AFTER leaving a ledge even though blocked.down is already false.
    if (onFloor) {
      this.coyoteTimer = COYOTE_TIME
      // Movement-depth (AC1): refill the air jump(s) on the ground. Landing resets the double-jump.
      // Set here (the grounded edge) — NOT on coyote — so walking off a ledge does NOT consume the
      // air jump (coyote keeps the GROUND jump available; the air jump is the SEPARATE second leap).
      this.airJumpsLeft = AIR_JUMPS_MAX
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt)
    }
    // Movement-depth (AC3): the post-wall-jump re-stick lockout decays by dt (SECONDS) like every timer.
    this.wallJumpLockoutTimer = Math.max(0, this.wallJumpLockoutTimer - dt)
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
    // ── Skill cooldown decay (skills design §6.2, Decision 4, AC2) ── both per-slot timers decay by the
    // GAMEPLAY dt (so a cooldown FREEZES during hit-stop / the shop pause exactly like every other timer).
    // GameScene reads these → the registry for the HUD cooldown indicator. An empty slot leaves its timer 0.
    this.skillCooldown[0] = Math.max(0, this.skillCooldown[0] - dt)
    this.skillCooldown[1] = Math.max(0, this.skillCooldown[1] - dt)

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
      this.sound?.dodge() // audio §6.2 (AC3) — the roll whoosh (null-safe).
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

    // ── (2.5) Wall state (movement-depth §6, Decisions 3/4, AC2) — computed AFTER horizontal control
    // so it reads the fresh blocked.* from this frame's collisions, and BEFORE jump resolution so the
    // wall-jump branch (step 3) can consume `wallDir`. ──
    // wallDir is which side wall the player is PRESSING INTO this frame (−1 = left wall, +1 = right
    // wall, 0 = none). It requires: airborne (no clinging while grounded), NOT in the post-wall-jump
    // re-stick lockout, and the HELD moveX pointing into a side where the body is blocked. We use
    // body.blocked[side] (a solid-side contact) — thin one-way horizontal ledges collide from ABOVE
    // only, so they never set blocked.left/right → no false clings on ledges (geometry caveat §4).
    // DODGE/HURT own vx for their windows, so suppress wall-cling during them (the dash/knockback must
    // not get clamped to a slow slide); precedence stays DODGE > ATTACK > RUN (Decision 5).
    const intoLeft = input.moveX < 0 && body.blocked.left
    const intoRight = input.moveX > 0 && body.blocked.right
    const wallActive = !onFloor && this.wallJumpLockoutTimer <= 0 && this.state !== STATE.DODGE && this.hurtTimer <= 0
    this.wallDir = wallActive ? (intoLeft ? -1 : intoRight ? 1 : 0) : 0
    // Wall-slide (AC2): while clinging and DESCENDING (vy>0), clamp the fall to the slow slide speed
    // (≪ terminal). Reading the post-control vy means the fall-gravity (step 4) re-accelerates next
    // frame and we re-clamp — a steady slow slide. Releasing the into-wall input or landing ends it.
    const sliding = this.wallDir !== 0 && body.velocity.y > 0
    if (sliding) {
      if (body.velocity.y > WALL_SLIDE_SPEED) body.setVelocityY(WALL_SLIDE_SPEED)
      // AC2 audio tell: called every sliding frame; the façade's per-key throttle (a wide gap) collapses
      // it into a soft recurring friction scrape (null-safe — a silent no-op under NoAudio / a null sound).
      this.sound?.wallSlide()
    }

    // ── (3) Resolve jump ── (movement-depth §6, Decisions 2/4 — extended with wall-jump + air-jump).
    // CONSUME ON LAUNCH (review issue #3): when a buffered GROUND jump fires we ZERO both the buffer
    // AND the coyote timer so neither can re-fire a second jump on the next frame (the single
    // most common bug in this controller). The dodge does not block jumping out of a roll —
    // but a GROUND jump only fires when grounded-or-coyote, which a roll-off-ledge naturally allows.
    // A buffered jump now resolves in PRIORITY (Decision 4): (a) ground/coyote → (b) wall-jump →
    // (c) air-jump. Exactly ONE branch fires per buffered press (the buffer is zeroed on launch), and
    // the variable-height release-cut below applies uniformly to all three (so the second/wall leap
    // is tap-shortenable too — AC1/AC3). All three are ADDITIVE: they only ever add reach on top of
    // the base ground jump, which is identical to before (AC6); the generator/verifier are untouched.
    const canJump = this.coyoteTimer > 0 || onFloor
    if (this.jumpBufferTimer > 0 && canJump) {
      // (a) GROUND / coyote jump (UNCHANGED, AC4/AC6) — the base arc that LevelGenerator's reach
      // envelope is keyed to. Consumes the buffer + coyote.
      body.setVelocityY(-JUMP_VELOCITY)
      this.jumpBufferTimer = 0
      this.coyoteTimer = 0
      this._kickScaleY(JUMP_STRETCH_Y)
      this.sound?.jump() // audio §6.2 (AC3) — the jump chirp (null-safe).
    } else if (this.jumpBufferTimer > 0 && this.wallDir !== 0) {
      // (b) WALL-JUMP (AC3): launch UP and AWAY from the wall, REFRESH the air jump (so wall-jump →
      // air-jump chains), and arm the re-stick lockout so the held into-wall input doesn't immediately
      // re-cling — the player arcs away instead. vx is kicked away from the wall (−wallDir·VX), vy is
      // the full jump impulse. Consumes the buffer (one launch per press).
      body.setVelocityY(-JUMP_VELOCITY)
      body.setVelocityX(-this.wallDir * WALL_JUMP_VX)
      this.jumpBufferTimer = 0
      this.airJumpsLeft = AIR_JUMPS_MAX // refresh (AC3) — a fresh air jump after the wall kick.
      this.wallJumpLockoutTimer = WALL_JUMP_LOCKOUT // no re-stick during the arc-away (AC3).
      this.wallDir = 0 // we just left the wall — clear it so step 6 reads "not sliding" this frame.
      this._kickScaleY(JUMP_STRETCH_Y)
      this.sound?.wallJump() // audio (AC4) — the wall kick-off (null-safe; silent under NoAudio).
    } else if (this.jumpBufferTimer > 0 && this.airJumpsLeft > 0 && this.coyoteTimer <= 0) {
      // (c) AIR-JUMP / double-jump (AC1): a mid-air jump when airborne (coyote already lapsed so this
      // is NOT a missed ground jump), one per airtime. Consumes the buffer + one air jump. Coyote is
      // already 0 here, so it can't ALSO fire branch (a); the guard `coyoteTimer<=0` makes that explicit.
      body.setVelocityY(-JUMP_VELOCITY)
      this.jumpBufferTimer = 0
      this.airJumpsLeft--
      this._kickScaleY(JUMP_STRETCH_Y)
      this.sound?.doubleJump() // audio (AC4) — the brighter second-leap chirp (null-safe).
    }
    // Variable height: releasing jump while still RISING cuts the upward speed to a small
    // value → tap = short hop, hold = full jump (Decision 12). vy<0 is "rising" in Phaser
    // (y grows downward). UNCHANGED (AC4) and applies to all three launches above (AC1/AC3).
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
    if (onFloor && !this.wasOnFloor) {
      this._kickScaleY(LAND_SQUASH_Y)
      this.sound?.land() // audio §6.2 (AC3) — the touchdown thud (null-safe).
    }
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
    // (blue) > wall-slide (slate) > base. The hurt-iframe flash is DISTINCT from the dodge tint
    // (design §6.3) so a hit reads differently from a dodge. The wall-slide tell (movement-depth AC2)
    // sits LOWEST of the tints so combat/dodge states always win — it only shows during an actual
    // cling (wallDir set + descending), giving a clear visual that you're sliding (programmer-art:
    // a slate tint, no sprite/particle asset). Recomputed from the LIVE wallDir so a wall-jump (which
    // zeroed wallDir in step 3) reads "not sliding" the same frame it kicks off.
    const slidingNow = this.wallDir !== 0 && body.velocity.y > 0
    let tint = BASE_COLOR
    if (this.hurtIframeTimer > 0) tint = HURT_COLOR
    else if (this.isInvulnerable()) tint = IFRAME_COLOR
    else if (this.attackColorTimer > 0) tint = ATTACK_COLOR
    else if (slidingNow) tint = WALL_SLIDE_COLOR
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
      this.sound?.shoot() // audio §6.2 (AC3) — the bow twang (null-safe; fires even on a null pool).
      // RANGED (Decision 62): fire a pooled projectile along facing per the weapon's projectile spec.
      // Its hit is resolved by GameScene's projectile-specific overlap (its own attacker shape = the
      // SHOT's position + dir — NOT the player's, review MAJOR). The pool may be null (cosmetic-only).
      if (this.projectilePool && weapon.projectile) {
        // Stamp the weapon's status (§6.13, Decision 79 — the bow's poison) on the shot so the hit handler
        // applies it to the struck enemy. null for a no-status weapon → no effect (the identity).
        this.projectilePool.acquire(attacker, weapon.projectile, this.id, weapon.status)
      }
    } else {
      this.sound?.swing(weapon.id) // audio §6.2 (AC3) — the melee whoosh, timbre per weapon (null-safe).
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
  applyStartStats(startStats: PlayerStats, weapons: Record<string, WeaponSpec>) {
    this.maxHp = startStats.maxHp
    this.hp = startStats.maxHp // a fresh run starts at the upgraded FULL HP.
    this.meleeDamageMult = startStats.meleeDamageMult
    // §6.9 (Decision 73) — the deeper-meta fields. Defaulted (?? neutral) so a pre-§6.9 startStats object
    // (e.g. a bare fold) stays valid; a fresh meta leaves every value at its neutral base (the identity).
    this.rangedDamageMult = startStats.rangedDamageMult ?? 1
    this.dodgeCooldownMult = startStats.dodgeCooldownMult
    this.dodgeIframeBonus = startStats.dodgeIframeBonus ?? 0
    // ── Second weapon slot (round-3 item 3) ── a meta upgrade UNLOCKS the secondary slot (default false →
    // single-slot, the identity). The slot starts EMPTY (null) — the player fills it by picking up a 2nd
    // weapon (a build decision: carry the new weapon vs replace the active one). When unlocked, the FIRST
    // found weapon goes into the empty secondary slot rather than replacing the primary (GameScene).
    this.secondSlotUnlocked = (startStats.weaponSlots ?? 1) >= 2
    const w = weapons[startStats.startWeaponId] || SWORD
    // Equip the starting weapon to the PRIMARY slot (slot 0) + reset the secondary to empty (a fresh run).
    this.activeWeaponIndex = 0
    this.weapons = [w, null]
    this.comboIndex = -1
    this.comboWindowTimer = 0
    // ── Reset the skill loadout (skills design §6.2, AC2/AC8) ── both slots EMPTY + cooldowns 0 (the run-start
    // identity: no meta gate this slice — slots start free + empty, so a fresh run's skill keys do nothing).
    // GameScene re-equips the carried RunState.skillId1/skillId2 AFTER this on a level rebuild (Decision 7/AC4).
    this.skills = [null, null]
    this.skillCooldown = [0, 0]
  }

  // ── equippedWeapon (getter) (Decision 61; round-3 item 3 — slot-backed) ── the ACTIVE weapon = the
  // weapon in the active slot. A getter so EVERY existing read site (the hit handlers, the front-marker,
  // _weaponLabel) is unchanged — they still read player.equippedWeapon, which now resolves to the active
  // slot. Defensive: a degenerate null slot falls back to the sword (never reads undefined.swings).
  get equippedWeapon() {
    return this.weapons[this.activeWeaponIndex] || SWORD
  }

  // ── equipWeapon(weapon) (Decision 61/63; round-3 item 3 — equips to the ACTIVE slot) ── swap the active
  // slot's weapon. Resets the combo so the NEW moveset starts clean at swing 0 (and so a stale index can
  // never index a shorter table — e.g. swapping sword(3)→hammer(2) while comboIndex was 2 would otherwise
  // read undefined). CANCELS any in-progress swing (release the live melee hitbox + clear the lock + return
  // to RUN) so a mid-swing swap — collecting a weapon pickup while attacking — takes effect immediately and
  // leaves no dangling hitbox or stale swing-end read. (A live projectile from a previous bow shot keeps
  // flying — only the pending MELEE swing is cancelled.) Writes the ACTIVE slot so single-slot behaviour
  // (the second slot locked) is byte-identical to before — slot 0 is the only slot in play.
  equipWeapon(weapon: WeaponSpec) {
    this.equipToSlot(weapon, this.activeWeaponIndex)
  }

  // ── equipToSlot(weapon, slotIndex) (round-3 item 3) ── put `weapon` into a specific slot. If it's the
  // ACTIVE slot, reset the combo + cancel a live swing (the same discipline as equipWeapon). Filling the
  // INACTIVE slot leaves the active weapon + combo untouched (you just gained a spare moveset to swap to).
  equipToSlot(weapon: WeaponSpec, slotIndex: number) {
    this.weapons[slotIndex] = weapon
    if (slotIndex === this.activeWeaponIndex) {
      if (this.state === STATE.ATTACK) {
        if (this.hitboxPool) this.hitboxPool.releaseAll()
        this.state = STATE.RUN
        this.attackTimer = 0
      }
      this.comboIndex = -1
      this.comboWindowTimer = 0
    }
  }

  // ── swapWeapon() (round-3 item 3 — the SWAP key) ── toggle the active slot to the OTHER slot. A no-op
  // unless the second slot is UNLOCKED (a meta upgrade) AND actually HOLDS a weapon (you've found/started
  // with a second one) — so on a single-slot run (the identity) the swap key does nothing. Resets the combo
  // + cancels any live swing (the NEW moveset starts clean at swing 0). Returns true iff a swap happened
  // (the scene pops a tell only on a real swap). DRY: it reuses the active-slot equip discipline via the
  // combo reset below (a swap IS an active-weapon change).
  swapWeapon() {
    if (!this.secondSlotUnlocked) return false
    const other = this.activeWeaponIndex === 0 ? 1 : 0
    if (!this.weapons[other]) return false // the other slot is empty — nothing to swap to.
    if (this.state === STATE.ATTACK) {
      if (this.hitboxPool) this.hitboxPool.releaseAll()
      this.state = STATE.RUN
      this.attackTimer = 0
    }
    this.activeWeaponIndex = other
    this.comboIndex = -1
    this.comboWindowTimer = 0
    return true
  }

  // ── equipSkill(spec, slot) (skills design §6.2, AC2/AC5) ── put `spec` into a skill slot (0 = F, 1 = C)
  // and RESET that slot's cooldown to 0 (a freshly equipped skill is immediately usable). The pickup/shop/
  // branch paths call this (GameScene resolves which slot — fill the first empty, else replace slot 0). A
  // slot index out of range is a defensive no-op (never throws). The Player does NOT fire the skill — that's
  // GameScene's job (same discipline as equipWeapon → the scene drives the world).
  equipSkill(spec: SkillSpec, slot: number) {
    if (slot < 0 || slot >= this.skills.length) return
    this.skills[slot] = spec
    this.skillCooldown[slot] = 0
  }

  // ── tryUseSkill(slot) → SkillSpec | null (skills design §6.2/§6.3, Decision 4, AC2) ── the cooldown gate:
  // returns the spec to FIRE if the slot is FILLED and OFF cooldown (and ARMS the cooldown for spec.cooldown
  // seconds), else null. A slot that is empty OR on cooldown is a no-op (returns null → GameScene fires
  // nothing — no double-fire, no crash). The IDENTITY: with both slots empty (a fresh run) this always
  // returns null, so the two skill keys do nothing (a skill-less run is byte-identical, AC8). GameScene
  // owns spawning the effect; the Player only owns the slot/cooldown bookkeeping (SOLID — same split as
  // attack() latches intent and update()/_startSwing resolve it).
  tryUseSkill(slot: number): SkillSpec | null {
    if (slot < 0 || slot >= this.skills.length) return null
    const spec = this.skills[slot]
    if (!spec) return null // empty slot → no-op (the identity case).
    if (this.skillCooldown[slot] > 0) return null // still on cooldown → no-op (no double-fire).
    this.skillCooldown[slot] = spec.cooldown // arm the cooldown; the caller fires the effect.
    return spec
  }

  // Expose a plain attacker shape for damage.js (cx + facing — the pure resolveHit input).
  get attackerShape() {
    return { cx: this.body.center.x, facing: this.facing }
  }

  // Kick the squash/stretch toward a target scaleY (the easing pulls it back to 1).
  _kickScaleY(targetY: number) {
    this.scaleY = targetY
  }
}
