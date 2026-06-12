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

**Phase 2 — Procedural levels:**

19. A pure, seeded generator produces a deterministic, solvable room/biome layout; the same seed
    yields an identical layout; `npm run verify` asserts this headlessly in node.

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

**Phase 4 — Enemies:**

- **AC-P4.** Enemies run a state-machine AI, damage the player on contact/attack, take damage and
  die, and drop **Cells**.

**Phase 5 — Run economy + biome flow:**

- **AC-P5.** Rooms/biomes chain into a run via doors; **gold/scrolls** are run-only boosts;
  **Cells** are banked toward meta; the run is traversable end-to-end.

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

### 6.2 Phase 2 — Procedural levels *(filled when Phase 2 is designed)*

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


### 6.4 Phase 4 — Enemies *(filled when Phase 4 is designed)*
### 6.5 Phase 5 — Run economy + biome flow *(filled when Phase 5 is designed)*
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

**Phases 2, 4–7:** files listed in each phase's `Design` section when it is implemented.

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

**Phases 2, 4–7:** verification steps appended per phase when implemented.
