# i18n — zh-CN + English

## 1. Background

The game's UI text is hard-coded English: ~41 UI-chrome strings across 6 scenes + 4
overlay/entity files (all `fontFamily: 'monospace'`), plus ~100 content strings
(`name`/`desc`) in the `config/*` data tables. There is no locale layer, no language
preference, and `monospace` falls back to a Latin-only font that renders Chinese as
tofu boxes. This adds a two-locale i18n layer (`en`, `zh-CN`) with English as the
fallback source of truth.

## 2. Requirements Summary

Goal: add a minimal, zero-dependency i18n layer supporting `en` and `zh-CN`.

Settled decisions (from the user, pre-design):
- CJK rendering via a system-font fallback in a shared font constant — no external assets (honours the project's "programmer-art only" constraint, Decision 4 in `index.html`).
- First-load default auto-detected from `navigator.language`; the choice persists in `MetaState` (localStorage `dead-cell:meta`).
- Language switch is a new row in the Hub menu that cycles `en ↔ zh-CN`.
- Config `name`/`desc` translated via separate id-keyed tables in `src/i18n`; config files keep English as the source of truth.
- Accept that CJK is not monospaced, so padded-column rows stay slightly ragged in zh (KISS). Keyboard tokens (`SPACE`, `[Q]`, `WASD`) stay literal. The GameScene dev-hint line and the seed `window.prompt` are translated too.

## 3. Acceptance Criteria

1. An i18n module supports `en` + `zh-CN`; a missing `zh-CN` key falls back to `en`, then to the key itself — text never renders blank.
2. First load with no saved preference auto-detects from `navigator.language` (a Chinese browser → `zh-CN`, else `en`); the active language persists across reloads.
3. A `LANGUAGE` row in the Hub cycles `en ↔ zh-CN`, persists the choice, and the Hub re-renders in the chosen language; a subsequently-started run and all other scenes render in that language.
4. All UI-chrome strings render translated: Title, Hub, HUD, GameOver, Victory, MutationOverlay, ShopOverlay, Shop, and GameScene (room banner, fast-clear popup, dev-hint line, seed prompt).
5. All user-facing config content (`name`/`desc` across weapons + affixes, mutations, skills, bosses, biomes, upgrades, blueprints, shop items, tiers, room types) renders translated via id-keyed tables; config files are unchanged in their English content. (Scrolls are excluded — they never render user-facing text; see §6.1.)
6. CJK glyphs render via the system-font fallback in a shared `UI_FONT` used at every text site; no external font files are added.
7. The i18n core module stays Phaser-free; `npm run typecheck` and `npm run verify` both pass.

## 4. Problem Analysis

- **Approach A — adopt an i18n library (i18next / intl-messageformat).** Full-featured (ICU plurals, namespaces). Rejected: the project ships exactly one runtime dependency (`phaser`); a multi-package i18n stack is YAGNI for two locales and ~140 short strings, and pulls a build/bundle cost for features (plurals, contexts) this game doesn't need.
- **Approach B — inline locale objects in every config entry** (`name: { en, 'zh-CN' }`). Keeps a string next to its data. Rejected by the user (settled decision 5) and on merits: it edits every `config/*` file and every read site, and it pollutes the pure config modules that `scripts/verify-gen.mjs` imports headless.
- **Chosen — a tiny hand-rolled i18n module + external id-keyed tables.** A ~60-line Phaser-free `src/i18n` module: `t(key, params?)` for UI chrome, `tName/tDesc(category, id, en)` for content. English UI strings live in `en.ts`; zh-CN UI strings + all content overrides live in `zh-CN.ts`, keyed by the stable `id` each config entry already carries. Config files are untouched (English stays the source of truth), the verifier's purity import is unaffected, and there are zero new dependencies.

## 5. Decision Log

**1. i18n library vs. hand-rolled**
- Options: A) i18next/intl · B) hand-rolled module
- Decision: **B)** — two locales, ~140 short strings, no plural/context needs. A zero-dependency ~60-line module is the KISS/YAGNI fit and keeps the single-dependency profile.

