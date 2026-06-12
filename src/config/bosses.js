// ── Boss spec table (design §6.6.1/§6.6.2, Decision 64/66/70, AC56/AC57/AC58/AC61) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node and
// asserts every boss table is WELL-FORMED (≥2 descending-threshold phases, each with a non-empty
// telegraphed attack pattern referencing only known attack kinds — AC56/AC61). Mirrors the project's
// other pure config tables (biomes/weapons/enemies/upgrades): the spec is PLAIN DATA the Phaser-coupled
// Boss.js consumes; the visual colours live on the spec but are read ONLY by Boss.js (like biome
// colours — the verifier ignores them).
//
// THE BOSS SHAPE (Decision 64). A boss is a near-sibling of an enemy spec: an Arcade body size, a
// resting/telegraph/hurt colour, a `maxHp`, an incoming-knockback take-mult (low — a boss is heavy and
// isn't juggled), and a `phases[]` table. Each PHASE is gated by an `hpThreshold` (a descending
// fraction of maxHp: phase 1 from 1.0, phase 2 from 0.5) and carries:
//   • `attacks[]` — the round-robin pattern of attack ids for this phase (each TELEGRAPHED — AC56).
//   • `telegraphMult` — a per-phase scale on each attack's telegraph time (phase 2 < 1 → tighter
//     wind-ups, the back-half pressure ramp — AC56/§6.6.6).
//   • `moveSpeed` — the slow hover/step speed toward the player between attacks (phase 2 faster).
//
// ATTACK KINDS (Decision 64 — parameterised shapes; Boss.js implements each):
//   • 'slam'   — a big melee swing in front (acquires from the shared enemyHitboxes pool — the swing
//                schema). `swing` (reach/halfHeight/forward/damage/knockback) tunes it.
//   • 'volley' — fires N pooled 'enemy' projectiles in a small spread toward the player (the enemy
//                ProjectilePool — Decision 65). `volley` ({ count, spreadDeg, projectile }) tunes it.
//   • 'dash'   — a telegraphed horizontal lunge across the arena with a body-contact hitbox.
//                `dash` ({ speed, contactDamage }) tunes it.
//   • 'sweep'  — (Enrichment round 3 — the NEW kind) a TRUE-radial 360° RING of pooled 'enemy'
//                projectiles fired all at once from the boss (a "find the gap / jump it" zone), enabled
//                now that the ProjectilePool gives shots a real 2-D velocity. It exercises the existing
//                enemy ProjectilePool + the enemy-projectile→player overlap (NO new wiring) but plays
//                COMPLETELY differently from the player-aimed volley — it ignores where you stand, so you
//                dodge by weaving a gap in the ring, not by side-stepping a cone. `count` is the ring
//                density (more = tighter gaps). This is the round-3 "make the climax feel fresh" lever:
//                the two bosses now share FOUR primitives, not three, with a genuinely new dodge pattern.
// An attack entry is `{ kind, telegraph, active, recovery, ...params }`. Phase 2 adds denser attacks +
// tightens telegraphs (telegraphMult) → the genre's "the back half demands cleaner play".
//
// DEPTH SCALING (Decision 64/66, AC61 — the HONEST scope, review MAJOR). GameScene folds the boss spec
// by scaleAtDepth(depth) via a BOSS-SPECIFIC fold (scaleBossSpec, config/difficulty.js) — NOT the
// enemy scaleSpec (which only touches maxHp/contactDamage/speeds/swing.damage and would MISS the boss's
// phases/volley/dash damage). scaleBossSpec scales maxHp + every attack's damage (slam.swing.damage,
// volley.projectile.damage, dash.contactDamage) by the curve, leaving telegraph/cadence/counts alone
// (a deeper boss is TANKIER + hits HARDER, but stays equally readable). This is documented HONESTLY:
// the verifier's whole-run monotonicity proof reads the DEPTH CURVE + biome tier (effectiveDifficulty),
// NOT the boss HP/attack tuning — so the boss balance is NOT proven by that walk. What the verifier
// DOES prove for the boss is a TABLE WELL-FORMEDNESS check (descending thresholds, known attack kinds,
// a non-empty pattern per phase) — a guardrail against a malformed re-tune, not a balance proof.

