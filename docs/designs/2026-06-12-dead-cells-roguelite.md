# Dead Cell — A Dead Cells–style 2D Roguelite Action-Platformer (v1)

> Living design doc. It covers ALL 8 build phases as a skeleton; each phase's `Design`
> section is filled in just-in-time when that phase is implemented (no speculative
> over-engineering of future phases — YAGNI). Format mirrors the sibling `crowd-runner`
> design docs: Background → Requirements → Acceptance Criteria → Decision Log → per-phase
> Design → Files → Verification.

---

## 1. Background

Build, from an empty repo, a 2D roguelite action-platformer in the spirit of **Dead Cells**:
procedurally generated, multi-biome runs; **permadeath**; fast melee + ranged combat with a
**dodge-roll** (i-frames); enemies driven by **state machines**; **multi-phase bosses**; and
**persistent meta-progression** between runs. The core loop is:

> **Hub** (spend permanent currency) → **Run** (procedural biomes, fight, collect) →
> **Death/Victory** → back to Hub (permanent upgrades persist) → repeat.

Two currencies, exactly like the reference:

- **Cells** — dropped by enemies; spent in the **Hub** on **PERMANENT meta-upgrades**
  (survive death; the meta economy).
- **Gold / Scrolls** — **RUN-ONLY** boosts (lost on death; the in-run economy).

**Stack & shape (pre-decided by the user):** **Phaser 3 + Vite**, ES modules
(`"type":"module"`), **programmer-art PRIMITIVES ONLY** (colored rectangles / simple shapes
via Phaser `Graphics` or generated textures) — **no external sprite or audio assets**. The
state machine is expressed as Phaser **Scenes** (Boot / Title / Hub / Game / HUD / GameOver /
Victory); **HUD runs as a PARALLEL overlay scene** over Game. Platforming uses **Arcade
Physics**. Governing conventions: **KISS, YAGNI, DRY, SOLID** (user global CLAUDE.md).

Conventions mirrored from `crowd-runner` (sibling reference, never modified): layered modules
(`scenes/ core/ world/ entities/ combat/ config/ effects/ util/`); seeded determinism via
`util/rng.js` `mulberry32` (copied verbatim) for ALL procedural generation; generator + config
modules kept **PURE** (no Phaser import) so `scripts/verify-gen.mjs` can import and test them
headlessly in node; object pooling for projectiles/particles; frame-rate independence (Phaser
`dt`; smoothing as `1 - exp(-k·dt)`); heavy, intent-revealing comments that reference design
sections + acceptance criteria.

---

## 2. Requirements Summary

**Goal:** A complete, polished Dead Cells–style roguelite loop, built in 8 incremental phases,
each shippable and verifiable on its own, ending in a fully playable game with permadeath,
procedural biomes, combat, bosses, and persistent meta-progression.

**In scope (whole game, delivered across phases):**

- **Scaffold** (Phase 0): Phaser+Vite project, all scene stubs, seeded RNG, save helpers, design
  doc, clean `npm install` + `npm run build`.
- **Platformer core** (Phase 1): a controllable player rectangle with run / jump / gravity /
  ground + wall collision on Arcade Physics, on a small hand-made test room.
- **Procedural levels** (Phase 2): pure, seeded biome/room generators producing solid tilemaps
  (platforms, gaps, walls, doors) verified headlessly by `scripts/verify-gen.mjs`.
- **Combat** (Phase 3): melee swing + ranged projectile (pooled), hit detection, damage,
  knockback, dodge-roll with i-frames, hitstop / screen-shake juice.
- **Enemies** (Phase 4): enemy entities with **state-machine AI** (idle/patrol/chase/attack/
  hurt/dead), contact + attack damage, **Cells** drops on death.
- **Run economy + biome flow** (Phase 5): chain rooms/biomes into a run; doors/exits; **gold &
  scrolls** (run-only) pickups + in-run upgrade choices; **Cells** banked toward meta.
- **Bosses** (Phase 6): a **multi-phase boss** with telegraphed attacks, an arena, and a phase
  transition; victory ends the run.
- **Meta-progression + Hub** (Phase 7): the **Hub** scene where banked **Cells** buy
  **permanent** upgrades; persistence to **localStorage** (`util/save.js`); permadeath wiring
  (death → lose run-only loot, keep meta) — closing the full roguelite loop.

**Out of scope (v1):** networked/multiplayer; external art/audio assets; gamepad remapping UI;
mobile-specific controls beyond basic keyboard; a deep loot/affix system; cosmetics; cloud
saves; level editor.

---

## 3. Acceptance Criteria

> Phase-tagged. Each phase's verification step (§8) checks its own AC. ACs for future phases are
> intentionally high-level here and refined when that phase's `Design` section is filled in.

**Phase 0 — Scaffold (this phase, fully specified):**

1. `npm install` completes cleanly with only `phaser` (dep) and `vite` (devDep), `"type":
   "module"`, and scripts `dev` / `build` / `preview` / `verify` present.
2. `npm run build` completes with no errors and emits a `dist/` bundle.
3. `src/main.js` boots a `Phaser.Game` (full-screen canvas mounted by `index.html`) and
   registers all seven scenes: Boot, Title, Hub, Game, HUD, GameOver, Victory.
4. BootScene runs first and transitions to TitleScene.
5. TitleScene shows a title and a **Start** control that launches GameScene.
6. GameScene shows at least one static rectangle **platform** and a placeholder **player**
   rectangle that **falls under gravity** and lands on the platform — something is visibly on
   screen and moving.
7. `src/util/rng.js` exports `mulberry32` (byte-identical to crowd-runner) and `range`.
8. `src/util/save.js` exports defensive `get` / `set` (and a small typed wrapper) over
   `localStorage`, each wrapped in `try/catch` so a disabled/full storage never throws.
9. `docs/designs/2026-06-12-dead-cells-roguelite.md` exists as a full 8-phase skeleton with
   Phase 0 filled in.
10. `.gitignore` ignores `node_modules` and `dist`; `README.md` + `CREDITS.md` exist (CREDITS
    notes programmer-art, no external assets).

**Phase 1 — Platformer core (this phase, fully specified):**

11. Player moves left/right with **acceleration + friction** (not instant snapping) and faces the
    movement direction; bounded by `RUN_SPEED`; frame-rate independent (uses Phaser `dt`).
12. Gravity pulls the player down; downward speed is clamped to `MAX_FALL_SPEED`; the player
    collides with **ground, walls, and raised ledges** (Arcade static bodies) and cannot leave the
    room.
13. **Variable-height jump:** a full hold reaches max height; releasing the jump key while rising
    **cuts** the upward velocity (short hop). Jump uses Space **or** J.
14. **Coyote time:** a jump pressed shortly *after* walking off a ledge still fires.
    **Jump buffer:** a jump pressed shortly *before* landing fires on touchdown.
15. **Dodge-roll** (Shift **or** K): applies a horizontal **dash impulse**, grants **i-frames**
    (`isInvulnerable()` is true for the i-frame window, visualized by a tint/flash), runs for a
    fixed **duration**, then is gated by a brief **cooldown** before it can fire again.
16. A **one-way platform** exists: the player can jump **up through** it and **land on top** of it.
17. The **camera smoothly follows** the player with a **deadzone + lerp**, clamped to the room
    bounds (no jitter, never shows outside the room).
18. The player rectangle **squashes/stretches** on jump/land/dodge and **reads its facing
    direction** — the feel is visibly responsive and crisp.

**Phase 2 — Procedural levels (THIS PHASE — fully specified):**

> NOTE ON PHASE ORDER (continued from §3 Combat note). The orchestrator built **Combat first**
> ("Phase 2 · Combat", §6.3). Procedural levels — the doc's original "Phase 2" / §6.2 — are
> implemented NOW, on top of the Phase-1 platformer + the live Combat phase. The hand-built test
> room in GameScene (§6.1/§6.3) is REPLACED by a generated level; enemies/pickups spawn at the
> generated points; reaching the exit Door triggers a next-level transition.
>
> AC-NUMBERING (review fix — collision avoidance, per the §3 lettered-AC note). The skeleton's
> original Phase-2 placeholder was **AC19**; the Combat phase then reserved **20–26**. To avoid the
> ambiguity the doc warned about, Phase 2's expanded ACs KEEP the historical anchor **19** for the
> core "pure seeded deterministic generator" criterion and use the **next free integers 27–30** for
> the four it splits into — never reusing Combat's 20–26.

19. **Pure, seeded, deterministic generator.** `world/LevelGenerator.js` is a PURE module (NO Phaser
    import) exporting `generateLevel(seed, biomeConfig)` → a plain **level description** object: a
    `tiles` grid (each cell `EMPTY | SOLID | ONEWAY | HAZARD`), `cols/rows/tileSize`, an `entrance`
    and an `exit` tile position, `platforms` (the solid spans, for renderer convenience), and
    `enemies[]` + `pickups[]` spawn points (world coords). The SAME `(seed, biomeConfig)` always
    yields a byte-identical description (sequence-pinned in `verify-gen.mjs`).
27. **Guaranteed traversable entrance → exit (respecting jump reach).** The generator builds the
    level as a chain of solid platforms whose every (gap, step) is inside the PLAYER's real jump reach
    — a COUPLED 2-D envelope derived from `Player.js`/`constants.js` physics where the horizontal
    allowance is a FUNCTION of the vertical step (max climb ≈ 128px; horizontal reach shrinks as the
    climb grows), with a 0.7 safety margin so the envelope UNDER-estimates true reach (Decision 35).
    A headless BFS/flood over a jump-reachability graph rebuilt from the EMITTED platforms via the
    SHARED `platformStep`+`canReachStep` (in `verify-gen.mjs`) confirms the exit is reachable from the
    entrance for MANY seeds; generation is reach-bounded BY CONSTRUCTION so the check never fails, and
    a verifier PASS is SOUND (the real player can definitely make every proven jump).
28. **Within size + difficulty bounds; no spawn inside a wall.** Every generated level satisfies:
    `cols/rows` within `[MIN, MAX]`; a non-zero, in-bounds `exit` distinct from `entrance`;
    entrance + exit cells are `EMPTY` (standable, not buried); every enemy/pickup spawn sits on
    `EMPTY` ground with a `SOLID` (or `ONEWAY`) cell directly beneath it (never inside a wall, never
    floating); enemy count within `[minEnemies, maxEnemies]` from the biome config. `npm run verify`
    asserts ALL of these across a large seed sweep.
29. **TileMap → Arcade static bodies + primitive render.** `world/TileMap.js` (Phaser-coupled) turns
    a description into the room: solid/one-way spans become Arcade **static** bodies (merged per
    horizontal run, not one body per tile — fewer bodies), hazards render as a distinct primitive,
    and the whole grid renders as colored rectangles (programmer-art). It exposes the `solids`
    static group + the `oneWay` group for GameScene's colliders, and the world/camera bounds.
30. **`Door` exit + level transition.** `entities/Door.js` is the level EXIT placed at the
    description's `exit`; an overlap with the player triggers `onExit()`. GameScene wires it to a
    **next-level transition** (re-generate with the next seed and rebuild the room) — proving the
    run can advance from one generated level to the next. (Full multi-biome run flow + the real
    door-gating economy is Phase 5; this phase only proves the generate → play → reach-exit →
    next-level edge.)

**Phase 3 — Combat (THIS PHASE — fully specified):**

> NOTE ON PHASE ORDER. The build orchestrator schedules **Combat before Procedural levels**
> (it calls this "Phase 2 · Combat"). The doc keeps its original section numbering — Combat is
> §6.3 / "Phase 3" here — but is implemented NOW, on top of the Phase-1 platformer + the hand-made
> test room (§6.1), with no dependency on the §6.2 generator. Procedural levels (§6.2) are still
> a later phase. Where this section says "Phase 3" read "the Combat phase, built now".

20. **Player melee with a light combo chain.** Attack (J **or** left-click) spawns a **transient
    hitbox** in front of the player; chaining the input within a combo window advances a **2–3 swing
    light combo** (swing 1 → swing 2 → finisher), each swing with its own damage/knockback/reach and
    a brief recovery; letting the window lapse resets the chain to swing 1. Attacking is gated by a
    per-swing **active + recovery** lockout (you cannot spam a single frame into infinite hits).
21. **Damage resolution.** A swing's hitbox vs. an enemy hurtbox resolves **once per swing per
    enemy** (no multi-hit from one swing): subtract damage, apply **knockback** (away from the
    attacker), apply **hitstun** (the victim is briefly stunned), and start the victim's **hit
    i-frames** so the same swing/contact can't re-hit it next frame.
22. **BACKSTAB crit.** A hit that lands on an enemy **from behind** (attacker on the side the enemy
    is *not* facing) deals a **crit multiplier** of extra damage and a stronger knockback, with a
    distinct spark/number color — rewarding flanking + dodge-through play.
23. **Player HP + damage reaction.** The player has **HP** shown on the HUD; taking damage (enemy
    contact or enemy attack) subtracts HP, applies knockback, **flashes** the player, and grants a
    **damage i-frame** window during which further hits are ignored. The **dodge i-frames**
    (Phase 1 `isInvulnerable()`) also negate incoming hits — dodge-through is safe.
24. **Enemy with a state-machine AI.** A base `Enemy` runs an explicit FSM
    (**idle → patrol → chase → attack → hurt → dead**): patrols a ledge, **detects** the player
    within a range and **chases**, **telegraphes** then commits a melee attack in range, reacts to
    being hit (**hurt** = knockback + hitstun, interrupts its action), and **dies** at 0 HP. It
    damages the player on **contact** and on its **telegraphed attack**. ≥1 concrete enemy type is
    wired live into the test room.
25. **Game feel on impact.** Every damaging hit produces, from a **pooled** effects layer:
    **hit sparks** (particles), a **floating damage number** (crit-colored on backstab), a short
    **screen shake**, and a brief **hit-stop** (a few ms of frozen time) — all scaled to hit
    strength, all framerate-independent, none allocating per-hit after warm-up.
26. **Death handoff (placeholder).** Player HP reaching 0 triggers a **placeholder transition**
    (a short freeze/flash, then back to Title for now). The real GameOver / permadeath wiring is a
    later phase — this phase only proves the death edge fires exactly once.

> NOTE (review fix — AC-number collision). The skeleton ACs for later phases are LETTERED
> (`AC-P4`…`AC-P7`) so they never collide with the numbered, fully-specified ACs above. Earlier
> revisions reused `21`–`24` here, which made "AC21" ambiguous when grepped. The numbers `20`–`26`
> are now reserved for the Combat phase ONLY; future phases will renumber their letters to the next
> free integers when they are fully specified.

**Phase 4 — Run structure (THIS PHASE — fully specified):**

> NOTE ON PHASE ORDER + SCOPE. The build orchestrator schedules **"Phase 4 · Run structure"** to
> ASSEMBLE THE RUN on top of the live procedural-levels + combat phases — an ordered, scaling
> sequence of biomes carried by a single `RunState`, ending each run in a real **GameOver** summary.
> This is the run-FLOW half of the doc's original §6.5 "Run economy + biome flow" block (the run-only
> gold/scrolls **economy** + the Cells-to-meta bank are deferred to a later phase — YAGNI here). The
> doc keeps its section numbering: this phase fills **§6.4** (the next empty per-phase slot) and the
> §6.5 stub is retitled to the deferred economy. AC NUMBERING (continuing the §3 convention): the
> numbered fully-specified ACs reuse the next free integers **42–47** — never colliding with Combat's
> 20–26 or Levels' 19/27–30 (the lettered `AC-P5`…`AC-P7` for un-implemented phases are unchanged).

42. **Pure scaling curve by depth, monotonic, shared by game + verifier.** `config/difficulty.js` is a
    PURE module (NO Phaser import) exporting `scaleAtDepth(depth)` → a plain `{ enemyHpMult,
    enemyDamageMult, enemyCountBonus, … }` scalar set that RISES with `depth` (mirrors crowd-runner's
    `config/difficulty.js` role: ONE source of "how hard is depth N", imported by BOTH GameScene and
    `verify-gen.mjs`). Across the full ordered biome sequence the effective difficulty is
    **non-decreasing** with depth (review fix — the intended property is NON-DECREASING, allowing the
    speed-cap plateau / intra-tier flat; NOT "strictly increasing"); `npm run verify` asserts this over
    every depth in the run.

43. **Ordered multi-biome list with rising tiers.** `config/biomes.js` exports an ORDERED `BIOME_ORDER`
    (≥3 biomes, e.g. Prison → Sewers → Ramparts) — each a PURE config with its own theme colors, enemy
    pool, length (`cols`), a `levels` count (how many GENERATED rooms the biome spans before the run
    rolls to the next — BLOCKER 1 / Decision 50), `difficultyTier` (a monotonic-non-decreasing integer
    index), and a `endsInBoss` flag (false for now — bosses are Phase 6). Later biomes are visibly
    harder (higher tier → the curve plus the per-biome base produce more/tankier enemies). The ordering
    + tiers are the single source the run walks and the verifier checks.

44. **`RunState` carries the active run.** `core/RunState.js` is a PURE class/factory holding the run's
    `seed`, `biomeIndex`, `depth`, the player's carried `hp`/`maxHp` (persisted between levels — HP is
    NOT refilled on transition), currency PLACEHOLDERS (`cells`, `gold` — fields present, spending is a
    later phase), an `inventory` placeholder, and run stats (`kills`, `startedAt`). It exposes
    `advance()` (next biome/depth + next seed) and `isLastBiome()`. GameScene OWNS one `RunState` for the
    active run; it is the single source of truth the scene reads to build each level.

45. **GameScene builds the current biome, scaled by depth.** GameScene reads the current biome from
    `RunState` (`BIOME_ORDER[biomeIndex]`), generates THAT biome's level (`generateLevel(runState.seed,
    biome)`), and **scales enemy stats by depth** at spawn: each enemy's `maxHp`/`contactDamage`/swing
    damage is multiplied by `scaleAtDepth(runState.depth)` (a per-spawn derived spec, not a mutated
    shared `BRUTE_SPEC`). Reaching the Door **advances** the run (`runState.advance()`) and regenerates
    the next biome's level in place; the player's HP is carried, not reset. Multiple biomes play in
    sequence with VISIBLY rising difficulty.

46. **Player death → GameOver run summary.** When the player's HP reaches 0, GameScene hands off to a
    real **GameOverScene** (no longer the placeholder Title bounce) carrying a RUN SUMMARY: depth
    reached, biome name, run time, and kills. GameOverScene displays the summary and routes back to
    **Title/Hub**. The death edge fires exactly once (the existing `gameOver` guard).

47. **Run completion is reachable + deterministic.** Advancing past the LAST biome ends the run cleanly
    (for now: a run-complete handoff to GameOver/Victory carrying the summary — boss-gated victory is
    Phase 6). The whole seed chain (start seed → per-biome seeds) is deterministic, so a given start seed
    replays the same biome sequence + layouts; `npm run verify` re-proves the seed-chain + curve
    determinism headlessly.

**Phase 5 — Run economy (gold/scrolls + Cells bank) *(deferred from §6.5; filled when implemented)*:**

- **AC-P5.** Within a run, **gold/scrolls** are run-only boosts (lost on death) and in-run upgrade
  choices appear; killed enemies' **Cells** are banked toward meta. (The run FLOW + multi-biome
  chaining is delivered in Phase 4 above; this phase adds the two ECONOMIES on top of it.)

**Phase 6 — Bosses:**

- **AC-P6.** A multi-phase boss telegraphs attacks, transitions phases at an HP threshold, and on
  defeat triggers Victory.

**Phase 7 — Meta-progression + Hub:**

- **AC-P7.** The Hub spends banked **Cells** on **permanent** upgrades persisted to localStorage;
  death loses run-only loot but keeps meta; relaunching the game restores meta state — the full
  permadeath roguelite loop is closed.

---

## 4. Problem Analysis

Greenfield, no prior art in this repo. The sibling `crowd-runner` (Three.js) sets the *coding
conventions* but not the *engine*: this project is **Phaser 3** with **Arcade Physics** and a
**Scene-based** state machine, which is a better fit for 2D platforming than a hand-rolled rAF
loop. Key forks settled below; future-phase forks are recorded when their phase is designed.

The central tension for a roguelite is **determinism vs. permadeath persistence**: procedural
generation must be **seeded + pure** (so it is testable headlessly and reproducible), while
meta-progression must **persist across runs** (localStorage). Phase 0 lays both foundations
(`util/rng.js` for the former, `util/save.js` for the latter) without yet using them, so later
phases plug in without re-architecting.

---

## 5. Decision Log

> Phase 0 decisions are final. Later entries are appended as each phase is designed.

**1. Engine & state machine — Phaser Scenes vs. a hand-rolled loop**
- Options: A) one big rAF loop with manual state enum (crowd-runner style) · B) Phaser 3
  `Scene` per game state, with `ScenePlugin` transitions.
- Decision: **B)** — Phaser Scenes ARE the state machine (Boot/Title/Hub/Game/HUD/GameOver/
  Victory). Each state is an isolated module with its own `create/update`, and transitions are
  `this.scene.start(...)`. Matches the user's mandated structure; idiomatic; less bespoke code.

**2. HUD as a parallel overlay scene**
- Options: A) draw HUD inside GameScene · B) a separate `HUDScene` run **in parallel** over
  GameScene via `scene.launch`.
- Decision: **B)** — `GameScene` does `this.scene.launch('HUD')`; HUD reads game state via the
  scene registry / events and renders on top. Keeps gameplay and UI decoupled (SOLID); HUD can
  be paused/relaunched independently of the world.

**3. Physics — Arcade vs. Matter**
- Options: A) Arcade Physics (AABB, fast, no rotation) · B) Matter.js (full rigid body).
- Decision: **A)** — Arcade is the right tool for a tile-based platformer: cheap AABB sweeps,
  one-way platforms, simple `body.blocked` flags. Matter's rotational dynamics are unneeded
  (YAGNI) and complicate deterministic tuning.

**4. Art pipeline — primitives only**
- Options: A) external sprite/audio assets · B) programmer-art primitives (Phaser `Graphics` +
  generated textures from rectangles/shapes).
- Decision: **B)** — mandated. No asset loading; BootScene can optionally bake a few solid-color
  textures via `make.graphics().generateTexture()` for reuse, but rectangles drawn directly are
  the baseline. Zero network asset fetches.

**5. Determinism — seeded `mulberry32`, pure generators**
- Options: A) `Math.random` in generators · B) seeded `mulberry32` + generator/config modules
  with **no Phaser import**.
- Decision: **B)** — copy crowd-runner's `util/rng.js` verbatim. Every procedural module is a
  pure function of `(seed, params)` so `scripts/verify-gen.mjs` can import it under plain node
  and assert determinism + solvability without a browser/Phaser. (Phase 0 ships the RNG + a
  `verify` script placeholder; Phase 2 adds the real generator + checks.)

**6. Persistence — localStorage via defensive helpers**
- Options: A) call `localStorage` directly at use sites · B) a single `util/save.js` with
  `get/set` wrapped in `try/catch` (mirrors crowd-runner's defensive style).
- Decision: **B)** — one module owns serialization + error swallowing, so a private-mode /
  full / disabled storage degrades to in-memory defaults instead of throwing. DRY + robust.

**7. Build tooling — Vite, base `"./"`**
- Options: A) raw ES modules + import map · B) Vite + npm, relative base.
- Decision: **B)** — Vite dev server + build; `base: './'` so the build runs from any sub-path /
  `file://`. Standard, matches crowd-runner.

