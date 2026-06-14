# F4 Enemy Roster Expansion — Bomber, Kamikaze, Shielder (reusing the ONE FSM)

## 1. Background

The bestiary is five archetypes (`config/enemies.ts`): GRUNT (melee), SHOOTER + SPITTER (ranged),
CHARGER (charge), FLYER (fly). All ride **one** Enemy FSM (`entities/Enemy.ts`) — variety is a
`spec.behavior` tag + a handful of guarded branches in the existing chase/attack ticks, NOT subclasses
(Decision 68). An archetype carries an `attacks: EnemyAttackSpec[]` table; the FSM weighted-picks one per
attack (`_chooseAttack`) and `_fireStrike` dispatches on the chosen attack's `kind`
(`'swing'|'shoot'|'dash'|'swoop'`), NOT on `behavior` (Decision 6 — the unlock that lets a `charge`
archetype carry a `swing` ground-pound).

This slice adds **three** new archetypes that need **no new behavior and no new FSM branches** — they reuse
existing seams via new undefined-safe spec fields:

- **BOMBER** (`behavior: 'ranged'`) — lobs ONE slow heavy ARCING bolt that, on impact (land / lifetime /
  hit / out-of-world), pops a small radial AoE. The arc is the existing 2-D projectile (`aim:{angle}`); the
  impact-AoE is a new `projectile.impactAoe` sub-field the enemy projectile pool reads on release.
- **KAMIKAZE** (`behavior: 'charge'`) — low HP, dashes at you, and on death fires a radial burst. It reuses
  the EXISTING `_fireDeathBurst` path (the elite explosive signature) promoted to a **base-spec hook**: a new
  undefined-safe `spec.deathBurst` field read alongside `this.elite.deathBurst`.
- **SHIELDER** (`behavior: 'melee'`) — a frontal damage-reduction tank: a player melee/projectile hit from
  the FRONT is reduced; a backstab/flank lands full. ONE guarded directional check at the player's melee
  resolveHit site, reusing the EXISTING backstab facing math (`result.isBackstab` already tells us the hit
  came from behind/flank).

We already have **every seam** this needs — EXTEND, never duplicate:

- **Pure archetype config.** `config/enemies.ts` is node-importable plain data (no Phaser). New rows add to
  `ENEMY_SPECS` + `ENEMY_ARCHETYPES`. New behaviour-specific fields are read undefined-safe by `Enemy.ts`.
- **The 2-D arc + impact.** `ProjectilePool.acquire(attacker, spec, ownerId, status, aim, pierce)` already
  fires an arcing shot via `aim:{angle}` (the elite-burst / spitter-fan path). `ProjectilePool.tick(gdt)`
  releases a shot on lifetime / out-of-world / (via GameScene) first hit. The Bomber's impact-AoE hooks the
  release path (see Decision 4).
- **The death burst.** `Enemy._fireDeathBurst(cx, cy)` already fires a true-radial ring from the enemy pool
  at the captured death center, called from `_die()` BEFORE the body is disabled. It reads
  `this.elite.deathBurst` today; we widen it to also read `this.spec.deathBurst` (Kamikaze base spec).
- **The radial-damage helper.** `GameScene._radialDamage(x, y, radius, damage, knockback, status)` is the
  ONE primitive for "instant AoE to everything in radius" (the blast skill, the charged-hammer shockwave). It
  reuses `resolveHit` with `allowBackstab:false`. BUT it currently hits the **player's** targets (enemies +
  boss), not the player. The Bomber AoE must hit the PLAYER — so the impact AoE is a SEPARATE tiny scene
  helper (Decision 4), NOT `_radialDamage`.
