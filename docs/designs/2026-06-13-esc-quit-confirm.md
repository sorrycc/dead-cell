# ESC Quit-to-Title Confirmation Prompt

## 1. Background

During gameplay (`GameScene`), pressing **ESC** immediately quits to the Title
("main") screen and discards the in-progress run, with no confirmation. The
handler is a labelled dev shortcut:

```
// src/scenes/GameScene.ts:540
this.input.keyboard!.once('keydown-ESC', () => this.scene.start('Title'))
```

A single stray ESC throws away an entire run. This change gates that quit behind
a modal confirmation, reusing the game's established choice-overlay idiom.

## 2. Requirements Summary

**Goal:** Gate the in-gameplay ESC-to-quit shortcut behind a modal confirmation
so a single ESC press can no longer accidentally discard an in-progress run.

**Scope (in):** The single in-gameplay quit path at `GameScene.ts:540`. ESC now
opens a modal confirm prompt over a frozen `GameScene`; quitting requires an
explicit affirmative; cancelling resumes the run. ESC must be re-armable for the
whole run.

**Scope (out):** `GameOverScene` (`:92`) and `VictoryScene` (`:86`) — these go to
the **Hub** as deliberate end-of-run continue flows, not player quits, and stay
un-gated. The Hub has no ESC→Title path. No new run-state cleanup (`GameScene`
fully re-creates per run; `RunState` is rebuilt in `create()` at `:299`).

## 3. Acceptance Criteria

1. Pressing ESC during gameplay opens a modal confirm prompt and does NOT
   immediately quit to Title.
2. While the prompt is open, gameplay is frozen: player, enemies, projectiles,
   and combat do not update, and the fast-clear level timer is paused (matching
   shop/mutation modal behaviour).
3. The prompt offers an explicit affirmative action (a key other than ESC) that
   quits to the Title screen, landing in exactly the state the current ESC
   produces (`scene.start('Title')`, in-progress run discarded).
4. Pressing ESC again while the prompt is open cancels it: the prompt closes, the
   world unfreezes, the level timer resumes, and the run continues unaffected.
5. After cancelling, pressing ESC again re-opens the prompt — every time, with no
   degradation.
6. ESC continues to work across level transitions: after a `_buildLevel` rebuild
   (new level in the same run), ESC still opens the prompt (handler is persistent,
   not `.once`).
7. Confirming the quit performs no additional state cleanup and does not leak run
   state into the next run (a subsequent new run from the Hub starts fresh).
8. While the prompt is open, the keys it owns do not collide with the gameplay
   input bus (no accidental buys/heals/movement), consistent with the existing
   overlays' input-ownership handling.

## 4. Problem Analysis

- **Approach A — inline UI in `GameScene`** (draw rectangles/text directly in the
  scene, gate on a flag). -> Rejected: duplicates the dim/panel/cursor/keyboard
  bookkeeping the two existing overlays already encapsulate; bloats the scene.
- **Approach B — a parallel Phaser `Scene` for the prompt.** -> Rejected: a
  parallel scene needs its own input plumbing + a pause handshake; the codebase
  explicitly rejected this for the shop/mutation overlays (see `ShopOverlay`
  header) in favour of a self-contained UI object over a frozen scene.
- **Chosen approach — a `QuitConfirmOverlay` entity** mirroring `MutationOverlay`
  / `ShopOverlay`: a camera-fixed primitives-and-text modal that `GameScene` news
  up, while `GameScene` freezes gameplay via a new `quitConfirmOpen` boolean
  update-gate. -> Wins: DRY with the proven idiom, decoupled (overlay knows
  nothing about `RunState`), and the freeze/timer-pause plumbing already exists.

## 5. Decision Log

**1. Where does the confirm UI live?**
- Options: A) inline in `GameScene` · B) parallel Scene · C) a `QuitConfirmOverlay` entity
- Decision: **C)** — mirrors `MutationOverlay`/`ShopOverlay`; DRY, decoupled, primitives-only.

**2. Interaction model**
- Options: A) cursor-driven 2-row Yes/No menu (like the mutation picker) · B) direct Y/N keys
- Decision: **A)** — reuses the exact list-picker idiom (UP/DOWN move, E/SPACE/ENTER
  confirm the selected row); no new single-purpose keybindings. The cursor
  **defaults to the safe "Resume" row** (index 0), so hammering confirm resumes,
  never quits. Quitting requires a deliberate move-to-Quit + confirm (satisfies
  AC3: affirmative is a non-ESC action).

