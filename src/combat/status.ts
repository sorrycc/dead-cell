// ── Combat status effects — bleed / poison / stun (design §6.13, Decision 79, AC66) ──
// 100% PURE module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node and asserts
// the tick math headlessly (a damage-over-time total + a stun flag + expiry). Separates the RULE (how a
// status accumulates damage / gates control over time) from the EFFECT (mutate HP, freeze the AI, tint),
// which the calling entity (Enemy/Player) applies — the SAME SOLID split as combat/damage.js.
//
// WHY (review — combat was instantaneous-hit only): every hit applied HP + knockback and NOTHING
// persisted. The genre's build variety leans on DoT + crowd-control: a weapon that BLEEDS, a hammer that
// STUNS, a poison scroll. This thin layer gives weapons identity beyond raw numbers (spear = bleed, hammer
// = stun) and makes scrolls/shop boosts more interesting — all pure data + a per-frame tick, no new art.
//
// THE STATUS SHAPE (a plain object on an entity's `statuses[]` list — Enemy/Player own the list):
//   kind         — 'bleed' | 'poison' | 'stun' | 'burn' (a known set; the verifier asserts).
//   timer        — seconds remaining (decays by dt; ≤ 0 ⇒ expired + dropped).
//   tickInterval — seconds between damage ticks (0/undefined ⇒ a non-damaging status, e.g. 'stun').
//   tickDmg      — HP per damage tick (0 ⇒ non-damaging).
//   _accum       — internal: seconds accumulated toward the next tick (managed by tickStatuses).
//
// STUN: a non-damaging status whose PRESENCE gates the victim's control (Enemy freezes its AI; the Player
// could be stunned too — wired on Enemy this slice, the genre's "hammer staggers"). tickStatuses reports
// `stunned` true iff any live status is a 'stun' so the caller can freeze for that window.
//
// BURN (affliction-synergy slice, Decision 1): a 4th kind — a damaging DoT that is MECHANICALLY IDENTICAL to
// bleed/poison (it ticks via the SAME tickDmg/tickInterval path). It is the genre's "ignite": only its
// tint/cue differ (orange), giving the Searing weapon affix a distinct identity + a 4th legible colour. The
// tick/expiry/refresh math below is UNCHANGED — it branches on "a damaging status" (tickDmg>0 && tickInterval>0),
// NOT on the kind name — so burn rides the existing DoT path with zero new math (the load-bearing reason it
// was safe to widen the kind set).
//
// dt BOUNDARY (§6.3): the caller passes the GAMEPLAY dt (0 during hit-stop), so a bleed/poison tick + a
// stun window both FREEZE with the combat world during the micro-freeze — consistent with every other timer.

// The known status kind tags as a union (the verifier asserts every config status tag is one of these).
// 'burn' is a 4th DAMAGING DoT kind (mechanically identical to bleed/poison — see BURN note above).
export type StatusKind = 'bleed' | 'poison' | 'stun' | 'burn'

// A config status SPEC (data authored in config tables) — duration/tick params optional so a non-damaging
// status (stun) is valid with just { kind, duration }.
export interface StatusSpec {
  kind: StatusKind
  duration?: number
  tickInterval?: number
  tickDmg?: number
}

// A live runtime status instance carried on an entity's `statuses[]` list.
export interface Status {
  kind: StatusKind
  timer: number
  tickInterval: number
  tickDmg: number
  _accum: number
}

// The per-frame result of tickStatuses — total damage to apply + whether the victim is currently stunned.
export interface TickResult {
  damage: number
  stunned: boolean
}

// The KNOWN status kinds (the verifier asserts every config status tag is one of these — a malformed tag
// fails loudly under node, mirroring the boss-attack-kinds + shop-item-kinds checks).
export const STATUS_KINDS: StatusKind[] = ['bleed', 'poison', 'stun', 'burn']

// ── makeStatus(spec) → a fresh status instance (PURE) ── from a config status SPEC ({ kind, duration,
// tickInterval, tickDmg }) build the live runtime object. Defaults keep a non-damaging status (stun) valid
// (tickInterval/tickDmg 0). Returns a NEW object each call (no shared mutable spec aliasing).
export function makeStatus(spec: StatusSpec): Status {
  return {
    kind: spec.kind,
    timer: spec.duration ?? 0,
    tickInterval: spec.tickInterval ?? 0,
    tickDmg: spec.tickDmg ?? 0,
    _accum: 0,
  }
}

// ── applyStatus(statuses, spec) → the (mutated) list (PURE-ish: mutates the passed list, like the
// scrolls' apply mutates RunState) ── add a status from a config spec, REFRESHING an existing one of the
// same kind to the longer remaining duration (re-applying bleed on a still-bleeding enemy resets/extends
// it rather than stacking infinitely — KISS, the genre's "refresh on re-hit"). Returns the list for chaining.
export function applyStatus(statuses: Status[], spec: StatusSpec): Status[] {
  if (!spec || !spec.kind) return statuses
  const existing = statuses.find((s) => s.kind === spec.kind)
  if (existing) {
    // Refresh to the max of the remaining and the fresh duration (re-hit extends, never shortens).
    existing.timer = Math.max(existing.timer, spec.duration ?? 0)
    // Keep the stronger tick params (a stronger source upgrades the effect; KISS — take the max).
    existing.tickDmg = Math.max(existing.tickDmg, spec.tickDmg ?? 0)
    if (spec.tickInterval) existing.tickInterval = spec.tickInterval
    return statuses
  }
  statuses.push(makeStatus(spec))
  return statuses
}

// ── tickStatuses(statuses, dt) → { damage, stunned, expiredAny } (PURE math, mutates the list in place) ──
// Advance every status by dt: decay its timer, accumulate damaging ticks (tickDmg every tickInterval), and
// DROP expired ones (timer ≤ 0) IN PLACE (splice — the caller's list reference is preserved). Returns the
// TOTAL damage to apply this frame (the caller subtracts it from HP via its onHit/DoT path), whether the
// victim is currently `stunned` (any live 'stun'), and `expiredAny` (handy for a cleanup cue). KISS: a
// status emits AT MOST a few ticks per frame (dt is clamped upstream), so the while-loop is bounded.
export function tickStatuses(statuses: Status[], dt: number): TickResult {
  let damage = 0
  let stunned = false
  for (let i = statuses.length - 1; i >= 0; i--) {
    const s = statuses[i]
    s.timer -= dt
    if (s.kind === 'stun') stunned = stunned || s.timer > 0
    // Damaging statuses (bleed/poison): accumulate dt and emit a tick of tickDmg every tickInterval.
    if (s.tickDmg > 0 && s.tickInterval > 0) {
      s._accum += dt
      while (s._accum >= s.tickInterval) {
        s._accum -= s.tickInterval
        damage += s.tickDmg
      }
    }
    if (s.timer <= 0) statuses.splice(i, 1) // expired → drop (the list reference is preserved).
  }
  return { damage, stunned }
}

// ── hasStatus(statuses, kind) → boolean ── a small read helper (e.g. for a tint cue). PURE.
export function hasStatus(statuses: Status[], kind: StatusKind): boolean {
  return statuses.some((s) => s.kind === kind && s.timer > 0)
}
