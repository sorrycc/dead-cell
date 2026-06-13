# Local Floor-Recovery Bridges (anti-strand guarantee)

## 1. Background

A player reported being unable to escape a pocket: they fell off the chain near the high
exit, and there was no platform within jump-reach above them. The only escape was walking
the full-width floor all the way back to the far-left entrance and re-climbing. The
screenshot showed the green player (`Player.BASE_COLOR 0x58d68d`) stranded in the
bottom-right, below the exit, next to a shop vendor.

Root cause: the generator (`src/world/LevelGenerator.ts`) and the headless verifier
(`scripts/verify-gen.mjs`) only guarantee ONE property (AC27): every consecutive
platform→platform hop on the entrance→exit chain is inside the jump-reach envelope
(`canReachStep`), so the path is traversable BY CONSTRUCTION. Nothing is guaranteed about
RECOVERY after a fall. The floor is one full-width SOLID run (so you can always walk
left/right — there is never a sealed box; the only interior verticals are the two side
walls), but to get back ONTO the platform graph you need a platform within
`MAX_STEP_UP = 3` tiles above you. When the chain happens to stay high over a stretch, the
only re-mountable platform near a fall can be far away — a long backtrack, which also
crosses now-damaging floor hazards (round-3 promoted hazards to bodies on every level).

The missing invariant is LOCALITY: near wherever the player can fall, there must be a way
back up that leads to the exit. A naive "is the exit reachable from the floor?" check would
pass trivially (floor → far entrance → climb everything → exit), so the real property to
prove is bounded-distance recovery, not mere graph connectivity.

Note on the chain shape: `buildStaircase` / `buildIslands` draw `drawnStep =
randInt(-MAX_STEP_UP, MAX_STEP_DOWN)` = `[-3, +6]` per step, clamped to `platformRows`
(LevelGenerator.ts:385, 470), and `buildShaft` ends on the floor band (line 418). So the
chain returns low frequently — floor gaps are OCCASIONAL and usually shallow, so recovery
structures are typically 1–2 stones, not towers.

## 2. Requirements Summary

Goal: a fallen player can always climb back to the exit LOCALLY (bounded horizontal walk),
on every generated normal level, proven headlessly.

Scope:
- Add a recovery pass to the pure generator that stamps reach-bounded recovery bridges
  wherever a floor stretch lacks a nearby re-mount point.
- Keep the floor walking lane hazard-free so recovery is never a damage gauntlet.
- Extend the verifier to PROVE locality + reconnection (the new acceptance gate).

Out of scope: capping platform height, changing the layout-template builders, touching any
Phaser-coupled code (`GameScene`/`TileMap`). The generator stays a pure module.

Key decisions from the pre-design dialogue with the user:
- Approach = local recovery ledges + a verifier locality proof (the most robust option;
  keeps vertical variety; covers all layout templates).
- Keep recovery paths hazard-free.

## 3. Acceptance Criteria

1. For every normal level with `cols >= RECOVERY_MIN_COLS`, no run of consecutive interior
   floor columns wider than `MAX_FLOOR_RECOVERY_GAP` lacks a SOLID re-mount platform (a
   SOLID run whose top is `<= MAX_STEP_UP` tiles above the floor), re-derived from the
   EMITTED `platforms` by the verifier.
2. Every SOLID re-mount platform has a `canReachPlatform` directed path to the exit platform
   (climbing out actually leads to the exit), proven by the verifier.
3. The existing entrance→exit `bfsTraversable` check (AC27) still passes for every seed;
   every recovery edge is reach-bounded by construction.
4. No HAZARD tile sits on the floor walking lane (row `floorRow-1`) for
   `cols >= RECOVERY_MIN_COLS`, proven by the verifier.
5. Determinism holds and the `cols:40` regression pin is byte-identical (recovery pass,
   hazard-lane change, and the new verifier check all no-op below `RECOVERY_MIN_COLS`).
6. The generator stays Phaser-free; `npm run verify` and `npm run typecheck` pass.

## 4. Problem Analysis

- **Approach A — lone low re-mount ledge.** Rejected: re-mountable from the floor but FAILS
  AC2 — a ledge that connects to nothing leaves the player stuck.
- **Approach B — cap platform height.** Rejected by the user: fights layout variety.
- **Approach C — SOLID zig-zag ladder UP to the chain.** Rejected (review r1): `canReachStep`
  is a point envelope; a SOLID up-step into populated airspace can be "verified" yet bonk an
  overhang — the module header's BLOCKER #1 false-PASS.
