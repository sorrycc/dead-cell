import Phaser from 'phaser'
import { swingRect } from './hitbox.js'

// ── Transient attack-hitbox pool (design §6.3, Decisions 16/20/26/28, AC20/AC21) ──
// Phaser-COUPLED — this file imports Phaser and owns real Arcade bodies, so it is split OUT of
// the pure combat/hitbox.js (review MAJOR #28): hitbox.js stays node-importable; THIS file is
// browser-only and verify-gen.mjs never touches it.
//
// A hitbox is TRANSIENT: it exists only for a swing's `active` window, then is released back.
// Allocating one per swing would churn GC during sustained combat, so we PRE-CREATE a fixed
// set of invisible rectangle+Arcade-body members in an overlap GROUP (the mandated pooling
// convention). acquire() positions+enables one and tags it with the swing context; tick(gdt)
// counts each live hitbox's releaseTimer DOWN and disables it at end-of-window.
//
// PER-SWING DEDUP (Decision 20): each acquired hitbox carries a fresh `hitSet:Set` of victim ids
// it has already hit. The scene's overlap processFilter rejects a victim already in the set, so a
// single multi-frame-alive hitbox can NEVER multi-hit the same victim (the exact AC21 contract).
//
// HIT-STOP BOUNDARY (Decision 26 — review BLOCKER #2): tick() takes the GAMEPLAY dt (`gdt`, which
// GameScene drives to 0 during a hit-stop). So a still-active hitbox FREEZES with the rest of the
// world during the micro-freeze — which is safe because its hitSet already recorded every victim
// it hit, so the frozen box can't re-hit anyone. Sparks/numbers (effects) run on REAL dt instead.

const HITBOX_COLOR = 0xff4d4d // only seen when debug-visualized; bodies are alpha 0 in play.

export class HitboxPool {
  // scene: the GameScene. ownerTag: a string stamped on every hitbox from this pool ('player' or
  // an enemy id) so the overlap callbacks know who swung. size: pool high-water (a handful is
  // plenty — one swing is live at a time per attacker, but we keep slack for overlap/teardown).
  constructor(scene, ownerTag, size = 4) {
    this.scene = scene
    this.ownerTag = ownerTag

    // The overlap group GameScene registers against the victim hurtbox(es). Members are not
    // affected by gravity and don't collide/separate — they only OVERLAP (Decision 16).
    this.group = scene.physics.add.group({ allowGravity: false, immovable: true })

    this._items = []
    for (let i = 0; i < size; i++) {
      // An invisible rectangle promoted to a dynamic Arcade body, parked off-screen + disabled.
      const rect = scene.add.rectangle(0, 0, 10, 10, HITBOX_COLOR).setAlpha(0)
      this.group.add(rect)
      const body = rect.body
      body.setAllowGravity(false)
      // Per-hitbox combat context, mutated on acquire (never re-allocated → no per-hit GC).
      rect.hb = { active: false, ownerId: null, swing: null, hitSet: new Set(), releaseTimer: 0 }
      this._disable(rect)
      this._items.push(rect)
    }
  }

  // Acquire a hitbox for `swing`, placed in front of `attacker` ({ cx, cy, facing }). It goes
  // LIVE for swing.active seconds, then tick() releases it. ownerId tags WHO swung (the attacker's
  // id) so its own hurtbox is never self-hit. Returns the rect (or null if the pool is exhausted —
  // sized so that never happens in normal play; a drop is cosmetic-only, never a correctness bug).
  acquire(attacker, swing, ownerId) {
    const rect = this._items.find((r) => !r.hb.active)
    if (!rect) return null

    const aabb = swingRect(attacker, swing)
    const body = rect.body
    // Resize the rect GEOMETRY (NOT its scale — Rectangle.setSize changes width/height, keeping
    // scale 1 so the Arcade body math stays simple), match the body size centered on the
    // GameObject, then reset() to snap the body to the AABB center (clears residual velocity, no
    // drift). The rect is invisible (alpha 0) — only the body matters for the overlap.
    rect.setSize(aabb.w, aabb.h)
    body.setSize(aabb.w, aabb.h, true) // true = re-center the body on the GameObject origin.
    body.reset(aabb.x, aabb.y)
    body.enable = true

    const hb = rect.hb
    hb.active = true
    hb.ownerId = ownerId
    hb.ownerTag = this.ownerTag
    hb.swing = swing
    hb.hitSet.clear() // reuse the SAME Set object — clear, never re-allocate (Decision 20).
    hb.releaseTimer = swing.active
    return rect
  }

  // Advance every live hitbox by the GAMEPLAY dt (Decision 26 — 0 during hit-stop, so live boxes
  // freeze with the world). Release any whose active window has elapsed.
  tick(gdt) {
    for (const rect of this._items) {
      const hb = rect.hb
      if (!hb.active) continue
      hb.releaseTimer -= gdt
      if (hb.releaseTimer <= 0) this._disable(rect)
    }
  }

  // Force-release a specific rect (used when a dodge/hit cancels an in-progress swing).
  release(rect) {
    if (rect && rect.hb.active) this._disable(rect)
  }

  // Force-release ALL live hitboxes from this pool (used when the attacker's swing is interrupted
  // and we don't hold the rect reference — e.g. player dodge-cancel cancels whatever's live).
  releaseAll() {
    for (const rect of this._items) if (rect.hb.active) this._disable(rect)
  }

  // Disable a rect back into the pool: kill its body, mark inactive, park it.
  _disable(rect) {
    rect.hb.active = false
    rect.hb.swing = null
    const body = rect.body
    body.enable = false
    body.reset(-1000, -1000) // park well off-room so a stray broad-phase pass can't match it.
  }
}