**8. Scale mode — FIXED design resolution + FIT, NOT `Scale.RESIZE`**
- Options: A) `Scale.RESIZE` (canvas == viewport; world re-sizes on every resize) · B) a FIXED
  design resolution (`1280×720`) letterboxed to the viewport via `Scale.FIT` + `CENTER_BOTH`.
- Decision: **B)** — a roguelite platformer needs a **stable world coordinate system**:
  deterministic level layout, `camera.setBounds`, and tile math all assume constant dimensions.
  `RESIZE` re-sizes the world on every window resize, so entities positioned from viewport
  dimensions become a moving target and later phases (tilemaps, camera follow within bounds)
  would fight a stretching world. We render at a constant **1280×720** and let `FIT` scale +
  letterbox it. The design resolution lives in `src/config/constants.js` (`DESIGN_WIDTH/HEIGHT`)
  so `main.js` (canvas sizing) and every scene (positioning) share ONE source (DRY). Chosen now
  because it is foundational and expensive to retrofit.

**9. Gravity — PER-SCENE, not global in the Phaser.Game config**
- Options: A) set `physics.arcade.gravity.y = GRAVITY` globally in the game config · B) enable
  Arcade in the config WITHOUT gravity, and set `this.physics.world.gravity.y = GRAVITY` only in
  GameScene.
- Decision: **B)** — only GameScene has bodies. Title / Hub / HUD / GameOver / Victory are
  menu/overlay scenes that must not run a gravity-enabled Arcade world (YAGNI/SOLID). Global
  gravity couples every scene to physics it never uses. The `GRAVITY` constant is owned by
  `src/config/constants.js` (shared, single source) and applied per-scene in GameScene.

> Decisions 10–15 are Phase 1 (platformer feel). They are final for this phase; later phases
> append their own.

**10. Player = plain class holding a Rectangle + body, NOT a `Phaser.GameObjects` subclass**
- Options: A) subclass `Phaser.GameObjects.Rectangle` / `Arcade.Sprite` so the player IS a game
  object · B) a plain `Player` class that *holds* an `add.rectangle` + its Arcade body and is
  ticked by GameScene.
- Decision: **B)** — keeps the controller a focused single-responsibility unit (SOLID): all feel
  constants + the state machine live in one readable class, decoupled from Phaser's display-list
  lifecycle. Mirrors crowd-runner's entity pattern (`Crowd`/`Obstacle` are plain classes the loop
  ticks). A subclass would scatter feel logic across Phaser hooks and complicate later reasoning.

**11. Movement = accel/friction integration, NOT `setVelocityX` snapping**
- Options: A) `body.setVelocityX(±RUN_SPEED)` instantly on key state · B) integrate `vx` toward a
  target by `ACCEL·dt` / decay by `FRICTION·dt`, with reduced air control.
- Decision: **B)** — instant velocity feels robotic; Dead Cells' weight comes from ramping speed
  + friction + weaker air control. Integration with `dt` is framerate-independent and exposes the
  feel as tunable constants (`RUN_ACCEL/FRICTION`, `AIR_ACCEL/FRICTION`). KISS at the call site
  (one helper), expressive at the tuning site.

**12. Variable jump height = velocity-cut on early release (not a hold-timer)**
- Options: A) integrate jump force while the key is held for N frames · B) launch at full
  `-JUMP_VELOCITY` on press, then **cut** upward velocity (`vy = max(vy, -JUMP_CUT_VELOCITY)`) the
  moment the key is released while still rising.
- Decision: **B)** — the cut-on-release model is the standard, robust platformer pattern: it's a
  single branch, framerate-independent, and gives a crisp tap-hop ↔ full-jump spectrum without a
  per-frame force budget to balance. Hold-timers drift with framerate and feel mushy.

**13. Forgiveness = coyote time + jump buffer, both as `dt`-decayed timers**
- Options: A) require `body.blocked.down` exactly on the press frame · B) a `coyoteTimer`
  (refreshed on ground, decays airborne — lets a late jump fire) **and** a `jumpBufferTimer` (set
  on press, decays — lets an early jump fire on landing).
- Decision: **B)** — strict grounding makes the controller feel unresponsive (dropped inputs at
  ledge edges / on landing). Two short `dt`-decayed timers (~0.10s / ~0.12s) are the cheap,
  expected fix and make the control feel "tight" rather than "sticky". Constants are tunable.

**14. Dodge-roll = state override with i-frame + cooldown timers (i-frames exposed for Phase 3)**
- Options: A) a quick velocity nudge, invulnerability deferred to combat · B) a real `DODGE`
  state that overrides horizontal control with a dash impulse for a fixed duration, sets an
  `iframeTimer`, and gates re-use behind a `cooldownTimer`; `isInvulnerable()` is public NOW.
- Decision: **B)** — the dodge IS the defensive core of the genre; building it as a first-class
  state (with the i-frame window already queryable) means Phase 3 combat just *reads*
  `isInvulnerable()` instead of re-architecting. Phase 1 visualizes i-frames (tint/flash) so the
  feel is testable immediately. Gravity stays on during the roll (you can roll off ledges).

**15. One-way platform = collider with a `processCallback`, not a separate physics group hack**
- Options: A) toggle `body.checkCollision.up=false` on the platform body · B) a normal collider
  whose `processCallback` only returns true when the player is **above and moving down onto** the
  platform (`velocity.y >= 0 && player.bottom <= platform.top + ε`).
- Decision: **B)** — the processCallback form is explicit, self-documenting, and the same shape
  combat/enemy colliders will use later (a predicate gating a collision). It cleanly yields the AC
  behavior: pass up through, land on top. KISS and no global body-flag side effects.

> Decisions 16–24 are the **Combat** phase (built now; §6.3). They are final for this phase; later
> phases append their own.

**16. Hit detection = pooled rectangle bodies (overlap), NOT geometry math or per-frame allocation**
- Options: A) compute attack/hurt overlap with hand-rolled AABB math each frame · B) represent each
  attack hitbox + each entity hurtbox as a real **Arcade body** and resolve with
  `this.physics.add.overlap(hitGroup, hurtGroup, onHit, processFilter)`.
- Decision: **B)** — Arcade already does broad-phase + AABB; reusing it (overlap, not collide, so
  there's no separation push) is DRY and matches the engine. Hitboxes are **transient** (alive only
  for a swing's active frames) so they come from an **object POOL** (mandated convention): a small
  invisible rectangle+body is acquired, positioned in front of the attacker, enabled for the active
  window, then disabled back to the pool — **zero per-hit allocation** after warm-up. The **pure**
  `combat/hitbox.js` owns the per-swing geometry (`SWINGS` + `swingRect`) and the **Phaser-coupled**
  `combat/HitboxPool.js` owns the pool (the SPLIT is Decision 28 — superseding this entry's earlier
  "one file owns both", which would have broken the headless-import convention); a pure
  `combat/damage.js` owns the resolution math (so the math is unit-reasonable without Phaser).

**17. Damage resolution lives in a PURE `combat/damage.js`, applied by the entity**
- Options: A) compute damage/knockback/crit inline at the overlap callback · B) a pure
  `resolveHit(attacker, victim, swing)` that RETURNS a plain result `{ damage, knockbackX,
  knockbackY, isBackstab }`; the caller applies it to bodies/HP.
- Decision: **B)** — separating the *decision* (how much damage, is it a backstab, how hard the
  knockback) from the *effect* (mutate HP, set velocity, spawn FX) is SOLID and keeps the rule math
  free of Phaser so it's trivially testable and reused by player→enemy AND enemy→player. `damage.js`
  imports no Phaser. Backstab is a geometry predicate on facing (Decision 19).

**18. Combo chain = an index + a combo-window timer on the Player, NOT a heavyweight state graph**
- Options: A) a full per-swing sub-state machine · B) a `comboIndex` (0..N−1) advanced on each
  buffered attack press, a `comboWindowTimer` that (when it lapses) resets the index to 0, and a
  per-swing `attackTimer` (active + recovery) that gates the next swing.
- Decision: **B)** — KISS. A light 2–3 hit combo is just "which swing am I on + how long until the
  chain expires". Each swing reads its tuning from a small `SWINGS` table (reach, damage, knockback,
  active, recovery, windowAfter). The Player gains an `ATTACK` state (peer to `RUN`/`DODGE`) that
  freezes the combo logic in one readable place; movement is *reduced* (not frozen) during a swing so
  attacking feels mobile but committed. Attacking is blocked during `DODGE` (dodge owns its window).

**19. BACKSTAB = facing-relative geometry, decided in `damage.js`**
- Options: A) track "who is behind whom" with extra per-entity flags · B) at resolve time, compare
  the **attacker's position** to the **victim's facing**: a backstab is when the attacker is on the
  side the victim is *not* facing (`sign(attacker.x − victim.x) === −victim.facing`, with a small
  dead-zone so a near-vertical hit isn't a coin-flip).
- Decision: **B)** — one stateless predicate from data both entities already expose (`facing`, body
  center x). No bookkeeping to keep in sync (DRY). Yields a clean crit multiplier + stronger
  knockback + a distinct FX color. Player→enemy gets backstabs (reward flanking); enemy→player uses
  the same function but we can gate the crit off for enemies (keep early difficulty fair — a config
  flag, not a code fork).

**20. Per-swing hit DEDUP via a hit-set, NOT a global cooldown**
- Options: A) a global "can be hit again in N ms" timer per victim · B) each active swing carries a
  **set of already-hit victim ids**; a victim is damaged at most **once per swing**. Victim i-frames
  (Decision 21) then stop the NEXT swing/contact from re-hitting too soon.
- Decision: **B)** — the hit-set guarantees a single swing's multi-frame-alive hitbox can't multi-hit
  the same enemy (the exact AC), while the *separate* victim hit-i-frame window governs cadence
  between distinct attacks. Two orthogonal mechanisms, each doing one job (SOLID), instead of one
  overloaded timer that has to be both.

**21. HP + reaction = a tiny shared `Health` concept inlined per entity, with a hit-i-frame timer**
- Options: A) a full ECS health component · B) each combatant just holds `hp/maxHp` +
  `hurtIframeTimer` + an `onHit(result)` that subtracts HP, applies knockback, sets hitstun, flashes,
  and arms the hit-i-frame so the same source can't immediately re-hit.
- Decision: **B)** — YAGNI on an ECS for two entity types. The player and the base enemy each own
  their HP fields and an `onHit` (DRY via the shared `damage.js` math + a shared flash/iframe helper
  pattern, but no premature abstraction). The player's hit-i-frames are SEPARATE from its **dodge**
  i-frames: `isInvulnerable()` already exists from Phase 1 (dodge), and the player now ALSO ignores
  hits while `hurtIframeTimer>0` — incoming damage is blocked if EITHER is true.

**22. Enemy AI = an explicit string-enum FSM with one `update(dt, ctx)` switch (mirrors Phase-1 style)**
- Options: A) behavior-tree / steering lib · B) a hand-written FSM (`idle/patrol/chase/attack/hurt/
  dead`) — one method per state OR a `switch(state)` — driven each frame from a small `ctx`
  (player ref, dt) the scene passes in, exactly like the Player's tiny RUN/DODGE machine.
- Decision: **B)** — a base enemy needs ~6 legible states; a `switch` with `_enter`/`_tick` per state
  is the KISS, debuggable choice and matches the codebase's existing controller shape (plain class
  holding a collider + visual, ticked by the scene). Telegraph = a timed wind-up sub-phase inside
  `attack` (color shift + pause) before the damaging strike, so attacks are readable + dodgeable
  (the genre's contract). `hurt` interrupts the current action (knockback + hitstun) then returns to
  `chase`; `dead` plays a death pop then despawns. The base class is built to be SUBCLASSED/configured
  for future enemy types (Phase 4 reuses it) but ships ONE concrete config now (YAGNI).

**23. Effects = ONE pooled `effects/` layer (sparks + numbers pooled), shake/hitstop on the scene**
- Options: A) `new` particles/text per hit · B) `effects/ParticlePool.js` (a fixed pool of reusable
  spark rectangles) + a pooled floating-damage-number set, fronted by `effects/Effects.js` which also
  owns **screen shake** (`camera.shake`) and **hit-stop**; the scene calls `effects.hit(x,y,opts)`.
- Decision: **B)** — pooling particles/numbers is the mandated convention (no per-hit GC pressure).
  `Effects` is the single juice façade (SOLID): one call from a hit site fires sparks + a number +
  shake + hitstop, each parameterized by hit strength and crit. Spark motion + number float + fade
  all ease framerate-independently off `dt`. Hit-stop is implemented WITHOUT real `setTimeout` drift
  (Decision 24).

**24. Hit-stop = a global time-scale freeze with a `dt`-counted timer, NOT setTimeout / per-entity pause**
- Options: A) pause individual bodies on hit · B) on impact set a short `hitstopTimer`; while it
  runs, GameScene **scales the dt** it feeds gameplay toward 0 (and can set `physics.world.timeScale`)
  so the whole world briefly freezes, then snaps back — the timer counts down in REAL (unscaled)
  time so the freeze is exactly N ms regardless of framerate.
- Decision: **B)** — a global micro-freeze is the Dead Cells "crunch"; doing it as a scene-owned
  timer that gates the gameplay-dt (the boundary GameScene already owns from Phase 1, BLOCKER #1) is
  DRY and exact. We DON'T use `setTimeout` (drifts, fires off the game loop) and DON'T pause bodies
  individually (misses FX + input). Hit-stop is capped tiny (a few frames) so it reads as impact, not
  lag, and is skipped if one is already active (no stacking).

> Decisions 25–31 close the **Combat-phase review BLOCKERs / MAJORs / MINORs** that the prior
> revision left implementation-defined. They are final for this phase.

**25. ATTACK's exact place in Player.update's linear control flow (review BLOCKER — "ATTACK never placed")**
- Problem: `Player.update` is a linear method with a HARD dodge-start guard (`state === RUN`) and a
  `state === DODGE ? dash : run-integration` horizontal branch. Adding ATTACK as a peer state requires
  three precise edits the prior design hand-waved: (a) where in the 6-step order `attack()` fires,
  (b) what changes the dodge-start guard / horizontal branch, (c) what resets state back to RUN.
- Decision (pinned, no guessing):
  - **Dodge-start guard relaxes from `state === RUN` to `state !== DODGE`** — so a dodge press is
    honored DURING attack recovery (the design's "defensive option always available"; precedence
    `DODGE > ATTACK > RUN`). Starting a dodge clears any in-progress attack (`attackTimer = 0`,
    `comboWindowTimer = 0`, releases the live hitbox) so the two states never overlap.
  - **`attack()` is invoked in NEW step (1.5)** — AFTER timers + the dodge-start edge (step 1),
    BEFORE the horizontal branch (step 2). It only fires if `state !== DODGE && attackTimer <= 0`.
    Firing it sets `state = ATTACK`, arms `attackTimer`, advances `comboIndex`, and acquires the
    pooled swing hitbox. The order contract is: dodge-start can pre-empt it that same frame, and it
    runs before movement so the swing's reduced-mobility scaling applies on the launch frame.
  - **Horizontal branch gains an ATTACK arm:** `if DODGE {dash} else if ATTACK {run-integrate with
    ACCEL·ATTACK_MOVE_SCALE and top-speed RUN_SPEED·ATTACK_MOVE_SCALE} else {normal run}`. Movement
    is REDUCED, not frozen (committed-but-mobile, Decision 18). A small forward lunge nudge on the
    finisher swing is applied once at `attack()` time.
  - **ATTACK exit is SYMMETRIC to dodge's inline exit:** at the END of step (1) timer decay, after
    decrementing `attackTimer`, `if (state === ATTACK && attackTimer <= 0) state = RUN` — the mirror
    of the dodge's `if (dodgeTimer <= 0) state = RUN`. One reset site, deterministic.
  - **Attacking does NOT cancel a buffered jump.** Jump resolution (step 3) is unchanged and runs
    regardless of ATTACK — you can jump-cancel a swing's recovery (genre-standard mobility). The
    swing's hitbox is independent of the body's vertical state, so a jumping swing is intentional.

**26. Hit-stop dt boundary for the swing that CAUSED it (review BLOCKER — "freeze freezes its own swing")**
- Problem: a hit-stop is requested from inside the overlap callback DURING a swing's active window;
  on the next frame `gdt=0` freezes the very `attackTimer`/hitbox-release/enemy-hitstun timers that
  the swing depends on. The boundary must be pinned (option a: split dt, or option b: freeze all).
- Decision: **option (b) — EVERYTHING combat-gameplay freezes together on the gameplay dt.** The
  hitbox release timer, `attackTimer`, `comboWindowTimer`, AND enemy hurt/hitstun timers ALL decay
  by the SAME gameplay `gdt` (`= hitstopTimer>0 ? 0 : dt`). During a multi-frame hit-stop the live
  hitbox stays put and its release is deferred — which is CORRECT and SAFE because the per-swing
  `hitSet` (Decision 20) already recorded every enemy it hit, so a still-active frozen hitbox CANNOT
  re-hit anyone (the filter rejects already-hit ids), and the victim's hit-iframe (also frozen) is
  irrelevant while time is stopped. Only the **cosmetic** layer runs on REAL `dt`: sparks, floating
  numbers, the player flash easing, and the hit-stop timer's OWN countdown (so the freeze lasts
  exactly N real ms). This makes the "world freezes, impact pops" read, and guarantees the single
  multi-frame freeze can't double-hit. (This is the Combat-phase analogue of Phase-1 BLOCKER #1's
  dt-boundary pin, made equally explicit as the reviewer required.)

**27. Pointer (left-click) attack edge + first-frame carry-over guard (review MAJOR)**
- Problem: `pointer.isDown` is a HELD state, not an edge; and the click that pressed START on a menu
  scene carries its held-down state across `scene.start('Game')`, so GameScene's first frame could
  read `isDown` and fire a spurious attack.