**2. CJK font rendering**
- Options: A) system-font fallback · B) bundle/subset a CJK web font
- Decision: **A)** — settled with the user. `UI_FONT = 'monospace, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'`. No external assets (honours Decision 4); accepts OS-dependent CJK glyphs.

**3. First-load default language**
- Options: A) auto-detect `navigator.language` · B) always English
- Decision: **A)** — settled. A Chinese browser starts in zh-CN; the saved choice always wins afterward.

**4. Language switch UI**
- Options: A) Hub menu row · B) global hotkey · C) Title screen
- Decision: **A)** — settled. A new row in the existing keyboard-driven Hub list; Enter cycles `en ↔ zh-CN`. No new input wiring; `this.scene.restart()` re-renders the Hub in the new language.

**5. Config translation storage**
- Options: A) separate id-keyed tables · B) inline locale objects in config
- Decision: **A)** — settled. zh overrides keyed by entry `id` in `zh-CN.ts`; config keeps English. Keeps config + verifier pure.

**6. How the language preference persists / triggers auto-detect**
- Options: A) `language` is a required field defaulted to `'en'` in `DEFAULT_META` · B) `language?` optional, absent from `DEFAULT_META`
- Decision: **B)** — `loadMeta` only back-fills keys present in `DEFAULT_META`, so keeping `language` out of `DEFAULT_META` leaves it `undefined` until the user picks one. main.ts then does `meta.language ?? detectLocale()`, so first-run auto-detect actually fires (a defaulted `'en'` would suppress it). The field is set + saved only on an explicit switch.

**7. HUD dynamic names (weapon/biome/boss/mutations)**
- Options: A) resolve to translated names at GameScene's registry-write sites · B) write ids to the registry and resolve in HUDScene
- Decision: **A)** — the language only changes in the Hub, between runs, so a run's locale is fixed. Resolution lives inside the label helpers that re-run every mid-run update (`_weaponLabel()`, `_skillLabel()`, the mutations map) and at each `biomeName`/`bossName` write — NOT only at the one-time create writes (`:321`/`:333`), which would revert to English after a swap/pick. This needs no registry-shape change and no HUD coupling to config; HUDScene still owns its own static label prefixes via `t()`.

**8. Shared font constant location**
- Options: A) `config/constants.ts` `UI_FONT` · B) export from `src/i18n`
- Decision: **A)** — `constants.ts` is the existing home for cross-scene constants and is Phaser-free; font is a rendering constant, not an i18n concern. Every `fontFamily: 'monospace'` site imports and uses `UI_FONT`.

**9. Padded-column alignment under CJK**
- Options: A) keep `padEnd/padStart` columns · B) rebuild Hub/Shop into fixed-x columns
- Decision: **A)** — settled (KISS). CJK is double-width + proportional, so zh rows are slightly ragged; English stays aligned. Rebuilding two screens for a cosmetic gain is YAGNI.

**10. Keyboard tokens inside strings**
- Decision: tokens like `SPACE`, `ENTER`, `[Q]`, `WASD`, `[ESC]` stay literal within otherwise-translated sentences — they name physical keys.

**11. Where `setLocale` runs at boot**
- Options: A) `main.ts` before `new Phaser.Game` · B) `BootScene.create()`
- Decision: **A)** — running it before the game constructs guarantees the active locale is set before any scene `create()` renders text. `main.ts` is already the single boot site (Decision 1) and may import the Phaser-free `loadMeta` + i18n.

## 6. Design

### 6.1 Module layout

`src/i18n/index.ts` (Phaser-free, no imports from `phaser` or any scene):