- **Approach D — SOLID base + vertical ONE-WAY stack.** Rejected (review r2): pass-through
  fixes the overhang, but reconnecting the stack to a SOLID chain platform needed a
  clear-column SEARCH with no existence guarantee — a single pathological seed where every
  candidate column is blocked is a hard `verify` failure.
- **Chosen approach E — horizontal SOLID stepping-stone BRIDGE in the clear bottom band.**
  A recovery bridge is a row of short SOLID stones at `floorRow-3`, spaced `<= MAX_GAP`,
  spanning an uncovered floor gap and anchored within `MAX_GAP` of a bounding re-mount. It
  lives entirely in the gap's bottom band (rows `floorRow-1..floorRow-3`), which is PROVABLY
  EMPTY (Decision 9 — any SOLID there is itself a re-mount, contradicting "uncovered"), so a
  stone can ALWAYS be stamped — no search, no failure mode. At `floorRow-3` the 52px player
  fits UNDER a stone (64px clearance), so the full-width floor stays contiguous and the
  floor→stone mount always has a clear adjacent launch column. The stones form a same-row
  reach-chain to a bounding re-mount (every gap has one — Decision 9), which is on the proven
  entrance→exit chain, so every stone reaches the exit. The verifier re-derives re-mounts
  from emitted tiles and proves locality + reconnection independently.

## 5. Decision Log

**1. Recovery structure?**
- Options: A) lone ledge · C) SOLID up-ladder · D) one-way stack · E) horizontal SOLID
  stepping-stone bridge at `floorRow-3` in the clear bottom band
- Decision: **E)** — A fails AC2; C hits the overhang false-PASS; D needs an unguaranteed
  clear-column search. E is guaranteed-placeable (the bottom band is provably empty),
  overhang-free (no climb into populated airspace), floor-preserving, and the simplest
  structure that closes the gap.

**2. Stone height = `floorRow - MAX_STEP_UP` (`floorRow-3`)?**
- This is FORCED. A stone at `floorRow-2` leaves only 32px under it — the 52px player cannot
  pass, so it would segment the floor (re-creating a pocket). At `floorRow-3` the stone
  bottom is 64px above the floor surface, so the player (52px collider) fits under with 12px
  to spare → the floor stays contiguous. `floorRow-3` is also exactly the envelope's
  re-mount limit: `canReachStep(0,-3)=true` (the module-load assertion proves `MAX_GAP` fits
  at `MAX_STEP_UP`), so the stone is re-mountable from the floor. Minimum-that-works = forced.

**3. SOLID-only obligation + span coverage (review r1 item 1)?**
- Decision: the verifier obligates re-mounts from SOLID runs ONLY (`isRemountRun` excludes
  the floor run, the 1-wide side-wall runs, and all ONEWAY). A scattered ONEWAY decoration
  ledge can land in the band (`scatterOneWayLedges` row up to `floorRow-3`,
  LevelGenerator.ts:1016) with no reconnection guarantee — obligating it would fail AC2.
  Coverage is span-only and computed by ONE shared function on both sides (Decision 8).

**4. RNG source?**
- Decision: a dedicated off-the-main-thread sub-RNG `mulberry32((seed ^ 0x5eca1add) >>> 0)`
  for the stones' length variation — same discipline as the template pick (`0x7e3415a7`) and
  the branch (`0xb2a4c11`): consumes NO main-thread draw, so the regression pin +
  enemy/pickup draws are byte-unchanged.

**5. Width gate?**
- Decision: `cols >= RECOVERY_MIN_COLS (50)` — the `cols:40` PIN_BIOME is below it, so every
  change no-ops for it → the pin stays byte-identical. All four shipped biomes are `>= 64`.

**6. Hazard-free recovery lane?**
- Decision: keep row `floorRow-1` (the floor walk) + recovery-stone tops hazard-free —
  reserve recovery-stone top cells in the `occupied` mask (the `branchTreasure` reservation
  pattern) and reject row `floorRow-1` in `scatterHazards`, both width-gated.

**7. `MAX_FLOOR_RECOVERY_GAP` value?**
- Decision: 10 tiles (320px). Stones are actually spaced `<= MAX_GAP (4)` so the same-row
  reach-chain holds; that easily satisfies the looser locality bound with margin. 10 is the
  tunable user-facing "max walk before a way up." The verifier enforces it.

**8. Shared gap/coverage computation (review r1 item 6)?**
- Decision: export `floorRecoveryGaps(remounts, cols)` + `isRemountRun(p, floorRow, cols)`
  from LevelGenerator (the `platformStep` DRY pattern); the generator calls them on
  critical+placed SOLID, the verifier on emitted SOLID. Identical boundary semantics.