- Decision: Input tracks a private `_pointerWasDown` flag and computes the pointer edge as
  `pointer.isDown && !_pointerWasDown` (a fresh up→down), updating `_pointerWasDown = pointer.isDown`
  at the end of each `sample()`. The flag is **initialized from the CURRENT pointer state in the
  Input constructor** (`_pointerWasDown = scene.input.activePointer.isDown`) so a START-click still
  held on GameScene's first frame is seen as "already down" → no edge → no spurious first-frame
  attack. `attackPressed` is then `JustDown(J) || pointerEdge`, computed once per frame alongside the
  other JustDowns (still SOLE-owned here, review issue #5). Jump moves to Space-ONLY so J is free for
  attack with no double-bind.

**28. HitboxPool is PHASER-coupled → it lives in its OWN file, not pure `hitbox.js` (review MAJOR)**
- Problem: a pool that creates Phaser rectangles + Arcade bodies is NOT headlessly importable, yet
  the prior `hitbox.js` header claimed "PURE-of-render math + a thin Phaser-body POOL" — a
  contradiction that would break `verify-gen.mjs`'s node-import convention if it ever touched the file.
- Decision: **SPLIT the file.** `combat/hitbox.js` stays **100% PURE** (`SWINGS` table + `swingRect`)
  and imports no Phaser — node-importable, unit-reasonable, safe for `verify-gen.mjs`. The
  Phaser-coupled pool moves to a SEPARATE `combat/HitboxPool.js` (imports Phaser, owns the
  rectangle+Arcade-body group). `damage.js` is likewise pure. The purity convention is then literally
  true per-file: a `node` import of `hitbox.js` or `damage.js` succeeds; `HitboxPool.js` is
  browser-only and `verify-gen.mjs` never imports it.

**29. Enemy world-physics integration + pit safety (review MAJOR)**
- Problem: the prior Enemy section never said the enemy collider is added to the world / collided vs
  `solids`, never specified ledge-edge detection (Arcade gives no ground-ahead probe for free), and
  never said what stops a chasing Brute from walking into the room's pit and falling out.
- Decision:
  - The enemy's `collider` body IS added to the Arcade world (`physics.add.existing`) with
    `setCollideWorldBounds(true)`, and GameScene adds `physics.add.collider(enemy.collider, solids)`
    so it stands on floors/ledges exactly like the player.
  - **Patrol bounds are explicit world-x limits `[patrolMinX, patrolMaxX]` passed in the spec**, and
    they are chosen to PRE-EXCLUDE the pit (the Brute spawns on the left floor span, bounds entirely
    left of `GAP_X0`). Patrol turns at a bound. We ship the **bounds-clamp** form (no ground probe
    needed because the bounds exclude the pit), and document the ground-ahead probe
    (`scene.physics.overlapRect` a thin sensor just ahead+below the feet) as the generalization
    Phase 4 will need for generated rooms.
  - **Chase is ALSO clamped to the patrol bounds**: the Brute accelerates toward the player but its
    target x is clamped to `[patrolMinX, patrolMaxX]` so it never walks off the span into the pit and
    out of the room. This is the concrete fix for "what stops a chasing Brute from falling out".

**30. Enemy attack hitbox shares the SAME pooled mechanism, with clear group ownership (review MAJOR)**
- Decision: there are TWO `HitboxPool` instances, both Phaser-coupled (Decision 28): a
  `playerHitboxes` pool (owner-tagged `'player'`) and an `enemyHitboxes` pool (owner-tagged by enemy
  id). GameScene owns BOTH and wires TWO overlaps: `overlap(playerHitboxes.group, enemyHurtboxGroup, …)`
  and `overlap(enemyHitboxes.group, player.collider, …)`. Each pool exposes its Arcade `group` for the
  overlap registration. The enemy's hurtbox IS its `collider` body (added to an `enemyHurtboxGroup`);
  the player's hurtbox IS its `collider` body. Contact damage is a SEPARATE
  `overlap(player.collider, enemyHurtboxGroup, …)` on a short per-enemy cooldown (not a hitbox).

**31. comboWindowTimer decays ONLY after recovery; reset site pinned (review MINOR)**
- Decision: `comboWindowTimer` is SET at the moment a swing's `attackTimer` reaches 0 (swing end =
  active+recovery done) — at that instant `state` returns to RUN (Decision 25) AND
  `comboWindowTimer = SWINGS[comboIndex].comboWindow`. It then decays by `gdt` ONLY while `state ===
  RUN && attackTimer <= 0` (i.e. only AFTER recovery, while you're free to move). When it hits 0 the
  chain resets: `comboIndex = -1` (so the next `attack()` pre-increment lands on swing 0). During an
  active swing (`attackTimer > 0`) the window does NOT decay. This makes AC20's "lapse resets to
  swing 1" deterministic: the only place the index resets is the window-expiry branch in step (1).

**32. Player hurt-knockback survives the per-frame vx write via a HURT lockout (review MINOR)**
- Problem: `Player.update` writes `setVelocityX` every frame (dodge/run), so a knockback velocity set
  in `onHit` is overwritten next frame and dies after one tick.
- Decision: `onHit` sets a `hurtTimer` (knockback-lockout, ~the hit-iframe's first slice) and sets
  the knockback velocity directly. While `hurtTimer > 0` the horizontal branch SKIPS run/dodge
  integration (it leaves `vx` alone, letting the knockback carry, with gravity still on) — exactly
  how DODGE overrides control. `hurtTimer` decays by `gdt`; when it expires, normal control resumes.
  A dodge press (always allowed) can interrupt it. This mirrors the jump-consumption care the design
  already took, applied to the player's own hit reaction. (Enemies use their own `hitstunTimer` for
  the symmetric reason — their AI tick is frozen during hurt.)

> Decisions 33–40 are the **Procedural levels** phase (§6.2). They are final for this phase; later
> phases append their own.

**33. Level model = a TILE GRID + a derived description, generator is PURE (no Phaser)**
- Options: A) generate Phaser objects directly in a scene method · B) a PURE `generateLevel(seed,
  biomeConfig)` that returns a plain DESCRIPTION (a 2-D `tiles` array of small int enums + spawn
  lists in world coords), consumed by a separate Phaser-coupled `TileMap` renderer.
- Decision: **B)** — the mandated convention: the generator imports NO Phaser so `verify-gen.mjs`
  imports it under plain node and asserts determinism + solvability headlessly (Decision 5 / §6.0).
  A grid of `EMPTY|SOLID|ONEWAY|HAZARD` ints is the simplest deterministic representation (KISS), is
  trivially serializable for the regression pin, and cleanly separates *what the level IS* (pure
  data) from *how it renders* (TileMap, Phaser). The description ALSO carries `platforms` (merged
  solid spans) + `entrance/exit` + `enemies[]/pickups[]` so the renderer + scene don't re-derive
  them. This mirrors crowd-runner's pure config → entity split (Track builds entities from a config).

**34. Layout algorithm = a reach-bounded "platform staircase" walk, NOT cellular-automata caves**
- Options: A) random cave (cellular automata / drunkard's walk) then carve · B) a deterministic
  **left-to-right chain of platforms**: start at the entrance platform, repeatedly place the NEXT
  platform a seeded `(gap, step)` away where `gap` is the nearest-edge clear GAP within `[MIN_GAP,
  MAX_GAP]` and `step` a vertical row change within `[-MAX_STEP_UP, +MAX_STEP_DOWN]` such that
  `canReachStep` accepts the emitted pair (the EXACT metric, Decision 36), until we span the level
  width; the last platform holds the exit. Fill the floor band below with solids; scatter a few
  one-way ledges + hazards OFF the critical path (and out of the jump corridor).
- Decision: **B)** — for a JUMP platformer the guarantee that matters is "can the player physically
  jump from platform N to N+1", which a cave generator does NOT give for free (you'd post-hoc verify
  + reject + retry, non-deterministic in spirit and slow). The staircase walk makes traversability
  **true by construction**: every consecutive pair is placed within the player's measured jump reach
  (Decision 35), so the entrance→exit path is guaranteed before any check runs. KISS, deterministic,
  and the verifier's BFS is then a *proof*, not a filter. Caves are YAGNI for v1 (a later biome can
  add a different generator behind the same `generateLevel` signature).

**35. Reach budgets DERIVED from Player.js physics — a COUPLED 2-D envelope, asserted sound (review BLOCKER #1)**
- Problem: the gap/step bounds in Decision 34 must come from the REAL controller, not guesses, or
  "traversable" is a lie. From `Player.js` + `constants.js`: `JUMP_VELOCITY=620`, `GRAVITY=1500`
  (ascent), `FALL_GRAVITY_EXTRA=900` (descent → `g_down=2400`), `RUN_SPEED=320`. Apex climb
  `v²/2g_up ≈ 128.1px`. **The deeper problem the prior revision missed:** jump reach is COUPLED — a
  max-up jump leaves LESS horizontal reach. An INDEPENDENT predicate (`|dx|≤MAX_GAP AND dy≥−STEP_UP`)
  was sound only by luck of the chosen numbers; a one-line re-tune (`MAX_STEP_UP=4`) could silently
  produce unreachable "verified" levels — the load-bearing soundness claim of the phase (AC27).
- Decision: the horizontal reach is a FUNCTION of the vertical step — `rawReachPx(dyPx)` in
  `LevelGenerator.js`. To land ON TOP at height `up` above launch, use the DESCENDING crossing of
  that height after the apex (the longest air time, the correct reach): `t = v/g_up +
  sqrt(2·(apex−up)/g_down)`, `rawReach(up) = RUN_SPEED·t · 0.7`. The 0.7 **safety margin** keeps the
  envelope a conservative UNDER-estimate of true reach (a PASS is always sound — never a false PASS;
  the margin absorbs imperfect inputs + theory-vs-real-landing). Named budgets `MAX_STEP_UP=3`,
  `MAX_STEP_DOWN=6`, `MIN_GAP=1`, `MAX_GAP=4` (`TILE=32`) bound the seeded walk; they are **CLAMPED
  to the envelope by module-load assertions** that throw if `MAX_GAP·TILE > rawReachPx(−MAX_STEP_UP·
  TILE)` or `MAX_STEP_UP·TILE > apex`. PROOF of the worst corner (no longer "by luck"): at up=3 tiles
  (96px) `rawReach≈184.6px`, `×0.7≈129.2px ≥ MAX_GAP(128px)` — inside the envelope with margin. A
  future budget widening past reach fails LOUDLY at import instead of emitting bad levels.

**36. Reachability graph + BFS in the VERIFIER; reach predicate + EXACT metric SHARED as pure exports (review BLOCKER #2)**
- Options: A) the generator self-certifies (returns a `solvable:true` it computed) · B) the
  generator exports a pure `canReachStep`/`canReachPlatform` jump predicate AND a pure
  `platformStep(a,b)` METRIC; `verify-gen.mjs` builds the platform-adjacency graph from a description
  and BFS/floods entrance→exit using THOSE, asserting the exit is reached.
- Decision: **B)** — an independent check beats self-certification (a bug in the walk that
  self-reports "solvable" passes A; B catches it because the graph is REBUILT from the emitted
  `tiles`/`platforms`, not the walk's intent). Crucially, the prior revision left "gap"/"step"
  AMBIGUOUS, so the walk and the BFS could measure different things — defeating the independent-check
  value. FIX: pin ONE metric in `platformStep(a,b)` (exported, imported by BOTH): `dy = b.row−a.row`
  (platform-top to platform-top); `dx` = the nearest-edge clear column gap in the travel direction (0
  if spans overlap). The generator places `next` so `canReachStep(platformStep(prev,next))` holds;
  the verifier rebuilds via the SAME `platformStep`+`canReachStep`. Same math on both sides → they
  cannot check different graphs, while the graph is still re-derived independently from the tiles.
  Because the predicate is a conservative under-estimate (Decision 35 margin), a PASS implies the
  real player makes it.

**37. Solid bodies = MERGED per horizontal run, not one Arcade body per tile (TileMap)**
- Options: A) one static body per SOLID tile · B) `TileMap` merges each contiguous horizontal run of
  same-type tiles in a row into ONE rectangle + ONE static body.
- Decision: **B)** — a per-tile body explosion (hundreds of bodies) wastes broad-phase + memory for
  no behavioral gain; merged spans give identical collision with a fraction of the bodies (the room
  is mostly long floor/ledge runs). This is also why the description carries `platforms` (the merged
  spans) — the generator already computed the runs, so the renderer reuses them (DRY) instead of
  re-scanning. One-way spans go to a SEPARATE `oneWay` group (they keep the §6.1 processCallback
  collider); hazards are non-colliding primitives this phase (damage wiring is Phase 5 — YAGNI).

**38. Spawn placement = ON the ground, validated, so nothing spawns inside a wall (AC28)**
- Options: A) random world points · B) the generator only ever emits a spawn at a cell that is
  `EMPTY` with a `SOLID`/`ONEWAY` cell DIRECTLY BELOW it (standable ground), converting the tile
  coord to a world coord centered on the tile, feet on the platform top.
- Decision: **B)** — "no spawn inside a wall / no floating spawn" (AC28) is guaranteed at emit time,
  not patched later. The generator keeps a list of valid standable cells (computed once from the
  grid) and draws enemy/pickup positions from it via the seeded RNG. The verifier RE-derives
  standability from the emitted `tiles` and asserts every spawn satisfies it — an independent check
  (same philosophy as Decision 36). Enemy count is clamped to the biome's `[minEnemies, maxEnemies]`.

**39. Biome config = a PURE config object passed in, ships ONE biome now (YAGNI)**
- Options: A) hard-code dimensions/counts in the generator · B) `generateLevel(seed, biomeConfig)`
  takes a config (`{ cols, rows, minEnemies, maxEnemies, hazardChance, oneWayChance, colors… }`); a
  `config/biomes.js` (PURE) exports the concrete configs; ONE biome (`PRISON`, the Dead Cells opener)
  ships now.
- Decision: **B)** — parameterizing by config keeps the generator reusable for Phase 5's multi-biome
  runs WITHOUT building them now (the signature is future-proof; only one config exists → YAGNI). The
  config is pure data (no Phaser) so the verifier sweeps the SAME biome the game uses. Size/difficulty
  BOUNDS (AC28) are read from this config, so "within bounds" is checked against the real source.

**40. Door = the exit entity; GameScene re-generates on overlap (next-level edge)**
- Options: A) reaching the exit immediately `scene.start('Victory')` · B) an `entities/Door.js` at
  the description's `exit`; an overlap fires `onExit()`, which GameScene handles by **re-generating**
  the level with the NEXT seed and rebuilding the room in place (tear down old bodies/entities, build
  the new description) — a level→level transition.
- Decision: **B)** — this phase's job is "reaching the Door triggers a next-level transition" (the
  task), which proves the generate→play→advance loop, not the run/victory economy (Phase 5/6). A Door
  entity (not an inline overlap) gives Phase 5 a real object to gate (locked until the room is
  cleared, cost in scrolls, etc.) without a rewrite. Re-generation uses a deterministic seed sequence
  (`nextSeed = mulberry32-advanced` or `seed+1`) so the chain of levels is itself reproducible. The
  player is repositioned to the new entrance; HUD/Effects persist (only the world rebuilds).

**41. Enemy spawns require a MIN-WIDTH platform; patrol bounds come FROM the generator (review MAJOR)**
- Problem: §6.2's first cut said enemy patrol bounds are "derived from the platform the enemy stands
  on" but (a) gave no mechanism to map a world-coord spawn back to its owning merged run, and (b) the
  staircase stamps short 3-tile runs, so a Brute (bodyW≈38px) on a 2–3 tile span would clamp
  instantly and jitter at the edges — it would look broken.
- Decision: the GENERATOR owns this, not the scene. (1) `collectStandable` records, for each
  standable cell, the OWNING support run's `col`/`len` (it scans the contiguous SOLID/ONEWAY span
  beneath) — so no world→platform mapping is needed at spawn time. (2) Enemies are only drawn from
  standable cells whose owning run is ≥ `MIN_ENEMY_PLATFORM_TILES` (= 5; ~160px → ~110px patrol span
  ≫ bodyW, real movement not a twitch) — pickups have no such requirement. (3) Each emitted enemy
  carries `patrolMinX/patrolMaxX` = the owning run's world span inset by `ENEMY_PATROL_INSET` px, so
  GameScene passes them straight to `_spawnEnemy` and the live Decision-29 pit-safety (patrol +
  chase clamp to bounds) holds for GENERATED geometry. The full-width floor band keeps wide runs
  plentiful, so requiring 5 never starves spawns (verified: every swept seed still has enemies).

> Decisions 42–49 are the **Run structure** phase (§6.4 — the orchestrator's "Phase 4"). They are
> final for this phase; later phases append their own.

**42. Difficulty curve = a PURE `config/difficulty.js` keyed on DEPTH, shared game + verifier (mirrors crowd-runner)**
- Options: A) inline per-biome hardness numbers in `biomes.js` and bump enemy stats ad hoc in
  GameScene · B) a separate PURE `config/difficulty.js` exporting `scaleAtDepth(depth)` → a scalar set
  (`enemyHpMult/enemyDamageMult/enemyCountBonus/enemySpeedMult`), imported by BOTH GameScene (to scale
  spawns) AND `verify-gen.mjs` (to assert monotonicity).
- Decision: **B)** — this is the crowd-runner pattern verbatim (its `config/difficulty.js` is the
  single source of "what depth N means", imported by the game and the headless verifier). Separating
  the CURVE (a pure function of depth) from the BIOME (theme + pool + length) is SOLID + DRY: a biome
  says *which* enemies and *how long*; the curve says *how hard at this depth*. The curve is a simple
  monotone ramp — `enemyHpMult = 1 + HP_PER_DEPTH·depth` etc., each scalar non-decreasing in `depth` —
  so monotonicity is true BY CONSTRUCTION and the verifier's check is a proof, not a filter (same
  philosophy as the level generator's reach envelope). PURE (no Phaser) so a node import re-proves the
  convention. YAGNI: linear/clamped ramps, no per-biome curve overrides yet.

**43. Biomes become an ORDERED LIST with tiers; the generator signature is UNCHANGED**
- Options: A) keep the single `PRISON` + branch on an id in the scene · B) `config/biomes.js` exports an
  ordered `BIOME_ORDER` array (≥3 entries) plus the existing `BIOMES` map; each entry gains
  `difficultyTier` (monotone integer), `endsInBoss` (false now), `name` (for the summary), and a
  distinct `colors`/length — but the `generateLevel(seed, biomeConfig)` contract is UNTOUCHED (a biome
  is still just a config the pure generator reads).
- Decision: **B)** — the generator was already built multi-biome-ready (Decision 39); this phase just
  POPULATES the list it was waiting for, so no generator rewrite. `BIOME_ORDER` is THE ordering the run
  walks (RunState indexes into it) and the verifier sweeps; `difficultyTier` lets a later biome be
  intrinsically denser WITHOUT touching the depth curve (the two stack: `effectiveDifficulty(depth) =
  tier(biome)·K + curveScalar(depth)`, monotone because depth and tier both rise along the run). New
  biomes reuse `PRISON`'s field shape (DRY) with different colors/counts/length — primitives only, no
  new art. KISS: 3 biomes ship (Prison/Sewers/Ramparts); the array is trivially extendable.

**44. `core/RunState.js` = a PURE plain object/factory, OWNED by GameScene (not a global singleton)**
- Options: A) a module-level singleton mutated from anywhere · B) a PURE `createRunState(startSeed)`
  factory returning a plain object with `advance()`/`isLastBiome()`/`summary()` that GameScene
  constructs and owns; death/Hub transitions read it off the scene (or take a snapshot).
- Decision: **B)** — a singleton invites spooky-action mutation + breaks determinism reasoning + can't
  be unit-tested headlessly. A pure factory (no Phaser import) is node-importable so the verifier can
  drive the SAME `advance()` chain the game does and assert the seed sequence + depth progression are
  deterministic + monotone (the convention: pure modules are headlessly verifiable). RunState owns ONLY
  run-scoped state (seed/biomeIndex/depth/hp/currencies-placeholder/inventory/stats); META (banked Cells
  across runs) is `util/save.js`'s job in a later phase — kept separate so permadeath = "drop the
  RunState, keep the save" is a clean seam. GameScene constructs it in `create()` (from a fixed start
  seed for now — a Hub-chosen seed is Phase 7) and is the single writer.

**45. Enemy scaling = a PER-SPAWN DERIVED spec, NOT a mutated shared `BRUTE_SPEC`**
- Options: A) multiply fields on the shared `BRUTE_SPEC` object before spawning · B) at spawn, build a
  shallow-cloned spec via `scaleSpec(BRUTE_SPEC, scaleAtDepth(depth))` (maxHp×hpMult,
  contactDamage×dmgMult, swing.damage×dmgMult, speeds×speedMult) and pass THAT to `new Enemy(...)`.
- Decision: **B)** — mutating the shared spec is a classic aliasing bug (every later spawn inherits the
  multiplied values; a regenerate compounds it). A pure `scaleSpec` that returns a NEW object per spawn
  is DRY, side-effect-free, and keeps `BRUTE_SPEC` the immutable base. The generator already emits
  `spec:'brute'` per enemy (a string tag), so GameScene maps tag→base spec then scales by the CURRENT
  `runState.depth` — the scaling lives entirely in the scene's spawn path, the Enemy class is untouched
  (it just receives a spec). This is the minimal change that makes "enemy stats scale by depth" true.
  `scaleSpec` lives in `config/difficulty.js` (PURE) so the verifier can sanity-check a scaled spec too.

**46. Door advance drives RunState; HP carries, the seed chain is RunState-owned**
- Options: A) keep GameScene's local `this.seed`/`nextSeed` + add biome tracking alongside · B) MOVE the
  seed chain + biome index into `RunState.advance()` (next seed = deterministic advance of the current;
  next biome = `min(biomeIndex+1, lastIndex)`; `depth++`); GameScene's `_nextLevel()` calls
  `runState.advance()` then rebuilds from `runState`.
- Decision: **B)** — the level→level edge already exists (Decision 40); this phase RE-POINTS its source
  of truth from a scene-local `this.seed` to `RunState` so the run is one coherent advancing object. HP
  is CARRIED because the Player persists across rebuilds already (the scene only rebuilds the world, not
  the Player) — we simply DON'T refill `player.hp` on `_buildLevel` (and we sync `runState.hp` ↔
  `player.hp` so a summary/Hub sees the carried value). The deterministic advance (Knuth multiplicative,
  already in the scene) moves verbatim into `RunState` so the chain is reproducible from the start seed.
  Reaching the Door past the last biome ends the run (Decision 48) instead of looping.

**47. Player death → a REAL GameOverScene carrying a run-summary SNAPSHOT via scene-start data**
- Options: A) keep the placeholder Title bounce · B) on death, `this.scene.start('GameOver', summary)`
  where `summary = runState.summary()` (`{ depthReached, biomeName, timeMs, kills, completed:false }`);
  GameOverScene reads it from `this.scene.settings.data` and renders it, then routes to Title.
- Decision: **B)** — the task is "Player death → GameOverScene showing a run summary". Passing the
  summary as scene-START DATA (Phaser's first-class mechanism) keeps GameOver DECOUPLED from GameScene
  (it never reaches into the live scene — same SOLID rule as the HUD/registry split, Decision 2) and
  avoids a global. The summary is a plain SNAPSHOT computed once at death (RunState may be torn down
  after). `kills` is incremented by GameScene on each enemy death (a tiny hook in the death path —
  the Cells economy is still a later phase, but the KILL COUNT is free and the summary needs it). Run
  time = `now − runState.startedAt`. GameOver → Title (Hub wiring is Phase 7). The death edge still
  fires exactly once (the existing `this.gameOver` guard), just re-pointed off the Title placeholder.

**48. Run completion (past the last biome) = a clean GameOver “run complete” handoff (boss victory is Phase 6)**
- Options: A) loop the last biome forever · B) when `runState.isLastBiome()` and the Door is reached,
  end the run — for now route to GameOver with the summary tagged `completed:true` (a "RUN COMPLETE"
  header instead of "GAME OVER").
- Decision: **B)** — a run must be FINISHABLE for the loop to read as a roguelite, but the real victory
  gate is a BOSS at the end of the last biome (Phase 6, `endsInBoss`). Until then, clearing the last
  biome's Door is the completion edge. Reusing GameOverScene (with a `completed` flag flipping the
  header + color) avoids a near-duplicate scene now (YAGNI) while leaving VictoryScene for the Phase-6
  boss-kill. The seed chain still advances deterministically, so "complete the run" is reproducible.

**49. Monotonicity is asserted in the VERIFIER over the WHOLE run, not self-reported**
- Options: A) `difficulty.js` returns a `monotonic:true` it claims · B) `verify-gen.mjs` walks the
  `BIOME_ORDER` via a fresh `RunState`, computes `effectiveDifficulty(depth, biome)` at every depth of
  the run, and asserts each is ≥ the previous (strictly non-decreasing) — an INDEPENDENT check (same
  philosophy as the level BFS, Decision 36).
