# CJK Column Alignment — Pixel-Anchored Hub/Shop Rows

## 1. Background

The Hub screen (and the in-run Shop overlay) lay out multi-column rows by packing
each row into a single string with `padEnd(n)` / `padStart(n)` and rendering it as
one `Phaser.GameObjects.Text`. Character-count padding only aligns under a true
monospace font. With `UI_FONT = 'monospace, "PingFang SC", …'` (`constants.ts:41`),
ASCII renders in monospace (space ≈ 10.8px at 18px) while CJK falls back to a
proportional system font (~18px glyphs, i.e. ~1.67× a space — not an integer
multiple). So rows whose CJK-character counts differ drift horizontally.

Observed: the upgrade row `+闪避无敌帧` (1 ASCII `+` + 5 CJK) is the only upgrade with
5 CJK chars; its neighbours have 4, so padding to 18 chars makes it ~7px wider and
visibly pushes its whole row right of the others.

This was previously an accepted KISS trade-off (note in `zh-CN.ts:7-9`,
`constants.ts:39`). The user now wants it actually fixed.

## 2. Requirements Summary

- Goal: Hub and Shop columns align under Chinese (and any future locale), not just
  monospace English.
- Approach: Option A — replace padded single-string rows with one `Text` object per
  column, each anchored at a fixed x-pixel. Alignment becomes font-independent.
- Scope: `src/scenes/HubScene.ts`, `src/entities/ShopOverlay.ts`. Plus updating the
  now-stale "ragged CJK accepted" comments.
- Out of scope: ASCII-only `padStart(2)` timers (GameOver/Victory) and hex helpers —
  digits are monospace, never ragged.

## 3. Acceptance Criteria

1. In zh-CN, all Hub list rows' columns line up vertically (the name / mid / aux /
   desc anchors), including the `+闪避无敌帧` row.
2. English Hub layout stays clean — no regression, no row clipping past the
   cursor-bar right edge (~1160px on the 1280px canvas), except the tier row which
   already runs near the edge today (unchanged behavior).
3. In-run Shop overlay columns align in zh-CN; English desc is no worse than today.
4. Cursor highlight bar, per-row affordability colors, keyboard nav, and all
   row-index / `_confirm` / `_move` / `_editSeed` logic are unchanged.
5. `tsc --noEmit` passes; `scripts/verify-gen.mjs` (determinism walk) still passes —
   this is a UI-only change and must not touch generation.

## 4. Problem Analysis

- Approach B (width-aware padding — count CJK as 2) -> rejected: CJK ≈ 1.67× a space,
  not exactly 2×, so it only reduces drift, never eliminates it. Half-measure.
- Approach C (bundle a monospace-CJK webfont so CJK = exactly 2× ASCII) -> rejected:
  multi-MB payload, directly contradicts the deliberate system-font decision.
- Chosen — Approach A (pixel-anchored columns) -> one `Text` per column at a fixed x.
  Font-independent, perfectly aligned in every locale, no payload. The cursor
  highlight is already a full-width rectangle and per-row color is uniform, so both
  carry over unchanged. Cost: a mechanical refactor of two render paths.

## 5. Decision Log

**1. Column model — how to align?**
- Options: A) one `Text` per column at fixed x · B) width-aware `padEnd` · C) mono-CJK webfont
- Decision: **A)** — only A is font-independent and exact (see §4). B/C rejected.

**2. Hub column x-anchors (px).**
- Options: A) `200 / 430 / 580 / 720` · B) tighter `200 / 400 / 520 / 660`
- Decision: **A)** — sized from the *named* longest strings at 18px monospace
  (~10.8px/char). `COL_NAME=200` (longest name `Second Weapon Slot` 18ch → ends
  ~394, ~36px gap to MID). `COL_MID=430` (Lv X/Y · tier count · kind · EN label ·
  seed value). `COL_AUX=580` (cost · status · ZH label · tier name—desc).
  `COL_DESC=720` (one-line effect). Worst-case desc ends, named for auditability:
  upgrade `+15% ranged (bow) damage per level` (34ch) → ~1087px; blueprint
  `A spinning reach weapon for the pool.` (37ch) → ~1120px. Both clear the
  cursor-bar right edge (~1160px); worst-case margin ~40px (blueprint).