**9. Existence guarantee — the bridge CANNOT fail (review r2 item 1)?**
- THEOREM. For any maximal uncovered gap `[lo,hi]`: (i) rows `floorRow-1..floorRow-3` are
  EMPTY in columns `[lo,hi]` at recovery time — any SOLID there would satisfy `isRemountRun`
  and cover that column, contradicting "uncovered"; and only shell + critical + branch SOLID
  exist at recovery time (decoration/hazards run later), so there is no ONEWAY/HAZARD either.
  Hence a SOLID stone can ALWAYS be stamped at `floorRow-3` anywhere in the gap. (ii) Every
  gap has `>=1` bounding re-mount: if `lo>1` then `lo-1` is covered; if `hi<cols-2` then
  `hi+1` is covered; the only remaining case (`lo=1 && hi=cols-2`, the whole interior) is
  impossible because every template stamps a SOLID critical platform IN the band — staircase
  start row `[floorRow-3, floorRow-1]` (line 376), islands `[floorRow-2, floorRow-1]` (459),
  shaft's last platform `>= floorRow-2` (418) — so at least one interior column is always
  covered. Placing stones at edge-gap `<= MAX_GAP` across `[lo,hi]`, the first within
  `MAX_GAP` of the bounding re-mount, yields a same-row reach-chain from that re-mount across
  the gap. Therefore coverage (AC1) and reconnection (AC2) hold BY CONSTRUCTION for every
  gap — `placeRecoveryBridges` is total. The verifier re-proves it independently per seed.
  Boundary note (Decision 13): the interior-clamped coverage means a leading/trailing gap's
  edge column (col 1 or cols-2) may be left bare by a stone confined to `[2, cols-3]`, but a
  single bare column has width `1 <= MAX_FLOOR_RECOVERY_GAP` and is recoverable by hopping
  onto the adjacent stone — so locality still holds at the boundaries.

**10. Re-mount representative cell + edge direction (review r1 item 4)?**
- Decision: use `cellAbove(p)` (DRY — no `clampMid`). Stones are same-row (`dy=0`), so their
  reach edges are symmetric; the stone→re-mount and re-mount→chain edges are the directed
  `canReachPlatform(lower, higher)` edges the BFS traverses.

**11. Reconnection check cost (review r1 item 5)?**
- Decision: ONE reverse-BFS from the exit per description (reverse-adjacency over the
  SOLID+ONEWAY graph), then membership-test each SOLID re-mount against the reaches-exit set.

