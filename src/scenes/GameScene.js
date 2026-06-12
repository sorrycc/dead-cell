import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, GRAVITY } from '../config/constants.js'
import { Input } from '../core/Input.js'
import { Player } from '../entities/Player.js'

// ── GameScene (design §6.1, AC11–AC18) ──
// The only scene with an Arcade physics world. Phase 1 builds a hand-made TEST ROOM (floor,
// walls, raised ledges, a ONE-WAY platform, a gap) and exercises the full platformer feel:
// the Player runs (accel/friction), jumps (variable height + coyote + buffer), and dodges
// (dash + i-frames + cooldown). A camera with a deadzone + lerp follows smoothly within the
// room bounds. No generation yet — that's Phase 2.
//
// ROOM is wider than the 1280-wide viewport so the camera follow is observable. The world +
// camera bounds are widened from the Phase 0 design rect to this room width.

// ── Room geometry (world coords; FIXED, never window dimensions) ──
const ROOM_W = DESIGN_WIDTH * 2 // 2560 — wider than the viewport so follow is visible.
const ROOM_H = DESIGN_HEIGHT // single screen tall.
const WALL_T = 40 // wall / floor thickness (px).
const FLOOR_Y = ROOM_H - 60 // y-center of the floor band.
// A gap (pit) in the floor: the floor is built as two spans with this hole between them.
const GAP_X0 = 1180
const GAP_X1 = 1380

// ── Camera follow (design §6.1) — deadzone + lerp ──
// The deadzone is a centered box the player moves within before the camera scrolls (kills
// micro-jitter from run accel). Lerp (<1) eases the camera toward the target each frame
// (Phaser applies it framerate-aware). Clamped by the camera bounds → never shows outside.
const DEADZONE_W = 360
const DEADZONE_H = 240
const LERP_X = 0.12
const LERP_Y = 0.12

// ── dt clamp (review BLOCKER #1) ──
// Phaser hands scene.update `delta` in MILLISECONDS; the Player feel math is in SECONDS, so
// we convert at this boundary (delta/1000). We also CLAMP to MAX_DT so a tab-refocus spike
// (a multi-second delta after the page was backgrounded) can't teleport the player through
// walls or fire a spiral-of-death — crowd-runner's loop clamps for the same reason.
const MAX_DT = 1 / 30 // s — cap a single step at ~33ms (worst-case ~30fps slice).

export class GameScene extends Phaser.Scene {
  constructor() {
    super('Game')
  }

