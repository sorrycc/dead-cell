import Phaser from 'phaser'
import type { SkillSpec } from '../config/skills.js'
import type { ProjectilePool } from '../combat/ProjectilePool.js'
import type { Enemy } from './Enemy.js'
import type { Boss } from './Boss.js'

// The live-target set a turret scans each fire beat (the scene threads it in on tick). enemies is the live
// per-level enemy list; boss is the optional finale/miniboss (NOT in enemies[]). Both are scanned so a
// turret in a boss room still has something to shoot.
interface DeployTickCtx {
  enemies: Enemy[]
  boss: Boss | null
  projectilePool: ProjectilePool
}

// Per-turret state mutated on acquire (never re-allocated → no per-deploy GC). Stamped onto the pooled
// Rectangle as `.dp`; tick() reads/decays it.
interface DeployState {
  active: boolean
  spec: SkillSpec | null
  lifeTimer: number // s — remaining deploy time (≤ 0 ⇒ released).
  fireTimer: number // s — time until the next shot (≤ 0 ⇒ fire + reset to spec.fireInterval).
  x: number // world center the turret sits at (the muzzle origin for its shots).
  y: number
}

// A pooled Rectangle carries its deploy state on `.dp` (the same dynamic-prop pattern HitboxPool's `.hb` /
// ProjectilePool's `.pj` use).
type DeployRect = Phaser.GameObjects.Rectangle & { dp: DeployState }

// ── DeployablePool (design 2026-06-13-skills-secondary-items §6.4, AC3 — the turret skill; the cut-line entity) ──
// Phaser-COUPLED — owns visible Arcade-less rects, so (like HitboxPool/ProjectilePool) it is NOT imported by
// verify-gen.mjs. Mirrors the mandated pooling convention EXACTLY (the discipline HitboxPool/ProjectilePool/
// PickupPool/ParticlePool follow): a FIXED set of pre-created stationary rectangles, acquired/released, ZERO
// per-deploy allocation after warm-up. A turret is the ONE new pooled entity skills add — `volley`/`blast`
// need NONE (they reuse ProjectilePool + a radial-damage helper).
//
// A deployed turret is purely a TIMER + a fire beat: it does NOT move, collide, or own a body. Each frame
// tick() decays each live turret's lifetime + fire timer; on a fire beat it finds the NEAREST live target
// (a linear scan over ctx.enemies + ctx.boss — ≤ ~8 targets, cheap, Decision 5) and fires a pooled
// ProjectilePool shot (the PLAYER pool, so the existing projectile→enemy overlap resolves the hit with NO
// new wiring) aimed at that target via the round-3 `aim:{angle}` 2-D fire path. A turret with no target in
// range simply holds its fire (no shot wasted) and keeps ticking down.
//
// HIT-STOP BOUNDARY (Decision 4): tick() takes the GAMEPLAY dt (`gdt`, driven to 0 during hit-stop / the
// shop pause), so a deployed turret FREEZES with the combat world — its lifetime + fire cadence pause
// exactly like every other gameplay timer. GameScene ticks it on gdt and releaseAll()s it on level teardown.

const DEPLOY_W = 18 // px — the turret body (a small square — programmer-art primitive).
const DEPLOY_H = 24 // px.
const DEPLOY_COLOR = 0xaed6f1 // light blue (matches the player projectile/swing-color cue; primitives only).
const FIRE_RANGE = 520 // px — a turret only fires at a target within this distance (else it holds fire).

export class DeployablePool {
  private scene: Phaser.Scene
  private _items: DeployRect[]

  // scene: the GameScene. size: pool high-water — a couple is plenty (a turret's cooldown gates re-deploy
  // well below it; recycling the oldest on exhaustion is cosmetic-only, never a leak).
  constructor(scene: Phaser.Scene, size = 4) {
    this.scene = scene
    this._items = []
    for (let i = 0; i < size; i++) {
      const rect = scene.add.rectangle(0, 0, DEPLOY_W, DEPLOY_H, DEPLOY_COLOR).setVisible(false).setDepth(35) as DeployRect
      // Per-turret state, mutated on acquire (never re-allocated → no per-deploy GC).
      rect.dp = { active: false, spec: null, lifeTimer: 0, fireTimer: 0, x: 0, y: 0 }
      this._disable(rect)
      this._items.push(rect)
    }
  }

