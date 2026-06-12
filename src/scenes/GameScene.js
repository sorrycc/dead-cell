import Phaser from 'phaser'
import { GRAVITY } from '../config/constants.js'
import { Input } from '../core/Input.js'
import { Player } from '../entities/Player.js'
import { Enemy, BRUTE_SPEC } from '../entities/Enemy.js'
import { Door } from '../entities/Door.js'
import { HitboxPool } from '../combat/HitboxPool.js'
import { resolveHit } from '../combat/damage.js'
import { Effects } from '../effects/Effects.js'
import { generateLevel, TILE_SIZE } from '../world/LevelGenerator.js'
import { TileMap } from '../world/TileMap.js'
import { PRISON } from '../config/biomes.js'

// ── GameScene (design §6.1 + §6.2 + §6.3, AC11–AC18 + AC19/AC27–AC30 + AC20–AC26) ──
// The only scene with an Arcade physics world. As of the Procedural-levels phase (§6.2) the
// hand-built test room is GONE: create() builds a DETERMINISTICALLY GENERATED level via
// generateLevel(seed, biome) → TileMap (merged static bodies + primitive tiles), spawns the Player
// at the generated entrance, spawns enemies/pickups at the generated points, and places a Door at
// the generated exit. Reaching the Door RE-GENERATES the next level in place (Decision 40) — proving
// the run can advance from one generated level to the next. The Combat phase (§6.3) is unchanged:
// pooled melee hitboxes, the Brute FSM, the damage pipeline, pooled FX + hit-stop, the death edge.
//
// HIT-STOP dt BOUNDARY (Decision 24/26): update() computes a REAL dt (delta/1000, clamped MAX_DT),
// decays the hit-stop on real dt, and feeds a GAMEPLAY dt (gdt = hitstop>0 ? 0 : dt) to
// Player/Enemies/HitboxPools so the whole combat world freezes together during the micro-freeze.
// Effects (sparks/numbers) tick on REAL dt so the impact pops while the world is frozen.
//
// LEVEL→LEVEL REBUILD (Decision 40, review MAJOR): the Door overlap fires EVERY frame the bodies
// overlap, and _nextLevel() destroys the current tileMap/enemies/door. Two pins make that safe:
//   • A one-shot `this.transitioning` flag gates _nextLevel so a multi-frame overlap can't fire it
//     twice (it's cleared only after the rebuild completes).
//   • The teardown+rebuild is DEFERRED to the next tick via time.delayedCall(0) — NOT run inside the
//     overlap callback — because destroying a collider's body while Arcade is iterating its colliders
//     list (world.step) is a classic footgun. By the time the deferred call runs, world.step is done.
// INVARIANT the generator guarantees (so the player can't instantly overlap the NEW door on the
// rebuild frame): the new entrance is at the far LEFT of the staircase and the new exit at the far
// RIGHT — they are always many tiles apart (the walk spans 40+ cols), so re-spawning the player at
// the entrance never overlaps the freshly-placed exit Door.

// ── Camera follow (design §6.1) — deadzone + lerp ──
const DEADZONE_W = 360
const DEADZONE_H = 240
const LERP_X = 0.12
const LERP_Y = 0.12

// ── dt clamp (review BLOCKER #1) ── Phaser hands `delta` in MILLISECONDS; the feel math is in
// SECONDS (delta/1000). Clamp to MAX_DT so a tab-refocus spike can't teleport the player through
// walls or fire a spiral-of-death.
const MAX_DT = 1 / 30 // s — cap a single step at ~33ms.

// ── One-way epsilon (review MINOR — keep the derivation, no magic number) ── max per-step
// penetration of a fast faller = MAX_FALL_SPEED · MAX_DT. We mirror the Player's MAX_FALL_SPEED here
// (it is co-located in Player.js as a feel constant; this is the ONLY cross-site use). Re-deriving it
// (not hard-coding 1100·MAX_DT as a literal) keeps the meaning explicit if the fall speed is retuned.
const MAX_FALL_SPEED = 1100 // px/s — MIRRORS Player.js MAX_FALL_SPEED (the Y maxVelocity cap).
const ONE_WAY_EPS = MAX_FALL_SPEED * MAX_DT // ≈ max body penetration in one step → grab, don't tunnel.

