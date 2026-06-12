import Phaser from 'phaser'
import { TILE_SIZE } from '../world/LevelGenerator.js'

// ── Door — the level EXIT (design §6.2, Decision 40, AC30) ──
// A plain class (Decision 10 shape, like Player/Enemy) holding a drawn rectangle + an Arcade body
// configured as a SENSOR (overlap, not collide — the player passes through, the overlap fires the
// transition). Placed at the description's `exit` world position; GameScene wires the overlap to
// `onExit`. An ENTRANCE marker is drawn separately by GameScene (cosmetic). destroy() lets the
// in-place level→level rebuild tear it down cleanly (Decision 40).
//
// RE-ENTRANCY (review MAJOR — Arcade overlap fires EVERY frame the bodies overlap): the Door does
// NOT itself guard against double-firing — that is GameScene's job (a one-shot `transitioning` flag
// around _nextLevel, see GameScene). The Door also is NOT destroyed from inside its own overlap
// callback; GameScene defers the rebuild to the next tick (a classic Arcade footgun is destroying a
// collider's body while world.step is iterating the colliders list). This class just exposes the
// body + a destroy(); the lifecycle/guard discipline lives in the scene.

const DOOR_W = TILE_SIZE * 1.2 // px — a slab a bit wider than a tile so the overlap is forgiving.
const DOOR_H = TILE_SIZE * 1.8 // px — taller than the player so a running entry always overlaps.

export class Door {
  // scene: GameScene. exit: the description's `exit` { col, row, x, y } (world center in x,y).
  // color: the exit slab color (from the biome). onExit: the scene callback fired on player overlap.
  constructor(scene, exit, color, onExit) {
    this.scene = scene
    this.onExit = onExit

    // The slab sits with its BOTTOM on the platform top: the exit cell center y is the standable
    // cell; the door rises from there. Center it half a body-height up so it reads as a doorway.
    const x = exit.x
    const y = exit.y - (DOOR_H - TILE_SIZE) / 2

    this.rect = scene.add.rectangle(x, y, DOOR_W, DOOR_H, color)
    this.rect.setStrokeStyle(3, 0xffffff, 0.8) // a bright frame so the goal reads at a glance.
    scene.physics.add.existing(this.rect)
    /** @type {Phaser.Physics.Arcade.Body} */
    this.body = this.rect.body
    // SENSOR: no gravity, immovable, no separation — it only OVERLAPS the player (Decision 40).
    this.body.setAllowGravity(false)
    this.body.setImmovable(true)
    this.rect.doorRef = this // back-ref so the overlap callback resolves the Door from its body.

    // A soft pulse so the exit draws the eye (cosmetic; framerate-independent via the tween system).
    this._tween = scene.tweens.add({
      targets: this.rect,
      alpha: { from: 0.7, to: 1 },
      duration: 600,
      yoyo: true,
      repeat: -1,
    })
  }

  destroy() {
    if (this._tween) this._tween.remove()
    this.rect.destroy() // destroys the body with it.
  }
}
