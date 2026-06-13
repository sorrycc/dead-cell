import Phaser from 'phaser'
import { GRAVITY } from '../config/constants.js'
import { Input } from '../core/Input.js'
import { Player } from '../entities/Player.js'
import { Enemy } from '../entities/Enemy.js'
import { Boss } from '../entities/Boss.js'
import { Door } from '../entities/Door.js'
import { Shop } from '../entities/Shop.js'
import { ShopOverlay } from '../entities/ShopOverlay.js'
import { HitboxPool } from '../combat/HitboxPool.js'
import { resolveHit } from '../combat/damage.js'
import { Effects } from '../effects/Effects.js'
import { generateLevel, TILE_SIZE } from '../world/LevelGenerator.js'
import { TileMap } from '../world/TileMap.js'
import { createRunState } from '../core/RunState.js'
import { scaleAtDepth, scaleSpec, scaleBossSpec } from '../config/difficulty.js'
import { createMetaState } from '../core/MetaState.js'
import { ProjectilePool } from '../combat/ProjectilePool.js'
import { PickupPool } from '../entities/Pickup.js'
import { WEAPONS, WEAPON_AFFIXES, WEAPON_AFFIX_CHANCE, WEAPON_AFFIXES_BY_ID, foldWeaponAffix } from '../config/weapons.js'
import { ENEMY_SPECS, ELITE_AFFIXES, ELITE_CHANCE } from '../config/enemies.js'
import { BOSSES } from '../config/bosses.js'
import { SCROLLS, SCROLLS_BY_ID, SCROLL_IDS } from '../config/scrolls.js'
import { SHOP_ITEMS } from '../config/shop.js'
import { ROOM_TYPES, ROOM_NORMAL } from '../config/roomTypes.js'
import { mulberry32 } from '../util/rng.js'

// ── GameScene (design §6.1 + §6.2 + §6.3 + §6.4, AC11–AC18 + AC19/AC27–AC30 + AC20–AC26 + AC42–AC47) ──
// The only scene with an Arcade physics world. As of the Procedural-levels phase (§6.2) the
// hand-built test room is GONE: create() builds a DETERMINISTICALLY GENERATED level via
// generateLevel(seed, biome) → TileMap (merged static bodies + primitive tiles), spawns the Player
// at the generated entrance, spawns enemies/pickups at the generated points, and places a Door at
// the generated exit. The Combat phase (§6.3) is unchanged: pooled melee hitboxes, the Brute FSM,
// the damage pipeline, pooled FX + hit-stop.
//
// RUN STRUCTURE (§6.4/§6.6, AC42–AC47/AC57): the scene OWNS one RunState (the active run) — the seed
// chain, the ordered biome index + per-biome level counter, the run-global depth, and the carried HP.
// _buildLevel reads the CURRENT biome from RunState; for each enemy spawn it PICKS an archetype off the
// biome's weighted enemyPool (a fresh seeded RNG, off the pinned draw — §6.6.4) and scaleSpec()s it by
// scaleAtDepth(depth) (a NEW spec per spawn — never mutating the shared config spec), with a depth-scaled
// enemyCountBonus drawn from the generator's spawnCandidates surplus. On the boss biome's FINAL level
// (RunState.isBossLevel) it branches to _buildBossLevel (a flat arena + the boss, NO Door). Reaching a
// Door ADVANCES the run (RunState.advance — depth always rises, biome rolls only when its `levels` are
// exhausted) and rebuilds in place, carrying HP (NOT refilled). Player death → a "GAME OVER" handoff;
// the boss kill → VictoryScene (§6.6.3). All run-end edges fire exactly once (the gameOver guard).
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

// ── Arena hazard contact damage (design §6.6.2, AC57) ── the bite per hazard tick in the boss room.
// Sized so standing on the spikes hurts (punishes bad positioning during the boss fight) but isn't an
// instant kill — a few ticks before you must reposition. Boss room ONLY (the only hazard-body site).
const HAZARD_DAMAGE = 8 // hp per tick.

// ── Run start seed (design §6.2/§6.4/§6.9, Decision 44/46/71) ── the FALLBACK start seed when no seed is
// passed in (a bare dev `scene.start('Game')` / the verifier identity). RunState OWNS the deterministic
// next-seed chain (it MOVED out of this scene — DRY), so a given start seed replays the same biome/level
// sequence (AC47). The ENRICHMENT (Decision 71, the replayability fix): the run seed is no longer FROZEN to
// this constant — HubScene mints a fresh per-run seed from REAL ENTROPY (Date.now ⊕ a random draw) at START
// RUN and passes it via scene.start('Game', { seed }). _resolveSeed() below reads that, falling back to
// FALLBACK_SEED only when none is passed. The PURE modules (RunState/generator) are UNTOUCHED — they still
// take a seed in — so the verifier's determinism walk (which constructs createRunState(0xc0ffee) directly)
// is unaffected: entropy lives ONLY at the scene boundary, never inside a pure module.
const FALLBACK_SEED = 0xc0ffee

// ── Weapon-pickup placement (§6.5, Decision 63) ── a sparse, FIXED per-level chance to place ONE
// weapon pickup (NOT a generator pickup kind — sourcing it scene-side keeps the generator emitting only
// cell/gold so the level regression pin + determinism deep-equal stay intact, per the §6.5 BLOCKER
// resolution). Low so swapping is a real mid-run choice (KISS). The weapon is the OTHER melee/ranged
// option vs the one you start with (a meaningful pick), chosen off the level seed (deterministic).
const WEAPON_PICKUP_CHANCE = 0.5 // ~half of levels carry a weapon to try.
// The ids a level pickup can offer — now includes the SPEAR (§6.6.5, AC60) so the 4th weapon appears
// in runs (it's a found weapon, not a meta unlock — Decision 69).
const WEAPON_PICKUP_POOL = ['hammer', 'bow', 'sword', 'spear']

// ── In-run shop placement (§6.10, Decision 74/76, AC63 — the GOLD SINK) ── a per-level FIXED chance to
// place ONE Shop vendor, rolled off a fresh seeded RNG (off the generator's pinned draw — the same level-
// pin discipline as the weapon pickup, so the regression pin + determinism deep-equal stay intact). Sized
// so a vendor appears often enough that hoarded gold has a regular outlet, but not EVERY level (so the
// "spend now vs save for the next vendor" decision is real). A given run seed always places the same shops.
const SHOP_LEVEL_CHANCE = 0.55 // ~half-plus of normal levels carry a vendor (a reliable gold outlet).

export class GameScene extends Phaser.Scene {
  constructor() {
    super('Game')
  }

