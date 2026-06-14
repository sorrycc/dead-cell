import Phaser from 'phaser'
import type { ProjectileSpec, WeaponStatus } from '../config/weapons.js'

// The attacker firing context ProjectilePool.acquire reads ({ cx, cy, facing }) — the live center +
// facing of whoever pulled the trigger (player or enemy). A local shape (no foundation type exports it).
interface ProjectileAttacker {
  cx: number
  cy: number
  facing: number
}

// An optional aimed/spread firing direction (Enrichment round 3): EITHER { angle } (radians) OR an
// explicit { vx, vy } velocity. Absent ⇒ the old pure-horizontal ±facing·speed behavior (identity).
interface ProjectileAim {
  angle?: number
  vx?: number
  vy?: number
}

// The hit-geometry shape GameScene's projectile hit handler reads off a live shot (review MAJOR).
interface ProjectileAttackerShape {
  cx: number
  facing: number
}

// The per-projectile combat context mutated on acquire (never re-allocated → no per-shot GC).
interface ProjectileContext {
  active: boolean
  ownerId: unknown
  ownerTag: string
  spec: ProjectileSpec | null
  status: WeaponStatus | null
  facing: number
  vx: number
  vy: number
  hitSet: Set<unknown>
  releaseTimer: number
  // per-weapon-movesets §6.5 (Decision 7, AC7) — how many more DISTINCT-enemy hits this shot survives before it
  // releases. Mutated on acquire (default 1 → "dies on first hit", the byte-identical identity). A CHARGED bow
  // shot acquires this = pierce.maxTargets → GameScene's projectile-hit handler decrements it and releases only
  // when it reaches 0 (the dedup hitSet already prevents re-hitting the same enemy, so it passes through a line).
  pierceLeft: number
  readonly attackerShape: ProjectileAttackerShape
}