// ── Hit-stop cap (Decision 24) ── the micro-freeze is capped tiny so it reads as impact, not lag.
const HITSTOP_CAP = 0.09 // s.

// ── Enemy contact-damage (design §6.3, AC23/AC24) ── horizontal shove on a contact hit.
const CONTACT_KNOCKBACK = 280 // px/s.

// ── Run seed (design §6.2, Decision 40) ── a fixed placeholder until RunState exists (a later
// phase). The next-level chain advances it deterministically so the sequence of levels is itself
// reproducible. Knuth multiplicative advance keeps successive seeds well-spread (varied layouts).
const START_SEED = 0xc0ffee
const nextSeed = (s) => (s * 2654435761 + 0x9e3779b9) >>> 0

// Pickup placeholder colors (the economy is Phase 5 — these are render-only markers this phase).
const PICKUP_COLORS = { cell: 0x4dd0e1, gold: 0xf1c40f }

export class GameScene extends Phaser.Scene {
  constructor() {
    super('Game')
  }

  create() {
    // ── Per-scene gravity (Decision 9; the BLOCKER #2 model) ──
    this.physics.world.gravity.y = GRAVITY

    // ── Biome + run seed (Decision 39/40) ── ONE biome ships now (PRISON); the seed chains levels.
    this.biome = PRISON
    this.seed = START_SEED

    // ── Effects + hit-stop (Decisions 23/24/26) ── the scene OWNS the hit-stop timer (it gates the
    // gameplay dt the whole world reads). Effects only REQUESTS a freeze via the callback (capped,
    // de-duped — no stacking). These PERSIST across level rebuilds (only the world rebuilds).
    this.hitstopTimer = 0
    this.gameOver = false
    this.transitioning = false // Decision 40 one-shot guard (see _nextLevel).
    this.effects = new Effects(this, (secs) => {
      this.hitstopTimer = Math.min(HITSTOP_CAP, Math.max(this.hitstopTimer, secs))
    })

    // ── Combat pools (Decisions 16/28/30) ── one player + one enemy HitboxPool. PERSIST across
    // rebuilds (the player keeps its pool; enemies share the enemy pool).
    this.playerHitboxes = new HitboxPool(this, 'player')
    this.enemyHitboxes = new HitboxPool(this, 'enemy')

    // ── Input + Player ── created ONCE; the Player is repositioned at each new entrance (it and its
    // pool persist; only the level geometry/enemies/door rebuild).
    this.input2 = new Input(this)
    this.player = new Player(this, 0, 0, this.playerHitboxes)
    this.player.onDeath = () => this._onPlayerDeath()

    // ── Enemy hurtbox group + per-level lists (rebuilt each level) ──
    this.enemyHurtboxes = this.physics.add.group({ allowGravity: true })
    this.enemies = []
    this.pickupRects = [] // placeholder pickup markers (destroyed on rebuild).

    // ── Persistent colliders (against the PLAYER COLLIDER + the enemy group) ── the solids/oneWay
    // colliders are re-wired per level in _buildLevel because the static groups are recreated; we
    // keep references so they can be removed on rebuild. The combat overlaps below are PERSISTENT
    // (they reference the persistent pools/groups, not the per-level tileMap).
    this._solidColliders = []

    // ── Combat overlaps (Decisions 16/20/30) ── PERSISTENT: they reference the pools + the enemy
    // hurtbox group (both persist), so they're registered ONCE here, not per level.
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

    // ── Camera follow (deadzone + lerp) ── follows the COLLIDER (stable physics position). Bounds
    // are set per level by TileMap (the room size is the generated world size).
    const cam = this.cameras.main
    cam.startFollow(this.player.collider, true, LERP_X, LERP_Y)
    cam.setDeadzone(DEADZONE_W, DEADZONE_H)

    // ── Build the first generated level ──
    this._buildLevel(this.seed)

    // Dev hint label (camera-fixed): controls + the current level seed.
    this.hint = this.add
      .text(16, 16, '', { fontFamily: 'monospace', fontSize: '18px', color: '#8b949e' })
      .setScrollFactor(0)
      .setDepth(100)
    this._updateHint()

    // ── Parallel HUD overlay (Decision 2) + teardown ──
    if (!this.scene.isActive('HUD')) this.scene.launch('HUD')
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scene.stop('HUD'))

