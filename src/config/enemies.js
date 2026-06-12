// ── Enemy archetype specs (design §6.6.4, Decision 68, AC59) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node
// and asserts every archetype spec is well-formed + every biome `enemyPool` references only known
// ids (AC59). Mirrors the project's other pure config tables (biomes/difficulty/weapons/upgrades):
// the specs are PLAIN DATA; the visual colours live on the spec but are consumed ONLY by the
// Phaser-coupled Enemy.js (exactly like biome colours — the generator/verifier ignore them).
//
// CANONICAL SOURCE (Decision 68, review MINOR — DRY): the four archetype specs live HERE, not in
// Enemy.js. Enemy.js re-exports `GRUNT` as `BRUTE_SPEC` (back-compat: the regression pin stamps
// `spec:'brute'` on each generated enemy and the import direction in GameScene is unchanged). Moving
// the canonical specs to a PURE config inverts the OLD import direction (the verifier previously could
// NOT import BRUTE_SPEC because it lived in Phaser-coupled Enemy.js) — now the verifier imports the
// REAL grunt spec from here and uses it as the scaleSpec monotonicity base, REPLACING the duplicated
// BASE_SPEC_STUB (one source of truth — the review MINOR DRY point, resolved).
//
// THE ONE FSM, FOUR BEHAVIOURS (Decision 68): Enemy.js keeps its SINGLE state machine; variety is a
// `behavior` tag + a handful of guarded branches in the existing attack/chase ticks — NOT four
// subclasses (which would duplicate the patrol/chase/hurt/dead scaffolding — a DRY violation). The
// `behavior` values:
//   • 'melee'  — the GRUNT/Brute: patrol a ledge, chase, telegraph → melee swing (the Phase-4 enemy).
//   • 'ranged' — the SHOOTER: keeps a preferred distance, fires a pooled 'enemy' projectile on the
//                attack beat instead of a melee swing (a glass cannon — low HP).
//   • 'charge' — the CHARGER: a longer telegraph then a fast horizontal DASH with a body-contact
//                hitbox, overshooting past the player; high contact damage, slow to re-wind (tanky).
//   • 'fly'    — the FLYER: allowGravity=false, hovers at a target height, swoops toward the player on
//                the attack beat (a 2-D lunge). Patrols the whole arena width (it ignores the pit).
//
// EVERY spec shares the SAME field shape the Phase-4 BRUTE_SPEC had (so Enemy.js reads them
// uniformly) plus the new `behavior` tag and a few behaviour-specific fields (read ONLY by that
// behaviour's branch — undefined-safe defaults in Enemy.js). The verifier asserts the shared numeric
// fields are present + sane on every archetype (AC59).

import { BOW } from './weapons.js'

// ── GRUNT — the melee Brute (the canonical Phase-4 enemy; re-exported as BRUTE_SPEC). ──
// Identical numbers to the old Enemy.js BRUTE_SPEC so the regression pin + Phase-4 feel are unchanged.
export const GRUNT = {
  id: 'grunt',
  behavior: 'melee',
  maxHp: 60,
  bodyW: 38,
  bodyH: 54,
  color: 0xc0392b, // resting fill (brick red).
  colorTelegraph: 0xf1c40f, // wind-up flash (yellow) so the attack is readable (AC24).
  colorHurt: 0xffffff, // flash white on hit.
  patrolSpeed: 70, // px/s — slow patrol cruise.
  chaseSpeed: 160, // px/s — faster when locked on.
  chaseAccel: 900, // px/s² — how hard it ramps toward chase speed.
  detectRange: 360, // px — horizontal range to notice the player.
  detectHeight: 140, // px — vertical band; player must be within this to detect/chase.
  loseRange: 480, // px — beyond this (for a grace period) it gives up → patrol.
  loseGrace: 1.2, // s — how long the player can be out of range before chase drops.
  attackRange: 70, // px — within this it commits an attack.
  attackCooldown: 1.0, // s — min gap between attacks.
  telegraph: 0.42, // s — wind-up before the strike (the dodge window, AC24).
  attackActive: 0.12, // s — the strike's live hitbox window.
  attackRecovery: 0.45, // s — recovery after the strike before re-engaging.
  contactDamage: 6, // hp — touch damage tick (separate from the strike).
  contactCooldown: 0.6, // s — min gap between contact ticks (don't shred HP every frame).
  swing: { reach: 56, halfHeight: 30, forward: 16, damage: 12, knockback: 320 },
  hitstun: 0.28, // s — how long a `hurt` reaction freezes the AI.
  hurtIframe: 0.12, // s — brief post-hit i-frame so one swing's dedup + this both stop re-hits.
  knockbackTakeMult: 1.0, // scales incoming knockback (heavier enemies could lower this).
  cellDrop: 3, // Cells dropped on death (the meta currency).
}

