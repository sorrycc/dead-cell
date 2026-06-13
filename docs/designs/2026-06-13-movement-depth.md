# Movement Depth (double-jump + wall-slide + wall-jump)

## 1. Background

`Player` has a competent base kit: accel/friction run, variable-height jump, coyote time,
jump buffer, fall-gravity juice, and a dodge-roll with i-frames + cooldown
(`src/entities/Player.ts`). But it is **single-jump only** — a `grep` for
`doubleJump|wallJump|wallSlide|airJump|jumpsLeft` finds nothing. Dead Cells' traversal feel
comes from **double-jump + wall-cling/wall-jump**: vertical mobility that makes platforming
expressive and gives combat repositioning.

### The load-bearing constraint (read this first)

`world/LevelGenerator.ts` derives a **jump-reach envelope** (`rawReachPx`, `canReachStep`,
`canReachPlatform`) **from the player's single full jump** (`JUMP_VELOCITY=620`,
`GRAVITY=1500`, `FALL_GRAVITY_EXTRA=900`, `RUN_SPEED=320`, mirrored at `LevelGenerator.ts:191`).
Module-load assertions (`assertBudgetsSound`, `:269`) prove `MAX_GAP`/`MAX_STEP_UP` sit inside
that envelope, and `scripts/verify-gen.mjs` BFSes every generated level via `canReachPlatform`
to prove **entrance→exit is traversable**. The whole soundness claim is:

> a verifier PASS ⇒ the **real player can make every jump** the generator emitted.

That claim is anchored to the **single full jump**. Any movement change must not break it.

## 2. Requirements Summary

- **Goal:** Add **double-jump** (one air jump), **wall-slide**, and **wall-jump**, tuned to the
  existing squash/stretch + tint juice, with the audio hooks from the SFX slice.
- **The cardinal rule — additive reach only:** the new moves only ever *increase* the player's
  reach. We do **not** change `JUMP_VELOCITY`/`GRAVITY`/`RUN_SPEED`, and we do **not** make the
  generator emit jumps that *require* the new moves. Therefore `LevelGenerator`'s envelope,
  its module-load assertions, `canReachStep`/`canReachPlatform`, and the verifier BFS are
  **unchanged**, and every level stays beatable with the base jump alone. The new moves are a
  strict *superset* of reachability — comfort + combat utility, never a gate.
- **Non-goals (YAGNI):** ledge-grab/mantling, dash-chaining beyond the existing dodge, grappling,
  generator changes to add tall climbable walls (the geometry caveat below).

## 3. Acceptance Criteria

1. **Double-jump:** exactly **one** air jump after leaving the ground (coyote does not consume
   it); resets on landing **and** on a wall-jump; the variable-height release-cut applies to it
   too; consumed once per airtime.
2. **Wall-slide:** while airborne, descending, and pressing **into** a contacted wall
   (`body.blocked.left/right` on the held-direction side), the fall speed is clamped to a slow
   `WALL_SLIDE_SPEED`; a visual + (throttled) audio tell plays.
3. **Wall-jump:** pressing jump while wall-contacting launches the player **up and away** from
   the wall (vx kicked away, vy = jump velocity), **refreshes** the air jump, and applies a
   brief re-stick lockout so the player doesn't immediately re-cling.
4. **Feel parity:** reuses the existing squash/stretch + tint pipeline and the
   `Sound` hooks (`doubleJump`/`wallJump`); coyote, jump buffer, variable jump, fall-gravity,
   and dodge are **unchanged** for the base case.
5. **SOUNDNESS PRESERVED (the headline):** `world/LevelGenerator.ts` — its physics-mirror
   constants, `rawReachPx`, `canReachStep`, `canReachPlatform`, and the `assertBudgetsSound`
   block — are **byte-unchanged**; `scripts/verify-gen.mjs` is **unchanged** and stays green;
   every generated level remains entrance→exit traversable with the base single jump.
6. **Base-arc identity:** `JUMP_VELOCITY`/`GRAVITY`/`FALL_GRAVITY_EXTRA`/`RUN_SPEED` are
   untouched, so the ground jump arc/height and the dodge feel exactly as today; a player who
   never uses the new moves plays identically.

