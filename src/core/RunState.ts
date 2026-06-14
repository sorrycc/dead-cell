// ── RunState — the active run (design §6.4, Decision 44/46, AC44/AC47) ──
// 100% PURE — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node and drives the
// SAME advance() chain the game does, asserting the seed sequence + depth progression are
// deterministic + monotone (Decision 44/49). It owns ONLY run-scoped state; META (banked Cells across
// runs) is util/save.js's job in a later phase, kept separate so permadeath = "drop the RunState,
// keep the save" is a clean seam. GameScene constructs ONE RunState in create() and is the single
// writer (no module-level singleton — that invites spooky mutation + breaks determinism reasoning).
//
// PURITY of startedAt (Decision 44): the caller passes startedAt IN (GameScene passes this.time.now;
// the verifier passes 0), so this module never reads a clock — it stays deterministic + headless.
//
// ── BLOCKER 1 fix (review) — a biome spans MULTIPLE levels ──
// The earlier model rolled biomeIndex on EVERY Door, making a 3-biome run only 3 rooms (Prison →
// Sewers → Ramparts, one room each) and ending on the FIRST last-biome Door — so depth never climbed
// far enough for enemy scaling to read. THE FIX: each biome carries `levels` (config/biomes.js); the
// run tracks `levelInBiome` (0-based within the current biome). advance() ALWAYS increments `depth`
// (run-global — it NEVER resets, so the difficulty curve is sampled across the WHOLE run), advances
// `levelInBiome`, and only rolls to the next biome when the current biome's levels are EXHAUSTED. The
// run completes only when the LAST biome's LAST level is cleared (isRunComplete()). Net effect: a real
// multi-room descent per biome with VISIBLY rising difficulty within AND across biomes (AC43/AC45).

import { BIOMES, START_BIOME_ID } from '../config/biomes.js'
import type { BiomeConfig } from '../config/biomes.js'
import { PLAYER_MAX_HP } from '../config/constants.js'
import type { PlayerStats } from '../config/upgrades.js'
import type { RarityId } from '../config/rarity.js'

// ── Shared data shapes (FOUNDATION exports) — consumer modules (GameScene/GameOverScene) import these. ──
// The run-start stats fold passed INTO createRunState (the §6.5/§6.9 META fold result). It is the SAME
// shape MetaState's applyUpgrades returns (config/upgrades.js PlayerStats) — RunState reads only a subset.
export type RunStartStats = PlayerStats

// ── RunSummary (Decision 47/71, AC46) ── the GameOver SNAPSHOT plain object summary() returns. Passed as
// scene-start DATA so GameOverScene stays decoupled (it never reaches into the live scene).
export interface RunSummary {
  depthReached: number
  biomeName: string
  timeMs: number
  kills: number
  cellsBanked: number
  runSeed: number
  completed: boolean
}

