import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config/constants.js'

// ── HubScene (design §6.0; built out in Phase 7) ──
// The meta-progression hub where banked Cells buy PERMANENT upgrades. Phase 0 ships a
// reachable, navigable stub (a label + return-to-Title) so the scene skeleton is complete;
// the real shop + persistence land in Phase 7.
export class HubScene extends Phaser.Scene {
  constructor() {
    super('Hub')
  }

  create() {
    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2

    this.add
      .text(cx, cy - 40, 'HUB', {
        fontFamily: 'monospace',
        fontSize: '64px',
        color: '#e6edf3',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, cy + 40, '(meta-upgrades — Phase 7)   Press SPACE → Title', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    this.input.keyboard.once('keydown-SPACE', () => this.scene.start('Title'))
  }
}
