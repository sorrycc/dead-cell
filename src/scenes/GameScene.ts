import Phaser from 'phaser'
import { GRAVITY, UI_FONT } from '../config/constants.js'
import { Input } from '../core/Input.js'
import { Player } from '../entities/Player.js'
import { Enemy } from '../entities/Enemy.js'
import { Boss } from '../entities/Boss.js'
import { Door } from '../entities/Door.js'
import { Shop } from '../entities/Shop.js'
import { ShopOverlay } from '../entities/ShopOverlay.js'
import { MutationOverlay } from '../entities/MutationOverlay.js'
import { ColorOverlay } from '../entities/ColorOverlay.js'
import { QuitConfirmOverlay } from '../entities/QuitConfirmOverlay.js'
import { HitboxPool } from '../combat/HitboxPool.js'
import { resolveHit } from '../combat/damage.js'
import { hasStatus } from '../combat/status.js'
import { Effects } from '../effects/Effects.js'
import { Sound } from '../audio/Sound.js'
import { generateLevel, TILE_SIZE } from '../world/LevelGenerator.js'
import { TileMap } from '../world/TileMap.js'
import { createRunState } from '../core/RunState.js'
import { scaleAtDepth, scaleSpec, scaleBossSpec } from '../config/difficulty.js'
import { createMetaState } from '../core/MetaState.js'
import { ProjectilePool } from '../combat/ProjectilePool.js'
import { PickupPool } from '../entities/Pickup.js'
import { DeployablePool } from '../entities/DeployablePool.js'
import { WEAPONS, WEAPON_AFFIXES, WEAPON_AFFIX_CHANCE, WEAPON_AFFIXES_BY_ID, foldWeaponAffix, runWeaponPool } from '../config/weapons.js'
import { SKILLS, SKILLS_BY_ID, runSkillPool } from '../config/skills.js'
import type { SkillSpec as SkillSpecType } from '../config/skills.js'
import { ENEMY_SPECS, ELITE_AFFIXES, ELITE_CHANCE } from '../config/enemies.js'
import { BOSSES } from '../config/bosses.js'
import type { BossAttackSpec } from '../config/bosses.js'
import { SCROLLS, SCROLLS_BY_ID, SCROLL_IDS } from '../config/scrolls.js'
import { MUTATION_ORDER, MUTATIONS_BY_ID, LOW_HP_THRESHOLD, runMutationPool } from '../config/mutations.js'
import type { MutationSpec } from '../config/mutations.js'
import { colorMult, survivalHpBonus, COLORS } from '../config/colors.js'
import type { ColorId } from '../config/colors.js'
import { BLUEPRINTS } from '../config/blueprints.js'
import { SHOP_ITEMS } from '../config/shop.js'
import { ROOM_TYPES, ROOM_NORMAL } from '../config/roomTypes.js'
import { mulberry32 } from '../util/rng.js'
import { t, tName } from '../i18n/index.js'
import type { Input as InputType } from '../core/Input.js'
import type { RunState, RunStartStats } from '../core/RunState.js'
import type { MetaStateInstance } from '../core/MetaState.js'
import type { EnemySpec, EliteAffixSpec } from '../config/enemies.js'
import type { BiomeConfig } from '../config/biomes.js'
import type { RoomType } from '../config/roomTypes.js'
import type { ShopItem } from '../config/shop.js'
import type { SkillSpec } from '../config/skills.js'
import type { LevelDescription } from '../world/LevelGenerator.js'
import type { HitResult } from '../combat/damage.js'
import type { StatusSpec } from '../combat/status.js'
import type { RNG } from '../util/rng.js'

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
// ── The weapon-pickup pool (meta-progression §6.7, Decision 6, AC7) ── the ids a level pickup can offer is no
// longer a fixed const: it's the per-run RESOLVED pool (runWeaponPool) computed ONCE in create() from the
// unlocked blueprints and stored on `this.weaponPool`. With NO blueprints unlocked it === the 4 starters
// (hammer/bow/sword/spear) — the identity (a default run offers the same weapons as today); a banked weapon
// blueprint (the Glaive) ADDS its id. _maybePlaceWeaponPickup + _placeBranchReward draw from this.weaponPool.

// ── Blueprint-drop placement (meta-progression §6.7, Decision 6/7, AC9) ── a RARE sparse per-level chance to
// drop ONE locked-blueprint pickup, sourced SCENE-SIDE off the level seed (NOT the generator — the same
// off-the-pin discipline as the weapon pickup / shop, so the level pin stays intact). A blueprint is a special
// find, so it's rarer than a weapon swap. Only LOCKED (not-yet-unlocked, not-yet-carried) blueprints are worth
// dropping (don't re-drop one you already have). Collecting it records the id on runState.blueprints (run-only);
// bankRun merges it into the meta at run end (BOTH paths). A run with all blueprints unlocked drops none (no-op).
const BLUEPRINT_PICKUP_CHANCE = 0.18 // rare — a blueprint is a special run-pool unlock find.

// ── In-run shop placement (§6.10, Decision 74/76, AC63 — the GOLD SINK) ── a per-level FIXED chance to
// place ONE Shop vendor, rolled off a fresh seeded RNG (off the generator's pinned draw — the same level-
// pin discipline as the weapon pickup, so the regression pin + determinism deep-equal stay intact). Sized
// so a vendor appears often enough that hoarded gold has a regular outlet, but not EVERY level (so the
// "spend now vs save for the next vendor" decision is real). A given run seed always places the same shops.
const SHOP_LEVEL_CHANCE = 0.55 // ~half-plus of normal levels carry a vendor (a reliable gold outlet).

// ── In-run skill pickup placement (skills design §6.5, AC5) ── a per-level FIXED chance to place ONE skill
// pickup (the loadout layer's world drop), rolled off a fresh seeded RNG (off the generator's pinned draw —
// the same level-pin discipline as the weapon pickup / shop, so the regression pin + determinism deep-equal
// stay intact). Sized so a skill appears often enough to seed a loadout early but not every level (so picking
// it up is a real moment). A given run seed always places the same skills.
const SKILL_PICKUP_CHANCE = 0.45

// ── Timed-clear bonus (build-&-replay design §6.4, AC5 — the "timed door" speed incentive, no new door
// entity) ── each NORMAL level starts a timer when it's built; reaching the exit Door before CLEAR_BONUS_TIME
// grants a one-shot bonus (gold + cells) with an FX/HUD pop. Over the threshold → nothing (no penalty). The
// timer is PAUSE-AWARE (review MINOR — the real-vs-gameplay-dt fix): the world freezes on the gameplay dt while a
// modal (the mandatory mutation offer / the in-run shop) is up, but this.time.now keeps advancing — so the frozen
// modal interval is EXCLUDED from the measurement by advancing levelStartedAt past it on modal close
// (_pauseLevelTimer / _resumeLevelTimer). Both _grantTimedClearBonus AND the HUD's levelTime then count only
// un-paused, INTERACTIVE time — so reading a forced overlay or visiting the vendor never burns the fast-clear
// window. Boss/miniboss levels are NOT timed (they're set-piece gates, not speed-runs) — _buildLevel stamps the
// timer only for the normal path.
const CLEAR_BONUS_TIME = 45000 // ms — clear a normal level within 45s of building it to earn the bonus.
const CLEAR_BONUS_GOLD = 15 // run-only gold granted on a fast clear (feeds the in-run shop / gold sink).
const CLEAR_BONUS_CELLS = 2 // meta cells granted on a fast clear (banked at run end — the lasting reward).

// ── Affliction SPREAD-on-kill (affliction-synergy design §6.6, Decision 5, AC5) ── the Hemorrhage payoff:
// when an AFFLICTED enemy dies (and spreadAffliction is armed) its dominant DAMAGING affliction jumps to up
// to SPREAD_MAX_TARGETS nearest live OTHER enemies within SPREAD_RADIUS, so the affliction cascades through a
// pack. KILL-only (fired from the onDeath hook, no re-spread off a spread tick — no chain explosion).
// Deterministic: the scan reads NO RNG (nearest-N by distance), so it never perturbs the seed chain / level pin.
const SPREAD_RADIUS = 140 // px — only enemies within this of the corpse catch the affliction.
const SPREAD_MAX_TARGETS = 2 // at most this many nearest enemies catch it (bounded, once-per-kill).
// The fresh DoT spec the spread applies per dominant kind — a REDUCED-duration copy (a "spread tax") so the
// cascade weakens, never a full-strength chain. Re-derived (not copied off the dying enemy's live Status) so
// no internal _accum/timer leaks. Run through _scaleStatus so a Virulent/Toxic build's mults still apply.
const SPREAD_SPEC: Record<'bleed' | 'poison' | 'burn', StatusSpec> = {
  bleed: { kind: 'bleed', duration: 1.6, tickInterval: 0.4, tickDmg: 3 },
  poison: { kind: 'poison', duration: 1.8, tickInterval: 0.5, tickDmg: 2 },
  burn: { kind: 'burn', duration: 1.6, tickInterval: 0.4, tickDmg: 4 },
}

export class GameScene extends Phaser.Scene {
  // ── Field declarations (type-only; useDefineForClassFields:false → zero runtime effect) ──
  private runSeed!: number
  private meta!: MetaStateInstance
  private runState!: RunState
  // ── Boss-Cell TIER + per-run resolved pools (meta-progression §6.7, Decision 6/10, AC7/AC8) ── the run's tier
  // multiplier lives on RunState.bossCellMult (the SINGLE owner — run-scoped state, like every other run field),
  // seeded from the selected tier (1 = tier 0 identity) and read directly at every scaleAtDepth/scaleBossSpec
  // fold site (no duplicate scene-local copy — DRY). unlockedBlueprints is the meta's unlocked-blueprint set; the
  // three pools are the per-run draw pools resolved ONCE in create() from it (starters ∪ unlocked) — the
  // weapon/skill/mutation placement sites draw from these.
  private unlockedBlueprints!: Set<string>
  private weaponPool!: string[]
  private skillPool!: SkillSpecType[]
  private mutationPool!: MutationSpec[]
  private eliteChanceMult!: number // ×elite-affix roll chance from the tier (Decision 8; 1 on MVP tiers = identity).
  private hitstopTimer!: number
  private gameOver!: boolean
  private transitioning!: boolean
  private boss!: Boss | null
  private isBossRoom!: boolean
  private _hazardCollider!: Phaser.Physics.Arcade.Collider | null
  private _hazardCooldown!: number
  private shop!: Shop | null
  private _shopCollider!: Phaser.Physics.Arcade.Collider | null
  private shopOpen!: boolean
  private shopOverlay!: ShopOverlay | null
  // ── Mutation picker state (build-&-replay §6.5) — null/false until a biome transition offers a choice. ──
  private mutationOpen!: boolean
  private mutationOverlay!: MutationOverlay | null
  // ── Colour-up picker state (color-scaling-stats §6, Decision 7) — null/false until a biome transition offers
  // a +1-colour choice. Mirrors mutationOpen/mutationOverlay (the same frozen-modal + update-gate idiom).
  // _colorPickPending defers the colour modal until the mutation modal closes (two SEQUENTIAL modals — the
  // mutation first, then the colour — Decision 7); it's also the fallback when no mutation is offered. ──
  private colorPickOpen!: boolean
  private colorOverlay!: ColorOverlay | null
  private _colorPickPending!: boolean
  // ── Quit-to-Title confirm state (esc-quit-confirm) — null/false until ESC opens the confirm modal. The ESC
  // handler is persistent (.on, re-arms for the whole run); _onEsc holds the bound ref so SHUTDOWN can remove it. ──
  private quitConfirmOpen!: boolean
  private quitConfirmOverlay!: QuitConfirmOverlay | null
  private _onEsc!: () => void
  // ── Timed-clear bonus state (build-&-replay §6.4) — the wall-clock the CURRENT normal level was built at
  // (0 = an untimed level: boss/miniboss arena), used to grant a fast-clear bonus on the door-reach path. ──
  private levelStartedAt!: number
  // ── Modal-pause clock (build-&-replay §6.4, review MINOR — real-vs-gameplay-dt fix) — the wall-clock a modal
  // (shop / mutation overlay) was opened at (0 = no modal up). The world FREEZES on the gameplay dt while a modal
  // is open, but this.time.now keeps advancing — so without this, time spent reading the (mandatory) mutation
  // offer or shopping would be charged against the fast-clear window. _pauseLevelTimer stamps this on open;
  // _resumeLevelTimer ADVANCES levelStartedAt by the frozen interval on close, so the bonus + the HUD timer count
  // only un-paused, interactive time. ──
  private _modalPausedAt!: number
  private effects!: Effects
  // audio §6.3 — the procedural-SFX façade. NAMED `sfx` (NOT `sound`): Phaser.Scene already owns a
  // `sound` member (the WebAudioSoundManager), which Sound REUSES via scene.sound — so the façade
  // can't shadow it. The M toggle flips `this.sfx.mute` (which proxies Phaser's global game.sound.mute).
  private sfx!: Sound
  private playerHitboxes!: HitboxPool
  private enemyHitboxes!: HitboxPool
  private projectilePool!: ProjectilePool
  private enemyProjectilePool!: ProjectilePool
  private pickupPool!: PickupPool
  private deployables!: DeployablePool
  private input2!: InputType
  private player!: Player
  private enemyHurtboxes!: Phaser.Physics.Arcade.Group
  private enemies!: Enemy[]
  private _solidColliders!: Phaser.Physics.Arcade.Collider[]
  private hint!: Phaser.GameObjects.Text
  private desc!: LevelDescription
  private tileMap!: TileMap | null
  private _levelObjects!: Phaser.GameObjects.GameObject[]
  private roomType!: RoomType
  private roomDamageTakenMult!: number
  private door!: Door | null
  private doorCollider!: Phaser.Physics.Arcade.Collider | null

  constructor() {
    super('Game')
  }

