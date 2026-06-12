import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config/constants.js'

// ── GameOverScene (design §6.4, Decision 47/48, AC46/AC47) ──
// The run-end screen. GameScene hands off here on player death (completed:false → red "GAME OVER")
// OR on clearing the last biome's Door (completed:true → gold "RUN COMPLETE"), passing a run-summary
// SNAPSHOT as scene-start DATA. This scene is DECOUPLED (SOLID, same rule as the HUD/registry split):
// it reads the summary from this.scene.settings.data and NEVER reaches into the live GameScene. It
// renders the summary (depth, biome, time, kills) with primitives + text only, then routes to Title
// on a key/click. (Hub routing is Phase 7; the boss-gated VictoryScene is Phase 6 — this scene serves
// both the death and the placeholder run-complete edges via the `completed` flag.)

// Safe defaults so the scene is navigable even if launched bare (e.g. from a dev tool / direct start).
const DEFAULT_SUMMARY = { depthReached: 0, biomeName: '—', timeMs: 0, kills: 0, completed: false }

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
      .text(cx, blockTop + rows.length * rowH + 40, 'Press SPACE / click → Title', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    const toTitle = () => this.scene.start('Title')
    this.input.keyboard.once('keydown-SPACE', toTitle)
    this.input.once('pointerdown', toTitle)
  }
}
