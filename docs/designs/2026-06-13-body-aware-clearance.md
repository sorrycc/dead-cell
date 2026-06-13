# Body-Aware Level Clearance — guarantee the 36×52 player fits every traversable space

## 1. Background

The player's Arcade collision body is **36 px wide × 52 px tall** (`src/entities/Player.ts:105-106` — `BODY_W = 36`, `BODY_H = 52`, no `setSize`), built as a **center-origin** rectangle (`Player.ts:269`) and spawned centered on a tile (`GameScene.ts:594`, `entrance.x = (col+0.5)·32`). The level grid is **32 px tiles** (`TILE_SIZE = 32`, `src/world/LevelGenerator.ts:184`). The body is therefore **wider than one tile and taller than one tile**.

The procedural generator (`src/world/LevelGenerator.ts`) and the headless verifier (`scripts/verify-gen.mjs`) prove traversability with a **point-mass jump model**: `canReachStep(dx, dy)` only checks that a platform *top* is within the jump-reach envelope, and `bfsTraversable` (`verify-gen.mjs:200`) BFSes a platform graph. Nothing checks that the actual body **fits** through the space it must traverse.

Observed failure: the hero jumps into a 1-tile-wide (32 px) vertical slot and wedges — a 36 px body cannot pass a 32 px channel, and in an exactly-32 px channel Arcade reports `blocked.left` and `blocked.right` simultaneously and never lets it build vertical speed. Symmetrically, a platform only 2 tiles above the floor leaves a single 32 px empty row of headroom — far less than the 52 px body — so the player cannot stand/jump there.

## 2. Requirements Summary

Goal: make the generator + verifier **prove** the 36×52 body can travel entrance→exit on every generated level, eliminating wedge/low-ceiling traps — **without** shrinking the body or changing player feel.

Locked decisions (user):

- **Approach:** harden generator + verifier; keep the 36×52 body (do not shrink).
- **Verifier depth:** full body-aware BFS — a verifier PASS must be sound (no wedge possible).

Scope boundary: body width/height are **not** part of the reach math, so the jump-reach envelope, `MIN_GAP`/`MAX_GAP`, and the player physics mirror stay untouched. This is a purely **additive** clearance dimension layered on the existing soundness machinery.

## 3. Acceptance Criteria

1. **Sound traversal (AC1):** a body-aware BFS in `verify-gen.mjs` proves the real 36×52 footprint can travel entrance→exit on every generated level (all biomes × 200 seeds × all layout templates). A verifier PASS ⇒ no wedge.
2. **Node clearance, by construction (AC2):** entrance, exit, branch treasure, and every enemy/pickup spawn have a body-fitting footprint (≥`CLEAR_ROWS` empty rows of headroom in a ≥`CLEAR_COLS`-wide window). The generator guarantees this by construction (spawn pool filtered by `bodyStandClear`); the verifier asserts it independently.
3. **DRY predicates (AC3):** shared **pure** exports `bodyFits` + `bodyStandClear` from `LevelGenerator.ts`, imported by both the generator (placement enforcement + spawn filter) and the verifier — same single-source pattern as `canReachStep` / `platformStep` / `isRemountRun`.
4. **Loud budget (AC4):** module-load assertions prove `CLEAR_COLS·TILE_SIZE ≥ BODY_W` and `CLEAR_ROWS·TILE_SIZE ≥ BODY_H` (with `CLEAR_COLS`/`CLEAR_ROWS` derived via `ceil`), so a future body/tile re-tune fails loudly at import.
5. **Placement enforcement (AC5):** `buildShaft` rejects/repairs a step that would create a sub-`CLEAR_ROWS` headroom pocket; `placeBranch` requires `CLEAR_ROWS` rows of top clearance; `buildStaircase`/`buildIslands` carry a defensive `bodyStandClear` reject; `placeRecoveryBridges` asserts its launch/landing clearance.
6. **Determinism preserved (AC6):** the cols:40 regression pin is byte-unchanged (or, if it shifts, regenerated deliberately from real generator output with a documented note — never hand-edited). `npm run verify` and `npm run typecheck` both pass, and the new BFS never rejects a level the generator emits.
7. **No feel change (AC7):** the jump-reach envelope, `MIN_GAP`/`MAX_GAP`, and the player physics mirror are untouched; body dimensions enter only the new clearance dimension.