- Note: AUX is 580 (not 560) specifically so the tier *count* cell (Decision 3) has
  a comfortable gap — see Decision 3.

**3. The irregular tier row (has no cost/status column).**
- Options: A) reuse the AUX slot for its long `name — desc + hint` · B) add a 5th
  anchor · C) push its name—desc to COL_DESC=720
- Decision: **A)** — KISS. Tier row maps name@200, `sel/unlocked (max N)`@430,
  `name — desc (+cycle hint)`@580. C rejected: at 720 the ~63ch worst case
  (`2 Boss Cells — Far tougher; one fewer flask.   (SPACE to cycle)`) would end
  ~1400px and clip off the 1280 canvas.
- Reconciliation with the count cell (reviewer R1 items 2-3): the count
  `0/2 (max 2)` (11ch) ends ~549px (EN) / ~552px (zh). With AUX at the original 560
  that left only ~8-11px — tighter than today's ~32px (3-space) gap and fragile in
  CJK. Moving AUX to **580** restores a ~31px gap (≈ today). The name—desc then ends
  ~1260px (was ~1236 today) — still on-canvas, behavior effectively unchanged (AC2).

**4. Hub row → anchor mapping (some rows leave slots empty).**
- Decision (per row type):
  - Language: name@200 · `English`@430 · `[中文]`@580
  - Tier: name@200 · `sel/unlocked (max N)`@430 · `name — desc (+hint)`@580
  - Upgrade: name@200 · `Lv X/Y`@430 · `cost`@580 · `desc`@720
  - Blueprint: name@200 · `kind`@430 · `status`@580 · `desc`@720
  - Seed: name@200 · `value`@430 · `hint`@720

**5. Row storage shape.**
- Options: A) array of `Text` cells per row (`Text[]` / `Text[][]`) ·
  B) keep one `Text` and measure pixel width to re-pad
- Decision: **A)** — B re-introduces font-measurement fragility. A small
  `makeCell` helper keeps creation DRY in *each* file (Hub + Shop get their own
  local helper — different fontSize/scrollFactor/depth, so no shared util; reviewer
  R1 item 6). Per-row color is applied to every cell of that row.

**6. Shop column x-anchors (panel-relative, `PANEL_W=560`, name origin = left+30).**
- Decision: `SHOP_COL_NAME = left+30` (existing) · `SHOP_COL_PRICE = left+210` ·
  `SHOP_COL_DESC = left+270`. Longest name `Throwing Knives` / `Healing Draught`
  (15ch ≈ 162px) → ends ~left+192; price at left+210 gives an ~18px name→price gap
  (reviewer R1 item 4 — was ~8px at left+200). Price `{price}g` (≤4ch) ends ~left+253,
  so desc at left+270 clears it (~17px). Longest desc `Equip a radial-freeze skill`
  (27ch ≈ 292px) ends ~left+562 vs panel inner edge ~left+557 — ~5px over, but ~40px
  *less* overhang than today (~left+602), so English is strictly no worse (AC3); zh
  descs are shorter and fit. Price rendered left-aligned as `{price}g` (drops the
  cosmetic `padStart(3)` right-align — minor).

**7. Stale comments.**
- Decision: rewrite `zh-CN.ts:7-9` and `constants.ts:39` from "padEnd columns read
  ragged in CJK (accepted)" to "columns are pixel-anchored, locale-independent".
  Keyboard-token note (SPACE/WASD/etc. stay literal) is preserved.

## 6. Design

### HubScene

Add the anchors near the existing `COL_X`:

