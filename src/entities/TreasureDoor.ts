import Phaser from 'phaser'
import { TILE_SIZE } from '../world/LevelGenerator.js'
import { UI_FONT } from '../config/constants.js'
import { t } from '../i18n/index.js'

// ── TreasureDoor — a rune-gated E-to-open treasure interactable (F8 traversal-runes §6, AC3, Decision 5/6) ──
// A THIRD stand-on interactable, modelled IDENTICALLY on entities/CursedChest.ts MINUS the curse (a treasure
// door is pure upside — the rune was the cost). A drawn sealed-stone rectangle + an Arcade SENSOR body
// (overlap, not collide — the player stands ON the door's tile and an overlap sets `playerInRange`). Placed
// RARELY on NORMAL levels (GameScene._maybePlaceTreasureDoor rolls it off a distinct off-pin RNG mix). Pressing
// E while in range opens it ONCE — but ONLY when the player owns its required rune (GameScene._tryOpenTreasureDoor
// → _openTreasureDoor): it grants GUARANTEED high-rarity loot (the F2 fold). Without the rune, E shows a "needs
// the rune" banner + a denied cue and leaves the door shut (the carrot you come back for next run).
//
// THE LOCKED/UNLOCKED TELL (Decision 6 — programmer-art): the FRAME colour + prompt encode the door's state at a
// glance, computed against the run-start owned-rune snapshot at PLACEMENT time (stable for the whole level):
//   • Locked (no rune): a dimmed fill + a grey/rune-tinted frame + prompt t('treasure.locked', {rune}).
//   • Unlocked (rune owned): a bright fill + a gold frame + prompt t('treasure.prompt') — reads as a reward NOW.
//   • Opened: dimmed (setOpened), no prompt, no pulse (inert) — the spent look.
//
// IN-RANGE TRACKING (KISS — the CursedChest lifecycle verbatim): GameScene wires an overlap(player.collider,
// door.rect) whose callback calls door.markInRange(); the flag is set on the scene UPDATE event (before
// GameScene.update), read by _tryOpenTreasureDoor, then RESET just after that read (resetInRange) — so it reads
// true ONLY on overlap frames. Once OPENED the door is inert. destroy() lets the in-place level→level rebuild
// tear it down cleanly (the CursedChest/Shop discipline).

const DOOR_W = TILE_SIZE * 1.4 // px — a door a bit wider than the player so the overlap is forgiving (chest-sized).
const DOOR_H = TILE_SIZE * 1.5 // px — a tall sealed slab (reads as a DOOR, not a chest) that still overlaps the tile.
const DOOR_COLOR_LOCKED = 0x2c2f36 // a dark sealed-stone grey (programmer-art primitive — reads as "sealed shut").
const DOOR_COLOR_OPEN = 0x6b5a2a // a warm bright fill when unlocked (the rune is owned — a reward you can take).
const DOOR_STROKE_LOCKED = 0x6c7a89 // a cold grey frame when locked (no rune — you can't open it yet).
const DOOR_STROKE_OPEN = 0xf4d03f // a GOLD frame when unlocked (the treasure tell — reads like loot).
const DOOR_OPENED_ALPHA = 0.35 // dimmed spent look once opened (inert — no prompt, no pulse).

export class TreasureDoor {
  scene: Phaser.Scene
  playerInRange: boolean
  opened: boolean
  locked: boolean // true when the player lacks requiredRuneId (computed at placement off the run-start snapshot).
  requiredRuneId: string // the rune id that opens this door (a real RUNES_BY_ID id — verifier-asserted on the gate).
  rect!: Phaser.GameObjects.Rectangle
  body!: Phaser.Physics.Arcade.Body
  tag!: Phaser.GameObjects.Text
  prompt!: Phaser.GameObjects.Text
  _tween!: Phaser.Tweens.Tween

