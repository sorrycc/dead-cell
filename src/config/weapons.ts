// ── Weapon table (design §6.5, Decision 61/62, AC54) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node
// and asserts every weapon has a well-formed moveset (AC55). A weapon is just a swing TABLE + a
// type flag (KISS — Decision 61): the Player reads `equippedWeapon.swings` (replacing the old
// module-level SWINGS import) and branches on `equippedWeapon.type` to dispatch a MELEE hitbox vs a
// fired RANGED projectile. Mirrors the project's other pure config tables (biomes/difficulty/upgrades).
//
// SWING SCHEMA (the SAME row shape combat/hitbox.js + HitboxPool + Player read — DRY): each row is
//   reach, halfHeight, forward — the swingRect AABB geometry (px).
//   damage, knockback           — the hit (hp, px/s); resolveHit signs the knockback away.
//   active, recovery            — the lock (s): hitbox-live window, then committed recovery.
//   comboWindow                 — after the swing, how long a follow-up press chains (s); 0 = finisher.
//   lunge                       — a one-shot forward velocity nudge at swing start (px/s).
// A ranged weapon's swings are "draw" rows: active/recovery gate the fire cadence; reach/damage/
// knockback/lunge are cosmetic-marker placeholders (the real hit comes from `projectile`), but they
// are kept WELL-FORMED so the same Player/marker code never reads undefined (review MAJOR — the
// swing-table swap must leave NO stale sword geometry on a ranged weapon).
//
// PROJECTILE SPEC (ranged only, Decision 62): { speed, damage, knockback, lifetime, w, h } — the
// pooled projectile reads these. Present iff type==='ranged' (the verifier asserts the iff, AC55).

import type { ColorId } from './colors.js'

// A single swing row — the SAME shape combat/hitbox.js + HitboxPool + Player read (DRY, see SWING SCHEMA above).
export interface SwingRow {
  reach: number
  halfHeight: number
  forward: number
  damage: number
  knockback: number
  active: number
  recovery: number
  comboWindow: number
  lunge: number
}

// A status tag applied to a struck enemy (status.js). tickInterval/tickDmg present only for DoTs.
export interface WeaponStatus {
  kind: string
  duration: number
  tickInterval?: number
  tickDmg?: number
}

// ── PER-WEAPON MOVESET (per-weapon-movesets design §6.1, Decision 1, AC1) ── the playstyle layer that
// makes each weapon a DISTINCT ATTACK PATTERN (not just stat deltas). 100% PURE plain data (no Phaser) so
// scripts/verify-gen.mjs node-imports the table and the §5d well-formedness sweep (AC2) validates it
// headlessly. Every field is OPTIONAL: a weapon with NO `moveset` (the default) plays EXACTLY as before
// this slice (the additive identity, AC10) — the Player/verifier read `equippedWeapon.moveset?.x` and the
// charge/flurry/finisher/pierce code is gated behind the new HOLD/DOWN/parry inputs. A weapon picks at most
// one of charge/flurry (KISS, Decision 2). foldWeaponAffix carries the moveset via the `...weapon` spread
// (it's immutable PATTERN data — never scaled by an affix, which describes a stat — Decision 3, AC3).

// A hold-to-charge mode (Hammer melee smash / Bow charged shot). All plain data.
export interface ChargeMode {
  chargeTime: number // s — HOLD the attack key at least this long for the charged variant (> 0).
  damageMult: number // ×finisher/projectile damage on a charged release (>= 1; the verifier asserts it).
  aoeRadius?: number // px — MELEE only: a radial smash hit around the impact (0/absent = none).
  chargeStunDuration?: number // s — MELEE only: OVERRIDE stun duration on a charged hit (the armor-break stagger).
}

// A hold-to-repeat flurry (Spear drill). Repeats a fast poke while the attack key is held.
export interface FlurryMode {
  hits: number // total pokes in one flurry (>= 2; the verifier asserts it).
  interval: number // s — gap between pokes (> 0).
}

