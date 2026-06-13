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

// ── Shared data shapes (FOUNDATION exports — consumers import these) ──
// The melee-swing geometry row every spec carries (cosmetic marker size for ranged/charge/fly too).
export interface EnemySwingSpec {
  reach: number
  halfHeight: number
  forward: number
  damage: number
  knockback: number
}

// The fired projectile spec (same shape as BOW.projectile — Decision 65). Read by the enemy ProjectilePool.
export interface EnemyProjectileSpec {
  speed: number
  damage: number
  knockback: number
  lifetime: number
  w: number
  h: number
}

// ── The enemy ATTACK vocabulary (enemy-ai-telegraphs §6.1, Decision 1/7) ──────────────────────────────
// One shared `kind` set MIRRORING the boss's BossAttackKind (DRY) so a player reads enemy and boss
// wind-ups with the SAME language (AC5). An archetype carries an `attacks: EnemyAttackSpec[]` table; the
// ONE Enemy FSM picks one per attack at runtime (a weighted pick — Decision 1/4) and the chosen entry
// drives the telegraph DURATION, the strike DISPATCH (keyed on `kind`, NOT the archetype's `behavior` —
// Decision 6, the unlock for cross-behavior variety like a charger's stationary ground-pound), and the
// active/recovery TIMINGS. This module stays 100% PURE: the kinds + numbers are plain data the verifier
// (scripts/verify-gen.mjs §6a, AC6) sweeps and difficulty.scaleSpec (AC depth-scaling) folds.
export type EnemyAttackKind = 'swing' | 'shoot' | 'dash' | 'swoop'

export interface EnemyAttackSpec {
  kind: EnemyAttackKind
  weight: number // runtime weighted pick (Decision 1) — relative likelihood (> 0).
  telegraph: number // s — the wind-up (the dodge window, AC1/AC56-style). MUST be > 0.
  active: number // s — the strike's live window. ≥ 0.
  recovery: number // s — the punish window after the strike. ≥ 0.
  // 'swing' (melee): the pooled-hitbox geometry (the existing EnemySwingSpec shape — a charger ground-pound
  // rides this too: a wide stationary swing). REQUIRED for kind:'swing' (the verifier asserts swing.damage).
  swing?: EnemySwingSpec
  // 'shoot' (ranged): the fired bolt + an optional fan (reuses the SHOOTER/SPITTER fields). REQUIRED for
  // kind:'shoot' (the verifier asserts projectile.damage — parity with the §6a ranged check).
  projectile?: EnemyProjectileSpec
  projectileCount?: number // shots per fan (1 = a single bolt — the identity).
  projectileSpread?: number // total fan width in DEGREES (a cone aimed at the player).
  // 'dash' (charge): the committed horizontal lunge velocity (px/s). Read by the 'dash' active window.
  chargeSpeed?: number
  // 'swoop' (fly): the 2-D lunge speed (px/s) toward the player. Read by the 'swoop' active window.
  swoopSpeed?: number
}

