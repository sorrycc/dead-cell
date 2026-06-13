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
import type { MetaState } from '../util/save.js'
import { UPGRADES_BY_ID } from '../config/upgrades.js'
import type { PlayerStats } from '../config/upgrades.js'
import { PLAYER_MAX_HP } from '../config/constants.js'
import { tierAt, MAX_TIER } from '../config/tiers.js'
import type { BossCellTier } from '../config/tiers.js'
import type { Locale } from '../i18n/index.js'

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
//   weaponSlots      — round-3 (item 3): how many weapon slots the run carries. 1 = single-slot (the
//                      identity — the Phase-4/round-2 behaviour); a meta upgrade raises it to 2 (a second
//                      weapon slot + a swap key — a run carries melee+ranged or two movesets, the
//                      build-identity lever). Bigger-is-better (more slots never weakens you).
// The §6.9 enrichment ADDS its fields at NEUTRAL base values so the additive-identity case (empty meta) is
// byte-unchanged — a fresh run still plays exactly as before the enrichment (the verifier's identity pin holds).
export const BASE_PLAYER_STATS: Readonly<PlayerStats> = Object.freeze({
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
  weaponSlots: 1, // round-3 (item 3) — base single-slot; the meta 'weaponSlot' upgrade raises it to 2.
})

