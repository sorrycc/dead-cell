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
// ATTACK KINDS (Decision 64 — 3 reused shapes, parameterised; Boss.js implements each):
//   • 'slam'   — a big melee swing in front (acquires from the shared enemyHitboxes pool — the swing
//                schema). `swing` (reach/halfHeight/forward/damage/knockback) tunes it.
//   • 'volley' — fires N pooled 'enemy' projectiles in a small vertical spread (the enemy
//                ProjectilePool — Decision 65). `volley` ({ count, spreadDeg, projectile }) tunes it.
//   • 'dash'   — a telegraphed horizontal lunge across the arena with a body-contact hitbox.
//                `dash` ({ speed, contactDamage }) tunes it.
// An attack entry is `{ kind, telegraph, active, recovery, ...params }`. Phase 2 adds the 'volley' to
// the pattern + tightens telegraphs (telegraphMult) → the genre's "the back half demands cleaner play".
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
      // ── Phase 2 (≤50%): tighter telegraphs, ADDS the volley, moves faster (the escalation, AC56). ──
      hpThreshold: 0.5,
      telegraphMult: 0.72, // wind-ups shrink → cleaner play required (the back-half ramp).
      moveSpeed: 110,
      attacks: ['slam', 'volley', 'dash', 'volley'],
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
  },
}

// ── BOSSES (id → spec) ── the lookup GameScene reads (biome.boss → BOSSES[id]). ONE boss this slice;
// a 2nd is a config add here + a `boss` id on another biome (Decision 67/§6.6.7 — a clean seam).
export const BOSSES = {
  rampartsBoss: RAMPARTS_BOSS,
}

// The ordered list (for the verifier's well-formedness sweep).
export const BOSS_ORDER = [RAMPARTS_BOSS]

// ── Known attack kinds (the verifier asserts every phase's pattern references only these — AC56). ──
export const BOSS_ATTACK_KINDS = ['slam', 'volley', 'dash']
