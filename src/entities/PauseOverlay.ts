import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'
import { COLOR_IDS, COLORS } from '../config/colors.js'
import type { ColorId } from '../config/colors.js'
import { t, CONTROLS_ROWS } from '../i18n/index.js'

// ── BuildSnapshot (F1 onboarding & build UI §6.3) ── a plain, already-i18n-resolved view of the live build,
// assembled by GameScene._getBuildSnapshot() and handed to the overlay via getBuild(). The overlay knows
// NOTHING about RunState/Player (SOLID/decoupled — the ShopOverlay.getGold idiom): GameScene owns the build
// logic + all tName resolution; the overlay only formats + lays out. The world is FROZEN while paused, so this
// is read ONCE on open (the build cannot change while paused — KISS, no per-frame re-read).
export interface BuildSnapshot {
  weapon: string // GameScene._weaponLabel() — active weapon + affix + rarity + bracketed 2nd slot.
  skill1: string // GameScene._skillLabel(0) — name or '—'.
  skill2: string // GameScene._skillLabel(1).
  skill1Cd: number // GameScene._skillCooldownFrac(0) — 0..1 (0 = ready).
  skill2Cd: number // GameScene._skillCooldownFrac(1).
  mutations: string // joined mutation names (already i18n-resolved) or '' (→ a localized "none").
  brutality: number
  tactics: number
  survival: number
  equippedColor: ColorId // this.player.equippedWeapon.scaling — the highlighted (active) build colour.
  flasks: number
  maxFlasks: number
  depth: number
  biome: string // already i18n-resolved biome name.
  runSeed: number // the shareable run id (hex-formatted in the overlay).
}

interface PauseOverlayOpts {
  getBuild(): BuildSnapshot // GameScene → a plain snapshot (read once on open; the world is frozen).
  onClose(): void // GameScene → _closePause() (unfreeze + resume timer + consume the pending P edge).
}

// ── PauseOverlay — the read-only PAUSE / BUILD modal (F1 onboarding & build UI §6.2, Decision 1/4) ──
// A camera-FIXED modal drawn ON TOP of the (frozen) GameScene — primitives + text only (the mandated art
// constraint), a read-only SIBLING of QuitConfirmOverlay/ShopOverlay (DRY with the proven frozen-modal idiom).
// It is NOT a separate Scene (a parallel Scene would need its own input plumbing + a pause handshake); instead
// it is a self-contained UI object GameScene news up on _openPause() and destroys on _closePause(), while
// GameScene FREEZES gameplay via its `pauseOpen` flag (the SAME update() gate the shop/mutation/quit overlays
// use) and pauses the fast-clear timer. KISS + decoupled (SOLID): the overlay knows NOTHING about RunState/
// Player — it is handed ONE getBuild() reader (a plain snapshot) + an onClose() callback, so the build logic
// + the unfreeze/resume logic stay in ONE place (the scene), exactly like ShopOverlay.getGold.
//
// READ-ONLY (Decision 4): there is nothing to select or confirm — it is an INFORMATION panel. No cursor bar,
// no UP/DOWN, no confirm rows. It binds ONLY keydown-P and keydown-ESC → onClose (NOTHING else: no SPACE/E/
// ENTER), so no jump/interact/buy edge can leak onto the resume frame (Decision 9).
//
// INPUT OWNERSHIP (review — the JustDown footgun, mirrored from QuitConfirmOverlay): Input owns JustDown for
// P/SPACE/E/etc. This overlay uses its OWN scene.input.keyboard.on('keydown-…') handlers (added in the ctor,
// removed in _teardown) — the Phaser event bus is SEPARATE from the JustDown flag Input reads. BUT both fire on
// the SAME physical close-press in the SAME frame (Phaser dispatches keyboard events before scene.update), so
// the keydown-P close + Input's JustDown(p) would race: the close-press would re-open pause on the next sample().
// GameScene._closePause() calls input2.consumePause() to swallow the pending P edge (the close→reopen race fix,
// matching the shop/quit resume paths). ESC-close: GameScene._toggleQuitConfirm guards on pauseOpen so the same
// ESC press only closes pause (it cannot also pop the quit confirm).

const PANEL_W = 720
const PANEL_H = 540
const COL_KEY_DX = 240 // px from each section's left edge to the keys column (two fixed-x cells per row — CJK-safe).
const PANEL_COLOR = 0x10141c
const PANEL_STROKE = 0x5c6b7a // a neutral SLATE frame — distinct from shop-purple / mutation-green / quit-red (Decision 10).