## 4. Problem Analysis

- **Approach A — shrink the body below the tile size** (e.g. `BODY_W = 30`). Cheapest, no generator/verifier change. Rejected by the user: changes hitbox/feel and only fixes width, not headroom; not a formal guarantee.
- **Approach B — local clearance heuristics only** (assert 2-row headroom + no 1-col chimney on the critical chain). Lighter, but a heuristic — a fallen-into pocket could still be inescapable. Rejected: betrays the codebase's "a PASS is SOUND" discipline.
- **Chosen approach — body-aware clearance dimension** (this doc). Add shared `bodyFits`/`bodyStandClear` predicates, enforce them at placement + on the spawn pool, and add a footprint-level BFS to the verifier that proves the real 36×52 body traverses. Sound, additive, reuses the existing reach envelope. The only option that *guarantees* no wedge while preserving the body and feel.

## 5. Decision Log

**1. Footprint model for `bodyStandClear`** *(revised in Phase 4 review — round 1, item 1)*
- Options: A) strict 3-col `(col−1..col+1) × CLEAR_ROWS` SOLID-free — matches a perfectly-centered body but over-restrictive (96 px), risks *false verifier failures* on real generator output · B) fixed 2-col `{col, col+1}` left-anchored — but the body spawns **centered** (`GameScene.ts:594`) and a centered 36 px body pokes ~2 px into `col−1`; a fixed left anchor mismatches where the body actually is · C) **sliding 2-col window**: a true result iff *some* 2-contiguous-column window containing `col` is `CLEAR_ROWS`-clear and supported.
- Decision: **C)** — sound and minimally restrictive. Soundness: a true result corresponds to a concrete fitting placement — the body is **not forced to center**; it can shift to occupy any clear 2-col window (`36 ≤ 64`), so left- or right-alignment within the window is a real, reachable position. The §1 wedge (a 1-tile channel: `col−1` and `col+1` both SOLID, `col` empty) is correctly **rejected** because no 2-col window containing `col` is clear. Reviewer's Option A is rejected because it would reject genuinely-fittable cells (false failures, AC6 risk); fixed Option B is rejected because it both misreads the centered body and produces asymmetric false negatives.

**2. What blocks the body footprint**
- Options: A) SOLID + ONEWAY both block · B) SOLID only blocks occupancy; ONEWAY counts only as *support*.
- Decision: **B)** — a ONEWAY tile collides only from above (the body passes up through it and stands on top), so it must not block horizontal/vertical occupancy. HAZARD is damage-only, never blocking. Thus: footprint blocked by `SOLID` only; "supported below" = `SOLID` or `ONEWAY`.

**3. Verifier BFS movement model** *(revised in Phase 4 review — round 1, items 2/3)*
- Options: A) footprint flood-fill over body-valid **window nodes**, a single REACH edge gated by `canReachStep` + a swept-airspace clearance check · B) augment the existing platform graph, gating nodes/edges on body-fit.
- Decision: **A)** — the sound model the user chose. A node is a grounded 2-col window; one **REACH edge** covers both jump and fall, gated by `canReachStep` (which already bounds `dy ≤ MAX_STEP_DOWN`, line 291 — so falls are bounded for graph parity, and the near-edge `dx` is the same metric `platformStep` uses, line 300) AND by a **SOLID-free swept-airspace bounding box** (§6.4) that accounts for the jump's apex overshoot (an L-path along the apex row under-checks it — round-2 item 1). It reuses the **base-jump** envelope only, so it is **conservative** vs. the player's real mobility (double-jump + wall-jump only ADD reach) — a PASS therefore implies the real player makes it. Headroom, narrow corridors, and chimneys fall out uniformly: an unfittable window is simply not a node.