// A pooled rectangle member carries its combat context on a `pj` property (parallels HitboxPool's `hb`).
type ProjectileRect = Phaser.GameObjects.Rectangle & { pj: ProjectileContext }

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
  private scene: Phaser.Scene
  private ownerTag: string
  group: Phaser.Physics.Arcade.Group
  private _items: ProjectileRect[]

  // ── onRelease(x, y, spec) (F4 enemy-roster, Decision 4 — the BOMBER impact-AoE seam) ── an OPTIONAL hook
  // fired ONCE per shot on a NATURAL release (lifetime / out-of-world in tick(), and the direct-hit release()
  // path), carrying the shot's last body center + its projectile spec. GameScene wires it for the ENEMY pool
  // to pop a Bomber's splash where its lob lands. UNDEFINED by default ⇒ ZERO behaviour change for the player
  // pool and every non-Bomber enemy shot (the additive identity). IMPORTANT (review BLOCKER): it is NOT fired
  // by releaseAll() — a level-rebuild teardown is not a 'land', and firing it there would apply damage at a
  // level boundary against the player mid-teardown (breaking the additive-identity claim). _disable takes a
  // `fireRelease` flag (default true for tick/release; false from releaseAll) that gates this exactly.
  onRelease?: (x: number, y: number, spec: ProjectileSpec | null) => void

  // scene: the GameScene. ownerTag: stamped on every shot ('player') so the overlap knows who fired.
  // size: pool high-water — a handful is plenty (the bow's recovery gates the fire rate well below it).
  constructor(scene: Phaser.Scene, ownerTag = 'player', size = 8) {
    this.scene = scene
    this.ownerTag = ownerTag

    // The overlap group GameScene registers against the enemy hurtbox group. No gravity, no separation
    // (overlap only). Members are parked+disabled until acquired.
    this.group = scene.physics.add.group({ allowGravity: false })

    this._items = []
    for (let i = 0; i < size; i++) {
      const rect = scene.add.rectangle(0, 0, 10, 6, PROJ_COLOR).setVisible(false) as ProjectileRect
      this.group.add(rect)
      const body = rect.body as Phaser.Physics.Arcade.Body
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
        pierceLeft: 1, // per-weapon-movesets §6.5 — default 1 (dies on first hit); a charged shot sets > 1.
        // attackerShape: read by GameScene's projectile hit handler — the SHOT's position + dir
        // (review MAJOR — NOT the player's). cx is the live body center; facing is the travel dir. For an
        // aimed/spread shot the horizontal travel sign (vx) is the authoritative facing (so a fan shot
        // that arcs left/right resolves its backstab/knockback geometry from where it's actually heading).
        get attackerShape(): ProjectileAttackerShape {
          const facing = this.vx !== 0 ? Math.sign(this.vx) : this.facing
          return { cx: (rect.body as Phaser.Physics.Arcade.Body).center.x, facing }
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
  // `pierce` (per-weapon-movesets §6.5, Decision 7 — optional, trailing): how many DISTINCT-enemy hits the
  // shot survives before releasing. Defaults to 1 so EVERY existing caller (the bow tap / shooter / boss
  // volley / turret) is byte-identical — "dies on first hit". A CHARGED bow shot passes pierce.maxTargets so
  // it threads a line of enemies (the hit handler decrements pierceLeft + releases at 0).
  acquire(
    attacker: ProjectileAttacker,
    spec: ProjectileSpec,
    ownerId: unknown,
    status: WeaponStatus | null = null,
    aim: ProjectileAim | null = null,
    pierce = 1,
  ): ProjectileRect | null {
    const rect = this._items.find((r) => !r.pj.active)
    if (!rect) return null

    const w = spec.w ?? 14
    const h = spec.h ?? 6
    const body = rect.body as Phaser.Physics.Arcade.Body
    // Resolve the 2-D travel velocity (vx, vy). Default (no aim): pure horizontal along facing (the old
    // behavior — identity). With an aim: either a velocity along the given angle, or an explicit (vx, vy).
    let vx: number
    let vy: number
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
    pj.pierceLeft = pierce // per-weapon-movesets §6.5 — 1 = dies on first hit (identity); > 1 = pierces a line.
    return rect
  }

  // ── Advance every live projectile by the GAMEPLAY dt (Decision 26 — 0 during hit-stop, so live
  // shots freeze with the world). Integrate position ourselves (exact freeze), release on lifetime or
  // when it leaves the generated world bounds (the scene sets this.worldBounds each level). ──
  tick(gdt: number) {
    const bounds = this.scene.physics.world.bounds
    for (const rect of this._items) {
      const pj = rect.pj
      if (!pj.active) continue
      pj.releaseTimer -= gdt
      const body = rect.body as Phaser.Physics.Arcade.Body
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
  release(rect: ProjectileRect | null | undefined) {
    if (rect && rect.pj.active) this._disable(rect)
  }

  // Force-release ALL live projectiles (used on a level rebuild so a frozen/in-flight shot doesn't
  // dangle across the teardown — mirrors HitboxPool.releaseAll). F4 (Decision 4, review BLOCKER): pass
  // fireRelease=false so onRelease does NOT fire on a teardown — a level-boundary rebuild is not a 'land',
  // and firing a Bomber splash here would apply damage to the player mid-teardown (the additive-identity break).
  releaseAll() {
    for (const rect of this._items) if (rect.pj.active) this._disable(rect, false)
  }

  // Disable a projectile back into the pool: kill its body, mark inactive, park it off-room. `fireRelease`
  // (default true — the NATURAL release path from tick()/release()) fires the onRelease hook BEFORE the spec
  // is nulled; releaseAll() passes false (a teardown is not a 'land' — review BLOCKER, Decision 4).
  _disable(rect: ProjectileRect, fireRelease = true) {
    // F4 enemy-roster (Decision 4) — fire the optional release hook ONCE, BEFORE we null pj.spec/park the body,
    // so a Bomber's lob pops its impact splash at the point it landed. Undefined hook ⇒ no-op (the identity).
    if (fireRelease && this.onRelease) {
      const body = rect.body as Phaser.Physics.Arcade.Body
      this.onRelease(body.center.x, body.center.y, rect.pj.spec)
    }
    rect.pj.active = false
    rect.pj.spec = null
    rect.pj.status = null // §6.13 — drop the stamped status so a recycled shot never carries a stale one.
    rect.pj.vx = 0 // clear the 2-D velocity so a recycled shot never inherits a stale arc.
    rect.pj.vy = 0
    rect.pj.pierceLeft = 1 // per-weapon-movesets §6.5 — reset so a recycled shot never inherits a stale pierce.
    const body = rect.body as Phaser.Physics.Arcade.Body
    body.setVelocity(0, 0)
    body.enable = false
    body.reset(-1000, -1000) // park well off-room so a stray broad-phase pass can't match it.
    rect.setVisible(false)
  }
}
