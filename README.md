# Dead Cell

A 2D roguelite action-platformer in the spirit of **Dead Cells** — procedurally generated,
multi-biome runs; **permadeath**; fast melee + ranged combat with a dodge-roll (i-frames) and
**status effects** (bleed / poison / stun); **4 enemy archetypes** with state-machine AI plus
**elite** variants; **two final bosses** (one chosen per run); **4 weapons**; an **in-run shop**;
**optional treasure branches**; and a deep persistent meta-progression tree between runs. Reach the
boss arena at the end of the **Ramparts** and beat the boss to win the run.

Built with **Phaser 3 + Vite**, ES modules, **programmer-art primitives only** (colored
rectangles / simple shapes via Phaser `Graphics` and generated textures) — no external sprite
or audio assets.

## Core loop

> **Hub** (spend permanent **Cells**) → **Run** (procedural biomes, fight, collect) →
> **Boss arena** (beat The Warden) → **Victory / Death** → back to Hub (permanent upgrades persist) →
> repeat.

Two currencies:

- **Cells** — dropped by enemies; spent in the Hub on **PERMANENT** meta-upgrades (survive death).
- **Gold / Scrolls** — **RUN-ONLY** boosts (lost on death). Gold is spent at the **in-run shop** (a
  vendor that appears on some levels) on heals, flask refills, scrolls, or a vendor weapon.

## Run it

```bash
npm install
npm run dev      # Vite dev server (opens the game)
npm run build    # production build → dist/
npm run preview  # serve the built dist/
npm run verify   # headless determinism check (scripts/verify-gen.mjs)
```

## Controls

- **Title:** SPACE / ENTER / click → **ENTER HUB**
- **Hub (shop):** **UP / DOWN** (or W/S) move the cursor over the upgrade list; **SPACE / ENTER**
  buys the selected upgrade (if you can afford it) or, on the **START RUN** row, launches the run
- **Move:** Arrow keys or **WASD** (run with acceleration + friction)
- **Jump:** **Space** — variable height (tap = short hop, hold = full jump), with coyote time +
  jump buffer. (Jump is on `Space` so `J` is the attack key.)
- **Attack:** **J** or **left-click** — dispatches off the **equipped weapon**: a melee combo
  (Sword / Hammer / Spear) or a fired projectile (Bow); chain the input within the combo window to
  advance swings; hit an enemy from behind for a **BACKSTAB** crit
- **Dodge-roll:** **Shift** or **K** — horizontal dash with i-frames (flashes yellow) and a
  brief cooldown; dodge-through an enemy's (or the boss's) **telegraphed** strike to take no damage
- **Swap weapon:** **R** — toggle between your two equipped weapons (only when the **Second Weapon
  Slot** meta upgrade is unlocked and you carry a second weapon; a no-op otherwise)
- **Drink flask:** **Q** — heal a chunk of max HP from a limited-charge flask; charges **refill on
  every biome transition** (a fountain at each new area). Don't waste a drink at full HP.
- **Shop / interact:** **E** — when standing on a vendor (a `[E] SHOP` prompt appears) opens the
  paused buy menu; **UP / DOWN** select, **E / SPACE / ENTER** buy or LEAVE
- **Pickups:** walk over them — **Cells** (cyan, banked to permanent meta), **gold** (run-only),
  **scrolls** (magenta, run-only stat boosts), **weapons** (white — swap the active weapon, or, with the
  Second Weapon Slot unlocked, fill the empty slot so you carry both), **heals** (green fountains)
- **ESC** → Title

## How to play

The loop is **Title → Hub (spend Cells) → procedural run → boss arena → Victory / GameOver → bank
Cells → Hub**. A run descends through **3 biomes** of rising difficulty:

- **Prison** (tier 0) — melee **Grunts**. The fair opener.
- **Sewers** (tier 1) — adds ranged **Shooters** that kite you and fire bolts.
- **Ramparts** (tier 2) — adds **Chargers** (telegraphed dashes) and **Flyers** (hovering swoops),
  and **ends in a boss arena**: a flat, walled, spike-rimmed room where the run's boss spawns.