**4. Generator enforcement style**
- Options: A) local placement-time reject/repair · B) global post-pass repair · C) a generator-side self-BFS assertion.
- Decision: **A)** — mirrors the existing `canReachPlatform` reject already in `buildShaft`/`buildStaircase`/`buildIslands`. The verifier stays the single global proof (the generator never self-BFSes today — keep that separation). KISS.

**5. Regression-pin safety** *(revised in Phase 4 review — round 1, item 7)*
- The cols:40 pin (`PIN_BIOME`, staircase-only — below `LAYOUT_MIN_COLS`/`RECOVERY_MIN_COLS`/`BRANCH_MIN_COLS`) must stay byte-identical. Two stated invariants make this provable, not hopeful:
  - **(i) Defensive rejects are dead code at pin width.** A staircase walks strictly left→right (`next.col > prevRight`, line 450), so no platform is ever placed above another in shared columns ⇒ every placed platform has fully-clear headroom ⇒ the new `bodyStandClear` reject in `buildStaircase` **never fires** ⇒ zero change to the RNG draw sequence. (The check is a pure read of `tiles`; it consumes no `rng()` regardless.)
  - **(ii) The spawn-pool filter changes only the pickup spawn, not the tiles.** *(Revised during implementation — the original claim that the filter is a no-op at pin width was wrong.)* The staircase pin DOES contain 1-tile standable slots — (col 1, row 16) between the left wall and a platform, and (col 17, row 16) between two same-row platforms (`MIN_GAP = 1`) — where the body cannot stand. The `bodyStandClear` filter correctly excludes them, shifting the pickup pick from col 20 → col 19. Both removed cells have `runLen 1` (< `MIN_ENEMY_PLATFORM_TILES`), so the enemy pool is untouched. The grid TILES are byte-unchanged (`PIN_TILES` holds); only `PIN_EXPECTED.pickups` was regenerated.
- Decision: TILES unchanged; the pickup spawn legitimately moved to a body-clear cell — `PIN_EXPECTED` regenerated from real generator output with the note above (never hand-edited to silence). `npm run verify` passes.

## 6. Design

### 6.1 Clearance budget (new constants, in `LevelGenerator.ts`, beside the physics mirror ~L186)

```
const BODY_W = 36   // px — MIRROR of Player.ts BODY_W (the Arcade body width).
const BODY_H = 52   // px — MIRROR of Player.ts BODY_H (the Arcade body height).
const CLEAR_COLS = Math.ceil(BODY_W / TILE_SIZE)  // = 2 — empty columns the body needs to occupy/pass.
const CLEAR_ROWS = Math.ceil(BODY_H / TILE_SIZE)  // = 2 — empty rows of headroom above a footing.
```

Module-load assertion (next to `assertBudgetsSound`, L322) — re-proves the budget at import:

```
if (CLEAR_COLS * TILE_SIZE < BODY_W) throw …  // 2*32=64 ≥ 36 ✓  (the body fits within CLEAR_COLS tiles)
if (CLEAR_ROWS * TILE_SIZE < BODY_H) throw …  // 2*32=64 ≥ 52 ✓  (the body fits within CLEAR_ROWS tiles)
```

`CLEAR_COLS`/`CLEAR_ROWS` are **derived** via `ceil`, so the assert is a guard against a hand-edit that breaks the derivation (e.g. someone hardcoding `CLEAR_COLS = 1`, or bumping `BODY_W` past 64). Verification step 4 (`BODY_W = 70`) trips it.

A third assertion (placed with the recovery constants, where `RECOVERY_REMOUNT_UP` is defined ~L235) keeps the floor-recovery proof and the new clearance proof from silently diverging (round-2 item 3):

```
if (RECOVERY_REMOUNT_UP < CLEAR_ROWS + 1) throw …  // 3 ≥ 3 ✓
```

