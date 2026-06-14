# Shop Overlay — Auto-Size Panel Height to Catalog

## 1. Background

The in-run vendor overlay (`src/entities/ShopOverlay.ts`) draws a fixed-size centered
modal panel (`PANEL_W=560`, `PANEL_H=360`) and lists the `SHOP_ITEMS` catalog plus a
synthetic "离开"/Leave close row. The panel height is a hard-coded `360`, chosen when the
catalog had ~5 items. The catalog has since grown to 8 items (skills slice `9484f52`,
forge vendor `ea5b9d6`), but `PANEL_H` was never re-tuned, so the list now overflows the
panel: the last item rows and the close row spill below the bottom border and overlap the
control-hint/help line. The user's screenshot shows the two "锻造"/Forge rows crossing the
panel border and colliding with the help text and the 离开 button.

The math (panel centered at `cy=360`, so `panelTop=180`, panel spans y=180→540):

- First row at `panelTop + ROW_TOP_OFFSET` = 180 + 96 = **276**.
- Rows step by `ROW_H=44`. 8 items → indices 0..7, last item at 276 + 7·44 = **584** (below the 540 bottom border).
- Close row at index 8 → 276 + 8·44 = **628** (far below the panel).
- Help line at `panelTop + PANEL_H - 20` = **520** — overlapped by the spilling rows.

## 2. Requirements Summary

**Goal:** Make the shop panel auto-size its height from the catalog row count so every item
row, the close row, and the help line always render inside the panel and never overlap —
eliminating the recurring overflow that returns each time the catalog grows.

**Scope (in):** `src/entities/ShopOverlay.ts` layout math only — derive `PANEL_H` (and the
dependent `panelTop`) from `rowCount = SHOP_ITEMS.length + 1` instead of a hard-coded `360`.

**Scope (out):** Scrolling/pagination (YAGNI — the auto-sized panel fits within bounds at the
current and near-future counts); changes to `ROW_H`, column x-offsets, fonts, colors, the
catalog data, item ordering, or input/buy behavior; refactoring sibling overlays
(BiomeChoiceOverlay / QuitConfirmOverlay / MutationOverlay) — referenced as precedent only.

## 3. Acceptance Criteria

1. With the current 8 catalog items (9 rows including "离开"/Leave), every item row, the close
   row, and the help text render fully inside the panel's stroked border — no row crosses the
   bottom border and no row overlaps the help text.
2. `PANEL_H` is no longer a hard-coded constant; it is computed from the row count such that
   adding/removing an item in `SHOP_ITEMS` keeps all rows + close row + help inside the panel
   with **no** source changes to layout offsets, for the catalog's realistic range (≤~13 rows,
   where the panel still fits the 720p viewport). Beyond that range, density/scrolling is a
   separate slice (out of scope, YAGNI — see section 6).
3. The panel remains horizontally and vertically centered in the 1280×720 design viewport and
   stays within the viewport with visible top/bottom margin (does not touch the letterbox edges)
   at the current item count.
4. The help line stays anchored at the panel's bottom (`panelTop + PANEL_H - 20`) and is never
   overlapped by item rows.
5. No regression: title, gold header, pixel-anchored name/price/desc columns, cursor highlight
   bar, affordability greying, keyboard nav, and buy/close interactions all work exactly as
   before; the panel's purple stroke and dim backdrop are unchanged.
6. The fix touches only `src/entities/ShopOverlay.ts` (no changes to `src/config/shop.ts` or
   sibling overlays).

## 4. Problem Analysis

- **Approach A — Re-tune the fixed `PANEL_H`/`ROW_TOP_OFFSET` to fit 9 rows** → fixes today's
  overflow but resets the same time-bomb: the next catalog addition re-breaks it. Rejected — it
  is the exact failure mode that caused this bug.
- **Approach B — Shrink `ROW_H` / use two columns / add scrolling** → more code, changes the
  visual density or interaction model, and over-engineers for a 9-row list. Rejected (YAGNI).
- **Chosen — Approach C: compute `PANEL_H` from `rowCount`, re-derive `panelTop`.** Every Y in
  the constructor already anchors off `panelTop` or `cy` (`ShopOverlay.ts:84-153`), so making
  `PANEL_H` data-driven propagates to the title, gold header, rows, close row, and help line with
  no other edits. Mirrors HubScene's existing "size the list to the data-driven row count"
  convention (`HubScene.ts:37-39`). Smallest change that removes the root cause.

## 5. Decision Log

**1. Robust auto-size vs. re-tune fixed values?**
- Options: A) re-tune fixed `PANEL_H` · B) auto-size `PANEL_H` from `rowCount` · C) scroll/paginate
- Decision: **B)** — root cause is a hard-coded height that didn't track catalog growth; auto-sizing
  removes the recurrence for trivial cost and matches HubScene's data-driven-sizing precedent.

**2. Where does the height formula live?**
- Options: A) module-level constants computed from `SHOP_ITEMS.length` · B) computed inside the constructor
- Decision: **A)** — `SHOP_ITEMS` is a static import; computing `ROW_COUNT`/`PANEL_H` at module
  scope (next to the other layout constants) keeps the constructor unchanged in shape and the
  layout knobs all in one place (DRY, matches the existing `const PANEL_W = …` block).

