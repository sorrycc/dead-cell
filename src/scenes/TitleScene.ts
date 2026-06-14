import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'
import { Sound } from '../audio/Sound.js'
import { t, CONTROLS_ROWS } from '../i18n/index.js'

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

    // audio §6.4 — the menu-blip façade (shares Phaser's ONE AudioContext; a no-op under NoAudio). The
    // Title's start gesture is the FIRST user gesture, which is what resumes Phaser's suspended context —
    // so this blip may be silent on the very first press but every later sound (the Hub/game) plays.
    const sfx = new Sound(this)

    // Heading + subtitle near the TOP (repositioned to make room for the controls reference below — every Y is
    // off the FIXED design resolution so it stays centered under Scale.FIT, the existing Title discipline).
    this.add
      .text(cx, 96, t('title.heading'), {
        fontFamily: UI_FONT,
        fontSize: '72px',
        color: '#e6edf3',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, 168, t('title.subtitle'), {
        fontFamily: UI_FONT,
        fontSize: '22px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    // ── Controls reference (F1 onboarding & build UI §6.6, AC1) — the shared CONTROLS_ROWS so a first-time
    // player can discover every binding. Two fixed-x columns per row (action label | keys), the CJK-safe
    // alignment discipline (Decision 7 — never padEnd, which only aligns under monospace). The 13 rows are
    // split into TWO side-by-side groups so the block stays readable + clears the start prompt below. All
    // positions derive from DESIGN_WIDTH/DESIGN_HEIGHT (never window.innerWidth) so it centers under Scale.FIT.
    this.add
      .text(cx, 212, t('controls.title'), { fontFamily: UI_FONT, fontSize: '22px', color: '#5c6b7a', fontStyle: 'bold' })
      .setOrigin(0.5)

    const ROW_H = 30
    const half = Math.ceil(CONTROLS_ROWS.length / 2)
    const groupTop = 248
    // Two groups, each a (label | keys) pair of fixed-x columns. Group 1 left of center, group 2 right.
    const GROUP_LABEL_X = [cx - 540, cx + 40]
    const GROUP_KEYS_X = [cx - 320, cx + 260]
    for (let i = 0; i < CONTROLS_ROWS.length; i++) {
      const g = i < half ? 0 : 1
      const row = g === 0 ? i : i - half
      const y = groupTop + row * ROW_H
      const [actionKey, keysKey] = CONTROLS_ROWS[i]
      this.add
        .text(GROUP_LABEL_X[g], y, t(actionKey), { fontFamily: UI_FONT, fontSize: '18px', color: '#8b949e' })
        .setOrigin(0, 0.5)
      this.add
        .text(GROUP_KEYS_X[g], y, t(keysKey), { fontFamily: UI_FONT, fontSize: '18px', color: '#c9d1d9' })
        .setOrigin(0, 0.5)
    }

    this.add
      .text(cx, DESIGN_HEIGHT - 72, t('title.start'), {
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
