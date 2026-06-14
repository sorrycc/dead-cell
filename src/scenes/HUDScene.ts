import Phaser from 'phaser'
import { DESIGN_WIDTH, UI_FONT } from '../config/constants.js'
import { t } from '../i18n/index.js'
import { COLOR_IDS, COLORS } from '../config/colors.js'
import type { ColorId } from '../config/colors.js'

// ── HUDScene (design §6.0 + §6.3 + §6.4 + §6.5 + §6.6, Decision 2, AC23/AC45/AC49/AC54/AC56) ──
// Runs in PARALLEL over GameScene (launched, not started). It is DECOUPLED from gameplay (SOLID):
// it reads player state from the scene REGISTRY (which GameScene writes each frame) and never
// touches the world directly. The Combat phase adds a player HP bar (AC23); the Run-structure phase
// (§6.4) adds a "DEPTH n · <BIOME>" readout (AC45); the meta-loop phase (§6.5) adds LIVE cells/gold
// counters + the equipped-weapon name (AC49/AC54); the Bosses phase (§6.6) adds a BOSS HP bar shown
// ONLY while a boss lives (AC56) — all still registry-only (no coupling, Decision 2). GameScene owns
// this scene's lifecycle and stops it on shutdown.

const BAR_X = 16
const BAR_Y = 16
const BAR_W = 280
const BAR_H = 22
const BAR_BG = 0x2c3e50 // empty/track color.
const BAR_FILL = 0x2ecc71 // healthy fill (green).
const BAR_FILL_LOW = 0xe74c3c // low-HP fill (red) below the threshold.
const LOW_HP_FRAC = 0.3 // fraction below which the bar reads red.

// ── Boss HP bar (§6.6, AC56) ── a wide bar across the TOP-CENTER, shown ONLY while a boss is active.
const BOSS_BAR_W = 720
const BOSS_BAR_H = 26
const BOSS_BAR_Y = 24
const BOSS_BAR_BG = 0x3b1f2b // dark track.
const BOSS_BAR_FILL = 0x9b59b6 // boss fill (purple — matches the boss colour).

export class HUDScene extends Phaser.Scene {
  private hpTrack!: Phaser.GameObjects.Rectangle
  private hpFill!: Phaser.GameObjects.Rectangle
  private hpLabel!: Phaser.GameObjects.Text
  private depthLabel!: Phaser.GameObjects.Text
  private cellsLabel!: Phaser.GameObjects.Text
  private goldLabel!: Phaser.GameObjects.Text
  private weaponLabel!: Phaser.GameObjects.Text
  private flaskLabel!: Phaser.GameObjects.Text
  private skill1Label!: Phaser.GameObjects.Text
  private skill2Label!: Phaser.GameObjects.Text
  private mutationsLabel!: Phaser.GameObjects.Text
  // cursed-chests §6 (AC8) — ONE danger-coloured line shown ONLY while cursed (curseStacks > 0); the EMPTY
  // string when 0 hides it (the additive identity — the mutations-line idiom). The on-open banner + camera
  // tint give the immediate "you are cursed" tell; this is the persistent counter. Registry-only (decoupled).
  private curseLabel!: Phaser.GameObjects.Text
  // color-scaling-stats §6 (AC10) — three small per-colour pips ("B n · T n · S n"), each its own fixed-x Text
  // so they stay pixel-anchored under the proportional CJK fallback (the Hub/Shop alignment discipline). Each is
  // tinted to its colour; the equipped weapon's colour is highlighted (brighter + bracketed). Registry-only.
  private colorPips!: Phaser.GameObjects.Text[]
  private levelTimeLabel!: Phaser.GameObjects.Text
  private bossTrack!: Phaser.GameObjects.Rectangle
  private bossFill!: Phaser.GameObjects.Rectangle
  private bossLabel!: Phaser.GameObjects.Text
  // ── Off-screen EXIT arrow (F1 onboarding & build UI §6.7, AC8) — a small camera-fixed triangle drawn at the
  // nearest viewport edge pointing toward the Door when it is OFF-camera. Created hidden; update() shows it only
  // when doorActive (a normal level, not a boss room) AND the Door is off-screen. Pure primitive (no asset).
  private doorArrow!: Phaser.GameObjects.Triangle

  constructor() {
    super('HUD')
  }

