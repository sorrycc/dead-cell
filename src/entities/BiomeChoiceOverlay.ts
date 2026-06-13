import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'
import type { BiomeConfig } from '../config/biomes.js'
import { t, tName } from '../i18n/index.js'

interface BiomeChoiceOverlayOpts {
  offers: BiomeConfig[] // the 2 exit biomes (already resolved by GameScene from the current node's exits).
  onPick(id: string): void // called with the chosen biome id; GameScene commits it to pendingBiomeId + continues.
}

interface BiomeChoiceOverlayHandlers {
  up: () => void
  down: () => void
  confirm: () => void
}

// ── BiomeChoiceOverlay — the biome-transition ROUTE PICKER (F4 branching-biome-map, Decision 7, AC1) ──
// A third frozen-modal picker cloned from ColorOverlay/MutationOverlay (DRY with the proven idiom): a
// camera-FIXED modal drawn ON TOP of the (frozen) GameScene — primitives + text only (the mandated art
// constraint). It is NOT a separate Scene; it is a self-contained UI object GameScene news up at a 2-exit
// boundary and destroys on pick, while GameScene FREEZES gameplay via its `biomeChoiceOpen` flag (the SAME
// update() gate mutation/colour/shop use — the world halts on the gameplay dt). KISS + decoupled (SOLID): the
// overlay knows NOTHING about RunState — it is handed the 2 offered BiomeConfigs + an onPick(id) callback, so
// the roll logic stays in ONE place (GameScene._applyBiomeChoice → pendingBiomeId + _continueTransition).
//
// THE CHOICE IS A FORK (Decision 6): both routes converge on the boss; there is no "leave" row — crossing the
// boundary means picking ONE of the two next biomes. up/down move the cursor, confirm picks. Each row shows the
// biome NAME (tName — i18n) + a short threat tell (a tier hint) so the choice reads at a glance.
//
// INPUT OWNERSHIP (mirrored from MutationOverlay): the overlay uses its OWN scene.input.keyboard.on(…) handlers
// (registered on open, removed on pick) — separate from Input's JustDown flag, so the two never fight. While
// open, GameScene's update gates out the player/interact/heal logic (gameplay frozen). It deliberately does NOT
// bind ESC (GameScene owns ESC → quit-confirm).

const PANEL_W = 600
const PANEL_H = 320
const ROW_H = 64
const ROW_TOP_OFFSET = 104 // px below the panel top where the first choice row sits.
const CURSOR_COLOR = 0x14323a
const PANEL_COLOR = 0x10141c
const PANEL_STROKE = 0x29b6c6 // a route-cyan frame (distinct from mutation-green / colour-gold / shop-purple).
const NAME_COLOR = '#e6edf3'
const NAME_SELECTED = '#29b6c6'

export class BiomeChoiceOverlay {
  private scene: Phaser.Scene
  private offers: BiomeConfig[]
  private _onPick: (id: string) => void
  private cursor: number
  private _destroyed: boolean
  private dim!: Phaser.GameObjects.Rectangle
  private panel!: Phaser.GameObjects.Rectangle
  private title!: Phaser.GameObjects.Text
  private subtitle!: Phaser.GameObjects.Text
  private cursorBar!: Phaser.GameObjects.Rectangle
  private _rowBaseY!: number
  private nameTexts!: Phaser.GameObjects.Text[]
  private hintTexts!: Phaser.GameObjects.Text[]
  private help!: Phaser.GameObjects.Text
  private _handlers!: BiomeChoiceOverlayHandlers

  // scene: GameScene. opts: { offers: 2 BiomeConfig, onPick(id) }. onPick commits the chosen biome id (→
  // pendingBiomeId) + tears the overlay down + continues the transition (GameScene owns the biomeChoiceOpen flag).
  constructor(scene: Phaser.Scene, { offers, onPick }: BiomeChoiceOverlayOpts) {
    this.scene = scene
    this.offers = offers
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
      .text(cx, panelTop + 28, t('biomechoice.title'), { fontFamily: UI_FONT, fontSize: '32px', color: NAME_SELECTED, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
    this.subtitle = scene.add
      .text(cx, panelTop + 62, t('biomechoice.subtitle'), { fontFamily: UI_FONT, fontSize: '16px', color: '#8b949e' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)

    this.cursorBar = scene.add
      .rectangle(cx, 0, PANEL_W - 36, ROW_H - 10, CURSOR_COLOR)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1.5)

    // One name + hint text per offered biome (two lines per row): the biome NAME (i18n) + a threat tell.
    this._rowBaseY = panelTop + ROW_TOP_OFFSET
    this.nameTexts = []
    this.hintTexts = []
    for (let i = 0; i < this.offers.length; i++) {
      const rowY = this._rowBaseY + i * ROW_H
      const b = this.offers[i]
      const nameT = scene.add
        .text(cx - PANEL_W / 2 + 30, rowY - 12, tName('biome', b.id, b.name), { fontFamily: UI_FONT, fontSize: '22px', color: NAME_COLOR, fontStyle: 'bold' })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH + 2)
      const hintT = scene.add
        .text(cx - PANEL_W / 2 + 30, rowY + 12, t('biomechoice.hint', { tier: b.difficultyTier }), { fontFamily: UI_FONT, fontSize: '17px', color: '#8b949e' })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH + 2)
      this.nameTexts.push(nameT)
      this.hintTexts.push(hintT)
    }

    this.help = scene.add
      .text(cx, panelTop + PANEL_H - 20, t('biomechoice.help'), { fontFamily: UI_FONT, fontSize: '16px', color: '#8b949e' })
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
    this.cursor = Phaser.Math.Clamp(this.cursor + dir, 0, this.offers.length - 1)
    this._render()
  }

  // Confirm the selected route: tear down FIRST (so a second confirm can't double-pick), then notify GameScene.
  _confirm() {
    if (this._destroyed) return
    const picked = this.offers[this.cursor]
    if (!picked) return
    this._teardown()
    this._onPick(picked.id) // GameScene commits the choice + continues the transition.
  }

  _render() {
    if (this._destroyed) return
    // Move the highlight bar behind the selected row; brighten the selected name (route-cyan), mute the rest.
    this.cursorBar.y = this._rowBaseY + this.cursor * ROW_H
    for (let i = 0; i < this.offers.length; i++) {
      this.nameTexts[i].setColor(i === this.cursor ? NAME_SELECTED : NAME_COLOR)
    }
  }

  // Tear down all GameObjects + remove the keyboard handlers (idempotent). Split from _confirm so GameScene's
  // teardown path can also force-close defensively (mirrors MutationOverlay/ColorOverlay).
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
    for (const o of [this.dim, this.panel, this.title, this.subtitle, this.cursorBar, this.help, ...this.nameTexts, ...this.hintTexts]) {
      if (o && o.active) o.destroy()
    }
  }

  // Force-close WITHOUT picking (GameScene teardown defensive path only — a normal flow always picks). It does
  // NOT fire onPick (no route chosen), so a torn-down-mid-offer overlay leaves pendingBiomeId untouched (advance()
  // then auto-picks the default exit — the run never stalls).
  close() {
    this._teardown()
  }
}
