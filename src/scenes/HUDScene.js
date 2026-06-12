import Phaser from 'phaser'
import { DESIGN_WIDTH } from '../config/constants.js'

// ── HUDScene (design §6.0, Decision 2) ──
// Runs in PARALLEL over GameScene (launched, not started). It is decoupled from gameplay
// (SOLID): later phases feed it via the scene registry / events. Phase 0 just renders a
// label in the top-right to prove the overlay draws ON TOP of the world. GameScene owns
// this scene's lifecycle and stops it on shutdown (so it never double-stacks).
export class HUDScene extends Phaser.Scene {
  constructor() {
    super('HUD')
  }

  create() {
    this.add
      .text(DESIGN_WIDTH - 16, 16, 'HUD (overlay)', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#fbd000',
      })
      .setOrigin(1, 0)
  }
}