```ts
export type Locale = 'en' | 'zh-CN'
export type Category =
  | 'weapon' | 'affix' | 'mutation' | 'skill' | 'boss'
  | 'biome' | 'upgrade' | 'blueprint' | 'shop' | 'tier' | 'roomType'
// NOTE: `scroll` is intentionally absent. Scrolls are apply-only (GameScene:1979
// `scroll.apply(runState)`); their pickups are unlabeled rectangles and the config has no
// `desc` — no scroll name/desc ever renders to the player, so a scroll table would be dead.

type Entry = { name?: string; desc?: string }
type Dict = { ui: Record<string, string> } & Partial<Record<Category, Record<string, Entry>>>

// Category keys reuse each config entry's stable `id`, EXCEPT `tier` — tier rows carry a
// numeric `index` (0/1/2) and no string id, so the `tier` table is keyed by `String(index)`
// ('0'/'1'/'2'). This is the one synthetic key in the scheme; called out so it isn't a surprise.

import { EN } from './en.js'
import { ZH_CN } from './zh-CN.js'
const LOCALES: Record<Locale, Dict> = { en: EN, 'zh-CN': ZH_CN }

let current: Locale = 'en'
export const getLocale = () => current
export const setLocale = (l: Locale) => { current = l in LOCALES ? l : 'en' }

export function detectLocale(): Locale {
  try {
    const n = (typeof navigator !== 'undefined' && navigator.language) || 'en'
    return n.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
  } catch { return 'en' }
}

// UI chrome. {var} interpolation. Falls back zh → en → key (never blank).
export function t(key: string, params?: Record<string, string | number>): string {
  const s = LOCALES[current]?.ui[key] ?? EN.ui[key] ?? key
  return params ? s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`)) : s
}