This is **load-bearing**: a body standing on the floor *under* a recovery stone (feet at `floorRow-1`, occupying rows `floorRow-1, floorRow-2`) needs the stone (at `floorRow - RECOVERY_REMOUNT_UP`) strictly above that 2-row band ⇒ `RECOVERY_REMOUNT_UP ≥ CLEAR_ROWS + 1`. If anyone lowers `RECOVERY_REMOUNT_UP` or raises `BODY_H`, the floor-under-stone window stops fitting and `checkFloorRecovery` (point-mass) would disagree with `checkClearance` (body-aware) — the assert trips first.

### 6.2 Shared pure predicates (the DRY seam — AC3)

`bodyFits` is the occupancy primitive; `bodyStandClear` adds support + the sliding window. Both are exported and used by generator and verifier.

```
// bodyFits(tiles, cols, rows, leftCol, row) → boolean
// True iff the body's 2-col × CLEAR_ROWS footprint anchored with columns {leftCol, leftCol+1} and
// occupying rows {row-CLEAR_ROWS+1 … row} is in-bounds and free of SOLID. ONEWAY/HAZARD do NOT block
// (a ONEWAY collides only from above; HAZARD is damage-only). This is the body's OCCUPANCY unit —
// the verifier BFS uses it as a window node, the generator uses it via bodyStandClear.
export function bodyFits(tiles, cols, rows, leftCol, row) {
  if (leftCol < 0 || leftCol + CLEAR_COLS - 1 >= cols) return false
  if (row - CLEAR_ROWS + 1 < 0 || row >= rows) return false
  for (let r = row - CLEAR_ROWS + 1; r <= row; r++)
    for (let c = leftCol; c < leftCol + CLEAR_COLS; c++)
      if (tiles[r][c] === TILE.SOLID) return false
  return true
}

// bodyStandClear(tiles, cols, rows, col, row) → boolean  (Decision 1 — the SLIDING 2-col window)
// True iff a 36×52 body can STAND at/around standable cell (col,row): the cell is EMPTY, and SOME
// CLEAR_COLS-window containing `col` (anchored at col-1 OR col) both bodyFits AND has support
// (SOLID|ONEWAY) directly below one of its columns. The window slides so a centered/edge body is
// found wherever it actually fits; a 1-tile channel (both neighbours SOLID) yields no clear window
// → false. PURE + deterministic so the generator and verifier agree exactly.
export function bodyStandClear(tiles, cols, rows, col, row) {
  if (row < 1 || row >= rows - 1) return false
  if (tiles[row][col] !== TILE.EMPTY) return false
  for (const lc of [col - 1, col]) {                 // the two CLEAR_COLS-windows containing `col`.
    if (!bodyFits(tiles, cols, rows, lc, row)) continue
    const a = tiles[row + 1][lc], b = tiles[row + 1][lc + 1]
    const supported = a === TILE.SOLID || a === TILE.ONEWAY || b === TILE.SOLID || b === TILE.ONEWAY
    if (supported) return true
  }
  return false
}
```

The existing point-mass `isStandable` (`verify-gen.mjs:178`) stays for the legacy node checks; `bodyStandClear` is the new body proof. Generalizing the window to `CLEAR_COLS` is unnecessary today (`CLEAR_COLS = 2` ⇒ exactly two candidate anchors); a comment notes this so a future `CLEAR_COLS > 2` re-tune knows to widen the anchor loop.

### 6.3 Generator enforcement (AC5)

