# F1 Onboarding & Build UI

## 1. Background

The game is only playable by the author today: there is **no controls help
anywhere**. The Title screen shows `title.start` ("Press SPACE / ENTER or click
to ENTER HUB") and nothing else; the only key reference in the whole game is the
tiny camera-fixed dev hint at `GameScene.ts:589` (`game.hint`), which is cramped,
bottom-left, and easy to miss. A new player cannot discover JUMP/ATTACK/DODGE/
PARRY/FLASK/SKILLS/SWAP/INTERACT.

There is also no way to **inspect the live build** mid-run (the HUD shows it
piecemeal, but not all at once and not while frozen), and the level **exit Door**
can be off-camera with no indication of which way to go.

This feature is pure UI / onboarding. It changes **no gameplay**: it adds a
controls reference on Title, a PAUSE overlay (P) that freezes the world and shows
the full live build + controls, and a cosmetic off-screen edge arrow pointing at
the Door.

## 2. Requirements Summary

**Goal:** Make the game self-explanatory for a first-time player.

**Scope (in):**
- **(a) Title controls reference** — a two-column key-binding panel on
  `TitleScene`, below the subtitle, fully localized.
- **(b) PAUSE overlay (P)** — a new `PauseOverlay` entity mirroring
  `QuitConfirmOverlay`/`ShopOverlay`: a camera-fixed modal over a **frozen**
  `GameScene` that shows the **full live BUILD** (equipped weapon(s) with affix +
  rarity, skills + cooldown state, mutations, colour levels, flasks, depth·biome,
  run seed) **plus the controls list**. P toggles it open/closed; opening freezes
  gameplay (the existing modal `gdt` gate) and pauses the fast-clear timer;
  closing resumes cleanly without burning timer time.
- **(c) Off-screen EXIT indicator** — a small edge arrow drawn by `HUDScene`
  pointing toward the Door when it is off-camera. Hidden when the Door is
  on-screen and in boss rooms (no Door).

**Scope (out):** No new keybindings beyond **P** (the one-shot pause edge). No
gameplay/balance change. No new config table (this is pure UI — see §4). No
controls remapping. No mouse-driven pause UI (keyboard-only, like every other
overlay). The PAUSE overlay is **read-only** (no actions, unlike the shop): P or
ESC closes it; there is nothing to confirm.

## 3. Acceptance Criteria

1. The Title screen shows **every** key binding (MOVE, JUMP, DOUBLE/WALL-JUMP,
   ATTACK, DODGE, PARRY, FLASK, SKILL 1/2, SWAP, INTERACT, PAUSE, QUIT),
   localized in both `en` and `zh-CN`, in a readable two-column layout.
2. Pressing **P** during gameplay opens the PAUSE overlay and freezes the world:
   player, enemies, projectiles, deployables and combat do not update; the
   fast-clear level timer is paused (matching the shop/mutation/quit modals).
3. The PAUSE overlay shows the player's **full live build**: equipped weapon
   (active, with affix + rarity if any) and the second slot when present; both
   skill slots (name + ready/cooling state) or "—" when empty; the active
   mutations list (or a "none" line); the three colour levels (Brutality /
   Tactics / Survival) with the equipped colour highlighted; flasks `n/max`;
   `DEPTH n · BIOME`; and the run seed.
4. The PAUSE overlay also shows the full controls list (same content as Title).
5. Pressing **P** again (or **ESC**) while paused closes the overlay, unfreezes
   the world, resumes the level timer, and the run continues unaffected — with no
   leaked jump/heal/buy/movement on the resume frame.
6. After closing, pressing P again re-opens it — every time, with no degradation;
   it survives `_buildLevel` rebuilds (persistent handling, not `.once`).
7. PAUSE is gated like the other modals: it does not open during a death, a level
   transition, or while another modal (shop/mutation/colour/biome-choice/quit) is
   already up.
8. When the exit Door is **off-camera** on a normal level, `HUDScene` draws a
   small arrow at the nearest screen edge pointing toward the Door's world
   position. When the Door is on-screen, the arrow is hidden. In **boss rooms**
   (no Door) the arrow is always hidden.
9. **Additive identity:** a default run with PAUSE never pressed plays
   **byte-identically** to before this change (the overlay defaults closed; the
   arrow is cosmetic and registry-driven; no gameplay state is touched).
10. `npm run typecheck`, `npm run verify` (generator determinism) and the build
    are all green.

## 4. Problem Analysis

- **A new config table?** -> Rejected (YAGNI). The controls list and the build
  read are pure presentation. The controls are fixed strings (i18n `ui` keys);
  the build is already fully readable from the live `Player` + `RunState` +
  registry. No seeded pool, no monotone curve, no node-importable contract — so
  **no `config/*.ts` table and no `verify-gen.mjs` sweep** are warranted (the
  invariant-2/4 obligations simply do not apply: nothing new feeds a seeded run
  pool or a difficulty curve).
- **PAUSE overlay: inline-in-scene vs parallel Scene vs entity overlay.** ->
  Chosen the **entity overlay** mirroring `QuitConfirmOverlay`/`ShopOverlay` — a
  camera-fixed primitives-and-text modal `GameScene` news up, gated by a new
  `pauseOpen` boolean in the **existing** `gdt`/update freeze pattern. DRY with
  the proven idiom; the freeze + timer-pause plumbing already exists
  (`_pauseLevelTimer`/`_resumeLevelTimer`). Inline duplicates the
  dim/panel/keyboard bookkeeping; a parallel Scene needs its own input plumbing +
  pause handshake (the codebase already rejected that for the other overlays).
- **How does the overlay read the build?** -> Via **callbacks** handed in by
  `GameScene` (the `ShopOverlay.getGold` idiom), NOT by reaching into `RunState`/
  `Player` (SOLID/decoupled). `GameScene` already owns the exact label builders:
  `_weaponLabel()`/`_weaponSlotLabel()` (weapon + affix + rarity, two-slot
  aware), `_skillLabel(slot)`/`_skillCooldownFrac(slot)`, and the run fields
  (`runState.mutations`, `brutalityLevel`/`tacticsLevel`/`survivalLevel`,
  `flasks`/`maxFlasks`, `depth`, `biome()`, `runSeed`). The overlay receives ONE
  `getBuild()` snapshot callback returning a plain object, so the build logic
  stays in the scene (one source of truth).
- **Off-screen arrow: where to draw it?** -> In **`HUDScene`** (the decoupled
  parallel overlay that already reads everything from the registry). `GameScene`
  publishes the Door world position + on/off state to the registry each frame;
  the HUD reads it + the main camera scroll to compute the edge point and angle.
  No coupling, mirrors the boss-HP-bar registry pattern.
- **Pause key edge.** -> Add a one-shot `pausePressed` edge on **P** to `Input`,
  mirroring the existing `JustDown` edges (P is free — not in the addKeys map).
  `GameScene` reads it on **real dt** (like the M-mute toggle) so it works even
  while paused (to close).

## 5. Decision Log

**1. Where does the PAUSE UI live?**
- Options: A) inline in `GameScene` · B) parallel Scene · C) a `PauseOverlay` entity
- Decision: **C)** — mirrors `QuitConfirmOverlay`/`ShopOverlay`; DRY, decoupled,
  primitives-only, reuses the existing freeze gate + timer pause.