// A directional finisher variant (Sword ground-slam). The `down` row OVERRIDES the finisher when DOWN is held.
export interface FinisherMode {
  down?: Partial<SwingRow> // deltas applied OVER the base finisher row when DOWN is held (a heavier-knockback slam).
}

// Bow charged pierce — the shot SURVIVES N hits instead of dying on the first (passes through a line).
export interface PierceMode {
  maxTargets: number // a charged shot pierces up to this many enemies (>= 2; the verifier asserts it).
}

// The per-weapon moveset sub-object (all blocks optional — a weapon picks exactly the modes it wants).
export interface WeaponMoveset {
  charge?: ChargeMode // Hammer / Bow — HOLD to charge a heavier release.
  flurry?: FlurryMode // Spear — HOLD to chain a multi-hit drill.
  finisher?: FinisherMode // Sword — a directional (DOWN-held) finisher variant.
  pierce?: PierceMode // Bow — the charged shot's line-pierce (paired with `charge` on a ranged weapon).
}

// The ranged projectile spec (Decision 62) — read by ProjectilePool.acquire. Present iff type==='ranged'.
export interface ProjectileSpec {
  speed: number
  damage: number
  knockback: number
  lifetime: number
  w: number
  h: number
}

// A weapon config (id → swing TABLE + a type flag, Decision 61). Consumers read swings/type/projectile/status.
// `moveset` (per-weapon-movesets §6.1, AC1) is OPTIONAL plain data — absent = the default tap behavior (identity).
export interface WeaponSpec {
  id: string
  name: string
  type: string
  // ── COLOUR-SCALING tag (color-scaling-stats §6.2, Decision 5, AC2) ── the stat colour this weapon scales
  // with (brutality | tactics | survival). REQUIRED — every weapon is colour-tagged (the verifier asserts
  // it's a KNOWN colour). foldWeaponAffix carries it through the `...weapon` spread (it's an immutable PATTERN
  // tag, never scaled by an affix — like `moveset`). The hit site reads `equippedWeapon.scaling` → its run
  // level → colorMult; at level 0 the mult is 1 (the identity, so a default run plays byte-unchanged).
  scaling: ColorId
  swings: SwingRow[]
  status?: WeaponStatus
  projectile?: ProjectileSpec
  moveset?: WeaponMoveset
  // ── BLUEPRINT tag (meta-progression §6.5, Decision 6, AC6) ── absent/undefined ⇒ a STARTER row (always in
  // the run pool — the identity, byte-unchanged for a default save). A non-empty id ⇒ a GATED row that joins
  // the run pool ONLY when that blueprint is unlocked (runWeaponPool filters on it). EVERY current weapon is a
  // starter (no tag); only NEW rows added this slice carry a tag — so a default save's pool === the pre-slice tables.
  blueprint?: string
}

// A FOLDED (affixed) weapon — the same WeaponSpec schema plus the affix metadata baked in by foldWeaponAffix.
export interface FoldedWeaponSpec extends WeaponSpec {
  affixId: string
  affixName: string
  affixLifestealFrac: number
}

// A weapon affix (Enrichment round-2). All multiplier/status fields optional — an absent field is the neutral default.
export interface WeaponAffix {
  id: string
  name: string
  damageMult?: number
  knockbackMult?: number
  comboSpeedMult?: number
  lifestealFrac?: number
  addStatus?: WeaponStatus
}

// A weighted affix entry (the SAME weighted-pick idiom as ELITE_AFFIXES / enemyPool — DRY).
export interface WeaponAffixWeight {
  affix: WeaponAffix
  w: number
}