// An enemy archetype spec — the shared field shape (Decision 68) plus behaviour-specific optional fields
// (each read ONLY by that behaviour's branch in Enemy.js, undefined-safe). GameScene + the verifier read it.
export interface EnemySpec {
  id: string
  behavior: string
  maxHp: number
  bodyW: number
  bodyH: number
  color: number
  colorTelegraph: number
  colorHurt: number
  // ── Per-phase attack flash (enemy-ai-telegraphs §6.5, AC1) ── COSMETIC body colours read ONLY by the
  // Phaser-coupled Enemy.js (like color/colorTelegraph): colorActive flashes on the strike's LIVE window,
  // colorRecovery dims during the punish window — so the player reads "dodge now" → "punish now". Both
  // optional: Enemy.js falls back (colorActive→colorTelegraph, colorRecovery→color) when a spec omits them,
  // so the verifier does NOT require them (they're not part of the data contract — purely visual).
  colorActive?: number
  colorRecovery?: number
  patrolSpeed: number
  chaseSpeed: number
  chaseAccel: number
  detectRange: number
  detectHeight: number
  loseRange: number
  loseGrace: number
  attackRange: number
  attackCooldown: number
  telegraph: number
  attackActive: number
  attackRecovery: number
  contactDamage: number
  contactCooldown: number
  swing: EnemySwingSpec
  // ── The per-archetype ATTACK table (enemy-ai-telegraphs §6.1, Decision 1/5, AC3/AC8) ── a non-empty
  // list of fully-telegraphed strikes the FSM picks ONE from per attack (a runtime weighted pick). MIGRATION
  // (Decision 5): attacks[0] reproduces the spec's LEGACY single strike (same telegraph/active/recovery/
  // swing/projectile numbers) so a 1-entry table is byte-identical to today (AC8); the added entries are
  // variety, never a re-tune of the base. The strike dispatch keys on attacks[].kind (Decision 6).
  attacks: EnemyAttackSpec[]
  hitstun: number
  hurtIframe: number
  knockbackTakeMult: number
  cellDrop: number
  // behaviour-specific (optional — read ONLY by the matching branch in Enemy.js):
  preferredRange?: number // 'ranged' — kiting distance.
  projectile?: EnemyProjectileSpec // 'ranged' — the fired bolt.
  projectileCount?: number // 'ranged' + spread — shots per fan.
  projectileSpread?: number // 'ranged' + spread — total fan width in degrees.
  chargeSpeed?: number // 'charge' — the dash velocity.
  hoverHeight?: number // 'fly' — preferred height above the player.
  swoopSpeed?: number // 'fly' — the 2-D lunge speed.
  noGravity?: boolean // 'fly' — GameScene disables body gravity + skips the solids collider.
}

// An elite affix — a small bundle of MODIFIERS folded onto a normal archetype (Decision 77). All fields
// optional (an absent field is the neutral default — Enemy._foldElite reads them undefined-safe).
export interface EliteAffixSpec {
  id: string
  hpMult?: number
  bodyScale?: number
  tint?: number
  telegraphMult?: number
  speedMult?: number
  knockbackTakeMult?: number
  hpRegenPerSec?: number
  cellBonus?: number
  deathBurst?: { count: number; projectile: EnemyProjectileSpec } | null
}

// A weighted entry in the elite roll set (mirrors the biome enemyPool shape — DRY weighted-pick idiom).
export interface EliteAffixWeight {
  affix: EliteAffixSpec
  w: number
}

// ── GRUNT — the melee Brute (the canonical Phase-4 enemy; re-exported as BRUTE_SPEC). ──
// Identical numbers to the old Enemy.js BRUTE_SPEC so the regression pin + Phase-4 feel are unchanged.
export const GRUNT: EnemySpec = {
  id: 'grunt',
  behavior: 'melee',
  maxHp: 60,
  bodyW: 38,
  bodyH: 54,
  color: 0xc0392b, // resting fill (brick red).
  colorTelegraph: 0xf1c40f, // wind-up flash (yellow) so the attack is readable (AC24).
  colorActive: 0xffe680, // bright flash on the strike's live window (the "dodge NOW" cue, AC1).
  colorRecovery: 0x7b241c, // dim red during the punish window (the "punish NOW" cue, AC1).
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
  // ── attacks[] (AC3/AC8) ── [0] = the Phase-4 quick jab (IDENTICAL numbers to the legacy single strike,
  // so a 1-entry table is byte-identical — Decision 5); [1] = a HEAVY OVERHEAD: a longer wind-up (the big
  // read), more reach/damage/knockback, a longer recovery (a wider punish window). The grunt now mixes a
  // fast poke with a committed slam, so a long fight rewards reading WHICH one rather than dodging on repeat.
  attacks: [
    { kind: 'swing', weight: 3, telegraph: 0.42, active: 0.12, recovery: 0.45, swing: { reach: 56, halfHeight: 30, forward: 16, damage: 12, knockback: 320 } },
    { kind: 'swing', weight: 2, telegraph: 0.6, active: 0.14, recovery: 0.6, swing: { reach: 68, halfHeight: 36, forward: 18, damage: 18, knockback: 440 } },
  ],
  hitstun: 0.28, // s — how long a `hurt` reaction freezes the AI.
  hurtIframe: 0.12, // s — brief post-hit i-frame so one swing's dedup + this both stop re-hits.
  knockbackTakeMult: 1.0, // scales incoming knockback (heavier enemies could lower this).
  cellDrop: 3, // Cells dropped on death (the meta currency).
}

