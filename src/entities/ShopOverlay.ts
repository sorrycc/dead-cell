import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'
import { SHOP_ITEMS } from '../config/shop.js'
import type { ShopItem } from '../config/shop.js'
import { t, tName, tDesc } from '../i18n/index.js'

interface ShopOverlayOpts {
  getGold(): number
  onBuy(item: ShopItem): boolean
  onClose(): void
}

interface ShopOverlayHandlers {
  up: () => void
  down: () => void
  confirm: () => void
}

// ── ShopOverlay — the in-run vendor buy menu (design §6.10, Decision 74/76, AC63) ──
// A lightweight camera-FIXED overlay drawn ON TOP of the (paused) GameScene — primitives + text only
// (the mandated art constraint), mirroring HubScene's keyboard-driven list. It is NOT a separate Scene:
// a parallel Scene would need its own input plumbing + a pause handshake; instead this is a self-contained
// UI object GameScene news up on _openShop() and destroys on close, while GameScene FREEZES gameplay via
// its `shopOpen` flag (the same update() gate as gameOver/transitioning). KISS + decoupled (SOLID): the
// overlay knows NOTHING about RunState/Player — GameScene supplies a `getGold()` reader + an `onBuy(item)`
// callback (which deducts gold + applies the effect + returns true/false) + an `onClose()` callback, so the
// economy logic stays in ONE place (the scene), exactly like the Pickup overlap handler.
//
// INPUT OWNERSHIP (review — the JustDown footgun): the Input class owns JustDown for E/Q/etc. This overlay
// uses its OWN `scene.input.keyboard.on('keydown-…')` event handlers (registered on open, removed on close)
// — the Phaser event bus is SEPARATE from the JustDown flag Input reads, so the two never fight. The E
// press that OPENED the shop was consumed by Input.sample that frame; the overlay's keydown-E handler fires
// only on the NEXT press, so opening never instantly buys/closes. While open, GameScene's update gates out
// the player/interact/heal logic (gameplay frozen), so nothing in the world reacts to these keys.

const PANEL_W = 560
const ROW_H = 44
const ROW_TOP_OFFSET = 96 // px below the panel top where the first item row sits.
const BOTTOM_PAD = 48 // px between the close row and the panel's bottom border. The help line sits
// INSIDE this band at `panelTop + PANEL_H - 20` (anchored to the border, NOT to BOTTOM_PAD), so
// BOTTOM_PAD must stay ≥ ~40 for the help (border − 20) to clear the close row's cursor bar.
// ── PANEL_H is DERIVED from the catalog, not a magic constant (the overflow root-cause fix) ── the
// list draws one row per SHOP_ITEMS entry + a synthetic "离开"/Leave close row; sizing the panel to
// that count means it grows/shrinks with the catalog and can never again spill past the border when
// items are added (mirrors HubScene's data-driven list sizing, HubScene.ts:37-39). Every other Y
// anchors off panelTop/cy, so this is the only height knob. Fits the 720p viewport up to ~13 rows;
// a larger catalog would need density/scrolling (a separate slice — YAGNI here).
const ROW_COUNT = SHOP_ITEMS.length + 1
const PANEL_H = ROW_TOP_OFFSET + ROW_COUNT * ROW_H + BOTTOM_PAD
// ── Column x-offsets from the panel's left edge (i18n alignment fix) ── each row cell is its own fixed-x
// Text, so columns line up under the proportional CJK fallback font (char-count padEnd only aligns under
// monospace). Name origin at +30 (unchanged); price at +210 (~18px gap past the longest 15ch name); desc
// at +270 (clears the ≤4ch `{price}g`).
const COL_NAME_DX = 30
const COL_PRICE_DX = 210
const COL_DESC_DX = 270
const CURSOR_COLOR = 0x2c3e50
const PANEL_COLOR = 0x10141c
const PANEL_STROKE = 0x9b59b6

export class ShopOverlay {
  private scene: Phaser.Scene
  private _getGold: () => number
  private _onBuy: (item: ShopItem) => boolean
  private _onClose: () => void
  private cursor: number
  private _destroyed: boolean
  private dim!: Phaser.GameObjects.Rectangle
  private panel!: Phaser.GameObjects.Rectangle
  private title!: Phaser.GameObjects.Text
  private goldHeader!: Phaser.GameObjects.Text
  private cursorBar!: Phaser.GameObjects.Rectangle
  private _rowBaseY!: number
  // Per-item cell-sets ([name, price, desc] at fixed x — the alignment fix); the item's color is applied
  // to all three in _render.
  private rowTexts!: Phaser.GameObjects.Text[][]
  private closeRowIndex!: number
  private rowCount!: number
  private closeText!: Phaser.GameObjects.Text
  private help!: Phaser.GameObjects.Text
  private _handlers!: ShopOverlayHandlers

  // scene: GameScene. opts: { getGold(): number, onBuy(item): boolean, onClose(): void }. getGold reads the
  // live run gold; onBuy attempts a purchase (deduct + apply) returning success; onClose tears the overlay
  // down + resumes gameplay (GameScene owns the shopOpen flag).
  constructor(scene: Phaser.Scene, { getGold, onBuy, onClose }: ShopOverlayOpts) {
    this.scene = scene
    this._getGold = getGold
    this._onBuy = onBuy
    this._onClose = onClose
    this.cursor = 0
    this._destroyed = false

    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2
    const panelTop = cy - PANEL_H / 2
    // Depth above EVERYTHING in the world (the dev hint label sits at depth 100; the HUD is a separate
    // parallel scene drawn over this one — but the buy interaction lives here, so a high depth is plenty).
    const DEPTH = 200

    // A dimming backdrop over the whole frozen scene (camera-fixed) so the overlay reads as a modal.
    this.dim = scene.add
      .rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH)