**3. Bottom padding below the close row?**
- Options: A) reuse `PANEL_H - 20` help anchor with a tuned pad · B) compute help Y independently
- Decision: **A)** — keep the existing `help.y = panelTop + PANEL_H - 20` anchor untouched (one
  fewer thing to change, AC4 stays literally true). Note the help anchor is INDEPENDENT of
  `BOTTOM_PAD`: it tracks the panel's bottom border (border − 20), not the pad. `BOTTOM_PAD`'s
  only job is to push the border far enough below the close row that the help band (border − 20)
  clears it — so `BOTTOM_PAD` must stay ≥ ~40. At `BOTTOM_PAD=48` (N=8) the help (border − 20 = 610)
  sits 54px below the close-row cursor bar's bottom (556) and 50px below the row slot's lower edge
  (538 + ROW_H/2 = 560), clearing the close row (matches section 6's figure).

**4. Vertical centering source?**
- Options: A) keep `cy = DESIGN_HEIGHT/2`, derive `panelTop = cy - PANEL_H/2` · B) pin `panelTop` to a fixed top margin
- Decision: **A)** — unchanged from today; with the new larger `PANEL_H` the panel stays centered
  and, at ~540px tall, leaves ~90px margin top/bottom (AC3). No new magic numbers.

## 6. Design

Replace the hard-coded `const PANEL_H = 360` with a value computed from the catalog size, keeping
all other layout constants and every `panelTop + …` / `cy` anchor exactly as they are.

New module-level constants (alongside the existing layout block, `ShopOverlay.ts:36-49`):

```ts
const ROW_H = 44
const ROW_TOP_OFFSET = 96 // px below the panel top where the first item row sits.
const BOTTOM_PAD = 48     // px reserved between the close row and the panel's bottom border. The
                         // help line sits INSIDE this band at `panelTop + PANEL_H - 20` (anchored to
                         // the border, NOT to BOTTOM_PAD), so BOTTOM_PAD must stay ≥ ~40 for the help
                         // (border − 20) to clear the close row's cursor bar.

// rowCount = every drawn list line: one per catalog item + the synthetic "离开"/Leave close row.
// PANEL_H is DERIVED from it (not a magic constant) so the panel grows/shrinks with the catalog
// and the list can never again overflow the border when SHOP_ITEMS changes (root-cause fix).
const ROW_COUNT = SHOP_ITEMS.length + 1
const PANEL_H = ROW_TOP_OFFSET + ROW_COUNT * ROW_H + BOTTOM_PAD
```

Everything downstream is already derived:

- `const cy = DESIGN_HEIGHT / 2`, `const panelTop = cy - PANEL_H / 2` — unchanged; bigger `PANEL_H`
  just re-centers a taller panel.
- `panel` rect uses `PANEL_H` — auto-grows.
- title `panelTop + 28`, gold `panelTop + 60`, rows `panelTop + ROW_TOP_OFFSET + i*ROW_H`, close row
  `_rowBaseY + closeRowIndex*ROW_H`, help `panelTop + PANEL_H - 20` — all anchor off `panelTop`/`PANEL_H`,
  so no edits needed.

**Verification of the formula at N=8 (ROW_COUNT=9):**
`PANEL_H = 96 + 9·44 + 48 = 540`. `cy=360` → `panelTop=90`, panel spans **90→630**.
- Top block (unchanged relative spacing — the whole panel just translates up by `(360−540)/2 = −90`):
  title `panelTop+28` = **118**, gold `panelTop+60` = **150** (20px font, origin 0.5 → bottom ~160),
  first row `panelTop+96` = **186**. Same deltas off `panelTop` as today (28 / 60 / 96), so the
  header/row-1 spacing is identical to the shipping layout — no top-of-panel regression (AC5). ✓
- First row: **186**. Last item (idx 7): 186+7·44 = **494**. Close row (idx 8): 186+8·44 = **538**.
- Cursor bar height is `ROW_H − 8` = 36px (±18 around its row center). On the close row the bar
  spans **520→556**. The help line sits at `panelTop + 540 − 20` = **610** — 54px below the close
  row's *cursor-bar bottom* (556), and 20px above the 630 bottom border. So the help clears the
  selected close row's highlighted bar, not merely the text center (AC1/AC4). ✓
- All rows + cursor bar + help inside [90, 630]; panel margin = 90px top / 90px bottom in the 720
  viewport. ✓

**Future growth check (AC2):** add a 9th item → ROW_COUNT=10 → `PANEL_H = 96 + 10·44 + 48 = 584`,
`panelTop=68`, spans 68→652 — still ~68px margins, no overflow, zero offset edits. The panel keeps
fitting until ROW_COUNT≈13 (PANEL_H≈672, ~24px margin); beyond that a future slice would revisit
density/scrolling — explicitly out of scope now (YAGNI), noted here so the limit is not silent.

## 7. Files Changed

- `src/entities/ShopOverlay.ts` — replace hard-coded `const PANEL_H = 360` with `ROW_COUNT` +
  `BOTTOM_PAD` constants and a derived `PANEL_H = ROW_TOP_OFFSET + ROW_COUNT*ROW_H + BOTTOM_PAD`;
  update the layout-comment block to explain the derivation. No other lines change.

## 8. Verification

1. [AC1/AC4] `npm run dev`, enter a run, open the shop (walk onto the vendor, press E). Visually
   confirm all 8 item rows + the 离开 row + the help line sit inside the purple border with no
   overlap, matching the corrected layout (was: forge rows spilling past the border).
2. [AC3] Confirm the panel is centered with clear empty margin above the title and below the help
   (does not touch the letterbox bars).
3. [AC2] Temporarily append a dummy row to `SHOP_ITEMS`, reload, confirm the panel grew taller and
   still fits everything with no offset edits; remove the dummy.
4. [AC5] Arrow/W-S to move the cursor, confirm the highlight bar tracks each row including 离开;
   buy an affordable item (gold deducts, row stays white) and hover an unaffordable one (red);
   press E on 离开 to close and resume gameplay.
5. [AC6] `git diff --stat` shows only `src/entities/ShopOverlay.ts` changed; `npm run typecheck`
   passes.