    // ESC → Title (dev). On a .once event so it never shares the JustDown path Input owns.
    this.input.keyboard.once('keydown-ESC', () => this.scene.start('Title'))
  }

  // ── Build a generated level in place (design §6.2, Decision 40) ── generate the description,
  // construct the TileMap, reposition the Player at the entrance, spawn enemies/pickups/Door, and
  // (re-)wire the level colliders (solids + one-way) against the new static groups. The Player,
  // Input, Effects, HitboxPools, HUD, and the combat overlaps all PERSIST — only the world rebuilds.
  _buildLevel(seed) {
    const desc = generateLevel(seed, this.biome)
    this.desc = desc
    this.tileMap = new TileMap(this, desc)

    // Reposition the Player at the entrance (feet on the platform). reset() snaps the collider body
    // there + clears residual velocity so a rebuild never carries momentum from the previous level.
    this.player.body.reset(desc.entrance.x, desc.entrance.y)
    this.player.rect.setPosition(desc.entrance.x, desc.entrance.y)

    // Entrance marker (cosmetic) so the start reads. Destroyed on rebuild via _levelObjects.
    this._levelObjects = []
    const entMarker = this.add
      .rectangle(desc.entrance.x, desc.entrance.y, TILE_SIZE * 0.5, TILE_SIZE * 1.4, this.biome.colors.entrance)
      .setAlpha(0.55)
    this._levelObjects.push(entMarker)

    // ── Enemies (Decision 41 — patrol bounds come FROM the generator) ── each generated enemy entry
    // carries `patrolMinX/patrolMaxX` derived from the OWNING platform run's world span (so the scene
    // never has to map a world coord back to a platform, and the bounds are guaranteed standable +
    // wide enough — the generator only spawns enemies on runs ≥ MIN_ENEMY_PLATFORM_TILES wide). This
    // is the §6.2 resolution of the live Decision-29 pit-safety for GENERATED geometry.
    for (const e of desc.enemies) {
      this._spawnEnemy(e.x, e.y, BRUTE_SPEC, { patrolMinX: e.patrolMinX, patrolMaxX: e.patrolMaxX })
    }

    // ── Pickups (placeholder markers — economy is Phase 5, YAGNI) ── a primitive per spawn.
    for (const p of desc.pickups) {
      const color = PICKUP_COLORS[p.kind] ?? 0xffffff
      const rect = this.add.rectangle(p.x, p.y, TILE_SIZE * 0.4, TILE_SIZE * 0.4, color)
      this.pickupRects.push(rect)
    }

    // ── Door (the exit, Decision 40) ── overlap fires _onDoorOverlap → _nextLevel (guarded).
    this.door = new Door(this, desc.exit, this.biome.colors.exit, () => this._nextLevel())
    this.doorCollider = this.physics.add.overlap(
      this.player.collider,
      this.door.rect,
      () => this._onDoorOverlap(),
      () => !this.transitioning && !this.gameOver, // skip while a transition/death is in flight.
      this,
    )

    // ── Level colliders (re-wired per level — the static groups are new each rebuild) ──
    this._solidColliders.push(this.physics.add.collider(this.player.collider, this.tileMap.solids))
    this._solidColliders.push(this.physics.add.collider(this.enemyHurtboxes, this.tileMap.solids))

    // One-way collider (Decision 15) — reads the PLAYER's COLLIDER body (player.body.bottom), NEVER
    // the squash-scaled visual (review MINOR — the Phase-1/§6.1 invariant, preserved through this
    // rewrite). Argument order (player.collider, oneWay) so processCallback(player, platform) reads
    // the right bodies. EPS = MAX_FALL_SPEED·MAX_DT (derived, not a magic literal — review MINOR).
    this._solidColliders.push(
      this.physics.add.collider(
        this.player.collider,
        this.tileMap.oneWay,
        null,
        (player, platform) => {
          const pBody = player.body
          const platTop = platform.body.top
          return pBody.velocity.y >= 0 && pBody.bottom <= platTop + ONE_WAY_EPS
        },
        this,
      ),
    )
    // Enemies also respect the one-way platforms (land on top, pass up through) — same predicate.
    this._solidColliders.push(
      this.physics.add.collider(
        this.enemyHurtboxes,
        this.tileMap.oneWay,
        null,
        (enemyRect, platform) => {
          const eBody = enemyRect.body
          return eBody.velocity.y >= 0 && eBody.bottom <= platform.body.top + ONE_WAY_EPS
        },
        this,
      ),
    )
  }

  // ── Advance to the next generated level (Decision 40, review MAJOR re-entrancy) ── DEFERRED: the
  // overlap callback only sets the one-shot guard; the actual teardown+rebuild runs on the NEXT tick
  // (delayedCall 0) so we never destroy collider bodies while Arcade is iterating world.step.
  _onDoorOverlap() {
    if (this.transitioning || this.gameOver) return // one-shot: a multi-frame overlap fires once.
    this.transitioning = true
    this.cameras.main.flash(160, 244, 208, 63) // a brief yellow flash marks the level change.
    // Defer the rebuild off the physics step (footgun guard). delayedCall(0) runs next frame.
    this.time.delayedCall(0, () => this._nextLevel())
  }

  _nextLevel() {
    // Advance the seed (deterministic chain) + tear down the current level (KEEP player/pools/FX/HUD).
    this.seed = nextSeed(this.seed)
    this._teardownLevel()
    this._buildLevel(this.seed)
    this._updateHint()
    // eslint-disable-next-line no-console
    console.log(`[GameScene] advanced to next level — seed 0x${this.seed.toString(16)}`)
    this.transitioning = false // re-arm the door for the NEW level.
  }

  // Destroy everything the CURRENT level owns; keep the persistent player/pools/FX/HUD/overlaps.
  _teardownLevel() {
    // Remove the per-level colliders first (so destroyed bodies aren't referenced by a live collider).
    for (const c of this._solidColliders) if (c) this.physics.world.removeCollider(c)
    this._solidColliders = []
    if (this.doorCollider) {
      this.physics.world.removeCollider(this.doorCollider)
      this.doorCollider = null
    }
    // Enemies: despawn each (destroys its GameObjects) + clear the hurtbox group membership.
    for (const e of this.enemies) {
      this.enemyHurtboxes.remove(e.collider, false, false)
      e.forceDespawn()
    }
    this.enemies = []
    // Pickups + level markers + door + tileMap.
    for (const r of this.pickupRects) r.destroy()
    this.pickupRects = []
    for (const o of this._levelObjects) if (o && o.active) o.destroy()
    this._levelObjects = []
    if (this.door) {
      this.door.destroy()
      this.door = null
    }
    if (this.tileMap) {
      this.tileMap.destroy()
      this.tileMap = null
    }
    // Release any live hitboxes so a frozen/in-flight swing doesn't dangle across the rebuild.
    this.playerHitboxes.releaseAll()
    this.enemyHitboxes.releaseAll()
  }

  _updateHint() {
    if (!this.hint) return
    this.hint.setText(
      `MOVE arrows/WASD  JUMP Space  ATTACK J/click  DODGE Shift/K  [ESC] Title   |   seed 0x${this.seed.toString(16)}  →reach the yellow DOOR`,
    )
  }

  // Spawn an Enemy: build it (its strike draws from the shared enemyHitboxes pool, Decision 30),
  // register its collider body as a hurtbox, and track it.
  _spawnEnemy(x, y, spec, patrolBounds) {
    const enemy = new Enemy(this, x, y, spec, this.enemyHitboxes, patrolBounds)
    this.enemyHurtboxes.add(enemy.collider)
    this.enemies.push(enemy)
    return enemy
  }

  // ── Combat overlap callbacks (design §6.3 — unchanged from the Combat phase) ──

  _dedupFilter(hitboxRect, enemyRect) {
    const hb = hitboxRect.hb
    const enemy = enemyRect.enemyRef
    if (!hb.active || !enemy || !enemy.isHittable()) return false
    return !hb.hitSet.has(enemy.id)
  }

  _onPlayerHitEnemy(hitboxRect, enemyRect) {
    const hb = hitboxRect.hb
    const enemy = enemyRect.enemyRef
    if (!hb.active || !enemy || !enemy.isHittable() || hb.hitSet.has(enemy.id)) return
    hb.hitSet.add(enemy.id)
    const result = resolveHit(this.player.attackerShape, enemy.attackerShape, hb.swing, {
      allowBackstab: true,
    })
    enemy.onHit(result)
    this.effects.hit(enemy.body.center.x, enemy.body.center.y, {
      damage: result.damage,
      isBackstab: result.isBackstab,
    })
  }

  _onEnemyHitPlayer(hitboxRect) {
    const hb = hitboxRect.hb
    if (!hb.active || !this.player.isHittable()) return
    if (hb.hitSet.has(this.player.id)) return
    hb.hitSet.add(this.player.id)
    const enemy = this.enemies.find((e) => e.id === hb.ownerId)
    const attacker = enemy
      ? enemy.attackerShape
      : { cx: this.player.body.center.x - this.player.facing, facing: -this.player.facing }
    const result = resolveHit(attacker, this.player.attackerShape, hb.swing, { allowBackstab: false })
    this.player.onHit(result)
    this.effects.hit(this.player.body.center.x, this.player.body.center.y, { damage: result.damage })
  }

  _onEnemyContact(enemyRect) {
    const enemy = enemyRect.enemyRef
    if (!enemy || enemy.dead || enemy.contactCooldownTimer > 0 || !this.player.isHittable()) return
    enemy.contactCooldownTimer = enemy.spec.contactCooldown
    const contactSwing = { damage: enemy.spec.contactDamage, knockback: CONTACT_KNOCKBACK }
    const result = resolveHit(enemy.attackerShape, this.player.attackerShape, contactSwing, {
      allowBackstab: false,
    })
    this.player.onHit(result)
    this.effects.hit(this.player.body.center.x, this.player.body.center.y, { damage: result.damage })
  }

  // ── Player death handoff (AC26) ── a PLACEHOLDER: a short freeze/flash then back to Title.
  _onPlayerDeath() {
    if (this.gameOver) return
    this.gameOver = true
    this.hitstopTimer = 0.25
    this.cameras.main.flash(180, 200, 40, 40)
    this.cameras.main.shake(220, 0.01)
    this.time.delayedCall(700, () => this.scene.start('Title'))
  }

  // Push HP (+ combo) to the registry for the decoupled HUD (Decision 2).
  _emitHud() {
    this.registry.set('playerHp', this.player.hp)
    this.registry.set('playerMaxHp', this.player.maxHp)
    this.registry.set('comboIndex', this.player.comboIndex)
  }

  // ── Per-frame tick (design §6.1/§6.3 — the dt boundary + hit-stop) ──
  update(_time, delta) {
    const dt = Math.min(delta / 1000, MAX_DT)
    this.hitstopTimer = Math.max(0, this.hitstopTimer - dt)
    const gdt = this.hitstopTimer > 0 ? 0 : dt

    const inputState = this.input2.sample()
    // Freeze gameplay during a death handoff OR a level transition (the rebuild is mid-flight), but
    // keep ticking FX so the flash/pop plays out.
    if (!this.gameOver && !this.transitioning) {
      this.player.update(gdt, inputState)
      for (const enemy of this.enemies) enemy.update(gdt, { player: this.player, effects: this.effects })
    }

    this.playerHitboxes.tick(gdt)
    this.enemyHitboxes.tick(gdt)

    if (this.enemies.some((e) => e.removed)) {
      this.enemies = this.enemies.filter((e) => !e.removed)
    }

    this.effects.tick(dt)
    this._emitHud()
  }
}
