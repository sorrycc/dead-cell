# HUB: ESC returns to the main screen

## 1. Background

The HUB (between-runs shop, `src/scenes/HubScene.ts`) is reachable from both the
Title screen (Title → Hub → Game) and GameOver (GameOver → Hub). Once in the
HUB the only forward exit is START RUN; there is no way back to the main screen
(TitleScene) without launching a run. `GameScene` already supports `ESC` → Title
(`src/scenes/GameScene.ts:540`). This change brings the HUB to parity: `ESC`
returns to the main screen.

## 2. Requirements Summary

- **Goal:** Pressing `ESC` while in the HUB returns to the main screen (TitleScene).
- **Scope:** One `keydown-ESC` handler in `HubScene.create()`; a footer-hint text
  update in both locales.
- **Out of scope:** Title/GameOver flow unchanged. ESC routes to Title regardless
  of how the Hub was entered — Title IS the "main screen".

## 3. Acceptance Criteria

1. Pressing `ESC` in the HUB transitions to the TitleScene (the main screen).
2. The behavior mirrors the existing `GameScene` convention (`keydown-ESC` →
   `scene.start('Title')`, bound with `.once`).
3. Existing HUB navigation (UP/DOWN/W/S move, SPACE/ENTER confirm) is unchanged.
4. The HUB footer hint mentions ESC, in both English and Chinese (zh-CN) locales.
5. The readiness check (`typecheck` + `build` + `verify`) passes.

## 4. Problem Analysis

- **Approach A — new dedicated "BACK" list row** → adds a synthetic row, shifts
  every row index, touches the cursor-math + render loop. Heavyweight for a "go
  back" affordance the rest of the app expresses as a key. Rejected (YAGNI).
- **Chosen approach — `keydown-ESC` handler** → one line in `create()`, mirrors
  the established `GameScene` ESC→Title convention. No row-index or render change.

## 5. Decision Log

**1. Where does ESC route?**

- Options: A) Title (main screen) · B) back to the entry scene (Title or GameOver)
- Decision: **A)** — the requirement says "main screen", which is TitleScene
  (`super('Title')`). B) would need to track the entry scene (state the Hub does
  not keep) for no stated benefit. KISS.

**2. `.once` vs `.on` for the handler?**

- Options: A) `.once` · B) `.on`
- Decision: **A)** — mirrors `GameScene.ts:540`. ESC starts a new scene (the Hub
  is torn down), so a single fire is correct and prevents a double transition.
  Note: the Hub also tears down + re-runs `create()` on `scene.restart()`
  (language toggle) and on START RUN, so the `.once` binding is always recreated
  fresh — it is never consumed-then-stale.

**3. Play a UI sound on ESC?**

- Options: A) no sound · B) `sfx.uiSelect()`
- Decision: **A)** — mirrors the existing `GameScene` ESC handler, which is
  silent. KISS; trivially reversible if a back-blip is wanted later.

**4. Advertise the key in the footer?**

- Options: A) update `hub.footer` (both locales) · B) leave footer as-is
- Decision: **A)** — the footer is the Hub's key legend; an undiscoverable exit
  is poor UX. Append "· ESC return" (en) / "· ESC 返回" (zh-CN).

## 6. Design

In `HubScene.create()`, alongside the existing keyboard bindings (after the
SPACE/ENTER confirm bindings, `src/scenes/HubScene.ts:177-178`), add:

```ts
// ESC → Title (main screen) — parity with GameScene (.once; Hub tears down).
this.input.keyboard!.once('keydown-ESC', () => this.scene.start('Title'))
```

This lands on the **same** TitleScene the GameScene ESC handler targets — no
Title-side change, no new edge introduced. The Title's existing SPACE/ENTER →
Hub re-entry is unchanged and is the established behavior.

Footer-hint i18n update:

- `src/i18n/en.ts` — `hub.footer`:
  `'UP/DOWN select · SPACE/ENTER buy or start'`
  → `'UP/DOWN select · SPACE/ENTER buy or start · ESC return'`
- `src/i18n/zh-CN.ts` — `hub.footer`:
  `'上/下 选择 · SPACE/ENTER 购买或开始'`
  → `'上/下 选择 · SPACE/ENTER 购买或开始 · ESC 返回'`

No row-index, cursor-math, or `_render` change — the footer is a static centered
Text built once in `create()` (`src/scenes/HubScene.ts:116-122`).

### Edge: re-render on language switch

The LANGUAGE row calls `this.scene.restart()` (`HubScene.ts:200`), which re-runs
`create()` and re-binds the ESC handler — no stale/duplicate binding. The footer
text is rebuilt from `t('hub.footer')` on restart, so the localized hint follows
the active locale automatically.

## 7. Files Changed

- `src/scenes/HubScene.ts` — add `keydown-ESC` → `scene.start('Title')` in `create()`.
- `src/i18n/en.ts` — append "· ESC return" to `hub.footer`.
- `src/i18n/zh-CN.ts` — append "· ESC 返回" to `hub.footer`.

## 8. Verification

1. [AC1/AC2] `npm run dev`, enter the HUB, press `ESC` → the TitleScene appears.
   Confirm the handler matches `GameScene.ts:540` (`.once`, `scene.start('Title')`).
2. [AC3] In the HUB, UP/DOWN/W/S still move the cursor and SPACE/ENTER still
   buy/cycle/start — unaffected.
3. [AC4] Footer reads "… · ESC return" (en) and "… · ESC 返回" (zh-CN), remains
   centered and fully on-screen (no clip) in both locales. Toggle the LANGUAGE
   row, confirm the hint localizes, then press ESC and confirm it still returns
   to Title (the restart re-binds the `.once` handler).
4. [AC5] `npm run typecheck && npm run build && npm run verify` all pass.
