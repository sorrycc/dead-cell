// ── Skill / secondary-item table (design 2026-06-13-skills-secondary-items §6.1, AC1) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node and
// asserts the table is well-formed (a non-empty list, a known kind per skill, a positive cooldown, the
// kind-specific params present + numeric). Mirrors the project's other pure config tables (weapons/shop/
// upgrades): skills are PLAIN DATA the Phaser-coupled GameScene dispatches on GENERICALLY (no per-skill
// code) via a kind-dispatched `_useSkill`, reusing the existing combat pools (ProjectilePool/resolveHit/
// effects/sound) — NOT a new combat engine.
//
// THE LOADOUT LAYER (the design's core): the player carries WEAPONS only (a primary + an optional second
// slot). Dead Cells' signature loadout is 2 weapons + 2 SKILLS — cooldown-gated abilities orthogonal to
// the weapon combo (grenades, turrets, ranged burst tools). Skills slot into the existing seams as this
// pure-data table + the kind-dispatch; a slot that is empty OR on cooldown is a no-op (the identity: a
// run that never acquires a skill plays exactly as before — both slots empty, both keys do nothing).
//
// SKILL SHAPE (Decision 1/7 — self-contained rows, like config/weapons.js):
//   id       — stable key (carried on RunState across level rebuilds; the HUD/verifier read it).
//   name     — the label the HUD lists.
//   desc     — a short one-line effect summary (for any list rendering).
//   kind     — the effect family GameScene._useSkill dispatches on (a small KNOWN set, like Pickup kinds):
//                'volley' — fire a fan of `count` pooled player projectiles at a `spread` along facing
//                           (pure ProjectilePool reuse), optional status. e.g. Throwing Knives, Ice Shards.
//                'blast'  — instant radial AoE: damage every enemy/boss within `radius` of the player,
//                           knockback away, optional status + a particle ring (reuse resolveHit + effects).
//                'turret' — deploy a stationary auto-firer for `duration` that shoots the nearest live
//                           enemy every `fireInterval` (reuse ProjectilePool). The ONE new pooled entity.
//   cooldown — seconds before the slot can fire again (decayed by the gameplay dt on the Player). > 0.
//   …params  — kind-specific fields read ONLY by that kind's dispatch arm (undefined-safe), mirroring how
//              Pickup reads weaponId/scrollId/healFrac and weapons read swings/projectile.

import type { ProjectileSpec, WeaponStatus } from './weapons.js'
import type { ColorId } from './colors.js'

// The KNOWN skill kinds — the effect family GameScene._useSkill dispatches on (a small KNOWN set).
export type SkillKind = 'volley' | 'blast' | 'turret'

// A self-contained skill row (Decision 1). Kind-specific params are optional and read ONLY by that kind's
// dispatch arm (undefined-safe), mirroring how a weapon row reads swings/projectile.
export interface SkillSpec {
  id: string
  name: string
  desc: string
  kind: SkillKind
  // ── COLOUR-SCALING tag (color-scaling-stats §6.3, Decision 5, AC3) ── the stat colour this skill scales
  // with. REQUIRED — every skill is colour-tagged (the verifier asserts a KNOWN colour). A fired skill scales
  // by ITS colour's run level (NOT the equipped weapon's), baked into the fired damage at _useSkill time
  // (Decision 9). At level 0 the baked damage equals the spec damage (the identity).
  scaling: ColorId
  cooldown: number // s — the per-slot gate (> 0; the verifier asserts).
  // ── volley ── fire `count` projectiles fanned across `spread` radians along facing. `projectile` is
  // the SAME ProjectileSpec shape the bow uses (ProjectilePool.acquire reads it).
  count?: number
  spread?: number
  projectile?: ProjectileSpec
  // ── blast ── an instant radial AoE: `damage` to every enemy/boss within `radius` px of the player,
  // shoved out by `knockback` px/s.
  radius?: number
  damage?: number
  knockback?: number
  // ── turret ── deploy a stationary auto-firer for `duration` s that fires every `fireInterval` s at the
  // nearest live enemy. It reuses the SAME `projectile` field above for what it shoots.
  duration?: number
  fireInterval?: number
  // ── any kind ── an OPTIONAL status applied to a struck enemy (volley shot / blast target / turret shot),
  // the SAME WeaponStatus shape weapons use (status.js applies it). Absent ⇒ no status (the identity).
  status?: WeaponStatus
  // ── BLUEPRINT tag (meta-progression §6.5, Decision 6, AC6) ── absent/undefined ⇒ a STARTER skill (always in
  // the run pool — the identity). A non-empty id ⇒ a GATED skill that joins the pool ONLY when that blueprint is
  // unlocked (runSkillPool filters on it). EVERY current skill is a starter; only NEW rows this slice carry a tag.
  blueprint?: string
}

