import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'
import { createMetaState } from '../core/MetaState.js'
import type { MetaStateInstance } from '../core/MetaState.js'
import { UPGRADES } from '../config/upgrades.js'
import { MAX_TIER } from '../config/tiers.js'
import { BLUEPRINTS } from '../config/blueprints.js'
import { GameScene } from './GameScene.js'
import { Sound } from '../audio/Sound.js'
import { t, tName, tDesc, getLocale, setLocale } from '../i18n/index.js'
import type { Locale } from '../i18n/index.js'

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
// ── Column x-anchors (i18n, Decision 9 alignment fix) ── each list cell is its OWN Text at a fixed x,
// so columns align under ANY font. (Char-count padEnd only lines up under monospace; the CJK system-font
// fallback is proportional — see UI_FONT — so padded rows drifted in Chinese.) Sized from the longest
// English strings: name ends ~394, upgrade/blueprint desc ends ~1087/~1120 (clear of the ~1160 cursor edge).
const COL_NAME = 200 // px — name / label column.
const COL_MID = 430 // px — Lv X/Y · tier count · kind · EN locale label · seed value.
const COL_AUX = 580 // px — cost · status · ZH locale label · tier name—desc.
const COL_DESC = 720 // px — the one-line effect / description / hint.
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
  private languageRowIndex!: number // i18n — the LANGUAGE row (index 0, above the TIER row).
  private tierRowIndex!: number
  private upgradeRowStart!: number // index of the FIRST upgrade row.
  private blueprintRowStart!: number // index of the FIRST blueprint row.
  private seedRowIndex!: number
  private startRowIndex!: number
  private rowCount!: number
  private cursor!: number
  private cellsHeader!: Phaser.GameObjects.Text
  private cursorBar!: Phaser.GameObjects.Rectangle
  // ── Per-COLUMN cells (i18n alignment fix) ── each row is an array of fixed-x Text cells, not one padded
  // string, so columns line up under the proportional CJK fallback font. The row's color is applied to
  // every cell of that row in _render.
  private languageCells!: Phaser.GameObjects.Text[] // [name, EN, ZH] @ COL_NAME/MID/AUX.
  private tierCells!: Phaser.GameObjects.Text[] // [name, count, name—desc] @ COL_NAME/MID/AUX.
  private rowTexts!: Phaser.GameObjects.Text[][] // per upgrade: [name, lv, cost, desc] @ NAME/MID/AUX/DESC.
  private blueprintTexts!: Phaser.GameObjects.Text[][] // per blueprint: [name, kind, status, desc].
  private seedCells!: Phaser.GameObjects.Text[] // [name, value, hint] @ COL_NAME/MID/DESC (AUX unused).
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
    // i18n — a LANGUAGE row is inserted at index 0; every other row shifts down by one.
    this.languageRowIndex = 0
    this.tierRowIndex = 1
    this.upgradeRowStart = 2
    this.blueprintRowStart = 2 + UPGRADES.length
    this.seedRowIndex = 2 + UPGRADES.length + BLUEPRINTS.length // the SEEDED RUN row.
    this.startRowIndex = this.seedRowIndex + 1 // the START RUN row (the last).
    this.rowCount = this.startRowIndex + 1
    this.cursor = this.startRowIndex // start on START RUN so a player who just wants to play hits one key.

    // ── Header: title + banked-Cells readout + best depth. ──
    this.add
      .text(DESIGN_WIDTH / 2, 80, t('hub.title'), { fontFamily: UI_FONT, fontSize: '56px', color: '#e6edf3', fontStyle: 'bold' })
      .setOrigin(0.5)
    this.cellsHeader = this.add
      .text(DESIGN_WIDTH / 2, 140, '', { fontFamily: UI_FONT, fontSize: '24px', color: '#4dd0e1' })
      .setOrigin(0.5)
    this.add
      .text(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 40, t('hub.footer'), {
        fontFamily: UI_FONT,
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
    // ── LANGUAGE row (i18n) ── the top row; Buy (SPACE/ENTER) cycles en ↔ zh-CN then scene.restart()s to
    // re-render the whole Hub in the new language. Left-aligned like the upgrade/tier rows.
    // Each row is built from per-column cells (fixed-x Text — the alignment fix); _render fills + colors them.
    const makeCell = (x: number, y: number, color: string) =>
      this.add.text(x, y, '', { fontFamily: UI_FONT, fontSize: '18px', color }).setOrigin(0, 0.5)

    const langY = LIST_TOP + this.languageRowIndex * ROW_H
    this.languageCells = [makeCell(COL_NAME, langY, '#4dd0e1'), makeCell(COL_MID, langY, '#4dd0e1'), makeCell(COL_AUX, langY, '#4dd0e1')]

    const tierY = LIST_TOP + this.tierRowIndex * ROW_H
    this.tierCells = [makeCell(COL_NAME, tierY, '#e67e22'), makeCell(COL_MID, tierY, '#e67e22'), makeCell(COL_AUX, tierY, '#e67e22')]

    // ── One cell-set per upgrade row (re-rendered on buy/move). Offset by upgradeRowStart. ──
    this.rowTexts = []
    for (let i = 0; i < UPGRADES.length; i++) {
      const y = LIST_TOP + (this.upgradeRowStart + i) * ROW_H
      this.rowTexts.push([COL_NAME, COL_MID, COL_AUX, COL_DESC].map((x) => makeCell(x, y, '#e6edf3')))
    }
    // ── One cell-set per BLUEPRINT row (meta-progression §6.9, Decision 9, AC10) ── read-only (banked in-run,
    // not bought here — Decision 7); colored green (unlocked) / grey (locked) in _render. Rendered GENERICALLY off
    // BLUEPRINTS (no per-blueprint bespoke code — the same pattern as the generic upgrade rows).
    this.blueprintTexts = []
    for (let i = 0; i < BLUEPRINTS.length; i++) {
      const y = LIST_TOP + (this.blueprintRowStart + i) * ROW_H
      this.blueprintTexts.push([COL_NAME, COL_MID, COL_AUX, COL_DESC].map((x) => makeCell(x, y, '#8b949e')))
    }
    // ── SEEDED RUN row (Decision 71) ── shows RANDOM or the pinned hex seed; Buy toggles/edits it.
    const seedY = LIST_TOP + this.seedRowIndex * ROW_H
    this.seedCells = [makeCell(COL_NAME, seedY, '#f4d03f'), makeCell(COL_MID, seedY, '#f4d03f'), makeCell(COL_DESC, seedY, '#f4d03f')]

    this.startRowText = this.add
      .text(DESIGN_WIDTH / 2, LIST_TOP + this.startRowIndex * ROW_H + 12, t('hub.start'), {
        fontFamily: UI_FONT,
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
    // ESC → Title (main screen) — parity with GameScene (.once; Hub tears down).
    this.input.keyboard!.once('keydown-ESC', () => this.scene.start('Title'))
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
    if (this.cursor === this.languageRowIndex) {
      // LANGUAGE (i18n) — cycle en ↔ zh-CN, persist the choice, flip the live locale, then restart the
      // scene so every row re-renders through t/tName/tDesc in the new language (KISS — no per-row refresh).
      const next: Locale = getLocale() === 'en' ? 'zh-CN' : 'en'
      setLocale(next)
      this.meta.setLanguage(next)
      this.scene.restart()
      return
    }
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
        raw = window.prompt(t('hub.seedPrompt'), '')
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
    this.cellsHeader.setText(t('hub.cellsHeader', { cells, depth: this.meta.getBestDepth() }))

    // Fill a row's fixed-x cells with per-column text + a shared color (the alignment fix — no padEnd).
    const fill = (cells: Phaser.GameObjects.Text[], texts: string[], color: string) => {
      for (let i = 0; i < cells.length; i++) cells[i].setText(texts[i] ?? '').setColor(color)
    }

    // ── LANGUAGE row (i18n) ── the active locale is marked with [brackets]; Buy cycles it (see _confirm).
    const loc = getLocale()
    const enLabel = loc === 'en' ? `[${t('locale.en')}]` : t('locale.en')
    const zhLabel = loc === 'zh-CN' ? `[${t('locale.zh-CN')}]` : t('locale.zh-CN')
    fill(this.languageCells, [t('hub.language'), enLabel, zhLabel], '#4dd0e1')

    // ── TIER selector row (meta-progression §6.9, Decision 9, AC10) ── TIER selected/unlocked · name · desc.
    // SPACE cycles within 0..unlockedTier (orange when more tiers are unlockable, grey when locked at 0/0).
    const tier = this.meta.startTier()
    const unlockedTier = this.meta.getUnlockedTier()
    const selectedTier = this.meta.getSelectedTier()
    const tierColor = unlockedTier > 0 ? '#e67e22' : '#8b949e' // orange when there's a choice, grey at 0/0.
    const cycleHint = unlockedTier > 0 ? '   ' + t('hub.cycleHint') : ''
    fill(
      this.tierCells,
      [
        t('hub.bossCells'),
        `${selectedTier}/${unlockedTier} ${t('hub.tierMax', { max: MAX_TIER })}`,
        `${tName('tier', String(tier.index), tier.name)} — ${tDesc('tier', String(tier.index), tier.desc)}${cycleHint}`,
      ],
      tierColor,
    )

    for (let i = 0; i < UPGRADES.length; i++) {
      const upg = UPGRADES[i]
      const owned = this.meta.getUpgradeLevel(upg.id)
      const maxed = owned >= upg.maxLevel
      const cost = maxed ? null : upg.costs[owned]
      const affordable = !maxed && cells >= (cost as number)
      // Row: name · owned/max · next cost (or MAX) · the one-line effect. Color hints affordability.
      const costText = maxed ? t('hub.max') : t('hub.cellsCost', { cost: cost as number })
      const color = maxed ? '#8b949e' : affordable ? '#e6edf3' : '#e5484d' // grey maxed, white ok, red can't afford.
      fill(
        this.rowTexts[i],
        [tName('upgrade', upg.id, upg.name), `${t('hub.lv')} ${owned}/${upg.maxLevel}`, costText, tDesc('upgrade', upg.id, upg.desc)],
        color,
      )
    }

    // ── BLUEPRINT rows (meta-progression §6.9, Decision 9, AC10) ── rendered GENERICALLY off BLUEPRINTS (no
    // per-blueprint code): name · kind · UNLOCKED/LOCKED. Green when unlocked, grey when locked. Read-only
    // (banked in a run, not bought here — Decision 7). A default save shows all LOCKED (the identity readout).
    for (let i = 0; i < BLUEPRINTS.length; i++) {
      const bp = BLUEPRINTS[i]
      const unlocked = this.meta.isBlueprintUnlocked(bp.id)
      const bpName = `${t('hub.bpPrefix')} ${tName('blueprint', bp.id, bp.name)}`
      const status = unlocked ? t('hub.unlocked') : t('hub.locked')
      fill(this.blueprintTexts[i], [bpName, t('kind.' + bp.kind), status, tDesc('blueprint', bp.id, bp.desc)], unlocked ? '#58d68d' : '#8b949e')
    }

    // ── SEEDED RUN row (Decision 71) ── RANDOM (a fresh entropy seed each run) or the pinned hex run id.
    const seedText =
      this.pinnedSeed != null ? `0x${(this.pinnedSeed >>> 0).toString(16)}` : t('hub.seedRandom')
    const seedHint = this.pinnedSeed != null ? t('hub.seedClear') : t('hub.seedSet')
    fill(this.seedCells, [t('hub.seededRun'), seedText, seedHint], '#f4d03f')

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