## 4. Problem Analysis

- **Approach A — raise reach by tuning the base jump higher** → rejected: it changes the
  envelope, forces a re-tune of `MAX_GAP`/`MAX_STEP_UP` + the assertions + the pin, and risks
  the soundness proof. We explicitly do **not** touch base physics.
- **Approach B — make the generator emit double-jump-sized gaps** (a higher envelope keyed to
  double-jump) → rejected (this slice): it would make the new move *mandatory* and entangle the
  soundness proof with air-jump state (which the BFS can't model simply). A future "advanced
  traversal biome" could do this behind its own envelope; out of scope.
- **Approach C (chosen) — additive moves on top of an unchanged single-jump generator.** The
  generator keeps proving the *floor* (every level beatable with one jump); the new moves only
  make traversal easier/faster/expressive. Zero generator/verifier risk, all the feel.
- **Geometry caveat (accepted):** most platforms are 1-tile-tall horizontal runs; the tall
  vertical surfaces are the **room side walls** + occasional stacked platform edges. So
  wall-slide/jump shine at room edges + stacks, less mid-room. That is fine — it's net-positive
  feel and the generator isn't built around it (KISS — no generator change to add walls now).
  Wall detection uses `body.blocked.left/right`, which thin horizontal one-way ledges don't
  trigger (they collide from above only), so no false clings.

## 5. Decision Log

**1. Additive reach only (the cardinal decision).**
- Decision: the new moves never reduce reach and the generator is unchanged, so `canReachStep`
  remains a sound *under*-estimate of true reach. A verifier PASS still implies the real player
  (now strictly more mobile) can make every jump. This is the entire reason the change is safe;
  `LevelGenerator.ts` + `verify-gen.mjs` are explicitly **not** edited.

**2. One air jump (not N).**
- Decision: `AIR_JUMPS_MAX = 1`. `airJumpsLeft` is set to `AIR_JUMPS_MAX` on ground/coyote and
  on a wall-jump; an air jump (jump pressed while airborne and `coyoteTimer<=0` and
  `airJumpsLeft>0`) consumes one. KISS + matches Dead Cells' default.

**3. Wall-slide trigger + clamp.**
- Decision: airborne **and** `body.velocity.y > 0` (descending) **and** the held `moveX` points
  into a side where `body.blocked[side]` → clamp `vy` to `WALL_SLIDE_SPEED` (e.g. ~140 px/s, far
  under terminal 1100). A `wallDir` (−1/+1) records which wall. Releasing the into-wall input or
  touching ground ends the slide.

**4. Wall-jump impulse + re-stick lockout.**
- Decision: jump pressed while `wallDir !== 0` (or wall-contacting) → `vy = -JUMP_VELOCITY`,
  `vx = -wallDir * WALL_JUMP_VX` (away from the wall), set `airJumpsLeft = AIR_JUMPS_MAX`
  (refresh), and `wallJumpLockoutTimer = WALL_JUMP_LOCKOUT` (~0.12s) during which into-wall
  input is ignored for re-clinging (so you arc away instead of re-sticking). The variable-height
  cut still applies.

**5. Precedence with existing states.**
- Decision: dodge (`DODGE`) and hurt-knockback keep priority over wall/air logic (unchanged
  precedence DODGE > ATTACK > RUN; HURT lockout still owns vx). Wall-slide only adjusts the
  fall clamp in the RUN/air path; wall-jump/air-jump resolve in the existing **step 3 jump
  resolution** block. No new top-level state — just a few guarded branches (KISS, mirroring how
  the enemy FSM stays one machine with `behavior` branches).

**6. Default-on vs meta-gated.**
- Decision: **default-on** (immediate feel win, KISS). A meta gate (Dead Cells "runes") is a
  trivial later add (an upgrade row + a `Player` flag) and could live in the build/replay slice;
  noted, not done here.

## 6. Design

All changes are in `src/entities/Player.ts`. New constants (next to the jump/dodge block):

```ts
const AIR_JUMPS_MAX = 1            // one mid-air jump.
const WALL_SLIDE_SPEED = 140      // px/s — clamped descent while clinging (≪ MAX_FALL_SPEED).
const WALL_JUMP_VX = 360          // px/s — horizontal kick away from the wall.
const WALL_JUMP_LOCKOUT = 0.12    // s — ignore into-wall input after a wall-jump (no re-stick).
```

New state (ctor): `this.airJumpsLeft = 0`, `this.wallDir = 0`, `this.wallJumpLockoutTimer = 0`.

`update(dt, input)` integration (reusing the documented step order):

- **Step 1 (timers):** decay `wallJumpLockoutTimer`.
- **Step 1/floor edge:** on `onFloor` (and on the existing coyote refresh) set
  `airJumpsLeft = AIR_JUMPS_MAX`.
- **New wall-state (after step 2 horizontal control, before/within step 3):** compute
  `wallDir`:
  ```ts
  const intoLeft  = input.moveX < 0 && body.blocked.left
  const intoRight = input.moveX > 0 && body.blocked.right
  this.wallDir = !onFloor && this.wallJumpLockoutTimer <= 0 && (intoLeft ? -1 : intoRight ? 1 : 0)
  const sliding = this.wallDir !== 0 && body.velocity.y > 0
  if (sliding && body.velocity.y > WALL_SLIDE_SPEED) body.setVelocityY(WALL_SLIDE_SPEED)
  ```
- **Step 3 (jump resolution), extended:** the buffered-jump branch now resolves in priority:
  1. ground/coyote jump (unchanged) — consumes buffer + coyote;
  2. else **wall-jump** if `this.wallDir !== 0` → up + away kick, refresh `airJumpsLeft`, arm
     `wallJumpLockoutTimer`;
  3. else **air-jump** if `airJumpsLeft > 0` → `vy = -JUMP_VELOCITY`, `airJumpsLeft--`.
  The existing variable-height release-cut (`!jumpHeld && vy < -JUMP_CUT_VELOCITY`) is unchanged
  and applies to all three.
- **Step 6 (visuals):** a `_kickScaleY` stretch on air-jump/wall-jump (reuse `JUMP_STRETCH_Y`);
  a subtle tint or the slide particle while `sliding`. `this.sound?.doubleJump()` /
  `wallJump()` at the respective launches (null-safe; depends on the audio slice — guarded).

**No changes** to: `world/LevelGenerator.ts`, `scripts/verify-gen.mjs`, `config/*`,
`core/RunState.ts`, `core/Input.ts` (the jump key + `moveX` are reused — wall-slide reads the
existing `moveX` into-wall, wall-jump reads the existing jump edge).

### Soundness argument (explicit)

`canReachStep(dx, dy)` returns true only when `|dx|·TILE ≤ rawReachPx(dy)` with a 0.7 margin on
the single-jump trajectory. Double-jump and wall-jump add upward/horizontal capability on top of
that, so the **set of reachable platform pairs grows** — every edge the BFS asserts is still
makeable (now with margin to spare), and no new generator edge is introduced. The proof's
premise ("reachable with one jump") is untouched, so the conclusion ("the player can traverse")
strengthens, never weakens. Hence `LevelGenerator`/`verify-gen.mjs` need no edit and stay green.

## 7. Files Changed

- `src/entities/Player.ts` — the entire change: 4 constants, 3 state fields, wall-state branch,
  extended jump resolution, visual/audio hooks.
- `src/audio/Sound.ts` — add `doubleJump()` / `wallJump()` cues (if the audio slice is in;
  otherwise the calls are null-safe `this.sound?.…`).
- **Explicitly unchanged:** `src/world/LevelGenerator.ts`, `scripts/verify-gen.mjs`
  (the soundness proof) — this is an acceptance criterion, not an omission.

## 8. Verification

1. `npm run verify` — **green and unchanged** (the headline: the soundness proof still passes
   with no edits to the generator/verifier — confirms reach is only additive).
2. `npm run typecheck` — passes.
3. Manual (`npm run dev`): jump → a second air jump fires once; land resets it; press into a
   side wall while falling → slow slide; jump off it → arc up and away + the air jump is
   refreshed (so wall-jump→air-jump chains); base ground jump height/feel unchanged; dodge
   unchanged; play a few full levels to confirm every room is still completable (and now
   smoother) — no soft-locks.
