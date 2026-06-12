import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config/constants.js'

// ── GameOverScene (design §6.0; wired to permadeath in Phase 5/7) ──
// Phase 0 stub: a reachable "GAME OVER" screen that routes back to Title so the skeleton
// is fully navigable. Later phases re-point the death edge here (lose run-only loot, keep
// banked Cells) to close the permadeath loop.
export class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOver')
  }

  create() {
    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2

    this.add
      .text(cx, cy - 30, 'GAME OVER', {
        fontFamily: 'monospace',
        fontSize: '64px',
        color: '#e5484d',
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