// ── SKILLS (the catalog) ── five distinct, genre-faithful skills across the three kinds (Decision 1). Each
// leans ONLY on the existing primitives (ProjectilePool / a radial-damage helper over this.enemies+boss /
// the new DeployablePool turret), so the engine risk is near-zero and the verifier sweeps the table the
// same way it sweeps weapons/shop/elite-affixes.
export const SKILLS: SkillSpec[] = [
  // ── KNIVES (volley) ── the bread-and-butter throw: a tight 3-knife fan of fast bolts. No status — pure
  // burst damage that lets a melee build poke at range while the weapon cools.
  {
    id: 'knives',
    name: 'Throwing Knives',
    desc: 'Throw a fan of 3 knives',
    kind: 'volley',
    scaling: 'tactics', // ranged burst → purple/Tactics (Decision 5).
    cooldown: 2.0,
    count: 3,
    spread: 0.34, // rad — a tight fan (~20° total) so all three land on a single target up close.
    projectile: { speed: 760, damage: 9, knockback: 160, lifetime: 0.9, w: 14, h: 5 },
  },
  // ── ICE SHARDS (volley + stun) ── a wider 5-shard spray that STUNS on hit (the genre's freeze tool). Lower
  // per-shard damage than the knives, but the crowd-control window is its identity. A longer cooldown to match.
  {
    id: 'iceShards',
    name: 'Ice Shards',
    desc: 'Spray 5 freezing shards',
    kind: 'volley',
    scaling: 'tactics', // ranged spray → purple/Tactics (Decision 5).
    cooldown: 4.0,
    count: 5,
    spread: 0.7, // rad — a wide spray (~40° total) to cover an approaching group.
    projectile: { speed: 640, damage: 6, knockback: 120, lifetime: 0.9, w: 12, h: 6 },
    status: { kind: 'stun', duration: 0.8 }, // the freeze — a brief crowd-control lock on each struck enemy.
  },
  // ── FROST GRENADE (blast + stun) ── an instant radial freeze: damage + a stun to every enemy/boss in range.
  // The panic-button AoE crowd-control (clear breathing room when surrounded). A mid cooldown.
  {
    id: 'frostGrenade',
    name: 'Frost Grenade',
    desc: 'Radial freeze blast',
    kind: 'blast',
    scaling: 'tactics', // thrown CC → purple/Tactics (Decision 5).
    cooldown: 5.0,
    radius: 150,
    damage: 14,
    knockback: 320,
    status: { kind: 'stun', duration: 0.9 },
  },
  // ── FIREBOMB (blast + bleed) ── an instant radial burn: heavier damage + a BLEED DoT to every enemy in range.
  // The damage-over-time AoE (drop it on a packed group and let the burn finish them). A longer cooldown.
  {
    id: 'firebomb',
    name: 'Firebomb',
    desc: 'Radial burn blast',
    kind: 'blast',
    scaling: 'brutality', // the heavy radial damage burn (brawler payoff) → red/Brutality (Decision 5).
    cooldown: 6.0,
    radius: 140,
    damage: 20,
    knockback: 260,
    status: { kind: 'bleed', duration: 2.6, tickInterval: 0.4, tickDmg: 4 },
  },
  // ── TURRET (turret) ── the deployable auto-firer: a stationary rect that shoots the nearest live enemy every
  // fireInterval for its duration (reuses ProjectilePool — its shots resolve through the existing projectile→
  // enemy overlap). The "set it and fight" tool. The longest cooldown (it does sustained work while you fight).
  {
    id: 'turret',
    name: 'Turret',
    desc: 'Deploy an auto-firing turret',
    kind: 'turret',
    scaling: 'tactics', // deployed ranged → purple/Tactics (Decision 5).
    cooldown: 9.0,
    duration: 8.0,
    fireInterval: 0.7,
    projectile: { speed: 700, damage: 7, knockback: 140, lifetime: 1.2, w: 12, h: 5 },
  },
  // ── SHOCKWAVE (blast — BLUEPRINT-GATED) (meta-progression §6.5, Decision 6, AC6) ── the NEW run-pool skill
  // this slice ships behind a blueprint unlock (`blueprint: 'bp_skill_shockwave'`). DEAD config (never offered)
  // until banked — so a default save's skill pool === the 5 pre-slice starters (the identity, AC11). A heavy
  // radial KNOCKBACK blast: big damage + a huge shove to clear breathing room (the panic-button bruiser tool).
  // Reuses the EXISTING 'blast' dispatch verbatim (no new engine — KISS), so once unlocked it just joins the pool.
  {
    id: 'shockwave',
    name: 'Shockwave',
    desc: 'Heavy radial knockback blast',
    kind: 'blast',
    scaling: 'tactics', // thrown radial knockback → purple/Tactics (Decision 5).
    cooldown: 7.0,
    radius: 170,
    damage: 22,
    knockback: 520,
    blueprint: 'bp_skill_shockwave', // the gating blueprint id (matches config/blueprints.js BLUEPRINTS).
  },
]

// id → row lookup (GameScene resolves a carried skillId back to the spec on a level rebuild; the HUD/pickup/
// shop paths resolve a skill by id too). DRY — one source. KISS — a flat map.
export const SKILLS_BY_ID: Record<string, SkillSpec> = Object.fromEntries(SKILLS.map((s) => [s.id, s]))

// The ordered list (for the verifier sweep + any list rendering / a future picker UI).
export const SKILL_ORDER: SkillSpec[] = SKILLS.map((s) => s)

// The KNOWN skill kinds (the verifier asserts every skill.kind is one of these — a malformed table fails
// loudly under node, mirroring the boss-attack-kinds + shop-item-kinds + weapon-type checks).
export const SKILL_KINDS: SkillKind[] = ['volley', 'blast', 'turret']

// ── runSkillPool(unlocked) → the SkillSpecs available given the unlocked-blueprint set (meta-progression §6.5,
// Decision 6, AC6) ── PURE (node-importable, verifier-swept). ALWAYS the STARTERS (untagged), PLUS any gated row
// whose blueprint id is unlocked. With an EMPTY set this returns exactly the starter rows === the pre-slice
// SKILLS (the identity pin — a default save offers the same skills as today). GameScene computes it ONCE in
// create() from meta.getBlueprints() and the skill-pickup placement draws from it.
export function runSkillPool(unlocked: ReadonlySet<string>): SkillSpec[] {
  return SKILLS.filter((s) => !s.blueprint || unlocked.has(s.blueprint))
}
