import Phaser from 'phaser'
import { DESIGN_WIDTH } from '../config/constants.js'

// ── HUDScene (design §6.0 + §6.3 + §6.4, Decision 2, AC23/AC45) ──
// Runs in PARALLEL over GameScene (launched, not started). It is DECOUPLED from gameplay (SOLID):
// it reads player state from the scene REGISTRY (which GameScene writes each frame) and never
// touches the world directly. The Combat phase adds a player HP bar (AC23); the Run-structure phase
// (§6.4) adds a "DEPTH n · <BIOME>" readout so the rising difficulty reads LIVE (AC45) — still
// registry-only (no coupling, Decision 2). GameScene owns this scene's lifecycle and stops it on shutdown.

const BAR_X = 16
const BAR_Y = 16
const BAR_W = 280
const BAR_H = 22
const BAR_BG = 0x2c3e50 // empty/track color.
const BAR_FILL = 0x2ecc71 // healthy fill (green).
const BAR_FILL_LOW = 0xe74c3c // low-HP fill (red) below the threshold.
const LOW_HP_FRAC = 0.3 // fraction below which the bar reads red.

export class HUDScene extends Phaser.Scene {
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
  }
}