**3. ESC ownership (who handles the second ESC?)**
- Options: A) overlay binds ESC to cancel · B) `GameScene` owns a persistent ESC toggle
- Decision: **B)** — `GameScene` replaces its `.once('keydown-ESC')` with a
  persistent `.on('keydown-ESC')` that toggles: open when closed (and no other
  modal / not gameover / not transitioning), cancel-resume when open. ONE handler
  reading current state gives "second ESC cancels" cleanly. The overlay
  deliberately does NOT bind ESC (same rule `MutationOverlay` documents at its
  header), so the two never fight.

**4. Confirm action / cleanup**
- Options: A) `scene.start('Title')` exactly as today · B) plus explicit run reset
- Decision: **A)** — verified no stale-state leak: `GameScene` fully re-creates per
  run and rebuilds `RunState` in `create()` (`:297-299`); a Hub `START RUN` does
  `scene.start('Game', { seed })` (`HubScene.ts:207`). Pure gating, no new cleanup
  (KISS/YAGNI).

**5. Handler lifetime**
- Options: A) keep `.once` · B) persistent `.on`
- Decision: **B)** — `.once` fires one time only (fine today because the scene tore
  down immediately, broken once a cancel path exists). Registered once in
  `create()`, a `.on('keydown-ESC')` survives `_buildLevel` rebuilds (which rebuild
  only the world, not the scene/handlers), satisfying AC5/AC6.

**6. Resume-frame input leak (the close→reopen race)**
- Options: A) ignore · B) consume only the interact (E) edge · C) consume BOTH the
  interact (E) AND jump (SPACE) edges on resume
- Decision: **C)** — the cursor defaults to RESUME and the help line advertises
  SPACE, so "open, press SPACE to dismiss" is the *primary* resume path; without a
  guard the SPACE press leaks a jump the instant the world unfreezes — a direct
  AC8 violation ("no accidental movement"), not a tolerable edge. So
  `_closeQuitConfirm` calls BOTH `this.input2.consumeInteract()` (the shop's exact
  E-edge fix, `GameScene.ts:2114-2117`) AND a NEW `this.input2.consumeJump()`
  (mirroring `consumeInteract` — `Phaser.Input.Keyboard.JustDown(this.keys.space)`).
  ENTER is unbound in `Input`, so it needs no consume. The QUIT path doesn't route
  through `_closeQuitConfirm`, but it does `scene.start('Title')` which tears down
  `GameScene` (no further `sample()`), and `TitleScene` uses `.once` keydown
  events (not JustDown polling), so a confirm-key press never leaks there either.

**7. Visual identity**
- Options: A) reuse a sibling frame colour · B) a distinct quit-red frame
- Decision: **B)** — a red/amber frame (`0xe06c75`) distinguishes the destructive
  quit prompt from shop-purple and mutation-green (the codebase already
  colour-codes overlays by purpose).

## 6. Design

### 6.1 `QuitConfirmOverlay` (new — `src/entities/QuitConfirmOverlay.ts`)

A trimmed sibling of `MutationOverlay`: a camera-fixed modal (dim backdrop +
bordered panel + title + subtitle + two selectable rows + help line), primitives
and text only. It is handed two callbacks and owns nothing about run state:

```ts
interface QuitConfirmOverlayOpts {
  onQuit(): void    // GameScene → scene.start('Title')
  onCancel(): void  // GameScene → _closeQuitConfirm() (unfreeze + resume timer)
}
```

- **Rows:** index 0 = `t('quit.resume')` (RESUME RUN), index 1 = `t('quit.confirm')`
  (QUIT TO MENU). `cursor` starts at **0** (safe default).
- **Row colours are FIXED by semantics, NOT by selection** (this is the key
  divergence from `MutationOverlay._render`, which tints the *selected* name with
  the frame colour — copying that verbatim would paint the safe RESUME row red
  when it is the default selection, inverting Decision 7). RESUME text is always
  green `#58d68d` (the "go/safe" colour, e.g. `TitleScene.ts:48`); QUIT text is
  always red `#e06c75` (destructive, matching the frame). Selection is shown only
  by the highlight bar.
- **`cursorBar`** is a neutral dark-slate highlight (`0x2c3e50`, the same
  `CURSOR_COLOR` `ShopOverlay` uses) drawn behind the selected row. `_render()`
  ONLY repositions it (`cursorBar.y = rowBaseY + cursor * ROW_H`); it never
  recolours the row text. So RESUME stays green and QUIT stays red regardless of
  which is selected.
- **Keyboard handlers** (registered in ctor, removed in `_teardown`, on the
  Phaser event bus — separate from `Input`'s JustDown reads, the same idiom the
  other overlays use): `keydown-UP`/`keydown-W` → move(-1), `keydown-DOWN`/
  `keydown-S` → move(+1), `keydown-E`/`keydown-SPACE`/`keydown-ENTER` → confirm.
