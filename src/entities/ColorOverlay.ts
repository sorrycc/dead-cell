import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'
import { COLOR_IDS, COLORS } from '../config/colors.js'
import type { ColorId } from '../config/colors.js'
import { t } from '../i18n/index.js'

interface ColorOverlayHandlers {
  up: () => void
  down: () => void
  confirm: () => void
}

// ── ColorOverlay — the biome-transition COLOUR-up PICKER (color-scaling-stats §6, Decision 7, AC9) ──
// A trimmed clone of MutationOverlay (Decision 7 — DRY with the proven frozen-modal idiom): a camera-FIXED
// modal drawn ON TOP of the (frozen) GameScene — primitives + text only (the mandated art constraint). Like
// MutationOverlay it is NOT a separate Scene; it is a self-contained UI object GameScene news up and destroys
// on pick, while GameScene FREEZES gameplay via its `colorPickOpen` flag (the SAME update() gate mutation/shop
// use). KISS + decoupled (SOLID): the overlay knows NOTHING about RunState/Player — it offers the three FIXED
// colours (COLOR_IDS, ordered — no shuffle since there are exactly 3) + an onPick(colorId) callback, so the
// level-up logic stays in ONE place (GameScene._applyColorPick), exactly like the mutation overlay's onPick.
//
// THE OFFER IS A GIFT: there is NO "leave" row — crossing a biome HANDS you a +1 colour level (the build
// lever), so you MUST pick one of the three. up/down move the cursor, confirm picks. Each row is tinted to its
// colour (brutality red / tactics purple / survival green) so the build direction reads at a glance.
//
// INPUT OWNERSHIP (mirrored from MutationOverlay): the overlay uses its OWN scene.input.keyboard.on(…)
// handlers (registered on open, removed on pick) — separate from Input's JustDown flag, so the two never fight.
// While open, GameScene's update gates out the player/interact/heal logic (gameplay frozen). It deliberately
// does NOT bind ESC (GameScene owns ESC → quit-confirm).

const PANEL_W = 600
const PANEL_H = 320
const ROW_H = 64
const ROW_TOP_OFFSET = 104 // px below the panel top where the first choice row sits.
const CURSOR_COLOR = 0x1f2a3a
const PANEL_COLOR = 0x10141c
const PANEL_STROKE = 0xf4d03f // a gold frame (distinct from the mutation-green + shop-purple frames).

// '#rrggbb' for a 0xRRGGBB tint (Phaser Text.setColor takes a CSS string, not a number).
function hex(tint: number): string {
  return '#' + tint.toString(16).padStart(6, '0')
}

export class ColorOverlay {
  private scene: Phaser.Scene
  private _onPick: (id: ColorId) => void
  private cursor: number
  private _destroyed: boolean
  private dim!: Phaser.GameObjects.Rectangle
  private panel!: Phaser.GameObjects.Rectangle
  private title!: Phaser.GameObjects.Text
  private subtitle!: Phaser.GameObjects.Text
  private cursorBar!: Phaser.GameObjects.Rectangle
  private _rowBaseY!: number
  private nameTexts!: Phaser.GameObjects.Text[]
  private descTexts!: Phaser.GameObjects.Text[]
  private help!: Phaser.GameObjects.Text
  private _handlers!: ColorOverlayHandlers

  // scene: GameScene. onPick(colorId) applies the +1 colour level + tears the overlay down + resumes gameplay
  // (GameScene owns the colorPickOpen flag).
  constructor(scene: Phaser.Scene, onPick: (id: ColorId) => void) {
    this.scene = scene
    this._onPick = onPick
    this.cursor = 0
    this._destroyed = false

    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2
    const panelTop = cy - PANEL_H / 2
    const DEPTH = 200 // above everything in the world (same depth band the other overlays use).

    this.dim = scene.add
      .rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH)

