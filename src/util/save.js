// ── Defensive localStorage wrapper (design Decision 6, §6.0/§6.8, AC8) ──
// PURE of Phaser — safe to import anywhere, including headless. EVERY localStorage access
// is wrapped in try/catch so a disabled / private-mode / quota-exceeded storage NEVER
// throws: callers transparently degrade to in-memory fallbacks. One module owns
// serialization + error swallowing (DRY) so use sites stay clean.

// Read a JSON value by key, returning `fallback` if it's missing OR storage/parsing fails.
export function get(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

// Write a JSON-serializable value by key. Returns true on success, false if storage
// is unavailable/full (never throws) so callers can decide whether to surface it.
export function set(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

// ── Typed meta-progression wrapper ──
// Phase 7 banks Cells and permanent upgrades here; defined now so there's a STABLE schema
// to extend later (not used by gameplay in Phase 0). Single source of the save key + the
// default meta shape, layered over the defensive get/set above.
const SAVE_KEY = 'dead-cell:meta'

// The persistent meta shape. `cells` is the permanent currency (survives death); `upgrades`
// maps upgrade-id → owned level/flag. Spread defaults over the stored object so a save
// written by an older build (missing newer fields) still loads with sane values.
export const DEFAULT_META = Object.freeze({ cells: 0, upgrades: {} })

export function loadMeta() {
  const stored = get(SAVE_KEY, null)
  return stored && typeof stored === 'object'
    ? { ...DEFAULT_META, ...stored }
    : { ...DEFAULT_META }
}

export function saveMeta(meta) {
  return set(SAVE_KEY, meta)
}