// Content. English fallback is the config object's own string (source of truth).
export function tName(cat: Category, id: string, en: string): string {
  if (current === 'en') return en
  return LOCALES[current]?.[cat]?.[id]?.name ?? en
}
export function tDesc(cat: Category, id: string, en: string): string {
  if (current === 'en') return en
  return LOCALES[current]?.[cat]?.[id]?.desc ?? en
}
```

`src/i18n/en.ts` — `export const EN: Dict = { ui: { 'title.heading': 'DEAD CELL', ... } }`.
Only the `ui` namespace; content English lives in the config files (fallback path).

`src/i18n/zh-CN.ts` — `export const ZH_CN: Dict = { ui: { ... }, weapon: { sword: { name: '剑' }, ... }, mutation: { berserker: { name, desc }, ... }, ... }`.
UI namespace + all content category tables keyed by entry `id` (tiers keyed by `String(index)` → `'0'/'1'/'2'` — see §6.1).

### 6.2 Persistence

- `util/save.ts`: add `language?: Locale` to the `MetaState` interface (type-only `import type { Locale }`). **Not** added to `DEFAULT_META` (Decision 6), so a fresh/old save leaves it `undefined`.
- `core/MetaState.ts`: add `getLanguage(): Locale | undefined` and `setLanguage(l: Locale): void` (sets `meta.language`, `saveMeta`). Module stays Phaser-free (only imports the Phaser-free `save.ts`).
- `main.ts`: `setLocale(loadMeta().language ?? detectLocale())` before `new Phaser.Game(config)`; also set `document.documentElement.lang` to the active locale (minor, for correctness).

### 6.3 Render sites

UI chrome → replace literals with `t('<key>', params?)` in: TitleScene, HubScene, HUDScene, GameOverScene, VictoryScene, MutationOverlay, ShopOverlay, Shop, and GameScene (room banner, fast-clear popup, dev-hint, seed prompt). The HUD's `_setSkillLabel`/timer/boss-fallback static text uses `t()`.

Content → at the points where a `name`/`desc` becomes display text. The registry-bound
strings must be wrapped **inside the label helpers that re-run every mid-run update**, not
at the one-time create-site writes (`weapon` is re-written on swap/pickup via `_weaponLabel()`;
`mutations` on each pick at `:2428`; skills via `_skillLabel()`). Wrapping only the create
writes (`:321`/`:333`) would revert the HUD to English the moment the player swaps a weapon
or picks a mutation. Sites:
- `_weaponLabel()` (`GameScene.ts:2370`): wrap both the active and the inactive-slot strings — `tName('weapon', w.id, w.name)` and, when affixed, `tName('affix', w.affixId, w.affixName)`. (Verify in Phase 5 that the equipped-weapon object carries `id`/`affixId`; if the affix id isn't on the instance, key the affix table by `affixName` instead.)
- `_skillLabel(slot)` (`GameScene.ts:2389`): `spec ? tName('skill', spec.id, spec.name) : '—'`.
- mutations registry map (`GameScene.ts:2428`): `tName('mutation', id, MUTATIONS_BY_ID[id]?.name ?? id)`.
- `biomeName` (`GameScene.ts:314`/`:2410`) and `bossName` (`:794`/`:896`): `tName('biome'|'boss', spec.id, spec.name)` at each write.
- Room banner: wrap `tName('roomType', roomType.id, roomType.name)` inside `_popRoomBanner` — **after** the existing `if (roomType.name)` truthiness guard at `GameScene.ts:1414`, so a normal room (empty name) never pops a banner. `zh-CN.ts` keys only `elite`/`horde`/`cursed`; it must NOT key `normal` (whose English name is `''`).
- HubScene rows: `tName/tDesc('upgrade'|'blueprint', id, ...)`; tier row uses `tName/tDesc('tier', String(tier.index), tier.name|tier.desc)` (tiers have a numeric `index`, no string id — see §6.1).
- ShopOverlay rows: `tName/tDesc('shop', it.id, ...)`.
- MutationOverlay cards: `tName/tDesc('mutation', m.id, ...)`.

Because a run's locale is fixed (language only changes in the Hub, between runs), resolving
inside these helpers is sufficient even though they re-run each frame/update — there is no
need for any live re-translation broadcast (Decision 7).

### 6.4 Font

`config/constants.ts`: `export const UI_FONT = 'monospace, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'`. Every `fontFamily: 'monospace'` site becomes `fontFamily: UI_FONT` (import added per file). A `grep` finds the sites across these files: TitleScene, HubScene, HUDScene, GameScene, GameOverScene, VictoryScene, MutationOverlay, ShopOverlay, Shop, **and `effects/ParticlePool.ts:66`** (the floating damage-number text). ParticlePool renders digits only (no CJK), so converting it is purely to satisfy the "every text site uses `UI_FONT`" contract (AC6) and keep the `grep` clean — not for translation. `index.html`'s body `system-ui` stack (page chrome, not the canvas) is left as-is; `document.documentElement.lang` is set from JS in `main.ts` at boot (no static HTML edit needed).

### 6.5 Language switch (Hub)

Insert a LANGUAGE row at index 0 (above TIER). The existing index arithmetic in
`create()` (`HubScene.ts:85-91`) shifts to:

```
this.languageRowIndex = 0
this.tierRowIndex = 1
this.upgradeRowStart = 2
this.blueprintRowStart = 2 + UPGRADES.length
this.seedRowIndex = 2 + UPGRADES.length + BLUEPRINTS.length
this.startRowIndex = this.seedRowIndex + 1
this.rowCount = this.startRowIndex + 1
this.cursor = this.startRowIndex // unchanged: first-load focus stays on START RUN
```

Add a `languageRowText` (rendered like the other left-aligned rows at
`LIST_TOP + languageRowIndex * ROW_H`) showing `t('hub.language')` + both locale labels with
the active one marked (e.g. `LANGUAGE   [English] 中文`). The upgrade-row lookup at the old
`:199` (`UPGRADES[this.cursor - this.upgradeRowStart]`) still works because it subtracts
`upgradeRowStart` — but every `cursor === <named>RowIndex` comparison in `_confirm()`
(`:175` start · `:182` tier · `:191` seed) and the blueprint range test (`:196`) must be
re-checked against the new indices. Add the new branch first:

```
if (this.cursor === this.languageRowIndex) {
  const next = getLocale() === 'en' ? 'zh-CN' : 'en'
  setLocale(next)
  this.meta.setLanguage(next)
  this.sfx.uiSelect()
  this.scene.restart() // re-runs create() → every row re-rendered through t/tName/tDesc
  return
}
```

`restart()` re-renders the whole Hub in the new language and keeps the scene single-instance.

## 7. Files Changed

- `src/i18n/index.ts` — NEW: Phaser-free core (`Locale`, `Category`, `getLocale/setLocale/detectLocale`, `t`, `tName`, `tDesc`).
- `src/i18n/en.ts` — NEW: English `ui` dictionary.
- `src/i18n/zh-CN.ts` — NEW: Chinese `ui` dictionary + content tables for all 11 categories (scrolls excluded — see §6.1).
- `src/config/constants.ts` — add `UI_FONT`.
- `src/util/save.ts` — add optional `language?: Locale` to `MetaState` (type-only import); leave `DEFAULT_META` unchanged.
- `src/core/MetaState.ts` — add `getLanguage`/`setLanguage` to the interface + factory.
- `src/main.ts` — boot-time `setLocale(loadMeta().language ?? detectLocale())` + `document.documentElement.lang = getLocale()`. (No `index.html` edit — the `lang` write is JS-side only.)
- `src/scenes/TitleScene.ts` — `t()` for the 3 strings; `UI_FONT`.
- `src/scenes/HubScene.ts` — `t/tName/tDesc`; LANGUAGE row + cycle/restart; row-index shift; seed prompt via `t()`; `UI_FONT`.
- `src/scenes/GameScene.ts` — `tName` inside `_weaponLabel()`/`_skillLabel()`/mutations-map + at biome/boss writes + room banner (after the `:1414` guard); `t()` for dev-hint + fast-clear popup; `UI_FONT`.
- `src/effects/ParticlePool.ts` — `UI_FONT` for the floating damage-number text (digits only; no translation — satisfies the "every site" contract).
- `src/scenes/HUDScene.ts` — `t()` for static label prefixes/timer/boss fallback; `UI_FONT`.
- `src/scenes/GameOverScene.ts` — `t()` for header/labels/footer; `UI_FONT`.
- `src/scenes/VictoryScene.ts` — `t()` for header/flavour/labels/footer; `UI_FONT`.
- `src/entities/MutationOverlay.ts` — `t()` for chrome + `tName/tDesc` for cards; `UI_FONT`.
- `src/entities/ShopOverlay.ts` — `t()` for chrome + `tName/tDesc` for rows; `UI_FONT`.
- `src/entities/Shop.ts` — `t()` for the `[E] SHOP` prompt; `UI_FONT`.

## 8. Verification

1. [AC1] Set locale to `zh-CN`, delete a key from `zh-CN.ts` temporarily → that string shows the English text, never blank (fallback chain holds). Restore.
2. [AC2] Clear `localStorage`, set browser language to `zh-*`, reload → game opens in Chinese; switch to a non-zh browser language, clear storage, reload → opens in English.
3. [AC3] In the Hub, press Up from the TIER row → cursor lands on the LANGUAGE row (index 0); press Enter → all Hub rows flip language and the cursor/layout stay correct (TIER/upgrade/blueprint/seed/START still dispatch to the right action); reload the page → the chosen language persists; START RUN → in-game HUD/banners are in the chosen language. Swap a weapon and pick a mutation mid-run → the HUD weapon/mutation strings stay translated (helper-resolution, not create-only).
4. [AC4] Walk every screen (Title, Hub, in-run HUD, room banner, fast-clear popup, dev hint, seed prompt, Shop overlay, Mutation overlay, GameOver, Victory) in zh-CN → no English chrome remains (keyboard tokens excepted).
5. [AC5] In zh-CN, weapon/skill/boss/biome/mutation/upgrade/blueprint/shop/tier/roomType names + descriptions render in Chinese; `git diff src/config` shows no content change.
6. [AC6] Inspect a rendered Chinese glyph → renders (not tofu); `grep -rn "fontFamily: 'monospace'" src` returns nothing (incl. `effects/ParticlePool.ts`); no font files added.
7. [AC7] `npm run typecheck` and `npm run verify` both pass.
