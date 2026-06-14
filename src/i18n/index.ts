// ── i18n core (zh-CN + English) — 100% PURE of Phaser ──────────────────────────────────────────────
// A tiny hand-rolled localisation layer (KISS / YAGNI — two locales, ~140 short strings, no plural or
// ICU needs, so a full i18n library would be over-engineering and would break the single-runtime-
// dependency profile). It imports NOTHING Phaser-coupled, so it is safe to consume from any scene AND
// keeps scripts/verify-gen.mjs's headless import path clean (the same purity contract config/* keeps).
//
// TWO LAYERS:
//   t(key, params?)        — UI CHROME (titles, labels, instructions). The English source lives in
//                            en.ts; zh-CN overrides in zh-CN.ts. {var} interpolation. Fallback chain
//                            zh → en → key, so a missing zh key shows English, never a blank.
//   tName / tDesc(cat,id,en) — CONTENT (config name/desc). English is the config object's OWN string
//                            (the source of truth — config/* is never edited); the zh override is keyed
//                            by the entry's stable `id` in zh-CN.ts. A missing override returns `en`.
//
// LOCALE: the ACTIVE runtime locale is module state set ONCE at boot (main.ts: setLocale(meta.language
// ?? detectLocale())) and re-set on a Hub language switch (which then scene.restart()s to re-render).
// The persisted preference lives in MetaState (localStorage); this module only holds the live value.

import { EN } from './en.js'
import { ZH_CN } from './zh-CN.js'

export type Locale = 'en' | 'zh-CN'

// The translatable CONTENT categories — each reuses the config entry's stable `id` as its key, EXCEPT
// `tier` (tier rows carry a numeric `index`, no string id, so the tier table is keyed by String(index)
// → '0'/'1'/'2'). `scroll` is intentionally absent: scrolls are apply-only (no name/desc ever renders).
export type Category =
  | 'weapon'
  | 'affix'
  | 'rarity'
  | 'mutation'
  | 'skill'
  | 'boss'
  | 'biome'
  | 'upgrade'
  | 'blueprint'
  | 'shop'
  | 'tier'
  | 'roomType'

export interface Entry {
  name?: string
  desc?: string
}

// A locale dictionary: a required `ui` map (chrome) + optional per-category content tables (keyed by id).
export type Dict = { ui: Record<string, string> } & Partial<Record<Category, Record<string, Entry>>>

const LOCALES: Record<Locale, Dict> = { en: EN, 'zh-CN': ZH_CN }

// The live active locale (boot default 'en' until main.ts sets it from the saved pref / browser detect).
let current: Locale = 'en'

export function getLocale(): Locale {
  return current
}

export function setLocale(l: Locale): void {
  current = l in LOCALES ? l : 'en'
}

// Browser-language auto-detect for a first-time visitor (no saved preference). Guarded so a headless /
// no-navigator environment degrades to 'en' instead of throwing (mirrors save.js's defensive discipline).
export function detectLocale(): Locale {
  try {
    const n = (typeof navigator !== 'undefined' && navigator.language) || 'en'
    return n.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
  } catch {
    return 'en'
  }
}

// ── t(key, params?) — UI chrome lookup with {var} interpolation. Fallback: zh → en → key (never blank). ──
export function t(key: string, params?: Record<string, string | number>): string {
  const s = LOCALES[current]?.ui[key] ?? EN.ui[key] ?? key
  return params ? s.replace(/\{(\w+)\}/g, (_m, k) => String(params[k] ?? `{${k}}`)) : s
}

// ── tName / tDesc(category, id, en) — content lookup. `en` is the config object's own string (the
// English source of truth + the fallback when no zh override exists). 'en' locale short-circuits to it. ──
export function tName(cat: Category, id: string, en: string): string {
  if (current === 'en') return en
  return LOCALES[current]?.[cat]?.[id]?.name ?? en
}

export function tDesc(cat: Category, id: string, en: string): string {
  if (current === 'en') return en
  return LOCALES[current]?.[cat]?.[id]?.desc ?? en
}

// ── CONTROLS_ROWS (F1 onboarding & build UI §6.4, Decision 6) — the ONE shared, ordered controls list both
// TitleScene and PauseOverlay render (DRY — adding/renaming a control touches one block). PURE data (keys only;
// no Phaser): each row is [action-label key, keys-glyph key], resolved through t() at the render site. The actual
// strings live in en.ts / zh-CN.ts (`controls.*`). Two fixed-x Text columns per row keep it CJK-pixel-anchored.
export const CONTROLS_ROWS: readonly (readonly [string, string])[] = [
  ['controls.move', 'controls.move.keys'],
  ['controls.jump', 'controls.jump.keys'],
  ['controls.attack', 'controls.attack.keys'],
  ['controls.dodge', 'controls.dodge.keys'],
  ['controls.parry', 'controls.parry.keys'],
  ['controls.flask', 'controls.flask.keys'],
  ['controls.skill1', 'controls.skill1.keys'],
  ['controls.skill2', 'controls.skill2.keys'],
  ['controls.swap', 'controls.swap.keys'],
  ['controls.interact', 'controls.interact.keys'],
  ['controls.pause', 'controls.pause.keys'],
  ['controls.mute', 'controls.mute.keys'],
  ['controls.quit', 'controls.quit.keys'],
]
