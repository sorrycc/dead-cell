import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'
import { Sound } from '../audio/Sound.js'
import { t } from '../i18n/index.js'

// ── TitleScene (design §6.0 + §6.5, AC5/AC52, Decision 58) ──
// Shows the game title and a Start control. As of the meta-loop phase the flow is Title → HUB → Game
// (the Hub is the run lobby where banked Cells buy permanent upgrades, then START RUN launches the
// game): the Start control now routes to the HUB, not directly to Game (review MINOR — the exact edge
// is pinned: Title has NO direct→Game path; the run is always entered via the Hub). All text is
// positioned from the FIXED design resolution (Decision 8) — never window.innerWidth — so it stays
// centered under Scale.FIT regardless of viewport size.
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title')
  }

  create(): void {
    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2

    // audio §6.4 — the menu-blip façade (shares Phaser's ONE AudioContext; a no-op under NoAudio). The
    // Title's start gesture is the FIRST user gesture, which is what resumes Phaser's suspended context —
    // so this blip may be silent on the very first press but every later sound (the Hub/game) plays.
    const sfx = new Sound(this)

    this.add
      .text(cx, cy - 80, t('title.heading'), {
        fontFamily: UI_FONT,
        fontSize: '72px',
        color: '#e6edf3',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, cy + 20, t('title.subtitle'), {
        fontFamily: UI_FONT,
        fontSize: '22px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, cy + 110, t('title.start'), {
        fontFamily: UI_FONT,
        fontSize: '24px',
        color: '#58d68d',
      })
      .setOrigin(0.5)

    // Enter the HUB on key OR pointer (Title → Hub → Game, Decision 58). `once` so a held key/
    // double-tap can't fire the transition twice. Pointer is bound on the scene input so a click
    // anywhere counts.
    const enterHub = () => {
      sfx.uiSelect() // audio §6.4 (AC6) — Title start blip.
      this.scene.start('Hub')
    }
    this.input.keyboard!.once('keydown-SPACE', enterHub)
    this.input.keyboard!.once('keydown-ENTER', enterHub)
    this.input.once('pointerdown', enterHub)
  }
}
