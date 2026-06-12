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

import { BIOME_ORDER } from '../config/biomes.js'
import { PLAYER_MAX_HP } from '../config/constants.js'

// ── Deterministic seed chain (Decision 46) ── the Knuth multiplicative advance MOVED verbatim from
// GameScene so the seed chain has ONE owner (DRY). The same startSeed always replays the same
// biome/seed sequence (AC47). >>> 0 keeps every seed an unsigned 32-bit int.
const nextSeed = (s) => (s * 2654435761 + 0x9e3779b9) >>> 0

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
export function createRunState(startSeed, startedAt = 0, startStats = null) {
  const maxHp = startStats ? startStats.maxHp : PLAYER_MAX_HP
  const weaponId = startStats ? startStats.startWeaponId : 'sword'
  return {
    // ── Run identity + position ──
    seed: startSeed >>> 0, // current level seed; advance() chains it.
    biomeIndex: 0, // index into BIOME_ORDER (0 = the first biome).
    levelInBiome: 0, // 0-based level WITHIN the current biome (BLOCKER 1 fix — see header).
    depth: 0, // run-GLOBAL levels cleared so far (0 at the first level). Never resets → the
    //                // difficulty curve climbs across the whole run (AC42/AC45).

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

    // ── Equipped weapon (§6.5, Decision 63) — the `inventory` placeholder repurposed to ONE scalar id
    // so a level rebuild keeps the equipped weapon. Seeded from the meta-unlocked starting weapon. ──
    weaponId, // the currently-equipped weapon id (carried across level rebuilds).
    // ── Equipped weapon AFFIX (Enrichment round-2 — the build engine) ── the rolled affix id on the current
    // weapon (or null = a plain weapon). Carried as a SCALAR so a level rebuild re-folds the SAME weapon (the
    // GameScene rebuild re-equips WEAPONS[weaponId] folded with WEAPON_AFFIXES_BY_ID[weaponAffixId]). A fresh
    // run starts with no affix (the starting weapon is unmodified — the identity).
    weaponAffixId: null,

    // ── SECOND weapon SLOT (Enrichment round-3, item 3 — the build-identity lever) ── how many slots the
    // run carries (1 = single-slot, the identity; a meta upgrade seeds 2) + the SECONDARY slot's weapon id +
    // affix (null = the slot is empty). Carried as SCALARS (mirroring the primary weaponId/weaponAffixId) so a
    // level rebuild re-equips BOTH slots' folded weapons (GameScene re-folds WEAPONS[id] with the affix). A
    // fresh run is single-slot with an empty secondary → byte-identical to round-2.
    weaponSlots: startStats ? startStats.weaponSlots ?? 1 : 1,
    weaponId2: null, // the secondary slot's weapon id (null = the slot is empty / locked).
    weaponAffixId2: null, // the secondary slot's affix id (null = a plain weapon / empty slot).

    // ── Run stats (for the GameOver summary, AC46) ──
    kills: 0, // GameScene bumps this on each enemy death.
    startedAt, // passed IN (purity, Decision 44); summary() computes timeMs = now − startedAt.

    // ── The current biome config (Decision 43) ──
    biome() {
      return BIOME_ORDER[this.biomeIndex]
    },

    // True when we're on the last biome in the ordered run.
    isLastBiome() {
      return this.biomeIndex >= BIOME_ORDER.length - 1
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

    // ── advance() (Decision 46, BLOCKER 1) — next seed + next level/biome/depth ──
    // ALWAYS: next seed (deterministic), depth += 1 (run-global), levelInBiome += 1. Only roll to the
    // NEXT biome when the current biome's levels are exhausted (and we're not already on the last).
    // Callers MUST check isRunComplete() first (GameScene does) so this is never called past the run's
    // end; defensively it clamps biomeIndex at the last biome regardless.
    advance() {
      this.seed = nextSeed(this.seed)
      this.depth += 1
      this.levelInBiome += 1
      if (this.levelInBiome >= this.biome().levels && !this.isLastBiome()) {
        this.biomeIndex += 1
        this.levelInBiome = 0
      }
      return this
    },

    // ── summary(now, completed, runSeed) — the GameOver SNAPSHOT (Decision 47/71, AC46) ── a plain object
    // passed as scene-start DATA so GameOverScene stays decoupled (it never reaches into the live scene).
    // runSeed (Decision 71) is the WHOLE-run seed GameScene minted from entropy — echoed here so the run-end
    // screen can show a SHAREABLE run id (re-enter it in the Hub to replay the exact run). Optional (the
    // verifier never calls summary) — defaults to this.seed so a bare call stays well-formed.
    summary(now, completed, runSeed = this.seed) {
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