  // Phaser passes scene-start DATA to create(): { seed? } from HubScene's START RUN (Decision 71). A bare
  // start (dev / direct) passes nothing → _resolveSeed() mints a fresh entropy seed so even a dev launch
  // varies. The verifier never runs this scene (it's Phaser-coupled) — it constructs RunState directly.
  create(data: { seed?: number }) {
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

    // ── Boss-Cell TIER (meta-progression §6.7, Decision 10, AC8) ── read the SELECTED tier's row. tier 0 ⇒
    // bossCellMult 1 + flaskDelta 0 + eliteChanceMult 1 ⇒ byte-identical to today (the identity). The run
    // stores bossCellMult (threaded to every scaleAtDepth/scaleBossSpec fold) + eliteChanceMult (multiplied
    // into the elite roll). The flaskDelta is FOLDED into startStats.maxFlasks HERE, BEFORE the run/player seed
    // from it (the existing flask seam — no new flask wiring), clamped to a >= 1 FLOOR (Decision 4) so a run is
    // never unwinnable. startStats is a FRESH clone from applyUpgrades (MetaState), so mutating it is safe (it
    // never touches the frozen BASE_PLAYER_STATS).
    const tier = this.meta.startTier()
    this.eliteChanceMult = tier.eliteChanceMult
    startStats.maxFlasks = Math.max(1, startStats.maxFlasks + tier.flaskDelta) // the >= 1 flask floor (Decision 4).

    // ── RunState (design §6.4/§6.5, Decision 44/46/60; meta-progression §6.6, Decision 10) ── ONE RunState
    // OWNS the active run: the seed chain, the biome index + per-biome level counter, the depth, the carried HP,
    // the currencies, the run-only scroll mults, and the equipped weapon id. Seeded from startStats so the
    // carried maxHp/hp + starting weapon + flask count reflect the META upgrades + the tier (review MAJOR — the
    // HP-carry/upgrade reconciliation: RunState.maxHp/hp are minted from the UPGRADED maxHp, so the single
    // create()-time player sync below is consistent). tier.bossCellMult is passed so the run OWNS the tier
    // multiplier (RunState.bossCellMult — the single source the fold sites read; no duplicate scene copy, DRY).
    // startedAt is captured HERE (purity stays in RunState). scene.start('Game') fully re-creates the scene per
    // run, so a fresh RunState is minted each run.
    this.runState = createRunState(this.runSeed, this.time.now, startStats, tier.bossCellMult)

    // ── Per-run RESOLVED pools (meta-progression §6.7, Decision 6, AC7) ── compute the unlocked-blueprint set +
    // the three draw pools ONCE here (the off-the-pin discipline — these are pure resolvers, no RNG, no level
    // perturbation). With NO blueprints unlocked each pool === the pre-slice tables (a default run draws from the
    // identical rows as today — the identity, AC11). A banked blueprint widens the matching pool for THIS run.
    this.unlockedBlueprints = new Set(this.meta.getBlueprints())
    this.weaponPool = runWeaponPool(this.unlockedBlueprints)
    this.skillPool = runSkillPool(this.unlockedBlueprints)
    this.mutationPool = runMutationPool(this.unlockedBlueprints)

    // ── Clear/seed the cross-scene registry BEFORE the first _emitHud (review MINOR — stale leak) ──
    // The registry (depth/biomeName/HP) persists across scenes, so a replayed run could briefly show
    // the PREVIOUS run's values until the first update() tick. Seed sane defaults from the fresh
    // RunState here so the parallel HUD never flashes stale data on a fresh run.
    this.registry.set('depth', this.runState.depth)
    this.registry.set('biomeName', tName('biome', this.runState.biome().id, this.runState.biome().name))
    this.registry.set('playerHp', this.runState.hp)
    this.registry.set('playerMaxHp', this.runState.maxHp)
    this.registry.set('comboIndex', -1)
    // §6.5 — seed the currency/weapon HUD keys too so the parallel HUD never flashes stale values.
    this.registry.set('cells', this.runState.cells)
    this.registry.set('gold', this.runState.gold)
    this.registry.set('weapon', tName('weapon', this.runState.weaponId, WEAPONS[this.runState.weaponId].name))
    // §6.9 — seed the flask (heal valve) HUD keys so the parallel HUD never flashes stale charges.
    this.registry.set('flasks', this.runState.flasks)
    this.registry.set('maxFlasks', this.runState.maxFlasks)
    // skills slice — seed the two skill-slot HUD keys (name + 0..1 cooldown fraction) so a fresh run never
    // flashes a stale prior-run skill (the registry survives scene restarts). Empty slots → '—', cd 0.
    this.registry.set('skill1', '—')
    this.registry.set('skill2', '—')
    this.registry.set('skill1Cd', 0)
    this.registry.set('skill2Cd', 0)
    // build-&-replay slice — seed the mutation list (joined active-mutation names) + the per-level timer keys so
    // the parallel HUD never flashes a stale prior-run mutation/timer (the registry survives scene restarts).
    this.registry.set('mutations', '')
    this.registry.set('levelTime', 0) // ms elapsed on the current level (0 = untimed: a boss/miniboss arena).
    this.registry.set('levelBonusTime', CLEAR_BONUS_TIME) // the fast-clear threshold the HUD turns amber near.
    // color-scaling-stats §6 (AC10) — seed the three colour-level HUD keys + the equipped weapon's colour so a
    // fresh run shows 0/0/0 (the identity) and the parallel HUD never flashes a stale prior-run value.
    this.registry.set('brutalityLevel', this.runState.brutalityLevel)
    this.registry.set('tacticsLevel', this.runState.tacticsLevel)
    this.registry.set('survivalLevel', this.runState.survivalLevel)
    this.registry.set('equippedColor', WEAPONS[this.runState.weaponId].scaling)
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
    // ── Mutation picker state (build-&-replay §6.5) — null/false until a biome transition offers a choice. ──
    this.mutationOpen = false // true while the mutation overlay is up (gameplay is paused beneath it).
    this.mutationOverlay = null // the live MutationOverlay UI while open, else null.
    // ── Colour-up picker state (color-scaling-stats §6, Decision 7) — null/false until a biome transition offers
    // a +1-colour choice (offered AFTER the mutation modal closes — two sequential frozen modals, Decision 7). ──
    this.colorPickOpen = false // true while the colour overlay is up (gameplay is paused beneath it).
    this.colorOverlay = null // the live ColorOverlay UI while open, else null.
    this._colorPickPending = false // a colour pick deferred behind the mutation modal (offered on its close).
    // ── Quit-to-Title confirm state (esc-quit-confirm) — gates update() like shop/mutation; ESC toggles it. ──
    this.quitConfirmOpen = false // true while the confirm modal is up (gameplay is paused beneath it).
    this.quitConfirmOverlay = null // the live QuitConfirmOverlay UI while open, else null.
    // ── Timed-clear bonus state (build-&-replay §6.4) — stamped per normal level in _buildLevel (0 = untimed). ──
    this.levelStartedAt = 0
    this._modalPausedAt = 0 // wall-clock a modal was opened at (0 = none up); excludes frozen modal time from the timer.
    this.effects = new Effects(this, (secs) => {
      this.hitstopTimer = Math.min(HITSTOP_CAP, Math.max(this.hitstopTimer, secs))
    })
    // ── Procedural SFX façade (audio §6.3, Decision 1/2) ── reuses Phaser's shared AudioContext
    // (scene.sound.context). Degrades to a silent no-op under NoAudio/headless (AC7 — never throws).
    // PERSISTS across level rebuilds (created ONCE here, like Effects), injected into the Player below.
    this.sfx = new Sound(this)

    // ── Combat pools (Decisions 16/28/30/62/65) ── one player + one enemy HitboxPool + one PLAYER
    // ProjectilePool (the bow fires from it) + one ENEMY ProjectilePool (the Shooter archetype + the
    // boss volley fire from it — Decision 65, the 'enemy'-tagged instance). All PERSIST across rebuilds
    // (created ONCE here, released on teardown) — the same lifecycle the player pool already has.
    this.playerHitboxes = new HitboxPool(this, 'player')
    this.enemyHitboxes = new HitboxPool(this, 'enemy')
    // The PLAYER pool is sized 16 (not the default 8): the bow used ≤2 in-flight shots, but skills (skills
    // design) ALSO fire from this same pool — a 5-shard iceShards volley spends 5 slots in ONE frame, a
    // deployed turret holds a slot every 0.7s, and bow/knife shots (0.9–1.2s lifetime) may still be live.
    // At 8, that combination can EXHAUST the pool, and acquire() returns null silently (the skill shots just
    // vanish — the slice reads as "not firing"). 16 pre-allocated rects comfortably cover volley+turret+
    // in-flight shots and remove the silent-drop edge (cheap — the rects are parked+disabled until acquired).
    this.projectilePool = new ProjectilePool(this, 'player', 16)
    this.enemyProjectilePool = new ProjectilePool(this, 'enemy') // §6.6.3 (Decision 65) — enemy/boss shots.

    // ── Pickup pool (§6.5, Decision 54) ── pooled Cells/gold/scroll/weapon pickups; persists across
    // rebuilds (live pickups are released on teardown). Enemy drops + generator pickups acquire from it.
    this.pickupPool = new PickupPool(this)

    // ── Deployable pool (skills design §6.4, AC3 — the turret skill's ONE new pooled entity) ── pooled
    // stationary auto-firing turrets the 'turret' skill deploys; persists across rebuilds (live turrets are
    // released on teardown). It fires from the PLAYER projectilePool so its shots resolve through the
    // existing projectile→enemy overlap with no new wiring (Decision 5). The cut-line entity (volley/blast
    // need none) — mirrors the mandated pooling convention (acquire/release, zero per-deploy allocation).
    this.deployables = new DeployablePool(this)

    // ── Input + Player ── created ONCE; the Player is repositioned at each new entrance (it and its
    // pools persist; only the level geometry/enemies/door rebuild).
    this.input2 = new Input(this)
    this.player = new Player(this, 0, 0, this.playerHitboxes, this.projectilePool, this.sfx)
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
      (this.playerHitboxes as any).group,
      this.enemyHurtboxes,
      (hitboxRect: any, enemyRect: any) => this._onPlayerHitEnemy(hitboxRect, enemyRect),
      (hitboxRect: any, enemyRect: any) => this._dedupFilter(hitboxRect, enemyRect),
      this,
    )
    // SPRITE-FIRST (Phaser swap rule): Arcade normalizes a Group×Sprite overlap to
    // collideSpriteVsGroup(sprite, group), so the callbacks ALWAYS fire as (sprite, groupChild).
    // We therefore list the single player.collider as object1 and the hitbox GROUP as object2, then
    // read (_playerRect, hitboxRect). Registering the group first would silently swap the args.
    this.physics.add.overlap(
      this.player.collider,
      (this.enemyHitboxes as any).group,
      (_playerRect: any, hitboxRect: any) => this._onEnemyHitPlayer(hitboxRect),
      (_playerRect: any, hitboxRect: any) => hitboxRect.hb.active && this.player.isHittable(),
      this,
    )
    this.physics.add.overlap(
      this.player.collider,
      this.enemyHurtboxes,
      (_playerRect: any, enemyRect: any) => this._onEnemyContact(enemyRect),
      (_playerRect: any, enemyRect: any) => {
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
      (projRect: any, enemyRect: any) => this._onProjectileHitEnemy(projRect, enemyRect),
      (projRect: any, enemyRect: any) => {
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
      (_playerRect: any, projRect: any) => this._onEnemyProjectileHitPlayer(projRect),
      (_playerRect: any, projRect: any) => {
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
      (_playerRect: any, pickupRect: any) => this._onPickup(pickupRect),
      (_playerRect: any, pickupRect: any) => pickupRect.pk.active,
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
      .text(16, 16, '', { fontFamily: UI_FONT, fontSize: '18px', color: '#8b949e' })
      .setScrollFactor(0)
      .setDepth(100)
    this._updateHint()

    // ── Parallel HUD overlay (Decision 2) + teardown ──
    if (!this.scene.isActive('HUD')) this.scene.launch('HUD')
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scene.stop('HUD')
      // esc-quit-confirm: scene.start('Title') (the QUIT path) does NOT auto-clear keyboard handlers
      // registered via .on, so remove the persistent ESC handler + force-close a dangling overlay here.
      this.input.keyboard!.off('keydown-ESC', this._onEsc)
      if (this.quitConfirmOverlay) {
        this.quitConfirmOverlay.close()
        this.quitConfirmOverlay = null
      }
      this.quitConfirmOpen = false
    })

    // ESC → quit-to-Title CONFIRM toggle (esc-quit-confirm). PERSISTENT (.on) so it re-arms for the whole run,
    // surviving _buildLevel rebuilds (which rebuild only the world, not the scene/handlers). Owns the second-ESC
    // CANCEL (the overlay never binds ESC). ESC is NOT in Input's addKeys map, so this .on never shares the
    // JustDown path Input owns. Stored on _onEsc so the SHUTDOWN handler above can remove it.
    this._onEsc = () => this._toggleQuitConfirm()
    this.input.keyboard!.on('keydown-ESC', this._onEsc)
  }

  // ── Build a generated level in place (design §6.2/§6.4, Decision 40/45/46) ── read the CURRENT
  // biome + seed from RunState, generate the description, construct the TileMap, reposition the Player
  // at the entrance, spawn DEPTH-SCALED enemies/pickups/Door, and (re-)wire the level colliders. The
  // Player, Input, Effects, HitboxPools, HUD, and the combat overlaps all PERSIST — only the world
  // rebuilds. IMPORTANT (review MAJOR, Decision 46): this method touches NEITHER player.hp NOR
  // runState.hp — HP carry is owned by create() (the one-time sync) + _nextLevel (the pre-teardown
  // write), so a rebuild never refills HP.
  _buildLevel(): void {
    // ── Re-equip the carried skill loadout (skills design §6.7, Decision 7, AC4) ── re-fold RunState's
    // skillId1/skillId2 onto the live Player at the start of EVERY build (normal AND boss), so the loadout
    // is carried across level rebuilds; cooldowns reset on rebuild (equipSkill zeroes them — KISS). A fresh
    // run has both ids null → a no-op (both slots empty — the identity, AC8). DRY: ONE re-equip site for
    // both branches (so the boss-level early-return below is still covered).
    this._reequipSkills()

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

    // ── Timed-clear bonus (build-&-replay §6.4, AC5) ── stamp the level-start wall-clock so reaching the exit
    // Door before CLEAR_BONUS_TIME earns the fast-clear bonus (_nextLevel reads this). A MINIBOSS level is NOT
    // timed (it's a set-piece gate, not a speed-run) → leave the timer at 0 (untimed) so it never grants a bonus
    // / shows a timer. The boss arena (_buildBossLevel) also leaves it 0 (it has no exit Door at all).
    this.levelStartedAt = this.runState.isMinibossLevel() ? 0 : this.time.now

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
    // meta-progression §6.7 (Decision 10) — pass the run's Boss-Cell multiplier so a higher tier spawns
    // tankier/denser enemies (the curve is GLOBALLY lifted; bossCellMult 1 = the identity scalars).
    const scale = scaleAtDepth(this.runState.depth, this.runState.bossCellMult)
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
      this.pickupPool.acquire(p.x, p.y, p.kind as any)
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

    // ── Sparse skill pickup (skills design §6.5, AC5) ── a low FIXED per-level chance to offer ONE skill to
    // equip, sourced SCENE-SIDE off the level seed (NOT the generator — keeps the level pin intact, the same
    // off-the-pin discipline as the weapon pickup / shop). Deterministic per seed (a replay places the same skill).
    this._maybePlaceSkillPickup(desc)

    // ── Branch treasure reward (§6.14, Decision 80, AC67) ── if the generator emitted an optional treasure
    // branch (desc.branchTreasure), place a GUARANTEED reward (gold/scroll/weapon/heal) on its standable
    // ledge — the risk/reward payoff for taking the detour. Sourced SCENE-SIDE off the level seed (NOT a
    // generator pickup — the level pin stays intact, the weapon-pickup discipline). No-op if no branch.
    this._placeBranchReward(desc)

    // ── Sparse BLUEPRINT drop (meta-progression §6.7, Decision 6/7, AC9) ── a RARE per-level chance to drop ONE
    // locked-blueprint pickup, sourced SCENE-SIDE off the level seed (NOT the generator — the level pin stays
    // intact, the weapon-pickup discipline). Collecting it records the id on runState.blueprints (run-only);
    // bankRun merges it at run end. No-op when no blueprints remain locked (all unlocked / already carried).
    this._maybePlaceBlueprintPickup(desc)

    // ── Door (the exit, Decision 40) ── overlap fires _onDoorOverlap → _nextLevel (guarded).
    this.door = new Door(this, desc.exit, biome.colors.exit, () => this._nextLevel())
    this.doorCollider = this.physics.add.overlap(
      this.player.collider,
      (this.door as any).rect,
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
      this.physics.add.collider(this.enemyHurtboxes, this.tileMap.solids, null as any, (enemyRect: any) => this._enemyNotFlyer(enemyRect), this),
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
        null as any,
        (player: any, platform: any) => {
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
        null as any,
        (enemyRect: any, platform: any) => {
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
  _spawnMiniboss(desc: LevelDescription): void {
    const biome = this.runState.biome()
    const spec = BOSSES[biome.miniboss as string]
    if (!spec) return // defensive — an unknown id degrades to no miniboss (KISS, never throws).
    // meta-progression §6.7 (Decision 10) — tier-scale the miniboss too (tankier + harder-hitting at a higher tier).
    const bossSpec = scaleBossSpec(spec, scaleAtDepth(this.runState.depth, this.runState.bossCellMult))
    // Place it near the exit ledge (the guardian of the way out), feet on the exit platform. A miniboss is a
    // big body, so spawn its center where the exit door sits — the floor/platform collider settles it.
    const spawnX = desc.exit.x
    const spawnY = desc.exit.y
    this.boss = new Boss(this as any, spawnX, spawnY, bossSpec, this.enemyHitboxes, this.enemyProjectilePool, {
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
    this.registry.set('bossName', tName('boss', bossSpec.id, bossSpec.name))
    this.registry.set('bossHp', this.boss.hp)
    this.registry.set('bossMaxHp', this.boss.maxHp)
    this.sfx.bossSpawn() // audio §6.3 (AC5) — the miniboss-entrance swell (same set-piece tell as the finale).
  }

  // ── _onMinibossDefeated() (Enrichment round-2, §6.6.8) ── the miniboss-kill edge: NOT a run-end (the run
  // continues — the exit Door is the gate). Just clear the boss HP bar so it doesn't linger, and a small camera
  // flourish so the kill reads. The kill count is bumped by the boss.onDeath hook (above). Guarded against a
  // double-fire by the boss's own dead flag (Boss fires onBossDeath once).
  _onMinibossDefeated(): void {
    this._clearBossHud()
    this.cameras.main.flash(220, 244, 208, 63) // a brief gold flash marks the set-piece clear.
    this.sfx.bossDefeat() // audio §6.3 (AC5) — the kill flourish (same as the finale's, DRY).
  }

  // ── _enemyNotFlyer(enemyRect) ── the shared collider predicate (Decision 68/AC59): true for a normal
  // enemy (so it collides with solids/oneWay), false for a flyer (so it passes through + hovers). Reads
  // the per-body _noSolids flag set in _spawnEnemy. The boss is NOT a flyer (it walks the arena floor).
  _enemyNotFlyer(enemyRect: any): boolean {
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
  _buildBossLevel(): void {
    const biome = this.runState.biome()
    // The boss arena is a DISTINCT pure generator branch (Decision 66) — a flat walled room with a
    // bossSpawn, hazards, NO normal enemies/pickups, NO real exit. Shallow-merge bossArena:true.
    const desc = generateLevel(this.runState.seed, { ...biome, bossArena: true })
    this.desc = desc
    this.tileMap = new TileMap(this, desc)
    this.isBossRoom = true // a flag the HUD-clear + teardown read (review MINOR — boss-bar lifecycle).
    this.levelStartedAt = 0 // the boss arena is NEVER timed (no exit Door — the boss is the gate; build-&-replay §6.4).
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
    // meta-progression §6.7 (Decision 10) — tier-scale the finale boss (the DEEPEST fight; a higher tier makes
    // it tankier + hits harder, exactly as the curve already makes a deep boss tankier — bossCellMult 1 = identity).
    const bossSpec = scaleBossSpec(BOSSES[bossId], scaleAtDepth(this.runState.depth, this.runState.bossCellMult))
    this.boss = new Boss(this as any, desc.bossSpawn!.x, desc.bossSpawn!.y, bossSpec, this.enemyHitboxes, this.enemyProjectilePool, {
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
    this.registry.set('bossName', tName('boss', bossSpec.id, bossSpec.name))
    this.registry.set('bossHp', this.boss.hp)
    this.registry.set('bossMaxHp', this.boss.maxHp)
    this.sfx.bossSpawn() // audio §6.3 (AC5) — the boss-entrance swell announces the set-piece.

    // ── Level colliders (the player + the boss stand on the floor; pickups n/a here but harmless). ──
    this._solidColliders.push(this.physics.add.collider(this.player.collider, this.tileMap.solids))
    this._solidColliders.push(
      this.physics.add.collider(this.enemyHurtboxes, this.tileMap.solids, null as any, (enemyRect: any) => this._enemyNotFlyer(enemyRect), this),
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
  _onHazardContact(): void {
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
  _onBossDefeated(): void {
    if (this.gameOver) return
    this.gameOver = true
    this.runState.hp = this.player.hp // final carried-HP snapshot (kept consistent; summary ignores it).
    // The ONE bankRun writer (cells + bestDepth + run blueprints + the tier unlock). meta-progression §6.7
    // (Decision 3, AC5/AC9): a COMPLETED run (boss kill) UNLOCKS the next tier (completedAtTier = the run's
    // selected tier) AND banks any blueprints collected this run. gold/scrolls are run-only (permadeath).
    this.meta.bankRun({
      cells: this.runState.cells,
      depth: this.runState.depth,
      blueprints: this.runState.blueprints,
      completedAtTier: this.meta.getSelectedTier(),
    })
    this._clearBossHud() // drop the boss HP bar so it never persists into the next run (review MINOR).
    // A short victory flourish (freeze/flash) then hand off to Victory with the run summary.
    this.hitstopTimer = 0.2
    this.cameras.main.flash(260, 88, 214, 141)
    this.sfx.bossDefeat() // audio §6.3 (AC5) — the win flourish on the final boss kill.
    const summary = this.runState.summary(this.time.now, true, this.runSeed)
    summary.biomeName = tName('biome', this.runState.biome().id, summary.biomeName) // i18n: translate at the scene boundary.
    this.time.delayedCall(900, () => this.scene.start('Victory', summary))
  }

  // Clear the boss HP-bar registry keys (review MINOR — the registry survives scene restarts, so a
  // stale prior-run boss bar would otherwise flash on the next run's HUD until overwritten).
  _clearBossHud(): void {
    this.registry.set('bossActive', false)
    this.registry.set('bossHp', null)
    this.registry.set('bossMaxHp', null)
  }

  // ── Advance to the next generated level (Decision 40, review MAJOR re-entrancy) ── DEFERRED: the
  // overlap callback only sets the one-shot guard; the actual teardown+rebuild runs on the NEXT tick
  // (delayedCall 0) so we never destroy collider bodies while Arcade is iterating world.step.
  _onDoorOverlap(): void {
    if (this.transitioning || this.gameOver) return // one-shot: a multi-frame overlap fires once.
    this.transitioning = true
    this.cameras.main.flash(160, 244, 208, 63) // a brief yellow flash marks the level change.
    this.sfx.transition() // audio §6.3 (AC5) — the door/level-change whoosh.
    // Defer the rebuild off the physics step (footgun guard). delayedCall(0) runs next frame.
    this.time.delayedCall(0, () => this._nextLevel())
  }

  // ── Door → advance the RUN (design §6.4, Decision 46/48) ── COMPLETION CHECK FIRST: if the LAST
  // biome's LAST level was just cleared, the run is FINISHED → run-complete handoff (Decision 48),
  // NOT an advance into a non-existent biome. Otherwise: write runState.hp = player.hp BEFORE teardown
  // (the carried-HP capture — the ONLY runState.hp write on the level→level path, Decision 46), then
  // advance the RunState (next seed + next level/biome/depth — BLOCKER 1: depth always rises, biome
  // rolls only when the biome's levels are exhausted), and rebuild from the new RunState.
  _nextLevel(): void {
    if (this.runState.isRunComplete()) {
      this._completeRun()
      return
    }
    // ── Timed-clear bonus (build-&-replay §6.4, AC5) ── BEFORE advancing, check whether THIS level was
    // cleared fast: a timed level (levelStartedAt > 0 — i.e. a normal, non-set-piece level) reached within
    // CLEAR_BONUS_TIME of being built grants a one-shot gold+cells bonus with an FX/HUD pop. Over the
    // threshold (or an untimed boss/miniboss level) → nothing (no penalty). Read here on the door-reach path,
    // against the level just cleared, so it never double-fires (the one-shot transitioning guard already gates it).
    this._grantTimedClearBonus()
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
    // ── Offer a MUTATION + a COLOUR-up on a biome transition (build-&-replay §6.5, AC2; color-scaling-stats §6,
    // Decision 7, AC9) ── AFTER the new level is built (so the overlays draw over the rebuilt world + the player
    // is at the new entrance), offer the seeded 3-of-N mutation, THEN — on its close — the +1-colour pick (two
    // SEQUENTIAL frozen modals, Decision 7). Arm the colour pick as PENDING, then offer the mutation; if no
    // mutation modal actually opens (none to offer), fire the colour pick immediately. No-op within a biome.
    if (this.runState.biomeIndex !== prevBiomeIndex) {
      this._colorPickPending = true
      this._offerMutation()
      if (!this.mutationOpen) this._offerColorPick() // no mutation modal up → offer the colour pick now.
    }
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
  _completeRun(): void {
    if (this.gameOver) return
    this.gameOver = true
    this.runState.hp = this.player.hp // final carried-HP snapshot (kept consistent; summary ignores it).
    // Bank the run's Cells + best depth to the PERSISTENT meta ONCE (§6.5, Decision 59, AC51) — gold/
    // scrolls are run-only and simply NOT passed (permadeath loses them). Under the gameOver guard so it
    // fires exactly once per run. The summary carries cellsBanked for GameOver's readout. meta-progression
    // §6.7 (Decision 3): the Door-completion path is ALSO a COMPLETED run (a future non-boss final biome) — it
    // unlocks the next tier + banks run blueprints, mirroring _onBossDefeated (DRY — both are completion edges).
    this.meta.bankRun({
      cells: this.runState.cells,
      depth: this.runState.depth,
      blueprints: this.runState.blueprints,
      completedAtTier: this.meta.getSelectedTier(),
    })
    this.sfx.bossDefeat() // audio §6.3 (AC5) — a win flourish on a completed run (the gold "RUN COMPLETE" path).
    const completeSummary = this.runState.summary(this.time.now, true, this.runSeed)
    completeSummary.biomeName = tName('biome', this.runState.biome().id, completeSummary.biomeName) // i18n: translate at the scene boundary.
    this.scene.start('GameOver', completeSummary)
  }

  // Destroy everything the CURRENT level owns; keep the persistent player/pools/FX/HUD/overlaps.
  _teardownLevel(): void {
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
    // Mutation overlay teardown (build-&-replay §6.5) — defensive: the overlay is offered AFTER _buildLevel and
    // a transition can't fire while it's open (mutationOpen gates update), but force-close any dangling overlay
    // so it never leaks across a rebuild. mutationOpen is forced false so the update() gate re-opens gameplay.
    if (this.mutationOverlay) {
      this.mutationOverlay.close()
      this.mutationOverlay = null
    }
    this.mutationOpen = false
    // Colour-up overlay teardown (color-scaling-stats §6, Decision 7) — defensive force-close mirroring the
    // mutation overlay: a dangling colour modal never leaks across a rebuild; colorPickOpen forced false so the
    // update() gate re-opens gameplay; the pending flag is cleared so a teardown mid-transition can't re-offer.
    if (this.colorOverlay) {
      this.colorOverlay.close()
      this.colorOverlay = null
    }
    this.colorPickOpen = false
    this._colorPickPending = false
    // Clear any dangling modal-pause stamp (build-&-replay §6.4) so a half-open modal at teardown can't leak a
    // paused interval into the next level's fresh timer (_buildLevel re-stamps levelStartedAt from scratch).
    this._modalPausedAt = 0
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
    this.deployables.releaseAll() // skills slice — drop any deployed turret on rebuild (it doesn't carry levels).
  }

  _updateHint(): void {
    if (!this.hint) return
    const rs = this.runState
    // RUN seed (the shareable run id, Decision 71) + the live LEVEL seed. The run seed identifies the
    // WHOLE run (same run seed → same biome/level/layout chain — AC47); the level seed is its chained head.
    // Keyboard tokens stay literal inside the translated template (they name physical keys); the biome
    // name is resolved to the active locale.
    this.hint.setText(
      t('game.hint', {
        depth: rs.depth,
        biome: tName('biome', rs.biome().id, rs.biome().name),
        level: rs.levelInBiome + 1,
        levels: rs.biome().levels,
        runSeed: this.runSeed.toString(16),
        levelSeed: rs.seed.toString(16),
      }),
    )
  }

  // ── _resolveSeed(data) (design §6.9, Decision 71 — the replayability fix) ── prefer a seed PASSED IN by
  // the Hub (a shared seed a player typed, or the Hub's own entropy mint), coercing it to an unsigned 32-bit
  // int; else mint a fresh seed from REAL ENTROPY (Date.now ⊕ a random draw ⊕ a high-res clock if present)
  // so every launch — even a bare dev `scene.start('Game')` — produces a DIFFERENT run. This is the ONLY
  // entropy source in the run path; the pure modules stay deterministic (they take the resolved seed in).
  _resolveSeed(data?: { seed?: number }): number {
    if (data && Number.isFinite(data.seed)) return data.seed! >>> 0
    return GameScene.mintSeed()
  }

  // Mint a fresh unsigned-32-bit run seed from entropy (Decision 71). Static so HubScene can reuse the SAME
  // mint (DRY — one entropy recipe). Mixes Date.now, a Math.random draw, and (when available) performance.now
  // so two runs started in the same millisecond still diverge. The >>>0 keeps it an unsigned 32-bit int —
  // exactly the shape RunState's seed chain expects (so the chained level seeds stay byte-stable per run).
  static mintSeed(): number {
    const t = Date.now()
    const r = Math.floor(Math.random() * 0x100000000)
    const hi = typeof performance !== 'undefined' && performance.now ? Math.floor(performance.now() * 1000) : 0
    return ((t ^ r ^ hi) >>> 0) || 1 // never 0 (a degenerate seed); 1 is a fine fallback.
  }

  // ── _pickArchetype(biome, rng) (design §6.6.4, Decision 68, AC59) ── pick a base archetype spec off
  // the biome's WEIGHTED enemyPool via the passed FRESH seeded RNG (off the generator's pinned draw, so
  // the level pin is untouched). Returns the PURE config spec (config/enemies.js) for the chosen id; the
  // caller scaleSpec()s it (a NEW per-spawn spec). Falls back to GRUNT for an unknown/empty pool (KISS).
  _pickArchetype(biome: BiomeConfig, rng: RNG): EnemySpec {
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
  _rollElite(rng: RNG): EliteAffixSpec | null {
    // meta-progression §6.7 (Decision 8) — the tier's eliteChanceMult RAISES the effective elite chance (more
    // affixed enemies at a higher tier). Compared as ELITE_CHANCE × mult (clamped to 1 so it can't exceed
    // certainty). On the MVP tiers eliteChanceMult is 1 → this is BYTE-IDENTICAL to the pre-slice gate (the
    // gate consumes the SAME one rng() draw, the threshold is unchanged) — the identity. The pick below is
    // unchanged so a run still replays the same affix per elite.
    const eliteChance = Math.min(1, ELITE_CHANCE * (this.eliteChanceMult || 1))
    if (rng() >= eliteChance) return null // not an elite this spawn (the common case — identity).
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
  _rollWeaponAffix(rng: RNG): string | null {
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
  _equipWeaponWithAffix(weaponId: string, affixId: string | null) {
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
  _swapWeapon(): void {
    if (this.player.swapWeapon()) {
      this.cameras.main.flash(120, 174, 214, 241) // a faint blue pulse marks the weapon swap.
      this.effects.hit(this.player.body.center.x, this.player.body.center.y, { damage: 0 })
      this.sfx.swap() // audio §6.3 (AC4) — the swap click-clack (only on a real swap).
    }
  }

  // ── _reequipSkills() (skills design §6.7, Decision 7, AC4) ── re-fold the carried RunState.skillId1/
  // skillId2 onto the live Player so the loadout survives a level rebuild. Resolves each id via SKILLS_BY_ID
  // → equipSkill(slot) (which also resets that slot's cooldown — the rebuild cooldown reset, KISS). A null id
  // leaves the slot empty (equipSkill is only called for a present id; the empty slot already came from
  // applyStartStats / the prior frame). Called at the start of every _buildLevel/_buildBossLevel.
  _reequipSkills(): void {
    const ids = [this.runState.skillId1, this.runState.skillId2]
    for (let slot = 0; slot < 2; slot++) {
      const id = ids[slot]
      if (!id) continue
      const spec = SKILLS_BY_ID[id]
      if (spec) this.player.equipSkill(spec, slot)
    }
  }

  // ── _acquireSkill(skillId) (skills design §6.5, AC5) ── the shared "gain a skill" path used by the pickup,
  // shop, and treasure-branch reward arms (DRY — one place owns the slot choice + the RunState record). Fill
  // the FIRST EMPTY skill slot; if both are full, replace slot 0 (so a third skill is still a meaningful pick,
  // not a dead drop). equipSkill resets the chosen slot's cooldown (a freshly equipped skill is usable now).
  // Records the id on RunState (skillId1/skillId2) so a level rebuild re-equips the SAME skill (the carry
  // discipline the weaponId scalars follow). A bad id is a defensive no-op (never throws).
  _acquireSkill(skillId: string): void {
    const spec = SKILLS_BY_ID[skillId]
    if (!spec) return
    // First empty slot, else slot 0 (replace).
    const slot = this.player.skills[0] == null ? 0 : this.player.skills[1] == null ? 1 : 0
    this.player.equipSkill(spec, slot)
    if (slot === 0) this.runState.skillId1 = skillId
    else this.runState.skillId2 = skillId
  }

  // ── _useSkill(slot) (skills design §6.3, Decision 4, AC2/AC3) ── the kind-dispatched skill trigger. Ask the
  // Player for the spec to fire (tryUseSkill returns it + arms the cooldown only if the slot is filled AND off
  // cooldown — else null, a no-op: no double-fire, no crash, the identity for an empty slot). Then dispatch on
  // the kind, REUSING the existing combat primitives — NO new combat math:
  //   volley → a fan of pooled PLAYER projectiles fired along facing (ProjectilePool, the round-3 aim:{angle}).
  //   blast  → instant radial damage to every enemy/boss within radius (_radialDamage over this.enemies+boss).
  //   turret → a timed deployable auto-firer (DeployablePool — the ONE new pooled entity).
  // Each carries the skill's OPTIONAL status (volley/turret stamp it on the shot; blast applies it per target).
  _useSkill(slot: number): void {
    const spec = this.player.tryUseSkill(slot)
    if (!spec) return // empty / on cooldown → no-op (the identity).
    const cx = this.player.body.center.x
    const cy = this.player.body.center.y
    const facing = this.player.facing
    // ── COLOUR MULT (color-scaling-stats §6, Decision 9, AC6) ── bake the SKILL's OWN colour mult into the fired
    // damage here (a skill scales by ITS colour's level, NOT the equipped weapon's). m === colorMult(0) === 1 at
    // level 0 → Math.round(damage × 1) === the spec damage (byte-identical, the identity). NEVER mutate the
    // shared SKILLS spec — pass colour-scaled FRESH copies into the pools (the aliasing safety every fold keeps).
    const m = colorMult(this._colorLevel(spec.scaling))
    if (spec.kind === 'volley') {
      // Fire `count` projectiles fanned across `spread` radians centered on facing. The base aim is 0 (right)
      // or π (left); each shot offsets by an even slice of the spread so the fan is symmetric about facing.
      if (this.projectilePool && spec.projectile && spec.count && spec.count > 0) {
        const baseAngle = facing >= 0 ? 0 : Math.PI
        const spread = spec.spread ?? 0
        const n = spec.count
        // A fresh colour-scaled projectile (never mutate the shared spec — Decision 9).
        const proj = { ...spec.projectile, damage: Math.round(spec.projectile.damage * m) }
        for (let i = 0; i < n; i++) {
          // Map i ∈ [0, n-1] to a symmetric offset in [-spread/2, +spread/2] (a single shot fires straight).
          const t = n === 1 ? 0 : i / (n - 1) - 0.5
          const angle = baseAngle + t * spread
          this.projectilePool.acquire({ cx, cy, facing }, proj, this.player.id, spec.status ?? null, { angle })
        }
      }
    } else if (spec.kind === 'blast') {
      // Instant radial AoE: damage every enemy/boss within radius, knock them away, apply the optional status,
      // then pop a particle ring so the blast reads. Reuses resolveHit + effects (no new combat math). The
      // colour mult scales the blast damage (×1 at level 0 → identity).
      this._radialDamage(cx, cy, spec.radius ?? 0, Math.round((spec.damage ?? 0) * m), spec.knockback ?? 0, spec.status)
      this._blastRingFx(cx, cy, spec.radius ?? 0)
    } else if (spec.kind === 'turret') {
      // Deploy a stationary auto-firer at the player's feet for spec.duration (DeployablePool — the cut-line
      // entity). It scans this.enemies+boss each fire beat + fires the PLAYER pool, so its hits resolve
      // through the existing projectile→enemy overlap. Placed on the player's body so it sits where you stand.
      // The turret reads spec.projectile over its lifetime, so pass a colour-scaled COPY of the spec (with a
      // cloned projectile) — never mutate the shared SKILLS row (Decision 9). ×1 at level 0 → identity.
      const turretSpec = spec.projectile
        ? { ...spec, projectile: { ...spec.projectile, damage: Math.round(spec.projectile.damage * m) } }
        : spec
      this.deployables.acquire(cx, cy, turretSpec)
    }
    this.sfx.skill(spec.kind) // skills slice (AC3) — the skill-use cue, timbre per kind.
  }

  // ── _radialDamage(x, y, radius, damage, knockback, status) (skills design §6.3, Decision 1, AC3) ── the
  // 'blast' skill's instant radial AoE: damage every LIVE, hittable enemy AND the boss within `radius` px of
  // (x, y), shoving each AWAY from the blast center. REUSES resolveHit (a synthetic swing from the blast
  // origin) + enemy.onHit + applyStatus + effects.hit — NO new combat primitive. The blast origin is the
  // attacker (so resolveHit's away-direction shoves each target out from the center); allowBackstab:false (a
  // radial blast never backstabs). A null radius/damage is a defensive no-op (the verifier guards positive).
  _radialDamage(x: number, y: number, radius: number, damage: number, knockback: number, status: SkillSpec['status']): void {
    if (radius <= 0 || damage <= 0) return
    const r2 = radius * radius
    const swing = { damage, knockback }
    // Apply to a single target if it's within range (DRY for the enemy loop + the boss).
    const hitTarget = (target: Enemy | Boss) => {
      if (!target || target.dead || (target as any).removed || !target.isHittable()) return
      const tx = target.body.center.x
      const ty = target.body.center.y
      const dx = tx - x
      const dy = ty - y
      if (dx * dx + dy * dy > r2) return // outside the blast radius.
      // The blast origin is the attacker; the target's away-direction shove comes from resolveHit's geometry.
      const result = resolveHit({ cx: x, facing: dx >= 0 ? 1 : -1 }, target.attackerShape, swing, { allowBackstab: false })
      target.onHit(result)
      // The skill's optional status (freeze/burn), scaled by Venom/Virulent, applied through the SAME helper as
      // the melee/projectile/spread paths so the onset cue (AC8) fires uniformly for EVERY status-application
      // path (DRY — _applyHitStatus guards null spec + !target.dead, so a no-status skill stays a no-op/identity).
      this._applyHitStatus(target, this._scaleStatus(status))
      this.effects.hit(tx, ty, { damage: result.damage })
      this.sfx.hit({ damage: result.damage }) // the impact cue (throttled in the façade for a multi-target blast).
    }
    for (const enemy of this.enemies) hitTarget(enemy)
    if (this.boss && !this.boss.removed) hitTarget(this.boss)
  }

  // ── _blastRingFx(x, y, radius) (skills design §6.3) ── a particle ring marking the blast edge (the visual
  // tell for the radial AoE). Reuses the pooled spark burst (effects.hit with damage 0 = sparks, no number/
  // shake spam) at the center plus a camera flash — primitives only, no new FX primitive (DRY).
  _blastRingFx(x: number, y: number, radius: number): void {
    this.effects.hit(x, y, { damage: 0 }) // a spark pop at the blast center (reuses the pooled sparks).
    this.cameras.main.flash(120, 120, 200, 255) // a faint blue pulse marks the blast (primitives only).
  }

  // ── _maybePlaceSkillPickup(desc) (skills design §6.5, AC5) ── deterministically (off the level seed) maybe
  // place ONE skill pickup so the loadout layer is obtainable in the world. Off a fresh mulberry32 (a DISTINCT
  // mix constant than the weapon/shop rolls, so the rolls don't correlate) — NOT on the generator's pinned
  // draw, so the level pin stays intact (the SAME off-the-pin discipline as the weapon pickup). Placed at a
  // standable spot off the entrance/exit, else a pickup point, else the midpoint.
  _maybePlaceSkillPickup(desc: LevelDescription): void {
    const rng = mulberry32((desc.seed ^ 0x5217115) >>> 0) // distinct mix from the weapon/shop/branch RNGs.
    if (rng() >= SKILL_PICKUP_CHANCE) return
    // Draws from the per-run RESOLVED skill pool (meta-progression §6.7, Decision 6) — === the 5 starters for a
    // default run (the identity), widened by a banked skill blueprint (the Shockwave).
    const skillId = this.skillPool[Math.floor(rng() * this.skillPool.length)].id
    const spot =
      desc.spawnCandidates[Math.floor(rng() * desc.spawnCandidates.length)] ||
      desc.pickups[0] ||
      { x: (desc.entrance.x + desc.exit.x) / 2, y: desc.entrance.y }
    this.pickupPool.acquire(spot.x, spot.y - TILE_SIZE, 'skill', { skillId })
  }

  // ── _applyRoomType(desc) (Enrichment round-2, §6.15) ── roll a tagged ROOM TYPE off the LEVEL seed (a
  // fresh sub-RNG, OFF the generator's pinned draw — the weapon-pickup/shop discipline) and arm its effects
  // for this level. A miniboss level is NEVER tagged (it already IS the set-piece). Sets this.roomType (read
  // by the spawn loop for forceElite/extraEnemies + the drop/reward sites for lootMult/guaranteedReward) and
  // this.roomDamageTakenMult (read at the player-hit sites — the cursed-room debuff). Pops a banner + a camera
  // flash so the type READS on entry. A 'normal' roll is the identity (no banner, neutral mults).
  _applyRoomType(desc: LevelDescription): void {
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
  _pickRoomType(rng: RNG): RoomType {
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
  _rollEliteForRoom(eliteRng: RNG): EliteAffixSpec | null {
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
  _placeRoomReward(desc: LevelDescription, roomType: RoomType): void {
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
  _popRoomBanner(roomType: RoomType): void {
    this.cameras.main.flash(260, (roomType.bannerColor >> 16) & 0xff, (roomType.bannerColor >> 8) & 0xff, roomType.bannerColor & 0xff)
    const banner = this.add
      .text(this.cameras.main.width / 2, 70, tName('roomType', roomType.id, roomType.name), {
        fontFamily: UI_FONT,
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
  _pickBossId(bossField: string | string[] | undefined): string {
    const ids = (Array.isArray(bossField) ? bossField : [bossField]).filter((id): id is string => !!id && !!BOSSES[id])
    if (ids.length === 0) return 'rampartsBoss' // defensive default (always present).
    const rng = mulberry32((this.runSeed ^ 0xb055ed) >>> 0) // off-the-pin: a run replays the same boss.
    return ids[Math.floor(rng() * ids.length)]
  }

  // Spawn an Enemy: build it (its melee strike draws from the shared enemyHitboxes pool, Decision 30;
  // the SHOOTER fires from the enemyProjectilePool, Decision 65), register its collider body as a
  // hurtbox, wire the kill-count + Cells-DROP hooks, and track it. A FLYER (spec.noGravity) opts OUT of
  // the per-level solids/oneWay colliders (review MINOR — it isn't pulled by the group default + doesn't
  // stand on the floor; its body gravity is off in the Enemy ctor) and patrols the WHOLE arena width.
  _spawnEnemy(
    x: number,
    y: number,
    spec: EnemySpec,
    {
      patrolMinX,
      patrolMaxX,
      worldDesc,
      elite = null,
    }: { patrolMinX?: number; patrolMaxX?: number; worldDesc?: LevelDescription; elite?: EliteAffixSpec | null } = {},
  ): Enemy {
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
      // ── Predator mutation (build-&-replay §6.3, AC3) ── heal a flat amount on each kill (0 = no mutation →
      // no-op, the identity; heal() no-ops at full HP / dead). The ONE site this new live-read field is read.
      if (this.player.onKillHealAmount > 0) this.player.heal(this.player.onKillHealAmount)
      // ── Hemorrhage spread-on-kill (affliction-synergy §6.6, Decision 5, AC5) ── an afflicted-enemy death
      // spreads its dominant DoT to the nearest pack members. Early-returns unless spreadAffliction is armed
      // AND the dying enemy carries a live DoT (the identity — no-op for a normal run). KILL-only (this hook
      // only fires on a real _die()), so there is no chain explosion. `enemy` is captured in this closure.
      if (this.runState.spreadAffliction) this._spreadAffliction(enemy)
      this.sfx.enemyDie() // audio §6.3 (AC2) — the death crumple (throttled in the façade for a multi-kill frame).
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
    ;(enemy as any)._noSolids = !!spec.noGravity
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
  spawnBossAdds(boss: Boss, atk: BossAttackSpec): void {
    const liveAdds = this.enemies.reduce((n, e) => n + ((e as any)._bossAdd && !e.dead && !e.removed ? 1 : 0), 0)
    const maxAdds = atk.maxAdds ?? 3
    const want = Math.min(atk.count ?? 1, Math.max(0, maxAdds - liveAdds))
    if (want <= 0) return // already at the live-add cap — the summon fizzles (the snowball guard).
    const base = ENEMY_SPECS[atk.spec as string] || ENEMY_SPECS.grunt
    // ── BOSS-CELL TIER (meta-progression §6.7, Decision 10, AC8 — review fix) ── summoned boss adds are an
    // enemy-spawn fold site, so they MUST carry the run's Boss-Cell tier exactly like the room-enemy spawn
    // loop (611), the miniboss (773), and the finale boss (860). The boss arena has NO normal room enemies,
    // so these adds are the ONLY non-boss enemies in the finale — at a high tier the boss is buffed but its
    // reinforcements must scale too, or the adds spawn at tier-0 strength (strictly weaker than every other
    // enemy that run). bossCellMult 1 = tier 0 = byte-identical to before this slice (the identity).
    const spec = scaleSpec(base, scaleAtDepth(this.runState.depth, this.runState.bossCellMult))
    const desc = this.desc
    const minX = TILE_SIZE * 2
    const maxX = (desc ? desc.worldWidth : boss.maxX + TILE_SIZE * 2) - TILE_SIZE * 2
    for (let i = 0; i < want; i++) {
      // Flank the boss alternately left/right so adds appear beside it (clamped into the arena interior).
      const side = i % 2 === 0 ? -1 : 1
      const x = Phaser.Math.Clamp(boss.body.center.x + side * (boss.spec.bodyW * 0.5 + TILE_SIZE), minX, maxX)
      const y = boss.body.center.y
      const add = this._spawnEnemy(x, y, spec, { patrolMinX: minX, patrolMaxX: maxX, worldDesc: desc })
      ;(add as any)._bossAdd = true // tag so the live-add cap counts only summoned adds (not room enemies).
    }
  }

  // ── _maybePlaceWeaponPickup(desc) (§6.5, Decision 63) ── deterministically (off the level seed)
  // maybe place ONE weapon pickup so swapping is a real mid-run choice. Off the seeded level RNG (a
  // fresh mulberry32) so it's NOT on the generator's pinned draw sequence — the level pin stays intact.
  _maybePlaceWeaponPickup(desc: LevelDescription): void {
    const rng = mulberry32((desc.seed ^ 0x5eed1234) >>> 0)
    if (rng() >= WEAPON_PICKUP_CHANCE) return
    // Pick a weapon that ISN'T the currently equipped one (a meaningful swap), else any. Draws from the per-run
    // RESOLVED pool (meta-progression §6.7, Decision 6) — starters ∪ unlocked blueprints; === the 4 starters
    // for a default run (the identity), widened by a banked weapon blueprint (the Glaive).
    const choices = this.weaponPool.filter((id) => id !== this.runState.weaponId)
    const pool = choices.length ? choices : this.weaponPool
    const weaponId = pool[Math.floor(rng() * pool.length)]
    // Enrichment round-2 — roll a weapon AFFIX off the SAME level RNG (deterministic; a run replays the same
    // affixed loot). Stamped on the pickup so collection folds + equips the modified weapon (the build engine).
    const weaponAffixId = this._rollWeaponAffix(rng)
    // Place it at a spawn spot away from the entrance (the first pickup point, or the level midpoint).
    const spot = desc.pickups[0] || { x: (desc.entrance.x + desc.exit.x) / 2, y: desc.entrance.y }
    this.pickupPool.acquire(spot.x, spot.y - TILE_SIZE, 'weapon', { weaponId, weaponAffixId })
  }

  // ── _maybePlaceBlueprintPickup(desc) (meta-progression §6.7, Decision 6/7, AC9) ── deterministically (off
  // the level seed) maybe drop ONE locked-blueprint pickup. Off a fresh mulberry32 with a DISTINCT mix constant
  // (so it doesn't correlate with the weapon/skill/shop/branch rolls) — NOT on the generator's pinned draw, so
  // the level pin stays intact (the SAME off-the-pin discipline as the weapon pickup). Only LOCKED blueprints
  // (not unlocked in the meta AND not already carried this run) are worth dropping — so a player never re-finds
  // one they have. Placed at the level's first pickup spot (or the entrance) so it's reachable on the path.
  _maybePlaceBlueprintPickup(desc: LevelDescription): void {
    // The droppable set: blueprints neither already unlocked (meta) nor already collected this run (runState).
    const locked = BLUEPRINTS.filter((b) => !this.unlockedBlueprints.has(b.id) && !this.runState.blueprints.includes(b.id))
    if (locked.length === 0) return // nothing left to find → no drop (the all-unlocked no-op).
    const rng = mulberry32((desc.seed ^ 0xb1ce9111) >>> 0) // distinct mix from the weapon/skill/shop/branch RNGs.
    if (rng() >= BLUEPRINT_PICKUP_CHANCE) return
    const bp = locked[Math.floor(rng() * locked.length)]
    const spot = desc.pickups[0] || { x: (desc.entrance.x + desc.exit.x) / 2, y: desc.entrance.y }
    this.pickupPool.acquire(spot.x, spot.y - TILE_SIZE, 'blueprint', { blueprintId: bp.id })
  }

  // ── _maybePlaceShop(desc) (§6.10, Decision 74/76, AC63 — the GOLD SINK) ── deterministically (off the
  // level seed) maybe place ONE Shop vendor so collected gold has a regular outlet. Off a fresh mulberry32
  // (a DIFFERENT mix constant than the weapon pickup's, so the two rolls don't correlate) — NOT on the
  // generator's pinned draw, so the level pin stays intact. Placed at a standable spawn candidate AWAY from
  // the entrance/exit (so the player can't sit on it at spawn / clip the door), else the level midpoint.
  // Wires the in-range overlap so pressing E opens the buy menu (_tryOpenShop → _openShop). this.shop is
  // null on levels without a vendor (the _tryOpenShop guard handles that) + on the boss arena (no shop).
  _maybePlaceShop(desc: LevelDescription): void {
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
  _placeBranchReward(desc: LevelDescription): void {
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
      const choices = this.weaponPool.filter((id) => id !== this.runState.weaponId) // the per-run resolved pool (§6.7).
      const pool = choices.length ? choices : this.weaponPool
      const weaponId = pool[Math.floor(rng() * pool.length)]
      const weaponAffixId = this._rollWeaponAffix(rng)
      this.pickupPool.acquire(x, y, 'weapon', { weaponId, weaponAffixId })
    } else if (roll < 0.58) {
      // A run-only scroll boost (build power) — picks a deterministic scroll id off the same RNG.
      const scrollId = SCROLL_IDS[Math.floor(rng() * SCROLL_IDS.length)]
      this.pickupPool.acquire(x, y, 'scroll', { scrollId })
    } else if (roll < 0.68) {
      // A SKILL (skills design §6.5, AC5 — the treasure branch is a prime spot for the build-defining loadout
      // layer). Picks a deterministic skill id off the same RNG; collection equips it into the loadout.
      // IDENTITY (AC8): the skill band is carved out of the FORMER gold band ONLY ([0.58,0.68) was gold at
      // HEAD) so the weapon (<0.34), scroll (<0.58) and heal (≥0.8) outcomes — and their rng() draw counts —
      // stay BYTE-IDENTICAL to pre-skills HEAD for the same seed. Only the gold band shrinks (0.58..0.8 →
      // 0.68..0.8) to make room additively; the others are untouched.
      const skillId = this.skillPool[Math.floor(rng() * this.skillPool.length)].id // the per-run resolved pool (§6.7).
      this.pickupPool.acquire(x, y, 'skill', { skillId })
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
  _hurtPlayer(result: HitResult): void {
    const mult = this.roomDamageTakenMult ?? 1
    if (mult !== 1) result.damage = Math.round(result.damage * mult)
    // ── Parry cue (per-weapon-movesets §6.6, Decision 5, AC8) ── the parry window is still LIVE at this instant
    // (onHit consumes it). ALL four player-hit sites funnel through here (DRY — one place), so checking the live
    // window here pops the "PARRY!" cue + a bright flash for ANY parried hit (enemy melee / contact / projectile
    // / hazard). The Player's onHit does the actual NEGATION (no HP, no knockback) + arms the riposte. A parried
    // ENEMY PROJECTILE is simply consumed by that negated onHit (no deflect-back — YAGNI). With V never pressed
    // parryTimer is 0 → this branch is skipped and _hurtPlayer is byte-identical to before (the identity, AC10).
    if (this.player.parryTimer > 0) {
      this.effects.parry(this.player.body.center.x, this.player.body.center.y)
      this.cameras.main.flash(90, 90, 200, 255) // a brief cyan flash marks the perfect parry (primitives only).
    }
    this.player.onHit(result)
  }

  _dedupFilter(hitboxRect: any, enemyRect: any): boolean {
    const hb = hitboxRect.hb
    const enemy = enemyRect.enemyRef
    if (!hb.active || !enemy || !enemy.isHittable()) return false
    return !hb.hitSet.has(enemy.id)
  }

  _onPlayerHitEnemy(hitboxRect: any, enemyRect: any): void {
    const hb = hitboxRect.hb
    const enemy = enemyRect.enemyRef
    if (!hb.active || !enemy || !enemy.isHittable() || hb.hitSet.has(enemy.id)) return
    hb.hitSet.add(enemy.id)
    // PLAYER melee damage = swing × backstab × (meta meleeDamageMult × run scrollDamageMult × MUTATION folds),
    // composed + rounded ONCE in resolveHit (§6.5, Decision 60 — the mult is PASSED IN, damage.js stays pure).
    // _mutationDamageMult folds the Berserker (low-HP) + Assassin (full-HP target) perks (1× when no mutation).
    const result = resolveHit(this.player.attackerShape, enemy.attackerShape, hb.swing, {
      allowBackstab: true,
      // color-scaling-stats §6 (Decision 8) — × the equipped weapon's colour mult (×1 at level 0 → identity).
      damageMult: this.player.meleeDamageMult * this.player.scrollDamageMult * this._mutationDamageMult(enemy) * this._weaponColorMult(),
    })
    // ── Riposte spend (per-weapon-movesets §6.6, Decision 5, AC8) ── _mutationDamageMult folded the riposte
    // bump into `result` above; zero the buff now so it's SPENT on THIS connecting hit (one-shot). 0 by default
    // → no-op (identity, AC10).
    this.player.riposteTimer = 0
    enemy.onHit(result)
    // ── Charged hammer AoE (per-weapon-movesets §6.6, Decision 3, AC4) ── on the FIRST connecting hit of a
    // charged smash the Player has a pending AoE; reuse _radialDamage (NO new combat math — the SAME primitive
    // the blast skill uses) to smash + LONG-stun (the armor-break stagger) every enemy/boss within the radius,
    // radiating from where the smash landed. result.damage already includes the ×charge.damageMult (baked into
    // the swing row), so the shockwave hits as hard as the primary. null on every plain/tap hit → no-op (AC10).
    const aoe = this.player.consumePendingAoe()
    if (aoe) {
      this._radialDamage(
        enemy.body.center.x,
        enemy.body.center.y,
        aoe.radius,
        result.damage,
        hb.swing.knockback,
        { kind: 'stun', duration: aoe.stun },
      )
    }
    // ── STATUS (§6.13, Decision 79, AC66; Venom round 3; Virulent affliction-synergy) ── apply the EQUIPPED
    // melee weapon's status (spear → bleed, hammer → stun, a Searing affix → burn) to the struck enemy,
    // scaled by the run-only duration/tick mults. Null for a weapon with no status tag (sword) → no-op
    // (identity). Compute isNew BEFORE applying (Decision 4) so the application cue fires ONCE on onset (a NEW
    // entry), never on a refresh — and pop it at THIS site (the scene already owns effects + the victim center).
    this._applyHitStatus(enemy, this._scaleStatus(this.player.equippedWeapon.status))
    // ── LIFESTEAL (Vampirism scroll round 3 + Vampiric weapon affix round-2) ── heal a fraction of the MELEE
    // damage dealt. The scroll lifesteal (player.lifestealFrac) and the EQUIPPED weapon's affix lifesteal
    // (equippedWeapon.affixLifestealFrac — 0 on a plain/unaffixed weapon) ADD (a Vampiric weapon on a
    // Vampirism build sustains hard). 0 by default → no heal (the identity); heal() no-ops at full HP / dead.
    const lifesteal = this.player.lifestealFrac + ((this.player.equippedWeapon as any).affixLifestealFrac ?? 0)
    if (lifesteal > 0 && result.damage > 0) {
      this.player.heal(Math.round(result.damage * lifesteal))
    }
    this.effects.hit(enemy.body.center.x, enemy.body.center.y, {
      damage: result.damage,
      isBackstab: result.isBackstab,
    })
    // audio §6.3 (AC2) — the melee impact, brightness/volume scaled by damage; a backstab is distinct.
    this.sfx.hit({ damage: result.damage, crit: result.isBackstab })
  }

  // ── _scaleStatus(spec) (Enrichment round 3 — Venom; affliction-synergy §6.6 — Virulent) ── return a status
  // spec scaled by the run-only mults (mirrored on the player): `duration` × statusDurationMult (Venom) AND a
  // damaging status's `tickDmg` × statusTickMult (Virulent — "ticks harder"). Returns the spec UNCHANGED when
  // BOTH mults are 1 (the identity — no scroll/mutation) or the spec is null (a no-status weapon), so a normal
  // run is byte-identical (AC4/AC10). A NEW shallow-clone is returned when scaled (never mutating the shared
  // weapon spec — the aliasing safety every fold keeps). applyStatus reads duration + tickDmg.
  _scaleStatus(spec: any): any {
    if (!spec) return spec
    const dur = this.player.statusDurationMult ?? 1
    const tick = this.player.statusTickMult ?? 1
    if (dur === 1 && tick === 1) return spec
    const scaled = { ...spec, duration: (spec.duration ?? 0) * dur }
    if (spec.tickDmg) scaled.tickDmg = spec.tickDmg * tick
    return scaled
  }

  // ── _colorLevel(colorId) (color-scaling-stats §6, Decision 8, AC5) ── read the run level for a colour id off
  // RunState (the single source). All default 0 → colorMult(0) === 1 (the identity). A plain switch (KISS).
  _colorLevel(c: ColorId): number {
    return c === 'brutality' ? this.runState.brutalityLevel : c === 'tactics' ? this.runState.tacticsLevel : this.runState.survivalLevel
  }

  // ── _weaponColorMult() (color-scaling-stats §6, Decision 8, AC5) ── the ×damage multiplier for the EQUIPPED
  // weapon's colour at its current run level. Multiplied INTO the player's damageMult at BOTH player hit sites
  // (melee + projectile — DRY). colorMult(0) === 1 → at all-0 levels this is ×1 (byte-identical, the identity).
  _weaponColorMult(): number {
    return colorMult(this._colorLevel(this.player.equippedWeapon.scaling))
  }

  // ── _mutationDamageMult(target) (build-&-replay design §6.3, Decision 4, AC3) ── the per-hit MUTATION damage
  // fold, multiplied INTO the player's damageMult at BOTH player hit sites (melee + projectile — DRY). Two
  // conditional perks:
  //   • Berserker (lowHpDamageMult) — applies while the PLAYER is below LOW_HP_THRESHOLD of max HP (fight
  //     harder when cornered). Read off the live player HP at hit time.
  //   • Assassin (firstHitBonusMult) — applies when the struck enemy is at FULL HP (the opener/burst bonus).
  // Returns 1 when no mutation is armed (both fields default to 1) AND neither condition holds → byte-identical
  // to before (the identity, AC3). The two compose multiplicatively when both apply. `target` is the Enemy/Boss
  // being struck; we read its hp/maxHp (both expose those — DRY) to gate the full-HP opener.
  _mutationDamageMult(target: any): number {
    let mult = 1
    if (this.player.lowHpDamageMult !== 1 && this.player.hp < this.player.maxHp * LOW_HP_THRESHOLD) {
      mult *= this.player.lowHpDamageMult
    }
    if (this.player.firstHitBonusMult !== 1 && target && target.hp >= target.maxHp) {
      mult *= this.player.firstHitBonusMult
    }
    // ── Hemorrhage vs-afflicted fold (affliction-synergy §6.6, Decision 2, AC3) ── ×damage when the struck
    // target carries ANY live affliction (bleed/poison/burn/stun — a stunned enemy is afflicted too, so the
    // bonus reads while you wail on a stun-locked target). Guarded by !==1 so it's a no-op when no Hemorrhage
    // is armed → byte-identical (identity, AC10). Composes multiplicatively with the perks above.
    if (
      this.player.vsAfflictedDamageMult !== 1 &&
      target && target.statuses &&
      (hasStatus(target.statuses, 'bleed') ||
        hasStatus(target.statuses, 'poison') ||
        hasStatus(target.statuses, 'burn') ||
        hasStatus(target.statuses, 'stun'))
    ) {
      mult *= this.player.vsAfflictedDamageMult
    }
    // ── Riposte fold (per-weapon-movesets §6.6, Decision 5, AC8) ── ×damage on the next connecting hit after a
    // SUCCESSFUL parry (player.riposteDamageMult is RIPOSTE_DAMAGE_MULT while the riposte buff is live, else 1).
    // The CALLER (_onPlayerHitEnemy / _onProjectileHitEnemy) zeroes player.riposteTimer after a connecting hit
    // so the buff is SPENT once (a one-shot bump, not a decaying aura). 1× when no parry is live → identity (AC10).
    mult *= this.player.riposteDamageMult
    return mult
  }

  // ── _applyHitStatus(target, spec) (affliction-synergy §6.6, Decision 4, AC8) ── apply an already-scaled
  // status spec to a struck enemy/boss AND pop the one-shot application cue ONCE on onset. We compute isNew
  // BEFORE the apply (a status absent now-but-present-after is a NEW application — a refresh is not), so the
  // cue marks the ONSET only (a re-hit on an already-afflicted enemy does NOT re-pop — KISS). This confines
  // the "is this new?" diff to the hit site (the scene already owns effects + the victim center), keeping
  // Enemy/Boss applyStatus byte-identical (no effects coupling). null spec (a no-status weapon) → no-op
  // (the identity — byte-identical to before this slice).
  _applyHitStatus(target: Enemy | Boss, spec: any): void {
    if (!spec) return
    const isNew = !hasStatus(target.statuses, spec.kind)
    target.applyStatus(spec)
    if (isNew && !target.dead) {
      this.effects.statusApply(target.body.center.x, target.body.center.y, spec.kind)
    }
  }

  // ── _spreadAffliction(dying) (affliction-synergy §6.6, Decision 5, AC5) ── the Hemorrhage spread-on-kill:
  // when an enemy with a live DAMAGING affliction dies, copy a FRESH (reduced-duration) spec of its dominant
  // damaging kind to up to SPREAD_MAX_TARGETS nearest live OTHER enemies within SPREAD_RADIUS. KILL-only
  // (called from the onDeath hook) — the spread application never triggers another death this frame, so there
  // is no chain explosion (stun does NOT spread — KISS). The spread runs through _scaleStatus so a Virulent/
  // Toxic build's mults still apply (consistent). Deterministic (no RNG — nearest-N by distance), so it never
  // perturbs the seed chain / level pin. Bosses are the SEPARATE this.boss reference (not in this.enemies), so
  // a boss-kill spread is a harmless no-op (a boss death has no "nearby pack" — KISS).
  _spreadAffliction(dying: Enemy): void {
    if (!this.runState.spreadAffliction) return
    // Pick the dominant DAMAGING kind (stun never spreads). No live DoT → nothing to spread (identity).
    const kind = hasStatus(dying.statuses, 'burn')
      ? 'burn'
      : hasStatus(dying.statuses, 'bleed')
        ? 'bleed'
        : hasStatus(dying.statuses, 'poison')
          ? 'poison'
          : null
    if (!kind) return
    const cx = dying.body.center.x
    const cy = dying.body.center.y
    const r2 = SPREAD_RADIUS * SPREAD_RADIUS
    // Gather live OTHER enemies in range, nearest-first (deterministic — no RNG), then take the nearest N.
    const targets: { e: Enemy; d2: number }[] = []
    for (const e of this.enemies) {
      if (e === dying || e.dead || e.removed || !e.isHittable()) continue
      const dx = e.body.center.x - cx
      const dy = e.body.center.y - cy
      const d2 = dx * dx + dy * dy
      if (d2 > r2) continue
      targets.push({ e, d2 })
    }
    targets.sort((a, b) => a.d2 - b.d2)
    for (let i = 0; i < targets.length && i < SPREAD_MAX_TARGETS; i++) {
      // A FRESH reduced-duration spec (the spread tax), run through _scaleStatus so the build's mults apply.
      // _applyHitStatus pops the onset cue per NEW application (Decision 5 — the cascade reads).
      this._applyHitStatus(targets[i].e, this._scaleStatus(SPREAD_SPEC[kind]))
    }
  }

  // ── Projectile → enemy hit (§6.5, Decision 62, review MAJOR) ── a SEPARATE handler from the melee
  // one: the attacker shape is the PROJECTILE's (its live position + travel dir), so backstab/knockback
  // geometry derives from where the SHOT is — not the player. Reuses the SAME resolveHit + effects.hit
  // pipeline (DRY). This overlap is wired against the PLAYER projectile pool ONLY, so every shot here is
  // the player's: it scales with the RANGED damage mult (§6.9, Decision 73 — the bow rides the ranged-damage
  // meta, NOT the melee one) × the run-only scroll mult. The shot dies on first hit (KISS — no pierce); the
  // per-shot hitSet already deduped.
  _onProjectileHitEnemy(projRect: any, enemyRect: any): void {
    const pj = projRect.pj
    const enemy = enemyRect.enemyRef
    if (!pj.active || !enemy || !enemy.isHittable() || pj.hitSet.has(enemy.id)) return
    pj.hitSet.add(enemy.id)
    // The projectile's spec carries damage/knockback (read like a swing row by resolveHit).
    const swing = { damage: pj.spec.damage, knockback: pj.spec.knockback }
    const result = resolveHit(pj.attackerShape, enemy.attackerShape, swing, {
      allowBackstab: true,
      // color-scaling-stats §6 (Decision 8) — × the equipped weapon's colour mult (×1 at level 0 → identity).
      damageMult: this.player.rangedDamageMult * this.player.scrollDamageMult * this._mutationDamageMult(enemy) * this._weaponColorMult(),
    })
    // Riposte spend (per-weapon-movesets §6.6, Decision 5, AC8) — _mutationDamageMult folded the bump into
    // `result`; zero it so the buff is SPENT on this connecting shot (one-shot). 0 by default → no-op (AC10).
    this.player.riposteTimer = 0
    enemy.onHit(result)
    // ── STATUS (§6.13, Decision 79, AC66; Venom round 3; Virulent affliction-synergy) ── apply the firing
    // weapon's status stamped on the shot (the bow's poison, a Searing affix's burn) to the struck enemy,
    // scaled by the run-only duration/tick mults. null for a no-status weapon → no-op (identity). Read off the
    // PROJECTILE (pj.status, stamped at fire) so a mid-flight weapon swap doesn't change what the shot does.
    // The application cue fires ONCE on a NEW entry (Decision 4 — isNew computed before applying).
    this._applyHitStatus(enemy, this._scaleStatus(pj.status))
    this.effects.hit(enemy.body.center.x, enemy.body.center.y, {
      damage: result.damage,
      isBackstab: result.isBackstab,
    })
    // audio §6.3 (AC2) — the projectile impact, same timbre as melee (one "I connected" sound, DRY).
    this.sfx.hit({ damage: result.damage, crit: result.isBackstab })
    // ── Pierce-aware release (per-weapon-movesets §6.6, Decision 7, AC7) ── decrement the shot's pierceLeft;
    // release ONLY when it reaches 0. A normal (tap) shot's pierceLeft is 1 → released on the first hit (the
    // dies-on-first-hit identity, AC10). A CHARGED bow shot's pierceLeft is pierce.maxTargets → it survives +
    // passes THROUGH a line of distinct enemies (the per-shot hitSet already dedups, so it never re-hits one).
    pj.pierceLeft--
    if (pj.pierceLeft <= 0) this.projectilePool.release(projRect)
  }

  // ── ENEMY projectile → player hit (§6.6.3, Decision 65, review BLOCKER/MAJOR) ── the INVERSE of
  // _onProjectileHitEnemy: an 'enemy'-tagged shot (Shooter/boss volley) hitting the PLAYER. Reads the
  // PROJECTILE's attackerShape (its live position + travel dir — NOT the firer's), builds a swing from
  // the shot's spec, resolves via the SAME resolveHit pipeline with allowBackstab:false + damageMult:1
  // (enemies NEVER get the player's melee/scroll mults — the review-pinned rule in damage.js), applies
  // it to the player, and releases the shot on hit. A per-shot hitSet dedup (already filtered) stops a
  // multi-frame-alive shot from re-hitting the player.
  _onEnemyProjectileHitPlayer(projRect: any): void {
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
  _onPickup(pickupRect: any): void {
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
      case 'skill': {
        // skills slice (AC5) — equip the skill into the loadout (first empty slot, else slot 0) + record the
        // id on RunState so a level rebuild re-equips it (DRY — _acquireSkill is shared with the shop/branch).
        if (pk.skillId) this._acquireSkill(pk.skillId)
        break
      }
      case 'blueprint': {
        // meta-progression §6.7 (Decision 7, AC9) — record the blueprint id on runState (RUN-ONLY — it's banked
        // to the meta at run end via bankRun, on BOTH the death + clear paths, like a Cell). Dedup so a re-touch
        // (shouldn't happen — the drop is gated to LOCKED ids) is a no-op.
        if (pk.blueprintId && !this.runState.blueprints.includes(pk.blueprintId)) {
          this.runState.blueprints.push(pk.blueprintId)
        }
        break
      }
    }
    // A small collect pop (reuse the spark pool — no new allocation).
    this.effects.hit(pickupRect.body.center.x, pickupRect.body.center.y, { damage: 0 })
    // audio §6.3 (AC4) — the pickup blip, pitch per kind (cell/gold/scroll/weapon/heal).
    this.sfx.pickup(pk.kind)
    this.pickupPool.release(pickupRect)
  }

  // ── Sync run-only scroll stats onto the live Player (§6.5, Decision 60; Enrichment round 3) ──
  // scrollDamageMult is read LIVE at the hit site, but we mirror EVERY run-only scroll field onto the
  // player here so the live reads (dodge cooldown/i-frames at the dodge-start site, lifesteal + status
  // duration at the melee-hit site) see the armed values without reaching into RunState each frame.
  // scrollMaxHpBonus is a flat max-HP boost: raise the player's maxHp to base+bonus and HEAL by the
  // just-added amount (so a vitality scroll both grows + tops up). All other fields are neutral by
  // default (a fresh run with no scroll leaves the Phase-4 player exactly — the additive identity).
  _syncPlayerScrollStats(): void {
    this.player.scrollDamageMult = this.runState.scrollDamageMult
    this.player.scrollDodgeCdMult = this.runState.scrollDodgeCdMult
    this.player.scrollDodgeIframeBonus = this.runState.scrollDodgeIframeBonus
    this.player.lifestealFrac = this.runState.scrollLifestealFrac
    this.player.statusDurationMult = this.runState.scrollStatusDurationMult
    // ── MUTATION perk fields (build-&-replay §6.3, AC3) ── mirror the NEW live-read fields too so the player's
    // hit-site folds (lowHp/firstHit) + the enemy-kill heal (onKillHealAmount) see the armed values. All default
    // to the neutral identity on RunState, so a run with no mutation leaves the player exactly as before.
    this.player.onKillHealAmount = this.runState.onKillHealAmount
    this.player.lowHpDamageMult = this.runState.lowHpDamageMult
    this.player.firstHitBonusMult = this.runState.firstHitBonusMult
    // ── Affliction-synergy live-read mirrors (affliction-synergy §6.6, AC9) ── mirror the two player-read
    // scalars so the hit-site folds see the armed values. vsAfflictedDamageMult → _mutationDamageMult;
    // statusTickMult → _scaleStatus. spreadAffliction is read off runState directly in onDeath (no mirror).
    // Both default to the neutral identity on RunState, so a run with no synergy leaves the player as before.
    this.player.vsAfflictedDamageMult = this.runState.vsAfflictedDamageMult
    this.player.statusTickMult = this.runState.statusTickMult
    // color-scaling-stats §6 (Decision 6) — fold the Survival flat +max HP into the SAME scrollMaxHpBonus
    // derivation (zero new max-HP wiring; the heal-on-grow comes free). survivalHpBonus(0) === 0 → at level 0
    // this adds nothing (the identity). When a Survival level is gained, the next sync grows max HP + heals by
    // the delta (the colour-pick/scroll apply calls this — mirroring _applyMutation, AC7).
    const newMax = this.runState.maxHp + this.runState.scrollMaxHpBonus + survivalHpBonus(this.runState.survivalLevel)
    const grew = newMax - this.player.maxHp // how much max-HP just increased (≥0).
    this.player.maxHp = newMax
    if (grew > 0) this.player.hp = Math.min(newMax, this.player.hp + grew) // heal by the grown amount.
  }

  // ── _drinkFlask() (design §6.9, Decision 72 — the HP-recovery valve) ── spend ONE flask charge to heal a
  // fraction of MAX HP. Guarded: no-op with no charges, while dead/transitioning, or already at full HP (so
  // a charge is never wasted on a no-heal — the heal() return is the truth). On a real heal: decrement the
  // charge, pop a green heal FX, flash the camera faint green. Flask charges REFILL on a biome transition
  // (_nextLevel) so HP management is a real per-biome resource decision (the genre's healing-flask loop).
  _drinkFlask(): void {
    if (this.gameOver || this.transitioning) return
    if (this.runState.flasks <= 0) return
    const amount = Math.round(this.player.maxHp * this.runState.flaskHealFrac)
    const healed = this.player.heal(amount)
    if (healed <= 0) return // already full → don't burn a charge.
    this.runState.flasks -= 1
    this.effects.hit(this.player.body.center.x, this.player.body.center.y - 10, { damage: 0 })
    this.sfx.flask() // audio §6.3 (AC4) — the drink/refresh blip.
    this.cameras.main.flash(160, 46, 204, 113) // a faint green pulse so the heal reads.
  }

  // ── _tryOpenShop() (§6.10, Decision 74/76, AC63) ── open the in-run shop if the player is standing on
  // the vendor. Defined here so the update() interact-edge wiring has a single call site; the buy menu UI
  // lives in the ShopOverlay (_openShop news it up). Guards: no vendor on this level (this.shop null), not
  // in range, already open, or a death/transition in flight → no-op (the phantom-stub crash is gone — a
  // real Shop entity + a real _openShop now exist).
  _tryOpenShop(): void {
    if (this.gameOver || this.transitioning || this.shopOpen) return
    if (this.shop && this.shop.playerInRange) this._openShop()
  }

  // ── _openShop() (§6.10, Decision 74/76, AC63) ── freeze gameplay (shopOpen gates update) + raise the
  // buy overlay. The overlay is DECOUPLED (SOLID): it reads gold via getGold + attempts a buy via onBuy
  // (_buyShopItem deducts + applies) + resumes via onClose — so the economy logic stays in the scene. The
  // E press that opened it was consumed by Input.sample this frame, so the overlay's own keydown-E (buy)
  // fires only on the NEXT press (no instant-buy-on-open). Player velocity is zeroed so it doesn't drift
  // under the frozen overlay (gameplay update is gated, but the body would otherwise keep its momentum).
  _openShop(): void {
    if (this.shopOpen) return
    this.shopOpen = true
    this._pauseLevelTimer() // exclude the frozen shopping time from the fast-clear timer (review MINOR).
    this.player.body.setVelocity(0, 0)
    this.shopOverlay = new ShopOverlay(this, {
      getGold: () => this.runState.gold,
      onBuy: (item) => this._buyShopItem(item),
      onClose: () => this._closeShop(),
    })
  }

  // ── _closeShop() (§6.10) ── the overlay's onClose callback: drop the overlay handle + un-freeze gameplay.
  // (The overlay already destroyed its own GameObjects + removed its keyboard handlers in close().) Idempotent.
  _closeShop(): void {
    this.shopOpen = false
    this.shopOverlay = null
    // Swallow the E down-edge that selected LEAVE: the SAME physical press is processed at PRE_RENDER (after this
    // frame's update) and arms JustDown(e); without consuming it, next frame's sample() reads it as interactPressed
    // and _tryOpenShop instantly REOPENS the shop (the close→reopen race). No-op when LEAVE came via SPACE/ENTER.
    this.input2.consumeInteract()
    this._resumeLevelTimer() // re-stamp the timer past the frozen shopping interval (review MINOR).
  }

  // ── _toggleQuitConfirm() (esc-quit-confirm) ── the persistent ESC handler's one entry point. ESC toggles the
  // confirm modal: CANCEL (resume) when it's already open, else OPEN it — but never STACK on another modal / a
  // death / an in-flight transition (the same guard set _tryOpenShop uses). ONE handler reading current state is
  // what gives the "second ESC cancels" behaviour cleanly.
  _toggleQuitConfirm(): void {
    if (this.quitConfirmOpen) {
      this._closeQuitConfirm()
      return
    }
    if (this.gameOver || this.transitioning || this.shopOpen || this.mutationOpen || this.colorPickOpen) return
    this._openQuitConfirm()
  }

  // ── _openQuitConfirm() (esc-quit-confirm) ── freeze gameplay (quitConfirmOpen gates update) + raise the confirm
  // modal. DECOUPLED (SOLID): the overlay only gets onQuit (→ scene.start('Title'), discarding the run exactly as
  // the old dev shortcut did) + onCancel (→ _closeQuitConfirm). Zero the player velocity so it doesn't drift under
  // the frozen overlay, and pause the fast-clear timer so deciding isn't charged against the window (like the shop /
  // mutation modals). Guard mirrors _offerMutation (flag OR live handle) so a desync can't stack two overlays.
  _openQuitConfirm(): void {
    if (this.quitConfirmOpen || this.quitConfirmOverlay) return
    this.quitConfirmOpen = true
    this._pauseLevelTimer()
    this.player.body.setVelocity(0, 0)
    this.quitConfirmOverlay = new QuitConfirmOverlay(this, {
      onQuit: () => this.scene.start('Title'),
      onCancel: () => this._closeQuitConfirm(),
    })
  }

  // ── _closeQuitConfirm() (esc-quit-confirm) ── the RESUME path: drop the overlay + un-freeze gameplay. Reached
  // three ways, all idempotent: the overlay's RESUME row (onCancel), the ESC-while-open toggle, and (defensively)
  // SHUTDOWN. close() is a no-op if the overlay already self-tore-down (RESUME-row path); it does the real teardown
  // on the ESC-cancel path (where the overlay did NOT self-teardown). Swallow the pending SPACE (jump) + E (interact)
  // edges so a confirm-key RESUME doesn't leak a jump / instantly reopen a vendor onto the first un-frozen frame.
  _closeQuitConfirm(): void {
    if (!this.quitConfirmOpen) return
    if (this.quitConfirmOverlay) {
      this.quitConfirmOverlay.close()
      this.quitConfirmOverlay = null
    }
    this.quitConfirmOpen = false
    this.input2.consumeJump() // no jump on resume when RESUME was confirmed via SPACE (AC8).
    this.input2.consumeInteract() // no shop-reopen when RESUME was confirmed via E (the close→reopen race, AC8).
    this._resumeLevelTimer()
  }

  // ── _buyShopItem(item) (§6.10, Decision 74/76, AC63 — the GOLD SINK) ── attempt a purchase: if the run
  // can't afford item.price gold → false (the overlay re-renders the row red). Otherwise DEDUCT the gold
  // and APPLY the effect by `kind` (a small known set, like the Pickup handler — DRY: it reuses the SAME
  // heal/scroll/weapon paths). Run-only: gold + the bought boosts all die on death (permadeath). Returns
  // true on a successful buy. ONE place owns the economy (the overlay never touches RunState/Player).
  _buyShopItem(item: ShopItem): boolean {
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
        this._equipWeaponWithAffix(item.weaponId as string, affixId) // fold + equip + record on RunState (DRY).
        break
      }
      case 'skill': {
        // skills slice (AC5) — buy a specific skill into the loadout (the SAME _acquireSkill path the pickup +
        // branch use: fill the first empty slot, else slot 0; record on RunState for the rebuild — DRY).
        this._acquireSkill(item.skillId as string)
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
  _applyStartingScrolls(n: number): void {
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
  _grantBiomePowerScroll(): void {
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

  // ── _offerMutation() (build-&-replay design §6.5, Decision 2/3, AC2) ── on a biome transition, offer a
  // SEEDED 3-of-N mutation choice in a paused overlay (the build lever — a different perk loadout each run).
  // Draws 3 DISTINCT mutations off an OFF-THE-PIN sub-RNG seeded from the run seed ⊕ a biome salt (the same
  // discipline as the weapon-pickup/room-type picks — the generator's pinned draw thread is untouched), so a
  // run REPLAYS the same offers (determinism — AC2). Freezes gameplay (mutationOpen gates update) + opens the
  // overlay; the pick callback applies the mutation. Defensive: if (somehow) <2 mutations exist, or one is
  // already open, no-op. KISS: one offer site, mirroring _grantBiomePowerScroll's seam.
  _offerMutation(): void {
    if (this.mutationOpen || this.mutationOverlay) return // already offering (defensive — should never re-enter).
    const rng = mulberry32((this.runSeed ^ 0x303 ^ (this.runState.biomeIndex * 0x85ebca6b)) >>> 0)
    const offers = this._pickMutationOffers(rng, 3)
    if (offers.length === 0) return // no mutations defined → nothing to offer (the identity — run unchanged).
    this.mutationOpen = true
    this._pauseLevelTimer() // exclude the (mandatory) offer-reading time from the fast-clear timer (review MINOR).
    this.player.body.setVelocity(0, 0) // zero momentum so the body doesn't drift under the frozen overlay.
    this.mutationOverlay = new MutationOverlay(this, {
      offers,
      onPick: (id) => this._applyMutation(id),
    })
  }

  // ── _pickMutationOffers(rng, want) (build-&-replay §6.5, Decision 3) ── draw `want` DISTINCT mutations off
  // the passed seeded RNG via a Fisher-Yates-style shuffle of a COPY of MUTATION_ORDER (no mutation of the
  // shared table — DRY safety). Returns the first `want` (or fewer if the table is smaller). Deterministic
  // given the RNG, so a run replays the same 3 offers (AC2). The shuffle uses the SAME mulberry32 thread the
  // caller seeded off the run seed ⊕ biome salt — off the generator's pinned draw.
  _pickMutationOffers(rng: RNG, want: number): typeof MUTATION_ORDER {
    // Shuffle a COPY of the per-run RESOLVED mutation pool (meta-progression §6.7, Decision 6) — === the
    // pre-slice MUTATION_ORDER for a default run (the identity, so the same seed offers the same 3), widened by
    // a banked mutation blueprint (the Glass Cannon). Never mutates the shared config table (DRY safety).
    const pool = this.mutationPool.slice()
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = pool[i]
      pool[i] = pool[j]
      pool[j] = tmp
    }
    return pool.slice(0, Math.min(want, pool.length))
  }

  // ── _applyMutation(id) (build-&-replay §6.5, Decision 5, AC2/AC3/AC4) ── the overlay's onPick callback:
  // resolve the chosen id → its MutationSpec, apply it to the live RunState (mutating the run-only perk fields
  // IN PLACE — they persist for the rest of the run because RunState survives level rebuilds), record the id
  // on runState.mutations (for the HUD + summary), sync the reused/new fields onto the live Player, refresh the
  // HUD, and un-freeze gameplay. A confirm cue (the UI-select sound) reads the pick. The overlay already tore
  // itself down before calling this (so we just drop the handle). Defensive: an unknown id un-freezes anyway.
  _applyMutation(id: string): void {
    const spec = MUTATIONS_BY_ID[id]
    if (spec) {
      spec.apply(this.runState) // arm the run-only perk (Decision 5) — mutates RunState's fields in place.
      this.runState.mutations.push(id) // record the pick (for the HUD list + the run summary).
      this._syncPlayerScrollStats() // push the reused + new perk fields to the live Player (DRY — one sync site).
      this.sfx.uiSelect() // a confirm cue for the pick (reuses the UI-select blip — no new SFX).
    }
    this.mutationOpen = false // un-freeze gameplay (the update() gate re-opens).
    this.mutationOverlay = null
    this._resumeLevelTimer() // re-stamp the timer past the frozen offer-reading interval (review MINOR).
    this.cameras.main.flash(200, 46, 204, 113) // a brief green pulse so the granted perk reads.
    this._emitHud() // refresh the HUD's mutation list immediately (don't wait for the next tick).
    // color-scaling-stats §6 (Decision 7) — on the mutation modal's close, offer the deferred COLOUR-up pick
    // (the second sequential frozen modal). No-op when no pick is pending (a within-biome advance never arms it).
    if (this._colorPickPending) this._offerColorPick()
  }

  // ── _offerColorPick() (color-scaling-stats §6, Decision 7, AC9) ── on a biome transition, offer a +1-colour
  // choice in a paused overlay (the build commitment moment). Always the three FIXED colours (COLOR_IDS,
  // ordered — no shuffle, there are exactly 3), so no seeding is needed (a future 4th colour would seed off the
  // same run-seed⊕biome thread as _pickMutationOffers, OFF the generator's pinned RNG). Freezes gameplay
  // (colorPickOpen gates update) + opens the overlay; the pick callback applies the level. Defensive: if one is
  // already open, no-op. Clears the pending flag so it fires exactly once per transition.
  _offerColorPick(): void {
    this._colorPickPending = false
    if (this.colorPickOpen || this.colorOverlay) return // already offering (defensive — should never re-enter).
    this.colorPickOpen = true
    this._pauseLevelTimer() // exclude the (mandatory) offer-reading time from the fast-clear timer (review MINOR).
    this.player.body.setVelocity(0, 0) // zero momentum so the body doesn't drift under the frozen overlay.
    this.colorOverlay = new ColorOverlay(this, (id) => this._applyColorPick(id))
  }

  // ── _applyColorPick(colorId) (color-scaling-stats §6, Decision 7, AC9) ── the overlay's onPick callback:
  // bump the chosen colour's run level by +1 (mutating RunState IN PLACE — it persists for the rest of the run),
  // sync the player (so a Survival pick grows + tops up max HP via survivalHpBonus — Decision 6), refresh the
  // HUD, flash the camera in the colour's tint, and un-freeze gameplay. The overlay already tore itself down.
  _applyColorPick(colorId: ColorId): void {
    if (colorId === 'brutality') this.runState.brutalityLevel += 1
    else if (colorId === 'tactics') this.runState.tacticsLevel += 1
    else this.runState.survivalLevel += 1
    this._syncPlayerScrollStats() // push the survival flat-HP grow/heal to the live player (DRY — one sync site).
    this.sfx.uiSelect() // a confirm cue for the pick (reuses the UI-select blip — no new SFX).
    this.colorPickOpen = false // un-freeze gameplay (the update() gate re-opens).
    this.colorOverlay = null
    this._resumeLevelTimer() // re-stamp the timer past the frozen offer-reading interval (review MINOR).
    const tint = COLORS[colorId].tint // flash in the picked colour's tint so the build direction reads.
    this.cameras.main.flash(200, (tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff)
    this._emitHud() // refresh the HUD's colour pips immediately (don't wait for the next tick).
  }

  // ── _pauseLevelTimer() (build-&-replay §6.4, review MINOR — real-vs-gameplay-dt fix) ── stamp the wall-clock a
  // modal (shop / mutation overlay) is opening at, so _resumeLevelTimer can later exclude the frozen interval from
  // the fast-clear timer. The world freezes on the gameplay dt while a modal is up, but this.time.now keeps
  // advancing — so reading the mandatory mutation offer or shopping must NOT be charged against the 45s window.
  // Idempotent (a re-entrant open keeps the FIRST stamp). No-op on an untimed level (levelStartedAt <= 0): a
  // boss/miniboss arena never times, so there's nothing to protect. DRY: ONE pause site for both modals.
  _pauseLevelTimer(): void {
    if (this.levelStartedAt <= 0) return // untimed level (boss/miniboss) — no timer to pause.
    if (this._modalPausedAt > 0) return // already paused (re-entrant guard) — keep the earliest stamp.
    this._modalPausedAt = this.time.now
  }

  // ── _resumeLevelTimer() (build-&-replay §6.4, review MINOR — real-vs-gameplay-dt fix) ── on a modal close,
  // ADVANCE levelStartedAt by the frozen interval (now - the open stamp) so the elapsed measurement used by both
  // _grantTimedClearBonus and the HUD's levelTime reflects only un-paused, interactive time. No-op if the timer
  // wasn't paused (no modal was open on a timed level). DRY: ONE resume site for both modals.
  _resumeLevelTimer(): void {
    if (this._modalPausedAt <= 0) return // not paused (untimed level, or no modal was up) — nothing to do.
    if (this.levelStartedAt > 0) this.levelStartedAt += this.time.now - this._modalPausedAt
    this._modalPausedAt = 0
  }

  // ── _grantTimedClearBonus() (build-&-replay design §6.4, AC5) ── the fast-clear reward on the door-reach
  // path: if THIS level was a TIMED level (levelStartedAt > 0 — a normal, non-set-piece level) AND the player
  // reached the exit within CLEAR_BONUS_TIME of it being built, grant a one-shot gold+cells bonus with an FX/
  // HUD pop. Over the threshold (or an untimed boss/miniboss level) → nothing (NO penalty — purely additive,
  // identity-safe). Called once from _nextLevel BEFORE advancing (the transitioning guard gates the door path,
  // so this never double-fires for one clear). A green flash + the pickup blip + a HUD pop read the reward.
  _grantTimedClearBonus(): void {
    if (this.levelStartedAt <= 0) return // an untimed level (boss/miniboss) → no bonus (never a penalty).
    const elapsed = this.time.now - this.levelStartedAt
    this.levelStartedAt = 0 // consume the stamp so a (defensive) re-entry can't grant twice.
    if (elapsed > CLEAR_BONUS_TIME) return // too slow → no bonus, no penalty (the speed incentive only adds).
    this.runState.gold += CLEAR_BONUS_GOLD // run-only currency (lost on death — feeds the in-run shop).
    this.runState.cells += CLEAR_BONUS_CELLS // meta currency (banked at run end — the lasting reward).
    // A reward pop so the fast clear reads: a green flash + the gold-pickup blip + a floating "SPEED!" tell.
    this.cameras.main.flash(220, 244, 208, 63)
    this.sfx.pickup('gold')
    const pop = this.add
      .text(this.cameras.main.width / 2, 110, t('game.fastClear', { gold: CLEAR_BONUS_GOLD, cells: CLEAR_BONUS_CELLS }), {
        fontFamily: UI_FONT,
        fontSize: '24px',
        color: '#f4d03f',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(120)
    // Fade + rise the tell, then destroy it (a transient FX — NOT pushed onto _levelObjects since the level is
    // about to tear down; the tween's onComplete destroys it, and a destroyed object is harmless if torn down).
    this.tweens.add({ targets: pop, y: 80, alpha: 0, duration: 1100, onComplete: () => pop.destroy() })
  }

  _onEnemyHitPlayer(hitboxRect: any): void {
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

  _onEnemyContact(enemyRect: any): void {
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
  _onPlayerDeath(): void {
    if (this.gameOver) return
    this.gameOver = true
    this.runState.hp = 0 // the run ended at 0 HP (kept consistent; the summary doesn't read hp).
    // Bank the run's Cells + best depth to the PERSISTENT meta ONCE (§6.5, Decision 59, AC51). The
    // run's gold/scrolls are DISCARDED (run-only — permadeath). Under the gameOver guard so it fires
    // exactly once. Banking here (not GameOver) keeps the single writer next to the live RunState.
    // meta-progression §6.7 (Decision 3/7, AC9): a death STILL banks blueprints collected this run (like
    // Cells — generous + consistent), but does NOT unlock a tier (completedAtTier omitted ⇒ null — the spec's
    // "clearing a run unlocks a higher tier", not dying).
    this.meta.bankRun({ cells: this.runState.cells, depth: this.runState.depth, blueprints: this.runState.blueprints })
    this.hitstopTimer = 0.25
    this.cameras.main.flash(180, 200, 40, 40)
    this.cameras.main.shake(220, 0.01)
    this.sfx.death() // audio §6.3 (AC5) — the death knell (distinct from an enemy death; plays once via the guard).
    // Snapshot the summary NOW (RunState may be torn down with the scene) and route to GameOver → Hub.
    const summary = this.runState.summary(this.time.now, false, this.runSeed)
    summary.biomeName = tName('biome', this.runState.biome().id, summary.biomeName) // i18n: translate at the scene boundary.
    this.time.delayedCall(700, () => this.scene.start('GameOver', summary))
  }

  // ── _weaponLabel() (Enrichment round-2; round-3 item 3 — two-slot aware) ── the HUD weapon string: the
  // ACTIVE weapon name, plus the rolled affix name when affixed (e.g. "Sword ✦ Keen"). A plain weapon shows
  // just its name (the identity — a fresh run's "Sword" reads exactly as before). When a SECOND slot holds a
  // weapon, the inactive one is appended in muted brackets (e.g. "Bow ✦ Keen  [Sword]") so the swap target
  // reads on the HUD. One source so the HUD label is consistent.
  _weaponLabel(): string {
    // i18n: resolve the weapon + affix NAMES to the active locale here (this helper re-runs on every HUD
    // update — swap/pickup — so the label stays translated mid-run, not just at create). A run's locale is
    // fixed (it only changes in the Hub), so resolving at the read site needs no live re-translation.
    const active = this.player.equippedWeapon as any
    const activeLabel = this._weaponSlotLabel(active)
    // The OTHER slot (round-3 item 3): show it bracketed as the swap target when present + the slot's unlocked.
    if (this.player.secondSlotUnlocked) {
      const other = this.player.weapons[this.player.activeWeaponIndex === 0 ? 1 : 0] as any
      if (other) {
        return `${activeLabel}  [${this._weaponSlotLabel(other)}] (R)`
      }
    }
    return activeLabel
  }

  // ── _weaponSlotLabel(w) ── one slot's label: the (translated) weapon name, plus the (translated) affix
  // name when affixed (e.g. "剑 ✦ 锋利"). DRY — both slots resolve through here.
  _weaponSlotLabel(w: any): string {
    const name = tName('weapon', w.id, w.name)
    return w.affixName ? `${name} ✦ ${tName('affix', w.affixId, w.affixName)}` : name
  }

  // ── _skillLabel(slot) (skills design §6.6, AC6) ── the HUD label for a skill slot: the equipped skill's
  // name, or '—' for an empty slot (the identity — a fresh run shows two empty slots). Registry-only (the HUD
  // is decoupled — it never reads the Player directly).
  _skillLabel(slot: number): string {
    const spec = this.player.skills[slot]
    return spec ? tName('skill', spec.id, spec.name) : '—'
  }

  // ── _skillCooldownFrac(slot) (skills design §6.6, AC6) ── the slot's cooldown as a 0..1 fraction (0 = ready,
  // 1 = just fired) the HUD draws a drain bar from. An empty slot / a slot at full readiness reads 0. Clamped
  // so a re-equip mid-cooldown (a different skill's longer cooldown) never overflows the bar.
  _skillCooldownFrac(slot: number): number {
    const spec = this.player.skills[slot]
    if (!spec || spec.cooldown <= 0) return 0
    return Phaser.Math.Clamp(this.player.skillCooldown[slot] / spec.cooldown, 0, 1)
  }

  // Push HP (+ combo + depth/biome) to the registry for the decoupled HUD (Decision 2). The HUD reads
  // these each frame and never touches this scene. depth/biome let the HUD show the live "DEPTH n ·
  // BIOME" readout so the rising difficulty reads (AC45). (create() seeds sane defaults so the HUD
  // never flashes a stale prior-run value before the first tick — review MINOR.)
  _emitHud(): void {
    this.registry.set('playerHp', this.player.hp)
    this.registry.set('playerMaxHp', this.player.maxHp)
    this.registry.set('comboIndex', this.player.comboIndex)
    this.registry.set('depth', this.runState.depth)
    this.registry.set('biomeName', tName('biome', this.runState.biome().id, this.runState.biome().name))
    // §6.5 (Decision 2/AC49) — live currency counters + equipped weapon name for the decoupled HUD.
    this.registry.set('cells', this.runState.cells)
    this.registry.set('gold', this.runState.gold)
    this.registry.set('weapon', this._weaponLabel())
    // §6.9 — live flask charges for the HUD's flask readout (the heal valve, Decision 72).
    this.registry.set('flasks', this.runState.flasks)
    this.registry.set('maxFlasks', this.runState.maxFlasks)
    // skills slice (AC6) — both skill slots' names + their cooldown FRACTION (0 = ready, 1 = just fired) for the
    // decoupled HUD's two skill labels + cooldown bars. An empty slot reads '—' with cd 0 (no bar). Registry-only.
    this.registry.set('skill1', this._skillLabel(0))
    this.registry.set('skill2', this._skillLabel(1))
    this.registry.set('skill1Cd', this._skillCooldownFrac(0))
    this.registry.set('skill2Cd', this._skillCooldownFrac(1))
    // build-&-replay slice (AC4) — the run's active MUTATIONS as a joined list of names (registry-only — the
    // HUD is decoupled). Empty until the first pick (a fresh run shows no mutation line). Resolved id → name
    // off the pure MUTATIONS table (DRY). build-&-replay slice (AC5) — the per-level fast-clear TIMER (ms
    // elapsed on the current timed level; 0 = an untimed boss/miniboss level → the HUD hides the timer).
    this.registry.set('mutations', this.runState.mutations.map((id) => tName('mutation', id, MUTATIONS_BY_ID[id]?.name ?? id)).join(', '))
    this.registry.set('levelTime', this.levelStartedAt > 0 ? this.time.now - this.levelStartedAt : 0)
    // color-scaling-stats §6 (AC10) — the three colour levels + the equipped weapon's colour (so the HUD can
    // highlight the active build colour). Registry-only (the HUD is decoupled). 0/0/0 on a fresh run (identity).
    this.registry.set('brutalityLevel', this.runState.brutalityLevel)
    this.registry.set('tacticsLevel', this.runState.tacticsLevel)
    this.registry.set('survivalLevel', this.runState.survivalLevel)
    this.registry.set('equippedColor', this.player.equippedWeapon.scaling)
    // §6.6.3 (AC56, review MINOR) — refresh the boss HP bar while the boss lives; it's cleared on death/
    // teardown (_clearBossHud), and bossActive gates the HUD so a stale bar never persists into a run.
    if (this.boss && !this.boss.dead) this.registry.set('bossHp', this.boss.hp)
  }

  // ── Per-frame tick (design §6.1/§6.3 — the dt boundary + hit-stop) ──
  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, MAX_DT)
    this.hitstopTimer = Math.max(0, this.hitstopTimer - dt)
    // GAMEPLAY dt: 0 during a hit-stop (the combat micro-freeze) OR while the shop / MUTATION / QUIT-CONFIRM
    // overlay is up (a modal pause) — so live hitboxes/projectiles/enemies all FREEZE together while a modal is
    // open (§6.10 / build-&-replay §6.5 / esc-quit-confirm), exactly as they freeze during a hit-stop. FX still
    // tick on REAL dt so the overlay's
    // flashes/pops play.
    const gdt = this.hitstopTimer > 0 || this.shopOpen || this.mutationOpen || this.colorPickOpen || this.quitConfirmOpen ? 0 : dt

    const inputState = this.input2.sample()
    // audio §6.5 (Decision 7) — M toggles global mute (flips Phaser's game.sound.mute via the façade
    // proxy). Read on REAL dt (NOT gated by gameOver/transition/shop) so mute always works, even on the
    // death/transition screens or under the shop overlay — the player can silence audio at any moment.
    if (inputState.mutePressed) this.sfx.mute = !this.sfx.mute
    // Hazard contact cooldown decays on REAL dt (a wall-clock gate on the spike bite, not gameplay).
    if (this._hazardCooldown > 0) this._hazardCooldown = Math.max(0, this._hazardCooldown - dt)
    // Freeze gameplay during a death handoff OR a level transition (the rebuild is mid-flight) OR while the
    // shop / MUTATION / QUIT-CONFIRM overlay is up (a modal pause), but keep ticking FX so the flash/pop plays out.
    if (!this.gameOver && !this.transitioning && !this.shopOpen && !this.mutationOpen && !this.colorPickOpen && !this.quitConfirmOpen) {
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
      // skills slice (AC2/AC3) — USE SKILL slot 1 (F) / slot 2 (C): one-shot edges resolved BEFORE the player
      // tick so a skill fires this frame. An empty / on-cooldown slot is a no-op (Player.tryUseSkill → null),
      // so on a skill-less run these do nothing (the additive identity, AC8).
      if (inputState.skill1Pressed) this._useSkill(0)
      if (inputState.skill2Pressed) this._useSkill(1)
      this.player.update(gdt, inputState)
      for (const enemy of this.enemies) enemy.update(gdt, { player: this.player, effects: this.effects })
      // Boss tick (§6.6.3) — same (gdt, ctx) contract as Enemy so the hit-stop boundary is identical.
      if (this.boss && !this.boss.removed) this.boss.update(gdt, { player: this.player, effects: this.effects })
    }

    // ── Shop in-range RESET (§6.10) ── clear the vendor's in-range flag for the NEXT frame, AFTER _tryOpenShop
    // (in the gated block above) has read it. Arcade physics fires the overlap callback that SETS this flag on
    // the scene UPDATE event, which runs BEFORE this update() — so the read must precede the reset. Resetting at
    // the TOP of update (as this once did) wiped the flag before _tryOpenShop saw it, so the shop could never
    // open. resetInRange also drives the "[E] SHOP" prompt off the same-frame flag so the tell tracks the player.
    if (this.shop) this.shop.resetInRange()

    this.playerHitboxes.tick(gdt)
    this.enemyHitboxes.tick(gdt)
    // Projectiles tick on the GAMEPLAY dt so they FREEZE with the world during a hit-stop (Decision
    // 26/62) — consistent with hitboxes/enemies. Pickups settle on REAL dt (cosmetic — keep their visual
    // glued to the gravity-driven body even during a freeze).
    this.projectilePool.tick(gdt)
    this.enemyProjectilePool.tick(gdt) // §6.6.3 — the enemy/boss shots, same hit-stop boundary.
    this.pickupPool.tick()
    // skills slice (AC3) — tick deployed turrets on the GAMEPLAY dt (so they FREEZE with the world during a
    // hit-stop / shop pause, like every other gameplay timer). Each turret scans the live enemies+boss and
    // fires the PLAYER projectile pool, so its hits resolve through the existing projectile→enemy overlap.
    this.deployables.tick(gdt, { enemies: this.enemies, boss: this.boss, projectilePool: this.projectilePool })

    if (this.enemies.some((e) => e.removed)) {
      this.enemies = this.enemies.filter((e) => !e.removed)
    }

    this.effects.tick(dt)
    this._emitHud()
  }
}
