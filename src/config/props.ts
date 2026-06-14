// ── Destructible-prop config (F5 environmental-combat design §2(b)/§3 AC1, Decision 7/9) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs node-imports it under plain node and
// asserts each barrel flavour is well-formed (positive radius/damage/hp, knockback >= 0; oil carries a sane
// burn status, explosive carries none). Mirrors the project's other pure config tables (curses/rarity/colors):
// plain data + an id→lookup map + an ordered id list, declared self-contained (Phaser-free).
//
// WHAT A BARREL IS (genre): a rare destructible WORLD prop. Smash it (a player hit, OR an enemy knocked into
// it) and it detonates a radial blast that damages nearby enemies+boss — and YOU, if you stood too close.
// It is NOT a weapon/skill/mutation: it feeds NO seeded run pool, so it needs NO blueprint gate and NEVER
// perturbs the runWeaponPool/runSkillPool/runMutationPool identity pins (the determinism contract).
//
// THE BLAST is delivered ENTIRELY by GameScene's EXISTING radial helpers (_radialDamage for enemies+boss,
// _enemyRadialDamage for the player) — this table only carries the numbers (radius/damage/knockback/hp +
// the optional burn status). No new combat math; `oil`'s status rides the existing `burn` DoT path.

// The optional burn DoT spec a barrel flavour can carry. Declared INLINE (not imported from combat/status.js)
// so this table stays Phaser-free + self-contained, like curses.ts. Shape mirrors StatusSpec's burn fields.
export interface BarrelBurnStatus {
  kind: 'burn'
  duration: number // s — how long the burn lasts on a hit target.
  tickInterval: number // s — gap between DoT ticks.
  tickDmg: number // hp per DoT tick.
}

export type BarrelFlavourId = 'explosive' | 'oil'

export interface BarrelFlavour {
  id: BarrelFlavourId
  color: number // the programmer-art tint of the drawn barrel rect (reads as its flavour).
  radius: number // px — the blast radius (> 0).
  damage: number // hp — the blast's instant damage (> 0).
  knockback: number // px/s — the shove away from the blast origin (>= 0).
  hp: number // a small positive INTEGER — a fragile prop (one or two hits breaks it).
  status?: BarrelBurnStatus // oil ONLY: the burn DoT the blast applies; explosive has NONE (pure damage).
}

// ── BARREL_FLAVOURS — the two pinned barrel flavours (the doc + the verifier are the contract). ──
// explosive: a punchy bomb blast — a larger `damage`, NO status (pure damage). oil: a slightly WIDER,
// lower-damage blast that carries a `burn` status (the ignite flavour — DoT after the initial pop).
export const BARREL_FLAVOURS: Record<BarrelFlavourId, BarrelFlavour> = {
  explosive: {
    id: 'explosive',
    color: 0xd35400, // a hot bomb-orange (programmer-art primitive — reads as "explosive").
    radius: 110,
    damage: 34, // a punchy bomb hit (the harder of the two; pure damage, no DoT).
    knockback: 360,
    hp: 1, // fragile — one hit pops it.
  },
  oil: {
    id: 'oil',
    color: 0x145a32, // a dark oil-green (programmer-art primitive — reads as "oil/flammable").
    radius: 128, // slightly WIDER than explosive (the burn flavour spreads further).
    damage: 18, // lower instant damage than explosive — the burn DoT makes up the difference.
    knockback: 280,
    hp: 1, // fragile — one hit pops it.
    status: { kind: 'burn', duration: 3, tickInterval: 0.5, tickDmg: 5 }, // the ignite (DoT via the burn path).
  },
}

// The ordered id list (the id→lookup map + ordered list shape, mirroring weapons.ts / curses.ts / rarity.ts).
export const BARREL_FLAVOUR_IDS: BarrelFlavourId[] = ['explosive', 'oil']