// ── SWORD — the default melee weapon (Decision 61). ──
// Its `swings` ARE the migrated Phase-4 combat/hitbox SWINGS (a fast 3-hit light combo) so the
// Phase-4 feel is preserved EXACTLY when the sword is equipped (the additive identity, AC53/AC55).
// combat/hitbox.js re-exports THIS table as `SWINGS` for back-compat (no broken imports).
export const SWORD: WeaponSpec = {
  id: 'sword',
  name: 'Sword',
  type: 'melee',
  scaling: 'brutality', // the default balanced melee → red/Brutality (Decision 5).
  swings: [
    // Swing 1 — quick jab. Short reach, low commit, generous chain window.
    { reach: 46, halfHeight: 26, forward: 18, damage: 8, knockback: 220, active: 0.08, recovery: 0.12, comboWindow: 0.34, lunge: 80 },
    // Swing 2 — second jab. Slightly more reach + damage, still snappy.
    { reach: 52, halfHeight: 28, forward: 20, damage: 10, knockback: 280, active: 0.09, recovery: 0.14, comboWindow: 0.34, lunge: 110 },
    // Swing 3 — FINISHER. Bigger box, harder hit + knockback, heavier commit, longer pre-lunge.
    { reach: 64, halfHeight: 32, forward: 22, damage: 16, knockback: 460, active: 0.11, recovery: 0.22, comboWindow: 0.0, lunge: 230 },
  ],
  // ── MOVESET (per-weapon-movesets §6.1, Decision 4, AC6) ── the Sword stays the IDENTITY baseline: its
  // forward 1→2→3 combo is byte-unchanged. We ADD only a DIRECTIONAL finisher — holding DOWN at swing 3
  // overrides the finisher row with a heavier-knockback "ground slam" (a bigger shove + slightly more
  // forward reach). Not-held = the EXACT current finisher row byte-for-byte (identity-leaning).
  moveset: { finisher: { down: { knockback: 620, forward: 18 } } },
}

// ── HAMMER — a heavy melee weapon (Decision 61). ──
// DISTINCT FEEL: slow (long active+recovery), big damage + knockback, short reach, a 2-row combo
// (a wind-up swing → a crushing finisher). The committed recovery makes it high-risk/high-reward
// versus the sword's snappy poke. Same swing schema (so the Player/marker code is unchanged).
export const HAMMER: WeaponSpec = {
  id: 'hammer',
  name: 'Hammer',
  type: 'melee',
  scaling: 'brutality', // heavy melee, big hits → red/Brutality (Decision 5).
  // ── STATUS (design §6.13, Decision 79, AC66) ── the Hammer STUNS on hit: a brief crowd-control freeze
  // on the struck enemy (the genre's "heavy weapon staggers"). A short window so it's a tempo tool, not a
  // lock. status is read by GameScene's melee-hit handler → applied to the enemy's statuses[] (status.js).
  status: { kind: 'stun', duration: 0.6 },
  swings: [
    // Swing 1 — heavy overhead. Slow active, big hit + shove, a brief chain window into the finisher.
    { reach: 50, halfHeight: 34, forward: 16, damage: 22, knockback: 520, active: 0.16, recovery: 0.30, comboWindow: 0.40, lunge: 60 },
    // Swing 2 — FINISHER smash. Bigger box, crushing damage + knockback, long committed recovery.
    { reach: 58, halfHeight: 38, forward: 18, damage: 34, knockback: 760, active: 0.18, recovery: 0.42, comboWindow: 0.0, lunge: 90 },
  ],
  // ── MOVESET (per-weapon-movesets §6.1, Decision 1/3/6, AC4) ── HOLD-to-charge HEAVY SMASH. Holding the
  // attack key past chargeTime and RELEASING fires a charged finisher: ×damageMult damage, a radial AoE
  // shockwave (aoeRadius px around the impact — reuses GameScene._radialDamage, NO new combat math) and an
  // ARMOR-BREAK (a LONGER stun that OVERRIDES the base 0.6s stun — the genre's stagger, Decision 6; a
  // vs-afflicted build also takes the existing damage-vulnerability fold for free). A TAP (no charge) does
  // the current 2-row combo unchanged (the identity tap path).
  moveset: { charge: { chargeTime: 0.45, damageMult: 1.8, aoeRadius: 120, chargeStunDuration: 1.2 } },
}

