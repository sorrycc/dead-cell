# Fix: Shop never opens on E press (in-range flag reset ordering + close→reopen race)

## 1. Background

Pressing `E` while standing on the in-run vendor does nothing — the shop buy overlay never opens, so gold (dropped, collected, shown on the HUD) has no sink. The `[E] SHOP` prompt *does* appear, so the player believes they are interacting correctly, but the key is dead.

Making the shop openable then exposes a second, latent bug: the same `E` press that selects LEAVE on the overlay would immediately reopen the shop one frame later. Both are fixed here.

## 2. Requirements Summary

- **Goal:** `E` while overlapping the vendor opens the shop buy overlay; `E` on the LEAVE row closes it and leaves it closed (until a fresh `E` press).
- **Root cause #1 — the flag is reset before it is read (confirmed against live source + Phaser 3.90 internals):** `GameScene.update()` calls `this.shop.resetInRange()` at the **top** of the method (`GameScene.ts:2455`), which sets `shop.playerInRange = false`. But the Arcade physics `world.update()` — whose overlap callback sets `playerInRange = true` via `shop.markInRange()` (`GameScene.ts:1650-1656`) — is bound to the scene `UPDATE` event (`node_modules/phaser/src/physics/arcade/ArcadePhysics.js:142`), and `Systems.step` emits `UPDATE` **before** it calls `sceneUpdate` (`node_modules/phaser/src/scene/Systems.js:362-364`). So every frame the overlap sets the flag true, then the first line of `update()` clears it, and by the time `_tryOpenShop()` reads `this.shop.playerInRange` (`GameScene.ts:2468` → `:2077`) it is always `false`. The shop can never open.
- **Why the prompt still shows:** `Shop.resetInRange()` (`Shop.ts:84-87`) reads the flag to drive prompt visibility *before* zeroing it; the overlap had set it true earlier the same frame.
- **Root cause #2 — close→reopen race (latent; only reachable once root cause #1 is fixed):** The browser keyboard queue is processed by the global `InputManager` on `GameEvents.PRE_RENDER` (`InputManager.js:322`), which `Game.step` fires *after* `scene.update()` (`Game.js:498` then `:510`). In that pass `key.onDown()` sets `_justDown = true` (`Key.js:282`) **before** the `keydown-E` event is emitted (`KeyboardPlugin.js:795→801`). So a single `E` press on the LEAVE row, processed at frame P's `PRE_RENDER`, both (a) runs the overlay's `keydown-E` handler → `close()` → `shopOpen = false`, and (b) arms `JustDown(e)`. On frame P+1 the overlap re-sets `playerInRange = true` (its process callback `!shopOpen` now passes) and `Input.sample()` reads the pending `interactPressed` edge → `_tryOpenShop()` reopens the shop. Result: `E` cannot leave the shop (only SPACE/ENTER can).
- **Scope:** (1) Move the in-range reset so it runs after `_tryOpenShop()` reads the flag. (2) Consume the pending interact edge when the shop closes so the closing `E` cannot reopen it. (3) Correct the comments that encode the wrong "reset before physics" mental model.

## 3. Acceptance Criteria

1. Pressing `E` while overlapping the vendor (prompt visible) opens the shop buy overlay (`shopOpen` true, world frozen).
2. The `[E] SHOP` prompt shows only while the player overlaps the vendor; it is hidden otherwise and is not visible while the shop overlay is up.
3. Walking off the vendor clears the flag — `E` no longer opens the shop (no stale-true carry-over).
4. Selecting LEAVE with `E` closes the shop and it stays closed; gameplay resumes; a *fresh* `E` press reopens it. SPACE/ENTER on LEAVE behave identically.
5. On a level with no vendor (`this.shop === null`), `E` remains a harmless no-op.
6. `npm run typecheck` passes; the corrected comments accurately describe Phaser's `UPDATE`-before-`sceneUpdate` ordering and the close-edge consumption.

## 4. Problem Analysis

Phaser per-frame order. `Game.step` (`Game.js:490-510`): `PRE_STEP` → `STEP` → `scene.update()` → `POST_STEP` → `PRE_RENDER`. Within `scene.update()`, `Systems.step` (`Systems.js:360-366`) runs:

1. `PRE_UPDATE` event (InputPlugin.preUpdate)
2. `UPDATE` event -> `world.update()` integrates bodies and fires collider/overlap callbacks -> `shop.markInRange()` sets `playerInRange = true`
3. `sceneUpdate` -> `GameScene.update()` runs (`_tryOpenShop` reads the flag, `Input.sample()` reads `JustDown`)