  // scene: GameScene. spot: a standable point { x, y } (the door sits on the platform top, like the chest/Shop).
  // requiredRuneId: the gating rune id. runeName: the LOCALISED rune name (for the locked prompt — resolved by
  // the scene at the i18n boundary). locked: whether the player lacks the rune (the run-start snapshot).
  constructor(scene: Phaser.Scene, spot: { x: number; y: number }, requiredRuneId: string, runeName: string, locked: boolean) {
    this.scene = scene
    this.playerInRange = false // set true by markInRange() on an overlap frame; reset each GameScene tick.
    this.opened = false // once true the door is spent: no re-open, no prompt, no pulse.
    this.locked = locked
    this.requiredRuneId = requiredRuneId

    // The door sits with its BOTTOM on the platform top (the standable cell center y): raise the center so it
    // reads as a slab standing on the ground (same anchoring as the chest / Shop slab / Door).
    const x = spot.x
    const y = spot.y - (DOOR_H - TILE_SIZE) / 2

    const fill = locked ? DOOR_COLOR_LOCKED : DOOR_COLOR_OPEN
    const stroke = locked ? DOOR_STROKE_LOCKED : DOOR_STROKE_OPEN
    this.rect = scene.add.rectangle(x, y, DOOR_W, DOOR_H, fill)
    this.rect.setStrokeStyle(3, stroke, 0.95) // the locked/unlocked frame tell (grey vs gold).
    this.rect.setDepth(4)
    if (locked) this.rect.setAlpha(0.7) // a dimmer sealed look when you can't open it (you lack the rune).
    scene.physics.add.existing(this.rect)
    this.body = this.rect.body as Phaser.Physics.Arcade.Body
    // SENSOR: no gravity, immovable, overlap-only — the player stands on the tile, it never blocks them.
    this.body.setAllowGravity(false)
    this.body.setImmovable(true)
    ;(this.rect as any).treasureDoorRef = this // back-ref so the overlap callback resolves the door from its body.

    // A small key glyph on the door (gold when unlocked, grey when locked) + a floating prompt shown only while
    // in range — the locked/unlocked tell in the prompt text (Decision 6).
    this.tag = scene.add
      .text(x, y - DOOR_H * 0.5 - 6, '⚷', { fontFamily: UI_FONT, fontSize: '20px', color: locked ? '#6c7a89' : '#f4d03f', fontStyle: 'bold' })
      .setOrigin(0.5, 1)
      .setDepth(5)
    const promptText = locked ? t('treasure.locked', { rune: runeName }) : t('treasure.prompt')
    this.prompt = scene.add
      .text(x, y - DOOR_H * 0.5 - 28, promptText, { fontFamily: UI_FONT, fontSize: '18px', color: locked ? '#8b949e' : '#f4d03f' })
      .setOrigin(0.5, 1)
      .setDepth(5)
      .setVisible(false)

    // A soft pulse so an UNLOCKED door draws the eye (cosmetic). A LOCKED door does NOT pulse — it reads as
    // inert/sealed until you bring the rune. The pulse is removed once opened (setOpened) so a spent door is inert.
    if (!locked) {
      this._tween = scene.tweens.add({
        targets: this.rect,
        alpha: { from: 0.78, to: 1 },
        duration: 760,
        yoyo: true,
        repeat: -1,
      })
    }
  }

  // Called by GameScene's overlap callback while the player stands on the door (sets the flag true for this
  // frame). The overlap runs on the scene UPDATE event, before GameScene.update; GameScene resets the flag to
  // false each tick AFTER reading it (resetInRange), so it's true ONLY on overlap frames. An OPENED door never
  // flags (the overlap's processCallback gates on !door.opened — defensive: guard here too).
  markInRange() {
    if (this.opened) return
    this.playerInRange = true
  }

  // Reset the in-range flag. GameScene calls this AFTER _tryOpenTreasureDoor has read it (the SAME shop/chest
  // flag-reset-ordering fix — the Arcade overlap that SETS the flag fires before update(), so the read must
  // precede the reset). Drives the prompt visibility off the same-frame flag; an opened door is inert.
  resetInRange() {
    this.prompt.setVisible(this.playerInRange)
    this.playerInRange = false
  }

  // ── setOpened() (AC3) ── mark the door spent so it can't be re-opened / re-grant loot: dim the rect (the spent
  // look), drop the pulse tween, hide the prompt, clear the in-range flag. Called by GameScene._openTreasureDoor
  // the instant the door is opened (so a held-overlap / re-enter can't re-fire). Only fires for an unlocked door.
  setOpened() {
    if (this.opened) return
    this.opened = true
    if (this._tween) this._tween.remove()
    this.rect.setAlpha(DOOR_OPENED_ALPHA)
    this.rect.setStrokeStyle(3, DOOR_STROKE_OPEN, 0.3)
    this.playerInRange = false
    this.prompt.setVisible(false)
  }

  destroy() {
    if (this._tween) this._tween.remove()
    this.rect.destroy() // destroys the body with it.
    this.tag.destroy()
    this.prompt.destroy()
  }
}