**12. Floor→stone mount soundness pinned (review r2 item 2)?**
- The verifier's floor→stone edge is `canReachStep(0,-3)=true` because `platformStep(floor,
  stone)` reports `dx=0` (the full-width floor span overlaps the stone columns). Physically
  the mount is an offset up-and-over hop launched from the floor BESIDE the stone — sound
  because the floor is a contiguous full-width run AND, since stones sit at `floorRow-3`
  (player fits under), the floor is never segmented, so a clear adjacent launch column always
  exists. The gap's bottom band being empty (Decision 9) also keeps the short mount/hop arcs
  clear; arc clearance otherwise relies on the SAME point-envelope discipline the existing
  entrance→exit chain already uses (a documented, accepted assumption, not a new regression).

**13. `mergeRuns` wall fusion (review r3 item 1)?**
- `mergeRuns` (LevelGenerator.ts:312) fuses contiguous same-row SOLID, and the side walls are
  SOLID at EVERY row (lines 526–529). So a band-row stone or critical platform touching col 1
  or col `cols-2` fuses with the wall into a run that spills onto col 0 / `cols-1`. A strict
  `col >= 1 && col+len-1 <= cols-2` test would DROP such a run, uncovering those columns and
  failing AC1 on every leading/trailing gap.
- Decision: the re-mount accounting uses INTERIOR OVERLAP + interior-CLAMPED spans, not strict
  containment (see `isRemountRun` / `floorRecoveryGaps` in §6). A wall-fused run still
  contributes its interior columns. This also fixes a PRE-EXISTING latent case the new check
  newly exercises: `buildShaft` `startCol` can be 1 (line 411), so a legitimate critical
  platform reaches the wall at a band row. Belt-and-suspenders: recovery stones are confined
  to `[2, cols-3]` (Decision 9 boundary note) so stones themselves never fuse with walls; the
  interior-clamp is what keeps critical-at-edge sound.

## 6. Design

### Constants (`src/world/LevelGenerator.ts`, near the branch/layout gates)

- `RECOVERY_MIN_COLS = 50` — width gate (mirrors `LAYOUT_MIN_COLS` / `BRANCH_MIN_COLS`).
- `RECOVERY_REMOUNT_UP = MAX_STEP_UP` — a SOLID run whose top is `<= 3` tiles above the floor
  is a re-mount obligation; recovery stones sit at exactly this height.
- `MAX_FLOOR_RECOVERY_GAP = 10` — max consecutive uncovered interior floor columns.
- Sub-RNG mix constant `0x5eca1add`.

### Shared pure helpers (exported — used by generator AND verifier, Decision 8)

- `isRemountRun(p, floorRow, cols)` → SOLID + band row + a NON-EMPTY interior overlap:
  `p.type === SOLID && p.row >= floorRow - RECOVERY_REMOUNT_UP && p.row < floorRow &&
  max(p.col, 1) <= min(p.col + p.len - 1, cols - 2)`. It tests interior OVERLAP, NOT strict
  containment (Decision 13) — `mergeRuns` fuses a band run that touches col `1`/`cols-2` with
  the full-height side wall (col `0`/`cols-1`), so the emitted run can spill onto a wall; the
  overlap test still accepts it while excluding the floor run (row `== floorRow`) and a
  pure 1-wide side-wall run (interior overlap empty).
- `floorRecoveryGaps(remounts, cols)` → for each re-mount, the COVERED columns are its
  INTERIOR-CLAMPED span `[max(p.col, 1), min(p.col + p.len - 1, cols - 2)]` (so a wall-fused
  run contributes its interior columns, not its wall column). Returns the maximal interior
  intervals `[lo,hi]` in `[1, cols-2]` not covered AND longer than `MAX_FLOOR_RECOVERY_GAP`
  (leading gap from col 1 and trailing gap to col `cols-2` included). The single locality
  metric both sides use; clamping makes the generator's un-merged view and the verifier's
  merged view yield the identical covered-column set.

### `placeRecoveryBridges(tiles, cols, rows, critical, rng, lenMin, lenMax)` → `Platform[]`

Called in `generateLevel` immediately AFTER `placeBranch` (line ~594) and BEFORE the
`occupied` mask is built (line ~601), so stamped stones join the occupied mask and feed
`collectStandable`.

1. `if (cols < RECOVERY_MIN_COLS) return []`. `floorRow = rows - 1`,
   `interiorMax = cols - 2`. Seed a working SOLID re-mount list from the EMITTED in-band SOLID
   runs (critical + branch via `isRemountRun`) so the generator's gap view matches the
   verifier's.
2. `gaps = floorRecoveryGaps(remounts, cols)`. For each gap `[lo,hi]`, pick a bounding
   re-mount (the covered column at `lo-1`, else at `hi+1` — Decision 9 guarantees one), and
   the placement direction inward.
3. Lay stones across `[lo,hi]`: the first stone's near edge `<= MAX_GAP` from the bounding
   re-mount, each subsequent stone's near edge `<= MAX_GAP` from the previous (so every
   consecutive pair is a `canReachStep(<=MAX_GAP, 0)` reach edge), each a SOLID run
   `makeRun(col, floorRow - RECOVERY_REMOUNT_UP, randInt(rng, lenMin, lenMax), cols - 3)`
   stamped into `tiles`. Stones are confined to columns `[2, cols-3]` (clamp via `cols-3`,
   not `interiorMax`) so a stone never abuts a side wall and never fuses with it in
   `mergeRuns` (Decision 13). No clearance check is needed — the band is provably empty
   (Decision 9) — but defensively assert each stamped cell is EMPTY (a no-op that documents
   the invariant). Append each stone to `remounts` so coverage accounting stays current.

   **Revised during implementation:** each stone's RIGHT edge is additionally clamped to the
   gap's `hi` (`makeRun(col, stoneRow, len, min(cols-3, hi))`), so a stone never spills its
   LENGTH past the gap into a COVERED column. This is load-bearing: a covered column is
   exactly where a re-mount AND any standable cell (entrance/exit/branch) lives — a standable
   cell at `stoneRow` always has its support in the band, so its column is always covered and
   thus never in a gap. Confining stones to `[lo,hi]` therefore makes burying a goal cell
   impossible. (Found via a `shaft` seed where a low exit cell sat at `stoneRow` and an
   adjacent gap's stone spilled onto it — caught by the verifier's `exit cell is not EMPTY`
   check, fixed by the clamp, re-verified across the full 200×4 sweep.)
4. Return the list of stamped stones.

By Decision 9 this is total: a stone is always placeable in the empty band, and the chain
always anchors to a bounding re-mount that is on the proven entrance→exit chain — so every
stone reaches the exit (AC2) and the gap is covered to `<= MAX_GAP < MAX_FLOOR_RECOVERY_GAP`
(AC1).

### Call site + hazard-free lane (`generateLevel`)

- After `placeBranch`: `const recovery = placeRecoveryBridges(tiles, cols, rows, critical,
  mulberry32((seed ^ 0x5eca1add) >>> 0), lenMin, lenMax)`.
- After `buildOccupiedMask`: for each recovery stone, reserve its TOP row (`stone.row - 1`
  across its span) in `occupied` (the `branchTreasure` reservation pattern) so decoration
  never lands where the player stands.
- In `scatterHazards`: reject candidate cells on row `rows - 2` (`= floorRow-1`) when
  `cols >= RECOVERY_MIN_COLS` (it already draws `row` in `[3, rows-2]`,
  LevelGenerator.ts:1041). Width-gated so the pin is unchanged.

### Verifier — `checkFloorRecovery(desc)` (`scripts/verify-gen.mjs`)

Called from `checkDescription` after the traversability BFS, for normal levels only, gated
`if (desc.cols < RECOVERY_MIN_COLS) return null` (the pin is exempt, mirroring the
generator). Independent re-derivation from EMITTED `platforms`, importing the shared
`floorRecoveryGaps` + `isRemountRun` + `cellAbove` from LevelGenerator (DRY):

1. `floorRow = desc.rows - 1`. `remounts` = emitted runs passing `isRemountRun` (SOLID-only).
2. Locality (AC1): `floorRecoveryGaps(remounts, desc.cols)` must be EMPTY. Same function as
   the generator → no boundary drift.
3. Reconnection (AC2): build the SOLID+ONEWAY reach graph ONCE; compute the reaches-exit set
   via a single reverse-BFS from `platformSupporting(exit)` over reverse adjacency. Assert
   every `remount` is in that set. The re-mount's representative cell uses its INTERIOR-CLAMPED
   midpoint column `mid = floor((max(p.col,1) + min(p.col+p.len-1, cols-2)) / 2)` at row
   `p.row - 1` (not the raw run midpoint), so a wall-fused run always resolves to an interior
   standable cell whose `platformSupporting` is the run itself.
4. Hazard-free lane (AC4): assert no `TILE.HAZARD` on row `floorRow - 1`.

Update the final summary `console.log` to mention floor-recovery (AC1/AC2/AC4).

### Determinism / pin safety

- `placeRecoveryBridges` uses an off-the-main-thread sub-RNG → the main draw sequence is
  byte-unchanged.
- All changes are gated at `cols >= RECOVERY_MIN_COLS (50)`; `PIN_BIOME.cols = 40`, so the
  pinned tiles + structured fields are byte-identical, and `checkFloorRecovery` early-returns
  null for it. The existing pin assertion re-confirms.

## 7. Files Changed

- `src/world/LevelGenerator.ts` — add the recovery constants; export the shared
  `floorRecoveryGaps` + `isRemountRun` helpers; add `placeRecoveryBridges`; call it after
  `placeBranch`; reserve recovery-stone tops in the `occupied` mask; reject row `floorRow-1`
  in `scatterHazards` (width-gated).
- `scripts/verify-gen.mjs` — import the shared helpers; add `checkFloorRecovery` (locality +
  single reverse-BFS reconnection + hazard-lane); call it from `checkDescription`; update the
  summary log line.

## 8. Verification

1. [AC1] `npm run verify` — `checkFloorRecovery` asserts `floorRecoveryGaps` is empty across
   the 200-seed × 4-biome sweep (the boss-arena sweep routes through `checkBossArena`, not
   `checkDescription`, so it is unaffected).
2. [AC2] `npm run verify` — the single reverse-BFS reaches-exit set contains every SOLID
   re-mount.
3. [AC3] `npm run verify` — the existing `bfsTraversable`/branch checks still pass; recovery
   edges are reach-bounded.
4. [AC4] `npm run verify` — no hazard on row `floorRow-1` for `cols >= 50`.
5. [AC5] `npm run verify` — the regression-pin assertion passes unchanged (cols:40 gated).
6. [AC6] `npm run typecheck` passes; `grep -n "phaser" src/world/LevelGenerator.ts` returns
   nothing (still pure). Manual spot-check: load a wide biome, fall to the floor under a high
   chain stretch, confirm a nearby stepping-stone bridge lets you climb back without
   backtracking, and that you can still walk the floor freely under the stones.