- Decision: **B)** — self-certification can lie; an independent sweep can't. The verifier imports the
  PURE `scaleAtDepth`, `BIOME_ORDER`, `createRunState`, walks the exact `advance()` chain the game
  walks, and proves: (1) each curve scalar is non-decreasing in depth; (2) the per-biome
  `difficultyTier` is non-decreasing along `BIOME_ORDER`; (3) the combined `effectiveDifficulty` is
  non-decreasing across the full run; (4) the seed chain is deterministic (two fresh RunStates from the
  same start seed produce the same biome/seed sequence). Failures exit non-zero so a future curve/biome
  re-tune that breaks the "rising difficulty" AC fails LOUDLY in CI.

> Decisions 50–53 close the **Phase-4 review BLOCKERs / MAJORs / MINORs** the prior revision left
> implementation-defined. They are final for this phase.

**50. A biome spans MULTIPLE levels — `levels` per biome + a `levelInBiome` counter (review BLOCKER 1+2)**
- Problem: the prior `advance()` rolled `biomeIndex` on EVERY Door, so a 3-biome run was only THREE
  rooms (one per biome), it ended on the FIRST last-biome Door (Decision 48 fired immediately), and
  `depth` never climbed past 2 — so the depth-scaling of enemies (BLOCKER 2) was invisible. The phase
  goal + AC43/AC45 implicitly assume several levels per biome so depth-scaling reads WITHIN a biome.
- Decision: each biome carries a `levels` field (config/biomes.js — 3 each now). RunState gains a
  `levelInBiome` (0-based) counter. `advance()` ALWAYS increments `depth` (run-GLOBAL — it NEVER resets,
  so the curve is sampled across the whole run) and `levelInBiome`, and rolls to the next biome ONLY
  when `levelInBiome >= biome.levels` (and not already last). The run completes only when the LAST
  biome's LAST level is cleared (`isRunComplete() = isLastBiome() && levelInBiome >= levels−1`), checked
  by GameScene at the Door BEFORE advancing. The verifier walks the EXACT `advance()` chain
  (`while(!isRunComplete())`) — it does NOT assume `depth==biomeIndex` (which would silently break the
  moment `levels>1`), and asserts the run length = Σ `levels` ending on the last biome. Net: a real
  multi-room descent per biome (9 levels) with depth-scaling observable within AND across biomes.

**51. `enemyCountBonus` source = a generator-emitted `spawnCandidates[]` SURPLUS (review MAJOR)**
- Problem: the depth-scaled `enemyCountBonus` had no implementable spawn source. The generator emitted
  only the fixed `desc.enemies` (already clamped to the band); the scene had no access to the internal
  `standableEnemy` pool, so "draw extra spawns from the same standable points" was either a silent
  no-op (AC45 "more enemies" unmet) or invited re-deriving standable cells in the scene (a DRY
  violation — the scene has no pure standable-scan).