**2. Pause key + edge ownership**
- Options: A) reuse ESC (already taken by quit) · B) a new P edge in `Input`
- Decision: **B)** — add `pausePressed` (a `JustDown(keys.p)` one-shot edge,
  sole-owned in `Input.sample()` like every other edge; P added to `addKeys`).
  ESC is already the quit toggle (`GameScene._onEsc`), so reusing it would
  double-handle. The overlay binds its OWN `keydown-P` / `keydown-ESC` close
  handlers on the Phaser event bus (separate from `Input`'s JustDown, the
  shop/quit idiom) so closing never fights the edge.

**3. Open/close ownership (who handles the second P / the ESC-close?)**
- Options: A) `GameScene` owns a persistent `.on('keydown-P')` toggle (the ESC
  idiom) · B) `GameScene` opens on the `pausePressed` edge; the overlay owns its
  own close keys
- Decision: **B)** — `GameScene` reads `input2.sample().pausePressed` on real dt
  and opens when not already paused + not gated. The overlay (like
  `QuitConfirmOverlay`) registers its OWN `keydown-P` and `keydown-ESC` handlers
  that fire `onClose`, removed on teardown. Why not the persistent-ESC toggle
  pattern? Because the open trigger is an `Input` edge (P), and `pausePressed`
  must be read in `update()` anyway; routing close through the overlay's own bus
  keeps the read-once-per-frame `JustDown` invariant intact (no second consumer of
  the P key). **ESC-close + the quit double-fire (review BLOCKER #2):** the overlay
  binds `keydown-ESC` (→ `onClose`), but `GameScene._onEsc` is ALSO a persistent
  `keydown-ESC` listener on the SAME emitter, so one ESC press fires BOTH: the
  overlay closes pause (`_closePause` → `pauseOpen = false`) AND `_toggleQuitConfirm`
  runs. The earlier claim that `_toggleQuitConfirm` "already guards on `pauseOpen`"
  was WRONG — its guard set was `gameOver / transitioning / shopOpen / mutationOpen
  / colorPickOpen / biomeChoiceOpen` with NO `pauseOpen`, so it would see
  `quitConfirmOpen = false` (+ pause now closing) and pop the quit modal right
  after closing pause. **Fix:** add `this.pauseOpen` to the `_toggleQuitConfirm`
  guard set (matching the `_togglePause` gate in §6.5) so ESC-while-paused only
  closes pause and can never stack the quit confirm. This edit is listed in §8.

**4. Read-only overlay (no actions)**
- Options: A) cursor + rows (shop/quit idiom) · B) a static read-only panel
- Decision: **B)** — there is nothing to select or confirm; it is an information
  panel. No cursor bar, no UP/DOWN, no confirm rows. Just close (P/ESC). KISS.