// ── SHOOTER — a ranged glass cannon (behavior:'ranged', AC59). ──
// Keeps a preferred distance and fires a pooled 'enemy' projectile on the attack beat instead of a
// melee swing. Low HP (dies fast if you close the gap) but punishes a careless ranged approach. The
// projectile spec is the BOW's projectile, re-tuned slightly slower/weaker (a fair telegraphed shot).
export const SHOOTER = {
  id: 'shooter',
  behavior: 'ranged',
  maxHp: 38, // a glass cannon — dies fast if you reach it.
  bodyW: 34,
  bodyH: 50,
  color: 0x8e44ad, // resting fill (purple — distinct from the grunt's red).
  colorTelegraph: 0xf1c40f,
  colorHurt: 0xffffff,
  patrolSpeed: 60,
  chaseSpeed: 130,
  chaseAccel: 800,
  detectRange: 460, // notices the player from farther (it's a ranged threat).
  detectHeight: 160,
  loseRange: 560,
  loseGrace: 1.4,
  attackRange: 380, // px — fires from WELL outside melee range (the ranged beat).
  preferredRange: 300, // px — backs off if the player gets closer than this (kiting, AC59).
  attackCooldown: 1.6, // s — slower cadence than a melee swing (a telegraphed volley).
  telegraph: 0.5, // s — a clear aim wind-up before the shot (dodgeable, AC56).
  attackActive: 0.1, // s — the "loose" beat (the projectile is fired at telegraph end).
  attackRecovery: 0.4,
  contactDamage: 5, // low touch damage — its threat is the projectile, not contact.
  contactCooldown: 0.7,
  // The melee swing row is kept WELL-FORMED (undefined-safe) even though a ranged enemy never swings
  // it — Enemy.js's shared code reads swing.* for the cosmetic marker. The real hit is the projectile.
  swing: { reach: 30, halfHeight: 20, forward: 12, damage: 0, knockback: 0 },
  // The fired projectile (Decision 65 — the enemy ProjectilePool reads this, same shape as BOW's).
  projectile: {
    ...BOW.projectile,
    speed: 460, // px/s — slower than the player's bow (dodgeable on reaction).
    damage: 10, // hp — a fair telegraphed shot.
    knockback: 200,
    lifetime: 1.6,
  },
  hitstun: 0.3,
  hurtIframe: 0.12,
  knockbackTakeMult: 1.2, // light — gets juggled a bit (it's frail).
  cellDrop: 4, // drops a touch more (it's a priority kill).
}

// ── CHARGER — a tanky dasher (behavior:'charge', AC59). ──
// Its attack is a LONGER telegraph then a fast horizontal DASH (a burst of vx) with a body-contact
// hitbox, overshooting past the player; high contact damage, slow to re-wind. Tanky (high HP, heavy).
export const CHARGER = {
  id: 'charger',
  behavior: 'charge',
  maxHp: 95, // tanky — soaks hits.
  bodyW: 46,
  bodyH: 56,
  color: 0xd35400, // resting fill (burnt orange).
  colorTelegraph: 0xf39c12,
  colorHurt: 0xffffff,
  patrolSpeed: 64,
  chaseSpeed: 150,
  chaseAccel: 700,
  detectRange: 420,
  detectHeight: 150,
  loseRange: 540,
  loseGrace: 1.3,
  attackRange: 300, // px — commits the charge from a longer range than a grunt's swing.
  attackCooldown: 1.8, // s — slow to re-wind after a charge.
  telegraph: 0.62, // s — a LONG, very readable wind-up (you can dodge the dash, AC56).
  attackActive: 0.42, // s — the dash duration (the body-contact hitbox is live the whole dash).
  attackRecovery: 0.7, // s — a long recovery (the punish window after you dodge it).
  chargeSpeed: 620, // px/s — the dash velocity (review MINOR — read only by the 'charge' branch).
  contactDamage: 14, // hp — a heavy slam on contact (during the charge especially).
  contactCooldown: 0.7,
  // During the dash, the body contact IS the strike; the swing row gives the cosmetic marker a size.
  swing: { reach: 44, halfHeight: 30, forward: 14, damage: 16, knockback: 420 },
  hitstun: 0.22, // shorter stun (it's heavy — a hit staggers it less).
  hurtIframe: 0.12,
  knockbackTakeMult: 0.55, // heavy — barely knocked back (it isn't juggled, Decision 64-style).
  cellDrop: 5,
}