// ── RunState (Decision 44/46) ── the active-run value: run-scoped state + the pure method surface
// (advance()/isLastBiome()/biome()/isRunComplete()/summary()/…). A plain object (a factory, not a class)
// so it's trivially snapshot-able for the GameOver handoff and node-constructible by the verifier.
export interface RunState {
  // ── Run identity + position ──
  seed: number
  // ── Graph position (F4 branching-biome-map, Decision 3) — REPLACES the old `biomeIndex: number`. ──
  // `biomeId`: the CURRENT biome's id (seeded to START_BIOME_ID). biome() = BIOMES[biomeId].
  // `path`: the ordered list of biome ids the run has VISITED (starts [START_BIOME_ID]; advance() pushes the
  //   chosen next id on a boundary roll). Drives the HUD/summary route readout + the verifier's per-path walk.
  // `pendingBiomeId`: the next biome the picker committed to (null = no choice yet → advance() auto-picks the
  //   deterministic default exits[0], Decision 5). The default-path identity holds because exits[0] is canonical.
  biomeId: string
  path: string[]
  pendingBiomeId: string | null
  levelInBiome: number
  depth: number
  // ── Boss-Cell TIER (meta-progression §6.6, Decision 10, AC8) ── the run's Boss-Cell multiplier, seeded from
  // the selected tier (1 = tier 0 = the identity). RUN-ONLY (a scalar the scene threads to every scaleAtDepth/
  // scaleBossSpec/effectiveDifficulty fold). CONSTANT for the whole run (run-global), so the whole-run
  // difficulty stays monotone at this tier (the verifier's per-tier walk). A fresh run with no tier gets 1.
  bossCellMult: number
  // ── BLUEPRINTS collected THIS run (meta-progression §6.6, Decision 7, AC9) ── the blueprint ids picked up in
  // this run (run-only — banked to MetaState.blueprints at run end via bankRun, on BOTH the death + clear paths,
  // like Cells). A fresh run starts empty (the identity). Dropping them on death before run-end loses unbanked
  // ones — but bankRun on the death path banks what you carried (Decision 7).
  blueprints: string[]
  // ── RUNES collected THIS run (F8 traversal-runes, Decision 8) ── the rune ids picked up this run (run-only —
  // banked to MetaState.runes at run end via bankRun, on BOTH the death + clear paths, like blueprints/Cells). A
  // fresh run starts empty (the identity). Dropping them on death before run-end loses unbanked ones — but
  // bankRun on the death path banks what you carried (Decision 8).
  runes: string[]
  // ── Carried player state ──
  hp: number
  maxHp: number
  // ── Currencies ──
  cells: number
  gold: number
  // ── Healing flask ──
  maxFlasks: number
  flasks: number
  flaskHealFrac: number
  // ── Run-only scroll modifiers ──
  scrollDamageMult: number
  scrollMaxHpBonus: number
  scrollLifestealFrac: number
  scrollStatusDurationMult: number
  scrollDodgeCdMult: number
  scrollDodgeIframeBonus: number
  // ── Run-only MUTATION perks (build-&-replay design §6.2, AC1/AC3) ── the picked mutation ids (for the
  // HUD/summary) + the few NEW live-read perk fields a mutation arms (each default = the neutral identity,
  // so an empty list plays byte-identically; most mutations reuse the scroll fields above — DRY).
  mutations: string[]
  onKillHealAmount: number
  lowHpDamageMult: number
  firstHitBonusMult: number
  // ── Affliction-synergy perks (affliction-synergy design §6.3, AC9) ── three NEW run-only fields a
  // synergy mutation/affix arms, each seeded to the neutral identity so a run with NO synergy plays
  // byte-identically (the identity guarantee). vsAfflictedDamageMult/statusTickMult are mirrored onto the
  // live Player by _syncPlayerScrollStats; spreadAffliction is read off RunState directly in the onDeath hook.
  vsAfflictedDamageMult: number // ×player damage vs an AFFLICTED enemy (Hemorrhage). 1 = neutral.
  statusTickMult: number // ×applied DoT tickDmg (Virulent — "ticks harder"). 1 = neutral.
  spreadAffliction: boolean // killing an afflicted enemy spreads it (Hemorrhage). false = off.
  // ── F3 skills-mutations perks (the 3 new blueprint-gated mutations' run-only fields) ── each seeded to the
  // neutral identity so a run with NO F3 mutation plays byte-identically; carried across level rebuilds (the
  // persisted RunState object). secondWind is the CAPABILITY a Second Wind pick arms; secondWindAvailable is the
  // per-biome CHARGE GameScene re-arms each biome transition (reset to secondWind in _continueTransition) and on
  // the pick itself (_applyMutation). momentumPerStack is mirrored onto the Player (the hit-site fold reads it);
  // dropRateMult is read off RunState at the drop site. The GameScene reads guard on the neutral value (no-op).
  secondWind: boolean // CAPABILITY: a Second Wind pick is armed (Second Wind). false = off/neutral.
  secondWindAvailable: boolean // the per-biome CHARGE (re-armed each biome to `secondWind`). false = spent/neutral.
  momentumPerStack: number // ×damage per momentum stack — 1 + stacks×this (Momentum). 0 = neutral (no ramp).
  dropRateMult: number // ×gold/cell drop rate at the drop site (Scavenger). 1 = neutral.
  // ── Cursed-chest CURSE stacks (cursed-chests design §6, AC7, Decision 5) ── the remaining curse stacks: 0 =
  // NO curse (the neutral identity → effectiveCurseMult(0) === 1 → _hurtPlayer byte-unchanged). Opening a
  // cursed chest sets it to CURSE.killsToClear (greatly amplified damage taken); each enemy kill peels one
  // stack (enemy.onDeath, clamped >= 0); at 0 the curse is fully cleared. RUN-ONLY (never banked to meta —
  // permadeath drops it), CARRIED across level rebuilds (the curse follows you to the next level until killed
  // off — the genre behaviour), distinct from the per-room roomDamageTakenMult which resets every level.
  curseStacks: number
  // ── Per-colour run LEVELS (color-scaling-stats §6, Decision 4, AC4) ── the run's Brutality/Tactics/Survival
  // levels (run-only — lost on death, carried across level rebuilds like every other run field, NEVER seeded
  // from meta). Each defaults to 0 (the neutral identity): colorMult(0) === 1 and survivalHpBonus(0) === 0, so
  // a fresh run plays byte-identically. A colour scroll / the biome-transition picker bumps one by +1. The hit
  // sites read the equipped weapon's colour level; a fired skill reads its own colour's level (GameScene folds).
  brutalityLevel: number // red — melee weapon (sword/hammer/glaive) + firebomb skill scaling.
  tacticsLevel: number // purple — bow + ranged/utility skill scaling.
  survivalLevel: number // green — spear scaling + flat +max HP (via survivalHpBonus in _syncPlayerScrollStats).
  // ── Equipped weapon (primary) ──
  weaponId: string
  weaponAffixId: string | null
  // ── Equipped weapon RARITY (item-rarity-forge §6, Decision 1/2) ── the primary slot's rarity tier id (null =
  // common/identity). A SCALAR carried like weaponAffixId so the rarity sticks for the run (the live folded
  // weapon persists on the Player across level rebuilds — the same way the affix does today). null = common.
  weaponRarityId: RarityId | null
  // ── Second weapon slot ──
  weaponSlots: number
  weaponId2: string | null
  weaponAffixId2: string | null
  weaponRarityId2: RarityId | null // the secondary slot's rarity tier id (null = common/empty — the identity).
  // ── Skill loadout (skills design §6.2/§6.7, Decision 7) ──
  skillId1: string | null
  skillId2: string | null
  // ── Run stats ──
  kills: number
  startedAt: number
  // ── Methods ──
  biome(): BiomeConfig
  isLastBiome(): boolean
  isRunComplete(): boolean
  isBossLevel(): boolean
  isMinibossLevel(): boolean
  advance(): RunState
  summary(now: number, completed: boolean, runSeed?: number): RunSummary
}