    this.panel = scene.add
      .rectangle(cx, cy, PANEL_W, PANEL_H, PANEL_COLOR, 0.96)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1)
    this.panel.setStrokeStyle(3, PANEL_STROKE, 0.9)

    this.title = scene.add
      .text(cx, panelTop + 28, t('color.title'), { fontFamily: UI_FONT, fontSize: '32px', color: '#f4d03f', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
    this.subtitle = scene.add
      .text(cx, panelTop + 62, t('color.subtitle'), { fontFamily: UI_FONT, fontSize: '16px', color: '#8b949e' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)

    this.cursorBar = scene.add
      .rectangle(cx, 0, PANEL_W - 36, ROW_H - 10, CURSOR_COLOR)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1.5)

    // One name + desc text per colour (two lines per row), each tinted to its colour.
    this._rowBaseY = panelTop + ROW_TOP_OFFSET
    this.nameTexts = []
    this.descTexts = []
    for (let i = 0; i < COLOR_IDS.length; i++) {
      const rowY = this._rowBaseY + i * ROW_H
      const id = COLOR_IDS[i]
      const tint = hex(COLORS[id].tint)
      const nameT = scene.add
        .text(cx - PANEL_W / 2 + 30, rowY - 12, t(`color.${id}`), { fontFamily: UI_FONT, fontSize: '22px', color: tint, fontStyle: 'bold' })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH + 2)
      const descT = scene.add
        .text(cx - PANEL_W / 2 + 30, rowY + 12, t(`color.${id}.desc`), { fontFamily: UI_FONT, fontSize: '17px', color: '#8b949e' })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH + 2)
      this.nameTexts.push(nameT)
      this.descTexts.push(descT)
    }

    this.help = scene.add
      .text(cx, panelTop + PANEL_H - 20, t('color.help'), { fontFamily: UI_FONT, fontSize: '16px', color: '#8b949e' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)

    this._handlers = {
      up: () => this._move(-1),
      down: () => this._move(1),
      confirm: () => this._confirm(),
    }
    const kb = scene.input.keyboard!
    kb.on('keydown-UP', this._handlers.up)
    kb.on('keydown-DOWN', this._handlers.down)
    kb.on('keydown-W', this._handlers.up)
    kb.on('keydown-S', this._handlers.down)
    kb.on('keydown-E', this._handlers.confirm)
    kb.on('keydown-SPACE', this._handlers.confirm)
    kb.on('keydown-ENTER', this._handlers.confirm)

    this._render()
  }

  _move(dir: number) {
    this.cursor = Phaser.Math.Clamp(this.cursor + dir, 0, COLOR_IDS.length - 1)
    this._render()
  }

  // Confirm the selected colour: tear down FIRST (so a second confirm can't double-pick), then notify GameScene.
  _confirm() {
    if (this._destroyed) return
    const picked = COLOR_IDS[this.cursor]
    if (!picked) return
    this._teardown()
    this._onPick(picked) // GameScene applies the +1 level + resumes gameplay.
  }

  _render() {
    if (this._destroyed) return
    // Move the highlight bar behind the selected row; brighten the selected name (white), tint the rest.
    this.cursorBar.y = this._rowBaseY + this.cursor * ROW_H
    for (let i = 0; i < COLOR_IDS.length; i++) {
      this.nameTexts[i].setColor(i === this.cursor ? '#ffffff' : hex(COLORS[COLOR_IDS[i]].tint))
    }
  }

  // Tear down all GameObjects + remove the keyboard handlers (idempotent). Split from _confirm so GameScene's
  // teardown path can also force-close defensively (mirrors MutationOverlay).
  _teardown() {
    if (this._destroyed) return
    this._destroyed = true
    const kb = this.scene.input.keyboard!
    kb.off('keydown-UP', this._handlers.up)
    kb.off('keydown-DOWN', this._handlers.down)
    kb.off('keydown-W', this._handlers.up)
    kb.off('keydown-S', this._handlers.down)
    kb.off('keydown-E', this._handlers.confirm)
    kb.off('keydown-SPACE', this._handlers.confirm)
    kb.off('keydown-ENTER', this._handlers.confirm)
    for (const o of [this.dim, this.panel, this.title, this.subtitle, this.cursorBar, this.help, ...this.nameTexts, ...this.descTexts]) {
      if (o && o.active) o.destroy()
    }
  }

  // Force-close WITHOUT picking (GameScene teardown defensive path only — a normal flow always picks).
  close() {
    this._teardown()
  }
}