export class PauseOverlay {
  private scene: Phaser.Scene
  private _getBuild: () => BuildSnapshot
  private _onClose: () => void
  private _destroyed: boolean
  private _objs: Phaser.GameObjects.GameObject[]
  private _handlers!: { close: () => void }

  // scene: GameScene. opts: { getBuild(), onClose() }. getBuild() returns the live build snapshot (read once);
  // onClose() tears the overlay down + resumes gameplay (GameScene owns the pauseOpen flag + the edge-consume).
  constructor(scene: Phaser.Scene, { getBuild, onClose }: PauseOverlayOpts) {
    this.scene = scene
    this._getBuild = getBuild
    this._onClose = onClose
    this._destroyed = false
    this._objs = []

    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2
    const panelLeft = cx - PANEL_W / 2
    const panelTop = cy - PANEL_H / 2
    const DEPTH = 200 // above everything in the world (the same depth band the shop/mutation/quit overlays use).

    // A dimming backdrop over the whole frozen scene (camera-fixed) so the overlay reads as a modal.
    this._add(
      scene.add
        .rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, 0x000000, 0.6)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(DEPTH),
    )

    // The panel + a neutral slate frame.
    const panel = scene.add
      .rectangle(cx, cy, PANEL_W, PANEL_H, PANEL_COLOR, 0.96)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1)
    panel.setStrokeStyle(3, PANEL_STROKE, 0.9)
    this._add(panel)

    // Title + a resume hint.
    this._text(cx, panelTop + 26, t('pause.title'), { fontSize: '30px', color: '#e6edf3', fontStyle: 'bold' }, DEPTH + 2).setOrigin(0.5)
    this._text(cx, panelTop + PANEL_H - 20, t('pause.help'), { fontSize: '15px', color: '#8b949e' }, DEPTH + 2).setOrigin(0.5)

    // ── Two side-by-side sections: BUILD (left) and CONTROLS (right). Each row is two fixed-x Text cells
    // (label | value), the CJK-safe column discipline (Decision 7) — never padEnd. ──
    const sectionTop = panelTop + 70
    const leftX = panelLeft + 36
    const rightX = cx + 24
    this._renderBuild(leftX, sectionTop, DEPTH + 2)
    this._renderControls(rightX, sectionTop, DEPTH + 2)

    // ── Dedicated CLOSE handlers (removed in _teardown) — the overlay's own bus, separate from Input's JustDown
    // reads. It binds ONLY P and ESC (no SPACE/E/ENTER), so no gameplay edge leaks on resume (Decision 9). The P
    // edge that races this close is swallowed by GameScene._closePause → consumePause; ESC-close cannot pop the
    // quit confirm because GameScene._toggleQuitConfirm guards on pauseOpen. ──
    this._handlers = { close: () => this._close() }
    const kb = scene.input.keyboard!
    kb.on('keydown-P', this._handlers.close)
    kb.on('keydown-ESC', this._handlers.close)
  }

  // ── BUILD section (Decision 5/10) — labelled lines reusing the HUD's semantic colours so the panel reads
  // consistently (cyan-ish weapon, orange skills, green flask, gold seed, colour-tinted pips). ──
  private _renderBuild(x: number, top: number, depth: number) {
    const b = this._getBuild()
    const ROW = 30
    let y = top
    this._text(x, y, t('pause.buildHeader'), { fontSize: '20px', color: '#5c6b7a', fontStyle: 'bold' }, depth)
    y += ROW + 6

    // Weapon.
    this._label(x, y, t('pause.weapon'), b.weapon, '#e6edf3', depth)
    y += ROW

    // Skills (each: name + READY/… derived from the cooldown fraction).
    this._label(x, y, t('pause.skills'), this._skillText(b.skill1, b.skill1Cd), '#ff9f43', depth)
    y += ROW
    this._label(x, y, '', this._skillText(b.skill2, b.skill2Cd), '#ff9f43', depth)
    y += ROW

    // Mutations (joined list or a localized "none").
    this._label(x, y, t('pause.mutations'), b.mutations || t('pause.none'), '#2ecc71', depth)
    y += ROW

    // Colours (three pips; the equipped colour bracketed + white — the HUD idiom).
    this._label(x, y, t('pause.colors'), '', '#e6edf3', depth)
    const levels: Record<ColorId, number> = { brutality: b.brutality, tactics: b.tactics, survival: b.survival }
    const PIP_DX = 78
    for (let i = 0; i < COLOR_IDS.length; i++) {
      const id = COLOR_IDS[i]
      const letter = t(`color.${id}`).charAt(0)
      const equipped = id === b.equippedColor
      const pip = this._text(x + COL_KEY_DX + i * PIP_DX, y, equipped ? `[${letter} ${levels[id]}]` : `${letter} ${levels[id]}`, {
        fontSize: '17px',
        color: equipped ? '#ffffff' : '#' + COLORS[id].tint.toString(16).padStart(6, '0'),
      }, depth)
      pip.setOrigin(0, 0)
    }
    y += ROW

    // Flask n/max.
    this._label(x, y, t('pause.flask'), `${b.flasks}/${b.maxFlasks}`, '#2ecc71', depth)
    y += ROW

    // Depth · biome.
    this._label(x, y, t('pause.depth'), `${b.depth} · ${b.biome}`, '#f4d03f', depth)
    y += ROW

    // Run seed (hex — the shareable run id).
    this._label(x, y, t('pause.seed'), '0x' + (b.runSeed >>> 0).toString(16), '#4dd0e1', depth)
  }

  // ── CONTROLS section (Decision 6) — the shared CONTROLS_ROWS as two fixed-x columns per row (action | keys). ──
  private _renderControls(x: number, top: number, depth: number) {
    const ROW = 30
    let y = top
    this._text(x, y, t('controls.title'), { fontSize: '20px', color: '#5c6b7a', fontStyle: 'bold' }, depth)
    y += ROW + 6
    for (const [actionKey, keysKey] of CONTROLS_ROWS) {
      this._label(x, y, t(actionKey), t(keysKey), '#c9d1d9', depth)
      y += ROW
    }
  }

  // A two-cell row: a muted label (left) + a coloured value (right), each its own fixed-x Text (CJK-safe).
  private _label(x: number, y: number, label: string, value: string, valueColor: string, depth: number) {
    if (label) this._text(x, y, label, { fontSize: '17px', color: '#8b949e' }, depth)
    if (value) this._text(x + COL_KEY_DX, y, value, { fontSize: '17px', color: valueColor }, depth)
  }

  // A skill cell: "Name (READY)" / "Name (…)" off the cooldown fraction, or just '—' for an empty slot.
  private _skillText(name: string, cd: number): string {
    if (!name || name === '—') return '—'
    const ready = cd <= 0
    return `${name} (${ready ? t('pause.skillReady') : t('pause.skillCooling')})`
  }

  private _text(x: number, y: number, str: string, style: Phaser.Types.GameObjects.Text.TextStyle, depth: number): Phaser.GameObjects.Text {
    const txt = this.scene.add
      .text(x, y, str, { fontFamily: UI_FONT, ...style })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(depth)
    this._objs.push(txt)
    return txt
  }

  private _add(obj: Phaser.GameObjects.GameObject) {
    this._objs.push(obj)
  }

  // Close via the overlay's own P/ESC handler: tear down FIRST (so a second keypress can't double-fire), THEN
  // route to onClose() (GameScene._closePause — unfreeze + resume timer + consumePause for the pending P edge).
  private _close() {
    if (this._destroyed) return
    this._teardown()
    this._onClose()
  }

  // Tear down all GameObjects + remove the keyboard handlers (idempotent via the _destroyed guard). Split from
  // _close so GameScene's SHUTDOWN/rebuild paths can also force-close the overlay (mirrors QuitConfirmOverlay).
  private _teardown() {
    if (this._destroyed) return
    this._destroyed = true
    const kb = this.scene.input.keyboard!
    kb.off('keydown-P', this._handlers.close)
    kb.off('keydown-ESC', this._handlers.close)
    for (const o of this._objs) {
      if (o && o.active) o.destroy()
    }
    this._objs = []
  }

  // Force-close WITHOUT firing onClose (GameScene's _closePause + defensive SHUTDOWN paths). GameScene drives the
  // unfreeze itself on those paths. Idempotent via the _destroyed guard (mirrors QuitConfirmOverlay.close()).
  close() {
    this._teardown()
  }
}
