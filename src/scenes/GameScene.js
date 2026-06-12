import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, GRAVITY } from '../config/constants.js'
import { Input } from '../core/Input.js'
import { Player } from '../entities/Player.js'
import { Enemy, BRUTE_SPEC } from '../entities/Enemy.js'
import { HitboxPool } from '../combat/HitboxPool.js'
import { resolveHit } from '../combat/damage.js'
import { Effects } from '../effects/Effects.js'

// ── GameScene (design §6.1 + §6.3, AC11–AC18 + AC20–AC26) ──
// The only scene with an Arcade physics world. It builds a hand-made TEST ROOM (floor, walls,
// raised ledges, a ONE-WAY platform, a gap) and exercises the platformer feel (Phase 1) PLUS the
// Combat phase (§6.3): a player melee combo (pooled transient hitboxes), a base Enemy with an FSM
// (the Brute) wired live into the room, a unified damage pipeline (resolveHit → onHit), pooled
// hit FX (sparks + numbers + shake + hit-stop), and a placeholder death handoff. No generation
// yet — that's Phase 2.
//
// ROOM is wider than the 1280-wide viewport so the camera follow is observable. The world +
// camera bounds are widened from the Phase 0 design rect to this room width.
//
// HIT-STOP dt BOUNDARY (Decision 24/26, review BLOCKER #2): this scene owns the hit-stop timer.
// update() computes a REAL dt (delta/1000, clamped), decays the hit-stop on real dt, and feeds a
// GAMEPLAY dt (`gdt = hitstop>0 ? 0 : dt`) to Player/Enemies/HitboxPools so the WHOLE combat world
// freezes together during the micro-freeze (the live swing's per-swing hitSet stops any re-hit).
// Effects (sparks/numbers) tick on REAL dt so the impact "pops" while the world is frozen.

// ── Room geometry (world coords; FIXED, never window dimensions) ──
const ROOM_W = DESIGN_WIDTH * 2 // 2560 — wider than the viewport so follow is visible.
const ROOM_H = DESIGN_HEIGHT // single screen tall.
const WALL_T = 40 // wall / floor thickness (px).
const FLOOR_Y = ROOM_H - 60 // y-center of the floor band.
// A gap (pit) in the floor: the floor is built as two spans with this hole between them.
const GAP_X0 = 1180
const GAP_X1 = 1380

// ── Camera follow (design §6.1) — deadzone + lerp ──
// The deadzone is a centered box the player moves within before the camera scrolls (kills
// micro-jitter from run accel). Lerp (<1) eases the camera toward the target each frame
// (Phaser applies it framerate-aware). Clamped by the camera bounds → never shows outside.
const DEADZONE_W = 360
const DEADZONE_H = 240
const LERP_X = 0.12
const LERP_Y = 0.12

// ── dt clamp (review BLOCKER #1) ──
// Phaser hands scene.update `delta` in MILLISECONDS; the Player feel math is in SECONDS, so
// we convert at this boundary (delta/1000). We also CLAMP to MAX_DT so a tab-refocus spike
// (a multi-second delta after the page was backgrounded) can't teleport the player through
// walls or fire a spiral-of-death — crowd-runner's loop clamps for the same reason.
const MAX_DT = 1 / 30 // s — cap a single step at ~33ms (worst-case ~30fps slice).

// ── Hit-stop cap (Decision 24) ── the micro-freeze is capped tiny so it reads as impact, not lag.
const HITSTOP_CAP = 0.09 // s — max freeze regardless of how many hits request one in a frame.

// ── Enemy contact-damage (design §6.3, AC23/AC24) ── a flat tick on a short cooldown so standing
// inside an enemy doesn't shred HP every frame (separate from the enemy's telegraphed strike).
const CONTACT_KNOCKBACK = 280 // px/s — horizontal shove from a contact hit.

export class GameScene extends Phaser.Scene {
  constructor() {
    super('Game')
  }

