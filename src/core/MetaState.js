// ── MetaState — the PERSISTENT meta-progression (design §6.5, Decision 56, AC50/AC51/AC53/AC55) ──
// The permadeath seam: core/RunState.js is the IN-MEMORY run (dropped on death); THIS owns the
// PERSISTENT meta (banked Cells, owned permanent upgrades, best depth) saved to localStorage via the
// existing util/save.js. Permadeath = "drop the RunState, keep the MetaState".
//
// PURITY CONTRACT (review MINOR — verifier import safety): this module imports NOTHING Phaser-coupled
// — ONLY util/save.js (Phaser-free, Decision 6), config/upgrades.js (pure), and config/constants.js
// (pure PLAYER_MAX_HP). So scripts/verify-gen.mjs can node-import `applyUpgrades` + `BASE_PLAYER_STATS`
// to assert the pure fold (AC55) WITHOUT a browser. The save.js try/catch (Decision 6) already makes a
// disabled/full/private-mode storage degrade to in-memory defaults — MetaState inherits that for free
// (it NEVER throws, AC50).

import { loadMeta, saveMeta } from '../util/save.js'
import { UPGRADES_BY_ID } from '../config/upgrades.js'
import { PLAYER_MAX_HP } from '../config/constants.js'

// ── BASE_PLAYER_STATS (Decision 57/60) ── the starting-stats object the meta fold STARTS from and the
// Player reads. A fresh meta (no upgrades) folds to THIS unchanged → the Phase-4 player exactly (the
// additive identity, AC53). Frozen so a fold (or a careless caller) can never mutate the shared base.
//   maxHp            — starting + maximum HP (the Player + RunState seed from it).
//   meleeDamageMult  — multiplier applied to melee damage at the resolveHit site (Decision 60).
//   rangedDamageMult — §6.9 (Decision 73): multiplier on RANGED (bow) projectile damage (1 = neutral).
//   dodgeCooldownMult— factor on the Player's DODGE_COOLDOWN (≤1 → dodge sooner).
//   dodgeIframeBonus — §6.9 (Decision 73): flat extra dodge i-frame seconds (0 = neutral).
//   startWeaponId    — the weapon the run STARTS equipping (default the Sword → Phase-4 feel).
//   startGold        — §6.9 (Decision 73): run-only gold the run STARTS with (0 = neutral; a meta head-start).
//   startScrolls     — §6.9 (Decision 73): run-only scroll boosts auto-applied at run start (0 = neutral).
//   maxFlasks        — §6.9 (Decision 72): healing-flask charges (refilled each biome). 2 = the base valve.
//   flaskHealFrac    — §6.9 (Decision 72): fraction of MAX HP each flask drink restores (base 40%).
// The §6.9 enrichment ADDS its fields at NEUTRAL base values so the additive-identity case (empty meta) is
// byte-unchanged — a fresh run still plays exactly as before the enrichment (the verifier's identity pin holds).
export const BASE_PLAYER_STATS = Object.freeze({
  maxHp: PLAYER_MAX_HP,
  meleeDamageMult: 1,
  rangedDamageMult: 1,
  dodgeCooldownMult: 1,
  dodgeIframeBonus: 0,
  startWeaponId: 'sword',
  startGold: 0,
  startScrolls: 0,
  maxFlasks: 2,
  flaskHealFrac: 0.4,
})

// ── applyUpgrades(baseStats, upgrades) → a NEW starting-stats object (PURE, Decision 56/57) ──
// Exported STANDALONE (not only as a method) so the verifier imports it without the save.js-coupled
// MetaState instance. Folds each OWNED upgrade level into the stats via its row's pure `apply` (which
// itself returns a NEW object — never mutates). IDENTITY when `upgrades` is empty: a CLONE of base
// (so the caller can freely mutate the result — e.g. apply scrolls — without touching the frozen base).
// Unknown ids in the stored map are skipped (a forward-compatible / corrupt save degrades gracefully).
export function applyUpgrades(baseStats, upgrades = {}) {
  let stats = { ...baseStats } // start from a CLONE (identity case returns this clone; never the frozen base).
  for (const [id, level] of Object.entries(upgrades)) {
    const row = UPGRADES_BY_ID[id]
    if (!row || !level) continue // unknown id or level 0 → no-op (graceful, never weakens).
    // Clamp a stored level to the row's maxLevel (a corrupt/over-large save degrades to the cap).
    const lvl = Math.min(level, row.maxLevel)
    stats = row.apply(stats, lvl) // each apply returns a NEW object (referential safety, AC55).
  }
  return stats
}

// ── createMetaState() → the persistence wrapper instance (Decision 56) ──
// A factory (not a singleton): GameScene/HubScene each load() a fresh view of the SAME localStorage,
// so a buy in the Hub is reflected when the next run loads (it re-reads on create). Mirrors the
// RunState factory shape (a plain object with methods) — trivially constructible, no spooky globals.
export function createMetaState() {
  // load() back-fills DEFAULT_META keys (incl. bestDepth) over the stored object (save.js, AC50/AC55).
  const meta = loadMeta()

  return {
    // ── Read helpers (the Hub + GameScene read meta ONLY through these — decoupled, Decision 58) ──
    getCells() {
      return meta.cells
    },
    getUpgrades() {
      return meta.upgrades
    },
    getUpgradeLevel(id) {
      return meta.upgrades[id] || 0
    },
    getBestDepth() {
      return meta.bestDepth || 0
    },

    // ── buy(id) (Decision 56/57) ── buy the NEXT level of an upgrade if owned < maxLevel AND the
    // banked Cells cover costs[owned]. On success: deduct Cells, increment the owned level, SAVE.
    // Returns true on a successful purchase, false otherwise (can't afford / maxed / unknown id).
    buy(id) {
      const row = UPGRADES_BY_ID[id]
      if (!row) return false
      const owned = meta.upgrades[id] || 0
      if (owned >= row.maxLevel) return false // already maxed.
      const cost = row.costs[owned]
      if (meta.cells < cost) return false // can't afford.
      meta.cells -= cost
      meta.upgrades[id] = owned + 1
      saveMeta(meta)
      return true
    },

    // ── bankRun({ cells, depth }) (Decision 59, AC51) ── called ONCE per run by GameScene (under the
    // gameOver guard) on death OR run-complete: add the run's collected Cells to the bank, bump
    // bestDepth, and SAVE. Gold/scrolls are NOT passed in (run-only — permadeath loses them).
    bankRun({ cells = 0, depth = 0 } = {}) {
      meta.cells += cells
      meta.bestDepth = Math.max(meta.bestDepth || 0, depth)
      saveMeta(meta)
      return meta.cells
    },

    // Fold the OWNED upgrades into the base starting stats (Decision 60) — the run-start power source.
    startStats() {
      return applyUpgrades(BASE_PLAYER_STATS, meta.upgrades)
    },
  }
}
