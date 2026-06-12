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
//   kind         — 'bleed' | 'poison' | 'stun' (a known set; the verifier asserts).
//   timer        — seconds remaining (decays by dt; ≤ 0 ⇒ expired + dropped).
//   tickInterval — seconds between damage ticks (0/undefined ⇒ a non-damaging status, e.g. 'stun').
//   tickDmg      — HP per damage tick (0 ⇒ non-damaging).
//   _accum       — internal: seconds accumulated toward the next tick (managed by tickStatuses).
//
// STUN: a non-damaging status whose PRESENCE gates the victim's control (Enemy freezes its AI; the Player
// could be stunned too — wired on Enemy this slice, the genre's "hammer staggers"). tickStatuses reports
// `stunned` true iff any live status is a 'stun' so the caller can freeze for that window.
//
// dt BOUNDARY (§6.3): the caller passes the GAMEPLAY dt (0 during hit-stop), so a bleed/poison tick + a
// stun window both FREEZE with the combat world during the micro-freeze — consistent with every other timer.

// The KNOWN status kinds (the verifier asserts every config status tag is one of these — a malformed tag
// fails loudly under node, mirroring the boss-attack-kinds + shop-item-kinds checks).
export const STATUS_KINDS = ['bleed', 'poison', 'stun']

// ── makeStatus(spec) → a fresh status instance (PURE) ── from a config status SPEC ({ kind, duration,
// tickInterval, tickDmg }) build the live runtime object. Defaults keep a non-damaging status (stun) valid
// (tickInterval/tickDmg 0). Returns a NEW object each call (no shared mutable spec aliasing).
export function makeStatus(spec) {
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
export function applyStatus(statuses, spec) {
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
export function tickStatuses(statuses, dt) {
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
export function hasStatus(statuses, kind) {
  return statuses.some((s) => s.kind === kind && s.timer > 0)
}
