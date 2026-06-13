import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'
import type { MutationSpec } from '../config/mutations.js'
import { t, tName, tDesc } from '../i18n/index.js'

interface MutationOverlayOpts {
  offers: MutationSpec[] // the 3 seeded mutation choices (already drawn by GameScene).
  onPick(id: string): void // called with the chosen mutation id; GameScene applies it + closes.
}

interface MutationOverlayHandlers {
  up: () => void
  down: () => void
  confirm: () => void
}

// ── MutationOverlay — the biome-transition mutation PICKER (build-&-replay design §6.5, AC2) ──
// A trimmed clone of ShopOverlay (Decision 2 — DRY with the proven choice-overlay idiom): a camera-FIXED
// modal drawn ON TOP of the (frozen) GameScene — primitives + text only (the mandated art constraint). It
// is NOT a separate Scene (a parallel Scene would need its own input plumbing + a pause handshake); instead
// it is a self-contained UI object GameScene news up on _offerMutation() and destroys on pick, while
// GameScene FREEZES gameplay via its `mutationOpen` flag (the SAME update() gate the shop uses — the world
// halts on the gameplay dt). KISS + decoupled (SOLID): the overlay knows NOTHING about RunState/Player — it
// is handed the 3 offered { name, desc } specs + an onPick(id) callback, so the perk-apply logic stays in
// ONE place (the scene), exactly like the shop's onBuy.
//
// THE OFFER IS A GIFT (Decision 2 / §6.5): there is NO "leave" row — crossing a biome HANDS you a
// mutation, so you MUST pick one of the three (the build lever). up/down move the cursor, confirm picks.
//
// INPUT OWNERSHIP (review — the JustDown footgun, mirrored from ShopOverlay): the Input class owns JustDown
// for E/Q/etc. This overlay uses its OWN scene.input.keyboard.on('keydown-…') handlers (registered on open,
// removed on pick) — the Phaser event bus is SEPARATE from the JustDown flag Input reads, so the two never
// fight. While open, GameScene's update gates out the player/interact/heal logic (gameplay frozen), so
// nothing in the world reacts to these keys. It deliberately does NOT bind ESC (GameScene owns a
// .once('keydown-ESC') → Title; binding it here would jump to Title instead of picking).

const PANEL_W = 600
const PANEL_H = 320
const ROW_H = 64
const ROW_TOP_OFFSET = 104 // px below the panel top where the first choice row sits.
const CURSOR_COLOR = 0x1f3a2e
const PANEL_COLOR = 0x10141c
const PANEL_STROKE = 0x2ecc71 // a mutation-green frame (distinct from the shop's vendor-purple).

export class MutationOverlay {
  private scene: Phaser.Scene
  private offers: MutationSpec[]
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
  private descTexts!: Phaser.GameObjects.Text[]
  private help!: Phaser.GameObjects.Text
  private _handlers!: MutationOverlayHandlers

  // scene: GameScene. opts: { offers: 3 MutationSpec, onPick(id) }. onPick applies the chosen mutation +
  // tears the overlay down + resumes gameplay (GameScene owns the mutationOpen flag).
  constructor(scene: Phaser.Scene, { offers, onPick }: MutationOverlayOpts) {
    this.scene = scene
    this.offers = offers
    this._onPick = onPick
    this.cursor = 0
    this._destroyed = false

    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2
    const panelTop = cy - PANEL_H / 2
    const DEPTH = 200 // above everything in the world (same depth band the shop overlay uses).

    // A dimming backdrop over the whole frozen scene (camera-fixed) so the overlay reads as a modal.
    this.dim = scene.add
      .rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH)

    // The panel + a mutation-green frame.
    this.panel = scene.add
      .rectangle(cx, cy, PANEL_W, PANEL_H, PANEL_COLOR, 0.96)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1)
    this.panel.setStrokeStyle(3, PANEL_STROKE, 0.9)

    this.title = scene.add
      .text(cx, panelTop + 28, t('mutation.title'), { fontFamily: UI_FONT, fontSize: '32px', color: '#2ecc71', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
    this.subtitle = scene.add
      .text(cx, panelTop + 62, t('mutation.subtitle'), {
        fontFamily: UI_FONT,
        fontSize: '16px',
        color: '#8b949e',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)

    // The cursor highlight bar (moved behind the selected row).
    this.cursorBar = scene.add
      .rectangle(cx, 0, PANEL_W - 36, ROW_H - 10, CURSOR_COLOR)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1.5)

    // One name + desc text per offered mutation (two lines per row).
    this._rowBaseY = panelTop + ROW_TOP_OFFSET
    this.nameTexts = []
    this.descTexts = []
    for (let i = 0; i < this.offers.length; i++) {
      const rowY = this._rowBaseY + i * ROW_H
      const m = this.offers[i]
      const nameT = scene.add
        .text(cx - PANEL_W / 2 + 30, rowY - 12, tName('mutation', m.id, m.name), { fontFamily: UI_FONT, fontSize: '22px', color: '#e6edf3', fontStyle: 'bold' })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH + 2)
      const descT = scene.add
        .text(cx - PANEL_W / 2 + 30, rowY + 12, tDesc('mutation', m.id, m.desc), { fontFamily: UI_FONT, fontSize: '17px', color: '#8b949e' })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH + 2)
      this.nameTexts.push(nameT)
      this.descTexts.push(descT)
    }

    this.help = scene.add
      .text(cx, panelTop + PANEL_H - 20, t('mutation.help'), {
        fontFamily: UI_FONT,
        fontSize: '16px',
        color: '#8b949e',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)

    // ── Dedicated keyboard handlers (removed on pick) — the overlay's own bus, separate from Input's
    // JustDown reads (the same idiom + the same ESC-avoidance the shop overlay uses — see header). ──
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

  // Confirm the selected mutation: notify GameScene (which applies it + records it + closes the overlay).
  // We close FIRST (tear down GameObjects + handlers) so a second confirm keypress can't double-pick.
  _confirm() {
    if (this._destroyed) return
    const picked = this.offers[this.cursor]
    if (!picked) return
    this._teardown()
    this._onPick(picked.id) // GameScene applies the perk + resumes gameplay.
  }

  _render() {
    if (this._destroyed) return
    // Move the highlight bar behind the selected row; brighten the selected name, mute the rest.
    this.cursorBar.y = this._rowBaseY + this.cursor * ROW_H
    for (let i = 0; i < this.offers.length; i++) {
      this.nameTexts[i].setColor(i === this.cursor ? '#2ecc71' : '#e6edf3')
    }
  }

  // Tear down all GameObjects + remove the keyboard handlers (idempotent). Split from _confirm so the
  // GameScene teardown path can also force-close the overlay defensively (mirrors ShopOverlay.close()).
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

  // Force-close WITHOUT picking (GameScene teardown defensive path only — a normal flow always picks). It
  // does NOT fire onPick (no mutation chosen), so a torn-down-mid-offer overlay leaves the run unchanged.
  close() {
    this._teardown()
  }
}