// ── BOW — a ranged weapon (Decision 61/62). ──
// type:'ranged' — firing acquires a POOLED projectile (combat/ProjectilePool) instead of a melee
// hitbox. ONE "draw" swing row gates the shot cadence (active = the brief draw, recovery = the gap
// between shots). reach/halfHeight/forward give the cosmetic front-marker a sane (small) size so the
// melee-only marker code never reads undefined when a ranged weapon is equipped (review MAJOR). The
// projectile carries the real damage/knockback.
export const BOW: WeaponSpec = {
  id: 'bow',
  name: 'Bow',
  type: 'ranged',
  scaling: 'tactics', // the ranged weapon → purple/Tactics (Decision 5).
  // ── STATUS (design §6.13, Decision 79, AC66) ── the Bow POISONS on a projectile hit: weak but longer DoT
  // than the spear's bleed (a "tag and kite" identity for the ranged build). Applied by GameScene's
  // projectile-hit handler to the struck enemy's statuses[] (status.js), so the ranged path has identity too.
  status: { kind: 'poison', duration: 3.0, tickInterval: 0.5, tickDmg: 2 },
  swings: [
    // The single "draw" row: a short active (the loose) then a committed recovery (the nock) — this
    // IS the fire-rate gate. damage/knockback here are unused (the projectile hits); kept > 0 so the
    // marker/lunge code stays well-formed. comboWindow 0 = each shot is self-contained (no chain).
    { reach: 24, halfHeight: 20, forward: 14, damage: 0, knockback: 0, active: 0.06, recovery: 0.26, comboWindow: 0.0, lunge: 0 },
  ],
  // The fired projectile's spec (Decision 62) — read by ProjectilePool.acquire.
  projectile: {
    speed: 720, // px/s — travel speed along facing.
    damage: 14, // hp — per-hit damage (resolveHit reads it like a swing.damage).
    knockback: 240, // px/s — shove on hit.
    lifetime: 1.1, // s — released after this if it never hits / leaves the world.
    w: 18, // px — projectile body width.
    h: 6, // px — projectile body height (a thin bolt).
  },
  // ── MOVESET (per-weapon-movesets §6.1, Decision 1/7, AC7) ── HOLD-to-charge for more damage + PIERCE.
  // A TAP fires the current single shot (pierceLeft=1 → dies on first hit, the identity). HOLDING past
  // chargeTime and RELEASING fires a charged projectile: ×damageMult damage AND pierce.maxTargets — the
  // shot SURVIVES up to N distinct-enemy hits (a `pierceLeft` counter on the ProjectilePool context,
  // Decision 7) instead of dying on the first, so it passes through a line of enemies.
  moveset: { charge: { chargeTime: 0.5, damageMult: 1.9 }, pierce: { maxTargets: 3 } },
}

// ── SPEAR — a long-reach poke/spacing weapon (design §6.6.5, Decision 69, AC60 — the 4th weapon). ──
// DISTINCT FEEL: the LONGEST reach of any melee weapon, low damage-per-hit, a fast 2–3 hit combo with a
// forward LUNGE on each thrust — a spacing tool that hits from outside a grunt's swing range and pokes
// chargers/flyers on approach (distinct from the balanced Sword, the slow/heavy Hammer, the ranged Bow).
// It satisfies the existing pure swing-table contract VERBATIM, so the Player/Pickup/Hub generic code is
// UNCHANGED (it reads the table by `type`/`swings`) and the verifier's WEAPON_ORDER.length goes 3→4
// (AC60). It joins WEAPON_PICKUP_POOL in GameScene so it appears in runs (a found weapon — not a meta
// unlock, KISS / §6.6.5).
export const SPEAR: WeaponSpec = {
  id: 'spear',
  name: 'Spear',
  type: 'melee',
  scaling: 'survival', // long-reach poke/bleed spacing — the sustain/attrition identity → green/Survival (Decision 5).
  // ── STATUS (design §6.13, Decision 79, AC66) ── the Spear BLEEDS on hit: damage-over-time that rewards
  // poking + repositioning (its identity — low per-hit, but the bleed adds up). A few ticks of small damage
  // over a couple seconds. status is applied to the struck enemy by GameScene's melee-hit handler (status.js).
  status: { kind: 'bleed', duration: 2.4, tickInterval: 0.4, tickDmg: 3 },
  swings: [
    // Thrust 1 — a long low-commit poke. Big reach, small damage, snappy, a strong forward lunge so it
    // closes/spaces. Generous chain window into the next thrust.
    { reach: 86, halfHeight: 18, forward: 26, damage: 7, knockback: 200, active: 0.07, recovery: 0.12, comboWindow: 0.36, lunge: 160 },
    // Thrust 2 — a second poke, slightly more reach + damage, still snappy.
    { reach: 92, halfHeight: 18, forward: 28, damage: 9, knockback: 240, active: 0.08, recovery: 0.13, comboWindow: 0.36, lunge: 180 },
    // Thrust 3 — FINISHER lunge: the longest reach, a harder hit + shove, a big committed lunge.
    { reach: 104, halfHeight: 20, forward: 30, damage: 13, knockback: 380, active: 0.1, recovery: 0.2, comboWindow: 0.0, lunge: 280 },
  ],
  // ── MOVESET (per-weapon-movesets §6.1, Decision 1/2, AC5) ── HOLD-to-flurry MULTI-HIT DRILL. A TAP does
  // the current long-reach thrust / 3-combo (the identity). HOLDING the attack key chains a rapid `hits`
  // pokes spaced `interval` apart (each a normal thrust hitbox via _startSwing — keeps the long reach), a
  // bounded "drill" that ends on release or when the hits are spent (Decision 2). KISS — fast low-commit
  // pokes, not a charge.
  moveset: { flurry: { hits: 4, interval: 0.11 } },
}

