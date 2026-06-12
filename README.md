# Dead Cell

A 2D roguelite action-platformer in the spirit of **Dead Cells** — procedurally generated,
multi-biome runs; **permadeath**; fast melee + ranged combat with a dodge-roll (i-frames);
enemy state-machine AI; multi-phase bosses; and persistent meta-progression between runs.

Built with **Phaser 3 + Vite**, ES modules, **programmer-art primitives only** (colored
rectangles / simple shapes via Phaser `Graphics` and generated textures) — no external sprite
or audio assets.

## Core loop

> **Hub** (spend permanent **Cells**) → **Run** (procedural biomes, fight, collect) →
> **Death / Victory** → back to Hub (permanent upgrades persist) → repeat.

Two currencies:

- **Cells** — dropped by enemies; spent in the Hub on **PERMANENT** meta-upgrades (survive death).
- **Gold / Scrolls** — **RUN-ONLY** boosts (lost on death).

## Run it

```bash
npm install
npm run dev      # Vite dev server (opens the game)
npm run build    # production build → dist/
npm run preview  # serve the built dist/
npm run verify   # headless determinism check (scripts/verify-gen.mjs)
```

## Controls (through the Combat phase)

- **Title:** SPACE / ENTER / click → Start
- **Move:** Arrow keys or **WASD** (run with acceleration + friction)
- **Jump:** **Space** — variable height (tap = short hop, hold = full jump), with coyote time +
  jump buffer. (Jump moved off `J` in the Combat phase so `J` can be the attack key.)
- **Attack:** **J** or **left-click** — a 2–3 hit light melee combo; chain the input within the
  combo window to advance swing 1 → 2 → finisher; hit an enemy from behind for a **BACKSTAB** crit
- **Dodge-roll:** **Shift** or **K** — horizontal dash with i-frames (flashes yellow) and a
  brief cooldown; dodge-through an enemy's strike to take no damage
- **ESC** → Title

The HUD shows the player **HP bar**. Reduce HP to 0 and a placeholder death handoff returns you to
Title (real GameOver / permadeath is a later phase).

## Architecture

The game state machine is expressed as Phaser **Scenes**: `Boot → Title → Game (+ parallel
HUD) → GameOver / Victory`, with a `Hub` for meta-progression. The world renders at a **fixed
1280×720** design resolution and is letterboxed to the viewport (`Scale.FIT`), giving a stable
coordinate system for tilemaps and camera bounds.

Layered modules (added as each phase needs them): `scenes/ config/ core/ world/ entities/
combat/ effects/ util/`. Procedural generation is **seeded + pure** (`util/rng.js`
`mulberry32`) so it is reproducible and testable headlessly. Meta-progression persists to
`localStorage` via defensive helpers in `util/save.js`.

## Build roadmap (8 phases)

0. **Scaffold** — project, scene stubs, seeded RNG, save helpers, design doc.
1. **Platformer core** — run / jump / gravity / dodge-roll / one-way platform / camera follow
   on Arcade Physics *(this phase)*.
2. **Procedural levels** — pure, seeded biome/room generators, verified headlessly.
3. **Combat** — melee + pooled ranged, knockback, dodge-roll i-frames, hitstop/shake.
4. **Enemies** — state-machine AI, contact/attack damage, Cells drops.
5. **Run economy + biome flow** — chained rooms/biomes; gold/scrolls; banked Cells.
6. **Bosses** — multi-phase boss with telegraphs and an arena; victory ends the run.
7. **Meta-progression + Hub** — spend Cells on permanent upgrades; localStorage persistence;
   permadeath wiring — the full roguelite loop.

See `docs/designs/2026-06-12-dead-cells-roguelite.md` for the full design.
