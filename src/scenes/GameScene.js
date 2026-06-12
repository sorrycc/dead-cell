import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, GRAVITY } from '../config/constants.js'

// ── GameScene (design §6.0, AC6) ──
// The only scene with an Arcade physics world. Phase 0 proves the platforming foundation:
// a STATIC platform and a DYNAMIC player rectangle that falls under gravity and lands on
// it. No input yet (Phase 1 adds run/jump). Also proves the parallel HUD overlay
// (Decision 2) — and tears it down on shutdown so re-entering the scene can't stack a
// second HUD instance (review fix: parallel scenes outlive the launcher).
export class GameScene extends Phaser.Scene {
  constructor() {
    super('Game')
  }

  create() {
    // ── World + camera bounds (Decision 8) ──
    // FIXED bounds equal to the design resolution. With a stable coordinate system the
    // camera can be clamped (and, in later phases, follow the player) without the world
    // stretching on resize. Phase 0 is a single screen, so bounds == the design rect.
    this.physics.world.setBounds(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)
    this.cameras.main.setBounds(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)

    // ── Per-scene gravity (Decision 9) ──
    // Gravity lives HERE, not in the global Phaser.Game config, so only this scene runs a
    // gravity-enabled world. Menu/overlay scenes stay body-free.
    this.physics.world.gravity.y = GRAVITY

    // ── Static platform ──
    // A drawn rectangle promoted to a STATIC Arcade body (`existing(rect, true)`); spans
    // the lower-middle of the FIXED world (never window dimensions, so it can't drift on
    // resize). Static bodies don't move and aren't affected by gravity.
    const platformY = DESIGN_HEIGHT - 120
    const platform = this.add.rectangle(DESIGN_WIDTH / 2, platformY, 640, 32, 0x3a4658)
    this.physics.add.existing(platform, true)

    // ── Dynamic player ──
    // A smaller rectangle with a DYNAMIC body, spawned well above the platform so the fall
    // is visible. Gravity pulls it down; the collider stops it on the platform. setBounds
    // keeps it inside the world (it can't fall off the bottom forever).
    const player = this.add.rectangle(DESIGN_WIDTH / 2, 120, 40, 56, 0x58d68d)
    this.physics.add.existing(player)
    player.body.setCollideWorldBounds(true)
    this.physics.add.collider(player, platform)

    // A tiny dev hint label (camera-fixed via scrollFactor 0, though Phase 0 doesn't scroll).
    this.add
      .text(16, 16, 'GAME — player falls & lands (Phase 0)   [ESC] Title', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#8b949e',
      })
      .setScrollFactor(0)

    // ── Parallel HUD overlay (Decision 2) ──
    // Guard against an already-running instance, then launch HUD on top of Game.
    if (!this.scene.isActive('HUD')) {
      this.scene.launch('HUD')
    }

    // ── HUD teardown (review fix) ──
    // Parallel scenes keep running after you leave the launcher. Without this, the cycle
    // Game → ESC → Title → Start → Game would stack a SECOND HUD every loop. Stop HUD when
    // GameScene shuts down so exactly one HUD ever exists.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scene.stop('HUD')
    })

    // Dev convenience: ESC → Title (replaced by real death/pause routing in later phases).
    this.input.keyboard.once('keydown-ESC', () => this.scene.start('Title'))
  }
}