// ── SHOOTER — a ranged glass cannon (behavior:'ranged', AC59). ──
// Keeps a preferred distance and fires a pooled 'enemy' projectile on the attack beat instead of a
// melee swing. Low HP (dies fast if you close the gap) but punishes a careless ranged approach. The
// projectile spec is the BOW's projectile, re-tuned slightly slower/weaker (a fair telegraphed shot).
// Hoisted so BOTH the spec's top-level `projectile` (back-compat) AND attacks[0]/attacks[1] reference the
// SAME bolt (DRY — one source for the shooter's shot; the burst just fires 2 of them across a small spread).
const SHOOTER_BOLT: EnemyProjectileSpec = {
  ...BOW.projectile!,
  speed: 460, // px/s — slower than the player's bow (dodgeable on reaction).
  damage: 10, // hp — a fair telegraphed shot.
  knockback: 200,
  lifetime: 1.6,
}
export const SHOOTER: EnemySpec = {
  id: 'shooter',
  behavior: 'ranged',
  maxHp: 38, // a glass cannon — dies fast if you reach it.
  bodyW: 34,
  bodyH: 50,
  color: 0x8e44ad, // resting fill (purple — distinct from the grunt's red).
  colorTelegraph: 0xf1c40f,
  colorActive: 0xe0b3ff, // bright flash on the loose (the bolt fires — AC1).
  colorRecovery: 0x512e5f, // dim purple during the reload recovery (the punish window — AC1).
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
  projectile: SHOOTER_BOLT,
  // ── attacks[] (AC3/AC8) ── [0] = the LEGACY single aimed bolt (same telegraph/active/recovery + the
  // SHOOTER_BOLT — byte-identical to today, Decision 5); [1] = a 2-SHOT BURST: a slightly longer wind-up
  // then two bolts across a small spread, so it forces a WIDER dodge or a relocate (real spacing variety,
  // not the same single bolt on repeat). Both reuse SHOOTER_BOLT (DRY — the burst is just count:2).
  attacks: [
    { kind: 'shoot', weight: 3, telegraph: 0.5, active: 0.1, recovery: 0.4, projectile: SHOOTER_BOLT, projectileCount: 1 },
    { kind: 'shoot', weight: 2, telegraph: 0.62, active: 0.1, recovery: 0.5, projectile: SHOOTER_BOLT, projectileCount: 2, projectileSpread: 16 },
  ],
  hitstun: 0.3,
  hurtIframe: 0.12,
  knockbackTakeMult: 1.2, // light — gets juggled a bit (it's frail).
  cellDrop: 4, // drops a touch more (it's a priority kill).
}