- Decision: the PURE generator now ALSO emits `spawnCandidates[]` — the standable-ENEMY cells it
  scanned but did NOT use for `desc.enemies` (a set-difference over the same `standableEnemy` list,
  mapped to the identical enemy-spawn shape via a shared `enemySpawnFromCell`). It is derived AFTER the
  RNG pick (a pure filter) so it consumes NO extra RNG draws — the `enemies`/`pickups` output + the
  regression pin are UNCHANGED. GameScene's `enemyCountBonus` draws extra spawns from this list, capped
  to `biome.maxEnemies` and bounded by the surplus. So "more enemies at depth" is real + verifiable, the
  scene never re-derives geometry (DRY), and a level with no surplus simply adds fewer (never a false
  claim). `spawnCandidates` is standability-checked by the verifier's existing per-spawn assertion path
  is N/A (it's surplus, not placed), but each candidate is a `standableEnemy` cell by construction.

**52. Per-enemy strike release — never `releaseAll()` the shared enemy pool (review MAJOR / Phase-4 seam)**
- Problem: `Enemy.onHit`/`_die()`/`forceDespawn()` called `this.hitboxPool.releaseAll()` on the SHARED
  enemy pool. With ONE enemy that was "release MY strike"; Phase 4 spawns MANY enemies sharing one
  pool, so one enemy's interrupt/death would cancel a DIFFERENT enemy's live strike mid-swing. The
  as-built code's own TODO named this phase.
- Decision: `_fireStrike()` STORES the rect `acquire()` returns (`this.strikeRect`); a new
  `_releaseStrike()` releases ONLY that rect, and ONLY if it is STILL `active` AND still tagged
  `hb.ownerId === this.id` (guarding the stale-handle case where the pool already released our hitbox
  after `swing.active` and re-acquired that rect for another enemy). `strikeRect` is cleared when the
  strike fully resolves. This is cleaner + DRY-er than a per-enemy pool (no pool proliferation) and is
  the minimal correct fix. `HitboxPool.acquire()` already returned the rect, so no pool change is needed.

**53. Speed scaling applies to patrol+chase; ranges/telegraph are NOT scaled; HP-sync sites pinned (review MINOR)**
- Decision (stated, not omitted): `enemySpeedMult` scales BOTH `patrolSpeed` and `chaseSpeed` — a
  deeper biome's enemy patrols + chases faster (uniform pressure), clamped by `SPEED_CAP` so even a deep
  chaser can't outrun the player's dodge/run and patrol stays a readable cruise. `detectRange`/
  `attackRange`/`telegraph` are deliberately NOT scaled: a faster enemy with the SAME telegraph window
  stays dodgeable — readability is preserved at depth (the genre's contract). HP-CARRY SYNC SITES are
  pinned to avoid a stale-HP / full-heal bug: `player.hp ← runState.hp` happens EXACTLY ONCE in
  `create()`; `_buildLevel` touches NEITHER `player.hp` NOR `runState.hp`; `_nextLevel` writes
  `runState.hp = player.hp` exactly once BEFORE teardown. `_onPlayerDeath` sets `runState.hp = 0` for
  consistency (the summary doesn't read hp — a harmless keep, not a dead write that signals confusion).
  Registry `depth`/`biomeName`/HP defaults are seeded in `create()` so a replayed run never flashes the
  previous run's values before the first `_emitHud()` (scene.start fully re-creates GameScene per run,
  so `startedAt`/`timeMs` are per-run, never cumulative).

**TIER_WEIGHT lower-bound derivation (review MAJOR — supersedes the "large enough" hand-wave in §6.4):**
`config/difficulty.js` derives `TIER_WEIGHT` from a stated bound — one tier step (+1) must dominate the
maximum the curve term (`enemyHpMult+enemyDamageMult`) could fall at a biome boundary, bounded by the
curve term at a generous max depth — and a MODULE-LOAD assertion throws if a re-tune drops below it
(mirroring the LevelGenerator reach-envelope assertions). In THIS phase `depth` is run-global (never
resets), so the curve term is itself non-decreasing across a boundary and the tier only adds —
monotonicity is structural even at `TIER_WEIGHT=0` — but the derived bound keeps the property ROBUST to
a future per-biome curve reset.

---

## 6. Design

> 6.0 is Phase 0 (filled). 6.1–6.7 are per-phase sections, filled in when each phase ships.

### 6.0 Phase 0 — Scaffold (THIS PHASE)

**Module layout created in Phase 0** (directories created now; most are populated later as
empty-but-present conventions, only what Phase 0 needs is implemented):

```
index.html              — full-screen canvas mount (#game), minimal reset CSS, no UI chrome
package.json            — phaser dep, vite devDep, "type":"module", dev/build/preview/verify
vite.config.js          — base './'
README.md               — what it is, how to run, controls placeholder, phase roadmap
CREDITS.md              — programmer-art only, no external assets (CC0 note)
.gitignore              — node_modules, dist, .DS_Store
scripts/verify-gen.mjs  — PLACEHOLDER: imports util/rng.js, asserts mulberry32 determinism,
                          exits 0. Phase 2 extends it to test the real generators.
src/main.js             — builds the Phaser.Game config + registers all 7 scenes, news up the game
src/config/
  constants.js          — PURE: DESIGN_WIDTH/HEIGHT (Decision 8) + GRAVITY (Decision 9). The
                          SINGLE owner of constants that more than one site needs (main.js sizes
                          the canvas; GameScene seeds its world) — resolves the Phase-0 ambiguity.
src/scenes/
  BootScene.js          — first scene; (later: bake textures) → starts Title
  TitleScene.js         — title text + Start (key/click) → starts Game
  HubScene.js           — stub: label "HUB" (Phase 7 fills it)
  GameScene.js          — Arcade Physics world: one static platform + a player rect that falls
                          under gravity and lands; launches HUD overlay; ESC → Title (dev)
  HUDScene.js           — parallel overlay stub: a small label proving it renders over Game
  GameOverScene.js      — stub: "GAME OVER" + restart → Title (Phase 5/7 wires permadeath)
  VictoryScene.js       — stub: "VICTORY" + → Title (Phase 6 wires boss-defeat)
src/util/
  rng.js                — mulberry32 + range (verbatim from crowd-runner)
  save.js               — defensive localStorage get/set + typed meta wrapper
```

**On `config/` (resolving the earlier contradiction):** `src/config/` IS created in Phase 0,
but ONLY because Phase 0 genuinely needs it — `constants.js` owns `DESIGN_WIDTH/HEIGHT`
(Decision 8) and `GRAVITY` (Decision 9), each consumed by two-or-more sites (`main.js` +
scenes), so inlining would violate DRY. This is not speculative: it ships a real, used file.
The OTHER convention dirs (`core/ world/ entities/ combat/ effects/`) are NOT created yet —
YAGNI; each is added in the phase that first needs it, so the tree never carries dead folders.

**`main.js` — single boot site.** Imports `DESIGN_WIDTH/HEIGHT` from `config/constants.js` and
constructs one Phaser game config object:

- `type: Phaser.AUTO` (WebGL→Canvas fallback).
- `parent: 'game'` — mounts the canvas into `#game` (index.html).
- `scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT }` — the world is a FIXED `1280×720` coordinate system, scaled +
  letterboxed to the viewport (Decision 8). This intentionally REPLACES `Scale.RESIZE`: a stable
  world is what tilemaps + `camera.setBounds` (later phases) require.
- `physics: { default: 'arcade', arcade: { debug: false } }` — Arcade enabled so a scene can opt
  in (Decision 3), but **gravity is NOT set here** (Decision 9); GameScene sets it per-scene.
- `backgroundColor` — a dark slate so primitive rectangles read clearly.
- `scene: [BootScene, TitleScene, HubScene, GameScene, HUDScene, GameOverScene, VictoryScene]`
  — registration **order**; the **first** (Boot) auto-starts (AC3/AC4). Scenes after Boot do
  not auto-run; they are started explicitly via transitions.

**Scene transitions (Phase 0 wiring):**
`Boot → Title` (automatic, after any boot setup) → Title `Start` → `Game` (which
`scene.launch('HUD')` in parallel, Decision 2). GameOver / Victory / Hub are reachable stubs
that route back to `Title` so the skeleton is fully navigable. These edges are placeholders;
later phases re-point them (e.g. Game death → GameOver, boss-kill → Victory, Hub ↔ run).

**GameScene physics proof (AC6).** `create()`:
- Sets FIXED world + camera bounds to the design rect: `this.physics.world.setBounds(0,0,
  DESIGN_WIDTH, DESIGN_HEIGHT)` and `this.cameras.main.setBounds(...)` — a stable coordinate
  system (Decision 8) that later phases extend for camera-follow.
- Sets gravity PER-SCENE: `this.physics.world.gravity.y = GRAVITY` (Decision 9) — only this
  scene runs a gravity world.
- Adds a **static** platform: a rectangle (drawn via `this.add.rectangle`) registered as a
  static Arcade body (`this.physics.add.existing(rect, true)`), positioned from the FIXED design
  resolution (never `window.innerWidth/Height`, so it can't drift on resize), in the
  lower-middle of the world.
- Adds a **dynamic** player: a smaller rectangle with a dynamic Arcade body spawned above the
  platform; per-scene gravity pulls it down; `setCollideWorldBounds(true)` keeps it in-world and
  `this.physics.add.collider(player, platform)` stops it on the platform. No input yet (Phase 1
  adds movement) — the AC is only that it *falls and lands*.
- Launches the HUD overlay guarded by `if (!this.scene.isActive('HUD'))` so it can't double-run.
- **HUD teardown (correctness):** `this.events.once(SHUTDOWN, () => this.scene.stop('HUD'))`.
  Parallel scenes outlive the launcher, so without this the cycle Game → ESC → Title → Start →
  Game would STACK a second HUD every loop (and leak one). Stopping HUD on GameScene shutdown
  guarantees exactly one HUD instance ever exists.
- A dev convenience: `ESC` returns to Title (removed/replaced in later phases).

**`rng.js`** — copied verbatim from `crowd-runner/src/util/rng.js`: `mulberry32(seed)` (the
4-line PRNG) + `range(rng, min, max)`. The comment is adapted to reference this doc (Decision 5)
but the algorithm is byte-identical so seeds are cross-compatible and `verify-gen.mjs` can pin
exact sequences.

**`save.js`** — defensive localStorage wrapper (Decision 6):
- `get(key, fallback)` — `try { const raw = localStorage.getItem(key); return raw == null ?
  fallback : JSON.parse(raw) } catch { return fallback }`.
- `set(key, value)` — `try { localStorage.setItem(key, JSON.stringify(value)); return true }
  catch { return false }`.
- A thin typed meta wrapper (`loadMeta()` / `saveMeta(meta)` over a single `SAVE_KEY`) with a
  default meta shape `{ cells: 0, upgrades: {} }` — present now so Phase 7 has a stable schema
  to extend, but unused by gameplay in Phase 0. Pure of Phaser; safe to import anywhere.

**`scripts/verify-gen.mjs` (placeholder).** Imports `mulberry32` from `src/util/rng.js`, runs
two fresh generators from the same seed (`SEED = 0x1234abcd`), asserts the first `K = 5` outputs
are identical (determinism), AND asserts they match a pinned regression vector (regression pin).

> **The pin is COMPUTED from the verbatim algorithm, never hand-written.** It is the literal
> output of `mulberry32(0x1234abcd)` for the first 5 draws:
> `[0.10277144517749548, 0.5144855019170791, 0.07858735416084528, 0.6312816452700645,
> 0.978210358414799]`. Because it is generated by the real function, the check asserts the
> *actual* contract — if `rng.js` ever changes algorithm the vector fails loudly. Regenerate it
> by re-running the function; never edit it to silence a failure.

Exits non-zero on failure so `npm run verify` is wired into CI from day one. Phase 2 grows it to
import the real biome generator and assert solvability/structure — but it is already a real,
passing check now (it proves the determinism foundation, AC7).

**Index/CSS.** `index.html` mounts a single `<div id="game">` (Phaser's `parent`), with reset
CSS: `margin:0; overflow:hidden; background:#0b0e14;`. The canvas is sized + centered by
`Scale.FIT` (Decision 8), so the page background shows through the letterbox bars — `#0b0e14`
keeps primitives reading against it. No scrollbars, no fonts/assets loaded.

### 6.1 Phase 1 — Platformer core (THIS PHASE)

**Goal.** A crisp, responsive Dead Cells–style platformer feel: a player rectangle you can
**run** (acceleration + friction), **jump** with a **variable height** (cut velocity on early
release), aided by **coyote time** + **jump buffer**, and a **dodge-roll** with **i-frames**,
a **dash impulse**, and a brief **cooldown**. The player collides with ground, walls, and a
**one-way platform**, in a hand-built test room. A **smooth camera** (deadzone + lerp) follows.
The rectangle **squashes/stretches** and **flips** to read direction + state. Everything is
**frame-rate independent** (Phaser `dt`) and every feel value is a **named, commented constant**.

**dt units — the boundary contract (review BLOCKER).** Phaser passes `delta` to
`scene.update(time, delta)` in **MILLISECONDS** (verified: Systems.js emits UPDATE then calls
`sceneUpdate(time, delta)`; World.js does `fixedDelta = delta * 0.001`). EVERY feel formula in
this section — `ACCEL·dt`, `FRICTION·dt`, the `coyoteTimer/jumpBufferTimer/dodgeTimer` decays
(values quoted as `~0.10s / ~0.12s` etc.), and the `1−exp(−k·dt)` easing — is written in
**SECONDS**. Therefore **GameScene MUST convert at the boundary**: it calls
`player.update(dt, input)` with `dt = delta / 1000`, **clamped to `MAX_DT` (~1/30 s)** so a
tab-refocus spike can't teleport the player through walls or trigger a spiral-of-death
(crowd-runner clamps for the same reason). `Player.update(dt, input)` ALWAYS treats `dt` as
seconds — never wire raw `delta` to it (off by 1000×).

**Gravity integration model — pinned (review BLOCKER).** Arcade world gravity **stays ON**
(GameScene sets `world.gravity.y = GRAVITY`); Arcade integrates it into `vy` every step. The
Player does NOT hand-integrate vertical motion. Exact API split:
- **Horizontal:** the Player integrates `vx` itself (accel/friction, Decision 11) and pushes it
  with `body.setVelocityX(vx)` each frame. Arcade never touches `vx`.
- **Fall snappiness:** implemented as EXTRA *body* gravity — `body.setGravityY(FALL_GRAVITY_EXTRA)`
  while descending (`vy>0`), reset to `body.setGravityY(0)` otherwise. Arcade SUMS
  `world.gravity + body.gravity`, so this is one clean source — NOT "add to `vy` in update"
  (which would double-count against Arcade's own gravity step).
- **Terminal fall:** `body.setMaxVelocity(MAX_VX, MAX_FALL_SPEED)` — the **X/Y form** is used
  deliberately so the Y cap (terminal velocity) never clamps the horizontal run/dash. `MAX_VX`
  is set well above `DODGE_SPEED`.

**Visual vs. body decoupling — pinned (review issue: squash must not touch the body).** The
physics body and the squash/stretch visual are **two separate GameObjects**: an INVISIBLE
`collider` rectangle owns the Arcade body (Arcade owns its position; never scaled, never
hand-moved by us; its size/offset FIXED at construction), and a separate VISIBLE `rect` is
scaled + positioned to the body each frame. This is required because Arcade derives the body
position from the owning GameObject's transform (`position = transform.{x,y} + scale·(offset −
displayOrigin)`); scaling the body-owner would drift the body and hand-setting its `x/y` each
frame would fight Arcade's write-back → jitter. Colliders + camera-follow target the
**collider**; the one-way `processCallback` reads the **collider's body** (`player.body.bottom`),
never the scaled visual.

**New modules this phase** (only what Phase 1 needs — YAGNI):

```
src/core/Input.js       — PURE-of-gameplay input layer: maps arrows/WASD + Space/J + Shift/K to a
                          frame-snapshot { moveX, jumpPressed, jumpHeld, dodgePressed } with edge-
                          detected presses (field names FINAL — they match the API spec + §7; the
                          earlier jumpDown/dodgeDown wording is superseded). Mirrors crowd-runner's
                          core/Input.js role (one place owns key bindings) but Phaser-native
                          (this.input.keyboard) instead of DOM listeners.
src/entities/Player.js  — the platformer controller: owns the rectangle + its Arcade body and ALL
                          feel constants (run/jump/dodge/squash). A plain class (NOT a Phaser.Scene)
                          that GameScene news up and ticks each frame.
src/config/constants.js — (extend) keep GRAVITY here; per-entity feel constants live in Player.js
                          (they're owned by one consumer, so co-locating them is DRY, not a leak).
src/scenes/GameScene.js — (rewrite) build a real TEST ROOM (floor, walls, raised ledges, a one-way
                          platform), spawn the Player, wire camera-follow + collisions, tick input
                          and the player each update(dt).
```

**Why a plain `Player` class, not a `Phaser.GameObjects` subclass.** A subclass entangles the
controller with Phaser's display-list lifecycle and makes the feel constants harder to read in
isolation. A plain class that *holds* a `Phaser.GameObjects.Rectangle` + its `body` keeps the
controller a focused, single-responsibility unit (SOLID) that GameScene drives — same shape as
crowd-runner's `Crowd`/`Obstacle` entities (plain classes the loop ticks). It also keeps the
door open to headless-ish reasoning about the state machine later.

**Input layer (`core/Input.js`).** One owner of key bindings (DRY), so no scene hard-codes
keycodes. Built from `scene.input.keyboard.addKeys(...)` so it lives/dies with the scene.
- **Bindings:** move = `Left/A` & `Right/D` (and `Up/W` reserved, unused this phase); jump =
  `Space` **or** `J`; dodge = `Shift` **or** `K`. (Down/`S` reserved for a future drop-through;
  not wired in Phase 1 — YAGNI.)
- **API:** a single `sample()` returning a per-frame snapshot:
  `{ moveX: -1|0|1, jumpPressed, jumpHeld, dodgePressed }`.
  - `moveX` is the horizontal axis (right − left), so opposite keys cancel.
  - `jumpHeld` = key currently down (drives the variable-height *hold*).
  - `jumpPressed` / `dodgePressed` are **edge-detected** (true only on the frame of the
    down-transition) using `Phaser.Input.Keyboard.JustDown` — the buffer/coyote logic needs the
    discrete *press event*, not the held state.
- **Determinism / framerate:** input is sampled once per `update`, never inside physics callbacks.
- **JustDown is SOLE-owned here (review issue).** `Phaser.Input.Keyboard.JustDown(key)` mutates
  the key's `_justDown` flag — a second call in the same frame returns false. So **only**
  `Input.sample()` calls JustDown on the jump/dodge keys, GameScene calls `sample()` EXACTLY ONCE
  per frame and stores the snapshot, and nothing else (HUD, ESC, future consumers) reads JustDown
  on those keys. The ESC dev hint stays on a `.once('keydown-ESC')` event so it never shares the
  JustDown path.

**Player controller (`entities/Player.js`).** Owns the rectangle, the Arcade body, all feel
constants, and a tiny **state enum** `RUN | DODGE` (DODGE is the only state that overrides normal
movement; everything else — airborne, idle — is just the RUN state reading the body). The feel is
the heart of this phase, so each constant is named + commented:

- **Run (accel/friction, frame-rate independent).** Instead of `setVelocityX` snapping, we
  integrate toward a target speed: when a direction is held, accelerate `vx` toward
  `±RUN_SPEED` by `RUN_ACCEL·dt`; when no direction, decelerate toward 0 by `RUN_FRICTION·dt`
  (ground) / `AIR_FRICTION·dt` (air). Air control uses `AIR_ACCEL` (< ground) so direction
  changes mid-jump feel weighty but not floaty. Using `dt` (seconds) makes accel framerate-
  independent. Constants: `RUN_SPEED`, `RUN_ACCEL`, `RUN_FRICTION`, `AIR_ACCEL`, `AIR_FRICTION`.
- **Gravity + fall.** World gravity (`GRAVITY`, constants.js) pulls down. We clamp downward speed
  to `MAX_FALL_SPEED` (body `setMaxVelocity` Y) so long falls stay readable. *Optional juice:*
  a slightly higher **fall gravity multiplier** (`FALL_GRAVITY_MULT`) applied while `vy>0` makes
  jumps feel snappy (the classic "fast-fall") — applied by adding extra gravity in `update`.
- **Variable-height jump (cut on release).** On a buffered+grounded(-or-coyote) jump we set
  `vy = -JUMP_VELOCITY`. While rising (`vy<0`), if the jump key is **released**, we cut the rise:
  `vy = max(vy, -JUMP_CUT_VELOCITY)` (i.e. clamp upward speed to a small value) → tapping yields a
  short hop, holding yields a full jump. Constants: `JUMP_VELOCITY`, `JUMP_CUT_VELOCITY`.
- **Coyote time.** A `coyoteTimer` resets to `COYOTE_TIME` whenever the body is on the floor, and
  counts down by `dt` once airborne. A jump is allowed while `coyoteTimer>0` even though
  `body.blocked.down` is already false — so a jump pressed a few frames after walking off a ledge
  still fires. Constant: `COYOTE_TIME` (~0.10s).
- **Jump buffer.** A `jumpBufferTimer` is set to `JUMP_BUFFER_TIME` on `jumpPressed` and decays by
  `dt`. Each frame, if `jumpBufferTimer>0` **and** (grounded **or** coyote), we consume the buffer
  and jump — so a jump pressed a few frames *before* landing still fires on touchdown. Constant:
  `JUMP_BUFFER_TIME` (~0.12s).
- **Jump CONSUMPTION (review issue — prevents the classic double-fire).** On launch we set
  `vy = -JUMP_VELOCITY` and **immediately ZERO both `jumpBufferTimer` AND `coyoteTimer`**. Without
  zeroing both, on the launch frame `jumpBufferTimer>0` and (still-grounded-for-one-more-step OR
  `coyoteTimer>0`) can remain true next frame and fire a SECOND jump. The buffer is not re-armed
  until the next `jumpPressed`; coyote not until grounded again. This is the single most common
  bug in this controller pattern.
- **Dodge-roll (i-frames + dash + cooldown).** On `dodgePressed`, if `dodgeCooldownTimer<=0` and
  not already dodging, enter `DODGE`: set `vx = facing·DODGE_SPEED` (a horizontal dash impulse),
  start `dodgeTimer = DODGE_DURATION` and `iframeTimer = DODGE_IFRAMES`, and set
  `dodgeCooldownTimer = DODGE_COOLDOWN`. During DODGE we **override** normal horizontal control
  (hold the dash speed, ignore `moveX`) but gravity still applies (you can roll off ledges). When
  `dodgeTimer` hits 0 we return to RUN. `isInvulnerable()` ⇔ `iframeTimer>0` — combat (Phase 3)
  reads this; Phase 1 only *exposes + visualizes* it (the rect flashes / changes tint while
  invulnerable so the feel is testable now). Direction: dodge uses the current `facing`, or
  `moveX` if a direction is held at press (so you can roll the way you're pointing). Constants:
  `DODGE_SPEED`, `DODGE_DURATION`, `DODGE_IFRAMES`, `DODGE_COOLDOWN`.
- **Squash / stretch / flip (juice, primitives only — on the VISUAL only).** Read intent from the
  body each frame and set the VISIBLE `rect`'s `scaleX/scaleY` (with a vertical offset so the FEET
  stay planted: a taller rect raises its center by half the height growth so its bottom edge
  tracks the body bottom): jump-launch → stretch tall (`scaleY>1`), landing → squash wide (a short
  `landSquash` impulse that eases back via `1-exp(-k·dt)`), dodge → squash flat + long; `scaleX` is
  the inverse of `scaleY` to preserve apparent volume. `facing` parks a thin "front" marker on the
  leading edge (the body stays symmetric; the marker + facing field are cosmetic + drive dodge
  dir). Tint shifts while invulnerable. All eased framerate-independently. NB: this writes ONLY the
  visual GameObject — never the `collider` body (see the decoupling pin above).
- **Update order (per frame, `update(dt, input)` — `dt` in SECONDS):** (1) tick timers (coyote
  refresh from `blocked.down`, decay buffer/dodge/iframe/cooldown); start a dodge on the edge if
  off-cooldown; (2) if DODGE, hold dash + check exit; else apply run accel/friction + air control
  from `input.moveX` via `setVelocityX`; (3) resolve jump — if `jumpBufferTimer>0 ∧ (grounded ∨
  coyote)`: set `vy`, **zero `jumpBufferTimer` AND `coyoteTimer`** (consume — review fix), kick the
  stretch; then release-cut while rising; (4) fall-gravity juice via `body.setGravityY` (terminal
  fall is the Y `maxVelocity`, not a manual clamp); (5) update facing; (6) update squash/stretch/
  tint on the VISUAL. Collisions are resolved by Arcade colliders in GameScene **before** `update`
  reads `blocked.*` — Phaser runs the physics step, then scene `update`, so
  `body.blocked.down/left/right` are fresh.

**Test room (`GameScene` rewrite).** A hand-built single-screen room that exercises every
feature (no generation yet — that's Phase 2):
- **Floor** spanning the bottom + **left/right walls** (static rectangles → static bodies) so the
  player can't leave the room and wall-collision is visible.
- **Two raised solid ledges** at different heights to jump between (tests variable jump + coyote
  by walking off their edges).
- **One one-way (semi-solid) platform.** Arcade supports this via a collider with a
  **`processCallback`** that only collides when the player is **above and falling onto** it
  (`player.body.velocity.y >= 0 && player.body.bottom <= platform.body.top + epsilon`) — so you
  can jump **up through** it but land **on** it. Three review pins:
  - **Argument order:** we register the collider as `(player.collider, oneWay)` so the
    processCallback's `(obj1, obj2)` are ALWAYS `(player, platform)` in that order (Arcade calls
    it in registration order) — so `player.body.bottom` / `platform.body.top` read the right
    bodies regardless of internal tree order.
  - **Epsilon:** concrete value `MAX_FALL_SPEED · MAX_DT` (max per-step penetration of a fast
    faller), so a quick descent whose feet dipped slightly past the top within one frame still
    grabs the platform instead of tunnelling.
  - **Standing:** while resting on top, `vy≈0` and `player.body.bottom≈platform.body.top`, so the
    predicate keeps returning true — that is CORRECT (it keeps you supported), not a bug to "fix".
  We use the processCallback form (not `body.checkCollision` flags) because it's explicit and
  testable, and matches the predicate shape later combat/enemy colliders use. This is the AC's
  "one-way platform".
- A **pit/gap** in the floor section (so dodging across / falling in is possible; world bounds +
  floor below catch the player — no death yet, Phase 5 owns hazards).
- **Spawn** the player above the floor; **camera.startFollow(player.rect)** with a **deadzone**
  (`camera.setDeadzone(w,h)`) and **lerp** (`camera.setLerp(LERP_X, LERP_Y)`) for smooth,
  non-jittery follow within the existing camera bounds (Decision 8). Room is wider than the
  viewport so follow is observable. HUD launch + teardown unchanged from Phase 0.
- **ESC → Title** dev hint retained; label updated to list controls.

**Camera follow (deadzone + lerp).** `camera.startFollow(target, roundPixels=true, LERP_X,
LERP_Y)` + `camera.setDeadzone(DEADZONE_W, DEADZONE_H)`. The deadzone is a centered box the
player can move within before the camera scrolls (kills micro-jitter from run accel); the lerp
(`<1`) eases the camera toward the target each frame (Phaser applies it framerate-aware). Values
are named constants in GameScene. Follow is clamped by the camera bounds set in Phase 0, so the
camera never shows outside the room.

### 6.2 Phase 2 — Procedural levels (THIS PHASE — see the phase-order note in §3/§AC)

**Goal.** Replace the hand-built test room with a **deterministically generated** level. A PURE,
seeded generator (`world/LevelGenerator.js`) returns a plain **level description** — a tile grid
(`EMPTY|SOLID|ONEWAY|HAZARD`), `entrance`/`exit` doors, merged solid `platforms`, and
`enemies[]`/`pickups[]` spawn points — that is **traversable entrance→exit by construction**
(every required jump is within the player's measured reach). A Phaser-coupled `world/TileMap.js`
turns that description into Arcade **static** bodies + primitive tiles; an `entities/Door.js` is
the exit. GameScene now **builds a generated level** (seeded from a fixed run seed for now),
spawns enemies/pickups at the generated points, and reaching the Door **re-generates the next
level**. A headless `verify-gen.mjs` sweep proves determinism + traversability + bounds for MANY
seeds. Everything stays framerate-independent + allocation-sane; the generator is pure (Decision 33).
This phase satisfies **AC19 + AC27–AC30** (the Phase-2 block; numbers chosen to avoid the Combat
20–26 collision — see the AC-numbering note in §3).

**The level description (the contract between generator, renderer, scene, verifier).**
`generateLevel(seed, biomeConfig)` returns a plain object (no Phaser, no functions on it — pure
data so it serializes for the regression pin):

```
{
  cols, rows, tileSize,            // grid dimensions + px per tile (TILE=32)
  worldWidth, worldHeight,         // cols·tileSize, rows·tileSize (TileMap sets bounds from these)
  tiles,                           // rows×cols Int array of EMPTY|SOLID|ONEWAY|HAZARD enums
  entrance: { col, row, x, y },    // spawn cell (EMPTY, standable) + its world center
  exit:     { col, row, x, y },    // exit cell (EMPTY, standable, distinct from entrance)
  platforms: [ { col, row, len, type } … ],  // merged horizontal solid/one-way runs (Decision 37)
  enemies:  [ { x, y, spec } … ],  // standable world spawn points (Decision 38) + which spec
  pickups:  [ { x, y, kind } … ],  // standable world spawn points (kind: 'cell'|'gold' placeholder)
  seed, biomeId,                   // echoed for debugging + the next-seed chain (Decision 40)
}
```

The TILE enums are small ints exported from `LevelGenerator.js` (`TILE = { EMPTY:0, SOLID:1,
ONEWAY:2, HAZARD:3 }`) so generator, TileMap, and verifier share ONE definition (DRY).

**Generation algorithm (the reach-bounded staircase walk — Decisions 34/35).** PURE; one seeded
`mulberry32(seed)` RNG threads the whole generation so the same seed is byte-identical.

1. **Dimensions** from `biomeConfig` (`cols/rows`), clamped to `[MIN,MAX]` bounds (AC28). Init the
   grid to `EMPTY`.
2. **Floor band** along the bottom rows = `SOLID` (the ground the staircase sits above; gives the
   room a base + catches falls). Side columns = `SOLID` walls (room edges; Decision: world bounds
   also catch the player, but the wall tiles make it read + keep spawns off the edge).
3. **The critical-path platform chain.** Place platform 0 (the **entrance** platform) at the left,
   on/near the floor. Repeatedly place platform `k+1` from platform `k` by drawing a seeded
   `gapTiles ∈ [MIN_GAP, MAX_GAP]` (horizontal advance) and `stepTiles ∈ [-MAX_STEP_UP,
   +MAX_STEP_DOWN]` (vertical change), each STAMPED as a short `SOLID` run; continue until the
   walk's x passes `cols - margin`. The LAST platform is the **exit** platform. Because every
   `(gap, step)` is inside the player's measured reach (Decision 35), platform `k → k+1` is always
   jumpable → the entrance→exit path is traversable BY CONSTRUCTION (AC27).
4. **`entrance`/`exit` cells** = the standable `EMPTY` cell directly ABOVE the first/last platform's
   top tile (feet on the platform). Asserted distinct + in-bounds (AC28).
5. **Off-path decoration (seeded, bounded).** Scatter a few extra `ONEWAY` ledges and `HAZARD` tiles
   at seeded positions that are NOT on the critical path. Counts come from `biomeConfig`
   (`oneWayLedges`/`hazardPatches`). Beyond avoiding occupied tiles, decoration is kept out of the
   **swept JUMP CORRIDOR** between consecutive critical platforms — a coarse rectangular mask of the
   airspace + launch/landing bands the player's real trajectory passes through (review MINOR: the
   verifier proves a PLATFORM-graph BFS, so a hazard in the airspace between two reachable platforms
   would be off the graph yet on the player's path). Masking the corridor makes the "never blocks the
   route" claim hold for the actual walked path, not merely the abstraction. Hazards sit ON a support
   (no floating spikes) and are render-only this phase (damage is Phase 5 — YAGNI).
6. **Standable-cell set + spawns (Decision 38).** Scan the grid ONCE for every `EMPTY` cell with a
   `SOLID`/`ONEWAY` directly below = the standable set. Draw `n ∈ [minEnemies, maxEnemies]` enemy
   spawns + a few pickup spawns from it via the RNG (excluding cells too near the entrance so the
   player isn't ambushed on frame 1). Convert each to a world coord (tile center x, platform-top y −
   half body). Emit `enemies[]`/`pickups[]`.
7. **`platforms[]`** = merge each contiguous horizontal run of `SOLID` (and separately `ONEWAY`)
   tiles per row into one `{col,row,len,type}` (Decision 37) — computed here so TileMap + verifier
   reuse it.

**Jump-reach predicate (shared, pure — Decisions 35/36) — a TRUE 2-D ENVELOPE (review BLOCKER #1).**
`canReachStep(dxTiles, dyTiles)` → boolean. The PRIOR design treated the two axes as INDEPENDENT
(`|dx| ≤ MAX_GAP` AND `dy ≥ -MAX_STEP_UP`). That is unsound in principle: jump reach is **coupled** —
a max-height jump leaves LESS horizontal reach and vice-versa — so it was safe only by luck of the
specific budgets, and a one-line re-tune (e.g. `MAX_STEP_UP=4`) could silently emit unreachable
"verified" levels. **FIX:** the horizontal allowance is now a FUNCTION of `dy`, derived from the real
Player.js physics (`rawReachPx(dyPx)` in `LevelGenerator.js`):

- Ascent gravity `g_up = GRAVITY (1500)`; descent gravity `g_down = GRAVITY + FALL_GRAVITY_EXTRA
  (2400)` (the fast-fall); apex climb `v²/2g_up ≈ 128.1px`.
- To LAND ON TOP at a target `up` px higher, the body must cross height `up` with a downward
  (real-landing) velocity — the DESCENDING crossing after the apex, which is the LATEST/longest air
  time: `t = v/g_up + sqrt(2·(apex−up)/g_down)`, so `rawReach(up) = RUN_SPEED·t · REACH_MARGIN(0.7)`.
- `canReachStep` returns `|dx|·TILE ≤ rawReachPx(dy·TILE)` (plus the `dy ∈ [−MAX_STEP_UP,
  MAX_STEP_DOWN]` bound the generator places within). The 0.7 margin makes the envelope a
  conservative **under**-estimate of true reach, so a verifier PASS is sound (never a false PASS).

**Soundness PROVEN, not lucky.** Worked corner (the reviewer's load-bearing case): at `up = 3 tiles
(96px)` → `rawReach ≈ 184.6px`; `×0.7 ≈ 129.2px ≥ MAX_GAP (4 tiles = 128px)`, so the worst-case
"max-up + max-across" jump is inside the safe envelope **with** margin. This is no longer "by luck of
the numbers": `LevelGenerator.js` runs **module-load assertions** that throw if `MAX_GAP` exceeds the
coupled reach at `MAX_STEP_UP` (or if `MAX_STEP_UP` exceeds the apex), so any future budget re-tune
that would break reach fails LOUDLY at import instead of producing unreachable levels.

The generator uses `canReachStep` to bound the walk; the verifier uses the SAME function (imported,
DRY — Decision 36) to build the platform graph and BFS entrance→exit. Because both call the identical
`platformStep` + `canReachStep`, they cannot check different graphs (see the pinned metric below).

**The EXACT metric (review BLOCKER #2) — ONE measurement, byte-identical in walk + BFS.** "gap" and
"step" must measure one thing in both the generator's placement and the verifier's edge
construction, or the verifier proves a different graph than the player traverses. PINNED in
`platformStep(a, b)` (exported from `LevelGenerator.js`; both sides import it — they cannot disagree):

- A platform IS its merged SOLID/ONEWAY run `{ col, row, len }`; its walkable TOP is row `row`,
  spanning columns `[col, col+len−1]`. The player stands on top.
- **VERTICAL step** `dy = b.row − a.row` — platform-TOP row to platform-TOP row (negative = `b`
  higher, since smaller row index is higher on screen).
- **HORIZONTAL gap** `dx` = the NEAREST-EDGE clear column gap in the travel direction: `b.col −
  (a.col+a.len−1)` if `b` is to the right; `(b.col+b.len−1) − a.col` if to the left; `0` if the
  spans overlap in columns. This is the clear gap the player's leading foot must clear.

The generator places each next platform so `canReachStep(platformStep(prev, next))` holds; the
verifier rebuilds the graph from the EMITTED `platforms` via the SAME `platformStep` + `canReachStep`
and BFSes it. Identical math on both sides — the "independent check" value is preserved because the
verifier re-derives the graph from the emitted tiles, not the walk's intent (Decision 36), while the
*metric* is shared (so a PASS means the real traversal graph is solvable, not a different one).

**`world/TileMap.js` (Phaser-coupled — Decisions 22/37).** `new TileMap(scene, description)`:
- Sets `physics.world.setBounds` + `cameras.main.setBounds` to `worldWidth/Height`.
- Builds a `solids` static group: for each `SOLID` `platform` run, one drawn rectangle promoted to a
  static body (merged span, not per-tile). Walls + floor band are runs too.
- Builds a `oneWay` static group for `ONEWAY` runs (rendered amber; GameScene keeps the §6.1
  processCallback one-way collider against this group).
- Renders `HAZARD` tiles as a distinct primitive (e.g. red spikes rectangle) — non-colliding this
  phase (a `hazards` group is exposed for Phase 5 to wire damage).
- Exposes `solids`, `oneWay`, `hazards`, and `destroy()` (tears down all created GameObjects + bodies
  so a level→level rebuild leaks nothing — Decision 40's in-place regeneration depends on this).

**`entities/Door.js` (Decision 40).** A plain class holding a drawn rectangle + an Arcade body (a
sensor — overlap, not collide) at the description's `exit` world position; `onExit` callback fired
by GameScene's overlap. Rendered as a distinct primitive (a glowing yellow slab). An ENTRANCE marker
is drawn by GameScene (cosmetic) so the start reads. `destroy()` for rebuilds. The Door does NOT
self-guard double-firing or self-destroy — that discipline lives in GameScene (next paragraph).

**GameScene changes (replace the hand-built room — §6.1/§6.3 geometry is removed).**
- `create()`: pick the run seed (a fixed `START_SEED` placeholder until RunState exists in a later
  phase), `this.biome = PRISON` (from `config/biomes.js`), construct the PERSISTENT pieces (Player,
  Input, Effects, both HitboxPools, the enemy hurtbox group, the combat overlaps, the camera follow),
  then `this._buildLevel(seed)`.
- `_buildLevel(seed)`: `desc = generateLevel(seed, this.biome)`; `this.tileMap = new TileMap(this,
  desc)`; reposition the Player at `desc.entrance` via `body.reset()` (clears residual velocity);
  for each `desc.enemies` spawn an `Enemy` with patrol bounds **taken directly from the generated
  entry** (`e.patrolMinX/patrolMaxX`) — the GENERATOR derived them from the owning platform run's
  world span (Decision 41), so the scene never maps a world coord back to a platform, and the bounds
  are guaranteed wide enough (enemies only spawn on runs ≥ `MIN_ENEMY_PLATFORM_TILES`); for each
  `desc.pickups` drop a placeholder primitive; place the `Door` at `desc.exit`. Re-wire the PER-LEVEL
  colliders against the new `tileMap.solids` / `tileMap.oneWay`. The one-way collider's
  `processCallback` reads the **player's COLLIDER body** (`player.body.bottom`), NEVER the
  squash-scaled visual (the §6.1 / review-issue-#6 invariant, preserved through this rewrite); its
  epsilon is `MAX_FALL_SPEED · MAX_DT` (**derived**, not a magic literal — review MINOR).
- `_onDoorOverlap()` (the Door's overlap callback) — **re-entrancy + footgun guards (review MAJOR):**
  Arcade fires overlap EVERY frame the bodies overlap, and `_nextLevel()` destroys the current
  tileMap/enemies/door. Two pins: (1) a one-shot `this.transitioning` flag — `_onDoorOverlap` returns
  immediately if it's already set, so a multi-frame overlap fires the transition exactly once (it's
  cleared only after the rebuild completes); (2) the actual teardown+rebuild is DEFERRED to the next
  tick via `time.delayedCall(0)` — never run inside the overlap callback — because destroying a
  collider's body while Arcade is iterating its colliders list (`world.step`) is a classic footgun.
- `_nextLevel()`: advance the seed (`nextSeed(this.seed)`), `_teardownLevel()` (remove per-level
  colliders, force-despawn enemies, destroy pickups/markers/door/tileMap — KEEP the Player, Input,
  Effects, HitboxPools, HUD, and the persistent combat overlaps), `_buildLevel(this.seed)`, log the
  transition (AC30), clear `transitioning`. The **generator GUARANTEES** the new entrance (far left)
  and new exit (far right) are ≥ ~20 tiles apart (the staircase spans 40+ cols; verified ≥ 52 across
  seeds), so re-spawning the Player at the entrance can NEVER overlap the freshly-placed exit Door on
  the rebuild frame — stated here as the invariant the rebuild relies on. A camera flash marks it.
- `update()`: unchanged in shape (dt boundary, hit-stop, player/enemy ticks, FX, HUD). Gameplay is
  frozen while `transitioning` (the rebuild is mid-flight) as well as during the death handoff.

**`config/biomes.js` (NEW, PURE — Decision 39).** Exports `PRISON` (and a `BIOMES` map): `{ id,
cols, rows, minEnemies, maxEnemies, minPickups, maxPickups, oneWayLedges, hazardPatches,
platformLenRange, colors:{ solid, oneWay, hazard, bg, entrance, exit } }`. Decoration uses bounded
COUNTS (`oneWayLedges`/`hazardPatches`), not per-tile chances, so the seeded sweep is deterministic +
size-independent. `platformLenRange` min is ≥ 3 (standable runs). Size BOUNDS (`COLS_MIN/MAX`,
`ROWS_MIN/MAX`) for AC28 are exported here too — the single source the generator clamps to AND the
verifier asserts against. Pure data so the verifier sweeps the real config.

**`scripts/verify-gen.mjs` (GROWN — AC19/27/28).** In addition to the existing rng/combat pins, it
imports `generateLevel`, `TILE`, `canReachPlatform` from `world/LevelGenerator.js` and `PRISON` +
the size bounds from `config/biomes.js` (all PURE — a successful node import re-proves the purity
convention, Decision 33), then sweeps **N = 200** seeds (spread by a Knuth multiplicative hash) and
for EACH asserts:
- **Determinism (AC19):** `generateLevel(seed, PRISON)` twice → **element-wise DEEP-EQUAL** (a local
  `deepEqual` recurses arrays/objects; a plain `===` would compare the `tiles` 2-D int grid by
  REFERENCE — two fresh generations have different array objects — so element-wise is required,
  review MINOR). Fast headlessly: each call is pure integer work over a ~64×22 grid; 200×2 calls +
  the deep-equal run in well under a second.
- **Regression pin (AC19) — a FULL reference, not a vague hash (review MAJOR):** for ONE fixed seed
  (`0x1234abcd`) over a small biome, deep-equal the WHOLE structured description (cols/rows/world/
  entrance/exit/enemies/pickups/seed/biomeId) AND the `tiles` grid pinned via a SPECIFIED, stable
  **row-major string serialization** (each row = its tile ints joined). The pinned values are
  COMPUTED from the real generator (like the rng pin), never hand-invented — an algorithm change
  fails loudly; regenerate by re-running, never edit to silence.
- **Bounds (AC28):** `cols/rows` within `[COLS_MIN/MAX, ROWS_MIN/MAX]`; `exit` non-zero, in-bounds,
  `!==` entrance; entrance + exit cells are `EMPTY` AND standable; enemy count `≤ maxEnemies`.
- **No spawn in a wall (AC28):** every `enemies[]`/`pickups[]` point maps to a cell that is `EMPTY`
  with a `SOLID`/`ONEWAY` directly below (re-derived from `tiles`, independent of the generator's
  intent — Decision 38).
- **Traversable (AC27):** build the platform reachability graph from `platforms` using
  `canReachStep`, BFS from the entrance platform, assert the exit platform is reached (Decision 36).
Exits non-zero on any failure so `npm run verify` gates CI. (It does NOT import TileMap/Door — those
are Phaser-coupled; importing them would throw under node, which is the convention's whole point.)

**Why this is the minimum that satisfies AC19 + AC27–AC30 without over-reaching (YAGNI):** ONE biome ships
(the config signature is multi-biome-ready; the **ordered multi-biome list `BIOME_ORDER` arrives in
Phase 4** — §6.4); hazards render but don't damage yet (Phase 5); pickups are placeholder markers (the
gold/scrolls + Cells economy is Phase 5); the next-seed chain is a simple deterministic advance (a real
**`RunState` + biome progression is Phase 4** — §6.4); the layout is the reach-bounded staircase (a
cave/branching generator is a later biome behind the same signature).
Each deferral is a clean seam — the pure `generateLevel(seed, biomeConfig)` contract + the
description shape are exactly what later phases extend, not rewrite.

### 6.3 Phase 3 — Combat (THIS PHASE — built now, see the phase-order note in §3)

**Goal.** Make the world *fight back* and give the player teeth. On top of the Phase-1 controller
and the hand-made test room (§6.1), add: a **player melee** with a **2–3 hit light combo** via
**transient pooled hitboxes**; a unified **damage pipeline** (hitbox vs hurtbox → damage,
knockback, hitstun, hit-i-frames, **BACKSTAB** crit); **player HP** with damage i-frames + a flash
+ a placeholder death handoff; a **base `Enemy`** with an `idle/patrol/chase/attack/hurt/dead`
**state machine** (telegraphed attack, contact damage, HP, knockback reaction, death-drop hook for
Phase 4), with **one concrete enemy** wired live into the room; and a **pooled effects layer**
(hit sparks, floating damage numbers, screen shake, **hit-stop**) for game feel. Everything is
framerate-independent off the existing `dt` boundary and allocation-free per hit after warm-up.

**Reuse of the established foundation (no re-architecture):**
- The Player already exposes `body`, `collider` (body owner), `rect` (visual), `frontMarker`,
  `facing`, `state` (`RUN|DODGE`), and `isInvulnerable()` (dodge i-frames). Combat ADDS to this,
  it does not rewrite it: a new `ATTACK` state peer, HP fields, a `hurtIframeTimer`, an `onHit`,
  and an `attack(...)`/combo tick. Dodge i-frames keep meaning "can't be hit".
- GameScene already owns the **dt boundary** (`delta/1000`, clamped `MAX_DT`) and samples Input
  once/frame (BLOCKER #1). Combat hooks into THAT same tick: it scales the gameplay-dt for
  hit-stop (Decision 24) and ticks enemies + effects with the same clamped `dt`.
- Colliders/overlaps target the **collider** body (never the squash-scaled visual) — same rule as
  Phase 1's one-way `processCallback` (review issue #6).

**New / changed modules this phase** (only what Combat needs — YAGNI):

```
src/combat/hitbox.js   — NEW, **100% PURE** (no Phaser import; Decision 28). Headlessly importable.
                         · SWINGS table: per-swing tuning (reach, halfHeight, damage, knockback,
                           active, recovery, comboWindow, lunge) for the 2–3 hit light combo.
                         · swingRect(attacker, swing) → {x,y,w,h}: the world AABB of swing N placed
                           in front of `attacker` by its `facing` (PURE — no Phaser; testable).
src/combat/HitboxPool.js — NEW, Phaser-COUPLED (Decision 28 — split OUT of hitbox.js so the pure
                         file stays node-importable). A fixed set of invisible rectangle+Arcade
                         bodies in an overlap `group`; acquire() positions+enables one for a swing's
                         active window carrying { ownerId, swing, hitSet:Set, releaseTimer },
                         release() disables it back. tick(gdt) decays releaseTimers on the GAMEPLAY
                         dt (Decision 26). ZERO per-hit allocation after construction (Decision 16/20).
src/combat/damage.js   — NEW, PURE (no Phaser). resolveHit(attacker, victim, swing, opts) →
                         { damage, knockbackX, knockbackY, isBackstab }. Owns the backstab predicate
                         (Decision 19) + crit multiplier + knockback direction (away from attacker).
                         Unit-testable; reused by player→enemy AND enemy→player (Decision 17).
src/effects/ParticlePool.js — NEW. Fixed pool of reusable spark rectangles (+ a pooled set of
                         floating damage-number Text objects). spawnSparks(x,y,opts) /
                         spawnNumber(x,y,value,opts); each active item eases (move+fade) off dt and
                         auto-returns to the pool. No allocation per hit after warm-up (convention).
src/effects/Effects.js — NEW. The juice FAÇADE over ParticlePool + the camera: hit(x,y,opts) fires
                         sparks + a number + camera.shake + requests hit-stop; tick(dt) advances the
                         pools. Single call site per impact (Decision 23). Owns shake/hitstop params.
src/entities/Enemy.js  — NEW. Base enemy: a plain class (Decision 10 shape) holding collider+visual,
                         hp/maxHp, a string-enum FSM (idle/patrol/chase/attack/hurt/dead, Decision 22)
                         ticked by the scene with a ctx {player, dt, effects}. Telegraphed melee +
                         contact damage; onHit(result) → hurt(knockback+hitstun); die() → death pop +
                         a dropCells() HOOK (no-op number now; Phase 4 spawns pickups). Configurable
                         via a spec object; ships ONE concrete config (a "Brute" melee grunt).
src/entities/Player.js — EXTEND (not rewrite). Add: hp/maxHp, hurtIframeTimer, knockback support, an
                         ATTACK state + comboIndex/comboWindowTimer/attackTimer, attack() that spawns
                         a swing hitbox from the pool, onHit(result) (flash + damage iframe + knockback
                         + death edge), and an isHittable() (false while dodge-iframes OR hurt-iframes).
                         Movement is reduced (not frozen) during ATTACK. Death fires a scene callback.
src/core/Input.js      — EXTEND. Add attackPressed (edge) bound to J + left-click; KEEP jump on
                         Space (jump moves OFF J to avoid the J double-bind). dodge stays Shift/K.
                         JustDown stays SOLE-owned here (review issue #5); pointer down read once too.
src/scenes/GameScene.js— EXTEND. Build the combat groups (player-hitbox pool overlap vs enemy
                         hurtboxes; enemy-attack/contact vs player), spawn ≥1 Enemy into the room,
                         construct Effects, route overlaps → resolveHit → onHit + effects.hit, apply
                         the hit-stop dt scale in update(), wire player-death → placeholder transition.
src/scenes/HUDScene.js — EXTEND. Read player HP from the scene registry / an event and draw a HP bar
                         (+ a combo/cells readout placeholder). Stays decoupled (Decision 2).
src/config/constants.js— (maybe extend) only truly cross-site combat constants (e.g. a shared
                         KNOCKBACK feel scalar) land here; per-entity tuning stays co-located in its
                         owner (Player swing table, Enemy spec) — DRY, not a config dumping ground.
```

**dt / framerate (unchanged contract).** Every new timer (combo window, attack active/recovery,
hurt i-frames, enemy telegraph/patrol/attack timers, spark/number life, hit-stop) is in **SECONDS**
and decays by the same clamped `dt` GameScene already produces. Eases use `1−exp(−k·dt)`. No
`setTimeout`/`setInterval` anywhere in the gameplay loop (Decision 24).

**Hit pipeline (the spine of the phase).** One direction shown; the reverse (enemy→player) reuses
the same pieces:
1. Player presses attack → `Player.attack()`: if not in `DODGE` and `attackTimer<=0`, advance
   `comboIndex` (or start at 0 if the combo window lapsed), enter `ATTACK`, set `attackTimer =
   active+recovery`, and **acquire a hitbox from the pool** for `SWINGS[comboIndex]`, placed via
   `swingRect(player, swing)` in front of `player.facing`, tagged `{ownerId:'player', swing,
   hitSet:new Set()}`, enabled for the swing's `active` window then released.
2. Arcade `overlap(playerHitboxGroup, enemyHurtboxGroup, onOverlap, processFilter)` fires while the
   hitbox is active. `processFilter` returns false if `hitbox.hitSet.has(enemy.id)` (per-swing dedup,
   Decision 20) **or** the enemy is `dead`/not `isHittable()`.
3. `onOverlap(hitbox, enemyHurtbox)` → `result = resolveHit(player, enemy, hitbox.swing)`
   (`damage.js`, pure). Add `enemy.id` to `hitbox.hitSet`. Call `enemy.onHit(result)` (subtract HP,
   knockback via `body.setVelocity`, set hitstun, arm enemy hit-iframe, → `hurt` state; if HP≤0 →
   `die()`/drop hook). Call `effects.hit(enemy.x, enemy.y, {damage, isBackstab})` (sparks + number +
   shake + hit-stop request).
4. Enemy→player is the mirror: the enemy's **attack strike** (or **contact**) overlaps the player
   hurtbox; gated by `player.isHittable()` (false during dodge-iframes OR hurt-iframes); resolves
   through the SAME `resolveHit` + `player.onHit` (flash, damage-iframe, knockback, death edge).
   Enemy attacks get crit OFF by config (Decision 19) for fairness; contact damage is a flat tick on
   a short internal cooldown so standing in an enemy doesn't shred HP every frame.

**Player additions (in `Player.js`).**
- **State:** add `ATTACK` (and `HURT` lockout, Decision 32) to the enum. Precedence:
  `DODGE` > `ATTACK` > `RUN`; `HURT` is a brief knockback-lockout overlaid on whichever state you
  were in. You cannot attack mid-dodge; a dodge press still works during attack recovery (defensive
  option always available — Decision 25 relaxes the dodge-start guard to `state !== DODGE`).
- **Combo (Decision 31):** `comboIndex` (which swing, `-1` = chain reset), `comboWindowTimer` (decays
  ONLY while `RUN && attackTimer<=0`; when it hits 0 → `comboIndex = -1`), `attackTimer` (active+
  recovery lock; next `attack()` allowed only at ≤0). When `attackTimer` reaches 0 the swing ends:
  `state → RUN` and `comboWindowTimer = SWINGS[comboIndex].comboWindow` so a follow-up press chains;
  if the window lapses first the chain resets. Movement during ATTACK: `vx` integrates but with
  accel/top-speed scaled by `ATTACK_MOVE_SCALE` (committed but mobile); a small forward "lunge" nudge
  on the heavier finisher (applied once at `attack()` time).
- **`update` integration (Decision 25 — the exact control-flow edits):** step (1) timers now ALSO
  decay `attackTimer`/`comboWindowTimer`/`hurtTimer` and run the symmetric ATTACK→RUN exit; the
  dodge-start guard is `state !== DODGE` (and a dodge cancels an in-progress attack); NEW step (1.5)
  fires the buffered `attack()` edge; step (2) horizontal branch is `DODGE→dash · HURT→leave vx
  (knockback carries) · ATTACK→scaled run · else→run`; steps (3)-(6) unchanged (jump is NOT cancelled
  by attacking).
- **HP / reaction (Decisions 32):** `hp`, `maxHp`, `hurtIframeTimer`, `hurtTimer`. `isHittable()` ⇔
  `!isInvulnerable() && hurtIframeTimer<=0`. `onHit(result)`: if not hittable, ignore; else subtract
  HP, set knockback velocity directly + arm `hurtTimer` (the lockout that lets it survive the
  per-frame vx write), arm `hurtIframeTimer`, kick a **flash** (reuse the existing tint path — flash
  red while hurt-iframed, distinct from the dodge yellow), and if `hp<=0` fire the death edge
  **once** (guard with a `dead` flag) via a scene callback. Emit HP to the registry/event for the HUD
  each change.
- **Visuals:** a brief swing telegraph — flash the existing `frontMarker` to the swing reach + a
  color pop for the swing's active window (primitives only; the hitbox body itself stays invisible).

**Enemy (`entities/Enemy.js`) — the FSM (Decision 22).** Plain class, same shape as Player: an
invisible `collider` (Arcade body, the hurtbox/contact source) + a visible `rect` + a `frontMarker`,
`hp/maxHp`, `facing`, `id`, and `state`. Built from a **spec** (`{maxHp, speed, detectRange,
attackRange, telegraph, attackActive, attackRecovery, contactDamage, swing, color, patrol}`); ships
ONE concrete spec, a melee **Brute**. `update(dt, ctx)` runs a `switch(state)`:
- **idle** → after a beat, → `patrol`.
- **patrol** — walk between patrol bounds (or until a wall/ledge edge); if the player is within
  `detectRange` (and roughly same height), → `chase`.
- **chase** — accelerate toward the player (capped); face the player; if within `attackRange` and
  off attack-cooldown → `attack`; if the player escapes detect range for a grace period → `patrol`.
- **attack** — a **telegraph** sub-phase first (freeze, color-shift wind-up for `telegraph` seconds
  — readable + dodgeable), then a **strike** that enables a transient attack-hitbox (pooled, same
  mechanism) for `attackActive`, then `attackRecovery`, then → `chase`. Contact damage is separate
  (always-on while touching, on its own cooldown).
- **hurt** — entered by `onHit(result)`: apply knockback + a `hitstunTimer`; movement/AI frozen
  until it expires, then → `chase` (re-aggro). Interrupts a telegraph/strike (cancels the pending
  hitbox) — so a well-timed hit beats the enemy's attack.
- **dead** — at `hp<=0`: disable bodies, play a short death pop (scale + fade via the effects/own
  tween), call `dropCells()` (HOOK: logs/no-ops the count now; Phase 4 spawns Cell pickups), then
  remove from the scene's enemy list. Guarded so it runs once.
`onHit(result)` is the SAME entry the player uses (DRY): subtract HP, arm a short enemy hit-iframe
(so one swing's dedup + the iframe both protect against re-hit), knockback, → `hurt` or `dead`.

**Effects (`effects/Effects.js` + `effects/ParticlePool.js`) — pooled juice (Decision 23).**
- `ParticlePool`: pre-creates `N` small spark rectangles (alpha 0, disabled) and `M` floating
  damage-number `Text` objects. `spawnSparks(x,y,{count,color,speed})` acquires sparks, gives each a
  random velocity + life; `spawnNumber(x,y,value,{color})` acquires a number that floats up + fades.
  `tick(dt)` advances every active item (move by `v·dt`, fade, shrink) and **returns** it to the pool
  at end-of-life. A high-water pool sized for worst-case on-screen hits; if exhausted, the oldest is
  recycled (never allocates mid-combat).
- `Effects` (façade): holds a `ParticlePool` + the `camera`. `hit(x,y,{damage,isBackstab})`:
  `spawnSparks` (more + crit-color on backstab), `spawnNumber(value)` (crit-color + bigger on
  backstab), `camera.shake(durMs, intensity)` (scaled to `damage`/crit), and `requestHitstop(secs)`
  (scaled, crit→longer). `tick(dt)` forwards to the pool. The scene owns ONE `Effects`.

**Hit-stop (Decision 24).** GameScene holds `hitstopTimer` (seconds, REAL time). `effects.hit`
sets it (capped, no stacking). In `update(time, delta)`: compute the real `dt = min(delta/1000,
MAX_DT)`; decay `hitstopTimer` by real `dt`; the **gameplay dt** handed to Player/Enemies/Effects is
`hitstopTimer>0 ? 0 : dt` (a hard micro-freeze) — or a small scaled value if we want a "slow" rather
than "stop" (start with hard stop; one constant flips it). Sparks/numbers can keep ticking on real
`dt` so the freeze reads as the *world* pausing while the impact "pops" (tunable). Input is still
sampled once on real `dt` so buffered presses aren't lost during the freeze.

**GameScene wiring (extend §6.1, no room-geometry change).**
- Construct `this.effects = new Effects(this)`; build the player-hitbox `HitboxPool` and the enemy
  groups (enemy hurtbox group, enemy-attack hitbox pool). Spawn ≥1 `Enemy` (Brute) on a floor span /
  ledge with patrol bounds; keep an `this.enemies` array.
- Overlaps (all on collider bodies): `overlap(playerHitboxes, enemyHurtboxes, onPlayerHitEnemy,
  dedupFilter)`; `overlap(enemyAttackHitboxes, playerHurtbox, onEnemyHitPlayer, hittableFilter)`;
  and an enemy **contact** overlap (player vs enemy bodies) on a damage cooldown.
- `update(time, delta)`: real `dt`; decay hit-stop; `gdt = hitstopTimer>0 ? 0 : dt`; sample Input
  once; `player.update(gdt, input)`; `for (e of enemies) e.update(gdt, {player, effects})`;
  `effects.tick(dt)`; emit HP to HUD; release expired hitboxes.
- **Player death edge:** `player.onDeath = () => { /* placeholder */ }` — a short freeze + flash,
  then `this.scene.start('Title')` (placeholder per AC26; real GameOver is a later phase). Guard so
  it fires exactly once (the Player's `dead` flag + a scene `gameOver` flag).
- HUD: push `hp/maxHp` (+ combo, cells-placeholder) via `registry.set` / an event each change;
  HUDScene draws a HP bar reading it (Decision 2 keeps them decoupled).

**Why this is the minimum that satisfies the ACs without over-reaching (YAGNI):** no ranged weapon
yet (the task scopes Phase-3 to MELEE + the combo; ranged/projectile pooling is naturally a later
weapon-variety pass — the `HitboxPool` already proves the pooling pattern it would reuse); no
loot/affixes; one enemy type (the base class is built to be configured, but only one spec ships);
Cells drop is a HOOK (Phase 4 owns pickups + the economy); death is a placeholder edge (Phase 4/later
owns real GameOver + permadeath). Each deferral is a clean seam, not a stub that needs rewriting.


### 6.4 Phase 4 — Run structure (THIS PHASE — the orchestrator's "Phase 4 · Run structure")

**Goal.** ASSEMBLE THE RUN. The procedural-levels phase (§6.2) already chains level→level on a single
biome via a scene-local seed; combat (§6.3) already fights/kills/dies. This phase makes those into a
real **run**: an ORDERED, depth-SCALING sequence of multiple biomes carried by one `RunState`, with
**enemy stats rising with depth**, the player's **HP carried** between levels, and a real
**GameOverScene** that shows a **run summary** (depth reached, biome, time, kills) on death — then
back to Title. The verifier is grown to assert the **difficulty curve is monotonic across biomes**.
This satisfies **AC42–AC47**. Pure modules stay Phaser-free (node-importable); nothing new allocates
per-frame; the whole run is deterministic from a start seed.

**What this phase deliberately does NOT do (YAGNI — deferred to later phases):** the run-only
**gold/scrolls** economy + in-run upgrade choices + the Cells-to-meta BANK (the §6.5 economy block);
a **boss** at the end of the last biome (`endsInBoss` ships `false`; Phase 6); the **Hub** spend
screen + localStorage META persistence (Phase 7 — `RunState` is intentionally separate from `save.js`
so that seam is clean). Each is a populated field / a clean handoff, not a stub to rewrite.

**New / changed modules this phase** (only what the run needs — YAGNI):

```
src/config/difficulty.js — NEW, **100% PURE** (no Phaser; Decision 42). The depth→hardness CURVE,
                           mirroring crowd-runner/config/difficulty.js. Exports:
                           · scaleAtDepth(depth) → { enemyHpMult, enemyDamageMult, enemySpeedMult,
                             enemyCountBonus } — each a monotone-non-decreasing ramp in `depth`.
                           · scaleSpec(baseSpec, scale) → a NEW scaled enemy spec (Decision 45).
                           · effectiveDifficulty(depth, biome) → a single scalar combining the depth
                             curve + the biome's tier (used by the verifier's monotonicity proof).
                           Named ramp constants (HP_PER_DEPTH, DMG_PER_DEPTH, …) at the top; clamped
                           so multipliers stay sane on a long run. Node-importable by verify-gen.mjs.
src/config/biomes.js     — EXTEND. Add an ORDERED `BIOME_ORDER` array (≥3 PURE biome configs:
                           PRISON → SEWERS → RAMPARTS) — each with `name`, `difficultyTier` (monotone
                           int), `endsInBoss:false`, distinct `colors`/`cols`/enemy bands, reusing
                           PRISON's field shape (Decision 43). Keep `PRISON` + the size bounds. The
                           `generateLevel(seed, biomeConfig)` contract is UNCHANGED.
src/core/RunState.js     — NEW, **PURE** (no Phaser; Decision 44). createRunState(startSeed) → a plain
                           object { seed, biomeIndex, depth, hp, maxHp, cells, gold, inventory, kills,
                           startedAt } with methods advance() (next seed/biome/depth), isLastBiome(),
                           biome() (BIOME_ORDER[biomeIndex]), and summary() (the GameOver snapshot).
                           Owns the deterministic seed chain (moved out of GameScene). Node-importable.
src/scenes/GameScene.js  — EXTEND. Construct ONE RunState in create() (fixed start seed for now);
                           _buildLevel reads the CURRENT biome from RunState + scales each enemy spawn
                           by scaleAtDepth(depth) (Decision 45); _nextLevel calls runState.advance()
                           (HP carried, NOT refilled — Decision 46); past the last biome → run-complete
                           handoff (Decision 48); player death → scene.start('GameOver', summary)
                           (Decision 47); bump runState.kills on each enemy death; sync runState.hp.
src/scenes/GameOverScene.js — REWRITE the stub (Decision 47/48). Read the run-summary from
                           this.scene.settings.data and render it (depth, biome, time, kills); a
                           `completed` flag flips the header ("GAME OVER" red ↔ "RUN COMPLETE" gold).
                           → Title on key/click. Stays DECOUPLED (never touches the live GameScene).
src/scenes/HUDScene.js   — EXTEND (small). Also read depth/biome name from the registry and show a
                           "DEPTH n — BIOME" readout next to the HP bar (so rising difficulty reads
                           live). Stays decoupled (registry only, Decision 2).
scripts/verify-gen.mjs   — GROW (Decision 49). Import scaleAtDepth/effectiveDifficulty/scaleSpec +
                           BIOME_ORDER + createRunState; assert the curve scalars + biome tiers +
                           combined effectiveDifficulty are monotonic across the WHOLE run, and the
                           RunState seed chain is deterministic. Keeps every existing pin.
```

**`config/difficulty.js` (the curve — Decision 42, mirrors crowd-runner).** PURE. The CURVE is keyed
on `depth` (0-based levels cleared); the BIOME provides theme/pool/length. Shape:

- `scaleAtDepth(depth)` returns a fresh scalar set, each a simple monotone ramp:
  `enemyHpMult = 1 + HP_PER_DEPTH·depth`, `enemyDamageMult = 1 + DMG_PER_DEPTH·depth`,
  `enemySpeedMult = min(SPEED_CAP, 1 + SPEED_PER_DEPTH·depth)`, `enemyCountBonus = floor(depth /
  COUNT_EVERY)`. Each is non-decreasing in `depth` BY CONSTRUCTION (positive slopes; the speed cap is
  a non-decreasing clamp), so AC42's "rises with depth" is structural, not asserted-by-luck.
- `scaleSpec(baseSpec, scale)` → a NEW object: `{ ...baseSpec, maxHp: round(baseSpec.maxHp·hpMult),
  contactDamage: round(baseSpec.contactDamage·dmgMult), patrolSpeed/chaseSpeed: ·speedMult, swing: {
  ...baseSpec.swing, damage: round(baseSpec.swing.damage·dmgMult) } }`. No mutation of `baseSpec`
  (Decision 45). Lives here so the verifier can sanity-check a scaled spec is ≥ the base.
- `effectiveDifficulty(depth, biome)` = `biome.difficultyTier · TIER_WEIGHT + (enemyHpMult +
  enemyDamageMult)` — ONE scalar that stacks the biome tier and the depth curve, the quantity the
  verifier proves non-decreasing across the run (Decision 49). `TIER_WEIGHT` is NOT a "large enough"
  magic constant: it is DERIVED from a stated lower bound (one tier step must dominate the max the
  curve term could fall at a boundary, bounded by the curve term at a generous max depth) and a
  MODULE-LOAD assertion throws if a re-tune drops below it (review MAJOR — see the TIER_WEIGHT note in
  Decision 53). Because `depth` is run-global (never resets) the tier term is actually redundant for
  monotonicity THIS phase; the derived bound keeps the property robust to a future per-biome reset.
- All ramp constants are NAMED + commented at the top with the design intent (KISS, tunable, clamped).
  `enemySpeedMult` scales BOTH patrol + chase (capped); ranges/telegraph are intentionally NOT scaled
  (Decision 53 — a faster enemy with an unchanged telegraph stays dodgeable).

**`config/biomes.js` (ordered list — Decision 43).** Keep `PRISON`, `BIOMES`, and the size bounds.
ADD:

- `SEWERS` and `RAMPARTS` — same field shape as `PRISON` (DRY), distinct `name`, `colors` (green-
  tinted sewer, grey-stone rampart), slightly longer `cols`, and rising enemy bands. `difficultyTier`
  is `0 / 1 / 2` (monotone). `endsInBoss:false` on all (Phase 6 flips the last). Each carries
  `levels: 3` (BLOCKER 1 / Decision 50 — the biome spans 3 generated rooms before rolling on, so the
  run is 9 levels, not 3 rooms). All within the existing `COLS_MIN/MAX`, `ROWS_MIN/MAX` bounds the
  verifier enforces (AC28 holds for every biome, not just Prison — the level sweep is extended to each
  biome). PRISON also gains `name`/`difficultyTier`/`endsInBoss`/`levels` — the generator IGNORES these
  new fields, so the PRISON regression pin is UNAFFECTED (review MINOR — re-run confirms, it passes).
- `export const BIOME_ORDER = [PRISON, SEWERS, RAMPARTS]` — THE ordering the run walks + the verifier
  sweeps. `BIOMES` becomes `{ prison: PRISON, sewers: SEWERS, ramparts: RAMPARTS }`.

**`core/RunState.js` (the active run — Decision 44/46/50).** PURE plain-object factory (no Phaser, no
`Date`-dependent purity issue: `startedAt` is passed IN by the caller — GameScene passes
`this.time.now`; the verifier passes `0` — so the module itself stays deterministic + headless):

> **REVIEW BLOCKER 1 FIX (Decision 50, below).** The original `advance()` rolled `biomeIndex` on EVERY
> Door, making a 3-biome run only THREE rooms (Prison/Sewers/Ramparts, one room each) and ending on the
> FIRST last-biome Door — so `depth` never climbed far enough for enemy scaling to read (BLOCKER 2 was a
> consequence). THE FIX: each biome carries `levels` (config/biomes.js); RunState tracks `levelInBiome`;
> `advance()` ALWAYS increments `depth` (run-global, never resets) + `levelInBiome`, and rolls to the
> next biome ONLY when the current biome's levels are exhausted. The run completes only when the LAST
> biome's LAST level is cleared (`isRunComplete()`). The verifier's monotonicity walk uses the EXACT
> `advance()` chain (so it does NOT assume `depth==biomeIndex` — it walks `while(!isRunComplete())`).

```
createRunState(startSeed, startedAt = 0) → {
  seed: startSeed >>> 0,
  biomeIndex: 0,
  levelInBiome: 0,          // 0-based level WITHIN the current biome (BLOCKER 1 — Decision 50).
  depth: 0,                 // run-GLOBAL levels cleared (0 at the first level). NEVER resets → the
                            //   difficulty curve climbs across the whole run.
  hp: PLAYER_MAX_HP,        // carried HP (seeded full; imported max so HUD/Player agree — see note).
  maxHp: PLAYER_MAX_HP,
  cells: 0, gold: 0,        // currency PLACEHOLDERS (fields present; spending is a later phase).
  inventory: [],            // placeholder.
  kills: 0,
  startedAt,
  biome() { return BIOME_ORDER[this.biomeIndex] },
  isLastBiome() { return this.biomeIndex >= BIOME_ORDER.length - 1 },
  // True when the LAST biome's LAST level was just cleared — the run is finished (Decision 48/50).
  isRunComplete() { return this.isLastBiome() && this.levelInBiome >= this.biome().levels - 1 },
  advance() {               // Decision 46/50 — deterministic next seed + next level/biome/depth.
    this.seed = nextSeed(this.seed)
    this.depth += 1
    this.levelInBiome += 1
    if (this.levelInBiome >= this.biome().levels && !this.isLastBiome()) {
      this.biomeIndex += 1
      this.levelInBiome = 0  // roll to the next biome only when this biome's levels are exhausted.
    }
    return this
  },
  summary(now, completed) { return {
    depthReached: this.depth, biomeName: this.biome().name,
    timeMs: now - this.startedAt, kills: this.kills, completed: !!completed,
  } },
}
```

- `nextSeed` (the Knuth multiplicative advance) MOVES verbatim from GameScene into RunState so the seed
  chain is one owner (DRY). The same `startSeed` always replays the same biome/seed sequence (AC47).
- **PLAYER_MAX_HP source (avoid the magic-100 drift):** `Player.js` already owns `MAX_HP = 100`.
  RunState needs the same number but must stay PURE (no Phaser-coupled `Player` import). FIX: hoist the
  number to a PURE constant both share — add `PLAYER_MAX_HP` to `config/constants.js` (already the
  cross-site constant owner) and have BOTH `Player.js` and `RunState.js` import it (DRY; one source).
  This is the only change to `Player.js`/`constants.js` this phase.

**GameScene changes (extend §6.2/§6.3 — Decisions 45/46/47/48).**
- `create()`: replace the scene-local `this.seed = START_SEED` + `nextSeed` with
  `this.runState = createRunState(START_SEED, this.time.now)`. `this.biome` is no longer a fixed field
  — each build reads `this.runState.biome()`. Construct the Player as today; AFTER construction sync
  `this.player.hp = this.runState.hp` (carried HP). Everything else (Effects, pools, overlaps, camera)
  is unchanged.
- `_buildLevel()`: `const biome = this.runState.biome()`; `const desc = generateLevel(this.runState.seed,
  biome)`. For each `desc.enemies` spawn: `const scale = scaleAtDepth(this.runState.depth)`; `const
  spec = scaleSpec(BRUTE_SPEC, scale)`; `this._spawnEnemy(e.x, e.y, spec, {patrolMinX, patrolMaxX})` —
  a NEW scaled spec per spawn (Decision 45). The `enemyCountBonus` then adds up to that many EXTRA
  spawns drawn from the generator's `desc.spawnCandidates` SURPLUS list (the standable-enemy cells the
  generator emitted but didn't use — Decision 51, review MAJOR), capped so the live count never exceeds
  `biome.maxEnemies` and bounded by the surplus available. Colors come from `biome.colors`. The Player
  is repositioned at the entrance as today but `player.hp` is NOT refilled — and `_buildLevel` touches
  NEITHER `player.hp` NOR `runState.hp` (the HP sync lives ONLY in `create()` + `_nextLevel`, review
  MAJOR / Decision 46). Wire `enemy.onDeath` to `this.runState.kills++` (see below).
- **Enemy-death kill count:** the Enemy already has a `_die()` that fires `dropCells()`. Add a thin
  scene hook: `_spawnEnemy` sets `enemy.onDeath = () => { this.runState.kills += 1 }` (a new optional
  callback on Enemy, fired ONCE inside `_die()` next to `dropCells()`). The Cells economy is still a
  later phase, but the KILL COUNT the summary needs is free. (No per-frame cost.)
- `_nextLevel()`: **completion check first** (BLOCKER 1 / Decision 50 — using `isRunComplete()`, NOT
  `isLastBiome()`, so the run only ends after the last biome's LAST level, not its first):
  `if (this.runState.isRunComplete()) { this._completeRun(); return }`. Otherwise sync
  `this.runState.hp = this.player.hp` (the carried-HP capture — the ONLY `runState.hp` write on this
  path), `this.runState.advance()`, `_teardownLevel()`, `_buildLevel()`, `_updateHint()`, clear
  `transitioning`. (Reaching the Door past the run's end ends the run — Decision 48 — rather than
  advancing into a non-existent biome/level.)
- `_completeRun()`: `this.runState.hp = this.player.hp`;
  `this.scene.start('GameOver', this.runState.summary(this.time.now, true))` (the run-complete handoff,
  Decision 48). Guard with `this.gameOver` so it fires once.
- `_onPlayerDeath()` (REWRITE the AC26 placeholder): keep the short freeze/flash, then
  `this.runState.hp = 0`; `this.scene.start('GameOver', this.runState.summary(this.time.now, false))`
  instead of `this.scene.start('Title')` — the real GameOver summary handoff (Decision 47). Still
  guarded by `this.gameOver` so it fires exactly once.
- `_emitHud()`: also `registry.set('depth', this.runState.depth)` and `registry.set('biomeName',
  this.runState.biome().name)` so the HUD shows the live depth/biome (HUD stays decoupled).
- `_updateHint()`: include the depth + biome name in the dev label.

**GameOverScene (REWRITE the stub — Decision 47/48).** Reads the summary from
`this.scene.settings.data` (`{ depthReached, biomeName, timeMs, kills, completed }`, with safe
defaults if launched bare). Renders, centered (primitives + text only):
- A header: `completed ? 'RUN COMPLETE' (gold)` : `'GAME OVER' (red)`.
- A summary block: `DEPTH REACHED  n`, `BIOME  <name>`, `TIME  m:ss`, `KILLS  k` (time formatted from
  `timeMs`).
- `Press SPACE / click → Title` → `this.scene.start('Title')` (Hub routing is Phase 7). It NEVER
  reaches into the live GameScene (decoupled — same rule as the HUD). The scene is fully navigable.

**HUDScene (small extend — Decision 2 preserved).** In addition to the HP bar, read `depth` +
`biomeName` from the registry and draw a small `DEPTH n · <BIOME>` label (camera-fixed). Defaults keep
it sane before the first GameScene write. No coupling — registry only.

**`scripts/verify-gen.mjs` (GROW — Decision 49 / AC42).** Add a section 4 (keeping sections 1–3
intact: rng pin, combat purity pins, the 200-seed level sweep):
- Import `scaleAtDepth`, `scaleSpec`, `effectiveDifficulty` from `config/difficulty.js`, `BIOME_ORDER`
  from `config/biomes.js`, and `createRunState` from `core/RunState.js` (all PURE — a successful node
  import re-proves the purity convention, Decision 44/42).
- **Curve monotonicity (AC42):** for `depth` `0..MAXD`, assert each scalar of `scaleAtDepth(depth)` is
  ≥ the previous depth's (non-decreasing); assert `scaleSpec(BASE_SPEC_STUB, scaleAtDepth(depth)).maxHp`
  is non-decreasing too (the SCALED stat actually rises), and that `scaleSpec` does NOT mutate the base.
  (BRUTE_SPEC lives in Phaser-coupled `Enemy.js`, so the verifier uses a PURE minimal `BASE_SPEC_STUB`
  with the numeric fields scaleSpec multiplies — keeping the script Phaser-free; review note.)
- **Biome-tier monotonicity (AC43):** assert `BIOME_ORDER.length ≥ 3`, `BIOME_ORDER[i].difficultyTier`
  is non-decreasing in `i`, and every biome's `cols/rows` are within the size bounds + `levels ≥ 1`.
- **Whole-run monotonicity (AC42/AC49):** drive a `createRunState(SEED)` through `advance()` walking
  `while(!isRunComplete())` (the EXACT chain the game walks — NOT assuming `depth==biomeIndex`, BLOCKER
  1); at each step compute `effectiveDifficulty(rs.depth, rs.biome())` and assert it is non-decreasing
  across the entire run; assert the run ends at `depth === totalLevels−1` on the LAST biome (proving the
  run is the sum of per-biome `levels`, not three rooms — the BLOCKER 1 regression guard).
- **Seed-chain determinism (AC47):** two fresh `createRunState(SEED)` advanced in lockstep produce the
  same `(biomeIndex, levelInBiome, depth, seed)` sequence (the run replays from a start seed).
- **Extend the level sweep to EVERY biome (AC28 across the list):** the existing 200-seed sweep is run
  for EACH biome in `BIOME_ORDER` (not just PRISON), so bounds/no-wall-spawn/traversable hold for all.
Exits non-zero on any failure so `npm run verify` gates the "rising difficulty" + determinism contracts.

**Why this is the minimum that satisfies AC42–AC47 without over-reaching (YAGNI):** the run-only
**economy** (gold/scrolls + in-run upgrades) and the **Cells bank** are NOT built (only currency +
kill PLACEHOLDER fields on RunState); the **boss** gate is NOT built (`endsInBoss:false`, run-complete
is the last-Door edge); the **Hub** + **localStorage meta** are NOT built (RunState is separate from
`save.js`). The generator, Enemy, Player, combat, and level-transition code are REUSED unchanged — the
only new surfaces are the pure curve, the ordered biome list, the pure RunState, the GameOver rewrite,
a tiny HUD/scene wiring, and the verifier growth. Every deferral is a populated field or a clean
handoff (the §6.5 economy + §6.6 boss + §6.7 hub plug into these seams, not rewrite them).

### 6.5 Phase 5 — Run economy (gold/scrolls + Cells bank) *(filled when Phase 5 is designed)*
### 6.6 Phase 6 — Bosses *(filled when Phase 6 is designed)*
### 6.7 Phase 7 — Meta-progression + Hub *(filled when Phase 7 is designed)*

### 6.8 Error handling / edge cases (Phase 0)

- **Storage failures never throw** — every `localStorage` access in `save.js` is `try/catch`;
  on failure callers get the fallback default, so private-mode / disabled / quota-exceeded
  storage degrades gracefully (Decision 6).
- **Determinism is byte-exact** — `mulberry32` is copied verbatim (no `Math.random` anywhere in
  generation paths) so the same seed always yields the same sequence; `verify-gen.mjs` pins it.
- **Resize safety** — a FIXED `1280×720` design world is scaled + letterboxed by `Scale.FIT`
  (Decision 8). Entities are positioned in world coordinates (never viewport dimensions), so a
  window resize only changes the letterbox scale — the world layout and physics are unaffected.
  This is the opposite of `Scale.RESIZE`, which would re-size the world and move entities.
- **No double-running the world or HUD** — Boot is first so it (and only it) auto-starts; all
  other scenes are inert until explicitly started. The parallel HUD is launch-guarded
  (`isActive` check) AND stopped on GameScene shutdown, so re-entering Game can never stack a
  second HUD (Decision 2 + the GameScene teardown above).
- **No asset loads** — BootScene performs no network `load.*` for external files; any textures
  are generated in-code, so the game runs offline / from `file://`.

---

## 7. Files Changed

**Phase 0 (this phase):**

- `package.json` — `phaser` dep, `vite` devDep, `"type":"module"`, scripts dev/build/preview/verify.
- `vite.config.js` — `base: './'`.
- `index.html` — full-screen canvas mount + reset CSS.
- `README.md` — overview, run instructions, controls placeholder, 8-phase roadmap.
- `CREDITS.md` — programmer-art only, no external assets (CC0 note).
- `.gitignore` — `node_modules`, `dist`, `.DS_Store`.
- `scripts/verify-gen.mjs` — determinism check over `util/rng.js` (placeholder; grown in Phase 2).
- `src/main.js` — Phaser.Game config (FIT scale, no global gravity) + scene registration.
- `src/config/constants.js` — `DESIGN_WIDTH/HEIGHT` + `GRAVITY` (single source; Decisions 8/9).
- `src/scenes/BootScene.js` — boot → Title.
- `src/scenes/TitleScene.js` — title + Start → Game.
- `src/scenes/HubScene.js` — stub (Phase 7).
- `src/scenes/GameScene.js` — Arcade world: static platform + falling player; launches HUD.
- `src/scenes/HUDScene.js` — parallel overlay stub.
- `src/scenes/GameOverScene.js` — stub → Title.
- `src/scenes/VictoryScene.js` — stub → Title.
- `src/util/rng.js` — `mulberry32` + `range` (verbatim).
- `src/util/save.js` — defensive localStorage helpers + meta wrapper.

**Phase 1 (this phase):**

- `src/core/Input.js` — NEW. PURE-of-gameplay input layer: arrows/WASD + Space/J + Shift/K →
  `sample()` snapshot `{ moveX, jumpPressed, jumpHeld, dodgePressed }` (edge-detected presses via
  `JustDown`). One owner of key bindings (Decision 11/13/14 consumers read it).
- `src/entities/Player.js` — NEW. The platformer controller: a plain class (Decision 10) holding
  the player Rectangle + Arcade body, ALL feel constants (run/jump/dodge/squash), the `RUN|DODGE`
  state machine, and `update(dt, input)`. Exposes `isInvulnerable()` for Phase 3.
- `src/scenes/GameScene.js` — REWRITE. Builds the hand-made test room (floor, walls, raised
  ledges, a one-way platform via processCallback, a gap), spawns the Player, wires colliders
  (against `player.collider`) + camera-follow (deadzone + lerp, following `player.collider`).
  **Owns the dt boundary (review BLOCKER):** `update(time, delta)` converts `dt = delta / 1000`,
  clamps to `MAX_DT (~1/30)`, samples Input EXACTLY ONCE, and calls `player.update(dt, snapshot)`.
  HUD launch/teardown + ESC→Title (`.once` event, not JustDown) retained from Phase 0; dev label
  updated with the control scheme.
- `src/config/constants.js` — unchanged in value (still owns `GRAVITY`/`DESIGN_*`); per-entity
  feel constants are co-located in `Player.js` (owned by one consumer → DRY, not a config leak).

**Phase 3 — Combat (this phase; §6.3 — built before §6.2 per the phase-order note):**

- `src/combat/hitbox.js` — NEW. **100% PURE** swing geometry (`SWINGS` table +
  `swingRect(attacker, swing)`); no Phaser import → node-importable by `verify-gen.mjs` (Decision 28).
- `src/combat/HitboxPool.js` — NEW. Phaser-COUPLED pool of reusable invisible rectangle+Arcade bodies
  in an overlap `group` (acquire/release, per-swing `hitSet` dedup, `releaseTimer` decayed on the
  GAMEPLAY dt per Decision 26). Split OUT of `hitbox.js` so the pure file stays headless (Decision 28).
  Zero per-hit allocation after warm-up (Decisions 16/20).
- `src/combat/damage.js` — NEW. PURE (no Phaser) `resolveHit(attacker, victim, swing, opts)` →
  `{damage, knockbackX, knockbackY, isBackstab}`; owns the backstab predicate + crit multiplier +
  knockback direction (Decisions 17/19). Reused both attack directions; unit-reasonable.
- `src/effects/ParticlePool.js` — NEW. Fixed pool of spark rectangles + floating damage-number
  Texts; `spawnSparks`/`spawnNumber`/`tick(dt)`; eases off `dt`, auto-returns to pool (Decision 23).
- `src/effects/Effects.js` — NEW. Juice façade: `hit(x,y,opts)` → sparks + number + `camera.shake` +
  hit-stop request; `tick(dt)` advances pools. One instance owned by GameScene (Decision 23).
- `src/entities/Enemy.js` — NEW. Base enemy: collider+visual+frontMarker, hp/maxHp, string-enum FSM
  `idle/patrol/chase/attack/hurt/dead` (Decision 22) with telegraphed melee + contact damage,
  `onHit(result)` (shared `damage.js` reaction), `die()` + `dropCells()` HOOK (Phase 4). Built from a
  spec; ships ONE concrete config (Brute). Ticked by the scene with `{player, effects}` + `dt`.
- `src/entities/Player.js` — EXTEND. Add `ATTACK` state, `comboIndex/comboWindowTimer/attackTimer`,
  `attack()` (pooled swing hitbox), `hp/maxHp/hurtIframeTimer`, `isHittable()`, `onHit(result)`
  (flash + damage-iframe + knockback + death edge), HUD HP emit. Movement reduced (not frozen) in
  ATTACK. Dodge-iframes (Phase 1) unchanged; death fires a scene callback once.
- `src/core/Input.js` — EXTEND. Add `attackPressed` (edge: J + left-click); move JUMP to Space-only
  to free J for attack; dodge stays Shift/K. JustDown/pointer read once, still SOLE-owned (issue #5).
- `src/scenes/GameScene.js` — EXTEND. Build combat groups + overlaps (player-hitbox vs enemy-hurtbox
  with per-swing dedup filter; enemy-attack/contact vs player with `isHittable` filter), spawn ≥1
  Enemy, construct `Effects`, apply the **hit-stop dt scale** in `update()` (gameplay `dt`→0 while
  frozen, real `dt` for FX), route overlaps → `resolveHit` → `onHit` + `effects.hit`, wire
  player-death → placeholder Title transition (guarded once). Room geometry unchanged.
- `src/scenes/HUDScene.js` — EXTEND. Draw a player HP bar (+ combo/cells placeholder) from the
  registry/event; stays decoupled from gameplay (Decision 2).
- `src/config/constants.js` — POSSIBLY extend with a shared knockback feel scalar only; per-entity
  combat tuning stays co-located in its owner (Player swing table / Enemy spec) — DRY.

**Phase 2 — Procedural levels (this phase; §6.2 — built after Combat per the phase-order note):**

- `src/world/LevelGenerator.js` — NEW. **100% PURE** (no Phaser import; Decision 33). Exports
  `TILE` (the cell enum), `generateLevel(seed, biomeConfig)` (the reach-bounded staircase walk →
  a level description, Decisions 34/35/38), and `canReachStep(dx, dy)` (the shared pure jump-reach
  predicate, Decisions 35/36). Reach budgets (`TILE`, `MAX_GAP`, `MAX_STEP_UP/DOWN`) are named
  constants DERIVED from `Player.js` physics with a comment citing the derivation. Node-importable
  by `verify-gen.mjs`.
- `src/config/biomes.js` — NEW. **PURE** biome config (Decision 39): `PRISON` + a `BIOMES` map +
  the size/difficulty BOUNDS (`COLS_MIN/MAX`, `ROWS_MIN/MAX`) for AC28. Pure data so the verifier
  sweeps the real config the game uses.
- `src/world/TileMap.js` — NEW. Phaser-COUPLED (Decision 37). `new TileMap(scene, description)`:
  sets world/camera bounds, builds the merged-span `solids` static group + the `oneWay` static
  group + the non-colliding `hazards` primitives, renders the grid as colored rectangles, and
  `destroy()`s cleanly for level→level rebuilds (Decision 40). Exposes `solids/oneWay/hazards`.
- `src/entities/Door.js` — NEW. The level EXIT (Decision 40): a drawn slab + an Arcade sensor body
  at `exit`; GameScene overlaps the player against it → `onExit()` (the next-level edge). `destroy()`
  for rebuilds; a cosmetic entrance marker too.
- `src/scenes/GameScene.js` — EXTEND/REPLACE. The hand-built §6.1/§6.3 room geometry is REMOVED;
  `create()` now `_buildLevel(seed)`: `generateLevel` → `TileMap` → spawn Player at the entrance,
  Enemies at the generated points (patrol bounds = their platform span, keeping Decision-29 pit
  safety), placeholder pickups, the exit `Door`; re-wire colliders against `tileMap.solids/oneWay`
  (the one-way processCallback collider unchanged, just re-pointed). `_nextLevel()` (Door `onExit`):
  advance the seed, `tileMap.destroy()` + destroy per-level entities, rebuild, reposition the Player.
  `update()` shape unchanged (dt boundary / hit-stop / FX / HUD intact).
- `src/util/rng.js` — UNCHANGED (the generator consumes the existing `mulberry32`/`range`).
- `scripts/verify-gen.mjs` — GROW. Adds the level sweep (Decisions 36/38): imports `generateLevel`/
  `TILE`/`canReachStep` + `PRISON`, sweeps N=200 seeds asserting determinism (+ a pinned signature),
  size/difficulty bounds, non-zero/reachable exit, no spawn inside a wall, and entrance→exit
  traversability via the BFS over the reachability graph. Keeps the existing rng + combat-purity
  pins. Does NOT import the Phaser-coupled `TileMap`/`Door` (importing them would throw under node —
  the convention's whole point).

**Phase 4 — Run structure (this phase; §6.4):**

- `src/config/difficulty.js` — NEW. **100% PURE** (no Phaser; Decision 42). The depth→hardness CURVE
  mirroring crowd-runner: `scaleAtDepth(depth)` (monotone scalar set), `scaleSpec(baseSpec, scale)`
  (a NEW scaled enemy spec — no mutation, Decision 45), `effectiveDifficulty(depth, biome)` (the
  stacked tier+curve scalar the verifier proves monotone). Named ramp constants; clamped; node-importable.
- `src/config/biomes.js` — EXTEND. Add the ORDERED `BIOME_ORDER = [PRISON, SEWERS, RAMPARTS]` (≥3 PURE
  biomes; each `name`/`difficultyTier`(monotone)/`endsInBoss:false`/`levels:3`(BLOCKER 1, Decision
  50)/distinct colors+length, reusing PRISON's field shape — Decision 43). Keep `PRISON`, `BIOMES`, the
  size bounds. `generateLevel` contract UNCHANGED (the new fields are ignored by the generator).
- `src/world/LevelGenerator.js` — EXTEND (tiny, PURE). Emit `desc.spawnCandidates[]` — the SURPLUS
  standable-enemy cells not used by `desc.enemies` (Decision 51 — the implementable `enemyCountBonus`
  source). Derived as a pure set-difference (no extra RNG draws), via a shared `enemySpawnFromCell`.
  `enemies`/`pickups` output + the regression pin UNCHANGED.
- `src/core/RunState.js` — NEW. **PURE** (no Phaser; Decision 44/50). `createRunState(startSeed,
  startedAt)` → the active run `{ seed, biomeIndex, levelInBiome, depth, hp, maxHp, cells, gold,
  inventory, kills, startedAt }` + `advance()` (depth always rises, biome rolls only when `levels`
  exhausted — BLOCKER 1)/`isLastBiome()`/`isRunComplete()`/`biome()`/`summary(now, completed)`. Owns the
  deterministic seed chain (moved out of GameScene). Node-importable by the verifier.
- `src/config/constants.js` — EXTEND (tiny). Hoist `PLAYER_MAX_HP` here (the cross-site constant owner)
  so `Player.js` AND `RunState.js` share ONE source (DRY — avoids the magic-100 drift, §6.4 note).
- `src/entities/Player.js` — EXTEND (tiny). Import `PLAYER_MAX_HP` from constants instead of a local
  `MAX_HP = 100`. No other change.
- `src/entities/Enemy.js` — EXTEND (tiny). Add an optional `onDeath` callback fired ONCE inside `_die()`
  next to `dropCells()` (the scene bumps `runState.kills`). FIX the shared-pool interrupt bug (Decision
  52, review MAJOR): store the rect `acquire()` returns and `_releaseStrike()` only OUR live strike
  (guarded by `hb.ownerId === id`), never `releaseAll()` the shared enemy pool. No FSM change.
- `src/scenes/GameScene.js` — EXTEND. Construct ONE `RunState` (fixed start seed for now); seed the HUD
  registry defaults + sync `player.hp ← runState.hp` ONCE in `create()` (Decision 53); `_buildLevel`
  reads the CURRENT biome from RunState + scales each enemy spawn via `scaleSpec(BRUTE_SPEC,
  scaleAtDepth(depth))` (Decision 45) + adds the depth-scaled `enemyCountBonus` from
  `desc.spawnCandidates` (Decision 51), touching NEITHER hp field; `_nextLevel` checks
  `isRunComplete()` first (BLOCKER 1), else writes `runState.hp = player.hp` then `runState.advance()`
  (HP carried, not refilled — Decision 46); `_completeRun()` routes the run's end to GameOver
  (Decision 48); player death → `scene.start('GameOver', summary)` (Decision 47); emit depth/biome to
  the HUD registry. The scene-local `START_SEED`/`nextSeed` move into RunState.
- `src/scenes/GameOverScene.js` — REWRITE the stub. Read the run-summary from `scene.settings.data`
  and render it (depth, biome, time, kills); a `completed` flag flips the header ("GAME OVER" ↔ "RUN
  COMPLETE"). → Title on key/click. Stays DECOUPLED (Decision 47/48).
- `src/scenes/HUDScene.js` — EXTEND (small). Read `depth`/`biomeName` from the registry and draw a
  `DEPTH n · <BIOME>` readout next to the HP bar. Registry-only (Decision 2 — still decoupled).
- `scripts/verify-gen.mjs` — GROW. Add section 4 (Decision 49 / AC42): import `scaleAtDepth`/
  `scaleSpec`/`effectiveDifficulty` + `BIOME_ORDER` + `createRunState`; assert curve-scalar +
  biome-tier + whole-run `effectiveDifficulty` monotonicity, the scaled-stat ramp, and seed-chain
  determinism; extend the existing 200-seed level sweep to EVERY biome in `BIOME_ORDER`. Keeps all
  prior pins. Does NOT import Phaser-coupled modules.

**Phases 5–7:** files listed in each phase's `Design` section when it is implemented.

---

## 8. Verification

**Phase 0:**

1. [AC1] `npm install` runs clean; `package.json` has only `phaser`/`vite`, `"type":"module"`,
   and the four scripts.
2. [AC2] `npm run build` exits 0 and produces `dist/`.
3. [AC3,4,5] `npm run dev`: Boot flashes then Title shows with a Start control; pressing Start /
   clicking launches GameScene.
4. [AC6] In GameScene the player rectangle falls under gravity and lands on the static platform;
   the HUD overlay label is visible on top (parallel scene proven).
5. [AC7] `npm run verify` (runs `scripts/verify-gen.mjs`) exits 0 and asserts `mulberry32`
   determinism.
6. [AC8] In devtools, disabling localStorage (or calling `save.set` in private mode) does not
   throw; `save.get(missing, d)` returns `d`.
7. [AC9] This doc exists with all 8 phases skeletoned and Phase 0 detailed.
8. [AC10] `.gitignore`, `README.md`, `CREDITS.md` present and correct.

**Phase 1 (this phase):** `npm run dev`, Start → GameScene, then by observation:

1. [AC11] Hold Left/A then Right/D: the player ramps up to speed and coasts to a stop on release
   (accel + friction, not instant); it faces the move direction; speed caps at `RUN_SPEED`. Resize
   the window (or throttle FPS in devtools) — feel is unchanged (frame-rate independent).
2. [AC12] The player falls under gravity, terminal velocity is capped, and it cannot pass through
   the floor, side walls, or raised ledges; it cannot leave the room.
3. [AC13] Tap Space/J → a short hop; hold Space/J → a full-height jump (release-cut verified).
4. [AC14] Walk off a ledge and press jump a few frames late → it still jumps (coyote). Press jump
   just before landing → it jumps on touchdown (buffer).
5. [AC15] Press Shift/K → a horizontal dash; the player flashes/tints (i-frames) for the window;
   the dodge can't be re-triggered until the cooldown elapses.
6. [AC16] Stand under the one-way platform and jump → pass up through it; land back down → rest on
   top of it.
7. [AC17] Move across the (wider-than-screen) room → the camera follows smoothly with a deadzone
   (no jitter on small moves) and never scrolls past the room bounds.
8. [AC18] On jump the rect stretches tall; on land it squashes wide then eases back; during dodge
   it flattens — direction + state read clearly. `npm run build` still exits 0; `npm run verify`
   still passes (Phase 1 adds no generator, so the determinism check is unchanged).

**Phase 3 — Combat (this phase; §6.3):** `npm run dev`, Start → GameScene, then by observation
(plus the headless determinism check still passing):

1. [AC20] Press J (or left-click): the player swings; pressing again within the window chains
   swing 1 → 2 → finisher (2–3 hits), each visibly distinct; letting the window lapse resets to
   swing 1. You cannot spam infinite hits in one frame (per-swing active+recovery lock).
2. [AC21] A swing that overlaps the enemy deals damage ONCE per swing (no multi-hit from one
   swing); the enemy is knocked back, briefly stunned (hitstun), and flashes its hit i-frame.
3. [AC22] Hit the enemy **from behind** (flank / dodge through it): the damage number + spark are
   crit-colored and the damage/knockback are clearly larger than a frontal hit (BACKSTAB).
4. [AC23] Let the enemy hit you (contact or its telegraphed strike): HP on the HUD drops, the
   player flashes + is knocked back, and is briefly invulnerable (no second hit during the window).
   **Dodge through** the enemy's strike → no damage taken (dodge i-frames negate it).
5. [AC24] The enemy patrols, **detects + chases** when you approach, **telegraphs** (a readable
   wind-up) then strikes in range, **reacts** to your hits (knockback interrupts its action), and
   **dies** at 0 HP (death pop); the `dropCells()` hook fires (logged) — Phase 4 spawns pickups.
6. [AC25] Every damaging hit shows hit **sparks**, a floating **damage number**, a short screen
   **shake**, and a brief **hit-stop** (the world freezes a few ms on impact). Throttle FPS in
   devtools — the feel/timing is unchanged (framerate-independent); sustained combat shows no GC
   stutter (pooled, no per-hit allocation).
7. [AC26] Reduce player HP to 0 (let the enemy hit you repeatedly): the death edge fires EXACTLY
   ONCE (a short freeze/flash) → returns to Title (placeholder). No double-fire, no soft-lock.
8. Regression: `npm run build` still exits 0; `npm run verify` still passes. The determinism pin is
   unchanged (Combat adds no generator), and `verify-gen.mjs` ALSO now imports `combat/hitbox.js` +
   `combat/damage.js` under plain node — which PROVES they are headlessly importable (Decision 28:
   a Phaser-coupled module would throw on import) — and pins `swingRect`'s in-front geometry + the
   backstab predicate (crit ON/OFF, away-knockback) so a regression in the pure combat math fails
   loudly in CI.

**Phase 2 — Procedural levels (this phase; §6.2):** primarily the HEADLESS sweep (the determinism +
solvability foundation), plus `npm run dev` observation:

1. [AC19] `npm run verify` exits 0. It sweeps **N=200** seeds: for each, `generateLevel(seed,
   PRISON)` called twice is deep-equal (determinism), and one fixed seed matches a pinned
   `tiles`/entrance/exit signature (regression). Two fresh runs of `npm run verify` print identical
   output. (A successful node import of `world/LevelGenerator.js` + `config/biomes.js` ALSO re-proves
   the purity convention — Decision 33 — since a Phaser-coupled module would throw under plain node.)
2. [AC27] In the same sweep, every level's platform reachability graph (built from `platforms` via
   `canReachStep`) reaches the exit platform from the entrance platform by BFS — entrance→exit is
   traversable for all 200 seeds. In `npm run dev`: the player can actually jump the gaps/steps from
   spawn to the exit Door (the budgets are conservative — reach has margin).
3. [AC28] In the sweep, every level: `cols/rows` within the biome MIN/MAX; `exit` non-zero,
   in-bounds, `!==` entrance; entrance + exit cells `EMPTY`; enemy count within
   `[minEnemies,maxEnemies]`; and EVERY enemy/pickup spawn maps to an `EMPTY` cell with a
   `SOLID`/`ONEWAY` directly below (re-derived from `tiles` — no spawn inside a wall, none floating).
4. [AC29] In `npm run dev`: the generated room renders as primitive tiles (solids, amber one-way
   ledges, distinct hazards); the player collides with the merged solid spans, jumps UP through +
   lands ON the one-way ledges (the §6.1 behavior, now on generated geometry), and cannot leave the
   room. Resize/throttle FPS — collision + feel unchanged (frame-rate independent).
5. [AC30] In `npm run dev`: enemies + pickups appear at the generated points (on the ground, never
   buried/floating); reaching the exit **Door** logs + triggers a transition to the NEXT generated
   level (a fresh layout, player at the new entrance, HUD/Effects persist). The next level is itself
   reproducible (the seed chain is deterministic).
6. Regression: `npm run build` exits 0; the existing Phase-0/1/Combat checks in `verify-gen.mjs`
   still pass (the rng pin + combat purity/geometry pins are untouched).

**Phase 4 — Run structure (this phase; §6.4):** primarily the HEADLESS monotonicity + determinism
sweep, plus `npm run dev` observation:

1. [AC42] `npm run verify` exits 0. Its NEW section asserts, over `depth 0..MAXD`, that every
   `scaleAtDepth(depth)` scalar is non-decreasing AND that the SCALED enemy stat
   (`scaleSpec(BASE_SPEC_STUB, scaleAtDepth(depth)).maxHp`) actually rises — the difficulty curve is
   monotonic — AND that `scaleSpec` does not mutate the base. (A PURE `BASE_SPEC_STUB` is used because
   `BRUTE_SPEC` lives in Phaser-coupled `Enemy.js`; scaleSpec only multiplies numeric fields, so the
   property holds for any base.) Two fresh `npm run verify` runs print identical output (deterministic).
2. [AC43] In the same sweep, `BIOME_ORDER.length ≥ 3`, `BIOME_ORDER[i].difficultyTier` is
   non-decreasing in `i`, every biome's `cols/rows` are within the size bounds, and `levels ≥ 1` (so
   AC28 holds for the WHOLE list — the 200-seed level sweep now runs for EACH biome, not just PRISON).
3. [AC44/AC47] The verifier drives a `createRunState(SEED)` through the full `advance()` chain
   (`while(!isRunComplete())` — NOT assuming `depth==biomeIndex`, BLOCKER 1): the
   `(biomeIndex, levelInBiome, depth, seed)` sequence from two fresh RunStates is identical
   (deterministic seed chain), and the run ends at `depth === Σlevels−1 (= 8)` on the LAST biome —
   proving the run is 9 levels (3 biomes × 3), NOT three rooms (the BLOCKER 1 regression guard). In
   `npm run dev`: a given start seed replays the same biome sequence.
4. [AC42/AC49] The verifier computes `effectiveDifficulty(rs.depth, rs.biome())` at every step of the
   walked run and asserts it is non-decreasing across the WHOLE run (tier + curve stacked — the
   load-bearing "visibly rising difficulty" proof).
5. [AC45] In `npm run dev`: enemies in a LATER biome / at greater depth are visibly tankier + hit
   harder (more swings to kill, bigger damage numbers against the player) than the first level's
   Brutes — enemy stats scale by depth. The HUD shows the live `DEPTH n · <BIOME>` readout rising as
   you advance through Doors.
6. [AC46] Let the enemies kill you: the screen hands off to **GameOverScene** showing a run SUMMARY
   (DEPTH REACHED, BIOME, TIME, KILLS) — not the old Title bounce — then SPACE/click → Title. Player
   HP is CARRIED between levels (clearing a Door does NOT refill HP — a damaged player stays damaged
   into the next biome).
7. [AC47] Clear Doors through every biome to the last; each biome spans 3 rooms (depth rises within a
   biome, visibly tankier enemies), and only clearing the LAST biome's LAST room ends the run with a
   "RUN COMPLETE" GameOver summary (gold header) → Title — NOT the first last-biome Door (BLOCKER 1).
   The death edge / completion edge each fire EXACTLY ONCE (the `gameOver` guard) — no double-fire.
8. Regression: `npm run build` exits 0; every prior `verify-gen.mjs` pin (rng, combat purity/geometry,
   the per-biome level sweep — determinism, bounds, no-wall-spawn, traversability) still passes.

**Phases 5–7:** verification steps appended per phase when implemented.
