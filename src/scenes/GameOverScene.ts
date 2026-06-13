import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'
import { t } from '../i18n/index.js'

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
interface RunSummary {
  depthReached: number
  biomeName: string
  timeMs: number
  kills: number
  cellsBanked: number
  runSeed: number
  completed: boolean
}
const DEFAULT_SUMMARY: RunSummary = { depthReached: 0, biomeName: '—', timeMs: 0, kills: 0, cellsBanked: 0, runSeed: 0, completed: false }

// Format a run seed as the shareable hex run id (Decision 71) — what you type into the Hub to replay.
const formatSeed = (s: number): string => `0x${(s >>> 0).toString(16)}`

// Format milliseconds as m:ss (KISS — runs are minutes-long; no hours).
function formatTime(ms: number): string {
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
  create(data: Partial<RunSummary>): void {
    const summary: RunSummary = { ...DEFAULT_SUMMARY, ...(data || {}) }
    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2

    // ── Header: gold "RUN COMPLETE" (Decision 48) or red "GAME OVER" (Decision 47). ──
    const headerText = summary.completed ? t('over.runComplete') : t('over.gameOver')
    const headerColor = summary.completed ? '#f4d03f' : '#e5484d'
    this.add
      .text(cx, cy - 130, headerText, {
        fontFamily: UI_FONT,
        fontSize: '64px',
        color: headerColor,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    // ── Summary block (depth / biome / time / kills) — a label per stat, monospace-aligned. ──
    const rows: [string, string][] = [
      [t('summary.depthReached'), `${summary.depthReached}`],
      [t('summary.biome'), `${summary.biomeName}`], // biomeName is passed already-translated by GameScene.
      [t('summary.time'), formatTime(summary.timeMs)],
      [t('summary.kills'), `${summary.kills}`],
      [t('summary.cellsBanked'), `${summary.cellsBanked}`], // §6.5 (AC51) — the Cells added to permanent meta.
      [t('summary.runSeed'), formatSeed(summary.runSeed)], // §6.9 (Decision 71) — the shareable run id (replay in Hub).
    ]
    const rowH = 38
    const blockTop = cy - 40
    rows.forEach(([label, value], i) => {
      const y = blockTop + i * rowH
      // Label (right-aligned to the centerline) + value (left-aligned) so the colon column lines up.
      this.add
        .text(cx - 20, y, label, { fontFamily: UI_FONT, fontSize: '24px', color: '#8b949e' })
        .setOrigin(1, 0.5)
      this.add
        .text(cx + 20, y, value, { fontFamily: UI_FONT, fontSize: '24px', color: '#e6edf3' })
        .setOrigin(0, 0.5)
    })

    this.add
      .text(cx, blockTop + rows.length * rowH + 40, t('over.toHub'), {
        fontFamily: UI_FONT,
        fontSize: '22px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    // GameOver → HUB (§6.5, Decision 59) so banked Cells are immediately spendable — the loop closes.
    const toHub = () => this.scene.start('Hub')
    this.input.keyboard!.once('keydown-SPACE', toHub)
    this.input.once('pointerdown', toHub)
  }
}