- **`buildShaft` (L461)** — the main offender: it zig-zags and can drop a platform exactly `CLEAR_ROWS` rows under another, leaving one empty row of headroom. Note the structural fact that bounds the risk: every shaft step drops `≥ 2` rows (`drop = randInt(rng, 2, MAX_STEP_DOWN)`, line 474; the loop breaks before the floor, line 471, so the effective drop stays `≥ 2` after clamping), so **no two runs ever share a row** — there is no *same-row* 1-col chimney to worry about; the only body-trap a descent can create is the `drop = 2` + column-overlap case (a SOLID exactly `CLEAR_ROWS` rows above the lower run's top → 1 empty headroom row). Fix: when the chosen `next` is not `bodyStandClear` (re-checked on `next`'s centre against the **full emitted `tiles`** — so it sees *every* prior run the switchback may have brought back overhead, not just the triggering one; round-2 item 2), repair in a loop: bump the drop a row, else pull horizontally off the overlapping column, then **re-check `bodyStandClear` against the full grid** and repeat until it passes or the repair options are exhausted, in which case stop the chain. Stopping is safe: `exit = cellAbove(last)` (L630) is always the **last placed** platform, and every *retained* step passed `bodyStandClear`, so a truncated shaft is a shorter, still-body-traversable level (the high entrance reaches the lower exit by construction).
- **`buildStaircase` (L427) / `buildIslands` (L510)** — monotonic left→right, so consecutive platforms never share a column and a sub-`CLEAR_ROWS` pocket cannot arise today. Add a defensive `bodyStandClear` reject on the placed platform's standable centre so a future widening that introduces overlap cannot regress silently. **Dead code at current budgets** (Decision 5(i)) — no behavior change, pin-safe.
- **`placeBranch` (L859)** — extend `runTopClear` (L923) from 1 row to `CLEAR_ROWS` rows, so a branch treasure ledge always has body headroom.
- **`placeRecoveryBridges` (L949)** — already reserves 64 px vertical (`stoneRow = floorRow - RECOVERY_REMOUNT_UP`, so the floor walk lane keeps `CLEAR_ROWS` clear rows under the stone — the module-load `RECOVERY_REMOUNT_UP ≥ CLEAR_ROWS + 1` assert in §6.1 makes that invariant loud). Add an assertion that, for each stone, `bodyStandClear` holds at (a) the stone *top* (the re-mount footing) and (b) a floor cell horizontally adjacent to the stone (the launch footing) — this checks the **vertical** headroom that actually matters (the launch is floor→up-to-stone), correcting the round-1 "≥ CLEAR_COLS columns" wording which checked the wrong axis (round-2 item 3).
- **Spawn pool (generateLevel step 6, L689)** — filter the standable set by `bodyStandClear` so every enemy/pickup spawn is body-clear **by construction** (AC2):
  ```
  const standableAll = collectStandable(...).filter(s => bodyStandClear(tiles, cols, rows, s.col, s.row))
  ```
  This is a pure post-filter before `pickSpawns`; on the staircase pin it removes zero cells (Decision 5(ii)) so the pin is unaffected. (Spawn cells could otherwise be body-unclear only where a SOLID sits in their headroom — which the platform-placement enforcement above already eliminates on the critical structure, but the filter makes it airtight for scattered-ledge tops too.)

### 6.4 Verifier body-aware BFS (the proof — AC1/AC2)

New `checkClearance(desc)` in `verify-gen.mjs`, called from `checkDescription` right after `bfsTraversable` (L306-307), skipped for the boss arena (handled by `checkBossArena`). Two parts:

**(a) Node clearance check (AC2).** Re-derive from the emitted tiles (independent of generator intent): assert `bodyStandClear` holds at the entrance, the exit, the branch treasure (when present), and every enemy + pickup spawn cell.

**(b) Body-aware flood-fill (AC1).** Prove the body traverses, over **window nodes**:

