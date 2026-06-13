import type Phaser from 'phaser'

// ── Procedural SFX façade (design 2026-06-13-audio-sfx §6.1, Decisions 1–7, AC1–AC9) ──
// The audio twin of effects/Effects.ts: ONE semantic call per event (sound.jump(),
// sound.hit({damage, crit})) with all the WebAudio synthesis hidden behind it (SOLID). Hit sites
// never touch the audio graph — they call a named method, exactly as the visual juice façade is
// called at every impact. The project ships NO audio assets (programmer-art primitives only), so
// every sound is SYNTHESIZED at runtime from OscillatorNodes + a short noise buffer through gain
// envelopes — the audio equivalent of "colored rectangles", ZERO assets, no `load.*` calls.
//
// CONTEXT SOURCE (Decision 1): we reuse Phaser's ONE shared AudioContext (scene.sound.context)
// rather than newing our own — Phaser owns a single WebAudioSoundManager across all scenes and
// already resumes it on the first user gesture (the Title requires a click/key to advance, so the
// context is running before any gameplay sound plays). scene.sound.mute/.volume integrate for free.
// FALLBACK (AC7): under a NoAudioSoundManager (headless / `verify` / a NoAudio browser) there is no
// `.context` → we store ctx = null and EVERY method early-returns. The whole class is then a safe
// silent no-op that never throws — so a Player/scene constructed without WebAudio behaves identically.
//
// SCHEDULING (Decision 5): every sound schedules on the WebAudio clock (ctx.currentTime), NOT the
// gameplay dt — so the impact "pop" is audible DURING a hit-stop micro-freeze (mirrors how Effects
// runs sparks/numbers on real dt while the world is frozen). No coupling to the hit-stop timer.
//
// ALLOCATION (AC9): each sound makes a handful of short-lived OscillatorNode/GainNode/noise nodes
// that auto-disconnect on `stop` and are GC'd — no steady-state churn, the same fire-and-forget
// shape ParticlePool's transients have. A per-key throttle (_gateOk) collapses a multi-hit frame
// (e.g. a spitter fan landing 3 hits) into ONE transient so stacked sounds never pile up.

// ── Master level + soft headroom (Decision 4) ── one master GainNode per instance → destination,
// base level kept well under 1 so several transients in one frame don't clip. Multiplied by the live
// Phaser global volume each sound, and skipped entirely when muted.
const MASTER_GAIN = 0.32 // base master level (× scene.sound.volume per sound).
const THROTTLE_GAP = 0.03 // s — per-key min interval on the WebAudio clock (Decision 6 — the pile-up guard).

// A minimal AudioContext shape — we only ever touch this subset. Typed locally so the file needs no
// lib.dom WebAudio ambient beyond what TS already provides (AudioContext is a DOM global).
type Ctx = AudioContext

// Tone params for the _tone primitive (an oscillator → gain envelope, optional linear freq sweep).
interface ToneOpts {
  freq: number // start frequency (Hz).
  type?: OscillatorType // 'sine' | 'square' | 'sawtooth' | 'triangle' (default 'square').
  dur?: number // total duration (s) — the gain decays to ~0 over it.
  gain?: number // peak gain (pre-master) — scaled by MASTER_GAIN × global volume.
  sweepTo?: number // optional end frequency (Hz) — a linear ramp from freq over dur.
  delay?: number // optional start offset (s) from now — for layering/flourishes.
  attack?: number // optional attack time (s) before the exponential decay (default tiny).
}

// Noise params for the _noise primitive (a white-noise buffer → biquad filter → gain envelope).
interface NoiseOpts {
  dur?: number // duration (s).
  gain?: number // peak gain (pre-master).
  type?: BiquadFilterType // filter type ('lowpass' | 'highpass' | 'bandpass'); default 'lowpass'.
  freq?: number // filter cutoff/center (Hz).
  delay?: number // optional start offset (s) from now.
}

export class Sound {
  private sm: Phaser.Sound.BaseSoundManager
  private ctx: Ctx | null
  private master: GainNode | null
  private _last: Record<string, number> // per-key throttle stamps on the ctx clock (Decision 6).