  // ── acquire(x, y, spec) ── deploy a turret at (x, y) for spec.duration, firing every spec.fireInterval.
  // Returns the rect (or null if the pool is momentarily exhausted — sized so that never happens in normal
  // play; a dropped deploy is cosmetic, never a correctness bug).
  acquire(x: number, y: number, spec: SkillSpec): DeployRect | null {
    let rect = this._items.find((r) => !r.dp.active)
    if (!rect) {
      // Pool full: recycle the first (oldest-ish) — cosmetic loss only, never a leak.
      rect = this._items[0]
      this._disable(rect)
    }
    const dp = rect.dp
    dp.active = true
    dp.spec = spec
    dp.lifeTimer = spec.duration ?? 0
    dp.fireTimer = 0 // fire on the FIRST eligible beat (an immediate first shot reads "it's working").
    dp.x = x
    dp.y = y
    rect.setPosition(x, y)
    rect.setFillStyle(DEPLOY_COLOR)
    rect.setVisible(true)
    return rect
  }

  // ── tick(gdt, ctx) ── advance every live turret by the GAMEPLAY dt (0 during hit-stop / shop pause, so a
  // turret FREEZES with the world). Decay each turret's lifetime (release at ≤0) + its fire timer; on a fire
  // beat find the nearest live target in range and fire a pooled ProjectilePool shot aimed at it.
  tick(gdt: number, ctx: DeployTickCtx): void {
    for (const rect of this._items) {
      const dp = rect.dp
      if (!dp.active || !dp.spec) continue
      dp.lifeTimer -= gdt
      if (dp.lifeTimer <= 0) {
        this._disable(rect)
        continue
      }
      dp.fireTimer -= gdt
      if (dp.fireTimer > 0) continue
      // A fire beat: find the nearest live target. If none is in range, hold fire (don't waste the shot) but
      // keep the beat ready (don't reset the timer) so it fires the instant a target enters range.
      const target = this._nearestTarget(dp.x, dp.y, ctx)
      if (!target) continue
      dp.fireTimer = dp.spec.fireInterval ?? 0.7 // re-arm the cadence ONLY when a shot actually fires.
      if (!dp.spec.projectile) continue // a turret with no projectile spec can't shoot (defensive — verifier guards).
      const angle = Math.atan2(target.y - dp.y, target.x - dp.x)
      // Fire from the PLAYER pool so the existing projectile→enemy overlap resolves the hit with no new
      // wiring. The attacker shape is the TURRET's position + a facing derived from the aim; the 2-D
      // `aim:{angle}` path (round-3) makes the shot travel toward the target. ownerId 'player' so the shot's
      // status (if any) is applied by the player projectile-hit handler. The turret's status rides the shot.
      const facing = Math.cos(angle) >= 0 ? 1 : -1
      ctx.projectilePool.acquire(
        { cx: dp.x, cy: dp.y, facing },
        dp.spec.projectile,
        'player',
        dp.spec.status ?? null,
        { angle },
      )
    }
  }

  // ── _nearestTarget(x, y, ctx) ── the nearest live, hittable target (enemy or boss) within FIRE_RANGE of
  // (x, y), by squared distance (a linear scan — ≤ ~8 targets, cheap, Decision 5). Returns its center {x, y}
  // or null if none is in range. Skips dead/removed/un-hittable targets so a turret never fires at a corpse.
  private _nearestTarget(x: number, y: number, ctx: DeployTickCtx): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null
    let bestD2 = FIRE_RANGE * FIRE_RANGE
    const consider = (cx: number, cy: number) => {
      const dx = cx - x
      const dy = cy - y
      const d2 = dx * dx + dy * dy
      if (d2 <= bestD2) {
        bestD2 = d2
        best = { x: cx, y: cy }
      }
    }
    for (const e of ctx.enemies) {
      if (!e || e.dead || e.removed || !e.isHittable()) continue
      consider(e.body.center.x, e.body.center.y)
    }
    const boss = ctx.boss
    if (boss && !boss.dead && !boss.removed && boss.isHittable()) {
      consider(boss.body.center.x, boss.body.center.y)
    }
    return best
  }

  // Release ALL live turrets (level rebuild teardown — they don't carry across levels; mirrors the other
  // pools' releaseAll). Also called when the player redeploys / on scene teardown.
  releaseAll(): void {
    for (const rect of this._items) if (rect.dp.active) this._disable(rect)
  }

  // Disable a turret back into the pool: mark inactive, drop its spec, park it off-room + hidden.
  private _disable(rect: DeployRect): void {
    const dp = rect.dp
    dp.active = false
    dp.spec = null
    dp.lifeTimer = 0
    dp.fireTimer = 0
    rect.setVisible(false)
    rect.setPosition(-1000, -1000)
  }
}
