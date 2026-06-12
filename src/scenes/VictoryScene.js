import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config/constants.js'

// ── VictoryScene (design §6.0; wired to boss-defeat in Phase 6) ──
// Phase 0 stub: a reachable "VICTORY" screen that routes back to Title. Phase 6 points the
// boss-kill edge here to end a successful run before returning to the Hub.
export class VictoryScene extends Phaser.Scene {
  constructor() {
    super('Victory')
  }

  create() {
    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2

    this.add
      .text(cx, cy - 30, 'VICTORY', {
        fontFamily: 'monospace',
        fontSize: '64px',
        color: '#58d68d',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, cy + 50, 'Press SPACE / click → Title', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    const toTitle = () => this.scene.start('Title')
    this.input.keyboard.once('keydown-SPACE', toTitle)
    this.input.once('pointerdown', toTitle)
  }
}
