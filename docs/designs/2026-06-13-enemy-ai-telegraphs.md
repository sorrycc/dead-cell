# Enemy AI Depth + Telegraph Language

## 1. Background

The combat loop is built around **reading** an attack: the player dodges a telegraphed
wind-up, then punishes the recovery. That contract is implemented once, in the **single
`Enemy` FSM** (`src/entities/Enemy.ts`), and mirrored in `Boss` (`src/entities/Boss.ts`).
The FSM is `idle → patrol → chase → attack → hurt → dead`, with the **attack** state split
into a timed `telegraph` (wind-up, dodgeable) → `strike` (active) → recovery
(`Enemy._tickAttack`, Enemy.ts:406). Archetype variety is a `spec.behavior` tag
(`'melee' | 'ranged' | 'charge' | 'fly'`) driving a handful of **guarded branches** inside
that one machine — **not** subclasses (Decision 68). The five archetype specs live in the
PURE `src/config/enemies.ts` (GRUNT / SHOOTER / CHARGER / FLYER / SPITTER), node-imported and
swept by `scripts/verify-gen.mjs` §6a/§6b (AC59).

Today the encounters are competent but **shallow** along three axes, and the genre's
"reward reads, not HP attrition" promise is under-delivered:

1. **One attack per archetype.** Each `behavior` has exactly one strike shape: a grunt
   always swings, a shooter always fires one bolt (or the spitter's fixed 3-fan), a charger
   always dashes, a flyer always swoops. There is nothing to *read between* — once you've
   seen the wind-up once, every subsequent attack is the identical timing. There is no
   variety **per archetype**, so a long fight is the same dodge on repeat = attrition.

2. **Telegraph language is thin + uniform.** The only wind-up cue is a body **colour
   blink** (`Enemy._updateVisual`, Enemy.ts:661: `colorTelegraph` flashed at 16 Hz). Every
   archetype + every elite shares the identical 16 Hz yellow-ish blink, with no spatial
   "where will it land" cue and no distinct **active** or **recovery** flash. The Boss has a
   richer language — a growing, blinking `telegraphFx` overlay sized/placed per attack kind
   (`Boss._updateTelegraphFx`, Boss.ts:487) — so enemy and boss telegraphs are **not
   consistent**: the boss tells you *where*, the enemy only tells you *that*.

3. **Ranged enemies don't really pressure spacing.** The `'ranged'` kite is a single rule:
   if the player is closer than `preferredRange`, back straight away (Enemy.ts:366). There is
   no repositioning when the player is *outside* that band (it just stands and fires), no
   strafing, and a shooter cornered against a `patrolMaxX` clamp simply plants and keeps
   shooting from point-blank — the opposite of spacing pressure.

This slice deepens the **one** FSM along all three axes while keeping the boss telegraph
language as the shared reference (we extend the enemy language *toward* the boss's, and add a
shared **active/recovery** flash both use).

### The load-bearing constraint (read this first)

The **level GENERATION is deterministic and pinned**: `scripts/verify-gen.mjs` §3 sweeps
N=200 seeds × every biome asserting `generateLevel(seed)` twice → deep-equal, plus a
full-description **regression pin** (PIN_SEED, including the exact `enemies` array with
`patrolMinX/patrolMaxX/spec`). The identity guarantee is: **a fresh encounter spawns the same
enemies in the same places as round 1.** This slice does **not** touch
`src/world/LevelGenerator.ts`, its RNG, the spawn counts/positions, or anything the pin reads.

Per-frame **AI choices** (which of an archetype's attacks to use, which strafe direction to
pick) are explicitly **not** part of the level pin — they run inside `Enemy.update`, which is
never imported by the verifier — so they **may use runtime (non-seeded) randomness**
(`Math.random()`), exactly as the existing `idleTimer` jitter already does
(`this.idleTimer = 0.4 + Math.random() * 0.4`, Enemy.ts:187). This is the same boundary the
elite system respects: the elite *roll* is seeded (off `eliteRng`, off the pin) but the
elite's per-frame *behaviour* is runtime. We keep that boundary crisp.

## 2. Requirements Summary

- **Goal:** Deepen the single `Enemy` FSM so encounters reward READS, not HP attrition:
  (a) a clear, shared **windup → active → recovery** telegraph language (distinct flash per
  phase + a spatial "where it lands" cue), (b) **1–2 more attacks per archetype** (variety
  within an archetype, chosen per-attack), and (c) real **spacing pressure** for ranged
  enemies (reposition/kite/strafe instead of standing still).
- **Keep the boss consistent:** reuse the boss's spatial-warning idea for enemies so the two
  share one visual telegraph vocabulary; do not regress the boss.
- **Reuse the ONE FSM + behavior branches (Decision 68):** all variety is data
  (`spec.attacks[]`) + a few more guarded branches in the existing chase/attack ticks. **No
  subclasses.**
- **Config stays PURE + the verifier sweep (AC59) stays GREEN:** new fields are plain data on
  `EnemySpec`; the §6a sweep is extended to assert the new fields are well-formed.
- **Determinism preserved:** `LevelGenerator.ts` + the generator RNG + spawn counts/positions
  + the regression pin are **byte-unchanged**. Per-frame attack/strafe selection uses runtime
  randomness only (never the level seed).
- **Non-goals (YAGNI):** no new `behavior` archetype (the five stay), no enemy
  status-application (enemies don't apply bleed/poison to the player — that's the boss/weapon
  layer), no pathfinding/A\*, no flocking, no new pooled entity type (reuse the existing
  hitbox + enemy ProjectilePool), no per-attack new sound primitives beyond the existing
  `sfx` hooks.

## 3. Acceptance Criteria

1. **Per-phase telegraph flash (windup → active → recovery).** `Enemy._updateVisual` shows
   THREE distinct, readable states during an attack: the existing blinking `colorTelegraph`
   wind-up, a brief **active** flash (`colorActive`) on the strike's live window, and a dim
   **recovery** tint (`colorRecovery`) during the punish window — so the player can read the
   exact moment to dodge AND the exact moment to punish. A non-attacking enemy is visually
   unchanged (resting fill / status tint).

2. **Spatial telegraph cue (the boss-consistent "where it lands").** Each enemy shows a small
   pooled **telegraph marker** during the wind-up, sized + placed for the chosen attack
   (a forward box for a melee swing, an aim line for a ranged shot, a dash-path bar for a
   charge, a swoop-target box for a flyer) — the same idea as `Boss._updateTelegraphFx`,
   reusing the existing per-entity primitive-rect pattern (no new art). It hides on
   active/recovery/idle/hurt/dead and is a SEPARATE object from the body so it never fights
   the body flash.

3. **1–2 more attacks per archetype (variety per archetype).** Every archetype carries an
   `attacks: EnemyAttackSpec[]` table with ≥2 entries; the FSM picks one per attack via a
   small **runtime** chooser (weighted, with a "don't repeat the last one twice in a row"
   nudge — KISS) when it commits from `chase`. The chosen attack drives the telegraph
   duration, the strike dispatch, and the active/recovery timings. Examples:
   GRUNT = quick jab **or** heavy overhead; SHOOTER = single aimed bolt **or** a 2-shot
   burst; CHARGER = the dash **or** a short ground-pound (stationary AoE swing); FLYER = the
   swoop **or** a hover-and-spit single bolt.

4. **Real spacing pressure for ranged enemies.** A `'ranged'` enemy actively maintains its
   `preferredRange` band: it backs off when too close (existing), **advances** when too far
   (so it doesn't passively let the player walk out of range), and **strafes** (a runtime
   left/right jink, flipping on a short timer + at the patrol clamp) while in-band instead of
   standing still — pressuring the player to close or relocate, never a stationary turret.
   All movement stays clamped to the pit-safe `[patrolMinX, patrolMaxX]` (Decision 29).

5. **Boss telegraph language stays consistent + un-regressed.** The boss keeps its growing
   `telegraphFx` overlay; the enemy's new marker uses the same blink cadence + the same
   per-kind sizing idea (shared helper math where it's cheap), so a player reads enemy and
   boss wind-ups with the same vocabulary. `Boss` behaviour is otherwise unchanged.

6. **Config stays PURE; the verifier sweep (AC59) stays GREEN and is extended.**
   `config/enemies.ts` imports nothing from Phaser. The §6a archetype sweep asserts every
   archetype's `attacks[]` is a non-empty array of well-formed entries (positive `telegraph`,
   non-negative `active`/`recovery`, a known per-kind param set, a `'ranged'` attack carries
   a projectile), and that the per-attack `swing.damage` / `projectile.damage` is numeric so
   `scaleSpec` can fold it. `npm run verify` passes.

7. **Determinism + identity preserved (the headline).** `src/world/LevelGenerator.ts`, the
   generator RNG, the spawn counts/positions, and the verify-gen regression pin are
   **byte-unchanged**; the determinism sweep stays green. A fresh encounter spawns the same
   enemies in the same places as round 1. Per-frame attack/strafe selection uses
   `Math.random()` (never the level seed), so identity is preserved even though moment-to-
   moment behaviour varies.

8. **Additive identity for existing tuning.** An archetype whose `attacks[]` has a single
   entry equal to its old single-strike behaves byte-identically to today (the chooser over a
   1-element table is the identity). The migration keeps each archetype's *first* attack equal
   to its current strike, so the Phase-4 feel of the base grunt is preserved as one option.

## 4. Problem Analysis

### 4.1 Variety per archetype — where does the "which attack" choice live?

- **Approach A — a second `behavior` value per new attack** (e.g. `'melee2'`) → rejected:
  it explodes the `behavior` switch, duplicates the chase/patrol scaffolding the FSM already
  shares, and violates Decision 68 (the whole point of ONE FSM).
- **Approach B — hardcode 2 attacks inside each `_fireStrike` branch** → rejected: the
  *which* and the *timings* (telegraph/active/recovery) become magic literals buried in
  Enemy.ts, not data; you can't sweep them in the verifier, and tuning means editing code.
- **Approach C (chosen) — a data-driven `attacks: EnemyAttackSpec[]` table on the spec, one
  shared `kind` vocabulary, a runtime chooser.** Mirrors the **boss** exactly: a boss phase is
  `attacks: BossAttackKind[]` round-robin'd, each entry `{ kind, telegraph, active, recovery,
  ...params }` (bosses.ts:74). We give the enemy the same shape (`EnemyAttackSpec`), so the
  enemy and boss attack model is one vocabulary (DRY, and AC5's consistency falls out). The
  chooser is per-frame runtime (off the pin) — the boss uses round-robin (deterministic, fine
  for a 1-of-1 fight) but enemies are many + repeated, so a weighted runtime pick reads as
  "this one feels alive" without touching the seed. **Chosen.**

### 4.2 Telegraph language — extend the body blink or add a spatial cue?

- **Approach A — only add `active`/`recovery` body flashes** → covers AC1 but not AC2/AC5:
  the player still can't read *where* a strike lands (a charger's dash path, a shooter's aim
  line), and the enemy language stays inconsistent with the boss's spatial overlay.
- **Approach B (chosen) — do both: per-phase body flash (AC1) AND a pooled per-enemy
  telegraph marker (AC2).** The body flash answers *when* (dodge now / punish now); the marker
  answers *where* (the strike's footprint), exactly as the boss's `telegraphFx` does. Each
  enemy already creates a couple of primitive rects in its ctor (`frontMarker`, `statusMarker`)
  — adding one more `telegraphMarker` rect per enemy is the established pattern (no pool churn:
  it's a long-lived per-entity object, hidden by alpha, not a per-frame allocation). **Chosen.**

### 4.3 Spacing pressure — how much AI without pathfinding?

- **Approach A — full steering/flocking/A\*** → rejected (YAGNI): the rooms are 1-D walk
  lanes for ground enemies; there is nothing to path around. Massive complexity for no
  readability gain.
- **Approach B (chosen) — extend the existing 1-rule kite into a 3-zone band + a runtime
  strafe.** Too close → retreat (existing); too far → advance; in-band → strafe (jink
  direction on a short runtime timer, flip at the patrol clamp). It's a few guarded lines in
  the existing `'ranged'` branch of `_tickChase`, all clamped to the pit-safe span. KISS,
  reads clearly, zero new subsystems. **Chosen.**

### 4.4 Determinism boundary

- The **level pin** reads only `generateLevel` output (tiles, entrance/exit, the `enemies`
  array of `{col,row,x,y,patrolMinX,patrolMaxX,spec}`, pickups). None of that is touched: we
  add **no** generator field, change **no** spawn count/position, and the new spec data is
  read only inside the Phaser-coupled `Enemy.ts` at runtime.
- The **per-frame chooser + strafe** read `Math.random()`. This is the same class as the
  existing `idleTimer` jitter and is provably outside the pin (the verifier never imports
  `Enemy.ts`). A replay therefore spawns identical enemies in identical places (identity
  holds) while their moment-to-moment attacks vary — which is the *desired* feel, not a
  regression. Documented as Decision 4 so a future reader doesn't "fix" it into a seeded draw.

## 5. Decision Log

**1. Variety lives in data (`spec.attacks[]`), chosen at runtime — mirror the boss model.**
- Options: A) more `behavior` tags · B) hardcoded multi-attack in `_fireStrike` · C) a
  `EnemyAttackSpec[]` table + a runtime chooser (the boss's `attacks[]`/`kind` model).
- Decision: **C.** One FSM (Decision 68 preserved), one attack vocabulary shared with the
  boss (DRY, AC5), tunable as pure data + sweepable by the verifier (AC6). The chooser is a
  small weighted runtime pick with a "don't pick the same kind twice running" nudge (KISS).

**2. Telegraph = per-phase body flash AND a pooled spatial marker.**
- Options: A) body flashes only · B) marker only · C) both.
- Decision: **C.** Body flash answers *when* (AC1: windup blink → active flash → recovery
  dim); the marker answers *where* (AC2), reusing the boss's per-kind sizing idea so the
  languages match (AC5). The marker is a long-lived per-entity primitive rect (the
  `frontMarker`/`statusMarker` pattern) — **not** a per-frame allocation, so the
  no-per-frame-alloc rule holds.

**3. Spacing pressure = a 3-zone band + a runtime strafe, all pit-clamped.**
- Options: A) full steering/A\* · B) 3-zone (retreat/advance/strafe) guarded branch.
- Decision: **B.** Too-close → retreat (existing), too-far → advance, in-band → strafe
  (runtime jink, flip on a short timer + at the clamp). A few lines in the existing `'ranged'`
  branch, clamped to `[patrolMinX, patrolMaxX]` (Decision 29 — a kiting shooter can never walk
  into the pit). KISS; no new subsystem.

**4. Per-frame attack + strafe selection use RUNTIME (non-seeded) randomness — by design.**
- Options: A) seed every choice off a per-enemy seeded RNG (fully replayable behaviour) ·
  B) runtime `Math.random()` for the per-frame choices.
- Decision: **B.** The level **pin** is about *what spawns where*, not *what it does each
  frame*; the verifier never imports `Enemy.ts`. Seeding per-frame choices would (i) require
  threading a seed into every enemy at spawn (new generator/scene plumbing, more pin surface)
  and (ii) make every replay's combat identical — *less* alive. The existing `idleTimer`
  jitter already establishes this boundary. Identity (same enemies, same places) is unchanged.
  Consequence: a replay is **not** frame-identical in combat — accepted, and the *desired*
  outcome (encounters feel alive). Documented so it's not "fixed" into a seeded draw later.

**5. Migration keeps each archetype's first attack equal to its current strike (additive).**
- Decision: each archetype's `attacks[0]` is its **existing** single strike (same telegraph /
  active / recovery / swing / projectile numbers), so a single-entry table is the identity
  (AC8) and the Phase-4 grunt feel survives as one option. The new attacks are *added*
  entries, never re-tunes of the base one.

**6. Reuse the existing hitbox pool + enemy ProjectilePool — no new pooled entity.**
- Decision: a new melee attack acquires from the SAME `hitboxPool` (the existing
  `_fireStrike` melee path, just with the chosen attack's `swing`); a new ranged attack fires
  from the SAME enemy `ProjectilePool`; a charger ground-pound is a stationary `swing`
  (melee dispatch); a flyer's spit is the ranged dispatch with the flyer's body. No new pool,
  no new overlap wiring (YAGNI). The strike dispatch keys on the **attack's `kind`**, not the
  enemy's `behavior`, which is what unlocks "a charger can also do a melee swing".

**7. Boss is the reference, not the subject — only a tiny shared-helper extraction.**
- Decision: do **not** restructure `Boss`. If a small per-kind sizing helper is cheap to
  share (e.g. a pure `telegraphBox(kind, ...)` returning `{w,h,dx,dy}`), factor it so enemy +
  boss read the same shape; otherwise the enemy marker simply *mirrors* the boss's idea
  inline. Either way `Boss` behaviour is byte-unchanged (AC5). Bias to the inline mirror if
  the shared helper would entangle the two files (KISS over premature DRY).

**8. No enemy status application; no new sounds beyond existing hooks.**
- Decision: enemies still don't apply bleed/poison/stun to the player (that's the
  weapon/affix layer) — out of scope (YAGNI). Telegraph/strike audio reuses the existing
  `sfx` enemy hooks (if any); we add at most one `sfx.enemyTelegraph()`-style cue only if a
  hook already exists, otherwise none (no new audio primitive this slice).

## 6. Design

All gameplay changes are in **`src/entities/Enemy.ts`** (the FSM) and
**`src/config/enemies.ts`** (the pure attack tables). The verifier extension is in
**`scripts/verify-gen.mjs`** (§6a). `Boss.ts` gets at most a tiny shared-helper consumption.
`LevelGenerator.ts`, the generator RNG, and the pin are **untouched**.

### 6.1 `config/enemies.ts` — the per-archetype attack table (PURE)

Add a new shared shape and an `attacks` field on `EnemySpec`. Mirror the boss's
`BossAttackSpec` shape so the vocabulary is one source (Decision 1/7).

```ts
// The enemy attack vocabulary — one shared kind set with the boss's (DRY). Each entry is a
// fully-telegraphed strike: a wind-up, an active window, a recovery, plus per-kind params.
export type EnemyAttackKind = 'swing' | 'shoot' | 'dash' | 'swoop'

