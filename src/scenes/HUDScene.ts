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
}