  // scene: any Phaser.Scene (every scene shares Phaser's ONE sound manager / context). We grab the
  // WebAudio context off the manager; if it's absent (NoAudio) the whole façade no-ops (AC7).
  constructor(scene: Phaser.Scene) {
    this.sm = scene.sound
    // WebAudio only: NoAudioSoundManager lacks `.context`. Guard on createOscillator so a half-shaped
    // / stubbed manager (e.g. a test double) still degrades to silence rather than throwing later.
    const ctx = (this.sm as unknown as { context?: Ctx }).context ?? null
    this.ctx = ctx && typeof ctx.createOscillator === 'function' ? ctx : null
    this.master = this.ctx ? this.ctx.createGain() : null
    if (this.master && this.ctx) this.master.connect(this.ctx.destination)
    this._last = {}
  }

  // ── Mute proxy (Decision 7, AC7) ── reads/writes Phaser's GLOBAL mute (game.sound.mute) so the M
  // toggle flips audio everywhere at once (and a Phaser-level mute is respected automatically — every
  // sound checks `this.sm.mute` before playing). KISS: the façade owns no separate mute flag.
  get mute(): boolean {
    return this.sm.mute
  }
  set mute(v: boolean) {
    this.sm.mute = v
  }

  // ── _gateOk(key, minGap) ── the shared guard EVERY semantic method calls first: returns false (so
  // the method bails to silence) when there is no WebAudio context (AC7), Phaser is muted (AC7), OR
  // the same key fired within `minGap` seconds (the throttle, Decision 6 — collapses a multi-hit
  // frame into one transient). When it returns true it stamps the ctx-clock time for the next call.
  private _gateOk(key: string, minGap = THROTTLE_GAP): boolean {
    if (!this.ctx || !this.master || this.sm.mute) return false
    const now = this.ctx.currentTime
    const last = this._last[key] ?? -Infinity
    if (now - last < minGap) return false
    this._last[key] = now
    return true
  }