// ── FLYER — a hovering swooper (behavior:'fly', AC59). ──
// allowGravity=false: it HOVERS at a target height and SWOOPS toward the player on the attack beat (a
// 2-D lunge). It ignores the pit (it flies) so its patrol bounds are the WHOLE arena width — GameScene
// disables gravity on its body AND skips the solids/oneWay colliders for it (review MINOR — see
// _spawnEnemy). Low-ish HP; its threat is the unpredictable swoop angle.
export const FLYER = {
  id: 'flyer',
  behavior: 'fly',
  maxHp: 44,
  bodyW: 36,
  bodyH: 36,
  color: 0x2980b9, // resting fill (blue).
  colorTelegraph: 0xf1c40f,
  colorHurt: 0xffffff,
  patrolSpeed: 110, // px/s — it cruises faster (it's a flyer).
  chaseSpeed: 180,
  chaseAccel: 1000,
  detectRange: 440,
  detectHeight: 320, // px — a tall band: it detects/engages across height (it flies up/down).
  loseRange: 600,
  loseGrace: 1.6,
  attackRange: 120, // px — swoops in when this close.
  attackCooldown: 1.2,
  telegraph: 0.36, // s — a quick hover-tell before the swoop (still dodgeable).
  attackActive: 0.3, // s — the swoop duration (the body-contact hitbox is live during it).
  attackRecovery: 0.5,
  hoverHeight: 150, // px — preferred height ABOVE the player it hovers at (read by the 'fly' branch).
  swoopSpeed: 460, // px/s — the 2-D lunge speed toward the player (read by the 'fly' branch).
  contactDamage: 8,
  contactCooldown: 0.6,
  swing: { reach: 40, halfHeight: 26, forward: 12, damage: 12, knockback: 300 },
  hitstun: 0.26,
  hurtIframe: 0.12,
  knockbackTakeMult: 1.1,
  cellDrop: 4,
  noGravity: true, // GameScene reads this to disable body gravity + skip the solids collider (AC59).
}

// ── ENEMY_SPECS (id → spec) ── the lookup GameScene + the verifier use to resolve an archetype id to
// its spec. The four archetypes (≥4, AC59). KISS: a flat map, mirroring WEAPONS/BIOMES.
export const ENEMY_SPECS = {
  grunt: GRUNT,
  shooter: SHOOTER,
  charger: CHARGER,
  flyer: FLYER,
}

// The ordered list (for the verifier sweep + any list rendering).
export const ENEMY_ARCHETYPES = [GRUNT, SHOOTER, CHARGER, FLYER]

// ── ELITE affix (design §6.11, Decision 77, AC64) ──
// An elite is a NORMAL archetype with a small bundle of MODIFIERS rolled at spawn — NOT a new archetype
// or subclass (it reuses the ONE Enemy FSM, the Decision-68 philosophy): a bigger body, more HP, a gold
// tint, a TIGHTER telegraph (faster wind-up → it punishes a lazy dodge), and a DEATH BURST (a radial fan
// of pooled 'enemy' projectiles when it dies — a "don't melee it carelessly" tell). Cheap mid-run spikes
// that materially raise encounter variety on the SAME scaffolding (the genre's elite pressure).
//
// PURE DATA (verifier-importable): the affix is a plain modifier object Enemy.js folds into its live spec
// at construction (it never mutates the shared archetype spec — same aliasing safety as scaleSpec). The
// roll CHANCE is data here too (GameScene rolls it off a fresh seeded RNG so a run replays the same elites).
//   hpMult        — multiply the (already depth-scaled) maxHp (a tankier elite).
//   bodyScale     — scale bodyW/bodyH (a visibly bigger threat — reads at a glance).
//   tint          — the resting-fill colour override (gold — the elite tell, distinct from every archetype).
//   telegraphMult — scale the attack wind-up (< 1 → faster telegraph: a tighter dodge window, AC56-aware).
//   cellBonus     — extra Cells dropped on death (an elite is a priority kill → a richer reward).
//   deathBurst    — { count, projectile } | null: a radial volley fired from the enemy ProjectilePool on
//                   death (the affix's signature — a posthumous AoE you must respect). null = no burst.
export const ELITE_AFFIX = {
  hpMult: 2.2, // a chunky HP bump so an elite is a real time-sink (≈ a mini-spike mid-room).
  bodyScale: 1.35, // a bigger body — the visual tell + a touch easier to hit (a fair trade for the HP).
  tint: 0xf1c40f, // gold — the universal elite colour (over the archetype's resting fill).
  telegraphMult: 0.7, // tighter wind-ups (faster attacks) — punishes a careless dodge (the elite pressure).
  cellBonus: 4, // +4 Cells on death (a priority-kill reward — more meta currency for the harder fight).
  // DEATH BURST: a 6-shot radial fan of weak 'enemy' projectiles on death (dodge the corpse). Uses the
  // SAME projectile shape the SHOOTER/boss volley fire (Decision 65) so it rides the existing pool + the
  // enemy-projectile→player overlap with NO new wiring. Low per-shot damage (it's a "step back" tell, not
  // a one-shot). The fan is centred radially in Enemy._die.
  deathBurst: {
    count: 6, // projectiles in the radial ring (evenly spaced — a 360° fan).
    projectile: { speed: 300, damage: 8, knockback: 200, lifetime: 1.0, w: 12, h: 12 },
  },
}

// The per-spawn elite ROLL chance (design §6.11, Decision 77) — DATA so GameScene rolls it off a fresh
// seeded RNG (a run replays the same elites). KISS: a flat chance (no depth ramp this slice — YAGNI; the
// depth scaling already makes deeper elites tankier via scaleSpec running BEFORE the affix fold).
export const ELITE_CHANCE = 0.16 // ~1 in 6 spawns is an elite (a spike every room-or-two, not every enemy).
