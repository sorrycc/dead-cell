import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config/constants.js'
import { createMetaState } from '../core/MetaState.js'
import { UPGRADES } from '../config/upgrades.js'

// ── HubScene — the between-runs shop (design §6.5, Decision 58, AC52) ──
// The meta-progression hub where banked Cells buy PERMANENT upgrades. A KEYBOARD-driven vertical list
// (primitives + text only — the mandated art constraint, KISS): Up/Down move a highlight cursor over
// the upgrade rows + a final START RUN row; Buy (Space/Enter) on an upgrade row purchases the next
// level if affordable; Buy on the START RUN row launches Game.
//
// DECOUPLED (Decision 58, same rule as HUD/GameOver): it reads + writes meta ONLY through MetaState
// (never util/save.js directly, never a live GameScene — there is none, the run ended). MetaState's
// save.js try/catch makes a disabled storage degrade to in-memory (the Hub still works, AC50).
//
// FLOW (Decision 58/59): reachable from BOTH Title (Title → Hub → Game) and GameOver (GameOver → Hub),
// so banked Cells are immediately spendable. START RUN does scene.start('Game') (which re-loads
// MetaState + folds the owned upgrades into the run-start stats — Decision 60).

const ROW_H = 44 // px — vertical spacing between list rows.
const LIST_TOP = 220 // px — y of the first upgrade row.
const COL_X = 200 // px — left x of the row text block.
const CURSOR_COLOR = 0x2c3e50 // the highlight bar behind the selected row.

export class HubScene extends Phaser.Scene {
  constructor() {
    super('Hub')
  }

  create() {
    // Load a fresh view of the persistent meta (reflects any prior buys / the just-banked run).
    this.meta = createMetaState()

    // Rows: every upgrade, then a synthetic START RUN row (index === UPGRADES.length).
    this.rowCount = UPGRADES.length + 1
    this.cursor = this.rowCount - 1 // start on START RUN so a player who just wants to play hits one key.

    // ── Header: title + banked-Cells readout + best depth. ──
    this.add
      .text(DESIGN_WIDTH / 2, 80, 'HUB', { fontFamily: 'monospace', fontSize: '56px', color: '#e6edf3', fontStyle: 'bold' })
      .setOrigin(0.5)
    this.cellsHeader = this.add
      .text(DESIGN_WIDTH / 2, 140, '', { fontFamily: 'monospace', fontSize: '24px', color: '#4dd0e1' })
      .setOrigin(0.5)
    this.add
      .text(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 40, 'UP/DOWN select · SPACE/ENTER buy or start', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    // ── The cursor highlight bar (a rectangle moved behind the selected row). ──
    this.cursorBar = this.add
      .rectangle(DESIGN_WIDTH / 2, 0, DESIGN_WIDTH - 240, ROW_H - 6, CURSOR_COLOR)
      .setOrigin(0.5)

    // ── One text object per upgrade row + the START RUN row (re-rendered on buy/move). ──
    this.rowTexts = []
    for (let i = 0; i < UPGRADES.length; i++) {
      const t = this.add
        .text(COL_X, LIST_TOP + i * ROW_H, '', { fontFamily: 'monospace', fontSize: '22px', color: '#e6edf3' })
        .setOrigin(0, 0.5)
      this.rowTexts.push(t)
    }
    this.startRowText = this.add
      .text(DESIGN_WIDTH / 2, LIST_TOP + UPGRADES.length * ROW_H + 12, 'START RUN', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#58d68d',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    this._render()

    // ── Keyboard nav (on .once-free .on handlers; the scene is single-instance + torn down on start). ──
    this.input.keyboard.on('keydown-UP', () => this._move(-1))
    this.input.keyboard.on('keydown-DOWN', () => this._move(1))
    this.input.keyboard.on('keydown-W', () => this._move(-1))
    this.input.keyboard.on('keydown-S', () => this._move(1))
    this.input.keyboard.on('keydown-SPACE', () => this._confirm())
    this.input.keyboard.on('keydown-ENTER', () => this._confirm())
  }

  // Move the cursor (clamped to the row range) + re-render so the highlight + affordability refresh.
  _move(dir) {
    this.cursor = Phaser.Math.Clamp(this.cursor + dir, 0, this.rowCount - 1)
    this._render()
  }

  // Confirm the selected row: an upgrade row → buy; the START RUN row → launch Game.
  _confirm() {
    if (this.cursor === this.rowCount - 1) {
      this.scene.start('Game') // START RUN (Decision 58) — GameScene re-loads + folds the meta.
      return
    }
    const upg = UPGRADES[this.cursor]
    this.meta.buy(upg.id) // deduct + increment + SAVE (no-op if maxed/unaffordable — MetaState guards).
    this._render() // reflect the new owned level + banked Cells + affordability.
  }

  // ── Render the whole list from the current MetaState (cheap — a handful of rows; only on change). ──
  _render() {
    const cells = this.meta.getCells()
    this.cellsHeader.setText(`CELLS ${cells}   ·   BEST DEPTH ${this.meta.getBestDepth()}`)

    for (let i = 0; i < UPGRADES.length; i++) {
      const upg = UPGRADES[i]
      const owned = this.meta.getUpgradeLevel(upg.id)
      const maxed = owned >= upg.maxLevel
      const cost = maxed ? null : upg.costs[owned]
      const affordable = !maxed && cells >= cost
      // Row: name · owned/max · next cost (or MAX) · the one-line effect. Color hints affordability.
      const costText = maxed ? 'MAX' : `${cost} cells`
      const color = maxed ? '#8b949e' : affordable ? '#e6edf3' : '#e5484d' // grey maxed, white ok, red can't afford.
      this.rowTexts[i]
        .setText(`${upg.name.padEnd(18)} Lv ${owned}/${upg.maxLevel}   ${costText.padEnd(11)} ${upg.desc}`)
        .setColor(color)
    }

    // Move the highlight bar behind the selected row (the START RUN row is the synthetic last index).
    const selY =
      this.cursor === this.rowCount - 1
        ? this.startRowText.y
        : LIST_TOP + this.cursor * ROW_H
    this.cursorBar.y = selY
  }
}
