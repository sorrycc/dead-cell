import Phaser from 'phaser'
import { DESIGN_WIDTH } from '../config/constants.js'

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
  private levelTimeLabel!: Phaser.GameObjects.Text
  private bossTrack!: Phaser.GameObjects.Rectangle
  private bossFill!: Phaser.GameObjects.Rectangle
  private bossLabel!: Phaser.GameObjects.Text

  constructor() {
    super('HUD')
  }

  create() {
    // ── HP bar (primitives: a track rect + a fill rect we resize each frame). ──
    this.hpTrack = this.add.rectangle(BAR_X, BAR_Y, BAR_W, BAR_H, BAR_BG).setOrigin(0, 0).setScrollFactor(0)
    this.hpFill = this.add.rectangle(BAR_X, BAR_Y, BAR_W, BAR_H, BAR_FILL).setOrigin(0, 0).setScrollFactor(0)
    this.hpLabel = this.add
      .text(BAR_X + BAR_W + 12, BAR_Y, '', { fontFamily: 'monospace', fontSize: '18px', color: '#e6edf3' })
      .setOrigin(0, 0)
      .setScrollFactor(0)

    // ── Depth / biome readout (§6.4, AC45) ── shown under the HP bar so the rising difficulty reads
    // live as the run descends. Reads depth/biomeName from the registry each frame (GameScene writes
    // them). Defaults keep it sane before the first GameScene write.
    this.depthLabel = this.add
      .text(BAR_X, BAR_Y + BAR_H + 8, '', { fontFamily: 'monospace', fontSize: '20px', color: '#f4d03f' })
      .setOrigin(0, 0)
      .setScrollFactor(0)

    // ── Currency counters + equipped weapon (§6.5, AC49/AC54) ── live cells/gold + the weapon name,
    // under the depth readout. Cyan Cells (the meta currency), gold gold (run-only), white weapon. All
    // registry-only (Decision 2). Defaults keep them sane before the first GameScene write.
    this.cellsLabel = this.add
      .text(BAR_X, BAR_Y + BAR_H + 34, '', { fontFamily: 'monospace', fontSize: '18px', color: '#4dd0e1' })
      .setOrigin(0, 0)
      .setScrollFactor(0)
    this.goldLabel = this.add
      .text(BAR_X + 140, BAR_Y + BAR_H + 34, '', { fontFamily: 'monospace', fontSize: '18px', color: '#f1c40f' })
      .setOrigin(0, 0)
      .setScrollFactor(0)
    this.weaponLabel = this.add
      .text(BAR_X, BAR_Y + BAR_H + 58, '', { fontFamily: 'monospace', fontSize: '18px', color: '#e6edf3' })
      .setOrigin(0, 0)
      .setScrollFactor(0)
    // ── Flask readout (§6.9, Decision 72) ── the healing-flask charges (refilled each biome). Green to
    // match the heal FX; shows "FLASK n/max [Q]" so the heal valve + its key are discoverable. Registry-only.
    this.flaskLabel = this.add
      .text(BAR_X, BAR_Y + BAR_H + 82, '', { fontFamily: 'monospace', fontSize: '18px', color: '#2ecc71' })
      .setOrigin(0, 0)
      .setScrollFactor(0)
    // ── Skill loadout (skills slice, AC6) ── two slot labels under the flask line, each "SKILL F: Name" +
    // a [####----] cooldown bar drawn as a text gauge (programmer-art primitive — no extra rects). Orange to
    // match the skill pickup colour. Registry-only (decoupled). Defaults keep them sane before the first write.
    this.skill1Label = this.add
      .text(BAR_X, BAR_Y + BAR_H + 106, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ff9f43' })
      .setOrigin(0, 0)
      .setScrollFactor(0)
    this.skill2Label = this.add
      .text(BAR_X, BAR_Y + BAR_H + 130, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ff9f43' })
      .setOrigin(0, 0)
      .setScrollFactor(0)

    // ── Active MUTATIONS list (build-&-replay slice, AC4) ── under the skill labels, the run's picked
    // mutations as a joined name list (registry-only — decoupled). Green to match the mutation overlay frame.
    // Empty until the first pick (a fresh run shows no line — the additive identity). Defaults keep it sane.
    this.mutationsLabel = this.add
      .text(BAR_X, BAR_Y + BAR_H + 154, '', { fontFamily: 'monospace', fontSize: '17px', color: '#2ecc71' })
      .setOrigin(0, 0)
      .setScrollFactor(0)

    // ── Per-level fast-clear TIMER (build-&-replay slice, AC5) ── top-RIGHT (under the HUD tag) so it reads
    // as a speed-run clock. Shown only on a TIMED level (levelTime > 0 — a normal, non-set-piece level); turns
    // amber as it nears the bonus threshold (so the incentive reads), hidden on a boss/miniboss arena.
    this.levelTimeLabel = this.add
      .text(DESIGN_WIDTH - 16, 40, '', { fontFamily: 'monospace', fontSize: '18px', color: '#2ecc71' })
      .setOrigin(1, 0)
      .setScrollFactor(0)

    // ── Boss HP bar (§6.6, AC56) ── created hidden; update() shows it ONLY while `bossActive` is true
    // (GameScene sets it in the boss room and CLEARS it on death/teardown — review MINOR, so a stale
    // prior-run boss bar never persists). Centered across the top with the boss name above it.
    const bossX = (DESIGN_WIDTH - BOSS_BAR_W) / 2
    this.bossTrack = this.add.rectangle(bossX, BOSS_BAR_Y, BOSS_BAR_W, BOSS_BAR_H, BOSS_BAR_BG).setOrigin(0, 0).setScrollFactor(0).setVisible(false)
    this.bossFill = this.add.rectangle(bossX, BOSS_BAR_Y, BOSS_BAR_W, BOSS_BAR_H, BOSS_BAR_FILL).setOrigin(0, 0).setScrollFactor(0).setVisible(false)
    this.bossLabel = this.add
      .text(DESIGN_WIDTH / 2, BOSS_BAR_Y - 6, '', { fontFamily: 'monospace', fontSize: '20px', color: '#f5b041', fontStyle: 'bold' })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setVisible(false)

    // A small overlay tag (kept from Phase 0) proving the parallel scene draws on top.
    this.add
      .text(DESIGN_WIDTH - 16, 16, 'HUD (overlay)', {
        fontFamily: 'monospace',
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
    this.depthLabel.setText(`DEPTH ${depth} · ${biomeName}`)

    // Currency counters + equipped weapon (§6.5, AC49/AC54) — defaults before the first write.
    const cells = this.registry.get('cells') ?? 0
    const gold = this.registry.get('gold') ?? 0
    const weapon = this.registry.get('weapon') ?? 'Sword'
    this.cellsLabel.setText(`CELLS ${cells}`)
    this.goldLabel.setText(`GOLD ${gold}`)
    this.weaponLabel.setText(`WEAPON ${weapon}`)

    // Flask readout (§6.9, Decision 72) — the heal valve's charges + its key, so the heal is discoverable.
    const flasks = this.registry.get('flasks') ?? 0
    const maxFlasks = this.registry.get('maxFlasks') ?? 0
    this.flaskLabel.setText(`FLASK ${flasks}/${maxFlasks} [Q]`)

    // Skill loadout (skills slice, AC6) — both slots' names + a cooldown gauge per slot. The gauge reads the
    // 0..1 cooldown fraction (1 = just fired, 0 = ready) as a draining bar of filled blocks; an empty slot or
    // a ready filled slot shows the full bar. Decoupled — registry reads only. Defaults keep it sane.
    this._setSkillLabel(this.skill1Label, 'F', this.registry.get('skill1') ?? '—', this.registry.get('skill1Cd') ?? 0)
    this._setSkillLabel(this.skill2Label, 'C', this.registry.get('skill2') ?? '—', this.registry.get('skill2Cd') ?? 0)

    // Active MUTATIONS list (build-&-replay slice, AC4) — the run's picked perks. Empty string → no line shown
    // (a fresh run / a run with no mutation picked). Registry-only (decoupled). Defaults keep it sane.
    const mutations = this.registry.get('mutations') ?? ''
    this.mutationsLabel.setText(mutations ? `MUTATIONS: ${mutations}` : '')

    // Per-level fast-clear TIMER (build-&-replay slice, AC5) — ms elapsed on the current timed level. 0 = an
    // untimed boss/miniboss arena → hide the clock. Turns AMBER in the last quarter of the bonus window (so
    // the speed incentive reads), and grey once the bonus is missed (over the threshold → no longer earnable).
    const levelTime = this.registry.get('levelTime') ?? 0
    const bonusTime = this.registry.get('levelBonusTime') ?? 0
    if (levelTime > 0 && bonusTime > 0) {
      const remaining = Math.max(0, bonusTime - levelTime)
      const secs = (remaining / 1000).toFixed(1)
      if (remaining <= 0) {
        this.levelTimeLabel.setText('CLEAR (no bonus)').setColor('#8b949e')
      } else {
        const nearing = remaining <= bonusTime * 0.25 // last quarter of the window → amber urgency.
        this.levelTimeLabel.setText(`FAST CLEAR ${secs}s`).setColor(nearing ? '#f4d03f' : '#2ecc71')
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
      this.bossLabel.setText(this.registry.get('bossName') || 'BOSS')
    }
  }

  // ── _setSkillLabel(label, key, name, cdFrac) (skills slice, AC6) ── render a skill slot as "SKILL <key>:
  // <name> [####----]" where the bar is a text gauge of `SKILL_BAR_CELLS` blocks: filled (█) for the READY
  // portion (1 − cdFrac), empty (░) for the cooling portion (cdFrac). An empty slot ('—') shows no bar (just
  // "SKILL <key>: —"). Programmer-art primitive — a text gauge, no extra GameObjects (KISS).
  _setSkillLabel(label: Phaser.GameObjects.Text, key: string, name: string, cdFrac: number) {
    if (name === '—' || !name) {
      label.setText(`SKILL ${key}: —`)
      return
    }
    const SKILL_BAR_CELLS = 8
    const filled = Math.round((1 - Phaser.Math.Clamp(cdFrac, 0, 1)) * SKILL_BAR_CELLS)
    const bar = '█'.repeat(filled) + '░'.repeat(SKILL_BAR_CELLS - filled)
    label.setText(`SKILL ${key}: ${name} [${bar}]`)
  }
}
