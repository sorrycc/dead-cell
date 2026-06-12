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
import { createRunState } from '../core/RunState.js'
import { scaleAtDepth, scaleSpec } from '../config/difficulty.js'
import { createMetaState } from '../core/MetaState.js'
import { ProjectilePool } from '../combat/ProjectilePool.js'
import { PickupPool } from '../entities/Pickup.js'
import { WEAPONS } from '../config/weapons.js'
import { SCROLLS_BY_ID } from '../config/scrolls.js'
import { mulberry32 } from '../util/rng.js'

// ── GameScene (design §6.1 + §6.2 + §6.3 + §6.4, AC11–AC18 + AC19/AC27–AC30 + AC20–AC26 + AC42–AC47) ──
// The only scene with an Arcade physics world. As of the Procedural-levels phase (§6.2) the
// hand-built test room is GONE: create() builds a DETERMINISTICALLY GENERATED level via
// generateLevel(seed, biome) → TileMap (merged static bodies + primitive tiles), spawns the Player
// at the generated entrance, spawns enemies/pickups at the generated points, and places a Door at
// the generated exit. The Combat phase (§6.3) is unchanged: pooled melee hitboxes, the Brute FSM,
// the damage pipeline, pooled FX + hit-stop.
//
// RUN STRUCTURE (§6.4, AC42–AC47): the scene OWNS one RunState (the active run) — the seed chain, the
// ordered biome index + per-biome level counter, the run-global depth, and the carried HP. _buildLevel
// reads the CURRENT biome from RunState and scales each enemy spawn by scaleAtDepth(depth) (a NEW spec
// per spawn — never mutating BRUTE_SPEC), with a depth-scaled enemyCountBonus drawn from the generator's
// spawnCandidates surplus. Reaching the Door ADVANCES the run (RunState.advance — depth always rises,
// biome rolls only when its `levels` are exhausted) and rebuilds in place, carrying HP (NOT refilled).
// Clearing the LAST biome's last Door → a "RUN COMPLETE" GameOver handoff; player death → a "GAME OVER"
// GameOver handoff carrying a run summary (depth/biome/time/kills). Both fire exactly once (gameOver).
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

// ── Run start seed (design §6.2/§6.4, Decision 44/46) ── a fixed placeholder start seed for the run
// (a Hub-chosen seed is Phase 7). RunState OWNS the deterministic next-seed chain now (it MOVED out of
// this scene — DRY), so a given START_SEED replays the same biome/level sequence (AC47).
const START_SEED = 0xc0ffee

// ── Weapon-pickup placement (§6.5, Decision 63) ── a sparse, FIXED per-level chance to place ONE
// weapon pickup (NOT a generator pickup kind — sourcing it scene-side keeps the generator emitting only
// cell/gold so the level regression pin + determinism deep-equal stay intact, per the §6.5 BLOCKER
// resolution). Low so swapping is a real mid-run choice (KISS). The weapon is the OTHER melee/ranged
// option vs the one you start with (a meaningful pick), chosen off the level seed (deterministic).
const WEAPON_PICKUP_CHANCE = 0.5 // ~half of levels carry a weapon to try.
const WEAPON_PICKUP_POOL = ['hammer', 'bow', 'sword'] // the ids a level pickup can offer.

export class GameScene extends Phaser.Scene {
  constructor() {
    super('Game')
  }

