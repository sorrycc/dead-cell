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

**Phase 1 — Platformer core (high-level, refined later):**

11. Player moves left/right, jumps, is affected by gravity, and collides with ground/walls/
    one-way platforms on Arcade Physics; frame-rate independent.

**Phase 2 — Procedural levels:**

12. A pure, seeded generator produces a deterministic, solvable room/biome layout; the same seed
    yields an identical layout; `npm run verify` asserts this headlessly in node.

**Phase 3 — Combat:**

13. Melee + pooled ranged attacks deal damage with knockback; dodge-roll grants i-frames; hits
    produce hitstop/shake juice.

**Phase 4 — Enemies:**

14. Enemies run a state-machine AI, damage the player on contact/attack, take damage and die,
    and drop **Cells**.

**Phase 5 — Run economy + biome flow:**

15. Rooms/biomes chain into a run via doors; **gold/scrolls** are run-only boosts; **Cells** are
    banked toward meta; the run is traversable end-to-end.

**Phase 6 — Bosses:**

16. A multi-phase boss telegraphs attacks, transitions phases at an HP threshold, and on defeat
    triggers Victory.

**Phase 7 — Meta-progression + Hub:**

17. The Hub spends banked **Cells** on **permanent** upgrades persisted to localStorage; death
    loses run-only loot but keeps meta; relaunching the game restores meta state — the full
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

### 6.1 Phase 1 — Platformer core *(filled when Phase 1 is designed)*
### 6.2 Phase 2 — Procedural levels *(filled when Phase 2 is designed)*
### 6.3 Phase 3 — Combat *(filled when Phase 3 is designed)*
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

**Phases 1–7:** files listed in each phase's `Design` section when it is implemented.

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

**Phases 1–7:** verification steps appended per phase when implemented.