// ── RAMPARTS_BOSS — "The Warden" (the only boss this slice, Decision 67/§6.6.7). ──
// Two phases. Phase 1 (100%→50%): a readable slam + dash rotation. Phase 2 (≤50%): tighter telegraphs,
// adds the projectile volley, moves faster — the back-half escalation (AC56). HP sized (depth-scaled at
// the boss biome, the deepest) so a clean run with a decent weapon + some meta kills it in ≈45–75s of
// dodging telegraphs (§6.6.6 budget); its strikes hit hard enough that 3–4 missed dodges kill an
// unupgraded player (Decision 70 / AC61).
export const RAMPARTS_BOSS = {
  id: 'rampartsBoss',
  name: 'The Warden',
  maxHp: 520, // base HP (depth-scaled up at the boss biome — see scaleBossSpec).
  bodyW: 84, // a big body (the hurtbox + contact source — Decision 64).
  bodyH: 96,
  color: 0x884ea0, // resting fill (royal purple — reads as a boss).
  colorTelegraph: 0xf5b041, // wind-up colour (amber) — the dodge tell (AC56).
  colorHurt: 0xffffff, // brief flinch flash on a hit.
  colorPhase: 0xe74c3c, // a red flash on the phase-change tell (AC56).
  knockbackTakeMult: 0.18, // heavy — barely nudged by a hit so it can't be juggled (Decision 64).
  contactDamage: 16, // hp — touching the boss body hurts (separate from its strikes).
  contactCooldown: 0.7, // s — min gap between contact ticks.
  hitstun: 0.0, // s — NO long hitstun (a brief flinch only; never interrupts a committed strike).
  hurtIframe: 0.06, // s — a tiny post-hit i-frame so one swing's dedup + this stop re-hits.

  // ── Phases (descending hpThreshold — AC56). Phase i is active while hp/maxHp ≤ phases[i].hpThreshold
  // and > phases[i+1].hpThreshold; the boss ADVANCES once when hp crosses the next threshold (a guarded
  // edge). The FIRST phase MUST have hpThreshold 1.0 (active from full HP). ──
  phases: [
    {
      // ── Phase 1 (100% → 50%): a readable slam ↔ dash rotation, generous telegraphs. ──
      hpThreshold: 1.0,
      telegraphMult: 1.0,
      moveSpeed: 70, // px/s — a slow menacing step toward the player between attacks.
      attacks: ['slam', 'dash', 'slam'],
    },
    {
      // ── Phase 2 (≤50%): tighter telegraphs, ADDS the volley + the round-3 SWEEP ring, moves faster
      // (the escalation, AC56). The sweep is the new "find the gap in the ring" pressure on the back half. ──
      hpThreshold: 0.5,
      telegraphMult: 0.72, // wind-ups shrink → cleaner play required (the back-half ramp).
      moveSpeed: 110,
      attacks: ['slam', 'volley', 'sweep', 'dash', 'volley'],
    },
  ],

  // ── Attack parameters (shared across phases; the pattern picks which to run). Each entry's
  // telegraph is multiplied by the active phase's telegraphMult at run time (Boss.js). ──
  attacks: {
    // 'slam' — a big melee swing in front (the enemyHitboxes pool). A wide, hard-hitting box.
    slam: {
      kind: 'slam',
      telegraph: 0.7, // s — a long, readable wind-up (the dodge window).
      active: 0.16, // s — the strike's live hitbox window.
      recovery: 0.6, // s — the punish window after you dodge it.
      swing: { reach: 120, halfHeight: 64, forward: 30, damage: 22, knockback: 520 },
    },
    // 'volley' — fires `count` pooled 'enemy' projectiles in a small vertical spread (Decision 65).
    volley: {
      kind: 'volley',
      telegraph: 0.55, // s — an aim wind-up before the burst.
      active: 0.12, // s — the loose beat (projectiles fired at telegraph end).
      recovery: 0.55,
      count: 3, // projectiles per volley (phase 2 only uses this attack).
      spreadDeg: 22, // total vertical spread (deg) across the burst (a small fan).
      projectile: { speed: 420, damage: 14, knockback: 220, lifetime: 2.2, w: 16, h: 8 },
    },
    // 'dash' — a telegraphed horizontal lunge across the arena with a body-contact hitbox.
    dash: {
      kind: 'dash',
      telegraph: 0.75, // s — a very readable wind-up (you can dodge the lunge).
      active: 0.45, // s — the dash duration (body-contact hitbox live the whole time).
      recovery: 0.8, // s — a long recovery (the big punish window).
      speed: 700, // px/s — the lunge velocity.
      contactDamage: 26, // hp — a heavy slam if the dash connects.
      knockback: 600, // px/s — the shove on a dash hit.
    },
    // 'sweep' (round-3 NEW kind) — a TRUE-radial 360° ring of pooled 'enemy' projectiles fired at once.
    // You dodge by weaving the gap between bolts (or jumping the ring), not by side-stepping — a genuinely
    // new pattern the 2-D projectile work unlocked. A long readable telegraph (it's a big tell); the ring is
    // SPARSE enough (count vs lifetime) that a clean player threads it. Same projectile shape as the volley.
    sweep: {
      kind: 'sweep',
      telegraph: 0.8, // s — a long, very readable wind-up (the ring is a big commitment).
      active: 0.14, // s — the "release" beat (the whole ring fires at telegraph end).
      recovery: 0.7, // s — a long recovery (the punish window after you thread the ring).
      count: 10, // bolts in the ring (evenly spaced over 360° — sparse enough to weave a gap).
      projectile: { speed: 320, damage: 16, knockback: 220, lifetime: 2.2, w: 14, h: 14 },
    },
  },
}