// ── GLAIVE — a BLUEPRINT-GATED reach weapon (meta-progression §6.5, Decision 6, AC6) ── the NEW run-pool
// weapon this slice ships behind a blueprint unlock (`blueprint: 'bp_weapon_glaive'`). It is DEAD config (never
// in the run pool) until the Glaive blueprint is banked — so a default save's pool === the pre-slice 4 starters
// (the identity, AC11). DISTINCT FEEL: a long, sweeping 3-hit combo — more reach + knockback than the sword,
// heavier than the spear's poke, a wide arc that spaces a crowd. Satisfies the pure swing-table contract
// VERBATIM (the Player/Pickup/Hub generic code reads it by type/swings — unchanged). A found weapon (not a meta
// stat tier): once the blueprint is unlocked it just JOINS the world-drop pool like any other (runWeaponPool).
export const GLAIVE: WeaponSpec = {
  id: 'glaive',
  name: 'Glaive',
  type: 'melee',
  scaling: 'brutality', // sweeping melee crowd-control → red/Brutality (Decision 5).
  blueprint: 'bp_weapon_glaive', // the gating blueprint id (matches config/blueprints.js BLUEPRINTS).
  status: { kind: 'bleed', duration: 2.0, tickInterval: 0.4, tickDmg: 3 }, // a light bleed on the sweep.
  swings: [
    // Sweep 1 — a wide opening arc. Long reach, moderate damage + shove, snappy with a chain window.
    { reach: 72, halfHeight: 30, forward: 22, damage: 11, knockback: 320, active: 0.1, recovery: 0.16, comboWindow: 0.36, lunge: 120 },
    // Sweep 2 — a second arc, more reach + damage.
    { reach: 78, halfHeight: 32, forward: 24, damage: 14, knockback: 380, active: 0.11, recovery: 0.18, comboWindow: 0.36, lunge: 150 },
    // Sweep 3 — FINISHER spin: the longest reach, a crushing hit + big shove, a committed recovery.
    { reach: 90, halfHeight: 36, forward: 26, damage: 20, knockback: 560, active: 0.13, recovery: 0.26, comboWindow: 0.0, lunge: 220 },
  ],
}

// ── WEAPONS (id → config) ── the lookup the Player/Pickup/GameScene use to equip by id. The
// STARTING weapon id comes from the meta fold (config/upgrades.js START_WEAPON → startStats.
// startWeaponId, Decision 60/63); the default is 'sword' so a fresh run plays exactly like Phase 4.
// The GLAIVE is in the lookup (so a banked blueprint can equip it) but only the run-pool RESOLVER gates it.
export const WEAPONS: Record<string, WeaponSpec> = { sword: SWORD, hammer: HAMMER, bow: BOW, spear: SPEAR, glaive: GLAIVE }