    // The panel + a vendor-purple frame.
    this.panel = scene.add
      .rectangle(cx, cy, PANEL_W, PANEL_H, PANEL_COLOR, 0.96)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1)
    this.panel.setStrokeStyle(3, PANEL_STROKE, 0.9)

    this.title = scene.add
      .text(cx, panelTop + 28, t('shop.title'), { fontFamily: UI_FONT, fontSize: '34px', color: '#9b59b6', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
    this.goldHeader = scene.add
      .text(cx, panelTop + 60, '', { fontFamily: UI_FONT, fontSize: '20px', color: '#f1c40f' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)

    // The cursor highlight bar (moved behind the selected row).
    this.cursorBar = scene.add
      .rectangle(cx, 0, PANEL_W - 36, ROW_H - 8, CURSOR_COLOR)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1.5)

    // One cell-set per catalog item ([name, price, desc] at fixed x — the alignment fix) + a CLOSE row.
    this._rowBaseY = panelTop + ROW_TOP_OFFSET
    const left = cx - PANEL_W / 2
    const makeCell = (x: number, y: number, color: string) =>
      scene.add.text(x, y, '', { fontFamily: UI_FONT, fontSize: '20px', color }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH + 2)
    this.rowTexts = []
    for (let i = 0; i < SHOP_ITEMS.length; i++) {
      const y = this._rowBaseY + i * ROW_H
      this.rowTexts.push([left + COL_NAME_DX, left + COL_PRICE_DX, left + COL_DESC_DX].map((x) => makeCell(x, y, '#e6edf3')))
    }
    this.closeRowIndex = SHOP_ITEMS.length
    this.rowCount = SHOP_ITEMS.length + 1
    this.closeText = scene.add
      .text(cx, this._rowBaseY + this.closeRowIndex * ROW_H, t('shop.leave'), {
        fontFamily: UI_FONT,
        fontSize: '22px',
        color: '#8b949e',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)

    this.help = scene.add
      .text(cx, panelTop + PANEL_H - 20, t('shop.help'), {
        fontFamily: UI_FONT,
        fontSize: '16px',
        color: '#8b949e',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)

    // ── Dedicated keyboard handlers (removed on close) — the overlay's own bus, separate from Input's
    // JustDown reads. Bound once; the handler refs are stored so close() removes exactly them. ──
    // NOTE on ESC (review — the input-ownership footgun): GameScene owns a `.once('keydown-ESC')` that jumps
    // to Title. The overlay deliberately does NOT bind ESC (it would fire AFTER GameScene's handler → a jump
    // to Title instead of a close). LEAVE is reached via the cursor + confirm (E/SPACE/ENTER) so closing
    // never collides with the scene's ESC. The Q/E/etc. JustDown reads Input owns are a separate bus.
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
    this.cursor = Phaser.Math.Clamp(this.cursor + dir, 0, this.rowCount - 1)
    this._render()
  }

  // Confirm the selected row: CLOSE row → leave; an item row → attempt the buy (GameScene's onBuy deducts
  // gold + applies the effect, returns success), then re-render affordability. A failed buy (can't afford)
  // is a silent no-op — the row stays red so the player sees why.
  _confirm() {
    if (this.cursor === this.closeRowIndex) {
      this.close()
      return
    }
    const item = SHOP_ITEMS[this.cursor]
    this._onBuy(item) // GameScene deducts + applies; success/failure both just re-render below.
    this._render()
  }

  _render() {
    if (this._destroyed) return
    const gold = this._getGold()
    this.goldHeader.setText(t('shop.gold', { n: gold }))
    for (let i = 0; i < SHOP_ITEMS.length; i++) {
      const it = SHOP_ITEMS[i]
      const affordable = gold >= it.price
      const color = affordable ? '#e6edf3' : '#e5484d' // white if affordable, red if not.
      const cells = this.rowTexts[i] // [name, price, desc] — fixed-x cells, all share the row color.
      cells[0].setText(tName('shop', it.id, it.name)).setColor(color)
      cells[1].setText(`${it.price}g`).setColor(color)
      cells[2].setText(tDesc('shop', it.id, it.desc)).setColor(color)
    }
    // Move the highlight bar behind the selected row (the CLOSE row is the synthetic last, centered).
    const selY = this.cursor === this.closeRowIndex
      ? this._rowBaseY + this.closeRowIndex * ROW_H
      : this._rowBaseY + this.cursor * ROW_H
    this.cursorBar.y = selY
  }

  // Tear down all GameObjects + remove the keyboard handlers, then notify GameScene (resume gameplay).
  close() {
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
    for (const o of [this.dim, this.panel, this.title, this.goldHeader, this.cursorBar, this.closeText, this.help, ...this.rowTexts.flat()]) {
      if (o && o.active) o.destroy()
    }
    if (this._onClose) this._onClose()
  }
}
