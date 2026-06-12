import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config/constants.js'

// ── GameOverScene (design §6.4 + §6.5, Decision 47/48/59, AC46/AC47/AC51/AC52) ──
// The run-end screen. GameScene hands off here on player death (completed:false → red "GAME OVER")
// OR on clearing the last biome's Door (completed:true → gold "RUN COMPLETE"), passing a run-summary
// SNAPSHOT as scene-start DATA. This scene is DECOUPLED (SOLID, same rule as the HUD/registry split):
// it reads the summary from scene-start data and NEVER reaches into the live GameScene. It renders the
// summary (depth, biome, time, kills, CELLS BANKED) with primitives + text only, then routes to the
// HUB on a key/click (§6.5, Decision 59 — banked Cells are immediately spendable; the loop closes).
// It does NOT itself save — banking is GameScene's job (the single writer under the gameOver guard);
// this scene only DISPLAYS the cellsBanked line from the summary.

// Safe defaults so the scene is navigable even if launched bare (e.g. from a dev tool / direct start).
const DEFAULT_SUMMARY = { depthReached: 0, biomeName: '—', timeMs: 0, kills: 0, cellsBanked: 0, completed: false }

// Format milliseconds as m:ss (KISS — runs are minutes-long; no hours).
function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOver')
  }

  // Phaser passes scene-start DATA to create(); fall back to the safe defaults if absent.
  create(data) {
    const summary = { ...DEFAULT_SUMMARY, ...(data || {}) }
    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2

    // ── Header: gold "RUN COMPLETE" (Decision 48) or red "GAME OVER" (Decision 47). ──
    const headerText = summary.completed ? 'RUN COMPLETE' : 'GAME OVER'
    const headerColor = summary.completed ? '#f4d03f' : '#e5484d'
    this.add
      .text(cx, cy - 130, headerText, {
        fontFamily: 'monospace',
        fontSize: '64px',
        color: headerColor,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    // ── Summary block (depth / biome / time / kills) — a label per stat, monospace-aligned. ──
    const rows = [
      ['DEPTH REACHED', `${summary.depthReached}`],
      ['BIOME', `${summary.biomeName}`],
      ['TIME', formatTime(summary.timeMs)],
      ['KILLS', `${summary.kills}`],
      ['CELLS BANKED', `${summary.cellsBanked}`], // §6.5 (AC51) — the Cells added to permanent meta.
    ]
    const rowH = 38
    const blockTop = cy - 40
    rows.forEach(([label, value], i) => {
      const y = blockTop + i * rowH
      // Label (right-aligned to the centerline) + value (left-aligned) so the colon column lines up.
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

    // GameOver → HUB (§6.5, Decision 59) so banked Cells are immediately spendable — the loop closes.
    const toHub = () => this.scene.start('Hub')
    this.input.keyboard.once('keydown-SPACE', toHub)
    this.input.once('pointerdown', toHub)
  }
}
