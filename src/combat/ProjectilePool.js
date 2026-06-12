import Phaser from 'phaser'

// ── Traveling-projectile pool (design §6.5, Decision 62, AC54) ──
// Phaser-COUPLED — owns real Arcade bodies, so (like HitboxPool) it is NOT imported by verify-gen.mjs.
// Mirrors HitboxPool's discipline EXACTLY (the mandated pooling convention, already used by HitboxPool
// + ParticlePool): a FIXED set of pre-created rectangle+body members, acquired/released, ZERO
// per-shot allocation after warm-up. The difference from a hitbox: a projectile TRAVELS (a constant
// velocity along facing) and releases on lifetime / world-bound / first hit (KISS — pierce is YAGNI).
//
// PER-SHOT DEDUP (Decision 62): each acquired projectile carries a fresh `hitSet:Set` (reused/cleared,
// never re-allocated) so it hits each enemy at most once — the SAME pattern as the per-swing hitbox.
//
// HIT-STOP BOUNDARY (Decision 26/62): tick() takes the GAMEPLAY dt (`gdt`, driven to 0 during a
// hit-stop), so a live projectile FREEZES with the combat world during the micro-freeze (consistent
// with hitboxes + enemies). We integrate position OURSELVES (body.velocity is set on acquire and we
// advance x/y by velocity·gdt) so the freeze is exact regardless of Arcade's own physics step — a
// projectile body has no gravity and never collides, it only OVERLAPS the enemy hurtbox group.
//
// ATTACKER SHAPE FOR THE HIT (review MAJOR): a projectile's hit must be resolved from the PROJECTILE's
// position + travel direction, NOT the player's — so the pool stamps each shot with an `attackerShape`
// getter ({ cx, facing }) read by GameScene's projectile-specific hit handler (its own handler, its
// own dedup — NOT the player's _onPlayerHitEnemy, which reads the player's attackerShape). Backstab/
// knockback geometry then derives from where the SHOT is, the genre-correct behavior.

const PROJ_COLOR = 0xaed6f1 // light blue bolt (matches the player's swing-color cue; primitives only).

export class ProjectilePool {
  // scene: the GameScene. ownerTag: stamped on every shot ('player') so the overlap knows who fired.
  // size: pool high-water — a handful is plenty (the bow's recovery gates the fire rate well below it).
  constructor(scene, ownerTag = 'player', size = 8) {
    this.scene = scene
    this.ownerTag = ownerTag

    // The overlap group GameScene registers against the enemy hurtbox group. No gravity, no separation
    // (overlap only). Members are parked+disabled until acquired.
    this.group = scene.physics.add.group({ allowGravity: false })

    this._items = []
    for (let i = 0; i < size; i++) {
      const rect = scene.add.rectangle(0, 0, 10, 6, PROJ_COLOR).setVisible(false)
      this.group.add(rect)
      const body = rect.body
      body.setAllowGravity(false)
      // Per-projectile combat context, mutated on acquire (never re-allocated → no per-shot GC).
      rect.pj = {
        active: false,
        ownerId: null,
        ownerTag,
        spec: null, // the weapon's projectile spec (damage/knockback/speed/lifetime/w/h).
        facing: 1,
        vx: 0, // travel velocity along facing (px/s). We hand-integrate this on the GAMEPLAY dt so the
        //        shot FREEZES during hit-stop; the ARCADE body velocity stays 0 so Arcade's world step
        //        never ALSO moves it (no double-integration). The body only OVERLAPS (no collide).
        hitSet: new Set(),
        releaseTimer: 0,
        // attackerShape: read by GameScene's projectile hit handler — the SHOT's position + dir
        // (review MAJOR — NOT the player's). cx is the live body center; facing is the travel dir.
        get attackerShape() {
          return { cx: rect.body.center.x, facing: this.facing }
        },
      }
      this._disable(rect)
      this._items.push(rect)
    }
  }

