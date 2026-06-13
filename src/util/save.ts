// ── Defensive localStorage wrapper (design Decision 6, §6.0/§6.8, AC8) ──
// PURE of Phaser — safe to import anywhere, including headless. EVERY localStorage access
// is wrapped in try/catch so a disabled / private-mode / quota-exceeded storage NEVER
// throws: callers transparently degrade to in-memory fallbacks. One module owns
// serialization + error swallowing (DRY) so use sites stay clean.

// Read a JSON value by key, returning `fallback` if it's missing OR storage/parsing fails.
export function get<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

// Write a JSON-serializable value by key. Returns true on success, false if storage
// is unavailable/full (never throws) so callers can decide whether to surface it.
export function set(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

import type { Locale } from '../i18n/index.js'

// ── Typed meta-progression wrapper ──
// The meta-loop (§6.5) banks Cells + permanent upgrades + best depth here; the schema is owned in
// ONE place (the save key + the default shape) layered over the defensive get/set above. core/
// MetaState.js is the gameplay-facing wrapper around these.
const SAVE_KEY = 'dead-cell:meta'

// The persistent meta shape. `cells` is the permanent currency (survives death); `upgrades`
// maps upgrade-id → owned level; `bestDepth` is the deepest depth ever reached.
//
// ── Boss-Cell TIERS + BLUEPRINTS (meta-progression design §6.3, Decision 5, AC4) ── three NEW persistent
// fields that change the NEXT run's WORLD (not just the character). `unlockedTier` is the highest Boss-Cell
// tier ever unlocked (0 = base; raised on a COMPLETED run). `selectedTier` is the tier the next run launches
// at (always re-clamped to 0..unlockedTier on read, so a corrupt save degrades to a valid run). `blueprints`
// are the permanently-unlocked run-pool blueprint ids (weapons/skills/mutations draw starters ∪ these). All
// default to the IDENTITY (tier 0 / no blueprints = the round-1 game exactly — Decision 5), and loadMeta's
// spread back-fills them for any pre-slice save (the same mechanism `bestDepth` relies on).
export interface MetaState {
  cells: number
  upgrades: Record<string, number>
  bestDepth: number
  unlockedTier: number // highest Boss-Cell tier ever unlocked (0 = base; raised on a completed run).
  selectedTier: number // the tier the next run launches at (clamped 0..unlockedTier on read).
  blueprints: string[] // permanently-unlocked blueprint ids (run pools draw from starters ∪ these).
  // ── Language preference (i18n) ── OPTIONAL + intentionally ABSENT from DEFAULT_META so a fresh / pre-
  // i18n save leaves it undefined. main.ts then does `meta.language ?? detectLocale()`, so a first-time
  // visitor auto-detects from the browser; a defaulted 'en' here would suppress that. Set + saved only on
  // an explicit Hub language switch (MetaState.setLanguage). loadMeta won't back-fill it (it's not in
  // DEFAULT_META), which is exactly the behaviour we want.
  language?: Locale
}

// Spread defaults over
// the stored object so a save written by an OLDER build (missing newer fields) still loads with sane
// values — CRUCIAL: loadMeta only back-fills keys PRESENT in DEFAULT_META, so `bestDepth` MUST live
// here (not only as a MetaState default) or a pre-§6.5 save would load WITHOUT it (review MINOR /
// AC50/AC55 — the relaunch round-trip must hold for pre-existing saves).
// DEFAULT_META seeds the three NEW keys to the IDENTITY (meta-progression Decision 5): unlockedTier 0 +
// selectedTier 0 + an empty blueprints list = a fresh save behaves byte-identically to the round-1 game. A
// pre-slice save (missing these keys) back-fills them via loadMeta's spread below = the identity too.
export const DEFAULT_META: Readonly<MetaState> = Object.freeze({
  cells: 0,
  upgrades: {},
  bestDepth: 0,
  unlockedTier: 0,
  selectedTier: 0,
  blueprints: [],
})

export function loadMeta(): MetaState {
  const stored = get<Partial<MetaState> | null>(SAVE_KEY, null)
  const merged = stored && typeof stored === 'object' ? { ...DEFAULT_META, ...stored } : { ...DEFAULT_META }
  // CLONE the mutable containers so a back-filled field never ALIASES the frozen DEFAULT_META reference (a
  // save missing `upgrades`/`blueprints` would otherwise share DEFAULT_META's {} / [], and a later buy()/
  // bankRun() push would mutate the shared default — a subtle cross-instance leak). Each loaded meta owns
  // its own containers. Defensive against a corrupt `blueprints` that isn't an array (degrade to empty).
  merged.upgrades = { ...(merged.upgrades || {}) }
  merged.blueprints = Array.isArray(merged.blueprints) ? merged.blueprints.slice() : []
  return merged
}

export function saveMeta(meta: MetaState): boolean {
  return set(SAVE_KEY, meta)
}