// ── Deterministic seed chain (Decision 46) ── the Knuth multiplicative advance MOVED verbatim from
// GameScene so the seed chain has ONE owner (DRY). The same startSeed always replays the same
// biome/seed sequence (AC47). >>> 0 keeps every seed an unsigned 32-bit int.
const nextSeed = (s: number): number => (s * 2654435761 + 0x9e3779b9) >>> 0

// ── defaultNextBiomeId(biomeId) (F4 branching-biome-map, Decision 5) ── the DETERMINISTIC default/auto-pick:
// returns the FIRST declared exit (exits[0]) so a run with NO UI (headless / the verifier / a single-exit node)
// still advances along a fixed route. Because SEWERS.exits[0] === 'catacombs', the default path is exactly
// today's BIOME_ORDER (Prison→Sewers→Catacombs→Ramparts) — the additive-identity guarantee. Returns null at a
// terminal (boss) biome with no exits (advance() never rolls there — isLastBiome() guards it). PURE (no Phaser).
export function defaultNextBiomeId(biomeId: string): string | null {
  const exits = BIOMES[biomeId]?.exits
  return exits && exits.length > 0 ? exits[0] : null
}

// createRunState(startSeed, startedAt=0, startStats=null) → a plain object with advance()/isLastBiome()/
// biome()/isRunComplete()/summary(). A factory (not a class) keeps it a pure value with methods —
// trivially snapshot-able for the GameOver handoff (Decision 47) and node-constructible by the verifier.
//
// startStats (§6.5, Decision 60, review MAJOR — the HP-carry/upgrade reconciliation): an OPTIONAL
// run-start stats object ({ maxHp, startWeaponId, … } from the META fold). When present, the run seeds
// maxHp/hp from the UPGRADED maxHp and the equipped weapon from startWeaponId — so a +maxHP upgrade
// makes a fresh run start at the upgraded full HP AND the carried HP reflects the upgrade (the single
// create()-time sync site in GameScene then matches). When ABSENT (the verifier / a bare Phase-4 run),
// it falls back to the bare PLAYER_MAX_HP + the sword — the pre-§6.5 identity (so the verifier's
// determinism walk is unaffected: it never passes startStats, RunState stays node-constructible + pure).
// bossCellMult (meta-progression §6.6, Decision 10, AC8): an OPTIONAL run-global Boss-Cell multiplier (default
// 1 — the identity tier 0). The verifier constructs createRunState(0xc0ffee) with NO tier, so its determinism +
// monotonicity walks are unaffected (the default keeps the run byte-identical to the pre-slice run). The scene
// passes meta.startTier().bossCellMult so the run's fold sites scale the curve at the selected tier.
export function createRunState(startSeed: number, startedAt = 0, startStats: RunStartStats | null = null, bossCellMult = 1): RunState {
  const maxHp = startStats ? startStats.maxHp : PLAYER_MAX_HP
  const weaponId = startStats ? startStats.startWeaponId : 'sword'
  return {
    // ── Run identity + position ──
    seed: startSeed >>> 0, // current level seed; advance() chains it.
    // ── Graph position (F4 branching-biome-map, Decision 3) — seeded to the root, an empty (root-only) path, and
    // NO pending choice (auto-pick). A fresh run is at START_BIOME_ID with pendingBiomeId null → advance() walks
    // the deterministic default path === today's BIOME_ORDER (the additive identity). The picker sets pendingBiomeId.
    biomeId: START_BIOME_ID, // the CURRENT biome's id (the graph root).
    path: [START_BIOME_ID], // ordered visited-biome ids (for the HUD/summary route readout; advance() pushes).
    pendingBiomeId: null, // the next biome the picker committed to (null = auto-pick the default exit, Decision 5).
    levelInBiome: 0, // 0-based level WITHIN the current biome (BLOCKER 1 fix — see header).
    depth: 0, // run-GLOBAL levels cleared so far (0 at the first level). Never resets → the
    //                // difficulty curve climbs across the whole run (AC42/AC45).
    // ── Boss-Cell TIER + run-only BLUEPRINTS (meta-progression §6.6, Decision 7/10, AC8/AC9) ── bossCellMult
    // is seeded from the tier arg (>= 1; 1 = the identity), threaded to the scene's fold sites; blueprints
    // starts EMPTY (collected this run, banked at run end). A fresh run with no tier = 1 + [] = the identity.
    bossCellMult: bossCellMult >= 1 ? bossCellMult : 1, // defensive clamp (a tier never weakens the curve).
    blueprints: [],
    runes: [], // F8 traversal-runes (Decision 8) — collected this run, banked at run end (the identity = empty).

    // ── Carried player state (Decision 46/60 — HP is CARRIED between levels, NOT refilled; seeded from
    // the META-folded maxHp so a +maxHP upgrade is reflected at run start — review MAJOR) ──
    hp: maxHp, // seeded full (at the upgraded max); GameScene syncs player.hp ↔ this between levels.
    maxHp, // the meta-folded maximum (or bare PLAYER_MAX_HP when no startStats — the identity).

    // ── Currencies (§6.5, Decision 55) — DIFFERENT lifetimes (review): cells survive death (banked to
    // META at run end), gold/scrolls die with the run (permadeath loses them). ──
    cells: 0, // collected this run; BANKED to MetaState at run end (AC49/AC51).
    gold: startStats ? startStats.startGold : 0, // run-only currency (lost on death, never banked). Seeded
    //                // from the META 'startGold' upgrade so a fresh run can begin with a gold head-start (§6.9).

    // ── Healing flask (design §6.9, Decision 72 — the HP-recovery valve) ── the genre's between-area heal:
    // a limited-charge flask the player DRINKS mid-run to recover HP, REFILLED on every biome transition
    // (a fountain at the new biome's start — see GameScene._nextLevel). maxFlasks/healFrac are seeded from
    // the META fold (a meta tier grows them) so HP management becomes a real resource decision instead of a
    // one-way slide. Run-only (a fresh run reseeds from meta; charges are NOT banked — permadeath). The
    // earlier model (HP only ever falls across 9 levels + boss) had NO recovery for an un-upgraded player;
    // this is that fix (the enrichment's healing item).
    maxFlasks: startStats ? startStats.maxFlasks : 2, // flask charges carried between levels (refilled on biome change).
    flasks: startStats ? startStats.maxFlasks : 2, // current charges (start full).
    flaskHealFrac: startStats ? startStats.flaskHealFrac : 0.4, // fraction of MAX HP each drink restores.

    // ── Run-only scroll modifiers (§6.5, Decision 55/60; Enrichment round 3) — applied LIVE, never saved
    // to meta. Each defaults to a NEUTRAL identity so a fresh run with no scroll plays exactly as before. ──
    scrollDamageMult: 1, // stacks ON TOP of the permanent meleeDamageMult at the hit site.
    scrollMaxHpBonus: 0, // flat max-HP bonus from vitality scrolls (run-only; resets next run).
    scrollLifestealFrac: 0, // fraction of MELEE damage dealt healed back (Vampirism scroll; read at the hit site).
    scrollStatusDurationMult: 1, // ×applied bleed/poison/stun duration (Venom scroll; applied when arming a status).
    scrollDodgeCdMult: 1, // ×factor on the player's dodge cooldown (Alacrity scroll; synced to the player).
    scrollDodgeIframeBonus: 0, // flat extra dodge i-frame seconds (Alacrity scroll; synced to the player).

    // ── Run-only MUTATION perks (build-&-replay design §6.2, AC1/AC3) ── the picked mutation ids (records
    // the build for the HUD + summary) + the NEW live-read perk fields, all seeded to the NEUTRAL identity so
    // a run with NO mutation chosen plays EXACTLY as before (empty list = identity). Mutations that reuse the
    // scroll fields above (vampire/toxic/nimble/brutality/ironhide) need no new field here — DRY with scrolls.
    mutations: [], // picked mutation ids this run (run-only — never banked; lost on death — permadeath).
    onKillHealAmount: 0, // flat HP healed on each enemy kill (Predator); read in the enemy.onDeath hook.
    lowHpDamageMult: 1, // ×player damage while below the low-HP threshold (Berserker); folded at the hit site.
    firstHitBonusMult: 1, // ×player damage vs a FULL-HP enemy (Assassin); folded at the hit site (the opener).
    // ── Affliction-synergy perks (affliction-synergy §6.3, AC9/AC10) ── seeded to the NEUTRAL identity so a
    // run with NO synergy armed plays byte-identically: vsAfflictedDamageMult 1 (the !==1 guard skips the
    // vs-afflicted fold), statusTickMult 1 (_scaleStatus returns the spec unchanged), spreadAffliction false
    // (_spreadAffliction never runs). A Hemorrhage/Virulent pick raises these for the rest of the run.
    vsAfflictedDamageMult: 1, // ×player damage vs an afflicted enemy (Hemorrhage); folded at both hit sites.
    statusTickMult: 1, // ×applied DoT tickDmg when arming a damaging status (Virulent); applied in _scaleStatus.
    spreadAffliction: false, // killing an afflicted enemy spreads its dominant DoT (Hemorrhage); read in onDeath.

    // ── F3 skills-mutations perks (the 3 new blueprint-gated mutations) ── all seeded to the NEUTRAL identity so a
    // run with NO F3 mutation plays byte-identically: secondWind/secondWindAvailable false (the _hurtPlayer lethal-
    // hit intercept is skipped), momentumPerStack 0 (_mutationDamageMult skips the ramp fold), dropRateMult 1 (the
    // drop site is byte-identical). Carried across level rebuilds; secondWindAvailable is RE-ARMED on each biome
    // transition by GameScene (reset to secondWind in _continueTransition) — not here (where the other resets live).
    secondWind: false, // CAPABILITY: a Second Wind pick is armed (read in _hurtPlayer/_continueTransition).
    secondWindAvailable: false, // the per-biome CHARGE (re-armed each biome to secondWind; consumed on a lethal save).
    momentumPerStack: 0, // ×damage per momentum stack (Momentum); mirrored onto the Player, folded at the hit site.
    dropRateMult: 1, // ×gold/cell drop rate (Scavenger); read off runState at the enemy.onDrop site.

    // ── Cursed-chest CURSE stacks (cursed-chests design §6, AC7, Decision 5) ── seeded 0 (the neutral
    // identity: effectiveCurseMult(0) === 1 → a fresh run is byte-identical; the verifier's determinism walk
    // never opens a chest → unaffected). Opening a chest sets it to CURSE.killsToClear; each kill peels one.
    curseStacks: 0,

    // ── Per-colour run LEVELS (color-scaling-stats §6, Decision 4, AC4) ── all seeded 0 (the neutral identity:
    // colorMult(0) === 1, survivalHpBonus(0) === 0 → a fresh run plays byte-identically). NEVER seeded from meta
    // (a fresh run always starts all 0 — the integration map's "meta tier seeds starting levels" was CUT, KISS).
    // Carried across level rebuilds like every other run field (the scene reuses this persisted RunState object).
    brutalityLevel: 0,
    tacticsLevel: 0,
    survivalLevel: 0,

    // ── Equipped weapon (§6.5, Decision 63) — the `inventory` placeholder repurposed to ONE scalar id
    // so a level rebuild keeps the equipped weapon. Seeded from the meta-unlocked starting weapon. ──
    weaponId, // the currently-equipped weapon id (carried across level rebuilds).
    // ── Equipped weapon AFFIX (Enrichment round-2 — the build engine) ── the rolled affix id on the current
    // weapon (or null = a plain weapon). Carried as a SCALAR so a level rebuild re-folds the SAME weapon (the
    // GameScene rebuild re-equips WEAPONS[weaponId] folded with WEAPON_AFFIXES_BY_ID[weaponAffixId]). A fresh
    // run starts with no affix (the starting weapon is unmodified — the identity).
    weaponAffixId: null,
    // ── Equipped weapon RARITY (item-rarity-forge §6, Decision 1/2) ── seeded null (= common/identity) so a
    // fresh run's starting weapon is common (byte-identical: foldRarity(w, null) === w). A found/forged weapon
    // records its tier id here; the live folded weapon persists on the Player across rebuilds (the affix carry).
    weaponRarityId: null,

    // ── SECOND weapon SLOT (Enrichment round-3, item 3 — the build-identity lever) ── how many slots the
    // run carries (1 = single-slot, the identity; a meta upgrade seeds 2) + the SECONDARY slot's weapon id +
    // affix (null = the slot is empty). Carried as SCALARS (mirroring the primary weaponId/weaponAffixId) so a
    // level rebuild re-equips BOTH slots' folded weapons (GameScene re-folds WEAPONS[id] with the affix). A
    // fresh run is single-slot with an empty secondary → byte-identical to round-2.
    weaponSlots: startStats ? startStats.weaponSlots ?? 1 : 1,
    weaponId2: null, // the secondary slot's weapon id (null = the slot is empty / locked).
    weaponAffixId2: null, // the secondary slot's affix id (null = a plain weapon / empty slot).
    weaponRarityId2: null, // the secondary slot's rarity tier id (null = common/empty — the identity).

    // ── SKILL loadout (skills design §6.2/§6.7, Decision 7, AC4) ── the two skill slots' ids carried as
    // SCALARS (mirroring the secondary weaponId2) so a level rebuild re-equips BOTH skills (GameScene
    // resolves SKILLS_BY_ID[skillId] → equipSkill). A fresh run starts with BOTH null (no skill picked up
    // → both slots empty → the skill keys do nothing — byte-identical to before the loadout layer, AC8).
    skillId1: null, // slot 0 (F) skill id, or null = empty.
    skillId2: null, // slot 1 (C) skill id, or null = empty.

    // ── Run stats (for the GameOver summary, AC46) ──
    kills: 0, // GameScene bumps this on each enemy death.
    startedAt, // passed IN (purity, Decision 44); summary() computes timeMs = now − startedAt.

    // ── The current biome config (F4 Decision 3) ── the GRAPH lookup by id (was BIOME_ORDER[biomeIndex]).
    biome() {
      return BIOMES[this.biomeId]
    },

    // ── isLastBiome() (F4 Decision 3) ── true on the boss biome — the UNIQUE terminal (endsInBoss === true,
    // equivalently exits.length === 0). Keying off the boss flag (not an array index) makes it graph-correct on
    // EVERY path (both mid routes converge on the boss). advance() uses this to guard the boundary roll.
    isLastBiome() {
      return this.biome().endsInBoss === true
    },

    // True when the LAST biome's LAST level has just been cleared — the run is finished (Decision 48).
    // Checked by GameScene at the Door BEFORE advancing, so clearing the final room ends the run
    // cleanly (a run-complete handoff) instead of advancing into a non-existent biome/level.
    isRunComplete() {
      return this.isLastBiome() && this.levelInBiome >= this.biome().levels - 1
    },

    // ── isBossLevel() (design §6.6.2, Decision 66, AC57) ── true when the CURRENT level is the boss
    // arena: the boss biome's (endsInBoss) FINAL level (levelInBiome === levels-1). PURE (no Phaser) so
    // the verifier can call it. This is the SINGLE predicate GameScene reads to branch "build a boss
    // room, not a normal level" (_buildBossLevel). NOTE: on the boss biome this coincides with
    // isRunComplete() being true — the boss arena IS the last level of the last biome — but the boss
    // arena has NO exit Door, so the run-complete-via-Door path can never fire there; the boss is the
    // gate (the COMPLETION-GATE note, §6.6.3). The boss biome must NOT also be configured as a non-boss
    // final biome — endsInBoss gates this so a future non-boss final biome keeps the Door path.
    isBossLevel() {
      return this.biome().endsInBoss === true && this.levelInBiome >= this.biome().levels - 1
    },

    // ── isMinibossLevel() (Enrichment round-2, §6.6.8) ── true when the CURRENT level is a NON-boss biome's
    // LAST NORMAL level AND that biome declares a `miniboss` — the per-biome set-piece gate. PURE (no Phaser)
    // so the verifier can call it. GameScene reads it in _buildLevel to spawn the miniboss INTO the normal
    // room (which keeps its exit Door — the miniboss guards the way out but isn't the finale's hard gate).
    // Mutually exclusive with isBossLevel() (a boss biome has endsInBoss → it builds the arena, not this).
    isMinibossLevel() {
      const b = this.biome()
      return b.endsInBoss !== true && !!b.miniboss && this.levelInBiome >= b.levels - 1
    },

    // ── advance() (Decision 46, BLOCKER 1; F4 Decision 4) — next seed + next level/biome/depth ──
    // ALWAYS: next seed (deterministic), depth += 1 (run-global), levelInBiome += 1. Only roll to the NEXT biome
    // when the current biome's levels are exhausted (and we're not already on the boss/terminal biome). The roll
    // consults `pendingBiomeId` (set by GameScene's picker BEFORE advance()), else the deterministic default
    // (exits[0], Decision 5) — so a headless / auto-pick / verifier run walks the canonical linear path. A
    // DEFENSIVE guard: if the chosen next is somehow not in the current node's exits, fall back to the default
    // (never roll to an unreachable node — keeps the graph invariant local). Callers MUST check isRunComplete()
    // first (GameScene does) so this is never called past the run's end; defensively the boss biome never rolls.
    advance() {
      this.seed = nextSeed(this.seed)
      this.depth += 1
      this.levelInBiome += 1
      if (this.levelInBiome >= this.biome().levels && !this.isLastBiome()) {
        const exits = this.biome().exits
        const fallback = defaultNextBiomeId(this.biomeId)
        const chosen = this.pendingBiomeId
        const next = chosen && exits.includes(chosen) ? chosen : fallback
        if (next) {
          this.biomeId = next
          this.path.push(next)
        }
        this.pendingBiomeId = null // consume the choice (auto-pick again next boundary unless re-set).
        this.levelInBiome = 0
      }
      return this
    },

    // ── summary(now, completed, runSeed) — the GameOver SNAPSHOT (Decision 47/71, AC46) ── a plain object
    // passed as scene-start DATA so GameOverScene stays decoupled (it never reaches into the live scene).
    // runSeed (Decision 71) is the WHOLE-run seed GameScene minted from entropy — echoed here so the run-end
    // screen can show a SHAREABLE run id (re-enter it in the Hub to replay the exact run). Optional (the
    // verifier never calls summary) — defaults to this.seed so a bare call stays well-formed.
    summary(this: RunState, now: number, completed: boolean, runSeed: number = this.seed): RunSummary {
      return {
        depthReached: this.depth,
        biomeName: this.biome().name,
        timeMs: now - this.startedAt,
        kills: this.kills,
        cellsBanked: this.cells, // §6.5 — the Cells banked to META this run (GameOver shows it, AC51).
        runSeed: runSeed >>> 0, // §6.9 (Decision 71) — the shareable run id (the entropy-minted run seed).
        completed: !!completed,
      }
    },
  }
}