Then, *outside* `scene.update()`, at `PRE_RENDER`, the global `InputManager` drains the browser key queue (`KeyboardPlugin.update` via `MANAGER_PROCESS`), setting `_justDown` and emitting `keydown-*` events. So both the `JustDown` edge and the overlay's `keydown-E` handler for a key pressed during frame P fire at frame P's `PRE_RENDER` — i.e. after that frame's `sceneUpdate`, and are consumed on frame P+1.

Reset-ordering (root cause #1):
- **Approach A — move `resetInRange()` to just after the gameplay-gated input block** (after `_tryOpenShop` reads the flag, before the per-frame hitbox/FX ticks) -> the overlap-set flag (step 2) survives until `_tryOpenShop()` reads it, then is cleared. `update()` runs 2436->2500 with **no early returns** (verified), and there is no throwing code between the read and this point. Chosen.
- **Approach B — register `resetInRange` on the `POST_UPDATE` event** -> also order-correct, but adds a persistent listener plus shutdown teardown for no benefit. Rejected (YAGNI).
- **Approach C — move it to immediately after the interact check (~line 2469)** -> works, but plants a fragile ordering dependency mid-method. Rejected; Approach A is nearly identical but reads as clear end-of-input cleanup.

Close→reopen race (root cause #2):
- **Approach A — consume the pending interact edge on close.** In `_closeShop()`, call a new `Input.consumeInteract()` that does `Phaser.Input.Keyboard.JustDown(keys.e)` (which clears `_justDown`). Because `_closeShop` runs inside the `keydown-E` handler at frame P's `PRE_RENDER`, *after* `onDown` armed the edge, the clear lands before frame P+1's `sample()`. Keeps `Input` the sole owner of `JustDown(keys.e)` (its documented invariant, `Input.ts:42-47`). A no-op when no E edge is pending (SPACE/ENTER close). Chosen.
- **Approach B — a "just closed this frame" guard flag on GameScene** checked in `_tryOpenShop` -> needs careful set/clear lifecycle across the close-frame boundary; more state than consuming the edge at its source. Rejected.

## 5. Decision Log

**1. Where to move the `resetInRange()` call so the flag survives until it is read?**
- Options: A) just after the gameplay-gated input block · B) `POST_UPDATE` event listener · C) just after the interact check at ~line 2469
- Decision: **A)** — KISS, minimal move, no new listeners or teardown. Safe because `GameScene.update()` (2436-2500) has no early returns and no throwing code sits between `_tryOpenShop` (line 2468) and this point. The flag now follows the correct lifecycle: set by the overlap (step 2) -> read by `_tryOpenShop` (step 3) -> cleared right after.

**2. Keep `resetInRange()` as the single call (prompt-visibility + reset together) or split it?**
- Options: A) keep the single call, just relocate it · B) split prompt-visibility from the flag reset
- Decision: **A)** — keep them together. Prompt visibility now reads the *current* frame's overlap result. Note the precise behavior: on the frame the shop *opens*, `resetInRange()` still runs with `playerInRange === true` and sets the prompt visible, but it is not seen because the `ShopOverlay` (depth 200, `ShopOverlay.ts:79-86`) occludes the vendor prompt (depth 5, `Shop.ts:60-64`); from the next frame on the overlap stops firing (process callback sees `shopOpen === true`) so the flag stays false and the prompt is hidden by flag logic. Prompt-hidden-while-open therefore depends on the overlay depth sitting above the prompt depth — a load-bearing invariant; if it is ever broken, a 1-frame prompt flash would show on open.

**3. Update the misleading comments?**
- Options: A) update them to match Phaser's real ordering · B) leave them
- Decision: **A)** — the comments at `GameScene.ts:2452-2454`, the `Shop.ts` header note, and `Shop.resetInRange()`'s doc all assert "reset before physics overlaps run." That false mental model is exactly what caused root cause #1; leaving it invites a regression. Mandatory.

**4. How to stop the closing `E` press from reopening the shop one frame later?**
- Options: A) consume the interact edge in `_closeShop` via a new `Input.consumeInteract()` · B) a "just-closed" guard flag checked in `_tryOpenShop` · C) bind ESC-to-close instead and tell players not to use E
- Decision: **A)** — consume the stale edge at its source. Minimal, keeps `JustDown(keys.e)` sole-owned by `Input`, and makes `E` leave behave identically to SPACE/ENTER (AC4). C is a UX regression (the help text advertises E); B duplicates state.

