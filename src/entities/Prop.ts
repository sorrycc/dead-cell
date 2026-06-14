import Phaser from 'phaser'
import { TILE_SIZE } from '../world/LevelGenerator.js'
import type { HitResult } from '../combat/damage.js'
import type { BarrelFlavour } from '../config/props.js'

// ── Barrel — a destructible blast prop (F5 environmental-combat design §2(b)/§3 AC2, Decision 4/5) ──
// A drawn flavour-tinted rectangle (programmer-art) + an Arcade body that sits on its tile (no gravity,
// immovable — the player/enemies bump it). Decoupled from the blast: the entity only tracks hp/broken and
// EXPOSES `broken`; the actual radial blast + FX live in GameScene._breakBarrel (the scene owns _radialDamage /
// _enemyRadialDamage / effects — like Pickup/Shop/CursedChest, the entity stays a dumb value holder).
//
// THE BREAK DISCIPLINE (review BLOCKER — the in-callback body-destruction footgun): a barrel is broken from
// INSIDE an Arcade overlap callback (player/projectile/enemy × barrelGroup). Destroying a collider's body
// while Arcade is iterating world.step is a classic crash/UB footgun (the door-transition guards against it
// with time.delayedCall(0)). So onBreak() only sets `broken` + DISABLES the body (so the overlap can't re-fire
// the blast) — it does NOT destroy. GameScene._breakBarrel then DEFERS destroy() to time.delayedCall(0).
//
// NO on-screen text (Decision 6 — the KISS path): a barrel is hit-to-break, NOT E-to-interact, so it carries
// NO label/prompt/HUD line and adds NO i18n string (a programmer-art rectangle only).

const BARREL_W = TILE_SIZE * 0.9 // px — a squat barrel a touch narrower than the player.
const BARREL_H = TILE_SIZE * 1.1 // px — about a tile tall, so it sits on its cell and overlaps a bump.
const BARREL_STROKE = 0x1c1c1c // a dark iron-band frame so the barrel reads against the floor.

export class Barrel {
  scene: Phaser.Scene
  flavour: BarrelFlavour
  hp: number
  broken: boolean
  rect!: Phaser.GameObjects.Rectangle
  body!: Phaser.Physics.Arcade.Body

  // scene: GameScene. spot: a standable point { x, y } (the barrel sits on the platform top, like the Shop/Chest).
  constructor(scene: Phaser.Scene, spot: { x: number; y: number }, flavour: BarrelFlavour) {
    this.scene = scene
    this.flavour = flavour
    this.hp = flavour.hp
    this.broken = false

    // The barrel sits with its BOTTOM on the platform top (the standable cell center y): raise the center half
    // a body-height so it reads as a barrel standing on the ground (the Shop/Chest/Door anchoring idiom).
    const x = spot.x
    const y = spot.y - (BARREL_H - TILE_SIZE) / 2

    this.rect = scene.add.rectangle(x, y, BARREL_W, BARREL_H, flavour.color)
    this.rect.setStrokeStyle(3, BARREL_STROKE, 0.9) // a dark iron-band frame so the barrel reads.
    this.rect.setDepth(4)
    scene.physics.add.existing(this.rect)
    this.body = this.rect.body as Phaser.Physics.Arcade.Body
    // It sits on its tile: no gravity, immovable — the player/enemies bump it, it never falls or shoves.
    this.body.setAllowGravity(false)
    this.body.setImmovable(true)
    ;(this.rect as any).barrelRef = this // back-ref so the overlap callbacks resolve the Barrel from its body.
  }

  // ── onHit(result) (AC2/AC4) ── subtract the hit's damage from hp; if it drops to <= 0 (and not already
  // broken) flip `broken` true. Returns nothing — GameScene reads `broken` after the call to decide whether to
  // detonate. Idempotent: a second hit on a broken barrel is a no-op (the one-shot break discipline).
  onHit(result: HitResult): void {
    if (this.broken) return
    this.hp -= result.damage
    if (this.hp <= 0) this.broken = true
  }

  // ── markBroken() (AC5 — the enemy contact-break path) ── KISS: an enemy bumping the barrel breaks it on
  // contact (no enemy-damage accounting — the barrel is fragile). Idempotent (the one-shot break).
  markBroken(): void {
    if (this.broken) return
    this.broken = true
  }

  // ── disableBody() (review BLOCKER — the in-callback safety) ── called by GameScene._breakBarrel the instant
  // the barrel breaks (still inside the overlap callback): hide the rect + disable the body so the overlap can't
  // re-fire the blast, WITHOUT destroying the body mid-world.step. The actual destroy() is deferred (delayedCall).
  disableBody(): void {
    if (this.body) this.body.enable = false
    this.rect.setVisible(false)
  }

  // ── destroy() ── tear down the rect/body (level→level rebuild discipline, like Shop/CursedChest). Called
  // DEFERRED from _breakBarrel (time.delayedCall(0)) OR from _teardownLevel — never synchronously in a callback.
  destroy(): void {
    if (this.rect && this.rect.active) this.rect.destroy() // destroys the body with it.
  }
}
