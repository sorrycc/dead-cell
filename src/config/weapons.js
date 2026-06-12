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

// ── SWORD — the default melee weapon (Decision 61). ──
// Its `swings` ARE the migrated Phase-4 combat/hitbox SWINGS (a fast 3-hit light combo) so the
// Phase-4 feel is preserved EXACTLY when the sword is equipped (the additive identity, AC53/AC55).
// combat/hitbox.js re-exports THIS table as `SWINGS` for back-compat (no broken imports).
export const SWORD = {
  id: 'sword',
  name: 'Sword',
  type: 'melee',
  swings: [
    // Swing 1 — quick jab. Short reach, low commit, generous chain window.
    { reach: 46, halfHeight: 26, forward: 18, damage: 8, knockback: 220, active: 0.08, recovery: 0.12, comboWindow: 0.34, lunge: 80 },
    // Swing 2 — second jab. Slightly more reach + damage, still snappy.
    { reach: 52, halfHeight: 28, forward: 20, damage: 10, knockback: 280, active: 0.09, recovery: 0.14, comboWindow: 0.34, lunge: 110 },
    // Swing 3 — FINISHER. Bigger box, harder hit + knockback, heavier commit, longer pre-lunge.
    { reach: 64, halfHeight: 32, forward: 22, damage: 16, knockback: 460, active: 0.11, recovery: 0.22, comboWindow: 0.0, lunge: 230 },
  ],
}

// ── HAMMER — a heavy melee weapon (Decision 61). ──
// DISTINCT FEEL: slow (long active+recovery), big damage + knockback, short reach, a 2-row combo
// (a wind-up swing → a crushing finisher). The committed recovery makes it high-risk/high-reward
// versus the sword's snappy poke. Same swing schema (so the Player/marker code is unchanged).
export const HAMMER = {
  id: 'hammer',
  name: 'Hammer',
  type: 'melee',
  swings: [
    // Swing 1 — heavy overhead. Slow active, big hit + shove, a brief chain window into the finisher.
    { reach: 50, halfHeight: 34, forward: 16, damage: 22, knockback: 520, active: 0.16, recovery: 0.30, comboWindow: 0.40, lunge: 60 },
    // Swing 2 — FINISHER smash. Bigger box, crushing damage + knockback, long committed recovery.
    { reach: 58, halfHeight: 38, forward: 18, damage: 34, knockback: 760, active: 0.18, recovery: 0.42, comboWindow: 0.0, lunge: 90 },
  ],
}

// ── BOW — a ranged weapon (Decision 61/62). ──
// type:'ranged' — firing acquires a POOLED projectile (combat/ProjectilePool) instead of a melee
// hitbox. ONE "draw" swing row gates the shot cadence (active = the brief draw, recovery = the gap
// between shots). reach/halfHeight/forward give the cosmetic front-marker a sane (small) size so the
// melee-only marker code never reads undefined when a ranged weapon is equipped (review MAJOR). The
// projectile carries the real damage/knockback.
export const BOW = {
  id: 'bow',
  name: 'Bow',
  type: 'ranged',
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
}

// ── SPEAR — a long-reach poke/spacing weapon (design §6.6.5, Decision 69, AC60 — the 4th weapon). ──
// DISTINCT FEEL: the LONGEST reach of any melee weapon, low damage-per-hit, a fast 2–3 hit combo with a
// forward LUNGE on each thrust — a spacing tool that hits from outside a grunt's swing range and pokes
// chargers/flyers on approach (distinct from the balanced Sword, the slow/heavy Hammer, the ranged Bow).
// It satisfies the existing pure swing-table contract VERBATIM, so the Player/Pickup/Hub generic code is
// UNCHANGED (it reads the table by `type`/`swings`) and the verifier's WEAPON_ORDER.length goes 3→4
// (AC60). It joins WEAPON_PICKUP_POOL in GameScene so it appears in runs (a found weapon — not a meta
// unlock, KISS / §6.6.5).
export const SPEAR = {
  id: 'spear',
  name: 'Spear',
  type: 'melee',
  swings: [
    // Thrust 1 — a long low-commit poke. Big reach, small damage, snappy, a strong forward lunge so it
    // closes/spaces. Generous chain window into the next thrust.
    { reach: 86, halfHeight: 18, forward: 26, damage: 7, knockback: 200, active: 0.07, recovery: 0.12, comboWindow: 0.36, lunge: 160 },
    // Thrust 2 — a second poke, slightly more reach + damage, still snappy.
    { reach: 92, halfHeight: 18, forward: 28, damage: 9, knockback: 240, active: 0.08, recovery: 0.13, comboWindow: 0.36, lunge: 180 },
    // Thrust 3 — FINISHER lunge: the longest reach, a harder hit + shove, a big committed lunge.
    { reach: 104, halfHeight: 20, forward: 30, damage: 13, knockback: 380, active: 0.1, recovery: 0.2, comboWindow: 0.0, lunge: 280 },
  ],
}

// ── WEAPONS (id → config) ── the lookup the Player/Pickup/GameScene use to equip by id. The
// STARTING weapon id comes from the meta fold (config/upgrades.js START_WEAPON → startStats.
// startWeaponId, Decision 60/63); the default is 'sword' so a fresh run plays exactly like Phase 4.
export const WEAPONS = { sword: SWORD, hammer: HAMMER, bow: BOW, spear: SPEAR }

// The ordered list (for the verifier sweep + any list rendering). FOUR weapons ship now (§6.6.5, AC60).
export const WEAPON_ORDER = [SWORD, HAMMER, BOW, SPEAR]
