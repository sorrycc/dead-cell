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

// createRunState(startSeed, startedAt=0) → a plain object with advance()/isLastBiome()/biome()/
// isRunComplete()/summary(). A factory (not a class) keeps it a pure value with methods — trivially
// snapshot-able for the GameOver handoff (Decision 47) and node-constructible by the verifier.
export function createRunState(startSeed, startedAt = 0) {
  return {
    // ── Run identity + position ──
    seed: startSeed >>> 0, // current level seed; advance() chains it.
    biomeIndex: 0, // index into BIOME_ORDER (0 = the first biome).
    levelInBiome: 0, // 0-based level WITHIN the current biome (BLOCKER 1 fix — see header).
    depth: 0, // run-GLOBAL levels cleared so far (0 at the first level). Never resets → the
    //                // difficulty curve climbs across the whole run (AC42/AC45).

    // ── Carried player state (Decision 46 — HP is CARRIED between levels, NOT refilled) ──
    hp: PLAYER_MAX_HP, // seeded full; GameScene syncs player.hp ↔ this between levels.
    maxHp: PLAYER_MAX_HP, // same PURE source the Player uses (constants.js) — no magic-100 drift.

    // ── Currency / inventory PLACEHOLDERS (fields present; spending is Phase 5 — YAGNI) ──
    cells: 0, // banked toward META later (Phase 7).
    gold: 0, // run-only currency later (Phase 5).
    inventory: [], // placeholder.

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

    // ── summary(now, completed) — the GameOver SNAPSHOT (Decision 47, AC46) ── a plain object passed
    // as scene-start DATA so GameOverScene stays decoupled (it never reaches into the live scene).
    summary(now, completed) {
      return {
        depthReached: this.depth,
        biomeName: this.biome().name,
        timeMs: now - this.startedAt,
        kills: this.kills,
        completed: !!completed,
      }
    },
  }
}