```
// A node is a grounded body window  W = (lc, r):  columns {lc, lc+1}, feet row r (body occupies
// rows {r-CLEAR_ROWS+1 … r}, supported by row r+1). grounded(lc,r) = bodyFits(lc,r) AND a support
// (SOLID|ONEWAY) under lc or lc+1 at row r+1. (CLEAR_COLS=2; the window IS the footprint.)
//
// REACH edge  P=(lcP,rP) → Q=(lcQ,rQ),  both grounded:
//   dx = near-edge column gap between footprints [lcP,lcP+1] and [lcQ,lcQ+1]  (0 if they overlap)
//        — the SAME near-edge metric platformStep uses (BLOCKER #2 discipline).   dy = rQ - rP.
//   APEX_ROWS = ceil(APEX_H / TILE_SIZE)  (= 5 — a full base jump apexes this many rows above launch;
//              canReachStep assumes the FULL arc, so the body overshoots ABOVE the landing — round-2 item 1).
//   Edge exists iff canReachStep(dx, dy)  (base-jump envelope only ⇒ conservative vs. the player's
//   double-jump + wall-jump, which only ADD reach — so a PASS is sound) AND the jump's full SWEPT
//   AIRSPACE — the bounding rectangle of the real (arcing, overshooting) trajectory plus the body —
//   is SOLID-free, so the arc can never clip a ceiling over the gap:
//     cLo = min(lcP, lcQ);  cHi = max(lcP, lcQ) + (CLEAR_COLS - 1)        // full column extent of both footprints
//     rBot = max(rP, rQ)                                                  // lowest the body reaches
//     rTop = (dy <= 0 ? rP - APEX_ROWS : rP) - (CLEAR_ROWS - 1)           // up/level: rise to the apex; down: just fall
//     require  tiles[r][c] !== SOLID  for all r in [rTop … rBot], c in [cLo … cHi]
//   A SOLID-free bounding box is navigable: the real parabola is horizontally monotone lcP→lcQ and
//   vertically rP→apex→rQ, so it (and the swept body) lies wholly inside the box. Conservative — but
//   normal levels have NO ceiling SOLIDs and every template places nothing over a forward jump's
//   airspace (staircase/islands monotone-right, shaft descends), so the box is clear by construction
//   ⇒ no false rejection (validated empirically by the 200-seed sweep, AC6).
//
// SEED: every grounded window over the entrance's supporting platform.
// PASS: any grounded window over the exit's supporting platform is reached.
```

This subsumes the platform BFS: a platform with no grounded window (a low ceiling) is excluded; a 1-col chimney has no fitting window and is unreachable; only genuinely body-traversable routes connect entrance→exit. Because a node exists only if the body provably fits and an edge requires both the base-jump reach envelope AND a SOLID-free swept airspace, **a PASS implies the real 36×52 body makes it**. The cheaper point-mass `bfsTraversable` stays as a first gate; `checkClearance` is the stronger body-level proof layered after it.

Complexity: window nodes number `≤ cols×rows` and edges are built by the same `O(n²)`-over-grounded-windows pattern as `bfsTraversable` (grounded windows are far fewer than all cells); well within the 200-seed sweep budget.

## 7. Files Changed

- `src/world/LevelGenerator.ts` — add `BODY_W`/`BODY_H`/`CLEAR_COLS`/`CLEAR_ROWS` mirror + module-load clearance asserts (incl. `RECOVERY_REMOUNT_UP ≥ CLEAR_ROWS + 1` by the recovery constants); add exported pure `bodyFits` + `bodyStandClear`; add `export` to `MAX_STEP_DOWN` (L224) and `APEX_H` (L197) — the verifier's REACH edge needs both (`dy` bound + `APEX_ROWS`); enforce clearance in `buildShaft` (loop-repair sub-`CLEAR_ROWS` headroom vs the full grid), `buildStaircase`/`buildIslands` (defensive reject), `placeBranch` (`runTopClear` → `CLEAR_ROWS`), `placeRecoveryBridges` (assert `bodyStandClear` at stone-top + adjacent floor footing); filter the standable spawn pool by `bodyStandClear` in `generateLevel`.
- `scripts/verify-gen.mjs` — extend the generator import (L38) with `bodyFits`, `bodyStandClear`, `canReachStep`, `TILE_SIZE`, `MAX_STEP_DOWN`, `APEX_H`; add `checkClearance(desc)` (node clearance + window-node body-aware flood-fill BFS with the swept-airspace edge); call it from `checkDescription` after `bfsTraversable`. Regenerate `PIN_TILES`/`PIN_EXPECTED` only if the cols:40 pin shifts (expected: no change, Decision 5).

## 7b. Revised during implementation