  // ── Fire a projectile from `attacker` ({ cx, cy, facing }) per the weapon's `projectile` spec
  // (Decision 62). It travels at spec.speed along facing for spec.lifetime seconds (or until a hit /
  // world-bound). ownerId tags WHO fired (so the shooter's own hurtbox is never self-hit, and the hit
  // handler can find the firer). Returns the rect (or null if the pool is momentarily exhausted —
  // sized so that never happens in normal play; a dropped shot is cosmetic, never a correctness bug). ──
  acquire(attacker, spec, ownerId) {
    const rect = this._items.find((r) => !r.pj.active)
    if (!rect) return null

    const w = spec.w ?? 14
    const h = spec.h ?? 6
    const body = rect.body
    // Resize geometry (NOT scale, like HitboxPool) so the body math stays simple, then snap the body
    // to the muzzle (just ahead of the attacker center along facing) clearing residual velocity.
    rect.setSize(w, h)
    body.setSize(w, h, true)
    const muzzleX = attacker.cx + attacker.facing * 22 // a small standoff so it spawns "ahead".
    body.reset(muzzleX, attacker.cy)
    body.enable = true
    body.setVelocity(0, 0) // ARCADE velocity 0 — we hand-integrate (no double-step; freezes with hit-stop).

    rect.setVisible(true)
    rect.setPosition(muzzleX, attacker.cy)

    const pj = rect.pj
    pj.active = true
    pj.ownerId = ownerId
    pj.ownerTag = this.ownerTag
    pj.spec = spec
    pj.facing = attacker.facing
    pj.vx = attacker.facing * spec.speed // the travel velocity we integrate ourselves.
    pj.hitSet.clear() // reuse the SAME Set — clear, never re-allocate (the dedup convention).
    pj.releaseTimer = spec.lifetime
    return rect
  }

  // ── Advance every live projectile by the GAMEPLAY dt (Decision 26 — 0 during hit-stop, so live
  // shots freeze with the world). Integrate position ourselves (exact freeze), release on lifetime or
  // when it leaves the generated world bounds (the scene sets this.worldBounds each level). ──
  tick(gdt) {
    const bounds = this.scene.physics.world.bounds
    for (const rect of this._items) {
      const pj = rect.pj
      if (!pj.active) continue
      pj.releaseTimer -= gdt
      const body = rect.body
      // Hand-integrate position from OUR stored velocity (gdt=0 during hit-stop → frozen in place). The
      // Arcade body velocity is 0, so when the physics world step runs (AFTER scene.update) it syncs the
      // body FROM this rect's new transform + integrates by velocity 0 → no double-step, exact freeze.
      // Move the RECT (the body's source of truth via updateFromGameObject); also nudge the body so the
      // out-of-world check below reads the fresh edges this same frame.
      rect.x += pj.vx * gdt
      body.x += pj.vx * gdt
      // Release on lifetime OR when fully past the world bounds (don't fly forever off-room).
      const outOfWorld =
        body.right < bounds.x || body.left > bounds.x + bounds.width ||
        body.bottom < bounds.y || body.top > bounds.y + bounds.height
      if (pj.releaseTimer <= 0 || outOfWorld) this._disable(rect)
    }
  }

  // Force-release a specific projectile (GameScene calls this on a hit — KISS: a shot dies on first
  // hit, no pierce). Guards a stale handle the same way HitboxPool.release does.
  release(rect) {
    if (rect && rect.pj.active) this._disable(rect)
  }

  // Force-release ALL live projectiles (used on a level rebuild so a frozen/in-flight shot doesn't
  // dangle across the teardown — mirrors HitboxPool.releaseAll).
  releaseAll() {
    for (const rect of this._items) if (rect.pj.active) this._disable(rect)
  }

  // Disable a projectile back into the pool: kill its body, mark inactive, park it off-room.
  _disable(rect) {
    rect.pj.active = false
    rect.pj.spec = null
    const body = rect.body
    body.setVelocity(0, 0)
    body.enable = false
    body.reset(-1000, -1000) // park well off-room so a stray broad-phase pass can't match it.
    rect.setVisible(false)
  }
}
