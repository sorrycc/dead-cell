import Phaser from 'phaser'
import { TILE_SIZE } from '../world/LevelGenerator.js'
import { UI_FONT } from '../config/constants.js'
import { t } from '../i18n/index.js'

// ── CursedChest — a rare E-to-open interactable (cursed-chests design §6, AC2, Decision 1/3) ──
// A SECOND stand-on interactable modelled IDENTICALLY on entities/Shop.ts (Decision 1 — NOT a Pickup; a
// cursed chest is a deliberate E-to-open CHOICE you can walk past, not a touch-to-collect drop). A drawn
// chest rectangle + an Arcade SENSOR body (overlap, not collide — the player stands ON the chest's tile and
// an overlap sets `playerInRange`). Placed RARELY on NORMAL levels (GameScene._maybePlaceCursedChest rolls
// it off the level seed). Pressing E while in range opens it ONCE (GameScene._tryOpenChest → _openCursedChest):
// it grants GUARANTEED strong loot AND applies a curse (greatly amplified damage until N kills clear it).
//
// IN-RANGE TRACKING (KISS — the Shop lifecycle verbatim): GameScene wires an overlap(player.collider,
// chest.rect) whose callback calls chest.markInRange(). Arcade fires that on the scene UPDATE event, BEFORE
// GameScene.update, so the flag is already true going into update; _tryOpenChest reads it, then GameScene
// RESETS it to false just AFTER that read (resetInRange) — so it reads true ONLY on overlap frames. A
// floating "[E] CURSED CHEST" prompt is shown/hidden off the same flag (the tell). Once OPENED the chest is
// inert: setOpened() dims it + drops the pulse, and resetInRange keeps the prompt hidden (no re-open / re-loot).
// destroy() lets the in-place level→level rebuild tear it down cleanly (Decision 40 discipline, like Shop).

const CHEST_W = TILE_SIZE * 1.4 // px — a chest a bit wider than the player so the overlap is forgiving.
const CHEST_H = TILE_SIZE * 1.2 // px — a squat chest (shorter than the shop slab) that still overlaps the tile.
const CHEST_COLOR = 0x4a235a // a dark cursed purple (programmer-art primitive — reads as "cursed").
const CHEST_STROKE = 0xe74c3c // a danger-red frame (the curse colour) so the chest reads as risky.
const CHEST_OPENED_ALPHA = 0.35 // dimmed spent look once opened (inert — no prompt, no pulse).

export class CursedChest {
  scene: Phaser.Scene
  playerInRange: boolean
  opened: boolean
  rect!: Phaser.GameObjects.Rectangle
  body!: Phaser.Physics.Arcade.Body
  tag!: Phaser.GameObjects.Text
  prompt!: Phaser.GameObjects.Text
  _tween!: Phaser.Tweens.Tween

  // scene: GameScene. spot: a standable point { x, y } (the chest sits on the platform top, like the Shop slab).
  constructor(scene: Phaser.Scene, spot: { x: number; y: number }) {
    this.scene = scene
    this.playerInRange = false // set true by markInRange() on an overlap frame; reset each GameScene tick.
    this.opened = false // once true the chest is spent: no re-open, no prompt, no pulse.

    // The chest sits with its BOTTOM on the platform top (the standable cell center y): raise the center half a
    // body-height so it reads as a chest standing on the ground (same anchoring as the Shop slab / Door).
    const x = spot.x
    const y = spot.y - (CHEST_H - TILE_SIZE) / 2

    this.rect = scene.add.rectangle(x, y, CHEST_W, CHEST_H, CHEST_COLOR)
    this.rect.setStrokeStyle(3, CHEST_STROKE, 0.95) // a danger-red frame so the cursed chest reads as risky.
    this.rect.setDepth(4)
    scene.physics.add.existing(this.rect)
    this.body = this.rect.body as Phaser.Physics.Arcade.Body
    // SENSOR: no gravity, immovable, overlap-only — the player stands on the tile, it never blocks them.
    this.body.setAllowGravity(false)
    this.body.setImmovable(true)
    ;(this.rect as any).chestRef = this // back-ref so the overlap callback resolves the chest from its body.

    // A small skull glyph on the chest + a floating "[E] CURSED CHEST" prompt shown only while in range.
    this.tag = scene.add
      .text(x, y - CHEST_H * 0.5 - 6, '☠', { fontFamily: UI_FONT, fontSize: '20px', color: '#e74c3c', fontStyle: 'bold' })
      .setOrigin(0.5, 1)
      .setDepth(5)
    this.prompt = scene.add
      .text(x, y - CHEST_H * 0.5 - 28, t('chest.prompt'), { fontFamily: UI_FONT, fontSize: '18px', color: '#e6edf3' })
      .setOrigin(0.5, 1)
      .setDepth(5)
      .setVisible(false)

    // A soft pulse so the chest draws the eye (cosmetic; framerate-independent via the tween system). The pulse
    // is removed once opened (setOpened) so a spent chest reads as inert.
    this._tween = scene.tweens.add({
      targets: this.rect,
      alpha: { from: 0.7, to: 1 },
      duration: 760,
      yoyo: true,
      repeat: -1,
    })
  }

  // Called by GameScene's overlap callback while the player stands on the chest (sets the flag true for this
  // frame). The overlap runs on the scene UPDATE event, before GameScene.update; GameScene resets the flag to
  // false each tick AFTER reading it (see resetInRange), so it's true ONLY on overlap frames. An OPENED chest
  // never flags (the overlap's processCallback gates on !chest.opened — defensive: guard here too).
  markInRange() {
    if (this.opened) return
    this.playerInRange = true
  }

  // Reset the in-range flag. GameScene calls this AFTER _tryOpenChest has read it (just past the gameplay-gated
  // block), NOT at the top of update — the Arcade overlap callback that sets the flag already ran on the scene
  // UPDATE event before update(), so resetting first would wipe it before it is read (the shop-flag-reset-
  // ordering fix applies verbatim). Drives the prompt visibility off the same-frame flag; an opened chest is
  // inert (playerInRange never set → the prompt stays hidden).
  resetInRange() {
    this.prompt.setVisible(this.playerInRange)
    this.playerInRange = false
  }

  // ── setOpened() (AC2/AC4) ── mark the chest spent so it cannot be re-opened / re-grant loot: dim the rect
  // (the spent look), drop the pulse tween, hide the prompt, and clear the in-range flag. Called by GameScene
  // ._openCursedChest the instant the chest is opened (so a held-overlap / re-enter cannot re-fire — Decision 3).
  setOpened() {
    if (this.opened) return
    this.opened = true
    if (this._tween) this._tween.remove()
    this.rect.setAlpha(CHEST_OPENED_ALPHA)
    this.rect.setStrokeStyle(3, CHEST_STROKE, 0.3)
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
