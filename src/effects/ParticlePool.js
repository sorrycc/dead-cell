import Phaser from 'phaser'

// ── Pooled hit FX: sparks + floating damage numbers (design §6.3, Decision 23, AC25) ──
// The mandated pooling convention applied to game-feel: a FIXED pool of small spark rectangles
// and a FIXED pool of floating damage-number Text objects, both pre-created once and only ever
// reset — ZERO per-hit allocation after warm-up (so sustained combat shows no GC stutter, AC25).
// Faithful sibling of crowd-runner's effects/ParticlePool.js (flat per-slot state, a free-slot
// scan, scale/alpha = life ratio), ported to Phaser 2D primitives.
//
// dt: this ticks on REAL dt (the world's micro-freeze hit-stop should NOT freeze the spark/number
// pop — the impact "pops" WHILE the world is frozen, Decision 24/26). GameScene passes real dt.

const SPARK_GRAVITY = 900 // px/s² — sparks arc down so the burst reads as debris.
const SPARK_DRAG = 2.4 // 1/s — exponential velocity decay so sparks slow as they fade.
const NUMBER_RISE = 70 // px/s — floating numbers drift UP.
const NUMBER_LIFE = 0.7 // s — how long a damage number lives before returning to the pool.

export class ParticlePool {
  // scene: the GameScene. sparkCap / numberCap: pool high-water (sized for worst-case concurrent
  // on-screen hits; if exhausted the OLDEST is recycled so we never allocate mid-combat).
  constructor(scene, { sparkCap = 96, numberCap = 16 } = {}) {
    this.scene = scene

    // ── Spark pool ── flat parallel state (no per-spark object in the hot path).
    this.sparkCap = sparkCap
    this._sparks = []
    this._sx = new Float32Array(sparkCap)
    this._sy = new Float32Array(sparkCap)
    this._svx = new Float32Array(sparkCap)
    this._svy = new Float32Array(sparkCap)
    this._slife = new Float32Array(sparkCap)
    this._smax = new Float32Array(sparkCap)
    this._sactive = new Array(sparkCap).fill(false)
    this._sscale = new Float32Array(sparkCap) // spawn scale (base 6px rect → chosen size).
    this._sNext = 0
    for (let i = 0; i < sparkCap; i++) {
      const r = scene.add.rectangle(0, 0, 6, 6, 0xffffff).setVisible(false).setDepth(50)
      this._sparks.push(r)
    }

    // ── Floating-number pool ── reused Text objects (canvas redraw ONLY on (re)spawn, never per
    // frame — setText is the only expensive call and it happens once per pop).
    this.numberCap = numberCap
    this._numbers = []
    for (let i = 0; i < numberCap; i++) {
      const t = scene.add
        .text(0, 0, '', { fontFamily: 'monospace', fontSize: '22px', color: '#ffffff', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setVisible(false)
        .setDepth(60)
      t.fx = { active: false, life: 0, maxLife: NUMBER_LIFE }
      this._numbers.push(t)
    }
    this._nNext = 0
  }

  // ── Emit a spark burst at (x,y). count + color + speed scale with hit strength (Effects sets
  // them). Each spark gets a randomized velocity in a cone + a short life. ──
  spawnSparks(x, y, { count = 8, color = 0xffe066, speed = 260 } = {}) {
    for (let k = 0; k < count; k++) {
      const slot = this._acquireSpark()
      const angle = Math.random() * Math.PI * 2
      const s = speed * (0.4 + Math.random() * 0.8)
      const life = 0.18 + Math.random() * 0.22
      const size = 3 + Math.random() * 4
      this._sx[slot] = x
      this._sy[slot] = y
      this._svx[slot] = Math.cos(angle) * s
      this._svy[slot] = Math.sin(angle) * s - speed * 0.3 // bias slightly UP so it sprays.
      this._slife[slot] = life
      this._smax[slot] = life
      // Store the spawn SCALE (base rect is 6px; scale to the chosen size). We shrink via setScale
      // in tick — NOT setSize — so we never regenerate the rect geometry per frame (cheaper).
      this._sscale[slot] = size / 6
      const r = this._sparks[slot]
      r.setFillStyle(color)
      r.setScale(this._sscale[slot])
      r.setPosition(x, y)
      r.setAlpha(1)
      r.setVisible(true)
      r.setActive(true)
    }
  }

  // ── Pop a floating damage number at (x,y). color + bigger on crit (Effects sets them). ──
  spawnNumber(x, y, value, { color = '#ffffff', scale = 1 } = {}) {
    const slot = this._acquireNumber()
    const t = this._numbers[slot]
    t.setText(String(value)) // the ONE canvas redraw — only on spawn.
    t.setColor(color)
    const size = Math.round(22 * scale)
    t.setFontSize(size)
    t.setPosition(x + (Math.random() - 0.5) * 12, y)
    t.setAlpha(1)
    t.setScale(1)
    t.setVisible(true)
    t.setActive(true)
    t.fx.active = true
    t.fx.life = NUMBER_LIFE
    t.fx.maxLife = NUMBER_LIFE
  }

  // ── Advance every live spark + number on REAL dt; return finished ones to the pool. ──
  tick(dt) {
    // Sparks: integrate velocity (gravity + exponential drag), shrink + fade by life ratio.
    const drag = Math.exp(-SPARK_DRAG * dt)
    for (let i = 0; i < this.sparkCap; i++) {
      if (!this._sactive[i]) continue
      this._svy[i] += SPARK_GRAVITY * dt
      this._svx[i] *= drag
      this._svy[i] *= drag
      this._sx[i] += this._svx[i] * dt
      this._sy[i] += this._svy[i] * dt
      this._slife[i] -= dt
      const r = this._sparks[i]
      if (this._slife[i] <= 0) {
        this._sactive[i] = false
        r.setVisible(false).setActive(false)
        continue
      }
      const k = this._slife[i] / this._smax[i] // 1 → 0
      r.setPosition(this._sx[i], this._sy[i])
      r.setAlpha(k)
      r.setScale(this._sscale[i] * k) // shrink via scale (no geometry regen).
    }

    // Numbers: rise + fade; a tiny pop-then-settle scale for punch.
    for (const t of this._numbers) {
      const fx = t.fx
      if (!fx.active) continue
      fx.life -= dt
      if (fx.life <= 0) {
        fx.active = false
        t.setVisible(false).setActive(false)
        continue
      }
      const k = fx.life / fx.maxLife // 1 → 0
      t.y -= NUMBER_RISE * dt
      t.setAlpha(k)
      t.setScale(0.9 + 0.25 * k) // starts a touch big, eases down as it fades.
    }
  }

  // Acquire a free spark slot (or recycle the oldest via the rotating cursor — never allocates).
  _acquireSpark() {
    for (let n = 0; n < this.sparkCap; n++) {
      const i = (this._sNext + n) % this.sparkCap
      if (!this._sactive[i]) {
        this._sNext = (i + 1) % this.sparkCap
        this._sactive[i] = true
        return i
      }
    }
    // Pool full: recycle the cursor slot (oldest-ish). Cosmetic loss only, never a leak.
    const i = this._sNext
    this._sNext = (i + 1) % this.sparkCap
    this._sactive[i] = true
    return i
  }

  // Acquire a free number slot (or recycle the rotating cursor).
  _acquireNumber() {
    for (let n = 0; n < this.numberCap; n++) {
      const i = (this._nNext + n) % this.numberCap
      if (!this._numbers[i].fx.active) {
        this._nNext = (i + 1) % this.numberCap
        return i
      }
    }
    const i = this._nNext
    this._nNext = (i + 1) % this.numberCap
    return i
  }
}