  // ── _tone(o) (Decision 3) ── an OscillatorNode → its own GainNode (a short attack + exponential
  // decay to silence, optional linear frequency sweep) → master. Fire-and-forget: scheduled on the
  // ctx clock and auto-stopped, so it disconnects + GCs on its own (no pooling needed for a <0.5s
  // transient). Caller MUST have passed _gateOk first (so ctx/master are non-null here).
  private _tone(o: ToneOpts): void {
    const ctx = this.ctx!
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const dur = o.dur ?? 0.12
    const attack = Math.min(o.attack ?? 0.004, dur * 0.5)
    const peak = (o.gain ?? 0.5) * MASTER_GAIN * this.sm.volume
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = o.type ?? 'square'
    osc.frequency.setValueAtTime(o.freq, t0)
    if (o.sweepTo != null) osc.frequency.linearRampToValueAtTime(o.sweepTo, t0 + dur)
    // Envelope: ramp up over the (tiny) attack, then exponential decay to a near-zero floor (an
    // exponential ramp can't reach exactly 0, so we target a small epsilon for a clean tail).
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g)
    g.connect(this.master!)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  // ── _noise(o) (Decision 3) ── a small white-noise buffer → a BiquadFilter (shapes it: a lowpass
  // thud, a highpass hiss) → a GainNode envelope → master. Used for impacts/whooshes where a pure
  // tone reads too "clean". The buffer is allocated per call (a few hundred samples) and GC'd with
  // the source — fine for a transient (AC9: no steady-state churn, just short-lived nodes).
  private _noise(o: NoiseOpts): void {
    const ctx = this.ctx!
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const dur = o.dur ?? 0.12
    const peak = (o.gain ?? 0.4) * MASTER_GAIN * this.sm.volume
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur))
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1 // white noise (off the seeded RNG — Decision 6).
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = o.type ?? 'lowpass'
    filter.frequency.setValueAtTime(o.freq ?? 1200, t0)
    const g = ctx.createGain()
    g.gain.setValueAtTime(peak, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(filter)
    filter.connect(g)
    g.connect(this.master!)
    src.start(t0)
    src.stop(t0 + dur + 0.02)
  }

  // ── Semantic SFX (one method per event, AC2–AC6) ── each early-returns via _gateOk (no ctx / muted
  // / throttled → silence), then composes the two primitives. Distinct timbres so events read by ear.

  // MELEE swing whoosh (movement, AC3). Timbre varies by weapon (hammer = low + heavy, spear =
  // high + quick, sword = mid). `weapon` is the weapon id ('sword'/'hammer'/'spear'); an unknown id
  // falls back to the sword profile (KISS — the façade never needs the weapon config).
  swing(weapon: string): void {
    if (!this._gateOk('swing')) return
    // A short filtered-noise whoosh + a faint tonal body, pitched by weapon weight.
    let freq = 1500 // sword (mid).
    let tone = 320
    if (weapon === 'hammer') {
      freq = 700 // a low, heavy swoosh.
      tone = 150
    } else if (weapon === 'spear') {
      freq = 2400 // a high, quick thrust.
      tone = 480
    }
    this._noise({ dur: 0.1, gain: 0.45, type: 'bandpass', freq })
    this._tone({ freq: tone, type: 'triangle', dur: 0.09, gain: 0.18, sweepTo: tone * 0.6 })
  }

  // BOW shot (movement, AC3) — a quick downward twang (a plucked string reads as a falling sweep).
  shoot(): void {
    if (!this._gateOk('shoot')) return
    this._tone({ freq: 900, type: 'sawtooth', dur: 0.14, gain: 0.32, sweepTo: 300 })
    this._noise({ dur: 0.05, gain: 0.2, type: 'highpass', freq: 3000 }) // the string's release hiss.
  }

  // COMBAT hit (AC2) — a noise thud + a tonal stab, brightness/volume scaled by damage; a BACKSTAB/
  // crit gets a brighter timbre + an added high "ring" so the finisher/crit sounds distinct (AC2).
  // Shared by the player melee AND the projectile hit sites (one timbre for "I connected").
  hit({ damage = 0, crit = false }: { damage?: number; crit?: boolean } = {}): void {
    if (!this._gateOk('hit')) return
    // Strength in ~[0.5, ~1.3]: louder + brighter as damage rises (mirrors Effects' DAMAGE_REF scaling).
    const strength = Math.max(0.5, Math.min(1.4, damage / 16))
    this._noise({ dur: 0.08, gain: 0.5 * strength, type: 'lowpass', freq: (crit ? 1800 : 900) * strength })
    this._tone({ freq: (crit ? 420 : 260) * strength, type: 'square', dur: 0.09, gain: 0.28 * strength, sweepTo: (crit ? 180 : 110) })
    // The crit "ring" — a bright high blip layered on so a backstab/finisher reads by ear (AC2).
    if (crit) this._tone({ freq: 1600, type: 'sine', dur: 0.16, gain: 0.18, sweepTo: 2200, delay: 0.01 })
  }

  // PLAYER hurt (AC2) — a harsh descending square blip (distinct from dealing a hit: it's down-swept
  // and rougher so taking damage reads differently from connecting).
  hurt(): void {
    if (!this._gateOk('hurt')) return
    this._tone({ freq: 380, type: 'square', dur: 0.18, gain: 0.36, sweepTo: 90 })
    this._noise({ dur: 0.1, gain: 0.22, type: 'lowpass', freq: 600 })
  }

  // ENEMY death (AC2) — a short downward noise + tone (a body crumpling).
  enemyDie(): void {
    if (!this._gateOk('enemyDie')) return
    this._tone({ freq: 300, type: 'sawtooth', dur: 0.2, gain: 0.26, sweepTo: 70 })
    this._noise({ dur: 0.16, gain: 0.24, type: 'lowpass', freq: 500 })
  }

  // ── Movement (AC3) ── jump/double-jump/dodge/land. Short, soft, off the combat timbres so they
  // don't fight the impact sounds.
  jump(): void {
    if (!this._gateOk('jump')) return
    this._tone({ freq: 280, type: 'square', dur: 0.12, gain: 0.24, sweepTo: 560 }) // an upward chirp.
  }
  // A brighter twin of jump() so the second (air) leap reads distinct from the first (movement-depth
  // §6, AC4). Wired at the air-jump launch in Player.update — null-safe like every method.
  doubleJump(): void {
    if (!this._gateOk('doubleJump')) return
    this._tone({ freq: 420, type: 'square', dur: 0.12, gain: 0.22, sweepTo: 820 })
  }
  // WALL-JUMP (movement-depth §6, AC4) — a punchy kick-off: a short scuff-noise (boot off the wall)
  // layered under an upward chirp pitched between jump() and doubleJump() so the wall launch reads
  // distinct from both the ground jump and the air jump by ear. Null-safe like every method.
  wallJump(): void {
    if (!this._gateOk('wallJump')) return
    this._noise({ dur: 0.06, gain: 0.22, type: 'bandpass', freq: 1600 }) // the scuff off the wall.
    this._tone({ freq: 340, type: 'square', dur: 0.12, gain: 0.22, sweepTo: 700 }) // the kick-off chirp.
  }
  // WALL-SLIDE tell (movement-depth §6, AC2) — a quiet, repeated friction scuff while clinging. Player
  // calls it every frame it slides; the per-key throttle (a wide gap below) collapses that into a soft
  // recurring scrape rather than a per-frame buzz (the throttled audio tell). A faint low-passed noise
  // hiss (a body dragging down stone) — much quieter than the jump cues so it never fights combat. The
  // wide minGap (≫ THROTTLE_GAP) spaces the scrapes out so they read as friction, not a stutter.
  wallSlide(): void {
    if (!this._gateOk('wallSlide', 0.14)) return
    this._noise({ dur: 0.1, gain: 0.12, type: 'lowpass', freq: 900 })
  }
  dodge(): void {
    if (!this._gateOk('dodge')) return
    this._noise({ dur: 0.16, gain: 0.34, type: 'bandpass', freq: 1800 }) // a quick airy roll whoosh.
    this._tone({ freq: 600, type: 'triangle', dur: 0.1, gain: 0.14, sweepTo: 1100 })
  }
  land(): void {
    if (!this._gateOk('land')) return
    this._noise({ dur: 0.08, gain: 0.3, type: 'lowpass', freq: 360 }) // a soft thud on touchdown.
  }

  // ── Economy / feedback (AC4) ── pickup (timbre per kind), flask drink, weapon swap.
  // pickup(kind): an ascending blip whose pitch reads the kind (cell/gold/scroll/weapon/heal). An
  // unknown kind falls back to the cell pitch (KISS).
  pickup(kind: string): void {
    if (!this._gateOk('pickup')) return
    // Per-kind base pitch — distinct enough to tell a cell from gold from a scroll by ear.
    const base: Record<string, number> = { cell: 720, gold: 880, scroll: 560, weapon: 480, heal: 640, blueprint: 1000 }
    const f = base[kind] ?? 720
    this._tone({ freq: f, type: 'square', dur: 0.1, gain: 0.22, sweepTo: f * 1.6 }) // ascending = "gained".
  }
  // flask drink (AC4) — a soft rising "glug + refresh" so a heal reads as recovery.
  flask(): void {
    if (!this._gateOk('flask')) return
    this._tone({ freq: 320, type: 'sine', dur: 0.18, gain: 0.26, sweepTo: 660 })
    this._tone({ freq: 480, type: 'sine', dur: 0.14, gain: 0.16, sweepTo: 900, delay: 0.06 })
  }
  // weapon swap (AC4) — a quick two-tone "click-clack" so changing moveset reads.
  swap(): void {
    if (!this._gateOk('swap')) return
    this._tone({ freq: 620, type: 'square', dur: 0.05, gain: 0.2 })
    this._tone({ freq: 880, type: 'square', dur: 0.06, gain: 0.2, delay: 0.05 })
  }

  // SKILL use (skills slice, AC3) — a short cue per skill KIND so firing a skill reads distinct from a swing
  // by ear: volley = a quick rising throw-whoosh; blast = a low boom + noise thump; turret = a mechanical
  // two-tone deploy click. An unknown kind falls back to the volley profile (KISS — the façade never needs
  // the skill config). Null-safe like every method (a silent no-op under NoAudio).
  skill(kind: string): void {
    if (!this._gateOk('skill')) return
    if (kind === 'blast') {
      this._tone({ freq: 160, type: 'sawtooth', dur: 0.26, gain: 0.36, sweepTo: 60 }) // a low boom.
      this._noise({ dur: 0.16, gain: 0.3, type: 'lowpass', freq: 500 })
    } else if (kind === 'turret') {
      this._tone({ freq: 520, type: 'square', dur: 0.06, gain: 0.22 }) // a mechanical deploy click-clack.
      this._tone({ freq: 360, type: 'square', dur: 0.08, gain: 0.2, delay: 0.06, sweepTo: 300 })
    } else {
      // volley (default) — a quick airy throw-whoosh + a faint rising tone.
      this._noise({ dur: 0.1, gain: 0.34, type: 'bandpass', freq: 2200 })
      this._tone({ freq: 480, type: 'triangle', dur: 0.1, gain: 0.18, sweepTo: 760 })
    }
  }

  // ── Per-weapon movesets (per-weapon-movesets §6.6, Decision 5/8) ── parry arm + parry success + charge-ready.
  // All null-safe (no ctx / muted / throttled → silence) and procedural (no assets), mirroring every other blip.

  // PARRY ARM (AC8) — a rising "ting" when the parry window opens (you committed to the timing read).
  parry(): void {
    if (!this._gateOk('parry')) return
    this._tone({ freq: 700, type: 'triangle', dur: 0.08, gain: 0.2, sweepTo: 1200 })
  }
  // PARRY SUCCESS (AC8) — a brighter metallic "clang" + a high ring when a hit is negated in the window (the
  // satisfying deflect — distinct from a normal hit/hurt so a perfect parry reads by ear).
  parrySuccess(): void {
    if (!this._gateOk('parrySuccess')) return
    this._noise({ dur: 0.07, gain: 0.34, type: 'bandpass', freq: 2600 }) // the metallic clang.
    this._tone({ freq: 1400, type: 'sine', dur: 0.18, gain: 0.22, sweepTo: 2400, delay: 0.01 }) // the high ring.
  }
  // CHARGE READY (AC4/AC7) — a soft blip when a held charge crosses its threshold (the smash/shot is ready).
  chargeReady(): void {
    if (!this._gateOk('chargeReady')) return
    this._tone({ freq: 520, type: 'square', dur: 0.1, gain: 0.18, sweepTo: 880 })
  }

  // ── Set-pieces (AC5) ── boss/miniboss spawn + defeat, level transition, player death.
  // bossSpawn — a low ominous swell so the set-piece announces itself.
  bossSpawn(): void {
    if (!this._gateOk('bossSpawn', 0.2)) return
    this._tone({ freq: 60, type: 'sawtooth', dur: 0.7, gain: 0.4, sweepTo: 140 })
    this._tone({ freq: 90, type: 'square', dur: 0.6, gain: 0.18, sweepTo: 70, delay: 0.05 })
    this._noise({ dur: 0.5, gain: 0.16, type: 'lowpass', freq: 240 })
  }
  // bossDefeat — a short ascending flourish (a three-note "win" arpeggio) marking the kill.
  bossDefeat(): void {
    if (!this._gateOk('bossDefeat', 0.2)) return
    this._tone({ freq: 440, type: 'square', dur: 0.16, gain: 0.3 }) // A4
    this._tone({ freq: 660, type: 'square', dur: 0.16, gain: 0.3, delay: 0.12 }) // E5
    this._tone({ freq: 880, type: 'square', dur: 0.3, gain: 0.3, delay: 0.24, sweepTo: 990 }) // A5 + a lift.
  }
  // level transition — a brief upward whoosh marking the door/level change.
  transition(): void {
    if (!this._gateOk('transition', 0.1)) return
    this._noise({ dur: 0.22, gain: 0.24, type: 'bandpass', freq: 1400 })
    this._tone({ freq: 300, type: 'triangle', dur: 0.2, gain: 0.16, sweepTo: 900 })
  }
  // player death — a low descending knell (distinct from enemyDie: longer + lower so it reads as YOU died).
  death(): void {
    if (!this._gateOk('death', 0.2)) return
    this._tone({ freq: 320, type: 'sawtooth', dur: 0.6, gain: 0.4, sweepTo: 50 })
    this._tone({ freq: 160, type: 'square', dur: 0.5, gain: 0.2, sweepTo: 40, delay: 0.04 })
  }

  // ── Menus (AC6) ── cursor move (a soft tick) + select/confirm (a brighter blip).
  uiMove(): void {
    if (!this._gateOk('uiMove', 0.02)) return
    this._tone({ freq: 520, type: 'square', dur: 0.04, gain: 0.18 })
  }
  uiSelect(): void {
    if (!this._gateOk('uiSelect', 0.02)) return
    this._tone({ freq: 660, type: 'square', dur: 0.08, gain: 0.24, sweepTo: 990 })
  }
}
