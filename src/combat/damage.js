// ── Damage resolution (design §6.3, Decisions 17/19, AC21/AC22) ──
// 100% PURE module — NO Phaser import. Separates the DECISION (how much damage, is it a backstab,
// which way + how hard the knockback) from the EFFECT (mutate HP, set body velocity, spawn FX),
// which the calling entity applies. This is SOLID (one job: the rule math) and DRY (the SAME
// function resolves player→enemy AND enemy→player — Decision 17), and it keeps the combat rules
// trivially unit-reasonable without a browser/Phaser in the loop.
//
// resolveHit RETURNS a plain result `{ damage, knockbackX, knockbackY, isBackstab }`; it never
// touches the attacker or victim. The caller reads the result and applies it in its own onHit.

// ── Backstab tuning (Decision 19, AC22) ──
const BACKSTAB_DAMAGE_MULT = 2.0 // crit damage multiplier when hitting from behind.
const BACKSTAB_KNOCKBACK_MULT = 1.6 // stronger shove on a backstab (reward flanking).
const BACKSTAB_DEADZONE = 4 // px — |Δx| must exceed this for a backstab to count, so a
// near-vertical/overlapping hit isn't a facing coin-flip (Decision 19's "small dead-zone").

// Vertical knockback: a small POP up on every hit so the victim's recoil reads (and, for the
// player, briefly lifts it off the floor so friction doesn't instantly eat the horizontal shove).
const KNOCKBACK_POP_Y = -180 // px/s — negative = up (Phaser y grows downward).

// ── resolveHit(attacker, victim, swing, opts) → result ──
// attacker / victim are plain shapes: { cx, facing } (body CENTER x + facing ∈ {-1,+1}).
// swing is a row from combat/hitbox.js SWINGS (we read `damage` + `knockback`).
// opts.allowBackstab gates the crit OFF for a fairer enemy→player hit (Decision 19) — a config
// flag, NOT a code fork: the SAME function serves both directions.
//
// Backstab predicate (Decision 19): a hit lands "from behind" when the attacker is on the side
// the victim is NOT facing. The victim faces +facing; the attacker is on the victim's "back" side
// when sign(attacker.cx − victim.cx) === −victim.facing. The dead-zone rejects near-vertical hits.
export function resolveHit(attacker, victim, swing, opts = {}) {
  const allowBackstab = opts.allowBackstab !== false // default ON (player→enemy)

  // Direction the victim gets shoved: AWAY from the attacker. If they're (near) coincident,
  // fall back to the attacker's own facing so the knockback is never a degenerate 0.
  const dx = victim.cx - attacker.cx
  const awayDir = dx !== 0 ? Math.sign(dx) : attacker.facing

  // Backstab geometry: attacker on the side the victim isn't facing, beyond the dead-zone.
  const attackerSide = Math.sign(attacker.cx - victim.cx) // -1 attacker is left of victim, +1 right
  const isBackstab =
    allowBackstab &&
    Math.abs(attacker.cx - victim.cx) > BACKSTAB_DEADZONE &&
    attackerSide === -victim.facing

  const damageMult = isBackstab ? BACKSTAB_DAMAGE_MULT : 1
  const knockbackMult = isBackstab ? BACKSTAB_KNOCKBACK_MULT : 1

  return {
    damage: Math.round(swing.damage * damageMult),
    knockbackX: awayDir * swing.knockback * knockbackMult,
    knockbackY: KNOCKBACK_POP_Y,
    isBackstab,
  }
}
