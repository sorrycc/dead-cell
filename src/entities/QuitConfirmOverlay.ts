import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'
import { t } from '../i18n/index.js'

interface QuitConfirmOverlayOpts {
  onQuit(): void // chose QUIT — GameScene does scene.start('Title') (the in-progress run is discarded).
  onCancel(): void // chose RESUME (or pressed ESC) — GameScene un-freezes gameplay + resumes the timer.
}

interface QuitConfirmOverlayHandlers {
  up: () => void
  down: () => void
  confirm: () => void
}

// ── QuitConfirmOverlay — the in-gameplay "return to main screen" CONFIRM modal (esc-quit-confirm design) ──
// A trimmed sibling of MutationOverlay/ShopOverlay (DRY with the proven choice-overlay idiom): a camera-FIXED
// modal drawn ON TOP of the (frozen) GameScene — primitives + text only (the mandated art constraint). It is
// NOT a separate Scene (a parallel Scene would need its own input plumbing + a pause handshake); instead it is
// a self-contained UI object GameScene news up on _openQuitConfirm() and destroys on choose, while GameScene
// FREEZES gameplay via its `quitConfirmOpen` flag (the SAME update() gate the shop/mutation overlays use). KISS
// + decoupled (SOLID): the overlay knows NOTHING about RunState/scene transitions — it is handed onQuit + onCancel
// callbacks, so the quit (scene.start('Title')) + the un-freeze/resume logic stay in ONE place (the scene).
//
// TWO ROWS, COLOURED BY MEANING (NOT by selection): row 0 = RESUME (always green — the safe default the cursor
// starts on), row 1 = QUIT (always red — destructive). _render ONLY moves the neutral highlight BAR behind the
// selected row; it never tints the row text, so the safe default never reads red (the inversion MutationOverlay's
// select-colours-the-name idiom would cause here). Hammering confirm therefore RESUMES, never quits — quitting
// needs a deliberate DOWN-to-QUIT + confirm (the "explicit affirmative" AC).
//
// INPUT OWNERSHIP (review — the JustDown footgun, mirrored from ShopOverlay/MutationOverlay): the Input class owns
// JustDown for SPACE/E/etc. This overlay uses its OWN scene.input.keyboard.on('keydown-…') handlers (added on open,
// removed on choose) — the Phaser event bus is SEPARATE from the JustDown flag Input reads, so the two never fight.
// It deliberately does NOT bind ESC: GameScene owns a persistent .on('keydown-ESC') that toggles this prompt (open
// when closed, CANCEL when open), so binding ESC here would double-handle it. On a RESUME, GameScene swallows the
// pending SPACE/E edge (consumeJump/consumeInteract) so no jump/shop-reopen leaks onto the un-frozen frame.

const PANEL_W = 480
const PANEL_H = 240
const ROW_H = 56
const ROW_TOP_OFFSET = 116 // px below the panel top where the first (RESUME) row sits.
const CURSOR_COLOR = 0x2c3e50 // a neutral dark-slate highlight bar (same as ShopOverlay) — NOT a semantic colour.
const PANEL_COLOR = 0x10141c
const PANEL_STROKE = 0xe06c75 // a quit-red frame (distinct from shop-purple / mutation-green — destructive intent).
const RESUME_COLOR = '#58d68d' // green — the safe row (matches the Title start prompt's go-colour).
const QUIT_COLOR = '#e06c75' // red — the destructive row.

export class QuitConfirmOverlay {
  private scene: Phaser.Scene
  private _onQuit: () => void
  private _onCancel: () => void
  private cursor: number // 0 = RESUME (safe default), 1 = QUIT.
  private _destroyed: boolean
  private dim!: Phaser.GameObjects.Rectangle
  private panel!: Phaser.GameObjects.Rectangle
  private title!: Phaser.GameObjects.Text
  private subtitle!: Phaser.GameObjects.Text
  private cursorBar!: Phaser.GameObjects.Rectangle
  private _rowBaseY!: number
  private rowTexts!: Phaser.GameObjects.Text[]
  private help!: Phaser.GameObjects.Text
  private _handlers!: QuitConfirmOverlayHandlers

