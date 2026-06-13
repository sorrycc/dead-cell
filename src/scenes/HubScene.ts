import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config/constants.js'
import { createMetaState } from '../core/MetaState.js'
import type { MetaStateInstance } from '../core/MetaState.js'
import { UPGRADES } from '../config/upgrades.js'
import { MAX_TIER } from '../config/tiers.js'
import { BLUEPRINTS } from '../config/blueprints.js'
import { GameScene } from './GameScene.js'
import { Sound } from '../audio/Sound.js'

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

// The list grew again with meta-progression: a TIER selector row (above the upgrades) + N BLUEPRINT rows (one
// per BLUEPRINTS entry, between the upgrades + the SEEDED RUN row) join the existing upgrades + SEEDED RUN +
// START RUN rows. The list height = (1 + UPGRADES.length + BLUEPRINTS.length + 2) · ROW_H must clear
// DESIGN_HEIGHT − the footer band, so ROW_H was nudged 36→30 + LIST_TOP 184→164 to fit all rows at 720p.
const ROW_H = 30 // px — vertical spacing between list rows.
const LIST_TOP = 164 // px — y of the FIRST list row (the TIER selector).
const COL_X = 200 // px — left x of the row text block.
const CURSOR_COLOR = 0x2c3e50 // the highlight bar behind the selected row.

export class HubScene extends Phaser.Scene {
  private meta!: MetaStateInstance
  // audio §6.4 — menu blips. NAMED `sfx` (Phaser.Scene already owns `sound`). Constructs its OWN Sound
  // (which shares Phaser's ONE AudioContext, so this is cheap — just a master GainNode); no-op on NoAudio.
  private sfx!: Sound
  private pinnedSeed!: number | null
  // ── Row index scheme (meta-progression §6.9, Decision 9) ── synthetic rows at fixed indices off
  // UPGRADES.length / BLUEPRINTS.length so the cursor math stays a single clamp (KISS). Layout (top→bottom):
  //   tierRowIndex (0) · upgrade rows (1..UPGRADES.length) · blueprint rows · SEEDED RUN · START RUN.
  private tierRowIndex!: number
  private upgradeRowStart!: number // index of the FIRST upgrade row.
  private blueprintRowStart!: number // index of the FIRST blueprint row.
  private seedRowIndex!: number
  private startRowIndex!: number
  private rowCount!: number
  private cursor!: number
  private cellsHeader!: Phaser.GameObjects.Text
  private cursorBar!: Phaser.GameObjects.Rectangle
  private tierRowText!: Phaser.GameObjects.Text
  private rowTexts!: Phaser.GameObjects.Text[]
  private blueprintTexts!: Phaser.GameObjects.Text[]
  private seedRowText!: Phaser.GameObjects.Text
  private startRowText!: Phaser.GameObjects.Text

  static parseSeed: (raw: unknown) => number | null

  constructor() {
    super('Hub')
  }

