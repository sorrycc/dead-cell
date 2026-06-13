# Fix: room-banner crash — `_levelObjects` init order in `_buildLevel()`

## 1. Background

Starting a run can crash immediately:

```
GameScene.js:1076 Uncaught TypeError: Cannot read properties of undefined (reading 'push')
    at GameScene._popRoomBanner (GameScene.js:1076)
    at GameScene._applyRoomType (GameScene.js:1007)
    at GameScene._buildLevel (GameScene.js:381)
    at GameScene.create (GameScene.js:336)
```

It reproduces only when the first level of a run rolls a *tagged* (non-`'normal'`) room
type — ELITE / HORDE / CURSED, etc. A `'normal'` roll has an empty `name`, so the banner
path is skipped (`GameScene.js:1007` — `if (this.roomType.name)`), which is why it is
intermittent.

## 2. Requirements Summary

Fix the crash. The room banner is intended behaviour on any non-miniboss level, including
level 1 — so the fix must let the banner render, not suppress it. Single-file, minimal,
KISS. The staged `Boss.js` / boss-status-parity changes are unrelated and out of scope.

## 3. Acceptance Criteria

1. Starting a run whose first level rolls a tagged room type no longer throws; the room
   banner renders.
2. `this._levelObjects` is initialized before `_applyRoomType(desc)` is called in
   `_buildLevel()`.
3. A tagged-room banner (created in `_popRoomBanner`) is tracked in `this._levelObjects`
   and destroyed on the next teardown/rebuild — no leaked banner `Text` objects across
   levels.
4. `_buildLevel()` initializes `_levelObjects` exactly once per build (no second reset that
   would discard already-tracked objects).
5. `npm run verify` still passes (no regression to the headless determinism/generation
   suite).
6. The `'normal'`-roll path, the miniboss-level path (`isMinibossLevel()` → `_applyRoomType`
   returns early at `GameScene.js:999`, no banner), and the boss-level path
   (`_buildBossLevel`) are unaffected.

## 4. Problem Analysis

`_buildLevel()` ordering (current):

1. `this.tileMap = new TileMap(this, desc)` — line 372
2. `this._applyRoomType(desc)` — line 381 → `_popRoomBanner` → `this._levelObjects.push(banner)`
3. `this._levelObjects = []` — line 390

The constructor (`GameScene.js:122–124`) is `super('Game')` only — it never assigns
`_levelObjects`. Two consequences of the ordering, one root cause:

- **First build (`create()`):** `_levelObjects` is `undefined` at step 2 → `.push` throws.
- **Later builds:** teardown (`GameScene.js:826`) sets `_levelObjects = []` first, so step 2's
  push succeeds — but step 3 then reassigns a fresh `[]`, discarding the banner reference.
  The banner `Text` is never added back to `_levelObjects`, so the next teardown
  (`GameScene.js:825`) can't destroy it. The fade tween (`GameScene.js:1078`) tweens alpha to
  0 but leaves the `Text` `active`, so once the banner is tracked again, the line-825 guard
  (`if (o && o.active) o.destroy()`) does fire and destroy it — the leak exists purely because
  the object is dropped from `_levelObjects`, not because the guard would skip it.

Approaches evaluated:

- **A — hoist the init above `_applyRoomType`, remove the line-390 reset** (single init
  point) → fixes the crash and the leak; smallest diff. **Chosen.**
- **B — add a constructor init guard only** → stops the crash but the line-390 reset still
  discards the banner every build (leak persists). Rejected.
- **C — move the whole entrance-marker block above `_applyRoomType`** → also correct, but
  needlessly relocates a cosmetic marker plus its `biome.colors.entrance` dependency for no
  gain. Rejected.

`_buildBossLevel()` is already correct (`GameScene.js:619` inits `_levelObjects` before any
push and never calls `_applyRoomType`) — it is the pattern this fix brings `_buildLevel`
in line with.

## 5. Decision Log

**1. Where to initialize `_levelObjects` in `_buildLevel()`?**
- Options: A) hoist init above `_applyRoomType` + drop the line-390 reset · B) constructor guard only · C) move the entrance-marker block above `_applyRoomType`
- Decision: **A)** — minimal diff, fixes both the crash and the banner leak, keeps a single
  init point per build. B leaves the discarding reset in place; C relocates unrelated
  cosmetic code.

## 6. Design

In `_buildLevel()`, initialize `this._levelObjects = []` immediately after the `TileMap` is
constructed (line 372) and before `_applyRoomType(desc)` (line 381) — i.e. inside the
non-boss path, **below** the `isBossLevel()` early return at lines 364–367, not at the top of
`_buildLevel()`. (A top-of-method init would run a redundant reset that `_buildBossLevel`
overwrites at line 619, blurring the "exactly once per build" invariant.) Delete the
now-redundant `this._levelObjects = []` at line 390, leaving the entrance-marker creation and
its `_levelObjects.push(entMarker)` in place — they push onto the already-initialized array.

Resulting order: init → `_applyRoomType` (may push the banner) → entrance marker push. Both
the banner and the entrance marker end up tracked in the single per-build `_levelObjects`
array, so the next teardown destroys both.

No change to generation, RNG, determinism, or any pinned output — this only reorders
GameObject bookkeeping in a Phaser-coupled scene the verifier does not import.

## 7. Files Changed

- `src/scenes/GameScene.js` — in `_buildLevel()`, hoist `this._levelObjects = []` to before
  `_applyRoomType(desc)`; remove the redundant reset at the old entrance-marker site.

## 8. Verification

1. [AC1] Run `npm run dev`, start runs until the first level shows a room banner (ELITE /
   HORDE / CURSED) — no crash; banner renders. (Or temporarily force a tagged room to make it
   deterministic.)
2. [AC2/AC4] Inspect `_buildLevel()`: exactly one `this._levelObjects = []`, placed before
   `_applyRoomType(desc)`.
3. [AC3] Cross a level boundary from a tagged room into another level — the previous banner
   is gone (destroyed on teardown), not lingering as an invisible/stale object.
4. [AC5] `npm run verify` exits 0.
5. [AC6] A `'normal'`-roll level, a miniboss level (`isMinibossLevel()` true → `_applyRoomType`
   returns early, no banner), and a boss level still build correctly (no banner expected on
   any of them; the hoisted `_levelObjects = []` precedes `_spawnMiniboss`).

Note: `npm run verify` is headless node and does **not** import GameScene (Phaser-coupled), so
AC1/AC3/AC6 are inherently manual — AC5 gates generation/determinism only, not this ordering.
The manual ELITE/HORDE/CURSED repro in step 1 is therefore the required pre-merge gate; force a
tagged room via a temporary `_pickRoomType`/`_applyRoomType` stub to make it deterministic.
