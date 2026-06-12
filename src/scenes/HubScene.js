import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config/constants.js'
import { createMetaState } from '../core/MetaState.js'
import { UPGRADES } from '../config/upgrades.js'
import { GameScene } from './GameScene.js'

// ── HubScene — the between-runs shop (design §6.5/§6.9, Decision 58/71, AC52) ──
// The meta-progression hub where banked Cells buy PERMANENT upgrades. A KEYBOARD-driven vertical list
// (primitives + text only — the mandated art constraint, KISS): Up/Down move a highlight cursor over
// the upgrade rows + a SEEDED RUN row + a final START RUN row; Buy (Space/Enter) on an upgrade row
// purchases the next level if affordable; Buy on the SEEDED RUN row toggles between a RANDOM (entropy)
// seed and a TYPED shareable seed (a browser prompt — KISS, no custom text-field widget under the
// primitives-only constraint); Buy on START RUN launches Game WITH the chosen seed.
//
// SEEDED RUN (design §6.9, Decision 71 — the replayability fix): by default each run gets a FRESH seed
// minted from entropy at START RUN, so no two launches are the same. The SEEDED RUN row lets a player
// PIN a specific hex seed (type one to replay a friend's run / a previous run's RUN SEED), passed to
// GameScene via scene.start('Game', { seed }). The pure modules are untouched — entropy/seed selection
// lives ONLY at this scene boundary, so the verifier's determinism walk is unaffected.
//
// DECOUPLED (Decision 58, same rule as HUD/GameOver): it reads + writes meta ONLY through MetaState
// (never util/save.js directly, never a live GameScene — there is none, the run ended). MetaState's
// save.js try/catch makes a disabled storage degrade to in-memory (the Hub still works, AC50).
//
// FLOW (Decision 58/59): reachable from BOTH Title (Title → Hub → Game) and GameOver (GameOver → Hub),
// so banked Cells are immediately spendable. START RUN does scene.start('Game', { seed }) (which re-loads
// MetaState + folds the owned upgrades into the run-start stats — Decision 60 — and seeds the run, 71).

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

    // ── Seed selection state (Decision 71) ── null = RANDOM (mint fresh entropy at START RUN); a number =
    // a PINNED shareable seed (typed via the SEEDED RUN row). Starts RANDOM so the default is "every run
    // varies" (the replayability fix) — a player opts INTO a fixed seed only to replay/share one.
    this.pinnedSeed = null

    // Rows: every upgrade, then a synthetic SEEDED RUN row, then a START RUN row. The two synthetic rows
    // sit at fixed indices off UPGRADES.length so the cursor math stays a single clamp (KISS).
    this.seedRowIndex = UPGRADES.length // the SEEDED RUN row.
    this.startRowIndex = UPGRADES.length + 1 // the START RUN row (the last).
    this.rowCount = UPGRADES.length + 2
    this.cursor = this.startRowIndex // start on START RUN so a player who just wants to play hits one key.

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
    // ── SEEDED RUN row (Decision 71) ── shows RANDOM or the pinned hex seed; Buy toggles/edits it.
    this.seedRowText = this.add
      .text(COL_X, LIST_TOP + this.seedRowIndex * ROW_H, '', { fontFamily: 'monospace', fontSize: '22px', color: '#f4d03f' })
      .setOrigin(0, 0.5)

    this.startRowText = this.add
      .text(DESIGN_WIDTH / 2, LIST_TOP + this.startRowIndex * ROW_H + 12, 'START RUN', {
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

  // Confirm the selected row: an upgrade row → buy; SEEDED RUN → toggle/edit the pinned seed; START RUN →
  // launch Game with the chosen seed (Decision 58/71).
  _confirm() {
    if (this.cursor === this.startRowIndex) {
      // START RUN (Decision 58/71): use the pinned seed if set, else mint a fresh entropy seed HERE so the
      // run varies even from a Hub-launched start. Pass it to GameScene via scene-start data.
      const seed = this.pinnedSeed != null ? this.pinnedSeed : GameScene.mintSeed()
      this.scene.start('Game', { seed }) // GameScene re-loads + folds the meta, seeds the run (71).
      return
    }
    if (this.cursor === this.seedRowIndex) {
      this._editSeed() // toggle RANDOM ↔ a typed pinned seed (Decision 71).
      return
    }
    const upg = UPGRADES[this.cursor]
    this.meta.buy(upg.id) // deduct + increment + SAVE (no-op if maxed/unaffordable — MetaState guards).
    this._render() // reflect the new owned level + banked Cells + affordability.
  }

  // ── _editSeed() (Decision 71) ── toggle the pinned seed. If one is already pinned, clear it (back to
  // RANDOM). Otherwise prompt for a shareable seed string (decimal or 0x-hex — the RUN SEED the GameOver/
  // Victory screen shows). A browser prompt is the KISS choice here: building a custom on-canvas text field
  // under the primitives-only constraint is heavyweight YAGNI for a share/replay convenience. An empty/
  // cancelled/invalid entry leaves the seed RANDOM (graceful — never throws, never starts a bad run).
  _editSeed() {
    if (this.pinnedSeed != null) {
      this.pinnedSeed = null // un-pin → back to a fresh entropy seed each run.
      this._render()
      return
    }
    let raw = null
    try {
      // prompt is unavailable in some embeds — guard so the Hub never throws (mirrors save.js's discipline).
      if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
        raw = window.prompt('Enter a run seed to replay (decimal or 0x-hex). Blank = random:', '')
      }
    } catch {
      raw = null
    }
    this.pinnedSeed = HubScene.parseSeed(raw)
    this._render()
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

    // ── SEEDED RUN row (Decision 71) ── RANDOM (a fresh entropy seed each run) or the pinned hex run id.
    const seedText =
      this.pinnedSeed != null ? `0x${(this.pinnedSeed >>> 0).toString(16)}` : 'RANDOM (each run varies)'
    this.seedRowText.setText(`${'SEEDED RUN'.padEnd(18)}        ${seedText}   (SPACE to ${this.pinnedSeed != null ? 'clear' : 'set'})`)

    // Move the highlight bar behind the selected row. START RUN is the synthetic last (centered) row; the
    // SEEDED RUN row + the upgrade rows are left-aligned at their list y.
    const selY = this.cursor === this.startRowIndex ? this.startRowText.y : LIST_TOP + this.cursor * ROW_H
    this.cursorBar.y = selY
  }
}

// ── parseSeed(raw) (Decision 71) ── parse a user-typed run seed string → an unsigned 32-bit int, or null if
// blank/invalid (→ RANDOM). Accepts decimal ("12648430") or 0x-hex ("0xc0ffee"). PURE + total (never throws)
// so a junk paste degrades to RANDOM rather than starting a broken run. Static on the class for testability.
HubScene.parseSeed = function parseSeed(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  if (s === '') return null
  const n = s.toLowerCase().startsWith('0x') ? parseInt(s.slice(2), 16) : parseInt(s, 10)
  if (!Number.isFinite(n) || n < 0) return null
  return n >>> 0 // coerce to the unsigned 32-bit shape RunState's seed chain expects.
}