// The ordered list (for the verifier sweep + any list rendering). FOUR starters + ONE blueprint-gated row.
// ── IDENTITY-CRITICAL ORDER (meta-progression review, AC7/AC11) ── the STARTER rows are ordered
// [HAMMER, BOW, SWORD, SPEAR] to match the PRE-SLICE const `WEAPON_PICKUP_POOL = ['hammer','bow','sword','spear']`
// (GameScene before this slice). The weapon-pickup / branch-reward draws pick `pool[floor(rng()*len)]` AFTER
// filtering out the equipped weapon, so the draw is ORDER-SENSITIVE: with a non-sword start (the START_WEAPON
// upgrade seeds hammer/bow, upgrades.ts) the filtered pool order — and thus the weapon a given seed draws —
// must match the historical const, or a shared/replayed seed silently draws a DIFFERENT weapon (an AC7/AC11
// break + seed-replay determinism break). runWeaponPool(new Set()) === ['hammer','bow','sword','spear'] is
// PINNED by the verifier (§13d). GLAIVE (blueprint-gated) is appended last (it's never in a default pool).
export const WEAPON_ORDER: WeaponSpec[] = [HAMMER, BOW, SWORD, SPEAR, GLAIVE]

// ── runWeaponPool(unlocked) → the weapon IDS available given the unlocked-blueprint set (meta-progression
// §6.5, Decision 6, AC6) ── PURE (node-importable, verifier-swept). ALWAYS the STARTERS (untagged rows), PLUS
// any gated row whose blueprint id is unlocked. With an EMPTY set this returns exactly the starter ids === the
// pre-slice WEAPON_ORDER (the identity pin the verifier asserts — a default save draws from the same rows as
// today). GameScene computes this ONCE in create() from meta.getBlueprints() and the placement sites draw from it.
export function runWeaponPool(unlocked: ReadonlySet<string>): string[] {
  return WEAPON_ORDER.filter((w) => !w.blueprint || unlocked.has(w.blueprint)).map((w) => w.id)
}

// ── WEAPON AFFIXES (Enrichment round-2 — the build engine; mirrors config/enemies.js ELITE_AFFIXES) ──
// A weapon found in a run can now ROLL a modifier at pickup, so a sword found at depth 1 is NOT identical
// to one found at depth 11 — the affix is what makes late-run loot exciting (the genre's build engine). An
// affix is PURE DATA folded into a FRESH weapon object by foldWeaponAffix (mirroring Enemy._foldElite for
// elites) — NEVER mutating the shared WEAPONS config — so the Player equips the folded weapon and reads its
// swings/type/projectile/status UNCHANGED (the fold preserves the weapon schema). GameScene rolls one off
// the LEVEL seed at pickup (deterministic — a run replays the same affixes), stamps it on the pickup, and
// equips the folded weapon; the HUD shows "Weapon ✦ AffixName".
//
// THE AFFIX FIELDS (foldWeaponAffix reads these; all optional — an absent field is the neutral default):
//   id            — the affix id (for the verifier sweep + the HUD label).
//   name          — the human label shown on the HUD next to the weapon name.
//   damageMult    — ×damage on EVERY swing row AND the projectile (a flat power bump — the "+damage" roll).
//   knockbackMult — ×knockback on every swing row + the projectile (a "concussive" roll — more shove).
//   comboSpeedMult— ×active+recovery on every swing row (<1 → a FASTER combo; the "swift" roll). Clamped >0.
//   lifestealFrac — WEAPON lifesteal: heal this fraction of damage dealt by THIS weapon (read at the hit
//                   site like the Vampirism scroll, but tied to the weapon — a "vampiric" roll). Additive.
//   addStatus     — a STATUS tag to ADD/OVERRIDE on the weapon ({kind,duration,...}) — e.g. put BLEED on a
//                   sword that had none (an "envenomed/flaming" roll). Folded onto weapon.status, so the
//                   existing GameScene status-on-hit path applies it with ZERO new wiring (DRY).
// KISS: a small weighted set (YAGNI on more). Each leans on the EXISTING hit-site reads + the status path,
// so the engine risk is near-zero and the verifier sweeps the table the same way it sweeps elite affixes.