  // Phaser passes scene-start DATA to create(): { seed? } from HubScene's START RUN (Decision 71). A bare
  // start (dev / direct) passes nothing → _resolveSeed() mints a fresh entropy seed so even a dev launch
  // varies. The verifier never runs this scene (it's Phaser-coupled) — it constructs RunState directly.
  create(data) {
    // ── Per-scene gravity (Decision 9; the BLOCKER #2 model) ──
    this.physics.world.gravity.y = GRAVITY

    // ── Resolve the run seed (Decision 71 — the replayability fix) ── prefer a seed passed in by the Hub
    // (a shared/entropy seed); else mint one from entropy HERE so a bare dev launch still varies. The seed
    // is stored so the HUD + the GameOver/Victory summary can surface it (a shareable run id).
    this.runSeed = this._resolveSeed(data)

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
    this.runState = createRunState(this.runSeed, this.time.now, startStats)

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
    // §6.9 — seed the flask (heal valve) HUD keys so the parallel HUD never flashes stale charges.
    this.registry.set('flasks', this.runState.flasks)
    this.registry.set('maxFlasks', this.runState.maxFlasks)
    // §6.6.3 (review MINOR) — seed the boss HP-bar keys to "no boss" so a replayed run never flashes the
    // PREVIOUS run's boss bar (the registry survives scene restarts — the same stale-leak HP guards for).
    this.registry.set('bossActive', false)
    this.registry.set('bossHp', null)
    this.registry.set('bossMaxHp', null)
    this.registry.set('bossName', '')

    // ── Effects + hit-stop (Decisions 23/24/26) ── the scene OWNS the hit-stop timer (it gates the
    // gameplay dt the whole world reads). Effects only REQUESTS a freeze via the callback (capped,
    // de-duped — no stacking). These PERSIST across level rebuilds (only the world rebuilds).
    this.hitstopTimer = 0
    this.gameOver = false
    this.transitioning = false // Decision 40 one-shot guard (see _nextLevel).
    // ── Boss-room state (§6.6.3) — null/false until _buildBossLevel runs (the last level of RAMPARTS). ──
    this.boss = null
    this.isBossRoom = false
    this._hazardCollider = null
    this._hazardCooldown = 0
    // ── In-run shop state (§6.10, Decision 74/76) — null/false until a level places a vendor (_buildLevel). ──
    this.shop = null // the live Shop entity (a stand-on vendor) for THIS level, or null (most boss/some levels).
    this._shopCollider = null // the player×vendor in-range overlap (removed on teardown).
    this.shopOpen = false // true while the shop overlay is up (gameplay is paused beneath it).
    this.shopOverlay = null // the live ShopOverlay UI while open, else null.
    this.effects = new Effects(this, (secs) => {
      this.hitstopTimer = Math.min(HITSTOP_CAP, Math.max(this.hitstopTimer, secs))
    })

    // ── Combat pools (Decisions 16/28/30/62/65) ── one player + one enemy HitboxPool + one PLAYER
    // ProjectilePool (the bow fires from it) + one ENEMY ProjectilePool (the Shooter archetype + the
    // boss volley fire from it — Decision 65, the 'enemy'-tagged instance). All PERSIST across rebuilds
    // (created ONCE here, released on teardown) — the same lifecycle the player pool already has.
    this.playerHitboxes = new HitboxPool(this, 'player')
    this.enemyHitboxes = new HitboxPool(this, 'enemy')
    this.projectilePool = new ProjectilePool(this, 'player')
    this.enemyProjectilePool = new ProjectilePool(this, 'enemy') // §6.6.3 (Decision 65) — enemy/boss shots.

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

    // ── Meta 'starting scrolls' (§6.9, Decision 73) ── a meta tier grants N run-only scroll boosts at run
    // start (a head-start on build variety). Applied deterministically off the RUN seed (so a seeded run
    // replays the same starting scrolls) to RunState's run-only mults, then synced to the live player. A
    // fresh meta grants 0 → identity (no scroll applied — the run plays exactly as before the enrichment).
    this._applyStartingScrolls(startStats.startScrolls ?? 0)

    // ── Guaranteed per-biome POWER scroll (§6.5, Enrichment round 3 — the in-run power-arc fix) ── arm one
    // power/vitality scroll at the START of the FIRST biome so the run begins its own visible power curve
    // (the biome-transition hook in _nextLevel arms one for each subsequent biome). Deterministic off the
    // run seed ⊕ the biome index; mutates RunState's run-only mults (never banked) then syncs the player.
    this._grantBiomePowerScroll()

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
    // SPRITE-FIRST (Phaser swap rule): Arcade normalizes a Group×Sprite overlap to
    // collideSpriteVsGroup(sprite, group), so the callbacks ALWAYS fire as (sprite, groupChild).
    // We therefore list the single player.collider as object1 and the hitbox GROUP as object2, then
    // read (_playerRect, hitboxRect). Registering the group first would silently swap the args.
    this.physics.add.overlap(
      this.player.collider,
      this.enemyHitboxes.group,
      (_playerRect, hitboxRect) => this._onEnemyHitPlayer(hitboxRect),
      (_playerRect, hitboxRect) => hitboxRect.hb.active && this.player.isHittable(),
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

    // ── ENEMY projectile → player overlap (§6.6.3, Decision 65, review BLOCKER/MAJOR) ── the INVERSE of
    // the player projectile→enemy overlap: an 'enemy'-tagged shot (Shooter/boss volley) hitting the
    // player collider. PERSISTENT (both persist). A SEPARATE handler (_onEnemyProjectileHitPlayer) + a
    // per-shot hitSet dedup against the PLAYER id — NOT the melee _onEnemyHitPlayer (which keys off a
    // hitbox + the enemies[] list; a projectile is not a hitbox and the boss isn't in enemies[]). The
    // filter fires only for a live shot the player can still take (so a frozen/parked shot never hits).
    // SPRITE-FIRST (same Phaser swap rule as the melee overlap above): player.collider is object1,
    // the projectile GROUP is object2, callbacks read (_playerRect, projRect).
    this.physics.add.overlap(
      this.player.collider,
      this.enemyProjectilePool.group,
      (_playerRect, projRect) => this._onEnemyProjectileHitPlayer(projRect),
      (_playerRect, projRect) => {
        const pj = projRect.pj
        if (!pj.active || !this.player.isHittable()) return false
        return !pj.hitSet.has(this.player.id)
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
    // ── BOSS-LEVEL BRANCH (design §6.6.3, Decision 66/67, AC57) ── the ONE branch _buildLevel gains:
    // when the run is on the boss biome's final level, build the boss ARENA instead of a normal level
    // (a flat walled room with the boss, an arena hazard, and NO exit Door — the boss is the gate).
    if (this.runState.isBossLevel()) {
      this._buildBossLevel()
      return
    }

    const biome = this.runState.biome()
    const desc = generateLevel(this.runState.seed, biome)
    this.desc = desc
    this.tileMap = new TileMap(this, desc)

    // Level-object tracking (destroyed on rebuild via _levelObjects). MUST be initialized BEFORE
    // _applyRoomType — a tagged room pops a banner that pushes here (_popRoomBanner). The constructor
    // never inits it, so on the FIRST create()-time build this would otherwise be undefined (crash), and
    // a later reset would discard the banner reference (leak). One init point per build (boss path: line 619).
    this._levelObjects = []

    // ── ROOM TYPE (Enrichment round-2, §6.15) ── roll a tagged room type off the LEVEL seed (a fresh sub-RNG,
    // OFF the generator's pinned draw — the weapon-pickup/shop discipline, so the level pin stays intact). A
    // miniboss level is NEVER tagged (it already IS the set-piece — see _buildLevel's miniboss branch). The
    // roll FLAVOURS this normal room: more elites (forceElite), more enemies (extraEnemies), richer loot
    // (lootMult), an optional debuff (playerDamageTakenMult), a guaranteed reward. Most rolls are 'normal' (the
    // identity — byte-unchanged). _applyRoomType sets this.roomType + this.roomDamageTakenMult (read at the
    // player-hit sites) and pops the banner. MUST run BEFORE the spawn loop so forceElite/extraEnemies apply.
    this._applyRoomType(desc)

    // Reposition the Player at the entrance (feet on the platform). reset() snaps the collider body
    // there + clears residual velocity so a rebuild never carries momentum from the previous level.
    // (HP is NOT touched here — it carried in via create()/_nextLevel — Decision 46.)
    this.player.body.reset(desc.entrance.x, desc.entrance.y)
    this.player.rect.setPosition(desc.entrance.x, desc.entrance.y)

    // Entrance marker (cosmetic) so the start reads. Pushed onto the already-initialized _levelObjects
    // (set above, before _applyRoomType) so both it and any room banner are destroyed on rebuild.
    const entMarker = this.add
      .rectangle(desc.entrance.x, desc.entrance.y, TILE_SIZE * 0.5, TILE_SIZE * 1.4, biome.colors.entrance)
      .setAlpha(0.55)
    this._levelObjects.push(entMarker)

    // ── Enemies, ARCHETYPE-PICKED + DEPTH-SCALED (design §6.4/§6.6.4, Decision 45/68, AC45/AC59) ── each
    // spawn picks an archetype off the biome's weighted enemyPool via a FRESH seeded RNG (NOT the
    // generator's pinned draw sequence — so the level pin + determinism deep-equal stay intact, the
    // §6.5/§6.6.4 discipline) and then scaleSpec()s THAT archetype by scaleAtDepth(depth) — a NEW spec
    // per spawn, never mutating the shared config spec (the aliasing bug Decision 45 avoids). Patrol
    // bounds come FROM the generator (Decision 41 — the OWNING run's world span).
    const scale = scaleAtDepth(this.runState.depth)
    const archetypeRng = mulberry32((desc.seed ^ 0xa11ce5 ^ this.runState.depth) >>> 0) // off-the-pin RNG.
    // ── ELITE roll RNG (§6.11, Decision 77, AC64; round-3 weighted set) ── a SEPARATE off-the-pin seeded
    // RNG (a distinct mix constant so the elite roll doesn't correlate with the archetype pick) — a run
    // replays the same elites AND the same affix per elite. _rollElite returns ONE weighted affix from
    // ELITE_AFFIXES (frost/explosive/regenerating/fast) or null; _spawnEnemy folds it into the enemy (more
    // HP, a tinted body, a per-affix gimmick). The elite is applied AFTER the depth scaleSpec, so a deep
    // elite is depth-scaled THEN affix-multiplied (tankier with depth AND elite — the right stacking).
    const eliteRng = mulberry32((desc.seed ^ 0xe117e0 ^ this.runState.depth) >>> 0)
    for (const e of desc.enemies) {
      const base = this._pickArchetype(biome, archetypeRng)
      const spec = scaleSpec(base, scale)
      this._spawnEnemy(e.x, e.y, spec, { patrolMinX: e.patrolMinX, patrolMaxX: e.patrolMaxX, worldDesc: desc, elite: this._rollEliteForRoom(eliteRng) })
    }

    // ── enemyCountBonus (design §6.4, Decision 45 / review MAJOR — IMPLEMENTABLE source) ── at depth,
    // add a few EXTRA enemies drawn from the generator's `spawnCandidates` surplus (standable cells not
    // already used by desc.enemies — the generator exposes them PURELY, so the scene never re-derives
    // standable geometry: the DRY violation the review flagged). Capped so the live count never exceeds
    // the biome's maxEnemies, and bounded by the surplus available (else simply fewer — never a no-op
    // claim). Each bonus spawn is the SAME scaled spec, so "more AND tankier enemies at depth" holds.
    // Round-2 (§6.15): a HORDE room type adds roomType.extraEnemies on TOP of the depth bonus (still capped
    // at the biome max + the surplus available), so a tagged horde reads as a real density spike.
    const liveCount = desc.enemies.length
    const roomExtra = this.roomType ? this.roomType.extraEnemies ?? 0 : 0
    const wantBonus = Math.min(scale.enemyCountBonus + roomExtra, Math.max(0, biome.maxEnemies - liveCount))
    for (let i = 0; i < wantBonus && i < desc.spawnCandidates.length; i++) {
      const e = desc.spawnCandidates[i]
      const base = this._pickArchetype(biome, archetypeRng) // same off-the-pin RNG (Decision 68).
      const spec = scaleSpec(base, scale)
      this._spawnEnemy(e.x, e.y, spec, { patrolMinX: e.patrolMinX, patrolMaxX: e.patrolMaxX, worldDesc: desc, elite: this._rollEliteForRoom(eliteRng) })
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

    // ── Sparse in-run shop (§6.10, Decision 74/76, AC63 — the GOLD SINK) ── a low FIXED per-level chance
    // to place ONE vendor, sourced SCENE-SIDE off the level seed (NOT the generator — keeps the level pin
    // intact, the same discipline as the weapon pickup). Placed at a standable spot off the entrance/exit.
    this._maybePlaceShop(desc)

    // ── Branch treasure reward (§6.14, Decision 80, AC67) ── if the generator emitted an optional treasure
    // branch (desc.branchTreasure), place a GUARANTEED reward (gold/scroll/weapon/heal) on its standable
    // ledge — the risk/reward payoff for taking the detour. Sourced SCENE-SIDE off the level seed (NOT a
    // generator pickup — the level pin stays intact, the weapon-pickup discipline). No-op if no branch.
    this._placeBranchReward(desc)

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
    // Enemies collide with solids — EXCEPT a flyer (its processCallback returns false so it passes
    // through floors/ledges and hovers; Decision 68/AC59, review MINOR). _enemyNotFlyer is the shared
    // predicate (a flyer's body has _noSolids set in _spawnEnemy).
    this._solidColliders.push(
      this.physics.add.collider(this.enemyHurtboxes, this.tileMap.solids, null, (enemyRect) => this._enemyNotFlyer(enemyRect), this),
    )
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
    // Enemies also respect the one-way platforms (land on top, pass up through) — same predicate, but a
    // FLYER passes through them too (it hovers — _enemyNotFlyer gates the collision).
    this._solidColliders.push(
      this.physics.add.collider(
        this.enemyHurtboxes,
        this.tileMap.oneWay,
        null,
        (enemyRect, platform) => {
          if (!this._enemyNotFlyer(enemyRect)) return false
          const eBody = enemyRect.body
          return eBody.velocity.y >= 0 && eBody.bottom <= platform.body.top + ONE_WAY_EPS
        },
        this,
      ),
    )

    // ── Normal-level HAZARDS as DAMAGING bodies (Enrichment round 3 — the environmental-threat fix) ──
    // The generator scatters HAZARD tiles into every room (biome.hazardPatches) but, until now, ONLY the
    // boss room promoted them to bodies — so in all 9 normal levels the spikes were render-only set dressing
    // with zero gameplay effect. Promote them to STATIC bodies here too + wire the SAME player×hazard overlap
    // the boss room uses (reusing _onHazardContact verbatim — DRY) so the platforming becomes a real risk
    // surface + the dodge-roll's i-frames matter for TRAVERSAL, not just combat. SAFE BY CONSTRUCTION: the
    // generator keeps hazards OFF the critical path AND out of the swept jump corridor (scatterHazards skips
    // the corridor mask), so a clean run is never forced onto spikes — they punish sloppy positioning only.
    // The collider + cooldown are the SAME fields the boss room uses (torn down by _teardownLevel's guards).
    this.tileMap.enableHazardBodies()
    this._hazardCooldown = 0 // s — gates the hazard contact tick (don't shred HP every frame).
    this._hazardCollider = this.physics.add.overlap(
      this.player.collider,
      this.tileMap.hazardBodies,
      () => this._onHazardContact(),
      () => this._hazardCooldown <= 0 && this.player.isHittable() && !this.gameOver,
      this,
    )

    // ── MINIBOSS set-piece (Enrichment round-2, §6.6.8) ── on a non-boss biome's LAST normal level, spawn the
    // biome's declared miniboss INTO this room (it still has its exit Door — the miniboss guards the way out but
    // isn't the finale's hard gate). It reuses the SAME Boss entity + scaleBossSpec depth fold + boss HP bar as
    // the finale, so the run gets an escalating climax per biome with zero engine change. No-op on levels without
    // a miniboss (the common case — the bare `if` keeps the normal-room path identical).
    if (this.runState.isMinibossLevel()) this._spawnMiniboss(desc)
  }

  // ── _spawnMiniboss(desc) (Enrichment round-2, §6.6.8) ── spawn the current biome's miniboss as a Boss entity
  // into the normal room, depth-scaled (scaleBossSpec — tankier + harder-hitting deeper, like the finale). It is
  // added to the SAME enemyHurtboxes group so the EXISTING player→enemy/projectile overlaps hit it (no new
  // wiring), draws its slam/dash from enemyHitboxes + its volley/sweep from enemyProjectilePool (Decision 64/65),
  // and shows the boss HP bar. Its death is NOT a run-end (unlike the finale): onBossDeath just clears the bar +
  // counts the kill. Placed at a standable spot near the EXIT so it guards the way out. this.boss is the live
  // miniboss for this level (teardown despawns it like any boss); this.isBossRoom stays FALSE (the Door logic +
  // hazard-as-normal-level path are unchanged — a miniboss room is a normal room with a guardian).
  _spawnMiniboss(desc) {
    const biome = this.runState.biome()
    const spec = BOSSES[biome.miniboss]
    if (!spec) return // defensive — an unknown id degrades to no miniboss (KISS, never throws).
    const bossSpec = scaleBossSpec(spec, scaleAtDepth(this.runState.depth))
    // Place it near the exit ledge (the guardian of the way out), feet on the exit platform. A miniboss is a
    // big body, so spawn its center where the exit door sits — the floor/platform collider settles it.
    const spawnX = desc.exit.x
    const spawnY = desc.exit.y
    this.boss = new Boss(this, spawnX, spawnY, bossSpec, this.enemyHitboxes, this.enemyProjectilePool, {
      minX: TILE_SIZE * 1.5,
      maxX: desc.worldWidth - TILE_SIZE * 1.5,
    })
    // A miniboss death is NOT a run-end — just clear the HP bar + count the kill (no Victory handoff).
    this.boss.onBossDeath = () => this._onMinibossDefeated()
    this.boss.onDeath = () => {
      this.runState.kills += 1
    }
    this.enemyHurtboxes.add(this.boss.collider) // the EXISTING player→enemy overlaps now hit the miniboss.

    // Show the boss HP bar for the miniboss (the set-piece reads). _emitHud refreshes it; _onMinibossDefeated /
    // teardown clear it so it never persists. NOTE: isBossRoom stays FALSE (the Door + normal-room path hold);
    // teardown clears the bar explicitly via this.boss handling + the _clearBossHud call below on death.
    this.registry.set('bossActive', true)
    this.registry.set('bossName', bossSpec.name)
    this.registry.set('bossHp', this.boss.hp)
    this.registry.set('bossMaxHp', this.boss.maxHp)
  }

  // ── _onMinibossDefeated() (Enrichment round-2, §6.6.8) ── the miniboss-kill edge: NOT a run-end (the run
  // continues — the exit Door is the gate). Just clear the boss HP bar so it doesn't linger, and a small camera
  // flourish so the kill reads. The kill count is bumped by the boss.onDeath hook (above). Guarded against a
  // double-fire by the boss's own dead flag (Boss fires onBossDeath once).
  _onMinibossDefeated() {
    this._clearBossHud()
    this.cameras.main.flash(220, 244, 208, 63) // a brief gold flash marks the set-piece clear.
  }

  // ── _enemyNotFlyer(enemyRect) ── the shared collider predicate (Decision 68/AC59): true for a normal
  // enemy (so it collides with solids/oneWay), false for a flyer (so it passes through + hovers). Reads
  // the per-body _noSolids flag set in _spawnEnemy. The boss is NOT a flyer (it walks the arena floor).
  _enemyNotFlyer(enemyRect) {
    const e = enemyRect.enemyRef
    return !(e && e._noSolids)
  }

  // ── _buildBossLevel() (design §6.6.3, Decision 66/67, AC56/AC57/AC58) ── build the boss ARENA: a flat
  // walled room (generateLevel with bossArena:true), the player at the central entrance (HP carried,
  // never refilled — same rule), the depth-scaled Boss at desc.bossSpawn, the live arena-hazard overlap,
  // and the boss HP bar. It places NEITHER a Door NOR a doorCollider (review MAJOR — so _teardownLevel's
  // `if (this.door)`/`if (this.doorCollider)` guards are safe AND the run-complete-via-Door path can
  // NEVER fire here — the boss is the gate, the COMPLETION-GATE note). The boss body is added to the
  // SAME enemyHurtboxes group so the EXISTING player→enemy/projectile overlaps hit it — no new wiring.
  _buildBossLevel() {
    const biome = this.runState.biome()
    // The boss arena is a DISTINCT pure generator branch (Decision 66) — a flat walled room with a
    // bossSpawn, hazards, NO normal enemies/pickups, NO real exit. Shallow-merge bossArena:true.
    const desc = generateLevel(this.runState.seed, { ...biome, bossArena: true })
    this.desc = desc
    this.tileMap = new TileMap(this, desc)
    this.isBossRoom = true // a flag the HUD-clear + teardown read (review MINOR — boss-bar lifecycle).
    // ── Reset the room-type state (round-3) ── the boss arena is NEVER tagged (it IS the set-piece), and it
    // does NOT call _applyRoomType. Reset roomType/roomDamageTakenMult to the neutral identity here so a
    // PREVIOUS level's CURSED debuff (_hurtPlayer) or lootMult (boss-add drops) can't leak into the boss room.
    this.roomType = ROOM_NORMAL
    this.roomDamageTakenMult = 1

    // Reposition the player at the central entrance (HP carried — Decision 46, never refilled here).
    this.player.body.reset(desc.entrance.x, desc.entrance.y)
    this.player.rect.setPosition(desc.entrance.x, desc.entrance.y)

    this._levelObjects = []
    const entMarker = this.add
      .rectangle(desc.entrance.x, desc.entrance.y, TILE_SIZE * 0.5, TILE_SIZE * 1.4, biome.colors.entrance)
      .setAlpha(0.55)
    this._levelObjects.push(entMarker)

    // ── Resolve WHICH boss (§6.12, Decision 78, AC65) ── biome.boss is now an ARRAY of ids (a single-id
    // string is still accepted — back-compat). Pick one off the RUN seed (a fresh off-the-pin mulberry32)
    // so a given run always faces the SAME boss (determinism — AC47) but different runs face a different
    // fight (the variety win). _pickBossId falls back to the Warden for an empty/unknown list (KISS).
    const bossId = this._pickBossId(biome.boss)
    // ── Spawn the Boss (depth-scaled — the boss biome is the DEEPEST, so this is the hardest, AC61). ──
    // scaleBossSpec (NOT the enemy scaleSpec) folds maxHp + every attack's damage by the curve so a
    // deeper boss is tankier AND hits harder (review MAJOR — the honest boss-scaling fold). The boss
    // draws its slam/dash from enemyHitboxes + its volley from enemyProjectilePool (Decision 64/65).
    const bossSpec = scaleBossSpec(BOSSES[bossId], scaleAtDepth(this.runState.depth))
    this.boss = new Boss(this, desc.bossSpawn.x, desc.bossSpawn.y, bossSpec, this.enemyHitboxes, this.enemyProjectilePool, {
      minX: TILE_SIZE * 1.5,
      maxX: desc.worldWidth - TILE_SIZE * 1.5,
    })
    this.boss.onBossDeath = () => this._onBossDefeated()
    this.boss.onDeath = () => {
      this.runState.kills += 1 // the boss counts as a kill for the summary.
    }
    this.enemyHurtboxes.add(this.boss.collider) // the EXISTING player→enemy overlaps now hit the boss.

    // ── Arena hazard (AC57, review BLOCKER #1) ── promote the arena's HAZARD tiles to STATIC bodies
    // (boss room ONLY — enableHazardBodies) so the player×hazards overlap can actually fire, then wire
    // that overlap to contact damage on a cooldown (reusing the contact-damage path). Outside the boss
    // room hazards stay render-only (this is the only call site), so normal levels aren't lethal.
    this.tileMap.enableHazardBodies()
    this._hazardCooldown = 0 // s — gates the hazard contact tick (don't shred HP every frame).
    this._hazardCollider = this.physics.add.overlap(
      this.player.collider,
      this.tileMap.hazardBodies,
      () => this._onHazardContact(),
      () => this._hazardCooldown <= 0 && this.player.isHittable() && !this.gameOver,
      this,
    )

    // ── NO Door (Decision 67) ── the boss IS the gate. We leave this.door / this.doorCollider null, so
    // _teardownLevel's guards skip them AND _onDoorOverlap/_nextLevel/_completeRun can never fire here.
    this.door = null
    this.doorCollider = null

    // ── Boss HP bar (AC56 readability, review MINOR) ── emit bossActive + bossHp/bossMaxHp to the
    // registry; the HUD shows the bar ONLY while bossActive is true. _emitHud refreshes bossHp each
    // frame; _onBossDefeated/_teardownLevel CLEAR bossActive so a stale bar never persists into the
    // next run (the registry survives scene restarts — the same stale-leak footgun HP already guards).
    this.registry.set('bossActive', true)
    this.registry.set('bossName', bossSpec.name)
    this.registry.set('bossHp', this.boss.hp)
    this.registry.set('bossMaxHp', this.boss.maxHp)

    // ── Level colliders (the player + the boss stand on the floor; pickups n/a here but harmless). ──
    this._solidColliders.push(this.physics.add.collider(this.player.collider, this.tileMap.solids))
    this._solidColliders.push(
      this.physics.add.collider(this.enemyHurtboxes, this.tileMap.solids, null, (enemyRect) => this._enemyNotFlyer(enemyRect), this),
    )
    this._solidColliders.push(this.physics.add.collider(this.pickupPool.group, this.tileMap.solids))

    // eslint-disable-next-line no-console
    console.log(`[GameScene] BOSS ROOM — ${bossSpec.name} (hp ${bossSpec.maxHp}) at depth ${this.runState.depth}`)
  }

  // ── _onHazardContact() (design §6.6.2, AC57; round-3 — now ALSO normal-level hazards) ── the hazard
  // contact tick: a fixed bite of damage on a cooldown (so standing on the spikes hurts but isn't an instant
  // kill). Reuses the player.onHit pipeline (a synthetic upward-knockback hit so the player is bumped off the
  // spikes). Used by BOTH the boss arena AND every normal level now that hazards are damaging bodies there
  // (the round-3 environmental-threat promotion) — the dodge-roll's i-frames matter for traversal too.
  _onHazardContact() {
    if (this._hazardCooldown > 0 || !this.player.isHittable() || this.gameOver) return
    this._hazardCooldown = 0.7 // s — min gap between hazard ticks.
    // A synthetic hit: a fixed damage + a pop straight up (knockback origin below the player so it's
    // shoved upward off the spikes). allowBackstab:false (a hazard never crits).
    const swing = { damage: HAZARD_DAMAGE, knockback: 0 }
    const attacker = { cx: this.player.body.center.x, facing: this.player.facing }
    const result = resolveHit(attacker, this.player.attackerShape, swing, { allowBackstab: false })
    result.knockbackY = -260 // override: pop straight up off the spikes.
    this._hurtPlayer(result) // scales by the CURSED-room damage-taken mult before onHit (round-3, §6.15).
    this.effects.hit(this.player.body.center.x, this.player.body.center.y, { damage: result.damage })
  }

  // ── _onBossDefeated() (design §6.6.3, Decision 67, AC58) ── the boss-kill run-end edge. Shares the
  // SAME guard ordering as _onPlayerDeath (review MAJOR — `if (this.gameOver) return` FIRST, then set
  // it), so a same-frame boss-death + player-death can't BOTH bank: whichever sets gameOver first wins,
  // the second early-returns. Banks the run ONCE via the SAME bankRun single-writer (cells + bestDepth;
  // gold/scrolls discarded — permadeath), clears the boss HP bar, snapshots the summary (completed:true),
  // and routes to Victory → Hub.
  _onBossDefeated() {
    if (this.gameOver) return
    this.gameOver = true
    this.runState.hp = this.player.hp // final carried-HP snapshot (kept consistent; summary ignores it).
    this.meta.bankRun({ cells: this.runState.cells, depth: this.runState.depth }) // the ONE bankRun writer.
    this._clearBossHud() // drop the boss HP bar so it never persists into the next run (review MINOR).
    // A short victory flourish (freeze/flash) then hand off to Victory with the run summary.
    this.hitstopTimer = 0.2
    this.cameras.main.flash(260, 88, 214, 141)
    const summary = this.runState.summary(this.time.now, true, this.runSeed)
    this.time.delayedCall(900, () => this.scene.start('Victory', summary))
  }

  // Clear the boss HP-bar registry keys (review MINOR — the registry survives scene restarts, so a
  // stale prior-run boss bar would otherwise flash on the next run's HUD until overwritten).
  _clearBossHud() {
    this.registry.set('bossActive', false)
    this.registry.set('bossHp', null)
    this.registry.set('bossMaxHp', null)
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
    const prevBiomeIndex = this.runState.biomeIndex // §6.9 — detect a biome ROLL across advance() (Decision 72).
    this.runState.advance()
    // ── Flask REFILL on a biome transition (§6.9, Decision 72) ── entering a NEW biome tops the flask
    // charges back to max (the "fountain at the new biome's start" — the genre's between-area heal valve).
    // HP itself is still CARRIED (never auto-refilled, Decision 46); the flasks are the player's CHOICE to
    // spend. This makes a damaged run survivable across biomes without trivialising the within-biome slide.
    if (this.runState.biomeIndex !== prevBiomeIndex) {
      this.runState.flasks = this.runState.maxFlasks
      // §6.5 (round-3) — entering a NEW biome arms a guaranteed POWER scroll so the run's own power curve
      // keeps pace with the rising difficulty (a "scroll of power" per biome — the in-run power-arc fix).
      this._grantBiomePowerScroll()
    }
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
    this.scene.start('GameOver', this.runState.summary(this.time.now, true, this.runSeed))
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
    // Boss-room teardown (§6.6.3): remove the hazard overlap + boss; clear the boss HP bar (review
    // MINOR — so a stale boss bar never persists into the next room/run).
    if (this._hazardCollider) {
      this.physics.world.removeCollider(this._hazardCollider)
      this._hazardCollider = null
    }
    if (this.boss) {
      this.enemyHurtboxes.remove(this.boss.collider, false, false)
      this.boss.forceDespawn()
      this.boss = null
      // Clear the boss HP bar whenever ANY boss (finale OR round-2 miniboss) is torn down — so leaving a
      // miniboss room via the Door (without killing it) never leaks a stale bar into the next room/run.
      this._clearBossHud()
    }
    if (this.isBossRoom) {
      this.isBossRoom = false
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
    // Shop teardown (§6.10) — close any open overlay (a transition can fire while shopping is impossible,
    // but be defensive), remove the in-range overlap + destroy the vendor so it never dangles into the next
    // level. shopOpen is forced false so the update() gate re-opens gameplay on the rebuilt level.
    if (this.shopOverlay) {
      this.shopOverlay.close()
      this.shopOverlay = null
    }
    this.shopOpen = false
    if (this._shopCollider) {
      this.physics.world.removeCollider(this._shopCollider)
      this._shopCollider = null
    }
    if (this.shop) {
      this.shop.destroy()
      this.shop = null
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
    this.enemyProjectilePool.releaseAll() // §6.6.3 — drop any in-flight enemy/boss shots on rebuild.
  }

  _updateHint() {
    if (!this.hint) return
    const rs = this.runState
    this.hint.setText(
      `MOVE arrows/WASD  JUMP Space  ATTACK J/click  DODGE Shift/K  SWAP R  [ESC] Title   |   ` +
        `DEPTH ${rs.depth} · ${rs.biome().name} ${rs.levelInBiome + 1}/${rs.biome().levels}  ` +
        // RUN seed (the shareable run id, Decision 71) + the live LEVEL seed. The run seed identifies the
        // WHOLE run (same run seed → same biome/level/layout chain — AC47); the level seed is its chained head.
        `run 0x${this.runSeed.toString(16)}  level 0x${rs.seed.toString(16)}  →reach the yellow DOOR`,
    )
  }

  // ── _resolveSeed(data) (design §6.9, Decision 71 — the replayability fix) ── prefer a seed PASSED IN by
  // the Hub (a shared seed a player typed, or the Hub's own entropy mint), coercing it to an unsigned 32-bit
  // int; else mint a fresh seed from REAL ENTROPY (Date.now ⊕ a random draw ⊕ a high-res clock if present)
  // so every launch — even a bare dev `scene.start('Game')` — produces a DIFFERENT run. This is the ONLY
  // entropy source in the run path; the pure modules stay deterministic (they take the resolved seed in).
  _resolveSeed(data) {
    if (data && Number.isFinite(data.seed)) return data.seed >>> 0
    return GameScene.mintSeed()
  }

  // Mint a fresh unsigned-32-bit run seed from entropy (Decision 71). Static so HubScene can reuse the SAME
  // mint (DRY — one entropy recipe). Mixes Date.now, a Math.random draw, and (when available) performance.now
  // so two runs started in the same millisecond still diverge. The >>>0 keeps it an unsigned 32-bit int —
  // exactly the shape RunState's seed chain expects (so the chained level seeds stay byte-stable per run).
  static mintSeed() {
    const t = Date.now()
    const r = Math.floor(Math.random() * 0x100000000)
    const hi = typeof performance !== 'undefined' && performance.now ? Math.floor(performance.now() * 1000) : 0
    return ((t ^ r ^ hi) >>> 0) || 1 // never 0 (a degenerate seed); 1 is a fine fallback.
  }

  // ── _pickArchetype(biome, rng) (design §6.6.4, Decision 68, AC59) ── pick a base archetype spec off
  // the biome's WEIGHTED enemyPool via the passed FRESH seeded RNG (off the generator's pinned draw, so
  // the level pin is untouched). Returns the PURE config spec (config/enemies.js) for the chosen id; the
  // caller scaleSpec()s it (a NEW per-spawn spec). Falls back to GRUNT for an unknown/empty pool (KISS).
  _pickArchetype(biome, rng) {
    const pool = biome.enemyPool && biome.enemyPool.length ? biome.enemyPool : [{ id: 'grunt', w: 1 }]
    const total = pool.reduce((s, e) => s + (e.w || 1), 0)
    let r = rng() * total
    for (const entry of pool) {
      r -= entry.w || 1
      if (r <= 0) return ENEMY_SPECS[entry.id] || ENEMY_SPECS.grunt
    }
    return ENEMY_SPECS[pool[pool.length - 1].id] || ENEMY_SPECS.grunt
  }

  // ── _rollElite(rng) (design §6.11, Decision 77, AC64; round-3 weighted set) ── roll an ELITE affix off
  // the passed seeded RNG: ELITE_CHANCE of the time pick ONE affix from the weighted ELITE_AFFIXES set
  // (frost/explosive/regenerating/fast — Enemy folds it), else null (a normal enemy — the identity). The
  // weighted pick uses the SAME idiom as _pickArchetype (DRY). Off the seeded eliteRng so a run replays the
  // same elites AND the same affix per elite (determinism — AC47). Two draws (the gate, then the pick) keep
  // the affix deterministic given the seed; both come off the dedicated eliteRng thread (off the level pin).
  _rollElite(rng) {
    if (rng() >= ELITE_CHANCE) return null // not an elite this spawn (the common case — identity).
    const total = ELITE_AFFIXES.reduce((s, e) => s + (e.w || 1), 0)
    let r = rng() * total
    for (const entry of ELITE_AFFIXES) {
      r -= entry.w || 1
      if (r <= 0) return entry.affix
    }
    return ELITE_AFFIXES[ELITE_AFFIXES.length - 1].affix // fallthrough (float rounding) → the last affix.
  }

  // ── _rollWeaponAffix(rng) (Enrichment round-2 — the build engine; mirrors _rollElite) ── roll a WEAPON
  // affix off the passed seeded RNG: WEAPON_AFFIX_CHANCE of the time pick ONE affix from the weighted
  // WEAPON_AFFIXES set (keen/heavy/swift/vampiric/venomous), else null (a plain weapon — the identity).
  // The weighted pick uses the SAME idiom as _pickArchetype/_rollElite (DRY). Off the seeded RNG so a run
  // replays the same affixes. Returns the affix ID (a scalar stamped on the pickup + carried on RunState),
  // or null. Two draws (the gate, then the pick) keep the affix deterministic given the seed.
  _rollWeaponAffix(rng) {
    if (rng() >= WEAPON_AFFIX_CHANCE) return null // a plain weapon this roll (the common-enough identity).
    const total = WEAPON_AFFIXES.reduce((s, e) => s + (e.w || 1), 0)
    let r = rng() * total
    for (const entry of WEAPON_AFFIXES) {
      r -= entry.w || 1
      if (r <= 0) return entry.affix.id
    }
    return WEAPON_AFFIXES[WEAPON_AFFIXES.length - 1].affix.id // float-rounding fallthrough → the last affix.
  }

  // ── _equipWeaponWithAffix(weaponId, affixId) (Enrichment round-2; round-3 item 3 — slot-aware) ── resolve
  // the base weapon + the rolled affix to a FOLDED weapon (foldWeaponAffix — a fresh object, never mutating
  // the shared config) and equip it into the chosen SLOT, recording BOTH ids on RunState so a level rebuild
  // re-folds the SAME weapon (the carry discipline the bare weaponId already follows). affixId null → the
  // plain weapon (identity). Used by the pickup + shop + branch-reward paths (DRY — one equip-with-affix site).
  //
  // SLOT CHOICE (round-3 item 3 — the build decision): a found/bought weapon fills the SECONDARY slot when it
  // is UNLOCKED and EMPTY (so the first pickup ADDS a moveset rather than replacing the starter — carry
  // melee+ranged); otherwise it replaces the ACTIVE slot (the round-2 behaviour, and the only behaviour on a
  // single-slot run — the identity). Returns the folded weapon (for any caller use).
  _equipWeaponWithAffix(weaponId, affixId) {
    const base = WEAPONS[weaponId]
    if (!base) return null
    const affix = affixId ? WEAPON_AFFIXES_BY_ID[affixId] : null
    const folded = foldWeaponAffix(base, affix)
    // Decide the slot: fill the empty SECONDARY when the 2nd slot is unlocked + empty (a build add); else
    // the active slot (replace — the single-slot identity path). secondSlotUnlocked is false on a fresh run.
    const fillSecondary = this.player.secondSlotUnlocked && !this.runState.weaponId2 && this.player.activeWeaponIndex === 0
    if (fillSecondary) {
      this.player.equipToSlot(folded, 1) // fill the empty secondary without disturbing the active weapon.
      this.runState.weaponId2 = weaponId
      this.runState.weaponAffixId2 = affix ? affix.id : null
    } else {
      this.player.equipWeapon(folded) // replace the active slot (resets the combo — Decision 63).
      // Record onto whichever slot is active so a rebuild re-folds it (round-3 carry discipline).
      if (this.player.activeWeaponIndex === 1) {
        this.runState.weaponId2 = weaponId
        this.runState.weaponAffixId2 = affix ? affix.id : null
      } else {
        this.runState.weaponId = weaponId
        this.runState.weaponAffixId = affix ? affix.id : null
      }
    }
    return folded
  }

  // ── _swapWeapon() (round-3 item 3 — the SWAP key handler) ── toggle the player's active weapon slot. A
  // no-op on a single-slot run / when the 2nd slot is empty (Player.swapWeapon returns false). On a real
  // swap, pop a small tell (a confirm flash + spark) so the moveset change reads, and the HUD weapon label
  // refreshes next _emitHud. Guarded against firing during a death/transition/shop (the update gate already
  // blocks those — this is only reached inside the active branch).
  _swapWeapon() {
    if (this.player.swapWeapon()) {
      this.cameras.main.flash(120, 174, 214, 241) // a faint blue pulse marks the weapon swap.
      this.effects.hit(this.player.body.center.x, this.player.body.center.y, { damage: 0 })
    }
  }

  // ── _applyRoomType(desc) (Enrichment round-2, §6.15) ── roll a tagged ROOM TYPE off the LEVEL seed (a
  // fresh sub-RNG, OFF the generator's pinned draw — the weapon-pickup/shop discipline) and arm its effects
  // for this level. A miniboss level is NEVER tagged (it already IS the set-piece). Sets this.roomType (read
  // by the spawn loop for forceElite/extraEnemies + the drop/reward sites for lootMult/guaranteedReward) and
  // this.roomDamageTakenMult (read at the player-hit sites — the cursed-room debuff). Pops a banner + a camera
  // flash so the type READS on entry. A 'normal' roll is the identity (no banner, neutral mults).
  _applyRoomType(desc) {
    this.roomType = ROOM_NORMAL // the identity until a non-normal type is rolled.
    this.roomDamageTakenMult = 1 // the cursed-room debuff (1 = neutral); reset every level here.
    // A miniboss level is its OWN set-piece — never ALSO tag it (it would double the difficulty spike).
    if (this.runState.isMinibossLevel()) return
    const rng = mulberry32((desc.seed ^ 0x4001ed) >>> 0) // distinct mix from the weapon/shop RNGs.
    this.roomType = this._pickRoomType(rng)
    if (this.roomType.playerDamageTakenMult) this.roomDamageTakenMult = this.roomType.playerDamageTakenMult
    // A guaranteed bonus reward on entry (the carrot for the harder/cursed room), scaled by lootMult — placed
    // at a standable spawn candidate off the entrance so it's reachable but not underfoot at spawn.
    if (this.roomType.guaranteedReward) this._placeRoomReward(desc, this.roomType)
    // Banner + flash so the room type reads (a brief tell). 'normal' has an empty name → no banner.
    if (this.roomType.name) this._popRoomBanner(this.roomType)
  }

  // ── _pickRoomType(rng) ── weighted seeded pick over ROOM_TYPES (the SAME idiom as _pickArchetype/_rollElite
  // — DRY). 'normal' has the highest weight so most rooms are untagged (the tags read as a spike). Returns the
  // room-type object (never null — 'normal' is the fallback).
  _pickRoomType(rng) {
    const total = ROOM_TYPES.reduce((s, e) => s + (e.w || 1), 0)
    let r = rng() * total
    for (const entry of ROOM_TYPES) {
      r -= entry.w || 1
      if (r <= 0) return entry.type
    }
    return ROOM_NORMAL // float-rounding fallthrough → normal (the identity).
  }

  // ── _rollEliteForRoom(eliteRng) (round-2, §6.15) ── the room-aware elite roll: in an ELITE ARENA room
  // (roomType.forceElite) EVERY spawn is an elite (skip the chance gate — pick a weighted affix directly off
  // eliteRng so a run still replays the same affixes); otherwise the normal _rollElite (the ELITE_CHANCE gate).
  // KISS: forceElite consumes ONE eliteRng draw for the affix pick (vs _rollElite's two — the gate + the pick),
  // which is fine because the elite room's spawn sequence is its own deterministic thread per seed.
  _rollEliteForRoom(eliteRng) {
    if (this.roomType && this.roomType.forceElite) {
      const total = ELITE_AFFIXES.reduce((s, e) => s + (e.w || 1), 0)
      let r = eliteRng() * total
      for (const entry of ELITE_AFFIXES) {
        r -= entry.w || 1
        if (r <= 0) return entry.affix
      }
      return ELITE_AFFIXES[ELITE_AFFIXES.length - 1].affix
    }
    return this._rollElite(eliteRng)
  }

  // ── _placeRoomReward(desc, roomType) (round-2, §6.15) ── place the room type's guaranteed bonus reward (a
  // fat gold or a run-only scroll), scaled by lootMult, at a standable spawn candidate off the entrance. Off a
  // fresh seeded RNG (off the pin — the weapon-pickup discipline). A real pooled pickup (DRY — the same pool).
  _placeRoomReward(desc, roomType) {
    const rng = mulberry32((desc.seed ^ 0x4e7a4d) >>> 0)
    const spot =
      desc.spawnCandidates[Math.floor(rng() * desc.spawnCandidates.length)] ||
      desc.pickups[0] ||
      { x: (desc.entrance.x + desc.exit.x) / 2, y: desc.entrance.y }
    const x = spot.x
    const y = spot.y - TILE_SIZE
    const mult = roomType.lootMult ?? 1
    if (roomType.guaranteedReward === 'scroll') {
      const scrollId = SCROLL_IDS[Math.floor(rng() * SCROLL_IDS.length)]
      this.pickupPool.acquire(x, y, 'scroll', { scrollId })
    } else {
      // A fat gold payout scaled by the room's lootMult (a richer reward for the harder room).
      this.pickupPool.acquire(x, y, 'gold', { amount: Math.round(20 * mult) })
    }
  }

  // ── _popRoomBanner(roomType) (round-2, §6.15) ── a brief camera-fixed banner + a tinted flash so the room
  // type READS on entry (a primitive text tell — programmer-art). Destroyed on level rebuild via _levelObjects.
  _popRoomBanner(roomType) {
    this.cameras.main.flash(260, (roomType.bannerColor >> 16) & 0xff, (roomType.bannerColor >> 8) & 0xff, roomType.bannerColor & 0xff)
    const banner = this.add
      .text(this.cameras.main.width / 2, 70, roomType.name, {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(120)
    this._levelObjects.push(banner)
    // Fade the banner out after a beat so it doesn't clutter the fight (a 1.6s tell, then gone).
    this.tweens.add({ targets: banner, alpha: 0, delay: 1200, duration: 600 })
  }

  // ── _pickBossId(bossField) (design §6.12, Decision 78, AC65) ── resolve the boss biome's `boss` field to
  // ONE boss id. Accepts an ARRAY of ids (the multi-boss form) — picks one off the RUN seed (a fresh
  // off-the-pin mulberry32) so a run replays the same boss but different runs vary — OR a single string
  // (back-compat). Falls back to the Warden for an empty/unknown list (KISS, never throws). Only known ids
  // (present in BOSSES) are eligible, so a typo degrades gracefully to the first valid id, else the Warden.
  _pickBossId(bossField) {
    const ids = (Array.isArray(bossField) ? bossField : [bossField]).filter((id) => BOSSES[id])
    if (ids.length === 0) return 'rampartsBoss' // defensive default (always present).
    const rng = mulberry32((this.runSeed ^ 0xb055ed) >>> 0) // off-the-pin: a run replays the same boss.
    return ids[Math.floor(rng() * ids.length)]
  }

  // Spawn an Enemy: build it (its melee strike draws from the shared enemyHitboxes pool, Decision 30;
  // the SHOOTER fires from the enemyProjectilePool, Decision 65), register its collider body as a
  // hurtbox, wire the kill-count + Cells-DROP hooks, and track it. A FLYER (spec.noGravity) opts OUT of
  // the per-level solids/oneWay colliders (review MINOR — it isn't pulled by the group default + doesn't
  // stand on the floor; its body gravity is off in the Enemy ctor) and patrols the WHOLE arena width.
  _spawnEnemy(x, y, spec, { patrolMinX, patrolMaxX, worldDesc, elite = null } = {}) {
    // A flyer ignores the pit — its patrol bounds are the whole interior width (Decision 68/AC59).
    if (spec.noGravity && worldDesc) {
      patrolMinX = TILE_SIZE * 1.5
      patrolMaxX = worldDesc.worldWidth - TILE_SIZE * 1.5
    }
    const enemy = new Enemy(this, x, y, spec, this.enemyHitboxes, {
      patrolMinX,
      patrolMaxX,
      projectilePool: this.enemyProjectilePool,
      elite, // §6.11 (Decision 77) — null for a normal enemy, the ELITE_AFFIX for an elite spawn.
    })
    enemy.onDeath = () => {
      this.runState.kills += 1 // bump the run's kill count for the GameOver summary (free; AC46).
    }
    // ── Cells/loot drop hook (§6.5, Decision 54, AC48) ── on death the Enemy fires this with the
    // captured death-center coords + the Cell count; we spawn pooled pickups there (a Cell always +
    // a gold/scroll chance). The coords are captured in Enemy._die BEFORE the body is disabled (the
    // review BLOCKER fix). Enemy stays self-contained (no pool import — just this callback).
    // §6.15 (round-3 BUG fix) — thread the ROOM's lootMult into the per-kill drop so an ELITE/HORDE/CURSED
    // room is actually RICHER to clear, not just on entry: lootMult boosts the cell count + the gold drop
    // (Pickup.spawnDrop). roomType is null on a miniboss level / before _applyRoomType → default 1 (identity,
    // a normal room drops exactly as before). Read at fire time so a level's tag applies to every kill in it.
    enemy.onDrop = (dropX, dropY, count) =>
      this.pickupPool.spawnDrop(dropX, dropY, this.runState.depth, count, this.roomType ? this.roomType.lootMult ?? 1 : 1)
    this.enemyHurtboxes.add(enemy.collider)
    // FLYER: exclude its body from the solids/oneWay colliders so it isn't stopped by / standing on the
    // floor (it hovers). The collider was added to enemyHurtboxes above (so player hits still land); the
    // per-level solid colliders are registered against the WHOLE group, so we tell Arcade to ignore this
    // body by disabling its world gravity (done in the ctor) AND parking it OUT of the solids check via a
    // per-body flag the collider's processCallback respects (see the oneWay/solid colliders below).
    enemy._noSolids = !!spec.noGravity
    this.enemies.push(enemy)
    return enemy
  }

  // ── spawnBossAdds(boss, atk) (Enrichment round 3 — the boss 'summon' kind, §6.6) ── the SCENE HOOK the
  // Boss calls when it casts a 'summon' attack: spawn `atk.count` enemy adds of `atk.spec` near the boss,
  // depth-scaled by the CURRENT depth (scaleSpec — the SAME fold every spawn uses, DRY), capped so the LIVE
  // add count never exceeds atk.maxAdds (a long boss fight can't snowball into an unwinnable swarm). The adds
  // are TAGGED (_bossAdd) so the cap counts only summoned adds (not any pre-existing room enemies), and they
  // route through _spawnEnemy so they join enemyHurtboxes + get the kill/drop hooks with ZERO extra wiring.
  // Placed flanking the boss on its floor (alternating sides) so they appear beside it, not on top of the
  // player. KISS: a fair grunt add (the spec's archetype), no patrol bounds fuss (full-arena patrol via the
  // boss's own bounds). Defensive: an unknown spec id degrades to the grunt (never throws).
  spawnBossAdds(boss, atk) {
    const liveAdds = this.enemies.reduce((n, e) => n + (e._bossAdd && !e.dead && !e.removed ? 1 : 0), 0)
    const maxAdds = atk.maxAdds ?? 3
    const want = Math.min(atk.count ?? 1, Math.max(0, maxAdds - liveAdds))
    if (want <= 0) return // already at the live-add cap — the summon fizzles (the snowball guard).
    const base = ENEMY_SPECS[atk.spec] || ENEMY_SPECS.grunt
    const spec = scaleSpec(base, scaleAtDepth(this.runState.depth))
    const desc = this.desc
    const minX = TILE_SIZE * 2
    const maxX = (desc ? desc.worldWidth : boss.maxX + TILE_SIZE * 2) - TILE_SIZE * 2
    for (let i = 0; i < want; i++) {
      // Flank the boss alternately left/right so adds appear beside it (clamped into the arena interior).
      const side = i % 2 === 0 ? -1 : 1
      const x = Phaser.Math.Clamp(boss.body.center.x + side * (boss.spec.bodyW * 0.5 + TILE_SIZE), minX, maxX)
      const y = boss.body.center.y
      const add = this._spawnEnemy(x, y, spec, { patrolMinX: minX, patrolMaxX: maxX, worldDesc: desc })
      add._bossAdd = true // tag so the live-add cap counts only summoned adds (not room enemies).
    }
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
    // Enrichment round-2 — roll a weapon AFFIX off the SAME level RNG (deterministic; a run replays the same
    // affixed loot). Stamped on the pickup so collection folds + equips the modified weapon (the build engine).
    const weaponAffixId = this._rollWeaponAffix(rng)
    // Place it at a spawn spot away from the entrance (the first pickup point, or the level midpoint).
    const spot = desc.pickups[0] || { x: (desc.entrance.x + desc.exit.x) / 2, y: desc.entrance.y }
    this.pickupPool.acquire(spot.x, spot.y - TILE_SIZE, 'weapon', { weaponId, weaponAffixId })
  }

  // ── _maybePlaceShop(desc) (§6.10, Decision 74/76, AC63 — the GOLD SINK) ── deterministically (off the
  // level seed) maybe place ONE Shop vendor so collected gold has a regular outlet. Off a fresh mulberry32
  // (a DIFFERENT mix constant than the weapon pickup's, so the two rolls don't correlate) — NOT on the
  // generator's pinned draw, so the level pin stays intact. Placed at a standable spawn candidate AWAY from
  // the entrance/exit (so the player can't sit on it at spawn / clip the door), else the level midpoint.
  // Wires the in-range overlap so pressing E opens the buy menu (_tryOpenShop → _openShop). this.shop is
  // null on levels without a vendor (the _tryOpenShop guard handles that) + on the boss arena (no shop).
  _maybePlaceShop(desc) {
    const rng = mulberry32((desc.seed ^ 0x5409ca5) >>> 0) // distinct mix from the weapon-pickup RNG.
    if (rng() >= SHOP_LEVEL_CHANCE) return
    // Pick a standable spot off the critical-path ends: a generator spawn candidate (already away from the
    // entrance by ENTRANCE_SAFE_TILES + never the exit cell) keeps the vendor reachable but not underfoot.
    // Fall back to a pickup point, then the level midpoint, so a vendor is always placeable.
    const spot =
      desc.spawnCandidates[Math.floor(rng() * desc.spawnCandidates.length)] ||
      desc.pickups[0] ||
      { x: (desc.entrance.x + desc.exit.x) / 2, y: desc.entrance.y }
    this.shop = new Shop(this, spot)
    this._shopCollider = this.physics.add.overlap(
      this.player.collider,
      this.shop.rect,
      () => this.shop && this.shop.markInRange(), // flag the in-range frame (reset each tick — see update).
      () => !this.shopOpen && !this.transitioning && !this.gameOver,
      this,
    )
  }

  // ── _placeBranchReward(desc) (§6.14, Decision 80, AC67) ── place a GUARANTEED reward on the optional
  // treasure branch's ledge (desc.branchTreasure), if the generator emitted one. Sourced SCENE-SIDE off a
  // fresh seeded RNG (off the generator's pinned draw — the level-pin discipline) so the reward TYPE is
  // deterministic per seed (a run replays the same loot). The reward is a real pooled pickup (the same pool
  // every drop uses — DRY): a guaranteed gold/scroll/weapon/heal, weighted toward the run-only economy so
  // the detour pays into the run. No-op when there is no branch (narrow grids / the boss arena → null).
  _placeBranchReward(desc) {
    const spot = desc.branchTreasure
    if (!spot) return // no branch this level (narrow grid / boss arena) → nothing to place.
    const rng = mulberry32((desc.seed ^ 0x7ea5e0) >>> 0) // off-the-pin reward RNG (a run replays the loot).
    const roll = rng()
    // The treasure ledge sits a tile above the platform top; spawn the pickup just above it so it arcs +
    // settles onto the ledge (the pool's gravity + the solids collider — same as every other pickup).
    const x = spot.x
    const y = spot.y - TILE_SIZE
    if (roll < 0.34) {
      // A weapon to try (the build-defining reward) — a weapon NOT currently equipped (a real swap), with a
      // ROLLED affix (round-2 — the treasure-branch weapon is the prime spot for an exciting modified weapon).
      const choices = WEAPON_PICKUP_POOL.filter((id) => id !== this.runState.weaponId)
      const pool = choices.length ? choices : WEAPON_PICKUP_POOL
      const weaponId = pool[Math.floor(rng() * pool.length)]
      const weaponAffixId = this._rollWeaponAffix(rng)
      this.pickupPool.acquire(x, y, 'weapon', { weaponId, weaponAffixId })
    } else if (roll < 0.58) {
      // A run-only scroll boost (build power) — picks a deterministic scroll id off the same RNG.
      const scrollId = SCROLL_IDS[Math.floor(rng() * SCROLL_IDS.length)]
      this.pickupPool.acquire(x, y, 'scroll', { scrollId })
    } else if (roll < 0.8) {
      // A fat gold payout (5× a normal gold pickup) — feeds the in-run shop economy (the gold sink).
      this.pickupPool.acquire(x, y, 'gold', { amount: 25 })
    } else {
      // A heal pickup (a fountain/heart) — survivability for a damaged run that risked the detour.
      this.pickupPool.acquire(x, y, 'heal')
    }
  }

  // ── Combat overlap callbacks (design §6.3 — unchanged from the Combat phase) ──

  // ── _hurtPlayer(result) (Enrichment round 3 — the CURSED-room debuff fix, §6.15) ── the SINGLE player-
  // damage application point: scale the resolved hit's damage by this.roomDamageTakenMult (the per-room
  // debuff — 1.4 in a CURSED room, 1 everywhere else) BEFORE player.onHit. _applyRoomType SET this mult
  // but NOTHING read it, so the CURSED room (lootMult 2.0 + a guaranteed scroll) was pure upside — its
  // whole risk/reward design was inert. Routing all four player-hit sites (enemy melee / enemy contact /
  // enemy projectile / hazard) through here makes the curse bite (DRY — one place owns the scaling). The
  // mult only touches DAMAGE (not knockback) so the curse is purely "you take more damage", as designed.
  // Identity-safe: a normal room's mult is 1 → result.damage is unchanged (byte-identical to before).
  _hurtPlayer(result) {
    const mult = this.roomDamageTakenMult ?? 1
    if (mult !== 1) result.damage = Math.round(result.damage * mult)
    this.player.onHit(result)
  }

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
    // ── STATUS (§6.13, Decision 79, AC66; Venom scroll round 3) ── apply the EQUIPPED melee weapon's
    // status (spear → bleed, hammer → stun) to the struck enemy, scaled by the run-only status-duration
    // mult (Venom). Null for a weapon with no status tag (sword) → no-op (identity).
    enemy.applyStatus(this._scaleStatus(this.player.equippedWeapon.status))
    // ── LIFESTEAL (Vampirism scroll round 3 + Vampiric weapon affix round-2) ── heal a fraction of the MELEE
    // damage dealt. The scroll lifesteal (player.lifestealFrac) and the EQUIPPED weapon's affix lifesteal
    // (equippedWeapon.affixLifestealFrac — 0 on a plain/unaffixed weapon) ADD (a Vampiric weapon on a
    // Vampirism build sustains hard). 0 by default → no heal (the identity); heal() no-ops at full HP / dead.
    const lifesteal = this.player.lifestealFrac + (this.player.equippedWeapon.affixLifestealFrac ?? 0)
    if (lifesteal > 0 && result.damage > 0) {
      this.player.heal(Math.round(result.damage * lifesteal))
    }
    this.effects.hit(enemy.body.center.x, enemy.body.center.y, {
      damage: result.damage,
      isBackstab: result.isBackstab,
    })
  }

  // ── _scaleStatus(spec) (Enrichment round 3 — the Venom scroll) ── return a status spec whose `duration`
  // is scaled by the run-only scrollStatusDurationMult (mirrored on the player). Returns the spec UNCHANGED
  // when the mult is 1 (the identity — no scroll) or the spec is null (a no-status weapon), so a normal run
  // is byte-identical. A NEW shallow-clone is returned when scaled (never mutating the shared weapon spec —
  // the aliasing safety every fold keeps). applyStatus reads `duration`, so scaling it lengthens the DoT/stun.
  _scaleStatus(spec) {
    if (!spec) return spec
    const mult = this.player.statusDurationMult ?? 1
    if (mult === 1) return spec
    return { ...spec, duration: (spec.duration ?? 0) * mult }
  }

  // ── Projectile → enemy hit (§6.5, Decision 62, review MAJOR) ── a SEPARATE handler from the melee
  // one: the attacker shape is the PROJECTILE's (its live position + travel dir), so backstab/knockback
  // geometry derives from where the SHOT is — not the player. Reuses the SAME resolveHit + effects.hit
  // pipeline (DRY). This overlap is wired against the PLAYER projectile pool ONLY, so every shot here is
  // the player's: it scales with the RANGED damage mult (§6.9, Decision 73 — the bow rides the ranged-damage
  // meta, NOT the melee one) × the run-only scroll mult. The shot dies on first hit (KISS — no pierce); the
  // per-shot hitSet already deduped.
  _onProjectileHitEnemy(projRect, enemyRect) {
    const pj = projRect.pj
    const enemy = enemyRect.enemyRef
    if (!pj.active || !enemy || !enemy.isHittable() || pj.hitSet.has(enemy.id)) return
    pj.hitSet.add(enemy.id)
    // The projectile's spec carries damage/knockback (read like a swing row by resolveHit).
    const swing = { damage: pj.spec.damage, knockback: pj.spec.knockback }
    const result = resolveHit(pj.attackerShape, enemy.attackerShape, swing, {
      allowBackstab: true,
      damageMult: this.player.rangedDamageMult * this.player.scrollDamageMult,
    })
    enemy.onHit(result)
    // ── STATUS (§6.13, Decision 79, AC66; Venom scroll round 3) ── apply the firing weapon's status
    // stamped on the shot (the bow's poison) to the struck enemy, scaled by the run-only status-duration
    // mult (Venom). null for a no-status weapon → no-op (identity). It's read off the PROJECTILE (pj.status,
    // stamped at fire) so a mid-flight weapon swap doesn't change what the shot does.
    enemy.applyStatus(this._scaleStatus(pj.status))
    this.effects.hit(enemy.body.center.x, enemy.body.center.y, {
      damage: result.damage,
      isBackstab: result.isBackstab,
    })
    this.projectilePool.release(projRect) // KISS: the shot dies on first hit (no pierce).
  }

  // ── ENEMY projectile → player hit (§6.6.3, Decision 65, review BLOCKER/MAJOR) ── the INVERSE of
  // _onProjectileHitEnemy: an 'enemy'-tagged shot (Shooter/boss volley) hitting the PLAYER. Reads the
  // PROJECTILE's attackerShape (its live position + travel dir — NOT the firer's), builds a swing from
  // the shot's spec, resolves via the SAME resolveHit pipeline with allowBackstab:false + damageMult:1
  // (enemies NEVER get the player's melee/scroll mults — the review-pinned rule in damage.js), applies
  // it to the player, and releases the shot on hit. A per-shot hitSet dedup (already filtered) stops a
  // multi-frame-alive shot from re-hitting the player.
  _onEnemyProjectileHitPlayer(projRect) {
    const pj = projRect.pj
    if (!pj.active || !this.player.isHittable() || pj.hitSet.has(this.player.id)) return
    pj.hitSet.add(this.player.id)
    const swing = { damage: pj.spec.damage, knockback: pj.spec.knockback }
    const result = resolveHit(pj.attackerShape, this.player.attackerShape, swing, { allowBackstab: false })
    this._hurtPlayer(result) // scales by the CURSED-room damage-taken mult before onHit (round-3, §6.15).
    this.effects.hit(this.player.body.center.x, this.player.body.center.y, { damage: result.damage })
    this.enemyProjectilePool.release(projRect) // the shot dies on first hit (no pierce).
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
        // Enrichment round-2 — fold the rolled affix (pk.weaponAffixId, null = plain) into a FRESH weapon and
        // equip it (the build engine). _equipWeaponWithAffix records BOTH ids on RunState (carried/re-folded
        // on rebuild) + resets the combo. The live affixed weapon persists across rebuilds (the Player object
        // persists — only the world rebuilds), so the affix sticks for the rest of the run.
        this._equipWeaponWithAffix(pk.weaponId, pk.weaponAffixId)
        break
      }
      case 'heal': {
        // §6.9 (Decision 72) — a fountain/heart: restore a fraction of MAX HP on touch (no charge spent —
        // it's a found heal, distinct from the carried flask). A green heal pop reads the recovery.
        this.player.heal(Math.round(this.player.maxHp * (pk.healFrac || 0)))
        break
      }
    }
    // A small collect pop (reuse the spark pool — no new allocation).
    this.effects.hit(pickupRect.body.center.x, pickupRect.body.center.y, { damage: 0 })
    this.pickupPool.release(pickupRect)
  }

  // ── Sync run-only scroll stats onto the live Player (§6.5, Decision 60; Enrichment round 3) ──
  // scrollDamageMult is read LIVE at the hit site, but we mirror EVERY run-only scroll field onto the
  // player here so the live reads (dodge cooldown/i-frames at the dodge-start site, lifesteal + status
  // duration at the melee-hit site) see the armed values without reaching into RunState each frame.
  // scrollMaxHpBonus is a flat max-HP boost: raise the player's maxHp to base+bonus and HEAL by the
  // just-added amount (so a vitality scroll both grows + tops up). All other fields are neutral by
  // default (a fresh run with no scroll leaves the Phase-4 player exactly — the additive identity).
  _syncPlayerScrollStats() {
    this.player.scrollDamageMult = this.runState.scrollDamageMult
    this.player.scrollDodgeCdMult = this.runState.scrollDodgeCdMult
    this.player.scrollDodgeIframeBonus = this.runState.scrollDodgeIframeBonus
    this.player.lifestealFrac = this.runState.scrollLifestealFrac
    this.player.statusDurationMult = this.runState.scrollStatusDurationMult
    const newMax = this.runState.maxHp + this.runState.scrollMaxHpBonus
    const grew = newMax - this.player.maxHp // how much max-HP just increased (≥0).
    this.player.maxHp = newMax
    if (grew > 0) this.player.hp = Math.min(newMax, this.player.hp + grew) // heal by the grown amount.
  }

  // ── _drinkFlask() (design §6.9, Decision 72 — the HP-recovery valve) ── spend ONE flask charge to heal a
  // fraction of MAX HP. Guarded: no-op with no charges, while dead/transitioning, or already at full HP (so
  // a charge is never wasted on a no-heal — the heal() return is the truth). On a real heal: decrement the
  // charge, pop a green heal FX, flash the camera faint green. Flask charges REFILL on a biome transition
  // (_nextLevel) so HP management is a real per-biome resource decision (the genre's healing-flask loop).
  _drinkFlask() {
    if (this.gameOver || this.transitioning) return
    if (this.runState.flasks <= 0) return
    const amount = Math.round(this.player.maxHp * this.runState.flaskHealFrac)
    const healed = this.player.heal(amount)
    if (healed <= 0) return // already full → don't burn a charge.
    this.runState.flasks -= 1
    this.effects.hit(this.player.body.center.x, this.player.body.center.y - 10, { damage: 0 })
    this.cameras.main.flash(160, 46, 204, 113) // a faint green pulse so the heal reads.
  }

  // ── _tryOpenShop() (§6.10, Decision 74/76, AC63) ── open the in-run shop if the player is standing on
  // the vendor. Defined here so the update() interact-edge wiring has a single call site; the buy menu UI
  // lives in the ShopOverlay (_openShop news it up). Guards: no vendor on this level (this.shop null), not
  // in range, already open, or a death/transition in flight → no-op (the phantom-stub crash is gone — a
  // real Shop entity + a real _openShop now exist).
  _tryOpenShop() {
    if (this.gameOver || this.transitioning || this.shopOpen) return
    if (this.shop && this.shop.playerInRange) this._openShop()
  }

  // ── _openShop() (§6.10, Decision 74/76, AC63) ── freeze gameplay (shopOpen gates update) + raise the
  // buy overlay. The overlay is DECOUPLED (SOLID): it reads gold via getGold + attempts a buy via onBuy
  // (_buyShopItem deducts + applies) + resumes via onClose — so the economy logic stays in the scene. The
  // E press that opened it was consumed by Input.sample this frame, so the overlay's own keydown-E (buy)
  // fires only on the NEXT press (no instant-buy-on-open). Player velocity is zeroed so it doesn't drift
  // under the frozen overlay (gameplay update is gated, but the body would otherwise keep its momentum).
  _openShop() {
    if (this.shopOpen) return
    this.shopOpen = true
    this.player.body.setVelocity(0, 0)
    this.shopOverlay = new ShopOverlay(this, {
      getGold: () => this.runState.gold,
      onBuy: (item) => this._buyShopItem(item),
      onClose: () => this._closeShop(),
    })
  }

  // ── _closeShop() (§6.10) ── the overlay's onClose callback: drop the overlay handle + un-freeze gameplay.
  // (The overlay already destroyed its own GameObjects + removed its keyboard handlers in close().) Idempotent.
  _closeShop() {
    this.shopOpen = false
    this.shopOverlay = null
  }

  // ── _buyShopItem(item) (§6.10, Decision 74/76, AC63 — the GOLD SINK) ── attempt a purchase: if the run
  // can't afford item.price gold → false (the overlay re-renders the row red). Otherwise DEDUCT the gold
  // and APPLY the effect by `kind` (a small known set, like the Pickup handler — DRY: it reuses the SAME
  // heal/scroll/weapon paths). Run-only: gold + the bought boosts all die on death (permadeath). Returns
  // true on a successful buy. ONE place owns the economy (the overlay never touches RunState/Player).
  _buyShopItem(item) {
    if (!item || this.runState.gold < item.price) return false // can't afford → silent no-op (red row).
    // The flask cap (a touch above maxFlasks so a bought charge isn't instantly clamped, but bounded).
    const FLASK_BUY_CAP = this.runState.maxFlasks + 1
    // A heal/flask item only "sticks" if it does something (don't burn gold at full HP / a full flask) —
    // check BEFORE deducting so a no-op buy never charges (the same guard the flask DRINK uses).
    if (item.kind === 'heal') {
      const healed = this.player.heal(Math.round(this.player.maxHp * (item.healFrac || 0)))
      if (healed <= 0) return false // already full → don't charge for nothing.
    }
    if (item.kind === 'flask' && this.runState.flasks >= FLASK_BUY_CAP) return false // already capped → no charge.
    this.runState.gold -= item.price // deduct the run-only currency.
    switch (item.kind) {
      case 'heal':
        // (already applied above, before the deduct, so a no-heal never charges) — pop a green heal FX.
        this.cameras.main.flash(140, 46, 204, 113)
        break
      case 'flask':
        // +1 flask charge for THIS run (the genre's vendor flask refill) — bounded by FLASK_BUY_CAP (the
        // guard above already rejected a buy at the cap, so this always grants a charge).
        this.runState.flasks = Math.min(FLASK_BUY_CAP, this.runState.flasks + 1)
        break
      case 'scroll': {
        // Arm a random run-only scroll (same effect a scroll pickup grants — DRY via the SCROLLS table).
        const scroll = SCROLLS[Math.floor(Math.random() * SCROLLS.length)]
        if (scroll) scroll.apply(this.runState)
        this._syncPlayerScrollStats() // reflect a vitality scroll's max-HP bump on the live player.
        break
      }
      case 'weapon': {
        // Enrichment round-2 — a shop weapon also rolls an affix (off Math.random — shop buys are off the
        // seeded layout, like the scroll buy above; KISS) so a vendor weapon can be build-defining too.
        const affixId = this._rollWeaponAffix(Math.random.bind(Math))
        this._equipWeaponWithAffix(item.weaponId, affixId) // fold + equip + record on RunState (DRY).
        break
      }
    }
    // A small confirm pop at the player so the buy reads (reuse the spark pool — no new allocation).
    this.effects.hit(this.player.body.center.x, this.player.body.center.y, { damage: 0 })
    return true
  }

  // ── _applyStartingScrolls(n) (§6.9, Decision 73) ── apply `n` run-only scroll boosts at run start (a meta
  // tier's head-start on build variety). Deterministic off the RUN seed (a fresh mulberry32, NOT on any
  // pinned draw — same off-the-pin discipline as weapon pickups) so a seeded run replays the same scrolls.
  // n=0 → no-op (the identity case: a fresh meta plays exactly as before). Each scroll mutates RunState's
  // run-only mults in place; one sync reflects them on the live player. Run-only — never banked (permadeath).
  _applyStartingScrolls(n) {
    if (!n || n <= 0 || !SCROLL_IDS.length) return
    const rng = mulberry32((this.runSeed ^ 0x5c0011) >>> 0)
    for (let i = 0; i < n; i++) {
      const scroll = SCROLLS[Math.floor(rng() * SCROLLS.length)]
      if (scroll) scroll.apply(this.runState)
    }
    this._syncPlayerScrollStats() // reflect the armed run-only boosts on the live player NOW.
  }

  // ── _grantBiomePowerScroll() (Enrichment round 3 — the in-run power-arc fix, §6.5) ── arm ONE guaranteed
  // POWER scroll (Power or Vitality — the two stat-curve scrolls) at the START of every biome. THE GAP IT
  // CLOSES: Cells only bank at run END, so WITHIN a run the player never got reliably stronger except via
  // random weapon/scroll drops (SCROLL_DROP_CHANCE is only 0.12) — a run could feel like it was getting
  // WEAKER relative to the depth curve (the genre uses found "scrolls of power" per level to race the ramp).
  // A guaranteed power scroll per biome (4 biomes → +damage/+max-HP four times across a run) gives the run
  // its OWN visible power arc that races the rising difficulty. Deterministic off the RUN seed ⊕ the biome
  // index (a seeded run replays the same grant; off any pinned draw — the off-the-pin discipline). It mutates
  // RunState's run-only mults (NEVER banked — permadeath) then syncs the live player. Called at run start
  // (biome 0, in create()) and on each biome roll (_nextLevel) so EVERY biome's first room hands you power.
  _grantBiomePowerScroll() {
    // Only the stat-CURVE scrolls (power / vitality) — the ones that build the run's raw power, not the
    // identity scrolls (vampirism/venom/alacrity/endurance, which the random drops + shop still cover).
    const POWER_SCROLL_IDS = ['power', 'vitality']
    const rng = mulberry32((this.runSeed ^ 0x90 ^ (this.runState.biomeIndex * 0x9e3779b9)) >>> 0)
    const id = POWER_SCROLL_IDS[Math.floor(rng() * POWER_SCROLL_IDS.length)]
    const scroll = SCROLLS_BY_ID[id]
    if (!scroll) return
    scroll.apply(this.runState)
    this._syncPlayerScrollStats() // reflect the armed boost (a vitality scroll grows + tops up HP) live.
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
    this._hurtPlayer(result) // scales by the CURSED-room damage-taken mult before onHit (round-3, §6.15).
    this.effects.hit(this.player.body.center.x, this.player.body.center.y, { damage: result.damage })
  }

  _onEnemyContact(enemyRect) {
    const enemy = enemyRect.enemyRef
    if (!enemy || enemy.dead || enemy.contactCooldownTimer > 0 || !this.player.isHittable()) return
    enemy.contactCooldownTimer = enemy.spec.contactCooldown
    // The contact bite. An entity may expose contactDamage() to vary it dynamically — the BOSS returns
    // its DASH damage while dashing (a lunge that connects hits harder than a brush) and its base contact
    // otherwise (§6.6.1). A normal enemy has no contactDamage() method → fall back to spec.contactDamage.
    const dmg = typeof enemy.contactDamage === 'function' ? enemy.contactDamage() : enemy.spec.contactDamage
    const kb = typeof enemy.contactKnockback === 'function' ? enemy.contactKnockback() : CONTACT_KNOCKBACK
    const contactSwing = { damage: dmg, knockback: kb }
    const result = resolveHit(enemy.attackerShape, this.player.attackerShape, contactSwing, {
      allowBackstab: false,
    })
    this._hurtPlayer(result) // scales by the CURSED-room damage-taken mult before onHit (round-3, §6.15).
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
    const summary = this.runState.summary(this.time.now, false, this.runSeed)
    this.time.delayedCall(700, () => this.scene.start('GameOver', summary))
  }

  // ── _weaponLabel() (Enrichment round-2; round-3 item 3 — two-slot aware) ── the HUD weapon string: the
  // ACTIVE weapon name, plus the rolled affix name when affixed (e.g. "Sword ✦ Keen"). A plain weapon shows
  // just its name (the identity — a fresh run's "Sword" reads exactly as before). When a SECOND slot holds a
  // weapon, the inactive one is appended in muted brackets (e.g. "Bow ✦ Keen  [Sword]") so the swap target
  // reads on the HUD. One source so the HUD label is consistent.
  _weaponLabel() {
    const active = this.player.equippedWeapon
    const activeLabel = active.affixName ? `${active.name} ✦ ${active.affixName}` : active.name
    // The OTHER slot (round-3 item 3): show it bracketed as the swap target when present + the slot's unlocked.
    if (this.player.secondSlotUnlocked) {
      const other = this.player.weapons[this.player.activeWeaponIndex === 0 ? 1 : 0]
      if (other) {
        const otherLabel = other.affixName ? `${other.name} ✦ ${other.affixName}` : other.name
        return `${activeLabel}  [${otherLabel}] (R)`
      }
    }
    return activeLabel
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
    this.registry.set('weapon', this._weaponLabel())
    // §6.9 — live flask charges for the HUD's flask readout (the heal valve, Decision 72).
    this.registry.set('flasks', this.runState.flasks)
    this.registry.set('maxFlasks', this.runState.maxFlasks)
    // §6.6.3 (AC56, review MINOR) — refresh the boss HP bar while the boss lives; it's cleared on death/
    // teardown (_clearBossHud), and bossActive gates the HUD so a stale bar never persists into a run.
    if (this.boss && !this.boss.dead) this.registry.set('bossHp', this.boss.hp)
  }

  // ── Per-frame tick (design §6.1/§6.3 — the dt boundary + hit-stop) ──
  update(_time, delta) {
    const dt = Math.min(delta / 1000, MAX_DT)
    this.hitstopTimer = Math.max(0, this.hitstopTimer - dt)
    // GAMEPLAY dt: 0 during a hit-stop (the combat micro-freeze) OR while the shop overlay is up (a modal
    // pause) — so live hitboxes/projectiles/enemies all FREEZE together while shopping (§6.10), exactly as
    // they freeze during a hit-stop. FX still tick on REAL dt so the overlay's flashes/pops play.
    const gdt = this.hitstopTimer > 0 || this.shopOpen ? 0 : dt

    const inputState = this.input2.sample()
    // Hazard contact cooldown decays on REAL dt (a wall-clock gate on the spike bite, not gameplay).
    if (this._hazardCooldown > 0) this._hazardCooldown = Math.max(0, this._hazardCooldown - dt)
    // ── Shop in-range RESET (§6.10) ── clear the vendor's in-range flag BEFORE the physics step runs its
    // overlaps this frame (the overlap callback re-sets it true only while the bodies actually overlap). The
    // reset also drives the "[E] SHOP" prompt off the PREVIOUS frame's flag so the tell tracks the player.
    if (this.shop) this.shop.resetInRange()

    // Freeze gameplay during a death handoff OR a level transition (the rebuild is mid-flight) OR while the
    // shop overlay is up (a modal pause), but keep ticking FX so the flash/pop plays out.
    if (!this.gameOver && !this.transitioning && !this.shopOpen) {
      // Latch the attack edge BEFORE the player tick so update()'s step (1.5) resolves it this frame
      // (the Player's attack() only sets intent; update dispatches melee/ranged off the equipped weapon
      // — §6.3/§6.5 Decision 25/61). Sampled as an EDGE in Input (JustDown / pointer edge) so a held
      // key/click fires exactly once per press.
      if (inputState.attackPressed) this.player.attack()
      // §6.9 — drink a healing flask (Q, Decision 72) / open the shop (E, Decision 74). Both are one-shot
      // edges sampled in Input; resolved BEFORE the player tick so a heal/shop-open lands this frame.
      if (inputState.healPressed) this._drinkFlask()
      if (inputState.interactPressed) this._tryOpenShop()
      if (inputState.swapPressed) this._swapWeapon() // round-3 (item 3) — toggle the active weapon slot.
      this.player.update(gdt, inputState)
      for (const enemy of this.enemies) enemy.update(gdt, { player: this.player, effects: this.effects })
      // Boss tick (§6.6.3) — same (gdt, ctx) contract as Enemy so the hit-stop boundary is identical.
      if (this.boss && !this.boss.removed) this.boss.update(gdt, { player: this.player, effects: this.effects })
    }

    this.playerHitboxes.tick(gdt)
    this.enemyHitboxes.tick(gdt)
    // Projectiles tick on the GAMEPLAY dt so they FREEZE with the world during a hit-stop (Decision
    // 26/62) — consistent with hitboxes/enemies. Pickups settle on REAL dt (cosmetic — keep their visual
    // glued to the gravity-driven body even during a freeze).
    this.projectilePool.tick(gdt)
    this.enemyProjectilePool.tick(gdt) // §6.6.3 — the enemy/boss shots, same hit-stop boundary.
    this.pickupPool.tick()

    if (this.enemies.some((e) => e.removed)) {
      this.enemies = this.enemies.filter((e) => !e.removed)
    }

    this.effects.tick(dt)
    this._emitHud()
  }
}