Along the way, watch for **elites** — gold-tinted, beefed-up enemies with tighter telegraphs that
burst into a ring of projectiles when they die (don't melee one carelessly), and **treasure branches**
— optional upward side detours that pay out a guaranteed reward (gold / scroll / weapon / heal). Your
weapon now carries **status effects**: the **Spear bleeds**, the **Hammer stuns**, the **Bow poisons**.

**The boss** is chosen per run from two: **The Warden** (a slow melee bruiser — slam / dash) or **The
Hollow Sentinel** (a faster ranged-pressure boss — denser volleys). Each is two-phase: every attack
**telegraphs** (an amber wind-up) before it strikes, so every hit is dodgeable, and at **≤50% HP** it
enters **phase 2** (tighter telegraphs, faster, a denser rotation). Beat it to win the run. Watch the
**arena spikes** — standing on them chips your HP.

**Balance:** a skilled clean run — dodging telegraphs, backstabbing, managing HP, spending gold at the
shop and Cells on upgrades — can reach and beat the boss; a careless run that face-tanks and ignores
telegraphs dies. Difficulty scales with **depth** (deeper enemies are tankier and hit harder) and is
the deepest at the boss. All of it is pure-config data, re-proven monotone by `npm run verify`.

**Permadeath + meta:** on **death OR victory** the run's **Cells** are banked to permanent meta
(gold/scrolls are lost), and you return to the **Hub** to spend them on a **10-row upgrade tree**:
**+Max HP**, **+Melee Damage**, **+Ranged Damage**, **−Dodge Cooldown**, **+Dodge I-Frames**, a
**Starting Weapon** unlock, a **Gold Head-Start**, **Starting Scrolls**, a **Bigger Flask** (more
charges + bigger heals), and a **Second Weapon Slot** (carry two weapons and **swap with R** mid-run —
turning loot into a build decision). Progress persists to `localStorage` and survives a relaunch.

The HUD shows the **HP bar**, live **Cells / gold** counters, the **equipped weapon**, the **flask
charges**, the **depth · biome** readout, and — in the boss room — the **boss's HP bar** across the top.

## Architecture

The game state machine is expressed as Phaser **Scenes**: `Boot → Title → Game (+ parallel
HUD) → GameOver / Victory`, with a `Hub` for meta-progression. On the **final boss kill** GameScene
hands off to **VictoryScene** (the gold twin of GameOver); player death in the arena still routes to
GameOver. The world renders at a **fixed 1280×720** design resolution and is letterboxed to the
viewport (`Scale.FIT`), giving a stable coordinate system for tilemaps and camera bounds.

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
5. **Roguelite meta-loop** — pooled pickups (Cells / gold / scrolls / weapons); two currencies;
   the **Hub** shop spending banked Cells on permanent upgrades; distinct weapons (Sword / Hammer /
   ranged Bow on a pooled projectile); run-only scrolls; localStorage meta-persistence; the full
   **Title → Hub → Run → GameOver → Hub** loop.
6. **Bosses + richness** — a multi-phase **boss** (The Warden) with telegraphed attacks in a dedicated
   **arena** ending the Ramparts; **VictoryScene** on the boss kill; **4 enemy archetypes** (Grunt /
   Shooter / Charger / Flyer) wired into per-biome pools; a **4th weapon** (Spear); a data-only
   **balance pass** (winnable-but-punishing). *(this phase)*.
7. *(subsumed into Phase 5 — the Hub + localStorage meta shipped there.)*

**Enrichment round 2** — closing the genre-loop gaps: an **in-run shop** (the gold sink), a **deeper
9-row meta tree**, **elite** enemy affixes + a **second boss** chosen per run, **status effects**
(bleed / poison / stun), and **optional treasure branches**. Plus round 1's entropy-minted run seeds
(a shareable run id), the **healing flask** (Q) refilled per biome, and a found-heal pickup.

See `docs/designs/2026-06-12-dead-cells-roguelite.md` for the full design (§6.9–§6.14, Decision 71–80).

## Deploy / CI

This repo ships to **GitHub Pages** via GitHub Actions (`.github/workflows/deploy.yml`). On every
**push to `master`** (and via the manual **Run workflow** button), CI runs:

```
npm ci  →  npm run verify  →  npm run build  →  upload dist/  →  deploy to Pages
```

`npm run verify` is a **quality gate** (design Decision 81a): the headless determinism / bounds /
traversability + pure-config sweep (`scripts/verify-gen.mjs`) must pass before the bundle is built and
published, so a broken procedural generator fails CI instead of shipping.

The build uses **`base: './'`** in `vite.config.js` (design Decision 7) so the hashed bundle resolves
from a Pages **project sub-path** (`https://<user>.github.io/dead-cell/`) — the same `dist/` also works
from a `file://` preview or a custom domain, with no environment-specific build.

`npm` is the single package manager of record: `package-lock.json` is committed (so `npm ci` is
reproducible) and `bun.lock` is `.gitignore`d (Decision 81b). CI pins **Node 20**; local dev may run a
newer Node (e.g. v24) — the pure-ESM build/verify run identically on both (Decision 81c).

**Live URL:** _TODO — fill in after Pages is enabled (e.g. `https://sorrycc.github.io/dead-cell/`)._

### One-time setup (manual — done by the repository owner)

The workflow file alone cannot publish until the repo exists and Pages is enabled. These are
**manual, one-time** steps performed by the owner (not by the build):

1. **Create the GitHub repo and push** — either:

   ```bash
   gh repo create sorrycc/dead-cell --public --source . --push
   ```

   or create it on the website, then:

   ```bash
   git remote add origin git@github.com:sorrycc/dead-cell.git
   git push -u origin master
   ```

2. **Enable Pages** — in the repo, go to **Settings → Pages → Build and deployment → Source =
   "GitHub Actions"**.

> Until step 2 is done, the `deploy` job (`actions/deploy-pages@v4`) **fails** — that is an expected
> precondition, **not** a workflow bug. Once Pages "Source" is set to "GitHub Actions", every push to
> `master` auto-deploys, and the live URL appears in the workflow run's `deploy` job summary (paste it
> into the **Live URL** placeholder above).
