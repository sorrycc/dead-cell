import Phaser from 'phaser'
import { TILE, TILE_SIZE } from './LevelGenerator.js'

// ── TileMap — render a level description as Arcade bodies + primitive tiles (design §6.2, Decisions
// 29/37, AC29) ──
// Phaser-COUPLED (imports Phaser, owns GameObjects + Arcade bodies). It is NEVER imported by the
// headless verifier — that would throw under node, which is the whole point of keeping the generator
// pure (Decision 33). Given a PURE level description (from LevelGenerator.generateLevel) it builds:
//   • a `solids` STATIC group — one drawn rectangle + static body per MERGED horizontal run
//     (Decision 37: merged spans, NOT one body per tile — fewer bodies, identical collision; the
//     description already carries the merged `platforms`, so we reuse them, never re-scan — DRY).
//   • a `oneWay` STATIC group — the ONEWAY runs (rendered amber; GameScene keeps the §6.1
//     processCallback one-way collider pointed at THIS group).
//   • HAZARD tiles — a distinct red primitive per tile. RENDER-ONLY by default (a plain `add.group()`
//     with NO Arcade bodies — Decision 29). In the BOSS ROOM ONLY, GameScene calls
//     enableHazardBodies() to promote each hazard rect to a STATIC Arcade body so the player×hazards
//     overlap can actually fire (the §6.6.2 arena hazard — review BLOCKER #1; a plain render-only group
//     has no bodies, so an overlap against it would NEVER fire). Outside the boss room they stay
//     render-only so normal levels don't become lethal (preserving the §6.4 balance).
// It also sets the world + camera bounds from the description's world size, and exposes destroy() so
// the in-place level→level rebuild (Decision 40) leaks nothing.
//
// INVARIANT (review MINOR — doc/code drift): GameScene's one-way processCallback reads the PLAYER's
// COLLIDER body (player.body.bottom), never the squash-scaled visual — same rule as Phase 1. THIS
// file only produces the one-way bodies; it does not change that predicate.

export class TileMap {
  // scene: GameScene. desc: a level description from generateLevel (pure data; never mutated here).
  constructor(scene, desc) {
    this.scene = scene
    this.desc = desc
    const colors = scene.biome?.colors ?? desc.colors ?? FALLBACK_COLORS

    // ── World + camera bounds from the description (Decision 8 / AC29) ── so camera-follow + body
    // clamping use the generated room size, not the Phase-1 hand-built room width.
    scene.physics.world.setBounds(0, 0, desc.worldWidth, desc.worldHeight)
    scene.cameras.main.setBounds(0, 0, desc.worldWidth, desc.worldHeight)

    // A subtle backdrop band behind the room (cosmetic; scrolls with the world so the room reads
    // against the page letterbox). Drawn first so tiles sit on top.
    this._bg = scene.add
      .rectangle(0, 0, desc.worldWidth, desc.worldHeight, colors.bg)
      .setOrigin(0, 0)
      .setDepth(-10)

    // ── solids static group: one merged-run rectangle+body each (Decision 37). ──
    this.solids = scene.physics.add.staticGroup()
    this.oneWay = scene.physics.add.staticGroup()
    // Hazards default to a RENDER-ONLY plain group (no bodies — Decision 29). The boss room promotes
    // them to a STATIC body group via enableHazardBodies() (review BLOCKER #1). We keep BOTH a plain
    // group of the rects (for uniform render + teardown) AND a separate STATIC group that is left
    // EMPTY until enableHazardBodies() runs — GameScene's player×hazards overlap targets the static
    // group, which only HAS bodies in the boss room (so the overlap can fire there + nowhere else).
    this.hazards = scene.add.group()
    this.hazardBodies = scene.physics.add.staticGroup() // empty unless enableHazardBodies() is called.
    this._hazardBodiesEnabled = false

    // Track EVERY created GameObject so destroy() removes them all (no leak across rebuilds).
    this._objects = [this._bg]

    for (const run of desc.platforms) {
      if (run.type === TILE.SOLID) this._addRun(this.solids, run, colors.solid)
      else if (run.type === TILE.ONEWAY) this._addRun(this.oneWay, run, colors.oneWay)
    }

    // HAZARD tiles: scan the grid for HAZARD cells (they aren't merged into `platforms`) and draw a
    // distinct red spike-ish primitive per tile. Non-colliding (no body) — Phase 5 owns the damage.
    for (let row = 0; row < desc.rows; row++) {
      for (let col = 0; col < desc.cols; col++) {
        if (desc.tiles[row][col] !== TILE.HAZARD) continue
        const rect = scene.add.rectangle(
          (col + 0.5) * TILE_SIZE,
          (row + 0.5) * TILE_SIZE,
          TILE_SIZE * 0.7,
          TILE_SIZE * 0.5,
          colors.hazard,
        )
        rect.tileCol = col // back-refs for Phase 5's damage wiring.
        rect.tileRow = row
        this.hazards.add(rect)
        this._objects.push(rect)
      }
    }
  }