  create() {
    // Load a fresh view of the persistent meta (reflects any prior buys / the just-banked run).
    this.meta = createMetaState()
    this.sfx = new Sound(this) // audio §6.4 — the menu-blip façade (shares Phaser's context; null-safe).

    // ── Seed selection state (Decision 71) ── null = RANDOM (mint fresh entropy at START RUN); a number =
    // a PINNED shareable seed (typed via the SEEDED RUN row). Starts RANDOM so the default is "every run
    // varies" (the replayability fix) — a player opts INTO a fixed seed only to replay/share one.
    this.pinnedSeed = null

    // Rows (meta-progression §6.9, Decision 9): a TIER selector row, then every upgrade, then one BLUEPRINT row
    // per BLUEPRINTS entry, then the synthetic SEEDED RUN + START RUN rows. All sit at fixed indices off
    // UPGRADES.length / BLUEPRINTS.length so the cursor math stays a single clamp (KISS).
    this.tierRowIndex = 0
    this.upgradeRowStart = 1
    this.blueprintRowStart = 1 + UPGRADES.length
    this.seedRowIndex = 1 + UPGRADES.length + BLUEPRINTS.length // the SEEDED RUN row.
    this.startRowIndex = this.seedRowIndex + 1 // the START RUN row (the last).
    this.rowCount = this.startRowIndex + 1
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

    // ── TIER selector row (meta-progression §6.9, Decision 9, AC10) ── shows selected/unlocked + the tier name
    // + desc; Buy CYCLES selectedTier within 0..unlockedTier (saved via setSelectedTier). Sits at the top.
    this.tierRowText = this.add
      .text(COL_X, LIST_TOP + this.tierRowIndex * ROW_H, '', { fontFamily: 'monospace', fontSize: '18px', color: '#e67e22' })
      .setOrigin(0, 0.5)

    // ── One text object per upgrade row (re-rendered on buy/move). Offset by upgradeRowStart. ──
    this.rowTexts = []
    for (let i = 0; i < UPGRADES.length; i++) {
      const t = this.add
        .text(COL_X, LIST_TOP + (this.upgradeRowStart + i) * ROW_H, '', { fontFamily: 'monospace', fontSize: '18px', color: '#e6edf3' })
        .setOrigin(0, 0.5)
      this.rowTexts.push(t)
    }
    // ── One text object per BLUEPRINT row (meta-progression §6.9, Decision 9, AC10) ── read-only (banked in-run,
    // not bought here — Decision 7); colored green (unlocked) / grey (locked) in _render. Rendered GENERICALLY off
    // BLUEPRINTS (no per-blueprint bespoke code — the same pattern as the generic upgrade rows).
    this.blueprintTexts = []
    for (let i = 0; i < BLUEPRINTS.length; i++) {
      const t = this.add
        .text(COL_X, LIST_TOP + (this.blueprintRowStart + i) * ROW_H, '', { fontFamily: 'monospace', fontSize: '18px', color: '#8b949e' })
        .setOrigin(0, 0.5)
      this.blueprintTexts.push(t)
    }
    // ── SEEDED RUN row (Decision 71) ── shows RANDOM or the pinned hex seed; Buy toggles/edits it.
    this.seedRowText = this.add
      .text(COL_X, LIST_TOP + this.seedRowIndex * ROW_H, '', { fontFamily: 'monospace', fontSize: '18px', color: '#f4d03f' })
      .setOrigin(0, 0.5)

    this.startRowText = this.add
      .text(DESIGN_WIDTH / 2, LIST_TOP + this.startRowIndex * ROW_H + 12, 'START RUN', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#58d68d',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    this._render()

    // ── Keyboard nav (on .once-free .on handlers; the scene is single-instance + torn down on start). ──
    this.input.keyboard!.on('keydown-UP', () => this._move(-1))
    this.input.keyboard!.on('keydown-DOWN', () => this._move(1))
    this.input.keyboard!.on('keydown-W', () => this._move(-1))
    this.input.keyboard!.on('keydown-S', () => this._move(1))
    this.input.keyboard!.on('keydown-SPACE', () => this._confirm())
    this.input.keyboard!.on('keydown-ENTER', () => this._confirm())
  }

  // Move the cursor (clamped to the row range) + re-render so the highlight + affordability refresh.
  _move(dir: number) {
    const before = this.cursor
    this.cursor = Phaser.Math.Clamp(this.cursor + dir, 0, this.rowCount - 1)
    if (this.cursor !== before) this.sfx.uiMove() // audio §6.4 (AC6) — cursor-move tick (only on a real move).
    this._render()
  }

  // Confirm the selected row: TIER → cycle the selected tier; an upgrade row → buy; a BLUEPRINT row → no-op
  // (read-only — banked in-run, Decision 7); SEEDED RUN → toggle/edit the pinned seed; START RUN → launch
  // Game with the chosen seed (Decision 58/71; meta-progression §6.9, Decision 9).
  _confirm() {
    this.sfx.uiSelect() // audio §6.4 (AC6) — confirm/buy/START blip (fired before any scene-start below).
    if (this.cursor === this.startRowIndex) {
      // START RUN (Decision 58/71): use the pinned seed if set, else mint a fresh entropy seed HERE so the
      // run varies even from a Hub-launched start. Pass it to GameScene via scene-start data.
      const seed = this.pinnedSeed != null ? this.pinnedSeed : GameScene.mintSeed()
      this.scene.start('Game', { seed }) // GameScene re-loads + folds the meta, seeds the run (71).
      return
    }
    if (this.cursor === this.tierRowIndex) {
      // TIER (meta-progression §6.9, Decision 9, AC10) — Buy CYCLES the selected tier within 0..unlockedTier,
      // wrapping past the unlocked max back to 0 (reuses the single confirm key — KISS, no new key wiring).
      const unlocked = this.meta.getUnlockedTier()
      const next = this.meta.getSelectedTier() >= unlocked ? 0 : this.meta.getSelectedTier() + 1
      this.meta.setSelectedTier(next) // clamp 0..unlockedTier + SAVE (MetaState guards).
      this._render()
      return
    }
    if (this.cursor === this.seedRowIndex) {
      this._editSeed() // toggle RANDOM ↔ a typed pinned seed (Decision 71).
      return
    }
    // BLUEPRINT rows are read-only (banked in a run, not bought here — Decision 7): a confirm on one is a no-op.
    if (this.cursor >= this.blueprintRowStart && this.cursor < this.blueprintRowStart + BLUEPRINTS.length) {
      return
    }
    const upg = UPGRADES[this.cursor - this.upgradeRowStart] // the upgrade rows are offset by the tier row above.
    if (!upg) return // defensive — a non-upgrade index (shouldn't reach here) is a no-op.
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
    let raw: string | null = null
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

    // ── TIER selector row (meta-progression §6.9, Decision 9, AC10) ── TIER selected/unlocked · name · desc.
    // SPACE cycles within 0..unlockedTier (orange when more tiers are unlockable, grey when locked at 0/0).
    const tier = this.meta.startTier()
    const unlockedTier = this.meta.getUnlockedTier()
    const selectedTier = this.meta.getSelectedTier()
    const tierColor = unlockedTier > 0 ? '#e67e22' : '#8b949e' // orange when there's a choice, grey at 0/0.
    this.tierRowText
      .setText(`${'BOSS CELLS'.padEnd(18)} ${selectedTier}/${unlockedTier} (max ${MAX_TIER})   ${tier.name} — ${tier.desc}${unlockedTier > 0 ? '   (SPACE to cycle)' : ''}`)
      .setColor(tierColor)

    for (let i = 0; i < UPGRADES.length; i++) {
      const upg = UPGRADES[i]
      const owned = this.meta.getUpgradeLevel(upg.id)
      const maxed = owned >= upg.maxLevel
      const cost = maxed ? null : upg.costs[owned]
      const affordable = !maxed && cells >= (cost as number)
      // Row: name · owned/max · next cost (or MAX) · the one-line effect. Color hints affordability.
      const costText = maxed ? 'MAX' : `${cost} cells`
      const color = maxed ? '#8b949e' : affordable ? '#e6edf3' : '#e5484d' // grey maxed, white ok, red can't afford.
      this.rowTexts[i]
        .setText(`${upg.name.padEnd(18)} Lv ${owned}/${upg.maxLevel}   ${costText.padEnd(11)} ${upg.desc}`)
        .setColor(color)
    }

    // ── BLUEPRINT rows (meta-progression §6.9, Decision 9, AC10) ── rendered GENERICALLY off BLUEPRINTS (no
    // per-blueprint code): name · kind · UNLOCKED/LOCKED. Green when unlocked, grey when locked. Read-only
    // (banked in a run, not bought here — Decision 7). A default save shows all LOCKED (the identity readout).
    for (let i = 0; i < BLUEPRINTS.length; i++) {
      const bp = BLUEPRINTS[i]
      const unlocked = this.meta.isBlueprintUnlocked(bp.id)
      this.blueprintTexts[i]
        .setText(`${('BP ' + bp.name).padEnd(18)} ${bp.kind.padEnd(8)} ${unlocked ? 'UNLOCKED' : 'LOCKED'}   ${bp.desc}`)
        .setColor(unlocked ? '#58d68d' : '#8b949e') // green unlocked, grey locked.
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
HubScene.parseSeed = function parseSeed(raw: unknown): number | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (s === '') return null
  const n = s.toLowerCase().startsWith('0x') ? parseInt(s.slice(2), 16) : parseInt(s, 10)
  if (!Number.isFinite(n) || n < 0) return null
  return n >>> 0 // coerce to the unsigned 32-bit shape RunState's seed chain expects.
}