  create() {
    // ── HP bar (primitives: a track rect + a fill rect we resize each frame). ──
    this.hpTrack = this.add.rectangle(BAR_X, BAR_Y, BAR_W, BAR_H, BAR_BG).setOrigin(0, 0).setScrollFactor(0)
    this.hpFill = this.add.rectangle(BAR_X, BAR_Y, BAR_W, BAR_H, BAR_FILL).setOrigin(0, 0).setScrollFactor(0)
    this.hpLabel = this.add
      .text(BAR_X + BAR_W + 12, BAR_Y, '', { fontFamily: UI_FONT, fontSize: '18px', color: '#e6edf3' })
      .setOrigin(0, 0)
      .setScrollFactor(0)

    // ── Depth / biome readout (§6.4, AC45) ── shown under the HP bar so the rising difficulty reads
    // live as the run descends. Reads depth/biomeName from the registry each frame (GameScene writes
    // them). Defaults keep it sane before the first GameScene write.
    this.depthLabel = this.add
      .text(BAR_X, BAR_Y + BAR_H + 8, '', { fontFamily: UI_FONT, fontSize: '20px', color: '#f4d03f' })
      .setOrigin(0, 0)
      .setScrollFactor(0)

    // ── Currency counters + equipped weapon (§6.5, AC49/AC54) ── live cells/gold + the weapon name,
    // under the depth readout. Cyan Cells (the meta currency), gold gold (run-only), white weapon. All
    // registry-only (Decision 2). Defaults keep them sane before the first GameScene write.
    this.cellsLabel = this.add
      .text(BAR_X, BAR_Y + BAR_H + 34, '', { fontFamily: UI_FONT, fontSize: '18px', color: '#4dd0e1' })
      .setOrigin(0, 0)
      .setScrollFactor(0)
    this.goldLabel = this.add
      .text(BAR_X + 140, BAR_Y + BAR_H + 34, '', { fontFamily: UI_FONT, fontSize: '18px', color: '#f1c40f' })
      .setOrigin(0, 0)
      .setScrollFactor(0)
    this.weaponLabel = this.add
      .text(BAR_X, BAR_Y + BAR_H + 58, '', { fontFamily: UI_FONT, fontSize: '18px', color: '#e6edf3' })
      .setOrigin(0, 0)
      .setScrollFactor(0)
    // ── Flask readout (§6.9, Decision 72) ── the healing-flask charges (refilled each biome). Green to
    // match the heal FX; shows "FLASK n/max [Q]" so the heal valve + its key are discoverable. Registry-only.
    this.flaskLabel = this.add
      .text(BAR_X, BAR_Y + BAR_H + 82, '', { fontFamily: UI_FONT, fontSize: '18px', color: '#2ecc71' })
      .setOrigin(0, 0)
      .setScrollFactor(0)
    // ── Skill loadout (skills slice, AC6) ── two slot labels under the flask line, each "SKILL F: Name" +
    // a [####----] cooldown bar drawn as a text gauge (programmer-art primitive — no extra rects). Orange to
    // match the skill pickup colour. Registry-only (decoupled). Defaults keep them sane before the first write.
    this.skill1Label = this.add
      .text(BAR_X, BAR_Y + BAR_H + 106, '', { fontFamily: UI_FONT, fontSize: '18px', color: '#ff9f43' })
      .setOrigin(0, 0)
      .setScrollFactor(0)
    this.skill2Label = this.add
      .text(BAR_X, BAR_Y + BAR_H + 130, '', { fontFamily: UI_FONT, fontSize: '18px', color: '#ff9f43' })
      .setOrigin(0, 0)
      .setScrollFactor(0)

    // ── Active MUTATIONS list (build-&-replay slice, AC4) ── under the skill labels, the run's picked
    // mutations as a joined name list (registry-only — decoupled). Green to match the mutation overlay frame.
    // Empty until the first pick (a fresh run shows no line — the additive identity). Defaults keep it sane.
    this.mutationsLabel = this.add
      .text(BAR_X, BAR_Y + BAR_H + 154, '', { fontFamily: UI_FONT, fontSize: '17px', color: '#2ecc71' })
      .setOrigin(0, 0)
      .setScrollFactor(0)

    // ── Colour-scaling pips (color-scaling-stats §6, AC10) ── three fixed-x per-colour Texts ("B n · T n · S n")
    // under the mutations line, each tinted to its colour (red/purple/green). Pixel-anchored (each its own x) so
    // they align under the proportional CJK fallback. update() fills the levels + highlights the equipped colour.
    const COLOR_PIP_Y = BAR_Y + BAR_H + 178
    const COLOR_PIP_DX = 64 // px between pip columns (fixed cells — alignment-safe under CJK).
    this.colorPips = COLOR_IDS.map((id, i) =>
      this.add
        .text(BAR_X + i * COLOR_PIP_DX, COLOR_PIP_Y, '', { fontFamily: UI_FONT, fontSize: '17px', color: '#' + COLORS[id].tint.toString(16).padStart(6, '0') })
        .setOrigin(0, 0)
        .setScrollFactor(0),
    )

    // ── Cursed-chest CURSE line (cursed-chests §6, AC8) ── under the colour pips, a single danger-red line
    // shown ONLY while cursed (curseStacks > 0); empty string at 0 hides it (the additive identity, the
    // mutations-line idiom). Pixel-anchored single Text — no column-alignment work. Registry-only (decoupled).
    this.curseLabel = this.add
      .text(BAR_X, BAR_Y + BAR_H + 202, '', { fontFamily: UI_FONT, fontSize: '18px', color: '#e74c3c', fontStyle: 'bold' })
      .setOrigin(0, 0)
      .setScrollFactor(0)

    // ── Per-level fast-clear TIMER (build-&-replay slice, AC5) ── top-RIGHT (under the HUD tag) so it reads
    // as a speed-run clock. Shown only on a TIMED level (levelTime > 0 — a normal, non-set-piece level); turns
    // amber as it nears the bonus threshold (so the incentive reads), hidden on a boss/miniboss arena.
    this.levelTimeLabel = this.add
      .text(DESIGN_WIDTH - 16, 40, '', { fontFamily: UI_FONT, fontSize: '18px', color: '#2ecc71' })
      .setOrigin(1, 0)
      .setScrollFactor(0)

    // ── Boss HP bar (§6.6, AC56) ── created hidden; update() shows it ONLY while `bossActive` is true
    // (GameScene sets it in the boss room and CLEARS it on death/teardown — review MINOR, so a stale
    // prior-run boss bar never persists). Centered across the top with the boss name above it.
    const bossX = (DESIGN_WIDTH - BOSS_BAR_W) / 2
    this.bossTrack = this.add.rectangle(bossX, BOSS_BAR_Y, BOSS_BAR_W, BOSS_BAR_H, BOSS_BAR_BG).setOrigin(0, 0).setScrollFactor(0).setVisible(false)
    this.bossFill = this.add.rectangle(bossX, BOSS_BAR_Y, BOSS_BAR_W, BOSS_BAR_H, BOSS_BAR_FILL).setOrigin(0, 0).setScrollFactor(0).setVisible(false)
    this.bossLabel = this.add
      .text(DESIGN_WIDTH / 2, BOSS_BAR_Y - 6, '', { fontFamily: UI_FONT, fontSize: '20px', color: '#f5b041', fontStyle: 'bold' })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setVisible(false)

    // ── Off-screen EXIT arrow (F1 onboarding & build UI §6.7, AC8) ── a small triangle (created pointing RIGHT,
    // then ROTATED toward the Door each frame) at the nearest viewport edge when the Door is off-camera. Yellow
    // to match the exit Door's colour cue. Created hidden; update() positions/rotates/shows it. Pure primitive.
    this.doorArrow = this.add
      .triangle(0, 0, 0, -11, 22, 0, 0, 11, 0xfbd000)
      .setScrollFactor(0)
      .setDepth(50)
      .setVisible(false)

    // A small overlay tag (kept from Phase 0) proving the parallel scene draws on top.
    this.add
      .text(DESIGN_WIDTH - 16, 16, t('hud.tag'), {
        fontFamily: UI_FONT,
        fontSize: '16px',
        color: '#fbd000',
      })
      .setOrigin(1, 0)
  }