  create() {
    // ── World + camera bounds (Decision 8) ── widened to the room (still FIXED, resize-safe).
    this.physics.world.setBounds(0, 0, ROOM_W, ROOM_H)
    this.cameras.main.setBounds(0, 0, ROOM_W, ROOM_H)

    // ── Per-scene gravity (Decision 9; BLOCKER #2 model) ──
    // Arcade world gravity stays ON here; the Player integrates ONLY vx by hand and adds a
    // fall-gravity nudge via body.gravity — it never hand-integrates vy (no double-count).
    this.physics.world.gravity.y = GRAVITY

    // ── Static solids: floor (two spans + a gap), walls, raised ledges ──
    // A STATIC group: each member is a drawn rectangle promoted to a static Arcade body.
    // Static bodies don't move and aren't affected by gravity (Decision 15 colliders below).
    this.solids = this.physics.add.staticGroup()

    // Floor span A (left of the gap) and span B (right of the gap) — leaves a pit between.
    this._addSolid(GAP_X0 / 2, FLOOR_Y, GAP_X0, WALL_T) // left span: 0 → GAP_X0
    this._addSolid((GAP_X1 + ROOM_W) / 2, FLOOR_Y, ROOM_W - GAP_X1, WALL_T) // right span

    // Left + right walls so the player can't leave the room (world bounds also catch it).
    this._addSolid(WALL_T / 2, ROOM_H / 2, WALL_T, ROOM_H)
    this._addSolid(ROOM_W - WALL_T / 2, ROOM_H / 2, WALL_T, ROOM_H)

    // Two raised solid ledges at different heights — jump between them; walk off their edges
    // to feel coyote time + variable jump.
    this._addSolid(560, FLOOR_Y - 170, 260, 28) // lower ledge
    this._addSolid(900, FLOOR_Y - 320, 260, 28) // higher ledge

    // ── One-way (semi-solid) platform (Decision 15, AC16) ──
    // A normal collider gated by a processCallback: collide ONLY when the player is above and
    // descending onto it → jump UP through, land ON top. Drawn distinct (amber) so it reads.
    this.oneWay = this.add.rectangle(1700, FLOOR_Y - 220, 300, 22, 0xb9770e)
    this.physics.add.existing(this.oneWay, true)

    // ── Effects + hit-stop (design §6.3, Decisions 23/24/26) ──
    // The scene OWNS the hit-stop timer (it gates the gameplay dt the whole world reads). Effects
    // only REQUESTS a freeze via the callback below, which caps it + de-dupes it (no stacking).
    this.hitstopTimer = 0 // seconds, REAL time; gameplay dt is forced to 0 while > 0.
    this.gameOver = false // scene-level death guard (with player.dead) so the handoff fires once.
    this.effects = new Effects(this, (secs) => {
      // Cap + no-stacking: take the longer of the current remaining freeze and the request, capped.
      this.hitstopTimer = Math.min(HITSTOP_CAP, Math.max(this.hitstopTimer, secs))
    })

    // ── Combat pools (Decision 16/28/30): one player-hitbox pool + one enemy-hitbox pool, both
    // Phaser-coupled HitboxPools. Each exposes a `.group` the overlaps register against. ──
    this.playerHitboxes = new HitboxPool(this, 'player')
    this.enemyHitboxes = new HitboxPool(this, 'enemy')

    // ── Player ── spawned above the left floor span; its swings draw from playerHitboxes.
    this.input2 = new Input(this) // input layer owns the bindings; sampled once per frame.
    this.player = new Player(this, 200, FLOOR_Y - 200, this.playerHitboxes)
    // Death edge (AC26): a placeholder handoff — a short freeze/flash then back to Title. Guarded
    // so it fires EXACTLY ONCE (player.dead + this.gameOver).
    this.player.onDeath = () => this._onPlayerDeath()

    // ── Enemies ── a hurtbox GROUP (their collider bodies) the player's swings overlap. Spawn ONE
    // Brute (Decision 22) on the LEFT floor span with patrol bounds that PRE-EXCLUDE the pit
    // (Decision 29 — entirely left of GAP_X0), so neither patrol nor chase can walk it into the pit.
    this.enemyHurtboxes = this.physics.add.group({ allowGravity: true })
    this.enemies = []
    this._spawnEnemy(820, FLOOR_Y - 100, BRUTE_SPEC, { patrolMinX: 120, patrolMaxX: GAP_X0 - 120 })

    // ── Colliders ── against the player's COLLIDER (the body owner), NOT the scaled visual
    // rect (review issue #6). Arcade resolves these BEFORE scene.update, so body.blocked.* is
    // fresh when Player.update reads it.
    this.physics.add.collider(this.player.collider, this.solids)
    // Enemies stand on the SAME solids (Decision 29) so they share floors/ledges with the player.
    this.physics.add.collider(this.enemyHurtboxes, this.solids)

    // One-way collider with a processCallback (Decision 15). NOTES on the predicate:
    //   • ARGUMENT ORDER (review issue #7): we pass (player.rect, oneWay) so arg1 is ALWAYS
    //     the player and arg2 the platform. Arcade calls processCallback(obj1, obj2) in the
    //     SAME order the pair was registered, so `player`/`platform` below read the right
    //     bodies regardless of internal tree order.
    //   • EPSILON (review issue #7a): tied to one step of max fall so a fast faller whose
    //     bottom dipped slightly below the platform top within a frame still grabs it instead
    //     of tunnelling. MAX_FALL_SPEED · MAX_DT bounds that per-step penetration.
    //   • STANDING (review issue #7b): while resting on top, vy≈0 and player.bottom≈top, so
    //     the predicate keeps returning true — that's CORRECT (it keeps you supported), not a
    //     bug to "fix".
    const ONE_WAY_EPS = 1100 * MAX_DT // MAX_FALL_SPEED · MAX_DT ≈ max per-step penetration.
    this.physics.add.collider(
      this.player.collider,
      this.oneWay,
      null,
      (player, platform) => {
        const pBody = player.body
        const platTop = platform.body.top
        // Collide only when moving down (or resting) AND the player's feet are at/above the
        // platform top (within epsilon). Returning false skips separation → pass up through.
        return pBody.velocity.y >= 0 && pBody.bottom <= platTop + ONE_WAY_EPS
      },
      this,
    )

    // ── Combat overlaps (design §6.3, Decisions 16/20/30, AC20–AC24) ── all on COLLIDER bodies.
    //   1) PLAYER swing vs ENEMY hurtboxes — the processFilter dedups per-swing (Decision 20) and
    //      skips dead/i-framed enemies; the callback resolves damage + applies onHit + fires FX.
    //   2) ENEMY strike vs PLAYER hurtbox — the filter respects player.isHittable() (dodge/hurt
    //      i-frames negate it, AC23); enemy crit is OFF for fairness (Decision 19).
    //   3) ENEMY contact vs PLAYER — a flat damage tick on a per-enemy cooldown (AC24).
    this.physics.add.overlap(
      this.playerHitboxes.group,
      this.enemyHurtboxes,
      (hitboxRect, enemyRect) => this._onPlayerHitEnemy(hitboxRect, enemyRect),
      (hitboxRect, enemyRect) => this._dedupFilter(hitboxRect, enemyRect),
      this,
    )
    this.physics.add.overlap(
      this.enemyHitboxes.group,
      this.player.collider,
      (hitboxRect) => this._onEnemyHitPlayer(hitboxRect),
      (hitboxRect) => hitboxRect.hb.active && this.player.isHittable(),
      this,
    )
    this.physics.add.overlap(
      this.player.collider,
      this.enemyHurtboxes,
      (_playerRect, enemyRect) => this._onEnemyContact(enemyRect),
      (_playerRect, enemyRect) => {
        const e = enemyRect.enemyRef
        return e && !e.dead && e.contactCooldownTimer <= 0 && this.player.isHittable()
      },
      this,
    )

    // ── Camera follow (deadzone + lerp) ── follows the COLLIDER (stable physics position),
    // not the squash-offset visual rect, so squash/stretch never jitters the camera. Clamped
    // by the bounds set above so it never scrolls past the room edges.
    const cam = this.cameras.main
    cam.startFollow(this.player.collider, true, LERP_X, LERP_Y)
    cam.setDeadzone(DEADZONE_W, DEADZONE_H)

    // Dev hint label (camera-fixed): lists the control scheme (jump is Space-only; J is attack).
    this.add
      .text(
        16,
        16,
        'MOVE arrows/WASD   JUMP Space   ATTACK J/click   DODGE Shift/K   [ESC] Title',
        { fontFamily: 'monospace', fontSize: '18px', color: '#8b949e' },
      )
      .setScrollFactor(0)

    // ── Parallel HUD overlay (Decision 2) + teardown (Phase 0 carry-over) ──
    if (!this.scene.isActive('HUD')) this.scene.launch('HUD')
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scene.stop('HUD'))