**5. How the overlay reads the build**
- Options: A) overlay imports `RunState`/`Player`/`WEAPONS` · B) `GameScene`
  hands in a `getBuild()` snapshot callback
- Decision: **B)** — `getBuild()` returns a plain object built from the scene's
  existing label helpers (`_weaponLabel`/`_weaponSlotLabel`/`_skillLabel`/
  `_skillCooldownFrac`) + `runState`. The overlay is decoupled (it knows nothing
  about run state), exactly like `ShopOverlay.getGold`. The build is rendered ONCE
  on open (the world is frozen, so it cannot change while paused — no per-frame
  re-read needed; KISS).

**6. Controls list = ONE shared source**
- Options: A) duplicate the controls text in Title and the overlay · B) one i18n
  block both consume
- Decision: **B)** — define the control rows as a fixed ordered list of
  `(label-key, keys-key)` i18n pairs; both `TitleScene` and `PauseOverlay` render
  the SAME list. DRY: adding/renaming a control touches one i18n block. Each row
  is a localized **action label** + a localized **key glyphs** string.

**7. CJK column alignment for the two-column controls**
- Options: A) `padEnd` char-count padding · B) two fixed-x Text columns per row
- Decision: **B)** — the action label and the key string are each their own
  fixed-x Text (the `ShopOverlay`/Hub alignment discipline). `padEnd` only aligns
  under a monospace font; the CJK fallback is proportional, so char-count padding
  drifts. Two fixed-x columns stay pixel-anchored (invariant 6).

**8. Off-screen arrow location + math**
- Options: A) draw in `GameScene` (world space) · B) draw in `HUDScene` from the
  registry (screen space)
