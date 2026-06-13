import type Phaser from 'phaser'
import { ParticlePool } from './ParticlePool.js'

// ── Juice façade (design §6.3, Decision 23/24, AC25) ──
// ONE call site per impact: GameScene's overlap callbacks call `effects.hit(x, y, opts)` and get
// sparks + a floating damage number + a screen shake + a hit-stop REQUEST, all parameterized by
// hit strength + crit. This is the single juice façade (SOLID): the hit sites never touch the
// pool / camera / hit-stop timer directly. Mirrors crowd-runner's effects/Effects.js role.
//
// HIT-STOP OWNERSHIP (Decision 24/26 — review BLOCKER #2): the hit-stop TIMER lives on GameScene
// (it gates the gameplay dt the whole world reads). Effects does not own that boundary; it only
// REQUESTS a duration via a callback the scene supplies (`onHitstop`). The scene caps + de-dupes
// it (no stacking). Sparks/numbers tick on REAL dt so the impact "pops" WHILE the world freezes.

const SPARK_COLOR = 0xffe066 // normal hit spark (warm yellow).
const SPARK_COLOR_CRIT = 0xff6bd6 // backstab spark (magenta — distinct, AC22).
const NUMBER_COLOR = '#ffe066' // normal damage number.
const NUMBER_COLOR_CRIT = '#ff6bd6' // backstab number (crit-colored, AC22).

// Shake + hit-stop are scaled by damage so a finisher/backstab crunches harder than a jab.
const SHAKE_BASE_MS = 70 // ms — base shake duration.
const SHAKE_BASE_INTENSITY = 0.004 // base shake intensity (fraction of viewport).
const HITSTOP_BASE = 0.035 // s — base freeze on a normal hit (a few frames).
const HITSTOP_CRIT = 0.07 // s — longer freeze on a backstab (the "crunch", Decision 24).
const DAMAGE_REF = 16 // hp — reference damage (the finisher) that the scalars are tuned around.

export class Effects {
  private scene: Phaser.Scene
  private pool: ParticlePool
  private _onHitstop: (seconds: number) => void

  // scene: GameScene. onHitstop: a callback the scene supplies — `(seconds) => void` — that arms
  // the scene-owned hit-stop timer (capped/de-duped there). Effects never freezes time itself.
  constructor(scene: Phaser.Scene, onHitstop?: (seconds: number) => void) {
    this.scene = scene
    this.pool = new ParticlePool(scene)
    this._onHitstop = onHitstop || (() => {})
  }

  // ── The single impact call (AC25). (x,y) = impact point (the victim center). opts:
  //   damage      — drives spark count, number value, shake + hit-stop strength.
  //   isBackstab  — crit color + bigger number + more sparks + longer freeze. ──
  hit(x: number, y: number, { damage = 0, isBackstab = false }: { damage?: number; isBackstab?: boolean } = {}) {
    // Strength ratio in [~0.4, ~1+]: scales FX so a jab and a finisher feel different.
    const strength = Math.max(0.4, damage / DAMAGE_REF)

    // Sparks: more + crit-colored + faster on a backstab.
    this.pool.spawnSparks(x, y, {
      count: Math.round((isBackstab ? 16 : 8) * strength),
      color: isBackstab ? SPARK_COLOR_CRIT : SPARK_COLOR,
      speed: (isBackstab ? 340 : 260) * (0.8 + 0.4 * strength),
    })

    // Floating number: crit-colored + bigger on a backstab.
    this.pool.spawnNumber(x, y - 24, damage, {
      color: isBackstab ? NUMBER_COLOR_CRIT : NUMBER_COLOR,
      scale: isBackstab ? 1.5 : 1,
    })

    // Screen shake: scaled by strength, punchier on a crit. Phaser applies it framerate-aware.
    const shakeMs = SHAKE_BASE_MS * strength * (isBackstab ? 1.5 : 1)
    const shakeIntensity = SHAKE_BASE_INTENSITY * strength * (isBackstab ? 1.6 : 1)
    this.scene.cameras.main.shake(shakeMs, shakeIntensity)

    // Hit-stop REQUEST (scene arms + caps it): a brief micro-freeze, longer on a crit (Decision 24).
    this._onHitstop(isBackstab ? HITSTOP_CRIT : HITSTOP_BASE)
  }

  // ── statusTick(x, y, damage, kind) (design §6.13, Decision 79, AC66) ── a SMALL over-time-damage pop for
  // a bleed/poison tick: a few kind-tinted sparks + a small floating number, NO shake / NO hit-stop (DoT is
  // ambient chip damage, not an impact — it must not jitter the camera or freeze the world every tick). The
  // tint reads the status: bleed = dark red, poison = sickly green. Reuses the SAME pooled sparks/number
  // path (DRY, no new allocation). Called throttled by Enemy._tickStatus (~5/s) so it reads without churn.
  statusTick(x: number, y: number, damage = 0, kind: 'bleed' | 'poison' = 'bleed') {
    const color = kind === 'poison' ? 0x2ecc71 : 0xc0392b
    const numColor = kind === 'poison' ? '#2ecc71' : '#e74c3c'
    this.pool.spawnSparks(x, y, { count: 4, color, speed: 150 })
    this.pool.spawnNumber(x, y - 18, damage, { color: numColor, scale: 0.8 })
  }

  // Forward the per-frame tick to the pool. REAL dt (the freeze must not pause the pop).
  tick(dt: number) {
    this.pool.tick(dt)
  }
}
