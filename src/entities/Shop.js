import Phaser from 'phaser'
import { TILE_SIZE } from '../world/LevelGenerator.js'

// ── Shop — the in-run vendor (design §6.10, Decision 74/76, AC63 — the GOLD SINK) ──
// A plain class (Decision 10 shape, like Door/Player/Enemy) holding a drawn vendor rectangle + an Arcade
// SENSOR body (overlap, not collide — the player stands ON the vendor's tile and an overlap sets
// `playerInRange`). Placed on SOME generated levels (GameScene._buildLevel rolls it off the level seed).
// Pressing E while in range opens the buy overlay (GameScene._tryOpenShop → _openShop, Decision 74).
//
// WHY THIS EXISTS (review MAJOR — the phantom-stub fix): _tryOpenShop() read `this.shop.playerInRange`
// and called `this._openShop()`, but NO Shop was ever spawned (this.shop stayed null) and _openShop was
// NEVER defined — so pressing E was a silent no-op, and gold (dropped + collected + shown on the HUD) had
// ZERO sinks. This entity + GameScene's overlay close that gap: gold becomes the run-economy decision loop.
//
// IN-RANGE TRACKING (KISS): GameScene wires an overlap(player.collider, shop.rect) whose callback calls
// shop.markInRange(); the flag is RESET to false at the TOP of every GameScene.update (before physics
// runs the overlaps) so it reads true ONLY on the frames the bodies actually overlap. A floating "Press E"
// prompt is shown/hidden off the same flag so the interaction is discoverable (the genre's vendor tell).
// destroy() lets the in-place level→level rebuild tear it down cleanly (Decision 40 discipline).

const SHOP_W = TILE_SIZE * 1.4 // px — a stall a bit wider than the player so the overlap is forgiving.
const SHOP_H = TILE_SIZE * 1.7 // px — taller than the player so standing on its tile always overlaps.
const SHOP_COLOR = 0x9b59b6 // a distinct vendor purple (programmer-art primitive — reads as "shop").

export class Shop {
  // scene: GameScene. spot: a standable point { x, y } (the vendor stands on the platform top, feet down).
  constructor(scene, spot) {
    this.scene = scene
    this.playerInRange = false // set true by markInRange() on an overlap frame; reset each GameScene tick.

    // The stall sits with its BOTTOM on the platform top (the standable cell center y): raise the center
    // half a body-height so it reads as a booth standing on the ground (same anchoring as the Door slab).
    const x = spot.x
    const y = spot.y - (SHOP_H - TILE_SIZE) / 2

    this.rect = scene.add.rectangle(x, y, SHOP_W, SHOP_H, SHOP_COLOR)
    this.rect.setStrokeStyle(3, 0xf1c40f, 0.9) // a gold frame (the currency colour) so the vendor reads.
    this.rect.setDepth(4)
    scene.physics.add.existing(this.rect)
    /** @type {Phaser.Physics.Arcade.Body} */
    this.body = this.rect.body
    // SENSOR: no gravity, immovable, overlap-only — the player stands on the tile, it never blocks them.
    this.body.setAllowGravity(false)
    this.body.setImmovable(true)
    this.rect.shopRef = this // back-ref so the overlap callback resolves the Shop from its body.

    // A small "$" marker on the stall + a floating "Press E" prompt shown only while in range (the tell).
    this.tag = scene.add
      .text(x, y - SHOP_H * 0.5 - 6, '$', { fontFamily: 'monospace', fontSize: '22px', color: '#f1c40f', fontStyle: 'bold' })
      .setOrigin(0.5, 1)
      .setDepth(5)
    this.prompt = scene.add
      .text(x, y - SHOP_H * 0.5 - 28, '[E] SHOP', { fontFamily: 'monospace', fontSize: '18px', color: '#e6edf3' })
      .setOrigin(0.5, 1)
      .setDepth(5)
      .setVisible(false)

    // A soft pulse so the vendor draws the eye (cosmetic; framerate-independent via the tween system).
    this._tween = scene.tweens.add({
      targets: this.rect,
      alpha: { from: 0.78, to: 1 },
      duration: 700,
      yoyo: true,
      repeat: -1,
    })
  }

  // Called by GameScene's overlap callback while the player stands on the vendor (sets the flag true for
  // this frame). GameScene resets it to false each tick before physics, so it's true ONLY on overlap frames.
  markInRange() {
    this.playerInRange = true
  }

  // Reset the in-range flag (GameScene calls this at the top of update, before the physics overlaps run).
  // Also drives the prompt visibility off the PREVIOUS frame's flag so the tell tracks the player.
  resetInRange() {
    this.prompt.setVisible(this.playerInRange)
    this.playerInRange = false
  }

  destroy() {
    if (this._tween) this._tween.remove()
    this.rect.destroy() // destroys the body with it.
    this.tag.destroy()
    this.prompt.destroy()
  }
}