  // scene: GameScene. opts: { onQuit(), onCancel() }. onQuit quits to Title (run discarded); onCancel tears the
  // overlay down + resumes gameplay (GameScene owns the quitConfirmOpen flag + the edge-consume on resume).
  constructor(scene: Phaser.Scene, { onQuit, onCancel }: QuitConfirmOverlayOpts) {
    this.scene = scene
    this._onQuit = onQuit
    this._onCancel = onCancel
    this.cursor = 0 // start on RESUME — the SAFE default, so a stray confirm resumes rather than quits.
    this._destroyed = false

    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2
    const panelTop = cy - PANEL_H / 2
    const DEPTH = 200 // above everything in the world (same depth band the shop/mutation overlays use).

    // A dimming backdrop over the whole frozen scene (camera-fixed) so the overlay reads as a modal.
    this.dim = scene.add
      .rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH)

    // The panel + a quit-red frame.
    this.panel = scene.add
      .rectangle(cx, cy, PANEL_W, PANEL_H, PANEL_COLOR, 0.96)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1)
    this.panel.setStrokeStyle(3, PANEL_STROKE, 0.9)

    this.title = scene.add
      .text(cx, panelTop + 30, t('quit.title'), { fontFamily: UI_FONT, fontSize: '30px', color: '#e6edf3', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
    this.subtitle = scene.add
      .text(cx, panelTop + 66, t('quit.subtitle'), {
        fontFamily: UI_FONT,
        fontSize: '16px',
        color: '#8b949e',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)

    // The cursor highlight bar (moved behind the selected row in _render).
    this.cursorBar = scene.add
      .rectangle(cx, 0, PANEL_W - 48, ROW_H - 12, CURSOR_COLOR)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1.5)

    // The two rows: RESUME (green) then QUIT (red) — colours fixed by MEANING, not by selection (see header).
    this._rowBaseY = panelTop + ROW_TOP_OFFSET
    const labels = [t('quit.resume'), t('quit.confirm')]
    const colors = [RESUME_COLOR, QUIT_COLOR]
    this.rowTexts = []
    for (let i = 0; i < labels.length; i++) {
      const rowT = scene.add
        .text(cx, this._rowBaseY + i * ROW_H, labels[i], { fontFamily: UI_FONT, fontSize: '24px', color: colors[i], fontStyle: 'bold' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH + 2)
      this.rowTexts.push(rowT)
    }

    this.help = scene.add
      .text(cx, panelTop + PANEL_H - 22, t('quit.help'), {
        fontFamily: UI_FONT,
        fontSize: '15px',
        color: '#8b949e',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)

    // ── Dedicated keyboard handlers (removed on choose) — the overlay's own bus, separate from Input's JustDown
    // reads (the same idiom + the same ESC-avoidance the shop/mutation overlays use — see header). ──
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
    this.cursor = Phaser.Math.Clamp(this.cursor + dir, 0, this.rowTexts.length - 1)
    this._render()
  }

  // Confirm the selected row. We close FIRST (tear down GameObjects + handlers) so a second confirm keypress
  // can't double-fire, THEN route to the chosen callback: row 0 → RESUME (onCancel), row 1 → QUIT (onQuit).
  _confirm() {
    if (this._destroyed) return
    const quitting = this.cursor === 1
    this._teardown()
    if (quitting) this._onQuit()
    else this._onCancel()
  }

  // Move the neutral highlight bar behind the selected row. Row TEXT colours are fixed (green/red) and never
  // change — so the safe RESUME default never reads as the destructive red (the whole point of Decision 7).
  _render() {
    if (this._destroyed) return
    this.cursorBar.y = this._rowBaseY + this.cursor * ROW_H
  }

  // Tear down all GameObjects + remove the keyboard handlers (idempotent). Split from _confirm so GameScene's
  // ESC-cancel + SHUTDOWN paths can also force-close the overlay (mirrors MutationOverlay/ShopOverlay).
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
    for (const o of [this.dim, this.panel, this.title, this.subtitle, this.cursorBar, this.help, ...this.rowTexts]) {
      if (o && o.active) o.destroy()
    }
  }

  // Force-close WITHOUT choosing (GameScene's ESC-cancel + defensive SHUTDOWN paths). It does NOT fire a
  // callback — GameScene drives the un-freeze itself on those paths. Idempotent via the _destroyed guard.
  close() {
    this._teardown()
  }
}