```ts
const COL_NAME = 200 // name / label
const COL_MID  = 430 // Lv X/Y · tier count · kind · EN label · seed value
const COL_AUX  = 580 // cost · status · ZH label · tier name—desc
const COL_DESC = 720 // the one-line effect / description / hint
```

Helper on the scene:

```ts
private makeCell(x: number, y: number, color: string) {
  return this.add.text(x, y, '', { fontFamily: UI_FONT, fontSize: '18px', color }).setOrigin(0, 0.5)
}
```

Field changes (creation in `create()`):
- `languageRowText: Text` -> `languageCells: Text[]` (3 cells @ 200/430/580)
- `tierRowText: Text` -> `tierCells: Text[]` (3 cells @ 200/430/580)
- `rowTexts: Text[]` -> `rowTexts: Text[][]` (UPGRADES.length × 4 cells @ 200/430/580/720)
- `blueprintTexts: Text[]` -> `Text[][]` (BLUEPRINTS.length × 4 cells @ 200/430/580/720)
- `seedRowText: Text` -> `seedCells: Text[]` (3 cells @ 200/430/720; AUX slot unused)
- `startRowText` unchanged (single centered Text).

`_render()`: delete all five `padEnd` calls; set each cell's text directly and apply
the row's color to every cell. Cursor-bar `selY` math, `_move`, `_confirm`,
`_editSeed`, and all row-index fields are untouched (none depend on text width).

### ShopOverlay

Panel-relative anchors (computed from `cx`, `PANEL_W`):

```ts
const left = cx - PANEL_W / 2
const SHOP_COL_NAME  = left + 30  // existing row origin
const SHOP_COL_PRICE = left + 210
const SHOP_COL_DESC  = left + 270
```

A local cell helper (mirrors Hub's `makeCell`, parameterized for the overlay's
scroll-factor + depth + 20px font — reviewer R1 item 6, keep the two render paths
symmetric rather than half-applying DRY):

```ts
const makeCell = (x: number, y: number, color: string) =>
  scene.add.text(x, y, '', { fontFamily: UI_FONT, fontSize: '20px', color })
    .setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH + 2)
```

- `rowTexts: Text[]` -> `Text[][]` (3 cells per item: name / `{price}g` / desc),
  created in the constructor loop via `makeCell(x, this._rowBaseY + i * ROW_H, color)`
  (three-arg, mirrors Hub's helper — `y` is the per-row baseline, in scope at the call site).
- `_render()`: drop `padEnd(18)` / `padStart(3)`; set the three cells, color all three.
- `close()` teardown spreads `...this.rowTexts` (line 219) — `this.rowTexts` is now
  `Text[][]`, so change that exact spread to `...this.rowTexts.flat()`, else the loop
  calls `.destroy()` on arrays and leaks the real Text objects (AC4).

## 7. Files Changed

- `src/scenes/HubScene.ts` — add column anchors + `makeCell`; convert each row from a
  padded single `Text` to per-column `Text` cells; drop `padEnd` in `_render`.
- `src/entities/ShopOverlay.ts` — add panel-relative column anchors; convert item rows
  to per-column cells; drop `padEnd`/`padStart`; flatten teardown.
- `src/i18n/zh-CN.ts` — rewrite the alignment note (lines 7-9).
- `src/config/constants.ts` — rewrite the alignment note (line 39).

## 8. Verification

1. [AC1/AC2] `npm run dev`, open Hub, toggle 中文 — confirm every column lines up
   (esp. `+闪避无敌帧`); toggle back to English — confirm clean, no clipping.
2. [AC3] Enter a run, open the vendor shop, toggle 中文 — columns align; English desc
   not clipped worse than before.
3. [AC4] In both locales: Up/Down moves the highlight correctly behind each row; an
   unaffordable upgrade stays red; buy/cycle/seed/start still work.
4. [AC5] `npm run typecheck` and `npm run verify` both pass.