// ── CHARGER — a tanky dasher (behavior:'charge', AC59). ──
// Its attack is a LONGER telegraph then a fast horizontal DASH (a burst of vx) with a body-contact
// hitbox, overshooting past the player; high contact damage, slow to re-wind. Tanky (high HP, heavy).
export const CHARGER: EnemySpec = {
  id: 'charger',
  behavior: 'charge',
  maxHp: 95, // tanky — soaks hits.
  bodyW: 46,
  bodyH: 56,
  color: 0xd35400, // resting fill (burnt orange).
  colorTelegraph: 0xf39c12,
  colorActive: 0xffd27f, // bright flash while the dash/pound is live (the "dodge NOW" cue, AC1).
  colorRecovery: 0x873600, // dim burnt-orange during the long recovery (the big punish window, AC1).
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
  // ── attacks[] (AC3/AC8) ── [0] = the LEGACY dash (kind:'dash', same telegraph/active/recovery + the
  // chargeSpeed — byte-identical, Decision 5); [1] = a GROUND-POUND: a STATIONARY kind:'swing' with a wide
  // halfHeight (an in-place AoE you dodge by SPACING, not by side-stepping a lunge). A charger now mixes a
  // commit-lunge with a hold-ground slam — the dispatch keys on the attack kind, NOT the 'charge' behavior
  // (Decision 6), which is what lets a 'charge' archetype carry a 'swing' attack.
  attacks: [
    { kind: 'dash', weight: 3, telegraph: 0.62, active: 0.42, recovery: 0.7, chargeSpeed: 620 },
    { kind: 'swing', weight: 2, telegraph: 0.7, active: 0.18, recovery: 0.8, swing: { reach: 72, halfHeight: 48, forward: 0, damage: 18, knockback: 360 } },
  ],
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
//
// The hover-spit bolt (attacks[1]): a single SLOW bolt fired from altitude so the flyer can threaten
// WITHOUT committing its body (real spacing variety for the air unit). Hoisted (DRY) — the same shape the
// SHOOTER's bolt uses, slower + weaker (the swoop is the flyer's heavy option; the spit is the poke).
const FLYER_SPIT: EnemyProjectileSpec = {
  ...BOW.projectile!,
  speed: 360, // px/s — slow, lobbed from above (dodgeable on reaction).
  damage: 8,
  knockback: 160,
  lifetime: 1.8,
}
export const FLYER: EnemySpec = {
  id: 'flyer',
  behavior: 'fly',
  maxHp: 44,
  bodyW: 36,
  bodyH: 36,
  color: 0x2980b9, // resting fill (blue).
  colorTelegraph: 0xf1c40f,
  colorActive: 0xaed6f1, // bright flash while the swoop/spit is live (the "dodge NOW" cue, AC1).
  colorRecovery: 0x1a5276, // dim blue during the hover recovery (the punish window, AC1).
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
  // ── attacks[] (AC3/AC8) ── [0] = the LEGACY swoop (kind:'swoop', same telegraph/active/recovery + the
  // swoopSpeed — byte-identical, Decision 5); [1] = a HOVER-SPIT: a single slow bolt fired from altitude
  // (kind:'shoot') so the flyer threatens WITHOUT committing its body — it now mixes a body-lunge with a
  // ranged poke (real air-unit spacing variety). The 'shoot' attack carries FLYER_SPIT (the verifier asserts it).
  attacks: [
    { kind: 'swoop', weight: 3, telegraph: 0.36, active: 0.3, recovery: 0.5, swoopSpeed: 460 },
    { kind: 'shoot', weight: 2, telegraph: 0.42, active: 0.1, recovery: 0.55, projectile: FLYER_SPIT, projectileCount: 1 },
  ],
  hitstun: 0.26,
  hurtIframe: 0.12,
  knockbackTakeMult: 1.1,
  cellDrop: 4,
  noGravity: true, // GameScene reads this to disable body gravity + skip the solids collider (AC59).
}

// ── SPITTER — a spread-fire shotgunner (behavior:'ranged' + spread, AC59; Enrichment round 3 — the 5th
// archetype). ── A close-to-mid ranged enemy that fires a 3-shot FAN (a tight cone) instead of a single
// bolt, so it punishes a head-on approach you can't simply side-step one bolt out of. It reuses the EXISTING
// 'ranged' behaviour entirely (kiting + fire-on-the-beat) — the ONLY new thing is `projectileSpread` +
// `projectileCount`, a small guarded branch in Enemy._fireStrike that fires N shots across an angular fan via
// the round-3 2-D projectile aim (no new behaviour branch in the FSM — the Decision-68 philosophy). Tanky-ish
// mid HP (it holds ground and sprays). Its threat is the SPREAD, so a single shot is weak. The 5th archetype
// keeps the deepest pools from feeling stale (paired with the 4th biome below).
//
// The two bolts (hoisted, DRY): SPITTER_BOLT is the weak fan pellet (3 of them — the threat is the cone);
// SPITTER_SNIPE is a faster, harder single bolt (attacks[1] — a narrow-telegraph aimed shot so the spitter
// isn't always the same cone, it occasionally snaps a precise round).
const SPITTER_BOLT: EnemyProjectileSpec = {
  ...BOW.projectile!,
  speed: 420,
  damage: 7, // low per-shot (3 of them across a fan — you must dodge the cone, not one bolt).
  knockback: 160,
  lifetime: 1.5,
}
const SPITTER_SNIPE: EnemyProjectileSpec = {
  ...BOW.projectile!,
  speed: 560, // faster — a precise aimed round (a narrower telegraph wind-up).
  damage: 12,
  knockback: 220,
  lifetime: 1.6,
}
export const SPITTER: EnemySpec = {
  id: 'spitter',
  behavior: 'ranged', // REUSES the shooter FSM path (kite + fire on the beat) — only the fan is new.
  maxHp: 70, // sturdier than the glass-cannon Shooter (it stands and sprays).
  bodyW: 40,
  bodyH: 48,
  color: 0x16a085, // resting fill (teal — distinct from the Shooter's purple).
  colorTelegraph: 0xf1c40f,
  colorActive: 0xa3e4d7, // bright flash on the loose (the cone/round fires — AC1).
  colorRecovery: 0x0e6251, // dim teal during the reload recovery (the punish window, AC1).
  colorHurt: 0xffffff,
  patrolSpeed: 56,
  chaseSpeed: 120,
  chaseAccel: 760,
  detectRange: 420,
  detectHeight: 150,
  loseRange: 540,
  loseGrace: 1.4,
  attackRange: 320, // px — fires from mid range (closer than the Shooter — the fan wants you near).
  preferredRange: 220, // px — kites to keep a mid gap (the fan is most dangerous at this spacing).
  attackCooldown: 1.8, // s — a slower cadence (a fan is a bigger commitment than one bolt).
  telegraph: 0.55, // s — a clear aim wind-up (the fan is dodgeable on reaction, AC56).
  attackActive: 0.1,
  attackRecovery: 0.45,
  contactDamage: 6,
  contactCooldown: 0.7,
  swing: { reach: 30, halfHeight: 20, forward: 12, damage: 0, knockback: 0 }, // well-formed (never swung).
  // The fired projectile (weaker per-shot than the Shooter's — its threat is the SPREAD, not one bolt).
  projectile: SPITTER_BOLT,
  projectileCount: 3, // shots per fan (round-3 — read ONLY by the 'ranged' spread branch in Enemy).
  projectileSpread: 26, // total fan width in DEGREES (a tight cone aimed at the player).
  // ── attacks[] (AC3/AC8) ── [0] = the LEGACY 3-shot fan (same telegraph/active/recovery + SPITTER_BOLT +
  // the count:3/spread:26 — byte-identical to today, Decision 5); [1] = a single AIMED SNIPER bolt: a faster,
  // harder round with a NARROWER telegraph, so the spitter isn't always the same cone (it occasionally snaps
  // a precise shot you must read differently — variety per archetype, AC3).
  attacks: [
    { kind: 'shoot', weight: 3, telegraph: 0.55, active: 0.1, recovery: 0.45, projectile: SPITTER_BOLT, projectileCount: 3, projectileSpread: 26 },
    { kind: 'shoot', weight: 2, telegraph: 0.4, active: 0.1, recovery: 0.4, projectile: SPITTER_SNIPE, projectileCount: 1 },
  ],
  hitstun: 0.26,
  hurtIframe: 0.12,
  knockbackTakeMult: 1.0,
  cellDrop: 5, // a priority kill (a richer drop than the Shooter — it's tankier + more dangerous up close).
}

// ── ENEMY_SPECS (id → spec) ── the lookup GameScene + the verifier use to resolve an archetype id to
// its spec. FIVE archetypes now (≥4, AC59; round-3 added the Spitter). KISS: a flat map, mirroring WEAPONS.
export const ENEMY_SPECS: Record<string, EnemySpec> = {
  grunt: GRUNT,
  shooter: SHOOTER,
  charger: CHARGER,
  flyer: FLYER,
  spitter: SPITTER,
}

// The ordered list (for the verifier sweep + any list rendering).
export const ENEMY_ARCHETYPES: EnemySpec[] = [GRUNT, SHOOTER, CHARGER, FLYER, SPITTER]

// ── ELITE affixes (design §6.11, Decision 77, AC64; Enrichment round 3 — the weighted set) ──
// An elite is a NORMAL archetype with a small bundle of MODIFIERS rolled at spawn — NOT a new archetype
// or subclass (it reuses the ONE Enemy FSM, the Decision-68 philosophy): a bigger body, more HP, a tint,
// a tighter/looser telegraph, and a per-affix gimmick. Cheap mid-run spikes that materially raise
// encounter variety on the SAME scaffolding (the genre's elite pressure).
//
// WHY A SET (the round-3 variety fix): the old code had ONE hardcoded affix, so every elite played
// identically (always the same gold tank with a death burst). This is now a small WEIGHTED set of FOUR
// affixes — frost / explosive / regenerating / fast — each a distinct threat, so elites VARY run-to-run.
// All are PURE-DATA adds Enemy.js folds; GameScene rolls one off a seeded RNG (a run replays the same
// elites). KISS: four affixes (YAGNI on more); each leans on the EXISTING fold + two tiny new hooks
// (speedMult, hpRegenPerSec) the Enemy reads undefined-safe — near-zero engine risk.
//
// THE AFFIX FIELDS (Enemy._foldElite reads these; all optional — an absent field is the neutral default):
//   id            — the affix id (for the verifier sweep + any debug readout).
//   hpMult        — multiply the (already depth-scaled) maxHp (a tankier elite).
//   bodyScale     — scale bodyW/bodyH (a visibly bigger/smaller threat — reads at a glance).
//   tint          — the resting-fill colour override (the elite tell, per-affix so the kind reads on sight).
//   telegraphMult — scale the attack wind-up (<1 → faster/tighter; >1 → slower/looser). Read off this.elite.
//   speedMult     — scale patrolSpeed + chaseSpeed (a fast elite harasses; folded into the live spec).
//   knockbackTakeMult — OVERRIDE the archetype's incoming-knockback take-mult (a frost elite is unbudgeable).
//   hpRegenPerSec — HP regenerated per second while alive (a regenerating elite — kill it FAST). Ticked in
//                   Enemy.update; capped at maxHp; stops at death. 0/undefined ⇒ no regen.
//   cellBonus     — extra Cells dropped on death (an elite is a priority kill → a richer reward).
//   deathBurst    — { count, projectile } | null: a TRUE-radial volley fired from the enemy ProjectilePool
//                   on death (the explosive affix's signature — a posthumous AoE). null = no burst.

// FROST — an icy bulwark: very tanky, barely knocked back (unbudgeable), a SLOWER/looser telegraph (it's
// ponderous) so the threat is its durability, not its speed. The blue tint reads "this one tanks".
export const ELITE_FROST: EliteAffixSpec = {
  id: 'frost',
  hpMult: 3.0, // the tankiest affix — a real time-sink (kite it or commit).
  bodyScale: 1.4,
  tint: 0x5dade2, // icy blue — the frost tell.
  telegraphMult: 1.1, // a touch SLOWER wind-up (ponderous) — the trade for the durability.
  knockbackTakeMult: 0.35, // barely nudged — you can't juggle it off you (its "frozen footing").
  cellBonus: 5,
  deathBurst: null,
}

// EXPLOSIVE — the classic "dodge the corpse": a chunky gold elite with the TRUE-radial death burst. A
// tighter telegraph than base so it pressures you while alive, then punishes a careless melee on death.
export const ELITE_EXPLOSIVE: EliteAffixSpec = {
  id: 'explosive',
  hpMult: 2.0,
  bodyScale: 1.35,
  tint: 0xf1c40f, // gold/orange — the explosive tell.
  telegraphMult: 0.75,
  cellBonus: 4,
  // DEATH BURST: a 6-shot TRUE-radial ring of weak 'enemy' projectiles on death (dodge the corpse). Uses
  // the SAME projectile shape the SHOOTER/boss volley fire (Decision 65) so it rides the existing pool +
  // the enemy-projectile→player overlap with NO new wiring. Low per-shot damage (a "step back" tell, not a
  // one-shot). Enemy._fireDeathBurst fires each shot with an `angle` aim so ProjectilePool gives it a real
  // 2-D velocity — the ring arcs in every direction (the round-3 fix: the old pool flattened it left/right).
  deathBurst: {
    count: 6, // projectiles in the radial ring (evenly spaced — a real 360° fan).
    projectile: { speed: 300, damage: 8, knockback: 200, lifetime: 1.0, w: 12, h: 12 },
  },
}

// REGENERATING — a self-healing elite (HP ticks back up while alive): a DPS race. Moderate HP but it
// regenerates, so chip damage doesn't stick — you must commit and kill it fast. Green tint = "it heals".
export const ELITE_REGEN: EliteAffixSpec = {
  id: 'regenerating',
  hpMult: 2.4,
  bodyScale: 1.3,
  tint: 0x2ecc71, // healthy green — the regen tell.
  telegraphMult: 0.85,
  hpRegenPerSec: 6, // HP/s regained while alive (capped at maxHp; stops at death) — kill it before it heals.
  cellBonus: 5,
  deathBurst: null,
}

// FAST — a small, quick harasser: a faster move + a TIGHT telegraph (it punishes a lazy dodge), lower HP
// (it's the glass one) and a smaller body. Red tint = "this one is quick". The agility-pressure affix.
export const ELITE_FAST: EliteAffixSpec = {
  id: 'fast',
  hpMult: 1.5,
  bodyScale: 1.1,
  tint: 0xe74c3c, // hot red — the speed tell.
  telegraphMult: 0.6, // the tightest wind-up — a real dodge-skill check.
  speedMult: 1.45, // noticeably quicker patrol + chase (it closes the gap).
  cellBonus: 4,
  deathBurst: null,
}

// ── ELITE_AFFIXES (the weighted roll set, AC64) ── GameScene picks one off a seeded RNG via the weights.
// KISS: a flat { affix, w } list mirroring the biome enemyPool shape (DRY — the same weighted-pick idiom).
export const ELITE_AFFIXES: EliteAffixWeight[] = [
  { affix: ELITE_FROST, w: 2 },
  { affix: ELITE_EXPLOSIVE, w: 3 }, // the signature affix gets the highest weight (the readable "tell").
  { affix: ELITE_REGEN, w: 2 },
  { affix: ELITE_FAST, w: 3 },
]

// ── ELITE_AFFIX (back-compat default) ── the EXPLOSIVE affix kept under the old export name so any code
// or test that imported the single affix still resolves to a valid, representative elite (DRY — it's the
// same object in ELITE_AFFIXES, not a copy). New code rolls the weighted ELITE_AFFIXES set instead.
export const ELITE_AFFIX: EliteAffixSpec = ELITE_EXPLOSIVE

// The per-spawn elite ROLL chance (design §6.11, Decision 77) — DATA so GameScene rolls it off a fresh
// seeded RNG (a run replays the same elites). KISS: a flat chance (no depth ramp this slice — YAGNI; the
// depth scaling already makes deeper elites tankier via scaleSpec running BEFORE the affix fold).
export const ELITE_CHANCE = 0.16 // ~1 in 6 spawns is an elite (a spike every room-or-two, not every enemy).