// KEEN — a flat +damage roll: every hit lands harder. The bread-and-butter power affix (the most common).
export const WEAPON_KEEN: WeaponAffix = { id: 'keen', name: 'Keen', damageMult: 1.3 }

// HEAVY — a concussive roll: more knockback (juggle/space enemies) at a small damage bump. Pairs with the
// Hammer's stagger identity, but rolls on any weapon.
export const WEAPON_HEAVY: WeaponAffix = { id: 'heavy', name: 'Heavy', damageMult: 1.1, knockbackMult: 1.6 }

// SWIFT — a faster combo (shorter active+recovery) at a slight damage trade — the DPS/tempo affix (more
// swings per second). comboSpeedMult < 1 shortens the lock; damage is unchanged so total DPS rises.
export const WEAPON_SWIFT: WeaponAffix = { id: 'swift', name: 'Swift', comboSpeedMult: 0.78 }

// VAMPIRIC — weapon LIFESTEAL: heal a fraction of the damage THIS weapon deals (a sustain build engine —
// the bruiser's dream roll). Read at the hit site like the Vampirism scroll, additive with it.
export const WEAPON_VAMPIRIC: WeaponAffix = { id: 'vampiric', name: 'Vampiric', lifestealFrac: 0.16 }

// VENOMOUS — ADD a bleed DoT to the weapon (even a sword that had no status). Folded onto weapon.status so
// the existing status-on-hit path applies it (DRY). For a weapon that ALREADY has a status, this OVERRIDES
// it with the stronger bleed (KISS — one status slot). A DoT-stacking build engine.
export const WEAPON_VENOMOUS: WeaponAffix = {
  id: 'venomous',
  name: 'Venomous',
  damageMult: 1.05,
  addStatus: { kind: 'bleed', duration: 2.6, tickInterval: 0.4, tickDmg: 4 },
}

// SEARING — ADD a BURN DoT to the weapon (affliction-synergy §6.5, AC6) — even a sword that had no status.
// Folded onto weapon.status (one slot — KISS, OVERRIDES an existing status with the burn) so the EXISTING
// status-on-hit path applies it with ZERO new wiring (DRY, mirrors WEAPON_VENOMOUS). burn is the new 4th
// status kind (status.js) — a distinct orange DoT identity. A small damageMult bump so the affix does
// something beyond the DoT (mirrors VENOMOUS). This makes burn LIVE config (the verifier asserts an
// addStatus kind is a KNOWN status kind — burn now is).
export const WEAPON_SEARING: WeaponAffix = {
  id: 'searing',
  name: 'Searing',
  damageMult: 1.05,
  addStatus: { kind: 'burn', duration: 2.4, tickInterval: 0.4, tickDmg: 4 },
}

// ── WEAPON_AFFIXES (the weighted roll set) ── GameScene picks one off the LEVEL seed via the weights (the
// SAME weighted-pick idiom as ELITE_AFFIXES / enemyPool — DRY). Keen is the most common (the readable
// baseline); the build-defining affixes (vampiric/venomous/swift/searing) are rarer spice.
export const WEAPON_AFFIXES: WeaponAffixWeight[] = [
  { affix: WEAPON_KEEN, w: 4 },
  { affix: WEAPON_HEAVY, w: 3 },
  { affix: WEAPON_SWIFT, w: 2 },
  { affix: WEAPON_VAMPIRIC, w: 2 },
  { affix: WEAPON_VENOMOUS, w: 2 },
  { affix: WEAPON_SEARING, w: 2 },
]

// The ordered affix list (for the verifier sweep + any list rendering).
export const WEAPON_AFFIX_ORDER = WEAPON_AFFIXES.map((e) => e.affix)