  // Add ONE merged run to a static group: a drawn rectangle covering [col, col+len-1] at `row`,
  // promoted to a static body. x/y are the run's CENTER (Phaser rect origin). The body covers the
  // full run width — identical collision to per-tile bodies, far fewer of them (Decision 37).
  _addRun(group, run, color) {
    const w = run.len * TILE_SIZE
    const h = TILE_SIZE
    const x = run.col * TILE_SIZE + w / 2
    const y = run.row * TILE_SIZE + h / 2
    const rect = this.scene.add.rectangle(x, y, w, h, color)
    group.add(rect) // staticGroup.add promotes it to a static Arcade body automatically.
    this._objects.push(rect)
    return rect
  }

  // ── enableHazardBodies() (design §6.6.2, Decision 66, AC57 — review BLOCKER #1) ── promote each
  // render-only HAZARD rect to a STATIC Arcade body so an overlap(player.collider, hazardBodies) can
  // actually fire (a body-less group never overlaps). Called ONLY in the boss room (GameScene), so
  // normal levels' hazards stay render-only. The body is a SHRUNK static body centered on the rect so
  // the contact reads as "stepping on the spikes" (not the full tile). Idempotent (guard) so a
  // re-call is a no-op. The bodies are owned by `hazardBodies` (a staticGroup), torn down in destroy().
  enableHazardBodies() {
    if (this._hazardBodiesEnabled) return
    this._hazardBodiesEnabled = true
    // Each hazard rect is already drawn (a 0.7×0.5 tile primitive). Add it to the static group, which
    // promotes it to a static Arcade body sized to the rect. The rect stays in `this.hazards` too (for
    // uniform render/teardown); adding to a second group only attaches a body — the rect isn't moved.
    for (const rect of this.hazards.getChildren()) {
      this.hazardBodies.add(rect) // staticGroup.add promotes the rect to a static body automatically.
    }
    this.hazardBodies.refresh() // recompute the static bodies from the rects' transforms.
  }

  // Tear down EVERY GameObject + body this TileMap created (Decision 40 — the in-place rebuild
  // depends on leaking nothing). staticGroup.clear(true, true) destroys members + their bodies; we
  // also destroy the tracked loose objects (bg, hazards) and the groups themselves.
  destroy() {
    this.solids.clear(true, true)
    this.oneWay.clear(true, true)
    this.solids.destroy(true)
    this.oneWay.destroy(true)
    // hazardBodies shares its rects with `this.hazards` (the same GameObjects). Clear it WITHOUT
    // destroying the children (false) — `this.hazards.clear(true)` below destroys them once. Destroying
    // here too would double-free. clear(false,false) just drops membership + the attached static body.
    this.hazardBodies.clear(false, false)
    this.hazardBodies.destroy(true)
    this.hazards.clear(true)
    this.hazards.destroy(true)
    for (const o of this._objects) if (o && o.active) o.destroy()
    this._objects = []
  }
}

// Fallback colors if a biome/desc doesn't carry them (keeps TileMap standalone-usable; the real
// game always passes biome colors). KISS — never hit in normal play.
const FALLBACK_COLORS = {
  solid: 0x3a4658,
  oneWay: 0xb9770e,
  hazard: 0xc0392b,
  bg: 0x10141c,
}