    // ESC → Title (dev). On a .once event so it NEVER shares the JustDown path the Input layer
    // owns for jump/dodge (review issue #5) — JustDown is read once, only inside Input.sample.
    this.input.keyboard.once('keydown-ESC', () => this.scene.start('Title'))
  }

  // Helper: a drawn rectangle promoted to a STATIC Arcade body, added to the solids group so
  // a single collider covers them all (DRY). x/y are the CENTER (Phaser rect origin).
  _addSolid(x, y, w, h) {
    const rect = this.add.rectangle(x, y, w, h, 0x3a4658)
    this.solids.add(rect) // staticGroup.add promotes it to a static body automatically.
    return rect
  }

  // Spawn an Enemy: build it (its strike draws from the shared enemyHitboxes pool, Decision 30),
  // register its collider body as a hurtbox the player's swings + contact overlap, and track it.
  _spawnEnemy(x, y, spec, patrolBounds) {
    const enemy = new Enemy(this, x, y, spec, this.enemyHitboxes, patrolBounds)
    this.enemyHurtboxes.add(enemy.collider) // its body is the hurtbox/contact source.
    this.enemies.push(enemy)
    return enemy
  }

  // ── Combat overlap callbacks (design §6.3) ──

  // processFilter for player-swing vs enemy-hurtbox: reject a victim already hit by THIS swing
  // (per-swing dedup, Decision 20) or one that isn't currently hittable (dead / i-framed).
  _dedupFilter(hitboxRect, enemyRect) {
    const hb = hitboxRect.hb
    const enemy = enemyRect.enemyRef
    if (!hb.active || !enemy || !enemy.isHittable()) return false
    return !hb.hitSet.has(enemy.id) // true ⇒ allow the overlap callback to run.
  }

  // Player swing connects: resolve damage (pure), record the dedup, apply onHit, fire FX (AC21/22/25).
  _onPlayerHitEnemy(hitboxRect, enemyRect) {
    const hb = hitboxRect.hb
    const enemy = enemyRect.enemyRef
    if (!hb.active || !enemy || !enemy.isHittable() || hb.hitSet.has(enemy.id)) return
    hb.hitSet.add(enemy.id) // dedup: this swing can't hit this enemy again (Decision 20).
    // Player→enemy: backstab crit ON (reward flanking, Decision 19).
    const result = resolveHit(this.player.attackerShape, enemy.attackerShape, hb.swing, {
      allowBackstab: true,
    })
    enemy.onHit(result)
    this.effects.hit(enemy.body.center.x, enemy.body.center.y, {
      damage: result.damage,
      isBackstab: result.isBackstab,
    })
  }

  // Enemy strike connects on the player: resolve (crit OFF for fairness, Decision 19), onHit, FX.
  _onEnemyHitPlayer(hitboxRect) {
    const hb = hitboxRect.hb
    if (!hb.active || !this.player.isHittable()) return
    if (hb.hitSet.has(this.player.id)) return
    hb.hitSet.add(this.player.id) // a strike hits the player at most once (Decision 20).
    const enemy = this.enemies.find((e) => e.id === hb.ownerId)
    const attacker = enemy ? enemy.attackerShape : { cx: this.player.body.center.x - this.player.facing, facing: -this.player.facing }
    const result = resolveHit(attacker, this.player.attackerShape, hb.swing, { allowBackstab: false })
    this.player.onHit(result)
    this.effects.hit(this.player.body.center.x, this.player.body.center.y, { damage: result.damage })
  }

  // Enemy CONTACT (touching) damages the player on the enemy's own cooldown (Decision 30, AC24).
  _onEnemyContact(enemyRect) {
    const enemy = enemyRect.enemyRef
    if (!enemy || enemy.dead || enemy.contactCooldownTimer > 0 || !this.player.isHittable()) return
    enemy.contactCooldownTimer = enemy.spec.contactCooldown
    // Build a one-off swing-shaped object from the enemy's contact damage (reuses resolveHit; DRY).
    const contactSwing = { damage: enemy.spec.contactDamage, knockback: CONTACT_KNOCKBACK }
    const result = resolveHit(enemy.attackerShape, this.player.attackerShape, contactSwing, {
      allowBackstab: false,
    })
    this.player.onHit(result)
    this.effects.hit(this.player.body.center.x, this.player.body.center.y, { damage: result.damage })
  }

  // ── Player death handoff (AC26) ── a PLACEHOLDER: a short freeze/flash then back to Title. The
  // real GameOver / permadeath wiring is a later phase. Guarded (player.dead + this.gameOver) so
  // it fires EXACTLY ONCE — no double-fire, no soft-lock.
  _onPlayerDeath() {
    if (this.gameOver) return
    this.gameOver = true
    this.hitstopTimer = 0.25 // a brief world-freeze on death (the "crunch" of dying).
    this.cameras.main.flash(180, 200, 40, 40) // red flash.
    this.cameras.main.shake(220, 0.01)
    this.time.delayedCall(700, () => this.scene.start('Title')) // delayedCall is fine here —
    // it is NOT a gameplay timer (no dt/framerate dependence on the freeze); it just schedules the
    // one-shot scene transition after the death flash reads.
  }

  // Push HP (+ combo) to the registry for the decoupled HUD (Decision 2). Called each frame; the
  // HUD reads it. Cheap, and keeps gameplay/UI separated.
  _emitHud() {
    this.registry.set('playerHp', this.player.hp)
    this.registry.set('playerMaxHp', this.player.maxHp)
    this.registry.set('comboIndex', this.player.comboIndex)
  }

  // ── Per-frame tick ──
  // Phaser calls update(time, delta) with `delta` in MILLISECONDS (review BLOCKER #1). We convert
  // to SECONDS + clamp to MAX_DT for the REAL dt, then derive the GAMEPLAY dt (`gdt`) by zeroing it
  // during a hit-stop (Decision 24/26). Player/Enemies/HitboxPools tick on `gdt` (the whole combat
  // world freezes together); Effects ticks on the REAL dt (the impact pops while frozen). Input is
  // sampled EXACTLY ONCE here (review issue #5) on real dt so buffered presses survive the freeze.
  update(_time, delta) {
    const dt = Math.min(delta / 1000, MAX_DT)
    // Decay the hit-stop on REAL time so the freeze lasts exactly N ms regardless of framerate.
    this.hitstopTimer = Math.max(0, this.hitstopTimer - dt)
    const gdt = this.hitstopTimer > 0 ? 0 : dt // gameplay dt: 0 while frozen.

    const inputState = this.input2.sample()
    // If the death handoff is in progress, freeze gameplay input (no control after death) but keep
    // ticking FX so the death pop/flash plays out.
    if (!this.gameOver) {
      this.player.update(gdt, inputState)
      for (const enemy of this.enemies) enemy.update(gdt, { player: this.player, effects: this.effects })
    }

    // Advance the transient hitboxes on the GAMEPLAY dt (Decision 26 — a frozen swing stays put;
    // its hitSet stops any re-hit). Release happens inside tick().
    this.playerHitboxes.tick(gdt)
    this.enemyHitboxes.tick(gdt)

    // Reap despawned enemies (their _despawn() destroyed the GameObjects; drop them from the list).
    if (this.enemies.some((e) => e.removed)) {
      this.enemies = this.enemies.filter((e) => !e.removed)
    }

    // FX on REAL dt; HUD emit each frame.
    this.effects.tick(dt)
    this._emitHud()
  }
}