// id → affix lookup (GameScene resolves a pickup's stamped affixId back to the affix to fold + equip — DRY,
// one source). A run carries the affix id on RunState (a scalar) so a level rebuild re-folds the SAME weapon.
export const WEAPON_AFFIXES_BY_ID: Record<string, WeaponAffix> = Object.fromEntries(WEAPON_AFFIX_ORDER.map((a) => [a.id, a]))

// The per-pickup affix ROLL chance — a found weapon is affixed this often (else it's a plain weapon, the
// identity). Sized so most found weapons carry SOME modifier (loot is exciting) but a plain weapon still
// appears (so the affix reads as a bonus, not a default). DATA so GameScene rolls it off the level seed.
export const WEAPON_AFFIX_CHANCE = 0.7

// ── foldWeaponAffix(weapon, affix) → a NEW affixed weapon (PURE; mirrors Enemy._foldElite, Decision 77) ──
// Bake the affix's multipliers/lifesteal/status into a FRESH weapon object (deep-cloning the swings rows +
// projectile so the shared WEAPONS config is NEVER mutated — the aliasing safety every fold in this codebase
// keeps). The folded weapon has the SAME schema (id/name/type/swings/projectile/status) so the Player equips
// + reads it UNCHANGED; it gains `affixId`/`affixName` (the HUD label) + `affixLifestealFrac` (read at the
// melee-hit site like the scroll). Every affix field is optional (?? the neutral default) so a missing field
// leaves the base value — a Keen weapon keeps base knockback/speed/status, a Swift weapon keeps base damage.
export function foldWeaponAffix(weapon: WeaponSpec, affix: WeaponAffix | null | undefined): WeaponSpec | FoldedWeaponSpec {
  if (!affix) return weapon // no affix → the plain weapon (identity — a fresh run plays exactly as before).
  const dMult = affix.damageMult ?? 1
  const kMult = affix.knockbackMult ?? 1
  const sMult = affix.comboSpeedMult ?? 1
  // Deep-clone each swing row with the multipliers applied (active/recovery clamped > 0 so the lock never
  // collapses to 0 and re-fires the same frame — a real bug guard). damage rounds to a whole hp (resolveHit
  // re-rounds anyway, but keep the table clean).
  const swings = weapon.swings.map((s) => ({
    ...s,
    damage: Math.round(s.damage * dMult),
    knockback: Math.round(s.knockback * kMult),
    active: Math.max(0.02, s.active * sMult),
    recovery: Math.max(0, s.recovery * sMult),
  }))
  const folded: FoldedWeaponSpec = {
    // The `...weapon` spread ALSO copies `moveset` onto the folded weapon (per-weapon-movesets §6.1,
    // Decision 3, AC3) AND the colour-scaling `scaling` tag (color-scaling-stats §6.2, Decision 5, AC2) —
    // both shallow ref-copies of immutable PATTERN data (charge/flurry/finisher/pierce + the colour tag are
    // never mutated, so sharing the ref/value is safe, mirroring how `status` rode the spread before the
    // addStatus override). The moveset's `damageMult` is NOT scaled by the affix (it describes a pattern,
    // not a stat); `scaling` is a colour TAG, not a stat — so an affix never touches it (a Keen sword is
    // still a Brutality sword). The affix-scaled `swings`/`projectile` below carry the damage mult, and the
    // moveset's mult composes ON TOP at the hit site. The verifier asserts the fold keeps both (§10).
    ...weapon,
    swings,
    affixId: affix.id,
    affixName: affix.name,
    affixLifestealFrac: affix.lifestealFrac ?? 0, // weapon lifesteal (read at the melee-hit site; 0 = none).
  }
  // Ranged: scale the projectile damage/knockback by the same mults (a fresh projectile object — no mutation).
  if (weapon.type === 'ranged' && weapon.projectile) {
    folded.projectile = {
      ...weapon.projectile,
      damage: Math.round(weapon.projectile.damage * dMult),
      knockback: Math.round(weapon.projectile.knockback * kMult),
    }
  }
  // Status: an addStatus affix ADDS/OVERRIDES the weapon's status (one slot — KISS); else keep the base.
  if (affix.addStatus) folded.status = { ...affix.addStatus }
  return folded
}