  create() {
    // ── World + camera bounds (Decision 8) ── widened to the room (still FIXED, resize-safe).
    this.physics.world.setBounds(0, 0, ROOM_W, ROOM_H)
    this.cameras.main.setBounds(0, 0, ROOM_W, ROOM_H)

    // ── Per-scene gravity (Decision 9; BLOCKER #2 model) ──
    // Arcade world gravity stays ON here; the Player integrates ONLY vx by hand and adds a
    // fall-gravity nudge via body.gravity — it never hand-integrates vy (no double-count).
    this.physics.world.gravity.y = GRAVITY

    // ── Static solids: floor (two spans + a gap), walls, raised ledges ──
    // A STATIC group: each member is a drawn rectangle promoted to a static Arcade body.
    // Static bodies don't move and aren't affected by gravity (Decision 15 colliders below).
    this.solids = this.physics.add.staticGroup()

    // Floor span A (left of the gap) and span B (right of the gap) — leaves a pit between.
    this._addSolid(GAP_X0 / 2, FLOOR_Y, GAP_X0, WALL_T) // left span: 0 → GAP_X0
    this._addSolid((GAP_X1 + ROOM_W) / 2, FLOOR_Y, ROOM_W - GAP_X1, WALL_T) // right span

    // Left + right walls so the player can't leave the room (world bounds also catch it).
    this._addSolid(WALL_T / 2, ROOM_H / 2, WALL_T, ROOM_H)
    this._addSolid(ROOM_W - WALL_T / 2, ROOM_H / 2, WALL_T, ROOM_H)

    // Two raised solid ledges at different heights — jump between them; walk off their edges
    // to feel coyote time + variable jump.
    this._addSolid(560, FLOOR_Y - 170, 260, 28) // lower ledge
    this._addSolid(900, FLOOR_Y - 320, 260, 28) // higher ledge

    // ── One-way (semi-solid) platform (Decision 15, AC16) ──
    // A normal collider gated by a processCallback: collide ONLY when the player is above and
    // descending onto it → jump UP through, land ON top. Drawn distinct (amber) so it reads.
    this.oneWay = this.add.rectangle(1700, FLOOR_Y - 220, 300, 22, 0xb9770e)
    this.physics.add.existing(this.oneWay, true)

    // ── Player ── spawned above the left floor span.
    this.input2 = new Input(this) // input layer owns the bindings; sampled once per frame.
    this.player = new Player(this, 200, FLOOR_Y - 200)

    // ── Colliders ── against the player's COLLIDER (the body owner), NOT the scaled visual
    // rect (review issue #6). Arcade resolves these BEFORE scene.update, so body.blocked.* is
    // fresh when Player.update reads it.
    this.physics.add.collider(this.player.collider, this.solids)

    // One-way collider with a processCallback (Decision 15). NOTES on the predicate:
    //   • ARGUMENT ORDER (review issue #7): we pass (player.rect, oneWay) so arg1 is ALWAYS
    //     the player and arg2 the platform. Arcade calls processCallback(obj1, obj2) in the
    //     SAME order the pair was registered, so `player`/`platform` below read the right
    //     bodies regardless of internal tree order.
    //   • EPSILON (review issue #7a): tied to one step of max fall so a fast faller whose
    //     bottom dipped slightly below the platform top within a frame still grabs it instead
    //     of tunnelling. MAX_FALL_SPEED · MAX_DT bounds that per-step penetration.
    //   • STANDING (review issue #7b): while resting on top, vy≈0 and player.bottom≈top, so
    //     the predicate keeps returning true — that's CORRECT (it keeps you supported), not a
    //     bug to "fix".
    const ONE_WAY_EPS = 1100 * MAX_DT // MAX_FALL_SPEED · MAX_DT ≈ max per-step penetration.
    this.physics.add.collider(
      this.player.collider,
      this.oneWay,
      null,
      (player, platform) => {
        const pBody = player.body
        const platTop = platform.body.top
        // Collide only when moving down (or resting) AND the player's feet are at/above the
        // platform top (within epsilon). Returning false skips separation → pass up through.
        return pBody.velocity.y >= 0 && pBody.bottom <= platTop + ONE_WAY_EPS
      },
      this,
    )

    // ── Camera follow (deadzone + lerp) ── follows the COLLIDER (stable physics position),
    // not the squash-offset visual rect, so squash/stretch never jitters the camera. Clamped
    // by the bounds set above so it never scrolls past the room edges.
    const cam = this.cameras.main
    cam.startFollow(this.player.collider, true, LERP_X, LERP_Y)
    cam.setDeadzone(DEADZONE_W, DEADZONE_H)

    // Dev hint label (camera-fixed): lists the Phase 1 control scheme.
    this.add
      .text(
        16,
        16,
        'MOVE arrows/WASD   JUMP Space/J   DODGE Shift/K   [ESC] Title',
        { fontFamily: 'monospace', fontSize: '18px', color: '#8b949e' },
      )
      .setScrollFactor(0)

    // ── Parallel HUD overlay (Decision 2) + teardown (Phase 0 carry-over) ──
    if (!this.scene.isActive('HUD')) this.scene.launch('HUD')
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scene.stop('HUD'))

    // ESC → Title (dev). On a .once event so it NEVER shares the JustDown path the Input layer
    // owns for jump/dodge (review issue #5) — JustDown is read once, only inside Input.sample.
    this.input.keyboard.once('keydown-ESC', () => this.scene.start('Title'))
  }

  // Helper: a drawn rectangle promoted to a STATIC Arcade body, added to the solids group so
  // a single collider covers them all (DRY). x/y are the CENTER (Phaser rect origin).
  _addSolid(x, y, w, h) {
    const rect = this.add.rectangle(x, y, w, h, 0x3a4658)
    this.solids.add(rect) // staticGroup.add promotes it to a static body automatically.
    return rect
  }

  // ── Per-frame tick ──
  // Phaser calls update(time, delta) with `delta` in MILLISECONDS (review BLOCKER #1). We
  // convert to SECONDS and clamp to MAX_DT, then hand that dt to the Player. Input is sampled
  // EXACTLY ONCE here (review issue #5) and the snapshot is passed down; nothing else reads
  // JustDown on the jump/dodge keys.
  update(_time, delta) {
    const dt = Math.min(delta / 1000, MAX_DT)
    const inputState = this.input2.sample()
    this.player.update(dt, inputState)
  }
}
