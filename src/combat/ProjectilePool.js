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
// TWO-DIMENSIONAL VELOCITY (Enrichment round 3 — the elite-death-burst / boss-volley fix): a shot now
// carries BOTH vx AND vy and we hand-integrate BOTH axes, so an aimed/spread shot can actually ARC.
// The previous design collapsed every shot to a pure-horizontal ±facing·speed velocity (vy hard-zero),
// which silently flattened the elite "6-shot radial 360° fan" and the boss "vertical-spread volley"
// into a flat horizontal line. `acquire` accepts an OPTIONAL `aim` ({ vx, vy } OR { angle }) that, when
// present, sets the true 2-D velocity from the attacker's firing direction; absent, a shot keeps the
// EXACT old behavior (vx = facing·speed, vy = 0) so a straight bow shot / shooter shot is byte-identical
// (the additive identity). The body's `attackerShape.facing` derives from vx's sign so the hit geometry
// (backstab/knockback origin) still reads from the shot's travel direction.
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
        status: null, // §6.13 (Decision 79) — the firing weapon's status spec (poison) stamped at acquire.
        facing: 1,
        vx: 0, // X travel velocity (px/s). We hand-integrate this on the GAMEPLAY dt so the shot FREEZES
        //        during hit-stop; the ARCADE body velocity stays 0 so Arcade's world step never ALSO moves
        //        it (no double-integration). The body only OVERLAPS (no collide).
        vy: 0, // Y travel velocity (px/s) — non-zero only for an AIMED/spread shot (the radial fan / boss
        //        volley arc). Hand-integrated alongside vx so the shot's trajectory is a true 2-D line.
        hitSet: new Set(),
        releaseTimer: 0,
        // attackerShape: read by GameScene's projectile hit handler — the SHOT's position + dir
        // (review MAJOR — NOT the player's). cx is the live body center; facing is the travel dir. For an
        // aimed/spread shot the horizontal travel sign (vx) is the authoritative facing (so a fan shot
        // that arcs left/right resolves its backstab/knockback geometry from where it's actually heading).
        get attackerShape() {
          const facing = this.vx !== 0 ? Math.sign(this.vx) : this.facing
          return { cx: rect.body.center.x, facing }
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
  // `status` (§6.13, Decision 79 — optional): the firing weapon's status spec, stamped on the shot so the
  // hit handler applies it to the struck enemy (a poison bow shot carries its poison). null ⇒ no status.
  // `aim` (Enrichment round 3 — optional): an aimed/spread firing direction for a 2-D shot. EITHER
  //   { angle } (radians; the velocity is spec.speed along that angle) OR { vx, vy } (an explicit velocity,
  //   used as-is). When ABSENT the shot keeps the EXACT old behavior (vx = facing·speed, vy = 0) — a
  //   straight bow / shooter shot is byte-identical (the additive identity). The muzzle standoff is placed
  //   ALONG the firing direction so an arcing shot spawns ahead of the attacker on its real trajectory.
  acquire(attacker, spec, ownerId, status = null, aim = null) {
    const rect = this._items.find((r) => !r.pj.active)
    if (!rect) return null

    const w = spec.w ?? 14
    const h = spec.h ?? 6
    const body = rect.body
    // Resolve the 2-D travel velocity (vx, vy). Default (no aim): pure horizontal along facing (the old
    // behavior — identity). With an aim: either a velocity along the given angle, or an explicit (vx, vy).
    let vx
    let vy
    if (aim && typeof aim.angle === 'number') {
      vx = Math.cos(aim.angle) * spec.speed
      vy = Math.sin(aim.angle) * spec.speed
    } else if (aim && (typeof aim.vx === 'number' || typeof aim.vy === 'number')) {
      vx = aim.vx ?? 0
      vy = aim.vy ?? 0
    } else {
      vx = attacker.facing * spec.speed
      vy = 0
    }
    // Resize geometry (NOT scale, like HitboxPool) so the body math stays simple, then snap the body
    // to the muzzle (a small standoff AHEAD along the travel direction) clearing residual velocity.
    rect.setSize(w, h)
    body.setSize(w, h, true)
    // Standoff direction = the UNIT travel vector (so an arcing shot spawns ahead on its real path); falls
    // back to ±facing when the velocity is degenerate (never happens with a real spec, but stays safe).
    const speedMag = Math.hypot(vx, vy) || 1
    const STANDOFF = 22
    const muzzleX = attacker.cx + (vx / speedMag) * STANDOFF
    const muzzleY = attacker.cy + (vy / speedMag) * STANDOFF
    body.reset(muzzleX, muzzleY)
    body.enable = true
    body.setVelocity(0, 0) // ARCADE velocity 0 — we hand-integrate (no double-step; freezes with hit-stop).

    rect.setVisible(true)
    rect.setPosition(muzzleX, muzzleY)

    const pj = rect.pj
    pj.active = true
    pj.ownerId = ownerId
    pj.ownerTag = this.ownerTag
    pj.spec = spec
    pj.status = status // §6.13 — the firing weapon's status (or null); the hit handler applies it.
    pj.facing = vx !== 0 ? Math.sign(vx) : attacker.facing // travel-direction facing (for the hit geometry).
    pj.vx = vx // the 2-D travel velocity we hand-integrate ourselves.
    pj.vy = vy
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
      // Move the RECT (the body's source of truth via updateFromGameObject) on BOTH axes (a 2-D arc); also
      // nudge the body so the out-of-world check below reads the fresh edges this same frame.
      rect.x += pj.vx * gdt
      rect.y += pj.vy * gdt
      body.x += pj.vx * gdt
      body.y += pj.vy * gdt
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
    rect.pj.status = null // §6.13 — drop the stamped status so a recycled shot never carries a stale one.
    rect.pj.vx = 0 // clear the 2-D velocity so a recycled shot never inherits a stale arc.
    rect.pj.vy = 0
    const body = rect.body
    body.setVelocity(0, 0)
    body.enable = false
    body.reset(-1000, -1000) // park well off-room so a stray broad-phase pass can't match it.
    rect.setVisible(false)
  }
}