export interface EnemyAttackSpec {
  kind: EnemyAttackKind
  weight: number          // runtime weighted pick (Decision 1) — relative likelihood.
  telegraph: number       // s — the wind-up (the dodge window, AC56-style). > 0.
  active: number          // s — the strike's live window. ≥ 0.
  recovery: number        // s — the punish window after the strike. ≥ 0.
  // 'swing' (melee): the pooled hitbox geometry (the existing EnemySwingSpec shape).
  swing?: EnemySwingSpec
  // 'shoot' (ranged): the fired bolt + an optional fan (reuses the existing fields).
  projectile?: EnemyProjectileSpec
  projectileCount?: number
  projectileSpread?: number
  // 'dash' (charge): the committed lunge velocity.
  chargeSpeed?: number
  // 'swoop' (fly): the 2-D lunge speed.
  swoopSpeed?: number
}
```

Add `attacks: EnemyAttackSpec[]` to `EnemySpec`. **Migration (Decision 5):** for each
archetype, `attacks[0]` reproduces the current single strike using the spec's existing
top-level fields (so the numbers are unchanged), then add 1 more entry:

- **GRUNT** (`'melee'`): `attacks[0]` = the current swing (`{kind:'swing', telegraph:0.42,
  active:0.12, recovery:0.45, swing: GRUNT.swing}`); `attacks[1]` = a **heavy overhead** —
  longer telegraph (~0.6 s), more damage/knockback, longer recovery (the big read).
- **SHOOTER** (`'ranged'`): `attacks[0]` = the current single bolt; `attacks[1]` = a
  **2-shot burst** (`projectileCount:2`, a small `projectileSpread`) with a slightly longer
  telegraph (forces a wider dodge / a relocate).
- **CHARGER** (`'charge'`): `attacks[0]` = the current dash (`kind:'dash'`, the existing
  telegraph/active/recovery + `chargeSpeed`); `attacks[1]` = a **ground-pound** — a stationary
  `kind:'swing'` with a wide `halfHeight` (an in-place AoE you dodge by *spacing*, not by
  side-stepping a lunge) — so a charger now mixes commit-lunge with hold-ground.
- **FLYER** (`'fly'`): `attacks[0]` = the current swoop (`kind:'swoop'` + `swoopSpeed`);
  `attacks[1]` = a **hover-spit** (`kind:'shoot'`, a single slow bolt fired from altitude) so
  it threatens without committing the body — real spacing variety for the air unit.
- **SPITTER** (`'ranged'`): `attacks[0]` = the current 3-fan; `attacks[1]` = a **single
  aimed sniper bolt** (faster, narrower telegraph) so it isn't always the same cone.

The existing top-level `telegraph/attackActive/attackRecovery/swing/projectile/...` fields
stay on the spec (they remain the source for `attacks[0]`'s numbers and for back-compat reads);
the canonical per-attack data is now `attacks[]`. KISS: we do **not** delete the old top-level
fields this slice (they're harmless + keep the diff additive + keep the pin's `spec:'brute'`
tag path untouched).

> Note on `behavior` vs `kind`: `behavior` still tags the archetype's **movement/engage**
> style (melee plants, ranged kites, charge/fly use body-contact); the new `attacks[].kind`
> tags the **strike dispatch**. They usually align but need not — e.g. a `'charge'` enemy can
> have a `'swing'` attack (the ground-pound). The strike dispatch in `_fireStrike` keys on the
> **attack kind** (Decision 6), which is the unlock for cross-`behavior` variety.

### 6.2 `Enemy.ts` — choose the attack when committing (runtime, off the pin)

New ctor state (alongside the existing timers, Enemy.ts:186–200):

```ts
this.currentAttack = null   // the chosen EnemyAttackSpec for the live telegraph→strike→recovery.
this.lastAttackKind = ''    // the previous kind (for the "don't repeat twice running" nudge).
this.strafeDir = 1          // 'ranged' — the live strafe direction.
this.strafeTimer = 0        // 'ranged' — counts down to the next strafe flip (runtime).
```

A small private chooser (runtime randomness — Decision 4):

```ts
// Pick the next attack from spec.attacks by WEIGHT, with a small nudge AGAINST repeating the
// last kind back-to-back (variety, AC3). RUNTIME random (Math.random) — NOT the level seed
// (the per-frame choice is outside the level pin; Decision 4). A 1-entry table is the identity
// (AC8). KISS: a weighted pick over a tiny array — no per-frame allocation beyond the loop.
_chooseAttack(): EnemyAttackSpec {
  const list = this.spec.attacks
  if (list.length === 1) return list[0]
  let total = 0
  for (const a of list) total += a.weight * (a.kind === this.lastAttackKind ? 0.5 : 1)
  let r = Math.random() * total
  for (const a of list) {
    r -= a.weight * (a.kind === this.lastAttackKind ? 0.5 : 1)
    if (r <= 0) return a
  }
  return list[list.length - 1]
}
```

In `_tickChase`, when the enemy commits (the `inRange && attackCooldownTimer<=0` block,
Enemy.ts:383), replace the single `telegraphTimer = spec.telegraph * …` with:

```ts
this.currentAttack = this._chooseAttack()
this.lastAttackKind = this.currentAttack.kind
this.state = STATE.ATTACK
this.telegraphTimer = this.currentAttack.telegraph * (this.elite ? this.elite.telegraphMult ?? 1 : 1)
this.strikeTimer = 0
```

The elite `telegraphMult` still multiplies the chosen attack's telegraph (Decision 77 path
preserved — elites get tighter wind-ups on any attack).

### 6.3 `Enemy.ts` — `_tickAttack` + `_fireStrike` read the chosen attack

`_tickAttack` (Enemy.ts:406) reads the chosen attack's timings instead of the spec's
top-level ones:

- Wind-up: unchanged shape; on `telegraphTimer<=0` set
  `this.strikeTimer = atk.active + atk.recovery`, `this.dashActive = atk.kind === 'dash' ||
  atk.kind === 'swoop'`.
- Active/recovery split uses `atk.recovery` as the boundary (`inActive = strikeTimer >
  atk.recovery`), exactly as today but per-attack.
- On `strikeTimer<=0`: `attackCooldownTimer = spec.attackCooldown` (cooldown stays a spec-level
  cadence — KISS), `currentAttack = null`, → `CHASE`.

`_fireStrike` (Enemy.ts:510) dispatches on **`this.currentAttack.kind`** (not `this.behavior`):

- `'swing'` → `hitboxPool.acquire(attacker, atk.swing, this.id)` (the melee path; a charger's
  ground-pound rides this).
- `'shoot'` → the existing single/fan projectile path, but reading `atk.projectile /
  atk.projectileCount / atk.projectileSpread` (so a shooter's burst + a flyer's spit + a
  spitter's fan are all one branch).
- `'dash'` → latch `dashDir` toward the player, read `atk.chargeSpeed` in `_tickAttack`.
- `'swoop'` → latch the 2-D `swoopVX/VY` toward the player, read `atk.swoopSpeed`.

The dash/swoop `_tickAttack` velocity reads switch from `spec.chargeSpeed/swoopSpeed` to
`this.currentAttack.chargeSpeed/swoopSpeed` (with the existing `|| default` guards).

### 6.4 `Enemy.ts` — spacing pressure for `'ranged'` (AC4)

In the `'ranged'` arm of `_tickChase` (Enemy.ts:361–376), replace the single retreat rule with
the 3-zone band + a runtime strafe:

```ts
// SPACING PRESSURE (AC4): maintain the preferredRange band. Too close → retreat; too far →
// advance; in-band → STRAFE (a runtime jink that flips on a short timer + at the patrol clamp)
// so the shooter is never a stationary turret. All clamped to the pit-safe span (Decision 29).
const gap = Math.abs(px - cx)
const band = this.spec.preferredRange || 0
let dir
if (gap < band * 0.85) dir = -Math.sign(px - cx) || -this.facing      // too close → back away.
else if (gap > band * 1.15) dir = Math.sign(px - cx) || this.facing   // too far → close in.
else {
  this.strafeTimer -= dt
  if (this.strafeTimer <= 0) { this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeTimer = 0.5 + Math.random() * 0.6 }
  dir = this.strafeDir                                                 // in-band → strafe (jink).
}
// (then the existing accel-toward-target-vx + the clamp-edge stop, unchanged)
```

`strafeTimer`/`strafeDir` are the new runtime state (Decision 4). The clamp-edge guard
(Enemy.ts:374) already flips the effective motion at `patrolMinX/Max`, so a strafing shooter
reverses at the pit edge instead of grinding into it. `facing` continues to point at the player
each frame (so it keeps aiming while it strafes).

### 6.5 `Enemy.ts` — the telegraph language (AC1, AC2)

**Per-phase body flash (AC1)** in `_updateVisual` (Enemy.ts:660–674): extend the existing
attack-colour cascade so the body reads all three phases. New spec colours `colorActive` /
`colorRecovery` (added to `EnemySpec`, with sensible per-archetype defaults; the verifier does
**not** require them — they're cosmetic, read only by Enemy.ts):

```ts
let color = this.spec.color
if (this.state === STATE.ATTACK && this.telegraphTimer > 0) {
  const blink = Math.floor(this.telegraphTimer * 16) % 2 === 0          // wind-up (existing).
  color = blink ? this.spec.colorTelegraph : this.spec.color
} else if (this.state === STATE.ATTACK && this.strikeTimer > (this.currentAttack?.recovery ?? 0)) {
  color = this.spec.colorActive ?? this.spec.colorTelegraph             // NEW — active flash.
} else if (this.state === STATE.ATTACK) {
  color = this.spec.colorRecovery ?? this.spec.color                    // NEW — recovery dim.
} else if (this.hurtIframeTimer > 0) {
  color = this.spec.colorHurt
} else if (this.statuses.length > 0) {
  // (status tint — unchanged)
}
```

Precedence note: the attack phases sit ABOVE the status tint (the urgent timing cue wins),
matching today's ordering where telegraph beats status.

**Spatial telegraph marker (AC2)** — add one long-lived primitive rect in the ctor (next to
`statusMarker`, Enemy.ts:164):

```ts
this.telegraphMarker = scene.add.rectangle(x, y, 10, 10, this.spec.colorTelegraph).setAlpha(0).setDepth(6)
```

Drive it in `_updateVisual` only during the wind-up (`state === ATTACK && telegraphTimer > 0`),
sized/placed for `currentAttack.kind` — the boss's idea (Boss.ts:487), mirrored:

- `'swing'` → a forward box: `w = atk.swing.reach`, `h = atk.swing.halfHeight*2`, placed
  `facing * (bodyW*0.5 + reach*0.5)` in front (the strike footprint).
- `'shoot'` → a thin long aim line along `facing` (the bolt's path).
- `'dash'` → a long horizontal bar along `dashDir` (the lunge path — same as the boss dash
  cue).
- `'swoop'` → a box at the latched swoop target (the impact point).

Blink the alpha at the same cadence as the body flash + the boss overlay (`Math.floor(
telegraphTimer * 16) % 2`) so the vocabulary matches (AC5). Hide (`alpha 0`) on
active/recovery/idle/patrol/chase/hurt/dead. Destroy it in `_despawn` (Enemy.ts:614) alongside
the other markers.

If a tiny pure sizing helper is worth sharing with the boss, factor `telegraphBox(kind, spec,
atk, facing) → {w,h,x,y}` into a small module both read (Decision 7); otherwise mirror inline.
Bias to inline to avoid entangling the two entity files (KISS).

### 6.6 `scripts/verify-gen.mjs` — extend the §6a archetype sweep (AC6)

Inside the existing `for (const spec of ENEMY_ARCHETYPES)` loop (verify-gen.mjs:762), add:

```js
// attacks[] well-formed (this slice): a non-empty array; each entry a known kind with a
// positive telegraph, non-negative active/recovery, and the per-kind params present + numeric
// so scaleSpec can fold them. A 'shoot' attack must carry a projectile (parity with §6a's
// existing ranged check). The first attack reproduces the legacy single strike (additive).
const ATTACK_KINDS = ['swing', 'shoot', 'dash', 'swoop']
if (!Array.isArray(spec.attacks) || spec.attacks.length === 0) fail(`archetype ${spec.id}: empty attacks[]`)
for (const a of spec.attacks) {
  if (!ATTACK_KINDS.includes(a.kind)) fail(`archetype ${spec.id}: unknown attack kind ${a.kind}`)
  if (!(a.telegraph > 0)) fail(`archetype ${spec.id}: attack ${a.kind} telegraph must be > 0 (the dodge window)`)
  if (!(a.active >= 0) || !(a.recovery >= 0)) fail(`archetype ${spec.id}: attack ${a.kind} active/recovery must be ≥ 0`)
  if (!(a.weight > 0)) fail(`archetype ${spec.id}: attack ${a.kind} weight must be > 0 (the chooser)`)
  if (a.kind === 'swing' && (!a.swing || typeof a.swing.damage !== 'number')) fail(`archetype ${spec.id}: 'swing' attack missing swing.damage`)
  if (a.kind === 'shoot' && (!a.projectile || typeof a.projectile.damage !== 'number')) fail(`archetype ${spec.id}: 'shoot' attack missing projectile.damage`)
}
```

This keeps the verifier an **independent proof** of the data contract (the same role it plays
for the boss attack tables). No other verifier section changes — in particular §3 (the
generation determinism sweep + the regression pin) is **untouched** and must stay green
(AC7), which it does because nothing this slice touches is read by the generator or the pin.

### 6.7 `difficulty.ts` — `scaleSpec` and the per-attack damage (depth scaling)

`scaleSpec` (difficulty.ts:66) currently folds `swing.damage`. With per-attack data, the
per-attack `swing.damage` / `projectile.damage` should also scale with depth so a deeper
grunt's *overhead* hits harder too (consistency with the boss's `scaleBossSpec`, which already
folds every attack's damage). Extend `scaleSpec` to map over `attacks[]` and fold each entry's
`swing.damage` / `projectile.damage` (a fresh deep-clone, never mutating the base — the same
aliasing discipline already there). The verifier's existing "scaled maxHp rises" check is
unaffected; we may add a small assertion that a scaled attack's damage ≥ base (a guardrail,
mirroring the boss fold). This is the **only** `difficulty.ts` change and it stays PURE.

### 6.8 Data flow (unchanged seams)

- Spawn: `GameScene._spawnEnemy` (GameScene.ts:1425) is **unchanged** — it already passes the
  pure spec + the enemy `ProjectilePool`; the new `attacks[]` data rides on the spec it already
  hands in. No new constructor args.
- Tick: `for (const enemy of this.enemies) enemy.update(gdt, { player, effects })`
  (GameScene.ts:2356) — **unchanged**. The chooser/strafe run inside `update` on the gameplay
  dt (frozen during hit-stop, like every other enemy timer — Decision 26).
- Hits in/out: `onHit` / `applyStatus` / the death + drop hooks are **unchanged** (the
  interrupt path `_releaseStrike` + clearing `telegraphTimer/strikeTimer` already cancels the
  in-progress attack regardless of which kind it was).

### 6.9 Identity safety

An archetype with a single-entry `attacks[]` equal to its old strike is byte-identical
(Decision 5/AC8): `_chooseAttack` returns that one entry, the timings equal the old
spec-level numbers, `_fireStrike` dispatches the same kind. A non-attacking enemy never reads
`currentAttack` (null) and the new visual branches are gated on `state === ATTACK`, so the
resting/patrol/chase/hurt visuals are unchanged. The strafe state only runs in the `'ranged'`
branch; melee/charge/fly chase is unchanged except for reading the chosen attack at commit.

## 7. Files Changed

- **`src/config/enemies.ts`** (PURE) — add `EnemyAttackKind` + `EnemyAttackSpec`; add
  `attacks: EnemyAttackSpec[]` (and the cosmetic `colorActive?` / `colorRecovery?`) to
  `EnemySpec`; populate each of the five archetypes with `attacks[0]` = its current strike +
  1 added attack (GRUNT overhead, SHOOTER burst, CHARGER ground-pound, FLYER hover-spit,
  SPITTER aimed bolt). No Phaser import (purity preserved).
- **`src/entities/Enemy.ts`** — ctor state (`currentAttack`, `lastAttackKind`, `strafeDir`,
  `strafeTimer`, `telegraphMarker`); `_chooseAttack` (runtime weighted pick); read the chosen
  attack in the chase-commit, `_tickAttack`, and `_fireStrike` (dispatch on attack `kind`);
  the 3-zone band + strafe in the `'ranged'` chase branch; the per-phase body flash + the
  spatial telegraph marker in `_updateVisual`; destroy the marker in `_despawn`.
- **`src/config/difficulty.ts`** (PURE) — extend `scaleSpec` to fold each `attacks[]` entry's
  `swing.damage` / `projectile.damage` (fresh clone, no mutation).
- **`scripts/verify-gen.mjs`** — extend the §6a archetype sweep to assert `attacks[]` is
  well-formed (kinds, telegraph > 0, active/recovery ≥ 0, weight > 0, per-kind params present);
  optionally assert a scaled attack's damage ≥ base.
- **`src/entities/Boss.ts`** — *at most* consume a shared `telegraphBox` helper if one is
  factored (Decision 7); behaviour byte-unchanged. Likely **no change** (inline mirror).
- **Explicitly UNCHANGED (acceptance criteria, not omissions):**
  `src/world/LevelGenerator.ts` (+ its RNG), the verify-gen **regression pin** and the §3
  determinism sweep, `GameScene._spawnEnemy` / the enemy update loop, spawn counts/positions.

## 8. Verification

1. `npm run typecheck` — passes (new types on the pure spec + the Enemy fields).
2. `npm run verify` — **green**, including: the extended §6a archetype sweep asserting every
   archetype's `attacks[]` is well-formed; AND — the headline — the §3 generation
   determinism sweep + the regression pin still pass **with no edits to
   `LevelGenerator.ts` or the pin** (proves spawns + identity are untouched, AC7).
3. Manual (`npm run dev`):
   - **AC1** — engage a grunt: the body blinks `colorTelegraph` (dodge), flashes `colorActive`
     on the strike, dims to `colorRecovery` on the punish window — three readable phases.
   - **AC2/AC5** — confirm the spatial marker shows the strike footprint per kind (a swing
     box in front, a charger's dash bar, a shooter's aim line) with the same blink as the boss
     overlay; fight the boss back-to-back and confirm the telegraph vocabulary matches.
   - **AC3** — fight one archetype for a while: it visibly mixes its two attacks (grunt jab vs
     overhead, shooter bolt vs burst, charger dash vs ground-pound, flyer swoop vs spit) and
     doesn't spam the same kind twice in a row.
   - **AC4** — approach a shooter: it backs off when you close, advances when you retreat, and
     strafes when you hold the band — never a stationary turret; it never walks into the pit.
   - **AC7/AC8** — reload the same seed (restart the run): the same enemies spawn in the same
     places (identity), even though their moment-to-moment attacks/strafing differ
     (runtime-random by design). Set an archetype's `attacks[]` to a single entry and confirm
     byte-identical legacy behaviour.