- **The backstab facing math.** `combat/damage.ts:resolveHit` computes `isBackstab` (attacker on the side the
  victim isn't facing, beyond a 4px dead-zone). The Shielder reduction reads this EXISTING flag — no new
  geometry (Decision 3).
- **The pure verifier.** `scripts/verify-gen.mjs` §6a sweeps every archetype's well-formedness
  (shared numeric fields + known behavior + non-empty `attacks[]` with known kinds + per-kind params + a
  rising `scaleSpec` fold) and §6b asserts every biome `enemyPool` references only known ids. §4c walks every
  graph path asserting whole-run `effectiveDifficulty` is non-decreasing. The new specs ride the EXISTING
  sweeps; we add small targeted assertions for the two new spec fields (Decision 7).

What is **missing**: the three archetypes do not exist, their fields are not read in `Enemy.ts`, the Shielder
reduction is not applied at the hit site, the Bomber impact-AoE has no land hook, and the new ids are not in
any biome pool. We add exactly that. **A default run with no new archetypes in its rolled pools is unaffected**
— the new fields default to the neutral identity and the existing five archetypes are byte-unchanged.

## 2. Requirements Summary

- Add **BOMBER**, **KAMIKAZE**, **SHIELDER** to `config/enemies.ts` (`ENEMY_SPECS` + `ENEMY_ARCHETYPES`),
  each reusing an EXISTING `behavior` (`ranged` / `charge` / `melee`) and the `attacks[]` table.
- New undefined-safe spec fields, read ONLY by the matching code path in `Enemy.ts`/`GameScene.ts`:
  - `EnemyProjectileSpec.impactAoe?: { radius, damage, knockback } | null` (Bomber — the impact splash).
  - `EnemySpec.deathBurst?: { count, projectile } | null` (Kamikaze — base-spec radial burst, same shape as
    `EliteAffixSpec.deathBurst`).
  - `EnemySpec.frontalDR?: number` (Shielder — 0..1 fraction of incoming damage REMOVED on a front hit; 0 =
    identity).
- Wire the three hooks in the engine, each undefined-safe (Decision 1/4):
  - Bomber: the enemy projectile pool spawns the impact AoE when a shot carrying `impactAoe` releases.
  - Kamikaze: `_fireDeathBurst` reads `this.spec.deathBurst ?? this.elite?.deathBurst` (base OR elite).
  - Shielder: at the player melee + player-projectile hit sites, if `enemy.spec.frontalDR > 0` AND the hit is
    NOT a backstab/flank, scale `result.damage` down by `(1 - frontalDR)` before `enemy.onHit(result)`.
- Add the new ids to MID/LATE biome `enemyPool` weights ONLY. Keep difficulty monotone — do NOT touch
  PRISON's pool or make any early biome harder.
- **ADDITIVE IDENTITY**: with the new ids absent from a rolled pool, every existing archetype + a default run
  is byte-identical. Every new field defaults to neutral (`null` / `0` / `undefined`).
- **MONOTONICITY**: `difficultyTier` + per-biome bands + whole-run `effectiveDifficulty` unchanged (no new
  scaling on the early path). Verifier §4c/§4b still green.
- **VERIFIER + BUILD GREEN**: §6a/§6b cover the new specs; add targeted asserts for `impactAoe` /
  `deathBurst` / `frontalDR` well-formedness.

## 3. Decisions

### Decision 1 — Three new archetypes, ZERO new behaviors, ZERO new FSM branches (Decision-68 fidelity)

Each new archetype reuses an existing `behavior` value, so the FSM's chase/attack ticks are UNTOUCHED:

| Archetype | id | behavior | maxHp | What's new vs. its sibling |
|-----------|------|----------|-------|----------------------------|
| BOMBER | `bomber` | `ranged` | ~46 | A single SLOW lobbed `shoot` with `projectile.impactAoe` (splash on land). |
| KAMIKAZE | `kamikaze` | `charge` | ~22 | Low HP, fast dash, `spec.deathBurst` (radial burst on death). |
| SHIELDER | `shielder` | `melee` | ~85 | `spec.frontalDR ~0.6` (front hits reduced; backstab/flank full). |

`KNOWN_BEHAVIORS` in the verifier (`['melee','ranged','charge','fly']`) is UNCHANGED — no new behavior tag.
`ATTACK_KINDS` (`['swing','shoot','dash','swoop']`) is UNCHANGED — the Bomber's lob is a `shoot`, the
Kamikaze's charge is a `dash`, the Shielder's strike is a `swing`. **No new vocabulary** — the whole point.

### Decision 2 — BOMBER: a slow arcing `shoot` + an impact-AoE projectile field

The Bomber is `behavior:'ranged'` so it reuses the SHOOTER kiting/fire-on-the-beat path verbatim. Its
distinctiveness is ONE `shoot` attack whose `projectile`:
- is SLOW (`speed ~220`) and HEAVY (a long telegraph ~`0.7s` — very readable),
- is fired with an upward ARC. The existing fan/aim path (`_fireStrike` with `count > 1`) uses `aim:{angle}`,
  but for a single arcing lob we want a deliberate upward toss aimed at the player. **KISS choice**: the
  Bomber uses a single-bolt `shoot` with `projectileCount:1` aimed straight at the player; the "arc" reads
  through the SLOW speed + a tall telegraph marker. We do NOT add projectile gravity to the pool (YAGNI — the
  pool hand-integrates a constant 2-D velocity; adding per-shot gravity is a pool rewrite). The "slow heavy
  lob" feel comes from low speed + the impact splash, not parabolic physics.
- carries `impactAoe: { radius, damage, knockback }`. When the shot releases (lifetime / out-of-world / on a
  player hit), GameScene spawns a radial splash centred where it died.

New field on `EnemyProjectileSpec`:
```ts
impactAoe?: { radius: number; damage: number; knockback: number } | null
```
Absent / null ⇒ no splash (every existing bolt — SHOOTER, SPITTER, FLYER_SPIT, elite burst — is unchanged,
the identity). `scaleSpec` deep-clones each attack's `projectile` already (difficulty.ts:98); we extend that
clone to carry `impactAoe` through unchanged (its `damage` MAY be folded by `enemyDamageMult` — see Decision 6).

### Decision 3 — SHIELDER: reduce a FRONT hit at the player hit site, reusing `result.isBackstab`

`resolveHit` already returns `isBackstab` (true when the attacker is on the side the victim isn't facing,
beyond the dead-zone). A Shielder's frontal damage reduction is the EXACT complement: a hit that is NOT a
backstab came from the front/side-facing → reduce it; a backstab/flank lands full (the genre's "get behind
the shield"). The check is ONE guard at the player melee hit site (`_onPlayerHitEnemy`, GameScene.ts:2149)
and the player projectile hit site (`_onProjectileHitEnemy`, GameScene.ts:2359), AFTER `resolveHit`, BEFORE
`enemy.onHit(result)`:

```ts
// SHIELDER frontal damage reduction (F4 enemy-roster). A front hit on a shielder is reduced; a
// backstab/flank (result.isBackstab) lands full — get behind the shield. 0 / undefined ⇒ identity.
const dr = enemy.spec.frontalDR ?? 0
if (dr > 0 && !result.isBackstab && result.damage > 0) {
  result = { ...result, damage: Math.max(1, Math.round(result.damage * (1 - dr))) }
}
```

`Math.max(1, ...)` keeps a front hit from rounding to 0 (a shield blunts, never fully negates — so the player
is never soft-locked vs. a Shielder with no flanking room). New field:
```ts
frontalDR?: number // SHIELDER (0..1) — fraction of incoming damage removed on a NON-backstab hit. 0 = identity.
```
Default 0 / undefined ⇒ no reduction (every existing archetype unchanged). The reduction is applied at the
SCENE hit site (not in `damage.ts`, which stays PURE and never imports config — Decision 60). The enemy
projectile → player and contact-damage paths are NOT touched (the Shielder reduces PLAYER damage only — it
does not change what it deals).

**DRY note**: the same 3-line guard appears at both player hit sites. KISS — inline it at both (two tiny
guards) rather than a helper, matching how `_bumpMomentum` / `_mutationDamageMult` are threaded at both
sites. (A one-line `enemy.applyFrontalDR(result)` helper on Enemy is an acceptable alternative if the
implementer prefers a single source — implementer's call, but keep it ≤ the inline cost.)

### Decision 4 — BOMBER impact-AoE: a NEW tiny scene helper on the enemy projectile release path

`_radialDamage` hits the PLAYER's targets (enemies + boss) — wrong direction for a Bomber splash, which must
hit the PLAYER. So we add a small mirror helper that resolves an instant radial against the player only:

```ts
// _enemyRadialDamage(x, y, aoe): the enemy/boss analogue of _radialDamage — an instant splash hitting the
// PLAYER if within radius. Reuses resolveHit (allowBackstab:false, damageMult:1 — enemies never scale with
// the player's mults) + _hurtPlayer (so the cursed-room damage-taken mult + parry apply) + effects/sfx.
_enemyRadialDamage(x, y, aoe) {
  if (!aoe || !this.player.isHittable()) return
  const p = this.player.body.center
  if (Math.hypot(p.x - x, p.y - y) > aoe.radius) return
  const swing = { damage: aoe.damage, knockback: aoe.knockback }
  const result = resolveHit({ cx: x, facing: p.x >= x ? 1 : -1 }, this.player.attackerShape, swing,
    { allowBackstab: false })
  this._hurtPlayer(result)
  this.effects.hit(p.x, p.y, { damage: result.damage })
}
```

This mirrors `_onEnemyProjectileHitPlayer` (GameScene.ts:2395) exactly — SAME `resolveHit` opts, SAME
`_hurtPlayer` (the cursed-room / parry path), SAME `effects.hit`. It is `damageMult:1` (the review-pinned rule
— enemies never get the player's mults).

**The release hook (review BLOCKER — the gated seam).** The impact AoE must fire when a Bomber shot ends —
including landing/expiry and a direct player hit, but NEVER on a level-rebuild teardown. `ProjectilePool.tick`
releases on lifetime/out-of-world inside the pool (no scene visibility). Cleanest seam without touching the
pool's API shape: the pool's `_disable(rect)` is the single release chokepoint. We add an OPTIONAL release
callback the pool fires once per shot on disable, carrying the shot's last position + `pj.spec`:
```ts
// In GameScene, after creating enemyProjectilePool:
this.enemyProjectilePool.onRelease = (x, y, spec) => {
  const aoe = (spec as any)?.impactAoe
  if (aoe) this._enemyRadialDamage(x, y, aoe)
}
```
**CRITICAL gate (review BLOCKER):** `_disable` is ALSO called by `releaseAll()` during a level rebuild
(GameScene._buildLevel → `enemyProjectilePool.releaseAll()`). Firing `onRelease` unconditionally there would,
with an in-flight Bomber shot, run `_enemyRadialDamage → _hurtPlayer/effects` against the player **mid-
teardown** — applying damage at a level boundary (a teardown is NOT a 'land'), breaking the additive-identity
claim. So `_disable(rect, fireRelease = true)` takes an OPTIONAL flag: the NATURAL release paths (tick's
lifetime/out-of-world, and the direct-hit `release()` path) use the default `true`; **`releaseAll()` passes
`false`** so the splash is suppressed on teardown. `_disable` calls `this.onRelease?.(body.center.x,
body.center.y, pj.spec)` (only when `fireRelease`) BEFORE it nulls `pj.spec` and parks the body. `onRelease`
is undefined by default ⇒ ZERO behaviour change for the player pool and every non-Bomber enemy shot (the
additive identity). The Bomber shot's `releaseTimer` (lifetime) is the "it landed" timer — a slow shot at low
speed expires roughly where it falls, popping the splash (KISS: lifetime IS the land timer; we do NOT add
ground-collision to the overlap-only projectile body — YAGNI). On a DIRECT player hit,
`_onEnemyProjectileHitPlayer` already calls `enemyProjectilePool.release(projRect)` → `_disable(rect, true)` →
the splash ALSO fires at the impact point (one site, both NATURAL paths covered — DRY). Only the level-
teardown `releaseAll()` path is gated OFF.

Guard against double-damage: a direct hit applies the bolt damage in `_onEnemyProjectileHitPlayer` THEN the
splash via release. That is intended (a direct hit = bolt + splash, the Bomber's payoff). Both are modest
numbers (bolt ~6, splash ~10) — tuned so the combined hit is fair (a slow, very-telegraphed shot).

### Decision 5 — KAMIKAZE: promote `_fireDeathBurst` to read a BASE-spec death burst

`_fireDeathBurst(cx, cy)` (Enemy.ts:917) currently gates on `this.elite && this.elite.deathBurst`. Widen the
read to a base-spec OR elite burst (base first — an archetype's signature; elite is the rolled affix):
```ts
_fireDeathBurst(cx, cy) {
  const burst = this.spec.deathBurst ?? (this.elite && this.elite.deathBurst)
  if (!burst || !this.projectilePool || !burst.projectile) return
  // ... unchanged radial-ring loop ...
}
```
New field on `EnemySpec` (SAME shape as `EliteAffixSpec.deathBurst` — DRY, reuse the type):
```ts
deathBurst?: { count: number; projectile: EnemyProjectileSpec } | null
```
Default null / undefined ⇒ no burst (every existing archetype unchanged — only an explicit elite roll fires
one today, and that path is preserved). The Kamikaze carries a `deathBurst` of ~5–6 weak `enemy` projectiles
(a "dodge the corpse" tell, low per-shot damage). This rides the EXISTING enemy ProjectilePool + the
enemy-projectile→player overlap with ZERO new wiring (it is the elite-burst path, just sourced from the spec).

**Edge case**: a Kamikaze that ALSO rolls an explosive elite affix would, with `??`, fire ONLY its base burst
(base wins). That is fine (one burst, not two) and intentional — KISS. The death-center coords are already
captured before the body is disabled (`_die`, the review BLOCKER fix) — unchanged.

### Decision 6 — `scaleSpec` carries the new fields through the depth fold (no new scaling, never-weaken)

`scaleSpec` deep-clones `swing` + each `attacks[]` entry's `swing`/`projectile`. Extend it minimally so the
new fields ride the existing fold:
- `impactAoe`: spread it through the per-attack `projectile` clone; OPTIONALLY fold `impactAoe.damage` by
  `enemyDamageMult` (consistent with how `projectile.damage` folds — a deeper Bomber's splash hits harder).
  **Recommended**: fold it (consistency + never-weaken). The verifier §6a per-attack fold check only asserts
  `projectile.damage` ≥ base today; folding `impactAoe.damage` the same way keeps it monotone.
- `deathBurst`: it is a spec-LEVEL field (not per-attack). `scaleSpec` does `{...baseSpec}` (shallow) so
  `deathBurst` rides through by reference. **KISS**: leave `deathBurst.projectile.damage` UNSCALED (a posthumous
  tell, not the Kamikaze's main threat — the dash contact + low HP define it). This is a deliberate
  no-scale; document it so the verifier doesn't expect a rise. If the implementer prefers consistency, a
  scaled deep-clone is acceptable (never-weaken either way — unscaled holds, scaled rises).
- `frontalDR`: a flat fraction (not damage) — rides through `{...baseSpec}` unchanged. NOT scaled (a shield
  reduces the same fraction at every depth — the contract is "flank it", not "out-DPS the depth"). No
  monotonicity concern (a constant fraction is trivially monotone).

`scaleSpec` must NOT mutate the base (the existing aliasing discipline — the deep-clone of `attacks[]` already
holds; `impactAoe` clones inside the per-attack `projectile` clone, so the base is never touched).

### Decision 7 — Biome pool placement: MID/LATE only, monotone-preserving

Add the three ids to mid/late pools as LOW-to-MODERATE weights. Do NOT touch `PRISON` (tier 0 — stays
all-grunt, the fair opener). Concrete plan (weights are the implementer's to fine-tune within these rules):

- **SEWERS** (tier 1): add `kamikaze` at a LOW weight (a rare suicide-rusher debut — a sharp but cheap threat
  that fits the kiting-shooter chaos). Do NOT add Bomber/Shielder here (keep tier 1 from spiking).
- **CATACOMBS** (tier 2, default mid): add `bomber` at a moderate weight (the lobbed-splash zoner fits the
  vertical crypt) and `shielder` at a low weight.
- **OSSUARY** (tier 2, alt mid): add `shielder` at a moderate weight (the "ranged-ambush galleries" feel pairs
  a frontal tank with the shooters) and `bomber` at a low weight. Keep it DISTINCT from Catacombs' mix.
- **RAMPARTS** (tier 3, boss biome): add ALL THREE at moderate weights (the deepest biome throws the full
  bestiary at you — it already lists every archetype).

Every added entry is `{ id, w }` with `w > 0` referencing a known id — the verifier §6b asserts exactly that.
No early biome gains a harder archetype; `difficultyTier` and per-biome bands are UNCHANGED, so §4b
(tier monotonicity) and §4c (whole-run `effectiveDifficulty`) stay green untouched (those read tier + depth
curve, NOT pool composition — adding a pool id never moves `effectiveDifficulty`).

### Decision 8 — Programmer-art colours + telegraph palette (no new art)

Each spec carries the full colour set (`color` / `colorTelegraph` / `colorActive` / `colorRecovery` /
`colorHurt`) like every archetype — distinct resting fills so the three read on sight:
- BOMBER: a dark orange/amber (a "live grenade" read) — distinct from SHOOTER purple / SPITTER teal.
- KAMIKAZE: a hot crimson/pink (a "this one rushes + pops" read).
- SHIELDER: a steel grey-blue (a "tanky front" read).
Colours are consumed only by the Phaser-coupled `Enemy.ts` (the verifier ignores them). The telegraph markers
reuse the existing `_updateTelegraphMarker` per-kind sizing — a `shoot` Bomber shows the long aim line, a
`dash` Kamikaze the lunge bar, a `swing` Shielder the forward box (no new marker code).

### Decision 9 — i18n: no new strings (enemies are unlabeled)

Enemies carry NO user-facing labels (confirmed: `i18n/en.ts` / `zh-CN.ts` have no per-archetype enemy text;
the GameOver summary counts kills, never names species). So this slice adds **NO** i18n strings. If a future
slice surfaces an enemy name in the HUD, it adds BOTH locales — but YAGNI here. (Obligation noted so the
implementer doesn't invent labels.)

## 4. Additive Identity & Determinism Obligations (the CONTRACT)

1. **ADDITIVE IDENTITY**: every new spec field defaults to the neutral identity —
   `EnemyProjectileSpec.impactAoe = undefined/null` (no splash), `EnemySpec.deathBurst = undefined/null` (no
   burst), `EnemySpec.frontalDR = undefined/0` (no reduction), `ProjectilePool.onRelease = undefined` (no
   callback). With these defaults, every EXISTING archetype (GRUNT/SHOOTER/CHARGER/FLYER/SPITTER) and the
   player projectile pool are BYTE-IDENTICAL. A run whose rolled pools contain no new id plays exactly as
   before.
2. **DETERMINISM PINS**: the new entities are ENEMIES — they join biome `enemyPool` weights directly
   (established practice). They are NOT weapons/skills/mutations → they do NOT feed `runWeaponPool` /
   `runSkillPool` / `runMutationPool`, so the §13/§5 starter pins are UNTOUCHED. No blueprint gating needed.
3. **DETERMINISM (scene-side rolls)**: the archetype pick + the elite roll already use the existing fresh
   seeded RNG off the generator's pinned draw (`_pickArchetype` / `_rollEliteForRoom`). Adding ids to a pool
   does NOT change the draw thread or the level pin. The Bomber's impact-AoE, the Kamikaze burst, and the
   `_chooseAttack` weighted pick all run on RUNTIME `Math.random` (off the level pin — the verifier never
   imports `Enemy.ts`), exactly like the existing burst/fan. No level-layout RNG is touched → the level
   regression pin + determinism deep-equal stay intact.
4. **NEVER-WEAKEN / MONOTONE**: no early biome gains a harder archetype; `difficultyTier` + per-biome bands +
   `effectiveDifficulty` are unchanged. `scaleSpec` folds `impactAoe.damage` (and optionally
   `deathBurst.projectile.damage`) NON-decreasing with depth; `frontalDR` is a constant fraction (trivially
   monotone). `Math.max(1, ...)` on the Shielder reduction guarantees a front hit always deals ≥ 1.
5. **PURE CONFIG**: `config/enemies.ts` stays Phaser-free pure data. The new fields are plain data on the
   existing interfaces. `damage.ts` is NOT touched (stays pure — the Shielder reduction is at the SCENE site).
6. **i18n**: no new UI text (Decision 9).
7. **VERIFIER SWEEP (additions, Decision 7-style)** in `scripts/verify-gen.mjs` §6a:
   - `ENEMY_ARCHETYPES.length` rises to 8 (≥ 4 holds).
   - An archetype carrying `frontalDR` must have it in `[0, 1)` (a fraction that never fully negates).
   - An archetype carrying `spec.deathBurst` must have `count ≥ 1` and a numeric `projectile.damage`
     (mirroring the elite-burst shape + the §6a `shoot` `projectile.damage` check).
   - An `attacks[].projectile.impactAoe`, when present, must have numeric `radius`/`damage`/`knockback` (well-
     formed splash). If `impactAoe.damage` is folded by `scaleSpec`, the per-attack fold check asserts it is
     non-decreasing (same as `projectile.damage`).
   - The existing §6a checks (known behavior, shared numeric fields, non-empty `attacks[]` with known kinds +
     per-kind params, rising `scaleSpec.maxHp`) cover the three new specs unchanged.
   - §6b: the new pool entries reference only known ids (automatic — the three are now in `ENEMY_SPECS`).

## 5. Acceptance Criteria

- [ ] `BOMBER`, `KAMIKAZE`, `SHIELDER` exist in `config/enemies.ts`, added to `ENEMY_SPECS` +
      `ENEMY_ARCHETYPES`, each reusing an EXISTING behavior (`ranged`/`charge`/`melee`) and a well-formed
      non-empty `attacks[]` table with known kinds.
- [ ] **Bomber** fires a slow, heavily-telegraphed lobbed `shoot`; on impact (land/expiry OR direct player
      hit) a small radial AoE damages the player if in range. Other enemies' bolts (SHOOTER/SPITTER/FLYER/
      elite burst) and the player pool are byte-unchanged (no `onRelease`, no splash).
- [ ] **Kamikaze** is low-HP, dashes, and fires a radial projectile burst on death via the widened
      `_fireDeathBurst` (`spec.deathBurst`), reusing the enemy ProjectilePool + the enemy-shot→player overlap.
      An explosive-elite roll on a normal enemy still bursts (the elite path is preserved).
- [ ] **Shielder** takes reduced damage from a player melee/projectile FRONT hit; a backstab/flank
      (`result.isBackstab`) lands full. A front hit always deals ≥ 1 (never soft-locks). Every other
      archetype takes full damage (`frontalDR` 0/undefined → identity).
- [ ] The three ids appear ONLY in MID/LATE pools (SEWERS/CATACOMBS/OSSUARY/RAMPARTS per Decision 7); PRISON
      is untouched (still all-grunt). Each pool entry is `{ id, w>0 }` referencing a known id.
- [ ] **ADDITIVE IDENTITY**: a run with no new ids rolled is byte-identical; every new field defaults neutral.
- [ ] **MONOTONICITY**: `difficultyTier` + per-biome bands + whole-run `effectiveDifficulty` unchanged;
      verifier §4b/§4c green.
- [ ] **Determinism pins**: `runWeaponPool`/`runSkillPool`/`runMutationPool` starter pins untouched (no new
      weapon/skill/mutation). Level regression pin + determinism deep-equal untouched.
- [ ] `scaleSpec` carries the new fields through the depth fold without mutating the base; `impactAoe.damage`
      (and `deathBurst` if scaled) is non-decreasing with depth; `frontalDR` is a constant fraction.
- [ ] `scripts/verify-gen.mjs` passes with the new §6a asserts for `frontalDR` ∈ [0,1), `deathBurst`
      well-formedness, and `impactAoe` well-formedness.
- [ ] No new i18n strings (enemies are unlabeled). No new external art/audio (programmer-art colours only).
- [ ] `npm run build` (tsc + vite) and `node scripts/verify-gen.mjs` both green.

## 6. Files To Touch

- `src/config/enemies.ts` — add `BOMBER`/`KAMIKAZE`/`SHIELDER` specs; add to `ENEMY_SPECS` +
  `ENEMY_ARCHETYPES`; extend `EnemyProjectileSpec` (`impactAoe?`) and `EnemySpec` (`deathBurst?`,
  `frontalDR?`).
- `src/config/difficulty.ts` — `scaleSpec` carries `impactAoe` through the per-attack `projectile` clone
  (folding `impactAoe.damage`); `deathBurst`/`frontalDR` ride the shallow spec clone (Decision 6).
- `src/entities/Enemy.ts` — widen `_fireDeathBurst` to read `this.spec.deathBurst ?? this.elite?.deathBurst`
  (Kamikaze). No new FSM branch.
- `src/combat/ProjectilePool.ts` — add an optional `onRelease?(x, y, spec)` callback fired once in `_disable`
  BEFORE `pj.spec` is nulled (undefined by default ⇒ identity).
- `src/scenes/GameScene.ts` — set `enemyProjectilePool.onRelease` to fire `_enemyRadialDamage` for a shot
  carrying `impactAoe` (Bomber); add the `_enemyRadialDamage(x, y, aoe)` helper (mirrors
  `_onEnemyProjectileHitPlayer`); add the Shielder `frontalDR` guard at `_onPlayerHitEnemy` AND
  `_onProjectileHitEnemy` (after `resolveHit`, before `enemy.onHit`).
- `src/config/biomes.ts` — add the three ids to SEWERS/CATACOMBS/OSSUARY/RAMPARTS `enemyPool` weights per
  Decision 7 (PRISON untouched).
- `scripts/verify-gen.mjs` — §6a: assert `frontalDR` ∈ [0,1) when present; `spec.deathBurst` well-formed
  (`count ≥ 1`, numeric `projectile.damage`); `attacks[].projectile.impactAoe` well-formed (numeric
  `radius`/`damage`/`knockback`) + folded monotone if scaled.
- `src/i18n/en.ts` + `src/i18n/zh-CN.ts` — NO CHANGE expected (enemies unlabeled, Decision 9). Listed only so
  the implementer confirms no UI text leaked in.
