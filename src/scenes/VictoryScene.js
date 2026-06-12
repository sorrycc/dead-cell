import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config/constants.js'

// ── VictoryScene (design §6.6.3, Decision 67, AC58) ──
// The WON-run screen — the gold twin of GameOverScene. GameScene hands off here on the FINAL boss kill
// (_onBossDefeated), passing a run-summary SNAPSHOT as scene-start DATA. DECOUPLED (SOLID, same rule as
// GameOver/HUD): it reads the summary from scene-start data and NEVER reaches into the live GameScene. It
// renders the summary (depth, biome, time, kills, CELLS BANKED) with primitives + text only, then routes
// to the HUB on a key/click so banked Cells are immediately spendable (the loop closes). It does NOT save
// — banking is GameScene's job (the single bankRun writer under the gameOver guard, Decision 67); this
// scene only DISPLAYS the cellsBanked line. (No longer the Phase-0 "VICTORY → Title" stub.)

// Safe defaults so the scene is navigable even if launched bare (e.g. from a dev tool / direct start).
const DEFAULT_SUMMARY = { depthReached: 0, biomeName: '—', timeMs: 0, kills: 0, cellsBanked: 0, completed: true }

// Format milliseconds as m:ss (KISS — runs are minutes-long; no hours). Mirrors GameOverScene.
function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export class VictoryScene extends Phaser.Scene {
  constructor() {
    super('Victory')
  }

  // Phaser passes scene-start DATA to create(); fall back to the safe defaults if absent.
  create(data) {
    const summary = { ...DEFAULT_SUMMARY, ...(data || {}) }
    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2

    // ── Header: a bold green VICTORY (the boss is down — the run is WON). ──
    this.add
      .text(cx, cy - 150, 'VICTORY', { fontFamily: 'monospace', fontSize: '72px', color: '#58d68d', fontStyle: 'bold' })
      .setOrigin(0.5)
    this.add
      .text(cx, cy - 92, 'The Warden falls. The run is yours.', { fontFamily: 'monospace', fontSize: '20px', color: '#a9dfbf' })
      .setOrigin(0.5)

    // ── Summary block (depth / biome / time / kills / cells banked) — a label per stat, aligned. ──
    const rows = [
      ['DEPTH REACHED', `${summary.depthReached}`],
      ['BIOME', `${summary.biomeName}`],
      ['TIME', formatTime(summary.timeMs)],
      ['KILLS', `${summary.kills}`],
      ['CELLS BANKED', `${summary.cellsBanked}`], // §6.6.3 (AC58) — the Cells added to permanent meta.
    ]
    const rowH = 38
    const blockTop = cy - 40
    rows.forEach(([label, value], i) => {
      const y = blockTop + i * rowH
      this.add
        .text(cx - 20, y, label, { fontFamily: 'monospace', fontSize: '24px', color: '#8b949e' })
        .setOrigin(1, 0.5)
      this.add
        .text(cx + 20, y, value, { fontFamily: 'monospace', fontSize: '24px', color: '#e6edf3' })
        .setOrigin(0, 0.5)
    })

    this.add
      .text(cx, blockTop + rows.length * rowH + 40, 'Press SPACE / click → HUB', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    // Victory → HUB (Decision 67) so banked Cells are immediately spendable — the loop closes.
    const toHub = () => this.scene.start('Hub')
    this.input.keyboard.once('keydown-SPACE', toHub)
    this.input.once('pointerdown', toHub)
  }
}