  create() {
    // ── Per-scene gravity (Decision 9; the BLOCKER #2 model) ──
    this.physics.world.gravity.y = GRAVITY

    // ── MetaState (design §6.5, Decision 56/60, AC50/AC53) ── load the PERSISTENT meta (banked Cells,
    // owned upgrades, best depth) from localStorage. NEVER throws (save.js try/catch). Fold the owned
    // upgrades into the base starting stats — the run-start power source (maxHp, meleeDamageMult, dodge
    // factor, starting weapon). A fresh meta folds to BASE_PLAYER_STATS → the Phase-4 player (identity).
    this.meta = createMetaState()
    const startStats = this.meta.startStats()

    // ── RunState (design §6.4/§6.5, Decision 44/46/60) ── ONE RunState OWNS the active run: the seed
    // chain, the biome index + per-biome level counter, the depth, the carried HP, the currencies, the
    // run-only scroll mults, and the equipped weapon id. Seeded from startStats so the carried maxHp/hp
    // + starting weapon reflect the META upgrades (review MAJOR — the HP-carry/upgrade reconciliation:
    // RunState.maxHp/hp are minted from the UPGRADED maxHp, so the single create()-time player sync
    // below is consistent). startedAt is captured HERE (purity stays in RunState — the clock is passed
    // IN). scene.start('Game') fully re-creates the scene per run, so a fresh RunState is minted each run.
    this.runState = createRunState(START_SEED, this.time.now, startStats)

    // ── Clear/seed the cross-scene registry BEFORE the first _emitHud (review MINOR — stale leak) ──
    // The registry (depth/biomeName/HP) persists across scenes, so a replayed run could briefly show
    // the PREVIOUS run's values until the first update() tick. Seed sane defaults from the fresh
    // RunState here so the parallel HUD never flashes stale data on a fresh run.
    this.registry.set('depth', this.runState.depth)
    this.registry.set('biomeName', this.runState.biome().name)
    this.registry.set('playerHp', this.runState.hp)
    this.registry.set('playerMaxHp', this.runState.maxHp)
    this.registry.set('comboIndex', -1)
    // §6.5 — seed the currency/weapon HUD keys too so the parallel HUD never flashes stale values.
    this.registry.set('cells', this.runState.cells)
    this.registry.set('gold', this.runState.gold)
    this.registry.set('weapon', WEAPONS[this.runState.weaponId].name)

    // ── Effects + hit-stop (Decisions 23/24/26) ── the scene OWNS the hit-stop timer (it gates the
    // gameplay dt the whole world reads). Effects only REQUESTS a freeze via the callback (capped,
    // de-duped — no stacking). These PERSIST across level rebuilds (only the world rebuilds).
    this.hitstopTimer = 0
    this.gameOver = false
    this.transitioning = false // Decision 40 one-shot guard (see _nextLevel).
    this.effects = new Effects(this, (secs) => {
      this.hitstopTimer = Math.min(HITSTOP_CAP, Math.max(this.hitstopTimer, secs))
    })

    // ── Combat pools (Decisions 16/28/30/62) ── one player + one enemy HitboxPool + one player
    // ProjectilePool (the ranged weapon fires from it). PERSIST across rebuilds.
    this.playerHitboxes = new HitboxPool(this, 'player')
    this.enemyHitboxes = new HitboxPool(this, 'enemy')
    this.projectilePool = new ProjectilePool(this, 'player')

    // ── Pickup pool (§6.5, Decision 54) ── pooled Cells/gold/scroll/weapon pickups; persists across
    // rebuilds (live pickups are released on teardown). Enemy drops + generator pickups acquire from it.
    this.pickupPool = new PickupPool(this)

    // ── Input + Player ── created ONCE; the Player is repositioned at each new entrance (it and its
    // pools persist; only the level geometry/enemies/door rebuild).
    this.input2 = new Input(this)
    this.player = new Player(this, 0, 0, this.playerHitboxes, this.projectilePool)
    this.player.onDeath = () => this._onPlayerDeath()
    // ── Apply the META-folded start stats to the Player (§6.5, Decision 60, AC53) ── raises maxHp +
    // refills hp to it, sets the melee/dodge modifiers, equips the starting weapon. IDENTITY-safe: a
    // fresh meta leaves the Phase-4 player exactly. This runs BEFORE the HP-carry sync below.
    this.player.applyStartStats(startStats, WEAPONS)
    // ── HP carry sync — EXACTLY ONCE, here in create() (review MAJOR, Decision 46/60) ── overwrite the
    // player's hp with the RunState's carried HP a SINGLE time. BOTH were just seeded from the SAME
    // upgraded maxHp (player via applyStartStats, runState via createRunState(startStats)), so on a
    // FRESH run this is a no-op at the upgraded full HP — the upgrade is reflected, not stale (review
    // MAJOR). It carries a non-full HP only when a future mid-run resume seeds runState.hp < maxHp.
    this.player.hp = this.runState.hp

    // ── Enemy hurtbox group + per-level enemy list (rebuilt each level) ──
    this.enemyHurtboxes = this.physics.add.group({ allowGravity: true })
    this.enemies = []
    // (Pickups are now POOLED — this.pickupPool above — not a per-level rect list; §6.5.)

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

    // ── Projectile → enemy overlap (§6.5, Decision 62, review MAJOR) ── PERSISTENT (both pools/groups
    // persist). A SEPARATE handler (_onProjectileHitEnemy) + a SEPARATE per-shot dedup — NOT the
    // player's _onPlayerHitEnemy — because a projectile's hit geometry (backstab/knockback origin) must
    // come from the PROJECTILE's position + travel dir, not the player's. The processFilter reuses the
    // SAME per-shot-hitSet dedup pattern (a shot hits each enemy once).
    this.physics.add.overlap(
      this.projectilePool.group,
      this.enemyHurtboxes,
      (projRect, enemyRect) => this._onProjectileHitEnemy(projRect, enemyRect),
      (projRect, enemyRect) => {
        const pj = projRect.pj
        const enemy = enemyRect.enemyRef
        if (!pj.active || !enemy || !enemy.isHittable()) return false
        return !pj.hitSet.has(enemy.id)
      },
      this,
    )

    // ── Pickup → player overlap (§6.5, Decision 54) ── PERSISTENT. ONE handler reads the kind tag and
    // resolves collection (the economy logic lives HERE, not in the decoupled pool). The filter only
    // fires for a live pickup (a released one is parked off-room + disabled).
    this.physics.add.overlap(
      this.player.collider,
      this.pickupPool.group,
      (_playerRect, pickupRect) => this._onPickup(pickupRect),
      (_playerRect, pickupRect) => pickupRect.pk.active,
      this,
    )

    // ── Camera follow (deadzone + lerp) ── follows the COLLIDER (stable physics position). Bounds
    // are set per level by TileMap (the room size is the generated world size).
    const cam = this.cameras.main
    cam.startFollow(this.player.collider, true, LERP_X, LERP_Y)
    cam.setDeadzone(DEADZONE_W, DEADZONE_H)

    // ── Build the first generated level (reads the CURRENT biome + seed from RunState) ──
    this._buildLevel()

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

  // ── Build a generated level in place (design §6.2/§6.4, Decision 40/45/46) ── read the CURRENT
  // biome + seed from RunState, generate the description, construct the TileMap, reposition the Player
  // at the entrance, spawn DEPTH-SCALED enemies/pickups/Door, and (re-)wire the level colliders. The
  // Player, Input, Effects, HitboxPools, HUD, and the combat overlaps all PERSIST — only the world
  // rebuilds. IMPORTANT (review MAJOR, Decision 46): this method touches NEITHER player.hp NOR
  // runState.hp — HP carry is owned by create() (the one-time sync) + _nextLevel (the pre-teardown
  // write), so a rebuild never refills HP.
  _buildLevel() {
    const biome = this.runState.biome()
    const desc = generateLevel(this.runState.seed, biome)
    this.desc = desc
    this.tileMap = new TileMap(this, desc)

    // Reposition the Player at the entrance (feet on the platform). reset() snaps the collider body
    // there + clears residual velocity so a rebuild never carries momentum from the previous level.
    // (HP is NOT touched here — it carried in via create()/_nextLevel — Decision 46.)
    this.player.body.reset(desc.entrance.x, desc.entrance.y)
    this.player.rect.setPosition(desc.entrance.x, desc.entrance.y)

    // Entrance marker (cosmetic) so the start reads. Destroyed on rebuild via _levelObjects.
    this._levelObjects = []
    const entMarker = this.add
      .rectangle(desc.entrance.x, desc.entrance.y, TILE_SIZE * 0.5, TILE_SIZE * 1.4, biome.colors.entrance)
      .setAlpha(0.55)
    this._levelObjects.push(entMarker)

    // ── Enemies, DEPTH-SCALED (design §6.4, Decision 45, AC45) ── each spawn gets a NEW spec derived
    // by scaleSpec(BRUTE_SPEC, scaleAtDepth(depth)) — maxHp/contactDamage/speeds/swing.damage rise
    // with the run-global depth, NEVER mutating the shared BRUTE_SPEC (the aliasing bug Decision 45
    // avoids). Patrol bounds come FROM the generator (Decision 41 — the OWNING run's world span).
    const scale = scaleAtDepth(this.runState.depth)
    for (const e of desc.enemies) {
      const spec = scaleSpec(BRUTE_SPEC, scale)
      this._spawnEnemy(e.x, e.y, spec, { patrolMinX: e.patrolMinX, patrolMaxX: e.patrolMaxX })
    }

    // ── enemyCountBonus (design §6.4, Decision 45 / review MAJOR — IMPLEMENTABLE source) ── at depth,
    // add a few EXTRA enemies drawn from the generator's `spawnCandidates` surplus (standable cells not
    // already used by desc.enemies — the generator exposes them PURELY, so the scene never re-derives
    // standable geometry: the DRY violation the review flagged). Capped so the live count never exceeds
    // the biome's maxEnemies, and bounded by the surplus available (else simply fewer — never a no-op
    // claim). Each bonus spawn is the SAME scaled spec, so "more AND tankier enemies at depth" holds.
    const liveCount = desc.enemies.length
    const wantBonus = Math.min(scale.enemyCountBonus, Math.max(0, biome.maxEnemies - liveCount))
    for (let i = 0; i < wantBonus && i < desc.spawnCandidates.length; i++) {
      const e = desc.spawnCandidates[i]
      const spec = scaleSpec(BRUTE_SPEC, scale)
      this._spawnEnemy(e.x, e.y, spec, { patrolMinX: e.patrolMinX, patrolMaxX: e.patrolMaxX })
    }

    // ── Pickups (§6.5, Decision 54, AC48) ── the generator's desc.pickups (cell/gold) become REAL
    // pooled pickups (the placeholder rects are gone — DRY: ONE pickup path). They're placed at the
    // standable spawn point; the pool's gravity + the solids collider settle them on the platform.
    for (const p of desc.pickups) {
      this.pickupPool.acquire(p.x, p.y, p.kind)
    }
    // ── Sparse weapon pickup (§6.5, Decision 63) ── a low FIXED per-level chance to offer ONE weapon
    // to swap to, sourced SCENE-SIDE off the level seed (NOT the generator — keeps the level pin intact,
    // per the BLOCKER resolution). Deterministic per seed: a fresh mulberry32 off the level seed picks
    // whether + which (so a replay places the same weapon). Placed at the level's first pickup spot (or
    // the entrance if none) so it's reachable on the critical path.
    this._maybePlaceWeaponPickup(desc)

    // ── Door (the exit, Decision 40) ── overlap fires _onDoorOverlap → _nextLevel (guarded).
    this.door = new Door(this, desc.exit, biome.colors.exit, () => this._nextLevel())
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
    // Pickups collide with solids so they arc + SETTLE on the platform below (§6.5, Decision 54).
    this._solidColliders.push(this.physics.add.collider(this.pickupPool.group, this.tileMap.solids))

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

  // ── Door → advance the RUN (design §6.4, Decision 46/48) ── COMPLETION CHECK FIRST: if the LAST
  // biome's LAST level was just cleared, the run is FINISHED → run-complete handoff (Decision 48),
  // NOT an advance into a non-existent biome. Otherwise: write runState.hp = player.hp BEFORE teardown
  // (the carried-HP capture — the ONLY runState.hp write on the level→level path, Decision 46), then
  // advance the RunState (next seed + next level/biome/depth — BLOCKER 1: depth always rises, biome
  // rolls only when the biome's levels are exhausted), and rebuild from the new RunState.
  _nextLevel() {
    if (this.runState.isRunComplete()) {
      this._completeRun()
      return
    }
    // Capture carried HP into the RunState BEFORE the rebuild (Decision 46 — sync exactly once here).
    this.runState.hp = this.player.hp
    this.runState.advance()
    this._teardownLevel()
    this._buildLevel() // reads the advanced biome/seed/depth from RunState (HP NOT refilled).
    this._updateHint()
    // eslint-disable-next-line no-console
    console.log(
      `[GameScene] advanced — depth ${this.runState.depth}, biome ${this.runState.biome().name} ` +
        `(level ${this.runState.levelInBiome + 1}/${this.runState.biome().levels}), seed 0x${this.runState.seed.toString(16)}`,
    )
    this.transitioning = false // re-arm the door for the NEW level.
  }

  // ── Run completion (design §6.4, Decision 48, AC47) ── clearing the LAST biome's last Door ends the
  // run cleanly (a real boss-gated victory is Phase 6 via endsInBoss). For now: a run-complete handoff
  // to GameOver carrying the summary tagged completed:true (a gold "RUN COMPLETE" header). Guarded by
  // `gameOver` so it fires exactly once (a multi-frame overlap can't double-start the scene).
  _completeRun() {
    if (this.gameOver) return
    this.gameOver = true
    this.runState.hp = this.player.hp // final carried-HP snapshot (kept consistent; summary ignores it).
    // Bank the run's Cells + best depth to the PERSISTENT meta ONCE (§6.5, Decision 59, AC51) — gold/
    // scrolls are run-only and simply NOT passed (permadeath loses them). Under the gameOver guard so it
    // fires exactly once per run. The summary carries cellsBanked for GameOver's readout.
    this.meta.bankRun({ cells: this.runState.cells, depth: this.runState.depth })
    this.scene.start('GameOver', this.runState.summary(this.time.now, true))
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
    // Pickups (pooled — released, not destroyed) + level markers + door + tileMap.
    this.pickupPool.releaseAll() // §6.5 — live pickups don't carry across levels (release to the pool).
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
    // Release any live hitboxes/projectiles so a frozen/in-flight swing/shot doesn't dangle across the
    // rebuild (mirrors the hitbox cleanup; the pools persist, only their live members are released).
    this.playerHitboxes.releaseAll()
    this.enemyHitboxes.releaseAll()
    this.projectilePool.releaseAll()
  }

  _updateHint() {
    if (!this.hint) return
    const rs = this.runState
    this.hint.setText(
      `MOVE arrows/WASD  JUMP Space  ATTACK J/click  DODGE Shift/K  [ESC] Title   |   ` +
        `DEPTH ${rs.depth} · ${rs.biome().name} ${rs.levelInBiome + 1}/${rs.biome().levels}  ` +
        `seed 0x${rs.seed.toString(16)}  →reach the yellow DOOR`,
    )
  }

  // Spawn an Enemy: build it (its strike draws from the shared enemyHitboxes pool, Decision 30),
  // register its collider body as a hurtbox, wire the kill-count + Cells-DROP hooks, and track it.
  _spawnEnemy(x, y, spec, patrolBounds) {
    const enemy = new Enemy(this, x, y, spec, this.enemyHitboxes, patrolBounds)
    enemy.onDeath = () => {
      this.runState.kills += 1 // bump the run's kill count for the GameOver summary (free; AC46).
    }
    // ── Cells/loot drop hook (§6.5, Decision 54, AC48) ── on death the Enemy fires this with the
    // captured death-center coords + the Cell count; we spawn pooled pickups there (a Cell always +
    // a gold/scroll chance). The coords are captured in Enemy._die BEFORE the body is disabled (the
    // review BLOCKER fix). Enemy stays self-contained (no pool import — just this callback).
    enemy.onDrop = (dropX, dropY, count) => this.pickupPool.spawnDrop(dropX, dropY, this.runState.depth, count)
    this.enemyHurtboxes.add(enemy.collider)
    this.enemies.push(enemy)
    return enemy
  }

  // ── _maybePlaceWeaponPickup(desc) (§6.5, Decision 63) ── deterministically (off the level seed)
  // maybe place ONE weapon pickup so swapping is a real mid-run choice. Off the seeded level RNG (a
  // fresh mulberry32) so it's NOT on the generator's pinned draw sequence — the level pin stays intact.
  _maybePlaceWeaponPickup(desc) {
    const rng = mulberry32((desc.seed ^ 0x5eed1234) >>> 0)
    if (rng() >= WEAPON_PICKUP_CHANCE) return
    // Pick a weapon that ISN'T the currently equipped one (a meaningful swap), else any.
    const choices = WEAPON_PICKUP_POOL.filter((id) => id !== this.runState.weaponId)
    const pool = choices.length ? choices : WEAPON_PICKUP_POOL
    const weaponId = pool[Math.floor(rng() * pool.length)]
    // Place it at a spawn spot away from the entrance (the first pickup point, or the level midpoint).
    const spot = desc.pickups[0] || { x: (desc.entrance.x + desc.exit.x) / 2, y: desc.entrance.y }
    this.pickupPool.acquire(spot.x, spot.y - TILE_SIZE, 'weapon', { weaponId })
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
    // PLAYER melee damage = swing × backstab × (meta meleeDamageMult × run scrollDamageMult), composed
    // + rounded ONCE in resolveHit (§6.5, Decision 60 — the mult is PASSED IN, damage.js stays pure).
    const result = resolveHit(this.player.attackerShape, enemy.attackerShape, hb.swing, {
      allowBackstab: true,
      damageMult: this.player.meleeDamageMult * this.player.scrollDamageMult,
    })
    enemy.onHit(result)
    this.effects.hit(enemy.body.center.x, enemy.body.center.y, {
      damage: result.damage,
      isBackstab: result.isBackstab,
    })
  }

  // ── Projectile → enemy hit (§6.5, Decision 62, review MAJOR) ── a SEPARATE handler from the melee
  // one: the attacker shape is the PROJECTILE's (its live position + travel dir), so backstab/knockback
  // geometry derives from where the SHOT is — not the player. Reuses the SAME resolveHit + effects.hit
  // pipeline (DRY). Player melee/scroll mults apply to the bow's projectile damage too (it's a player
  // weapon). The shot dies on first hit (KISS — no pierce); the per-shot hitSet already deduped.
  _onProjectileHitEnemy(projRect, enemyRect) {
    const pj = projRect.pj
    const enemy = enemyRect.enemyRef
    if (!pj.active || !enemy || !enemy.isHittable() || pj.hitSet.has(enemy.id)) return
    pj.hitSet.add(enemy.id)
    // The projectile's spec carries damage/knockback (read like a swing row by resolveHit).
    const swing = { damage: pj.spec.damage, knockback: pj.spec.knockback }
    const result = resolveHit(pj.attackerShape, enemy.attackerShape, swing, {
      allowBackstab: true,
      damageMult: this.player.meleeDamageMult * this.player.scrollDamageMult,
    })
    enemy.onHit(result)
    this.effects.hit(enemy.body.center.x, enemy.body.center.y, {
      damage: result.damage,
      isBackstab: result.isBackstab,
    })
    this.projectilePool.release(projRect) // KISS: the shot dies on first hit (no pierce).
  }

  // ── Pickup collection (§6.5, Decision 54/55/63, AC48/AC49) ── ONE handler reads the kind tag and
  // routes to the right effect: cell → RunState.cells (banked at run end); gold → RunState.gold
  // (run-only); scroll → arm the run-only scroll effect on RunState; weapon → swap the equipped weapon
  // + record the id on RunState (so a level rebuild keeps it). A small collect pop (reusing the spark
  // pool), then the pickup returns to the pool.
  _onPickup(pickupRect) {
    const pk = pickupRect.pk
    if (!pk.active) return
    switch (pk.kind) {
      case 'cell':
        this.runState.cells += 1 // META currency — banked at run end (AC49/AC51).
        break
      case 'gold':
        this.runState.gold += pk.goldAmount // run-only currency (lost on death — AC49).
        break
      case 'scroll': {
        const scroll = SCROLLS_BY_ID[pk.scrollId]
        if (scroll) scroll.apply(this.runState) // arm the run-only boost (Decision 55) — never saved.
        // A vitality scroll bumps RunState.scrollMaxHpBonus → reflect it on the live player NOW.
        this._syncPlayerScrollStats()
        break
      }
      case 'weapon': {
        const weapon = WEAPONS[pk.weaponId]
        if (weapon) {
          this.player.equipWeapon(weapon) // resets the combo so the new moveset starts clean (Decision 63).
          this.runState.weaponId = pk.weaponId // carried across level rebuilds.
        }
        break
      }
    }
    // A small collect pop (reuse the spark pool — no new allocation).
    this.effects.hit(pickupRect.body.center.x, pickupRect.body.center.y, { damage: 0 })
    this.pickupPool.release(pickupRect)
  }

  // ── Sync run-only scroll stats onto the live Player (§6.5, Decision 60) ── scrollDamageMult is read
  // LIVE at the hit site (no copy needed). scrollMaxHpBonus is a flat max-HP boost: raise the player's
  // maxHp to base+bonus and HEAL by the just-added amount (so a vitality scroll both grows + tops up).
  _syncPlayerScrollStats() {
    this.player.scrollDamageMult = this.runState.scrollDamageMult
    const newMax = this.runState.maxHp + this.runState.scrollMaxHpBonus
    const grew = newMax - this.player.maxHp // how much max-HP just increased (≥0).
    this.player.maxHp = newMax
    if (grew > 0) this.player.hp = Math.min(newMax, this.player.hp + grew) // heal by the grown amount.
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

  // ── Player death → GameOver run summary (design §6.4, Decision 47, AC46) ── REWRITES the AC26
  // Title-bounce placeholder. Keep the short freeze/flash for impact, then hand off to the REAL
  // GameOverScene with a run-summary SNAPSHOT passed as scene-start DATA (so GameOver stays decoupled —
  // it never reaches into this live scene). Guarded by `gameOver` so the death edge fires EXACTLY once.
  _onPlayerDeath() {
    if (this.gameOver) return
    this.gameOver = true
    this.runState.hp = 0 // the run ended at 0 HP (kept consistent; the summary doesn't read hp).
    // Bank the run's Cells + best depth to the PERSISTENT meta ONCE (§6.5, Decision 59, AC51). The
    // run's gold/scrolls are DISCARDED (run-only — permadeath). Under the gameOver guard so it fires
    // exactly once. Banking here (not GameOver) keeps the single writer next to the live RunState.
    this.meta.bankRun({ cells: this.runState.cells, depth: this.runState.depth })
    this.hitstopTimer = 0.25
    this.cameras.main.flash(180, 200, 40, 40)
    this.cameras.main.shake(220, 0.01)
    // Snapshot the summary NOW (RunState may be torn down with the scene) and route to GameOver → Hub.
    const summary = this.runState.summary(this.time.now, false)
    this.time.delayedCall(700, () => this.scene.start('GameOver', summary))
  }

  // Push HP (+ combo + depth/biome) to the registry for the decoupled HUD (Decision 2). The HUD reads
  // these each frame and never touches this scene. depth/biome let the HUD show the live "DEPTH n ·
  // BIOME" readout so the rising difficulty reads (AC45). (create() seeds sane defaults so the HUD
  // never flashes a stale prior-run value before the first tick — review MINOR.)
  _emitHud() {
    this.registry.set('playerHp', this.player.hp)
    this.registry.set('playerMaxHp', this.player.maxHp)
    this.registry.set('comboIndex', this.player.comboIndex)
    this.registry.set('depth', this.runState.depth)
    this.registry.set('biomeName', this.runState.biome().name)
    // §6.5 (Decision 2/AC49) — live currency counters + equipped weapon name for the decoupled HUD.
    this.registry.set('cells', this.runState.cells)
    this.registry.set('gold', this.runState.gold)
    this.registry.set('weapon', this.player.equippedWeapon.name)
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
      // Latch the attack edge BEFORE the player tick so update()'s step (1.5) resolves it this frame
      // (the Player's attack() only sets intent; update dispatches melee/ranged off the equipped weapon
      // — §6.3/§6.5 Decision 25/61). Sampled as an EDGE in Input (JustDown / pointer edge) so a held
      // key/click fires exactly once per press.
      if (inputState.attackPressed) this.player.attack()
      this.player.update(gdt, inputState)
      for (const enemy of this.enemies) enemy.update(gdt, { player: this.player, effects: this.effects })
    }

    this.playerHitboxes.tick(gdt)
    this.enemyHitboxes.tick(gdt)
    // Projectiles tick on the GAMEPLAY dt so they FREEZE with the world during a hit-stop (Decision
    // 26/62) — consistent with hitboxes/enemies. Pickups settle on REAL dt (cosmetic — keep their visual
    // glued to the gravity-driven body even during a freeze).
    this.projectilePool.tick(gdt)
    this.pickupPool.tick()

    if (this.enemies.some((e) => e.removed)) {
      this.enemies = this.enemies.filter((e) => !e.removed)
    }

    this.effects.tick(dt)
    this._emitHud()
  }
}