// ── applyUpgrades(baseStats, upgrades) → a NEW starting-stats object (PURE, Decision 56/57) ──
// Exported STANDALONE (not only as a method) so the verifier imports it without the save.js-coupled
// MetaState instance. Folds each OWNED upgrade level into the stats via its row's pure `apply` (which
// itself returns a NEW object — never mutates). IDENTITY when `upgrades` is empty: a CLONE of base
// (so the caller can freely mutate the result — e.g. apply scrolls — without touching the frozen base).
// Unknown ids in the stored map are skipped (a forward-compatible / corrupt save degrades gracefully).
export function applyUpgrades(baseStats: Readonly<PlayerStats>, upgrades: Record<string, number> = {}): PlayerStats {
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

// ── MetaStateInstance ── the persistence wrapper instance shape (Decision 56). Exported so consumers
// (GameScene/HubScene) type the value returned by createMetaState() — the gameplay-facing meta API.
export interface MetaStateInstance {
  getCells(): number
  getUpgrades(): Record<string, number>
  getUpgradeLevel(id: string): number
  getBestDepth(): number
  buy(id: string): boolean
  // ── Boss-Cell TIER + BLUEPRINT API (meta-progression §6.4, Decision 3, AC5) ── the Hub reads/selects the
  // tier + lists blueprints; GameScene reads startTier() + getBlueprints() at run start. bankRun is extended
  // to ALSO raise unlockedTier (on a COMPLETED run) + merge banked blueprint ids (set-union, dedup).
  getUnlockedTier(): number
  getSelectedTier(): number
  setSelectedTier(i: number): void // clamp 0..unlockedTier, then save.
  startTier(): BossCellTier // the selected tier's row (clamped to unlocked) — the run launches at this.
  getBlueprints(): string[]
  isBlueprintUnlocked(id: string): boolean
  bankRun(arg?: { cells?: number; depth?: number; blueprints?: string[]; completedAtTier?: number | null }): number
  startStats(): PlayerStats
  // ── Language preference (i18n) ── the persisted locale choice (undefined until the player picks one —
  // main.ts falls back to detectLocale() in that case). setLanguage saves it; the Hub's LANGUAGE row calls
  // it then setLocale() + scene.restart() to re-render. Kept on the SAME persistence seam as every other
  // meta read/write (Decision 58 — scenes touch meta only through MetaState, never util/save.js directly).
  getLanguage(): Locale | undefined
  setLanguage(l: Locale): void
}

// ── createMetaState() → the persistence wrapper instance (Decision 56) ──
// A factory (not a singleton): GameScene/HubScene each load() a fresh view of the SAME localStorage,
// so a buy in the Hub is reflected when the next run loads (it re-reads on create). Mirrors the
// RunState factory shape (a plain object with methods) — trivially constructible, no spooky globals.
export function createMetaState(): MetaStateInstance {
  // load() back-fills DEFAULT_META keys (incl. bestDepth) over the stored object (save.js, AC50/AC55).
  const meta: MetaState = loadMeta()

  return {
    // ── Read helpers (the Hub + GameScene read meta ONLY through these — decoupled, Decision 58) ──
    getCells() {
      return meta.cells
    },
    getUpgrades() {
      return meta.upgrades
    },
    getUpgradeLevel(id: string) {
      return meta.upgrades[id] || 0
    },
    getBestDepth() {
      return meta.bestDepth || 0
    },

    // ── Boss-Cell TIER reads/select (meta-progression §6.4, Decision 5, AC5) ── getUnlockedTier is the
    // highest tier ever unlocked; getSelectedTier is ALWAYS re-clamped to 0..unlockedTier (a corrupt save with
    // selectedTier > unlockedTier degrades to a valid run, never crashes). setSelectedTier clamps then saves.
    // startTier returns the row the run launches at (clamped to unlocked — tierAt clamps to [0, MAX_TIER] too).
    getUnlockedTier() {
      return Math.max(0, Math.min(meta.unlockedTier || 0, MAX_TIER))
    },
    getSelectedTier() {
      return Math.max(0, Math.min(meta.selectedTier || 0, meta.unlockedTier || 0))
    },
    setSelectedTier(i: number) {
      const unlocked = Math.max(0, Math.min(meta.unlockedTier || 0, MAX_TIER))
      meta.selectedTier = Math.max(0, Math.min(i | 0, unlocked))
      saveMeta(meta)
    },
    startTier() {
      // The selected tier (re-clamped to unlocked) → its row. tierAt clamps the index into [0, MAX_TIER] so a
      // corrupt save can never index out of the table (Decision 5). Tier 0 ⇒ the identity row (round-1 curve).
      return tierAt(Math.max(0, Math.min(meta.selectedTier || 0, meta.unlockedTier || 0)))
    },

    // ── Blueprint reads (meta-progression §6.4, Decision 6, AC5) ── getBlueprints is the unlocked-id list (the
    // run draws starters ∪ these); isBlueprintUnlocked is the Hub's per-row UNLOCKED/LOCKED test.
    getBlueprints() {
      return meta.blueprints
    },
    isBlueprintUnlocked(id: string) {
      return meta.blueprints.includes(id)
    },

    // ── buy(id) (Decision 56/57) ── buy the NEXT level of an upgrade if owned < maxLevel AND the
    // banked Cells cover costs[owned]. On success: deduct Cells, increment the owned level, SAVE.
    // Returns true on a successful purchase, false otherwise (can't afford / maxed / unknown id).
    buy(id: string) {
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

    // ── bankRun({ cells, depth, blueprints, completedAtTier }) (Decision 59 + meta-progression Decision 3,
    // AC51/AC5/AC9) ── called ONCE per run by GameScene (under the gameOver guard) on death OR run-complete:
    // add the run's collected Cells to the bank, bump bestDepth, MERGE banked blueprint ids (set-union, dedup
    // — like Cells, only PERMANENT once banked), and (on a COMPLETED run only) RAISE unlockedTier to the next
    // tier. Gold/scrolls are NOT passed in (run-only — permadeath loses them). Takes the new data as ARGS
    // (mirroring how it already takes cells/depth) so it stays decoupled + node-constructible. Both the death
    // and boss-clear paths bank blueprints (Decision 7); only the boss-clear path passes completedAtTier (a
    // death does NOT unlock a tier — the explicit spec).
    bankRun({ cells = 0, depth = 0, blueprints = [], completedAtTier = null }: { cells?: number; depth?: number; blueprints?: string[]; completedAtTier?: number | null } = {}) {
      meta.cells += cells
      meta.bestDepth = Math.max(meta.bestDepth || 0, depth)
      // Merge banked blueprints (set-union, dedup) — a banked id permanently joins the run pools.
      for (const id of blueprints) if (!meta.blueprints.includes(id)) meta.blueprints.push(id)
      // Unlock the NEXT tier ONLY on a completed run at the run's tier (clamped to MAX_TIER — never past the
      // table). A death passes completedAtTier null (no unlock). max() so an already-higher unlock holds.
      if (completedAtTier != null) {
        meta.unlockedTier = Math.max(meta.unlockedTier || 0, Math.min(completedAtTier + 1, MAX_TIER))
      }
      saveMeta(meta)
      return meta.cells
    },

    // Fold the OWNED upgrades into the base starting stats (Decision 60) — the run-start power source.
    startStats() {
      return applyUpgrades(BASE_PLAYER_STATS, meta.upgrades)
    },

    // ── Language preference (i18n) ── read the saved locale (undefined = never chosen → main.ts auto-
    // detects); setLanguage persists the choice (the Hub also calls setLocale() to flip the live locale).
    getLanguage() {
      return meta.language
    },
    setLanguage(l: Locale) {
      meta.language = l
      saveMeta(meta)
    },
  }
}