  // Read HP + depth/biome from the registry each frame (GameScene writes them). Decoupled — the HUD
  // never reaches into the GameScene (Decision 2). Defaults keep it sane before the first write.
  update() {
    const hp = this.registry.get('playerHp')
    const maxHp = this.registry.get('playerMaxHp')
    if (hp == null || maxHp == null || !this.hpFill) return
    const frac = Phaser.Math.Clamp(hp / maxHp, 0, 1)
    this.hpFill.width = BAR_W * frac
    this.hpFill.setFillStyle(frac <= LOW_HP_FRAC ? BAR_FILL_LOW : BAR_FILL)
    this.hpLabel.setText(`${Math.ceil(hp)} / ${maxHp}`)

    // Depth / biome readout (§6.4, AC45) — defaults if GameScene hasn't written yet.
    const depth = this.registry.get('depth') ?? 0
    const biomeName = this.registry.get('biomeName') ?? '—'
    this.depthLabel.setText(t('hud.depth', { depth, biome: biomeName }))

    // Currency counters + equipped weapon (§6.5, AC49/AC54) — defaults before the first write.
    const cells = this.registry.get('cells') ?? 0
    const gold = this.registry.get('gold') ?? 0
    const weapon = this.registry.get('weapon') ?? 'Sword' // GameScene seeds the (translated) name in create().
    this.cellsLabel.setText(t('hud.cells', { n: cells }))
    this.goldLabel.setText(t('hud.gold', { n: gold }))
    this.weaponLabel.setText(t('hud.weapon', { weapon }))

    // Flask readout (§6.9, Decision 72) — the heal valve's charges + its key, so the heal is discoverable.
    const flasks = this.registry.get('flasks') ?? 0
    const maxFlasks = this.registry.get('maxFlasks') ?? 0
    this.flaskLabel.setText(t('hud.flask', { n: flasks, max: maxFlasks }))

    // Skill loadout (skills slice, AC6) — both slots' names + a cooldown gauge per slot. The gauge reads the
    // 0..1 cooldown fraction (1 = just fired, 0 = ready) as a draining bar of filled blocks; an empty slot or
    // a ready filled slot shows the full bar. Decoupled — registry reads only. Defaults keep it sane.
    this._setSkillLabel(this.skill1Label, 'F', this.registry.get('skill1') ?? '—', this.registry.get('skill1Cd') ?? 0)
    this._setSkillLabel(this.skill2Label, 'C', this.registry.get('skill2') ?? '—', this.registry.get('skill2Cd') ?? 0)

    // Active MUTATIONS list (build-&-replay slice, AC4) — the run's picked perks. Empty string → no line shown
    // (a fresh run / a run with no mutation picked). Registry-only (decoupled). Defaults keep it sane.
    const mutations = this.registry.get('mutations') ?? ''
    this.mutationsLabel.setText(mutations ? t('hud.mutations', { list: mutations }) : '')

    // ── Cursed-chest CURSE line (cursed-chests §6, AC8) ── "CURSED — n kills left" while cursed (> 0), the
    // EMPTY string when 0 (hidden — the additive identity for an uncursed run). Registry-only (decoupled).
    const curseStacks = this.registry.get('curseStacks') ?? 0
    this.curseLabel.setText(curseStacks > 0 ? t('hud.curse', { n: curseStacks }) : '')

    // ── Colour-scaling pips (color-scaling-stats §6, AC10) ── per-colour "Name n" tinted to its colour; the
    // equipped weapon's colour is HIGHLIGHTED (bracketed + white) so the active build colour reads. Defaults to
    // 0 (a fresh run shows "Brutality 0", etc. — the identity). Registry-only (decoupled).
    const equippedColor = (this.registry.get('equippedColor') ?? 'brutality') as ColorId
    const levels: Record<ColorId, number> = {
      brutality: this.registry.get('brutalityLevel') ?? 0,
      tactics: this.registry.get('tacticsLevel') ?? 0,
      survival: this.registry.get('survivalLevel') ?? 0,
    }
    for (let i = 0; i < COLOR_IDS.length; i++) {
      const id = COLOR_IDS[i]
      const letter = t(`color.${id}`).charAt(0) // first char of the localized name (B/T/S · 残/战/生) — a small pip.
      const n = levels[id]
      const equipped = id === equippedColor
      // The equipped colour: bracketed + white (the highlight); the rest: its tint. Short "X n" keeps the pip small.
      this.colorPips[i].setText(equipped ? `[${letter} ${n}]` : `${letter} ${n}`)
      this.colorPips[i].setColor(equipped ? '#ffffff' : '#' + COLORS[id].tint.toString(16).padStart(6, '0'))
    }

    // Per-level fast-clear TIMER (build-&-replay slice, AC5) — ms elapsed on the current timed level. 0 = an
    // untimed boss/miniboss arena → hide the clock. Turns AMBER in the last quarter of the bonus window (so
    // the speed incentive reads), and grey once the bonus is missed (over the threshold → no longer earnable).
    const levelTime = this.registry.get('levelTime') ?? 0
    const bonusTime = this.registry.get('levelBonusTime') ?? 0
    if (levelTime > 0 && bonusTime > 0) {
      const remaining = Math.max(0, bonusTime - levelTime)
      const secs = (remaining / 1000).toFixed(1)
      if (remaining <= 0) {
        this.levelTimeLabel.setText(t('hud.timerNoBonus')).setColor('#8b949e')
      } else {
        const nearing = remaining <= bonusTime * 0.25 // last quarter of the window → amber urgency.
        this.levelTimeLabel.setText(t('hud.timerFast', { secs })).setColor(nearing ? '#f4d03f' : '#2ecc71')
      }
    } else {
      this.levelTimeLabel.setText('')
    }

    // ── Boss HP bar (§6.6, AC56) ── shown ONLY while `bossActive` is true (GameScene sets it in the
    // boss room and CLEARS it on death/teardown). When inactive the bar is hidden, so a stale prior-run
    // value never shows (review MINOR — the registry survives scene restarts).
    const bossActive = this.registry.get('bossActive') === true
    const bossHp = this.registry.get('bossHp')
    const bossMaxHp = this.registry.get('bossMaxHp')
    const showBoss = bossActive && bossHp != null && bossMaxHp != null && this.bossFill
    this.bossTrack.setVisible(showBoss as boolean)
    this.bossFill.setVisible(showBoss as boolean)
    this.bossLabel.setVisible(showBoss as boolean)
    if (showBoss) {
      const bfrac = Phaser.Math.Clamp(bossHp / bossMaxHp, 0, 1)
      this.bossFill.width = BOSS_BAR_W * bfrac
      this.bossLabel.setText(this.registry.get('bossName') || t('hud.boss'))
    }

    this._updateDoorArrow()
  }

