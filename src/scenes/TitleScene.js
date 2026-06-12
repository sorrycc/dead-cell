import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config/constants.js'

// ── TitleScene (design §6.0, AC5) ──
// Shows the game title and a Start control. Either pressing a key (SPACE / ENTER) or
// clicking/tapping anywhere starts GameScene. All text is positioned from the FIXED design
// resolution (Decision 8) — never window.innerWidth — so it stays centered under Scale.FIT
// regardless of viewport size.
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title')
  }

  create() {
    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2

    this.add
      .text(cx, cy - 80, 'DEAD CELL', {
        fontFamily: 'monospace',
        fontSize: '72px',
        color: '#e6edf3',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, cy + 20, 'A roguelite action-platformer', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, cy + 110, 'Press SPACE / ENTER or click to START', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#58d68d',
      })
      .setOrigin(0.5)

    // Start on key OR pointer. `once` so a held key/double-tap can't fire the transition
    // twice. Pointer is bound on the scene input so a click anywhere counts.
    const start = () => this.scene.start('Game')
    this.input.keyboard.once('keydown-SPACE', start)
    this.input.keyboard.once('keydown-ENTER', start)
    this.input.once('pointerdown', start)
  }
}