- **`_confirm()`** ALWAYS tears down first on BOTH rows (so a second press can't
  double-fire and the overlay's own keyboard handlers are removed), then calls
  `onCancel()` if cursor is on row 0 else `onQuit()` — matching
  `MutationOverlay._confirm`.
- **Does NOT bind ESC** — `GameScene` owns it.
- **`close()`** = `_teardown()` only (no callback), for `GameScene`'s defensive
  teardown path (mirrors `MutationOverlay.close()`). Idempotent via a `_destroyed`
  guard, so calling it after a `_confirm()` self-teardown is a no-op.

### 6.2 `GameScene` changes

**Field init** (near `:358-362`, beside `shopOpen`/`mutationOpen`):

```ts
this.quitConfirmOpen = false
this.quitConfirmOverlay = null
```

**ESC handler** — replace the `.once` at `:540`. Store the bound handler so the
SHUTDOWN hook can remove it:

```ts
// ESC → confirm-quit toggle. Persistent (.on) so it re-arms for the whole run,
// surviving _buildLevel rebuilds. Owns the second-ESC cancel (the overlay never
// binds ESC). Guarded so it never stacks on another modal / a death / a transition.
this._onEsc = () => this._toggleQuitConfirm()
this.input.keyboard!.on('keydown-ESC', this._onEsc)
```

**SHUTDOWN hook** — beside the existing HUD-stop listener at `:537` (the ONLY
SHUTDOWN listener; `_teardownLevel` at `:1053` is the per-level *rebuild* path,
called only from `_nextLevel`, NOT scene shutdown). On `scene.start('Title')`
(the QUIT path) Phaser does NOT auto-clear keyboard handlers registered via
`this.input.keyboard.on(...)`, so the persistent ESC handler must be removed
explicitly or it leaks into the next scene/run:

```ts
this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
  this.input.keyboard!.off('keydown-ESC', this._onEsc)   // remove the persistent ESC .on
  if (this.quitConfirmOverlay) { this.quitConfirmOverlay.close(); this.quitConfirmOverlay = null }
  this.quitConfirmOpen = false
})
```

**New methods** (beside the shop methods):

```ts
_toggleQuitConfirm(): void {
  if (this.quitConfirmOpen) { this._closeQuitConfirm(); return }
  if (this.gameOver || this.transitioning || this.shopOpen || this.mutationOpen) return
  this._openQuitConfirm()
}

_openQuitConfirm(): void {
  if (this.quitConfirmOpen || this.quitConfirmOverlay) return  // parity with _offerMutation (:2219)
  this.quitConfirmOpen = true
  this._pauseLevelTimer()              // exclude frozen prompt time from the fast-clear window
  this.player.body.setVelocity(0, 0)   // don't drift under the frozen modal (like the shop)
  this.quitConfirmOverlay = new QuitConfirmOverlay(this, {
    onQuit: () => this.scene.start('Title'),
    onCancel: () => this._closeQuitConfirm(),
  })
}

_closeQuitConfirm(): void {
  if (!this.quitConfirmOpen) return
  if (this.quitConfirmOverlay) { this.quitConfirmOverlay.close(); this.quitConfirmOverlay = null }
  this.quitConfirmOpen = false
  this.input2.consumeInteract()        // swallow a pending E edge → no shop-reopen race
  this.input2.consumeJump()            // swallow a pending SPACE edge → no jump-on-resume (AC8)
  this._resumeLevelTimer()
}
```

**Teardown ordering, stated precisely (corrects an earlier muddled note):**

- **QUIT row** (cursor on index 1, confirm key): `QuitConfirmOverlay._confirm()`
  self-tears-down first — its `kb.off(...)` removes the overlay's own UP/DOWN/E/
  SPACE/ENTER handlers — THEN calls `onQuit()` → `scene.start('Title')`. The
  SHUTDOWN hook above removes the persistent ESC `.on`. `_closeQuitConfirm` is NOT
  on this path.
- **RESUME row** (cursor on index 0, confirm key): `_confirm()` self-tears-down,
  then `onCancel()` → `_closeQuitConfirm()` (its `close()` is a no-op against the
  already-destroyed overlay — the `_destroyed` guard).
- **ESC-to-cancel** (`GameScene` owns the key, the overlay did NOT self-teardown):
  `_toggleQuitConfirm` → `_closeQuitConfirm()` → `overlay.close()` removes the
  overlay handlers. This is the path where `_closeQuitConfirm`'s `close()` does the
  real teardown.

**Freeze gates** — add the flag to the two existing modal gates:

```ts
// :2468
const gdt = this.hitstopTimer > 0 || this.shopOpen || this.mutationOpen || this.quitConfirmOpen ? 0 : dt
// :2479
if (!this.gameOver && !this.transitioning && !this.shopOpen && !this.mutationOpen && !this.quitConfirmOpen) {
```

(`playerHitboxes`/`projectilePool`/`deployables` already tick on `gdt`, so they
freeze automatically when `gdt` is 0. `M`-mute stays on real dt, unchanged.)

(The SHUTDOWN hook in the ESC-handler subsection above is the authoritative
teardown — it covers the QUIT-path `scene.start('Title')`. The per-level
`_teardownLevel` rebuild path does NOT need a quit-overlay guard: the overlay
freezes the world so the exit door can't fire, and `_toggleQuitConfirm` guards on
`this.transitioning`, so the overlay and a level transition can never coexist.)

### 6.3 i18n (`src/i18n/en.ts` + `src/i18n/zh-CN.ts`)

New `ui` keys (English source + zh-CN override):

- `quit.title` — `QUIT TO MAIN MENU?` / `退出到主菜单？`
- `quit.subtitle` — `Your current run will be lost.` / `当前这局进度将丢失。`
- `quit.resume` — `RESUME RUN` / `继续游戏`
- `quit.confirm` — `QUIT TO MENU` / `退出到菜单`
- `quit.help` — `UP/DOWN select · E/SPACE/ENTER confirm · ESC resume` /
  `上/下 选择 · E/SPACE/ENTER 确认 · ESC 继续`

### 6.4 Why the quit→Title transition is leak-free

`TitleScene` registers `.once('keydown-SPACE'/'keydown-ENTER')` + `pointerdown`
fresh in `create()` (`TitleScene.ts:59-61`). The confirm keypress fires on
`GameScene`'s keyboard while `GameScene` is still active; `scene.start('Title')`
is deferred, so `TitleScene`'s fresh handlers never receive the already-dispatched
event, and a held key does not re-fire `keydown`. The overlay is keyboard-only
(no pointer), so Title's `pointerdown` is untouched. No double-chain to the Hub.

## 7. Files Changed

- `src/entities/QuitConfirmOverlay.ts` — **new**; the confirm modal (camera-fixed
  primitives + text, two semantically-coloured rows, neutral cursor bar,
  overlay-owned keyboard handlers, `onQuit`/`onCancel`).
- `src/scenes/GameScene.ts` — replace the `.once('keydown-ESC')` quit with a
  persistent `.on` toggle stored on `this._onEsc`; add a real
  `Phaser.Scenes.Events.SHUTDOWN` listener (beside the HUD-stop at `:537`) that
  removes the ESC handler + force-closes a dangling overlay; add
  `quitConfirmOpen`/`quitConfirmOverlay` fields,
  `_toggleQuitConfirm`/`_openQuitConfirm`/`_closeQuitConfirm`; extend the two
  freeze gates (`:2468`, `:2479`); import the overlay.
- `src/core/Input.ts` — add `consumeJump()` (mirrors `consumeInteract` at `:160` —
  `Phaser.Input.Keyboard.JustDown(this.keys.space)`) so the resume frame swallows
  a pending SPACE edge.
- `src/i18n/en.ts` — add the five `quit.*` UI strings.
- `src/i18n/zh-CN.ts` — add the five `quit.*` zh-CN overrides.

## 8. Verification

1. [AC1] Run the game, enter a run, press ESC mid-level → the confirm panel
   appears; the player does not return to Title.
2. [AC2] With the panel up, watch a nearby enemy + any live projectile → both are
   frozen; the HUD fast-clear timer does not advance.
3. [AC3] Press DOWN to select QUIT TO MENU, press SPACE/ENTER/E → Title screen
   shows; starting a fresh run from the Hub behaves normally.
4. [AC4] Re-enter a run, press ESC, then ESC again → panel closes, world resumes,
   timer continues; player unharmed.
5. [AC5] Press ESC / cancel / ESC / cancel several times → the panel opens every
   time.
6. [AC6] Reach the exit door to rebuild the next level, then press ESC → the panel
   still opens.
7. [AC7] Quit to Title, START RUN again → new run starts at depth 0 with fresh HP
   (no leaked gold/mutations/seed).
8. [AC8] (a) Open the panel while standing on a vendor tile, leave cursor on
   RESUME, confirm with E → the shop does NOT instantly open (interact edge
   consumed). (b) Open the panel on flat ground, confirm RESUME with SPACE → the
   player does NOT jump on the resume frame (jump edge consumed). No accidental
   heal/buy/movement fires on resume.
9. `npm run typecheck` passes; `npm run verify` (generator determinism) still
   passes (no change to pure/world modules).