- Decision: **B)** — `GameScene._emitHud` publishes `doorActive` (bool),
  `doorX`, `doorY` (world center). `HUDScene` reads them + `main` camera
  `scrollX`/`scrollY`/`width`/`height`, computes the Door's screen position,
  and — when off-screen — clamps a point to the viewport edge (with a small
  inset) and rotates a small triangle/arrow to point along
  `atan2(doorScreenY - cy, doorScreenX - cx)`. On-screen → hide; `doorActive`
  false (boss room / no door) → hide. Pure primitives (a `Phaser.GameObjects.
  Triangle` or a rotated Text glyph), no assets (invariant 5).

**9. Pause-frame input leak on resume — the P close→reopen race (review BLOCKER #1)**
- Options: A) ignore · B) consume the pending P edge on close
- Decision: **B) — `Input.consumePause()` called in `_closePause()`.** The earlier
  "no consume needed" reasoning was WRONG, and the review correctly flagged it:
  `Input.sample()` calls `Phaser.Input.Keyboard.JustDown(keys.p)` EVERY frame, and
  Phaser dispatches keyboard EVENTS before `scene.update`, so on a CLOSE-press BOTH
  fire in the SAME frame: (1) the overlay's `keydown-P` → `onClose` → `_closePause`
  sets `pauseOpen = false`; (2) `GameScene.update` then runs `input2.sample()` →
  `JustDown(keys.p)` is STILL true → `pausePressed` → `_togglePause()` → re-opens
  (because `pauseOpen` is now false). This is the IDENTICAL close→reopen race that
  `consumeInteract()` (E) and `consumeJump()` (SPACE) exist to fix for the shop /
  quit resume paths. **Fix:** add `Input.consumePause()` (`JustDown(keys.p)`, the
  sole-owner idiom) and call it in `_closePause()` (mirroring `_closeQuitConfirm`'s
  `consumeJump`/`consumeInteract`) so the pending P edge is swallowed and a single
  close-press can never re-open pause. The overlay still binds NOTHING else (no
  SPACE/E/ENTER), so no other gameplay edge can leak on resume.

**10. Visual identity**
- Options: A) reuse a sibling frame colour · B) a distinct pause frame
- Decision: **B)** — a neutral/slate frame distinct from shop-purple,
  mutation-green, quit-red (the codebase colour-codes overlays by purpose). The
  build values reuse the HUD's existing semantic colours (cyan cells, gold gold,
  green flask, orange skills, colour-tinted pips) so the panel reads consistently.

## 6. Design

### 6.1 `Input` (`src/core/Input.ts`)

Add **P** to `addKeys` and a one-shot `pausePressed` edge to `InputSnapshot` and
`sample()`, mirroring `mutePressed`/`swapPressed`:

```ts
// in addKeys({...})
p: KC.P, // F1 onboarding — PAUSE / BUILD overlay (the only new key; outside the taken set).

// in sample()
const pausePressed = Phaser.Input.Keyboard.JustDown(keys.p) // sole-owned edge, like the others.
// ...add `pausePressed` to InputSnapshot + the returned object.
```

`P` is not currently bound (taken set: arrows/WASD/Space/J/Shift/K/Q/E/R/M/F/C/V
+ ESC handled outside `Input`), so it collides with nothing.

### 6.2 `PauseOverlay` (new — `src/entities/PauseOverlay.ts`)

A read-only sibling of `QuitConfirmOverlay`: a camera-fixed modal (dim backdrop +
bordered panel + title + build section + controls section + a close-hint line),
primitives and text only, depth band 200 (like the other overlays). It is handed
ONE callback and owns nothing about run state:

```ts
interface PauseOverlayOpts {
  getBuild(): BuildSnapshot   // GameScene → a plain snapshot (see §6.3)
  onClose(): void             // GameScene → _closePause() (unfreeze + resume timer)
}
```

- **No cursor, no rows, no confirm** (Decision 4) — it is informational.
- **Build section:** render the `BuildSnapshot` fields as fixed-x labelled lines
  (two-column where helpful), reusing the HUD's semantic colours. Skill slots
  show "ready" / "cooling" derived from the snapshot's `skill1Cd`/`skill2Cd`
  (a `█/░` gauge like `HUDScene._setSkillLabel`, or a simple "READY"/"…" tag).
  Mutations show the joined list or a localized "none". Colour levels show the
  three pips with the equipped colour bracketed (the HUD idiom).