// ── RAMPARTS_BOSS_2 — "The Hollow Sentinel" (design §6.12, Decision 78, AC65 — the 2nd boss) ──
// A DISTINCT fight from the Warden, gated on the SAME boss biome via a SEEDED pick (Decision 78 — different
// runs face different bosses, the variety win): where the Warden is a slow melee bruiser (slam/dash), the
// Sentinel is a faster RANGED-pressure boss — less HP, quicker telegraphs, a volley in BOTH phases (it
// zones you out) plus a dash to punish camping. Phase 2 adds a slam + tightens further (the back-half ramp).
// It satisfies the EXACT pure boss-table contract the verifier checks (≥2 descending phases, the first 1.0,
// known attack kinds, every referenced attack present, telegraph/active > 0) so it is a pure-config add —
// zero Boss.js change (the FSM dispatches by attack kind, which it already handles — slam/volley/dash).
export const RAMPARTS_BOSS_2 = {
  id: 'rampartsBoss2',
  name: 'The Hollow Sentinel',
  maxHp: 420, // less HP than the Warden (it pressures with ranged tempo, not a tank check).
  bodyW: 76,
  bodyH: 88,
  color: 0x2980b9, // resting fill (steel blue — distinct from the Warden's purple).
  colorTelegraph: 0xf5d76e, // wind-up colour (pale gold) — the dodge tell (AC56).
  colorHurt: 0xffffff,
  colorPhase: 0xe74c3c,
  knockbackTakeMult: 0.2, // heavy (barely nudged) — slightly less so than the Warden (a touch lighter).
  contactDamage: 14,
  contactCooldown: 0.7,
  hitstun: 0.0,
  hurtIframe: 0.06,
  phases: [
    {
      // ── Phase 1 (100% → 50%): a volley ↔ dash zoning rotation, quick readable telegraphs. ──
      hpThreshold: 1.0,
      telegraphMult: 0.9, // already a touch faster than the Warden's 1.0 (a tempo boss).
      moveSpeed: 90, // px/s — it repositions faster between attacks (keeps its spacing).
      attacks: ['volley', 'dash', 'volley'],
    },
    {
      // ── Phase 2 (≤50%): adds the slam + the round-3 SWEEP ring (its DENSE zoning signature), tightens
      // telegraphs, moves faster (the escalation, AC56). The Sentinel's sweep is denser than the Warden's —
      // its ranged identity carried into the ring (harder gaps to thread). ──
      hpThreshold: 0.5,
      telegraphMult: 0.66,
      moveSpeed: 130,
      attacks: ['volley', 'sweep', 'slam', 'dash', 'volley'],
    },
  ],
  attacks: {
    // 'slam' — a melee swing (smaller than the Warden's — the Sentinel is a ranged boss, melee is a punish).
    slam: {
      kind: 'slam',
      telegraph: 0.6,
      active: 0.16,
      recovery: 0.55,
      swing: { reach: 100, halfHeight: 56, forward: 28, damage: 20, knockback: 480 },
    },
    // 'volley' — a WIDER, denser fan than the Warden's (its signature zoning tool — more shots, more spread).
    volley: {
      kind: 'volley',
      telegraph: 0.5,
      active: 0.12,
      recovery: 0.5,
      count: 5, // more shots than the Warden's 3 (a denser fan — its identity).
      spreadDeg: 34, // a wider vertical spread (harder to weave through).
      projectile: { speed: 460, damage: 13, knockback: 200, lifetime: 2.4, w: 16, h: 8 },
    },
    // 'dash' — a fast lunge to punish a player who camps at range (closes the gap the volley opens).
    dash: {
      kind: 'dash',
      telegraph: 0.65,
      active: 0.4,
      recovery: 0.7,
      speed: 760, // faster than the Warden's dash (it's a quicker boss).
      contactDamage: 24,
      knockback: 560,
    },
    // 'sweep' (round-3 NEW kind) — the Sentinel's DENSE radial ring (its zoning identity carried into the
    // 360° pattern). More bolts than the Warden's sweep (tighter gaps to thread), a touch quicker telegraph.
    sweep: {
      kind: 'sweep',
      telegraph: 0.7,
      active: 0.12,
      recovery: 0.6,
      count: 14, // a denser ring than the Warden's 10 (harder gaps — the ranged boss's signature).
      projectile: { speed: 340, damage: 14, knockback: 200, lifetime: 2.4, w: 14, h: 14 },
    },
  },
}

// ── BOSSES (id → spec) ── the lookup GameScene reads (biome.boss → BOSSES[id]). TWO bosses now (§6.12,
// Decision 78); the boss biome's `boss` is an ARRAY of ids, and GameScene picks one off the run seed so
// different runs face a different fight (the variety win) — a clean extension of the Decision-67 seam.
export const BOSSES = {
  rampartsBoss: RAMPARTS_BOSS,
  rampartsBoss2: RAMPARTS_BOSS_2,
}

// The ordered list (for the verifier's well-formedness sweep — BOTH bosses are checked).
export const BOSS_ORDER = [RAMPARTS_BOSS, RAMPARTS_BOSS_2]

// ── Known attack kinds (the verifier asserts every phase's pattern references only these — AC56). The
// round-3 'sweep' (a true-radial projectile ring — Boss.js dispatches it) is the FOURTH primitive. ──
export const BOSS_ATTACK_KINDS = ['slam', 'volley', 'dash', 'sweep']