- **Builder enforcement simplified to a uniform defensive guard.** All three builders place `next` horizontally **gap-separated** from `prev` (`next.col = prevRight + gap`, etc., `gap ≥ MIN_GAP = 1`) and never let it overlap `prev`'s columns; non-consecutive runs are `≥ 2·drop ≥ 4` rows apart in the shaft and monotone-right in staircase/islands. So **no builder can place a run within a prior run's `CLEAR_ROWS` headroom band over shared columns** — the elaborate `buildShaft` bump→pull→loop repair (§6.3) would be dead code. Implemented instead as a single uniform `headroomClear(critical, run)` guard (operating on the platform *records*, since `tiles` is stamped after the builder returns) added before each `critical.push` in all three builders — dead code at current budgets (so pin-byte-identical, Decision 5(i)), live regression guard if a future template introduces overlap. The verifier's body-aware BFS remains the global proof.
- **`placeRecoveryBridges` per-stone runtime assert dropped (YAGNI).** The load-bearing invariant is made loud by the module-load `RECOVERY_REMOUNT_UP ≥ CLEAR_ROWS + 1` assert (§6.1), and per-level recovery-stone clearance is independently proven by the verifier's `checkClearance` (stone tops are standable cells in the body-aware BFS). A runtime `throw` inside level-gen would risk crashing a real run for a condition the module-load assert + verifier already cover.
- **`MAX_STEP_DOWN` export not needed.** The verifier's REACH edge calls `canReachStep(dx, dy)`, which already rejects `dy > MAX_STEP_DOWN` internally — so the bound is encapsulated and the symbol need not be exported. The verifier imports `CLEAR_COLS`/`CLEAR_ROWS`/`APEX_H` (for the swept-airspace box) plus `bodyFits`/`bodyStandClear`/`canReachStep`/`TILE_SIZE`.

## 8. Verification

1. **[AC1]** `npm run verify` passes — `checkClearance`'s window-node BFS runs across all biomes × 200 seeds and proves entrance→exit body traversal; temporarily force a 1-row ceiling in `buildShaft` (skip the headroom repair) and confirm it fails loudly.
2. **[AC2]** Confirm `checkClearance` asserts `bodyStandClear` at entrance/exit/branch/enemy/pickup cells, and that the generator's spawn-pool filter makes those pass by construction (no real seed fails the assertion).
3. **[AC3]** `bodyFits`/`bodyStandClear` are single exported pure functions imported by both `LevelGenerator.ts` and `verify-gen.mjs` (one definition each, no duplication).
4. **[AC4]** Temporarily set `BODY_H = 70` (⇒ `CLEAR_ROWS = ceil(70/32) = 3`) and confirm the module-load `RECOVERY_REMOUNT_UP ≥ CLEAR_ROWS + 1` assert throws at import (`npm run verify` aborts immediately with the recovery-headroom error). *(Note: bumping `BODY_W`/`BODY_H` alone auto-adjusts the ceil-derived `CLEAR_COLS`/`CLEAR_ROWS`, so the `CLEAR_*·TILE_SIZE ≥ BODY_*` asserts guard a broken hand-edit of the derivation; the `RECOVERY_REMOUNT_UP` assert is the cross-constraint that catches a real body-height re-tune.)* — verified.
5. **[AC5]** Inspect a `shaft`-template seed (≥50 cols) before/after: any platform that previously sat one empty row under another is now repaired/pulled.
6. **[AC6]** `npm run verify` reports the cols:40 pin deep-equal (byte-unchanged); `npm run typecheck` passes; no sweep seed is rejected by the new BFS (it never fails a level the generator emits). If the pin shifted, the doc carries a `Revised` note and the new pin is regenerated from real output.
7. **[AC7]** Diff shows no change to `canReachStep`/`rawReachPx`/`MAX_GAP`/`MAX_STEP_UP` semantics or any `Player.ts` feel constant — only the additive clearance dimension (and an `export` keyword on `MAX_STEP_DOWN`).
8. **In-game:** run the app, reach the level/seed that produced the original wedge screenshot, confirm the hero can jump out (no 1-tile slot / low-ceiling trap is generated).