  // ── _updateDoorArrow() (F1 onboarding & build UI §6.7, AC8) ── show a small edge arrow pointing toward the
  // exit Door when it is OFF-camera; hide it when the Door is on-screen and in boss rooms (no Door). Decoupled
  // (registry-only): GameScene publishes doorActive + the Door world center (doorX/doorY) + the main camera
  // scroll (camScrollX/camScrollY) each frame; the HUD's own camera width/height equal the design size under
  // Scale.FIT, so the screen-space math needs no GameScene coupling (invariant 7).
  _updateDoorArrow() {
    if (!this.doorArrow) return
    const doorActive = this.registry.get('doorActive') === true
    if (!doorActive) {
      this.doorArrow.setVisible(false)
      return
    }
    const doorX = this.registry.get('doorX') ?? 0
    const doorY = this.registry.get('doorY') ?? 0
    const scrollX = this.registry.get('camScrollX') ?? 0
    const scrollY = this.registry.get('camScrollY') ?? 0
    const W = this.cameras.main.width
    const H = this.cameras.main.height
    // The Door's position in SCREEN space (the world point minus the camera scroll — no zoom; the camera runs at 1×).
    const sx = doorX - scrollX
    const sy = doorY - scrollY
    if (sx >= 0 && sx <= W && sy >= 0 && sy <= H) {
      this.doorArrow.setVisible(false) // on-screen → no arrow needed.
      return
    }
    // Off-screen: clamp the door's screen point to the viewport edge (with an inset) + point the arrow at it from
    // the viewport CENTER. The angle is along (door − center) so the arrow tracks the true bearing to the exit.
    const INSET = 28
    const cxv = W / 2
    const cyv = H / 2
    this.doorArrow.setRotation(Math.atan2(sy - cyv, sx - cxv))
    this.doorArrow.setPosition(Phaser.Math.Clamp(sx, INSET, W - INSET), Phaser.Math.Clamp(sy, INSET, H - INSET))
    this.doorArrow.setVisible(true)
  }

  // ── _setSkillLabel(label, key, name, cdFrac) (skills slice, AC6) ── render a skill slot as "SKILL <key>:
  // <name> [####----]" where the bar is a text gauge of `SKILL_BAR_CELLS` blocks: filled (█) for the READY
  // portion (1 − cdFrac), empty (░) for the cooling portion (cdFrac). An empty slot ('—') shows no bar (just
  // "SKILL <key>: —"). Programmer-art primitive — a text gauge, no extra GameObjects (KISS).
  _setSkillLabel(label: Phaser.GameObjects.Text, key: string, name: string, cdFrac: number) {
    if (name === '—' || !name) {
      label.setText(t('hud.skillEmpty', { key }))
      return
    }
    const SKILL_BAR_CELLS = 8
    const filled = Math.round((1 - Phaser.Math.Clamp(cdFrac, 0, 1)) * SKILL_BAR_CELLS)
    const bar = '█'.repeat(filled) + '░'.repeat(SKILL_BAR_CELLS - filled)
    label.setText(t('hud.skill', { key, name, bar }))
  }
}