## 6. Design

Three edits across three files; all behavior-preserving except the two fixes.

1. **`GameScene.ts` — relocate the reset.** Remove `if (this.shop) this.shop.resetInRange()` from the top of `update()` (currently line 2455). Re-add it (keeping the `if (this.shop)` null guard — AC5) immediately after the gameplay-gated `if (!gameOver && ... && !shopOpen && ...)` block closes, before `this.playerHitboxes.tick(gdt)`. Replace the stale comment block (2452-2454) with an accurate note: the overlap callback already ran on the `UPDATE` event before `sceneUpdate`, so the flag must be read by `_tryOpenShop` before it is cleared; clear it here, after the only reader, for the next frame.

   Per-frame flag lifecycle while overlapping the vendor, shop closed:
   - step 2 (`UPDATE` event): process callback `!shopOpen && !transitioning && !gameOver` passes -> `markInRange()` -> `playerInRange = true`
   - step 3 (`update`): `if (inputState.interactPressed) this._tryOpenShop()` reads `playerInRange === true` -> `_openShop()`
   - step 3, after the gated block: `resetInRange()` -> sets `[E] SHOP` prompt visible, then `playerInRange = false`

   While the shop is open, the process callback returns false (`shopOpen` true), so `markInRange()` is not called, `playerInRange` stays false, and `resetInRange()` keeps the prompt hidden. When not overlapping, the flag is never set, so the reset keeps it false. No stale-true is possible because the reset runs every frame (no early returns).

2. **`Input.ts` — add `consumeInteract()`.** A one-liner that calls `Phaser.Input.Keyboard.JustDown(this.keys.e)` to clear any pending E down-edge, with a comment explaining the close→reopen race it prevents. This preserves the "Input is the SOLE owner of JustDown(keys.e)" invariant documented at `Input.ts:42-47` — GameScene never calls `JustDown` itself.

3. **`GameScene.ts` — call it on close.** In `_closeShop()`, after dropping the overlay handle, call `this.input2.consumeInteract()` so the `E` that selected LEAVE cannot reopen the shop on the next frame. No-op for SPACE/ENTER closes (no E edge pending).

4. **`Shop.ts` — correct the doc comments.** Update the class-header note ("the flag is RESET to false at the TOP of every GameScene.update before physics runs the overlaps") and `resetInRange()`'s doc comment ("GameScene calls this at the top of update, before the physics overlaps run") to state the truth: the reset runs *after* `_tryOpenShop()` has read the flag (just past the gameplay-gated block), because the Arcade overlap callback already fired on the `UPDATE` event earlier in the same frame.

No signature changes beyond the additive `consumeInteract()`. No new persistent state.

## 7. Files Changed

- `src/scenes/GameScene.ts` — move `if (this.shop) this.shop.resetInRange()` from the top of `update()` to just after the gameplay-gated block (keeping the null guard); rewrite the stale ordering comment; add `this.input2.consumeInteract()` in `_closeShop()`.
- `src/core/Input.ts` — add `consumeInteract()` that clears the pending E `JustDown` edge (preserves sole-ownership of the E edge).
- `src/entities/Shop.ts` — correct the class-header note and `resetInRange()` doc comment to describe the post-read reset and Phaser's `UPDATE`-before-`sceneUpdate` ordering.

## 8. Verification

1. [AC1] `npm run dev`, reach a level with the purple `$` vendor, stand on it, press `E` -> the SHOP overlay opens and the world freezes.
2. [AC2] The `[E] SHOP` prompt is visible only while standing on the vendor; it is not visible while the overlay is up (occluded + flag false from the second frame).
3. [AC3] Step onto the vendor then off, press `E` -> nothing happens (no overlay).
4. [AC4] Open the shop, move the cursor to LEAVE, press `E` -> the overlay closes and stays closed, gameplay resumes; the `[E] SHOP` prompt reappears; pressing `E` again reopens it. Repeat with SPACE and ENTER -> identical.
5. [AC5] On a level without a vendor, pressing `E` does nothing and throws no error.
6. [AC6] `npm run typecheck` passes; read the revised comments in all three files and confirm they describe the correct ordering and the close-edge consumption.