- **Controls section:** render the shared ordered controls list (§6.4) as two
  fixed-x columns per row (action label | keys) — the CJK-safe layout
  (Decision 7).
- **Keyboard handlers** (registered in ctor, removed in `_teardown`, on the
  Phaser event bus — separate from `Input`'s JustDown): `keydown-P` → `onClose`,
  `keydown-ESC` → `onClose`. It binds NOTHING else (no SPACE/E/ENTER), so no
  resume-frame leak (Decision 9).
- **`close()`** = `_teardown()` only (no callback), for `GameScene`'s defensive
  SHUTDOWN/rebuild paths (mirrors `QuitConfirmOverlay.close()`). Idempotent via a
  `_destroyed` guard.

### 6.3 `BuildSnapshot` + `GameScene.getBuild()`

`GameScene._getBuildSnapshot()` (new) returns a plain object assembled from the
existing helpers (no new logic, no new label format):

```ts
interface BuildSnapshot {
  weapon: string        // this._weaponLabel()  (active + affix + rarity + bracketed 2nd slot)
  skill1: string; skill2: string         // this._skillLabel(0/1)
  skill1Cd: number; skill2Cd: number     // this._skillCooldownFrac(0/1)
  mutations: string     // runState.mutations mapped via tName('mutation', …).join(', ')  (or '')
  brutality: number; tactics: number; survival: number   // runState.*Level
  equippedColor: ColorId                  // this.player.equippedWeapon.scaling
  flasks: number; maxFlasks: number       // runState.flasks / maxFlasks
  depth: number; biome: string            // runState.depth / tName('biome', …)
  runSeed: number       // this.runSeed (the shareable run id, hex-formatted in the overlay)
}
```

All i18n resolution (`tName`) happens here (the scene boundary), matching
`_weaponLabel`/`_emitHud`. The overlay only formats + lays out.

### 6.4 Shared controls list (i18n)

Define an ordered list of `(actionKey, keysKey)` pairs consumed by BOTH
`TitleScene` and `PauseOverlay` (Decision 6). Suggested location: a small
exported `const CONTROLS_ROWS: readonly [string, string][]` in
`src/i18n/index.ts` (pure, no Phaser) OR a tiny shared module — keys only, the
text lives in `en.ts`/`zh-CN.ts`. Rows (action | keys):

| action key | keys key | en keys | zh keys |
| --- | --- | --- | --- |
| `controls.move` | `controls.move.keys` | `Arrows / WASD` | `方向键 / WASD` |
| `controls.jump` | `controls.jump.keys` | `Space (midair = double · vs wall = wall-jump)` | `空格（空中=二段跳 · 贴墙=蹬墙跳）` |
| `controls.attack` | `controls.attack.keys` | `J / Left-click` | `J / 左键` |
| `controls.dodge` | `controls.dodge.keys` | `Shift / K` | `Shift / K` |
| `controls.parry` | `controls.parry.keys` | `V` | `V` |
| `controls.flask` | `controls.flask.keys` | `Q` | `Q` |
| `controls.skill1` | `controls.skill1.keys` | `F` | `F` |
| `controls.skill2` | `controls.skill2.keys` | `C` | `C` |
| `controls.swap` | `controls.swap.keys` | `R` | `R` |
| `controls.interact` | `controls.interact.keys` | `E` | `E` |
| `controls.pause` | `controls.pause.keys` | `P` | `P` |
| `controls.mute` | `controls.mute.keys` | `M` | `M` |
| `controls.quit` | `controls.quit.keys` | `ESC` | `ESC` |

Plus chrome keys: `controls.title` ("CONTROLS" / "操作说明"), `pause.title`
("PAUSED — BUILD" / "暂停 — 构筑"), `pause.help` ("P / ESC to resume" /
"P / ESC 继续"), `pause.buildHeader` ("BUILD" / "构筑"),
`pause.weapon`/`pause.skills`/`pause.mutations`/`pause.colors`/`pause.flask`/
`pause.depth`/`pause.seed` build-section labels, and `pause.none`
("none" / "无") for an empty mutations/skill list.

### 6.5 `GameScene` changes

**Fields** (beside `quitConfirmOpen`/`quitConfirmOverlay`):

```ts
private pauseOpen!: boolean
private pauseOverlay!: PauseOverlay | null
```

Init in `create()` (beside the other modal flags): `this.pauseOpen = false;
this.pauseOverlay = null`.

**SHUTDOWN hook** (beside the existing HUD-stop / ESC-cleanup at `:597`): force-
close a dangling overlay + clear the flag, so a quit-while-paused never leaks:

```ts
if (this.pauseOverlay) { this.pauseOverlay.close(); this.pauseOverlay = null }
this.pauseOpen = false
```

**Open / close methods** (beside `_openQuitConfirm`/`_closeQuitConfirm`):

```ts
_togglePause(): void {
  if (this.pauseOpen) { this._closePause(); return }
  // gated exactly like _toggleQuitConfirm — never stack on another modal / death / transition.
  if (this.gameOver || this.transitioning || this.shopOpen || this.mutationOpen ||
      this.colorPickOpen || this.biomeChoiceOpen || this.quitConfirmOpen) return
  this._openPause()
}

_openPause(): void {
  if (this.pauseOpen || this.pauseOverlay) return     // parity with _openQuitConfirm
  this.pauseOpen = true
  this._pauseLevelTimer()                              // exclude frozen pause time from the fast-clear window
  this.player.body.setVelocity(0, 0)                  // don't drift under the frozen modal (like the others)
  this.pauseOverlay = new PauseOverlay(this, {
    getBuild: () => this._getBuildSnapshot(),
    onClose: () => this._closePause(),
  })
}

_closePause(): void {
  if (!this.pauseOpen) return
  if (this.pauseOverlay) { this.pauseOverlay.close(); this.pauseOverlay = null }
  this.pauseOpen = false
  this._resumeLevelTimer()
}
```

**`update()` freeze gate** — add `pauseOpen` to BOTH existing modal gates
(mirroring the quit-confirm wiring at `:3011` / `:3022`):

```ts
const gdt = this.hitstopTimer > 0 || this.shopOpen || this.mutationOpen ||
  this.colorPickOpen || this.biomeChoiceOpen || this.quitConfirmOpen || this.pauseOpen ? 0 : dt
// ...
if (!this.gameOver && !this.transitioning && !this.shopOpen && !this.mutationOpen &&
    !this.colorPickOpen && !this.biomeChoiceOpen && !this.quitConfirmOpen && !this.pauseOpen) {
```

**P edge** — read `inputState.pausePressed` on **real dt** (NOT inside the gated
block — like the M-mute toggle at `:3017`, so P toggles even while paused to
close):

```ts
if (inputState.pausePressed) this._togglePause()
```

(`playerHitboxes`/`projectilePool`/`deployables` already tick on `gdt`, so they
freeze when `gdt` is 0 — no extra wiring.)

**Door registry publish** — in `_emitHud()` add (the arrow source for `HUDScene`):

```ts
this.registry.set('doorActive', !!this.door)
if (this.door) {
  const r = (this.door as any).rect
  this.registry.set('doorX', r.x)
  this.registry.set('doorY', r.y)
}
```

Seed sane defaults in `create()`'s registry-seed block (beside `bossActive`):
`this.registry.set('doorActive', false)` (so the HUD never flashes a stale arrow
on a fresh run / boss room). `_buildBossLevel` leaves `this.door` null → the next
`_emitHud` publishes `doorActive: false` → arrow hidden (AC8).

### 6.6 `TitleScene` changes (`src/scenes/TitleScene.ts`)

Add a controls reference panel below the subtitle (under `cy + 20`, above the
`title.start` prompt at `cy + 110`, repositioning as needed so nothing overlaps).
A small `controls.title` header + the shared `CONTROLS_ROWS` rendered as two
fixed-x columns per row (Decision 7), positioned from `DESIGN_WIDTH`/
`DESIGN_HEIGHT` (never `window.innerWidth`, the existing Title discipline). Pure
primitives + Text via `t()` (i18n). No new input — the existing
SPACE/ENTER/click → Hub handlers are untouched.

### 6.7 `HUDScene` changes (`src/scenes/HUDScene.ts`)

Add an off-screen Door **edge arrow** (a `Phaser.GameObjects.Triangle` or a
rotated Text glyph, created hidden in `create()`, `setScrollFactor(0)`). In
`update()`, after the existing reads:

```ts
const doorActive = this.registry.get('doorActive') === true
if (!doorActive) { this.doorArrow.setVisible(false) }
else {
  const cam = this.scene.get('Game')?.cameras.main  // or read scrollX/scrollY via registry — see note
  const sx = doorX - cam.scrollX, sy = doorY - cam.scrollY
  const onScreen = sx >= 0 && sx <= cam.width && sy >= 0 && sy <= cam.height
  if (onScreen) this.doorArrow.setVisible(false)
  else { /* clamp (sx,sy) to viewport edge w/ inset; set arrow pos + rotation = atan2(...) */ }
}
```

**Note on camera access:** the HUD is decoupled (registry-only). Prefer
publishing `camScrollX`/`camScrollY` (and using the HUD's own `cameras.main.width/
height`, which equal the design size under Scale.FIT) to keep the HUD from
reaching into `GameScene`. `GameScene._emitHud` already runs every frame, so add
`this.registry.set('camScrollX', this.cameras.main.scrollX)` +
`'camScrollY'` there. This keeps invariant-7 decoupling intact.

The arrow is purely cosmetic and registry-driven, so it adds **zero** gameplay
coupling (AC9).

### 6.8 i18n (`src/i18n/en.ts` + `src/i18n/zh-CN.ts`)

Add the `controls.*` rows + chrome keys (§6.4) and the `pause.*` keys to BOTH
locales' `ui` blocks (invariant 6). English is the source; zh-CN overrides each
key. The two locales must stay in sync (every new `en.ui` key gets a `zh-CN.ui`
override). There is no automated i18n parity gate in `verify-gen.mjs`, so this
parity is a **manual obligation** — add the keys to both files in the same edit.

## 7. Invariant Compliance

- **Additive identity (1):** the overlay defaults closed (`pauseOpen = false`);
  the arrow defaults hidden (`doorActive` seeded false); no `RunState`/`Player`/
  config field is added or mutated. A run that never presses P and never sees the
  arrow is byte-identical (AC9). The only new state is UI-local
  (`pauseOpen`/`pauseOverlay`) and three new **read-only** registry keys
  (`doorActive`/`doorX`/`doorY`, plus optional `camScrollX/Y`) the HUD consumes.
- **Determinism pins (2) — N/A:** no new weapon/skill/mutation, nothing feeds a
  seeded run pool, no `blueprints.ts` entry needed. `runWeaponPool`/
  `runSkillPool`/`runMutationPool` are untouched.
- **Monotone (3) — N/A:** no scaling, cost, or difficulty curve added.
- **Pure config (4) — N/A:** no new `config/*.ts` table → **no new
  `verify-gen.mjs` sweep**. The only pure addition (the controls-rows key list,
  if placed in `i18n/index.ts`) imports nothing Phaser-coupled (it is keys/data
  only), preserving the headless import path.
- **Programmer-art (5):** dim rect + bordered panel + Text + a `Triangle`/glyph
  arrow. No external assets.
- **i18n (6):** all new UI text lands in BOTH `en.ts` and `zh-CN.ts` via `t()`;
  two-column layouts use fixed-x Text cells (CJK-safe), not `padEnd`.
- **DRY/KISS/YAGNI/SOLID (7):** reuses the `QuitConfirmOverlay`/`ShopOverlay`
  frozen-modal idiom, the `_pauseLevelTimer`/`_resumeLevelTimer` seam, the
  `getGold`-style callback decoupling, the HUD registry pattern, and the existing
  `_weaponLabel`/`_skillLabel` builders. One shared controls list. No new table.
- **Determinism / level pin (8) — N/A:** no seeded layout/scene-roll added.
- **No git worktrees (9):** edits land in the live working tree.

## 8. Files Changed

- `src/core/Input.ts` — add `p` to `addKeys`; add `pausePressed` to
  `InputSnapshot` + `sample()` (a sole-owned `JustDown(keys.p)` edge); add
  `consumePause()` (`JustDown(keys.p)`, the close→reopen-race fix — Decision 9).
- `src/entities/PauseOverlay.ts` — **new**; the read-only PAUSE/BUILD modal
  (camera-fixed primitives + text, build section + controls section, overlay-owned
  `keydown-P`/`keydown-ESC` close handlers, `getBuild`/`onClose`).
- `src/scenes/GameScene.ts` — import `PauseOverlay` (+ the `BuildSnapshot` type);
  add `pauseOpen`/`pauseOverlay` fields + init; add `_togglePause`/`_openPause`/
  `_closePause` (which calls `input2.consumePause()` — Decision 9) +
  `_getBuildSnapshot`; read `pausePressed` on real dt in `update()`; extend the two
  freeze gates with `pauseOpen`; **add `this.pauseOpen` to the
  `_toggleQuitConfirm` guard set** (the ESC double-fire fix — Decision 3);
  force-close the overlay in the SHUTDOWN hook; publish
  `doorActive`/`doorX`/`doorY` (+ `camScrollX`/`camScrollY`) in `_emitHud` and seed
  `doorActive: false` in the create() registry block.
- `src/scenes/TitleScene.ts` — add the localized two-column controls reference
  panel below the subtitle (shared `CONTROLS_ROWS`).
- `src/scenes/HUDScene.ts` — add the off-screen Door edge arrow (registry-driven;
  hidden on-screen / in boss rooms).
- `src/i18n/index.ts` — (optional) export the shared `CONTROLS_ROWS` key list
  (pure data, no Phaser).
- `src/i18n/en.ts` — add the `controls.*` + `pause.*` UI strings.
- `src/i18n/zh-CN.ts` — add the matching `controls.*` + `pause.*` zh-CN overrides.

## 9. Verification

1. [AC1] Launch → Title shows the CONTROLS panel with all bindings, two columns,
   readable. Switch language in the Hub, return to Title → localized.
2. [AC2/AC3/AC4] Enter a run, press P → the PAUSE/BUILD panel appears; a nearby
   enemy + any live projectile freeze; the HUD fast-clear timer does not advance.
   The panel shows weapon (+ affix/rarity if any, + bracketed 2nd slot), both
   skills (or "—"), mutations (or "none"), the three colour levels with the
   equipped one highlighted, flasks `n/max`, `DEPTH n · BIOME`, the run seed, and
   the controls list.
3. [AC5/AC6] Press P (then, separately, ESC) to close → world resumes, timer
   continues, player unharmed; re-press P repeatedly → opens every time; reach a
   door to rebuild the next level, press P → still opens.
4. [AC7] Open a shop / trigger a mutation or colour pick / open the quit confirm,
   then press P → pause does NOT open (gated). Open pause, press ESC → it closes
   (does not also pop the quit confirm).
5. [AC8] On a normal level with the door off-camera, an edge arrow points toward
   it; walk until the door is on-screen → the arrow disappears. Reach the boss
   room → no arrow at any time.
6. [AC9] Run with PAUSE never pressed and confirm gameplay/feel is unchanged;
   `npm run verify` determinism walk still passes (no pure/world module change).
7. [AC10] `npm run typecheck`, `npm run verify`, and the build are green.
