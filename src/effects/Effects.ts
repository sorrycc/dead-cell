import type Phaser from 'phaser'
import { ParticlePool } from './ParticlePool.js'
import { STATUS_TINT } from '../combat/statusColors.js'
import type { StatusKind } from '../combat/status.js'

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
const PARRY_COLOR = 0x5ad6ff // bright cyan — the parry spark color (distinct from hit/crit/status tints, AC8).
const PARRY_COLOR_STR = '#5ad6ff' // the parry "PARRY!" label color (the CSS-hex twin of PARRY_COLOR).

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

  // ── statusTick(x, y, damage, kind) (design §6.13, Decision 79, AC66; affliction-synergy adds 'burn') ── a
  // SMALL over-time-damage pop for a bleed/poison/burn tick: a few kind-tinted sparks + a small floating
  // number, NO shake / NO hit-stop (DoT is ambient chip damage, not an impact — it must not jitter the camera
  // or freeze the world every tick). The tint reads the status (the SHARED STATUS_TINT table — DRY): bleed
  // dark-red, poison green, burn orange. Reuses the SAME pooled sparks/number path (no new allocation).
  // Called throttled by Enemy/Boss._tickStatus (~5/s) so it reads without churn.
  statusTick(x: number, y: number, damage = 0, kind: StatusKind = 'bleed') {
    const color = STATUS_TINT[kind]
    this.pool.spawnSparks(x, y, { count: 4, color, speed: 150 })
    this.pool.spawnNumber(x, y - 18, damage, { color: hexStr(color), scale: 0.8 })
  }

  // ── statusApply(x, y, kind) (affliction-synergy §6.8, AC8) ── a ONE-SHOT floating kind LABEL ("BLEED"/
  // "POISON"/"STUN"/"BURN") popped once when a status is FIRST applied to an enemy/boss (the ONSET cue) — NOT
  // on every DoT tick (that's statusTick). NO shake / NO hit-stop (it marks an onset, not an impact). Reuses
  // ParticlePool.spawnNumber as-is — its `value` accepts a string, so it renders the kind label with no new
  // pool method (DRY, KISS). GameScene computes "is this a NEW application?" at the hit site (Decision 4) and
  // only calls this on a NEW entry, so a refresh (re-hit on an already-afflicted enemy) does NOT re-pop.
  statusApply(x: number, y: number, kind: StatusKind) {
    this.pool.spawnNumber(x, y - 28, kind.toUpperCase(), { color: hexStr(STATUS_TINT[kind]), scale: 0.85 })
  }

  // ── parry(x, y) (per-weapon-movesets §6.6, Decision 5, AC8) ── the SUCCESSFUL-PARRY cue: a one-shot bright
  // cyan "PARRY!" label (reuses ParticlePool.spawnNumber with a string value, exactly like statusApply) plus a
  // few cyan sparks. NO shake / NO hit-stop — a parry is a defensive READ, not an impact (it must not jitter
  // the camera or freeze the world). A small camera flash is the scene's job (it owns the camera). Reuses the
  // SAME pooled sparks/number path (no new allocation, no new FX primitive — DRY).
  parry(x: number, y: number) {
    this.pool.spawnSparks(x, y, { count: 10, color: PARRY_COLOR, speed: 240 })
    this.pool.spawnNumber(x, y - 28, 'PARRY!', { color: PARRY_COLOR_STR, scale: 1.1 })
  }

  // Forward the per-frame tick to the pool. REAL dt (the freeze must not pause the pop).
  tick(dt: number) {
    this.pool.tick(dt)
  }
}

// ── hexStr(int) → '#rrggbb' ── the floating-number pool takes a CSS hex STRING, but the shared STATUS_TINT
// table stores Phaser RGB INTS (the form the sparks/body cascade need). One tiny converter keeps STATUS_TINT
// the single source for the four colours (DRY) instead of a parallel string table. PURE.
function hexStr(int: number): string {
  return '#' + (int & 0xffffff).toString(16).padStart(6, '0')
}
