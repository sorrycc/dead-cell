# Per-weapon movesets (playstyle, not stats) + a timing-rewarding defensive option

## 1. Background

The four weapons (`SWORD`/`HAMMER`/`BOW`/`SPEAR`, `src/config/weapons.ts`) already differ in *numbers*
and in a *status tag* (sword→none, hammer→stun, bow→poison, spear→bleed) and in melee-vs-ranged
*dispatch*. But mechanically every melee weapon plays the SAME WAY: `Player._startSwing`
(Player.ts:653) advances `comboIndex` through `equippedWeapon.swings[]`, arms `attackTimer = active +
recovery`, and dispatches a hitbox (melee) or a projectile (ranged). The ONLY per-weapon variation is
the swing-row geometry/damage and the comboWindow chain length — i.e. STAT DELTAS. There is:

- **no hold-to-charge** anywhere (the bow fires the instant you tap; the hammer just has a slow swing),
- **no multi-hit flurry vs single-poke distinction** beyond row count,
- **no directional finisher** that reads the player's intent,
- **no defensive option that rewards timing** — `isInvulnerable()` (dodge i-frames) is the only
  defense, and it is purely a movement (roll-through) tool, not a *stand-and-time-it* parry/block.

So the genre's "weapon = a PLAYSTYLE, the 2nd-slot pick = a build decision" fantasy is thin: a Hammer
plays like a slow Sword, a Bow plays like an auto-fire Sword-at-range. The slice makes each weapon a
DISTINCT ATTACK PATTERN and adds ONE timing-rewarding defensive option, so swapping the active slot
(round-3 two-slot system, Player.ts:223-232) is about *how you want to fight*, not just *which numbers*.

### The load-bearing constraints (read this first)

1. **`src/config/weapons.ts` stays 100% PURE** (NO Phaser import) so `scripts/verify-gen.mjs` node-imports
   it and the weapon well-formedness sweep (§5d AC54/AC55) + the addStatus/status sweeps (§8a/§10a AC66)
   run headlessly. Any new schema fields must be plain data.
2. **The verifier weapon sweeps stay GREEN.** §5d (verify-gen.mjs:690-715) asserts `type ∈ {melee,ranged}`,
   a non-empty `swings` table with the 9 numeric `SWING_FIELDS`, `active>0 && recovery>=0`, AND
   **`projectile` IFF `ranged`**. §10a (verify-gen.mjs:1085-1109) sweeps `WEAPON_AFFIXES` + asserts an
   `addStatus.kind` is a KNOWN `STATUS_KINDS`. New optional fields must be ADDED to these sweeps so a
   malformed moveset still fails loudly, and the projectile-iff-ranged + non-empty-swings contracts MUST
   be preserved verbatim.
3. **`foldWeaponAffix` must still work on the new schema** (weapons.ts:283). It deep-clones `swings[]` +
   `projectile` and bakes in `damageMult`/`knockbackMult`/`comboSpeedMult`. Any new per-weapon "mode"
   data (charge, flurry, parry) must survive the fold unchanged (shallow-copied via the `...weapon` spread,
   or deep-cloned if it must scale).
4. **Input reuse + NO key collisions.** Charge = HOLD the existing attack key (J / left-click). A parry
   reuses an existing key OR adds at most ONE new key; it must AVOID arrows/WASD/Space/J/Shift/K/Q/E/R/M/F/C
   (Input.ts:58-77 already binds all of those).
5. **The Sword stays the identity baseline** (its fast 3-hit combo is the Phase-4 feel re-exported as
   `SWINGS` for back-compat, weapons.ts:90). We only ADD a directional finisher to it; the default
   forward combo is byte-unchanged.
6. **Do NOT modify `LevelGenerator.ts`.** No reachability/jump-envelope change; the level pin is untouched.

## 2. Requirements Summary

- **Hammer — HOLD-to-charge heavy smash.** Holding J/click winds up a charge; on RELEASE the hammer
  delivers a heavier smash with an **AoE shockwave** (a small radial hit around the impact) and an
  **armor-break** (the existing stun, but longer + a damage-vulnerability mark). A *tap* still does the
  current 2-hit combo (identity-leaning for the tap path).
- **Spear — multi-hit thrust flurry / long poke.** A tap is the current long-reach thrust; HOLDING the
  attack key chains a rapid **multi-hit flurry** of fast low-damage pokes (a "drill") that keeps reach.
- **Sword — the fast 3-hit combo (BASELINE, kept) + a directional finisher.** Combo 1→2→3 is byte-
  identical. The 3rd swing becomes a **directional finisher**: if the player holds DOWN at the finisher
  it's a downward/ground variant (more knockback), else the normal forward finisher. Identity-leaning:
  the *default* (no direction held) finisher is unchanged.
- **Bow — HOLD-to-charge for more damage/pierce.** Tap = the current single shot. HOLD = a charged shot
  with more damage AND **pierce** (hits multiple enemies in a line instead of dying on first hit).
- **ONE defensive option that rewards timing — a PARRY window.** A new key (default `V`, a free key not
  in the forbidden set) opens a brief **parry window**; an incoming hit that lands DURING the window is
  NEGATED (no damage, no knockback) and rewards the player (a brief riposte buff / a parry "perfect"
  cue). Outside the window it does nothing (a missed parry = exposed). This is the stand-and-time-it
  defense the slice asks for, orthogonal to the roll-through dodge.
- **Weapon swap / 2nd-slot becomes a PLAYSTYLE choice.** With distinct movesets, carrying Hammer+Bow
  (charge-burst zoner) vs Spear+Sword (flurry-poke brawler) is a real decision. No new swap wiring is
  needed — the existing two-slot system (Player.swapWeapon, GameScene._swapWeapon) already swaps the
  *moveset*; this slice just makes the movesets meaningfully different.
- **Identity (the hard constraint).** A run that never holds the attack key, never holds DOWN at a
  finisher, and never presses the parry key plays BYTE-IDENTICALLY to today: the Sword's forward combo,
  the Spear's tap thrust, the Bow's tap shot, the Hammer's tap combo are all unchanged. The new
  charge/flurry/finisher/parry code is gated behind the new inputs and the new optional schema fields
  default to "no special mode" so an un-extended weapon (and the verifier's headless world) is unaffected.
- **Non-goals (YAGNI).** No shield-block stamina meter (parry is a timing window, not a held guard with
  a resource — KISS, ONE defensive option). No per-weapon charge-LEVEL tiers (charge is a single
  binary: held-long-enough = charged, else tap — not 3 charge stages). No new weapon. No aim-with-mouse
  for the bow's charge direction (it fires along facing like today). No parry-specific per-enemy attack
  flags (a parry negates ANY incoming hit in the window — uniform, KISS). No deflect-the-projectile-back
  (a parried projectile is simply consumed — YAGNI).

## 3. Acceptance Criteria

1. **`src/config/weapons.ts` stays PURE + the schema extends cleanly.** `WeaponSpec` gains an OPTIONAL
   `moveset?: WeaponMoveset` field (a plain-data sub-object: `{ charge?, flurry?, finisher?, pierce? }`,
   all optional). NO Phaser import is added. A weapon with NO `moveset` (the default) behaves EXACTLY as
   today (the additive identity). `npm run verify` node-imports the module unchanged.
2. **Verifier weapon sweep (§5d, AC54/AC55) extended + GREEN.** The non-empty-`swings` check, the 9
   `SWING_FIELDS` check, the `active>0 && recovery>=0` check, and the **projectile-IFF-ranged** check are
   ALL preserved verbatim. A NEW well-formedness pass validates `moveset` WHEN PRESENT: a `charge`
   block needs `chargeTime>0` + `damageMult>=1`; a `flurry` needs `hits>=2` + `interval>0`; `pierce`
   (the bow's charged pierce) needs `maxTargets>=2`; a charge on a `ranged` weapon may set `pierce` and a
   charge on a `melee` weapon may set `aoeRadius>=0`. A malformed `moveset` fails loudly. `npm run verify`
   green.
3. **`foldWeaponAffix` survives the new schema.** A folded weapon (Keen/Swift/Searing/…) still carries
   its `moveset` intact (the `...weapon` spread copies it; charge/flurry/pierce values are NOT scaled by
   the affix — they describe a PATTERN, not a stat — except where they reuse `swings`/`projectile` which
   ARE scaled). The verifier's §10 fold sweep (never-mutates-base, preserves-schema, never-weakens-damage)
   stays green; a NEW assertion proves the folded weapon's `moveset` is `===`-shape-preserved.
4. **Hammer hold-to-charge smash.** Holding the attack key on the Hammer past `moveset.charge.chargeTime`
   and RELEASING fires a CHARGED smash: damage × `charge.damageMult`, a radial AoE hit of
   `charge.aoeRadius` around the impact (reusing `GameScene._radialDamage` — NO new combat math), and a
   LONGER stun + an armor-break mark (the vs-afflicted-style vulnerability — see Decision 6). A TAP (no
   charge) does the current 2-row combo unchanged (identity).
5. **Spear hold-to-flurry.** Holding the attack key on the Spear triggers a `moveset.flurry` of `hits`
   rapid pokes spaced `interval` apart (each a normal thrust hitbox), keeping the long reach. A TAP does
   the current single thrust / 3-combo unchanged (identity).
6. **Sword directional finisher.** The Sword's finisher swing (combo index 2) reads a held DOWN
   (`input.moveX`-independent down flag — see Decision 4): held-down ⇒ a heavier-knockback "ground
   slam" variant of the finisher; not-held ⇒ the EXACT current forward finisher (byte-identical). Combo
   swings 0 and 1 are unchanged.
7. **Bow hold-to-charge pierce.** Holding the attack key on the Bow past `charge.chargeTime` and
   releasing fires a CHARGED projectile: damage × `charge.damageMult` AND `pierce.maxTargets` (the shot
   hits up to N enemies in a line instead of releasing on first hit). A TAP fires the current single
   shot unchanged (identity).
8. **A timing-rewarding PARRY.** A new `parryPressed` input (key `V`, NOT in the forbidden set) arms a
   brief `PARRY_WINDOW` on the Player. An incoming hit during the window is NEGATED (Player.onHit / the
   hit-application path returns without subtracting HP or applying knockback) and grants a brief riposte
   buff + pops a "PARRY!" cue. Outside the window the player takes the hit normally. The parry has a
   cooldown so it can't be spammed. With the parry key never pressed, `isHittable()`/`onHit` are
   byte-identical to today.
9. **Input extended without collisions.** `InputSnapshot` gains `attackHeld: boolean` (the HOLD state of
   J/click, mirroring `jumpHeld`) and `parryPressed: boolean` (edge of `V`) and a `downHeld: boolean`
   (the held DOWN/S for the directional finisher — currently `down`/`s` are RESERVED-unused, Input.ts:65).
   `V` is added to the keybinds; it collides with NONE of arrows/WASD/Space/J/Shift/K/Q/E/R/M/F/C.
10. **Identity.** With NO attack-hold, NO down-hold at the finisher, NO parry press: the Sword forward
    combo, Spear tap thrust, Bow tap shot, Hammer tap combo, and `Player.onHit`/`isHittable` are all
    byte-identical to before this slice. `LevelGenerator.ts` is untouched (no reachability change). `npm
    run typecheck` + `npm run verify` both green.

## 4. Problem Analysis

- **Where does "hold the attack key" get detected?** `attack()` (Player.ts:336) only latches an EDGE
  (`_pendingAttack`), resolved in `update` step 1.5. Charge needs the HELD state too. Two candidate seams:
  - **A — make `attack()` start a charge and detect release.** Rejected: `attack()` is edge-only by
    design (a hit-stop frozen frame must not double-fire — Player.ts:334). Mixing a held-state machine
    into it muddies that contract.
  - **B (chosen) — add `attackHeld` to the InputSnapshot** (mirroring `jumpHeld`, Input.ts:98) and run a
    small CHARGE STATE MACHINE in `Player.update` (a `chargeTimer` that accrues while `attackHeld` AND the
    equipped weapon has `moveset.charge`, and FIRES the charged variant on the release edge). This mirrors
    the existing variable-height jump (hold Space → full jump, release → cut), which is the established
    "hold a key, release for an outcome" pattern in this very file. The edge `attack()` still latches a
    TAP for weapons without a charge moveset (identity).
- **Charge vs the combo lock.** The attack lock (`attackTimer`) gates re-fire. A charge must HOLD the
  player in a wind-up without firing a swing, then fire ONE charged swing on release. Cleanest: a charge
  is a NEW transient state distinct from a tapped swing — while charging, no hitbox/projectile spawns;
  on release `_startSwing` runs with a "charged" flag that picks the charged swing-row / projectile mods.
  KISS: reuse `_startSwing` with a boolean param rather than a parallel method (DRY).
- **Flurry vs charge — are they the same machine?** A flurry (spear) is "while held, fire repeated
  pokes on an interval"; a charge (hammer/bow) is "while held, accrue, fire ONE big thing on release".
  They're different enough that one flag won't do, but they share the `attackHeld` read. Decision 2 splits
  them by which `moveset` sub-block the equipped weapon carries: `moveset.flurry` ⇒ repeat-while-held;
  `moveset.charge` ⇒ accrue-and-release. A weapon has at most one (KISS).
- **AoE smash — new combat primitive?** No. `GameScene._radialDamage(x,y,radius,damage,knockback,status)`
  (GameScene.ts:1266) already does "instant radial damage to every enemy/boss within radius", reusing
  `resolveHit` + `enemy.onHit` + `_applyHitStatus` + `effects`. The hammer's charged AoE is one call to it
  from the melee-hit handler (or from `_startSwing`'s release path) — ZERO new combat math (DRY, mirrors
  the skill `blast`).
- **Bow pierce — new pool behavior?** The projectile pool releases a shot on first hit (GameScene.ts:1794
  "the shot dies on first hit (no pierce)"). Pierce needs the shot to SURVIVE a hit up to `maxTargets`
  times. The pool already carries a per-shot `hitSet` (ProjectilePool.ts:113) that dedups multi-overlap —
  so pierce is: don't `release` on hit until the shot's hit count reaches its `maxTargets`. We add a
  `pierceLeft` counter to the projectile context (mutated on acquire like `releaseTimer`), decremented per
  hit; the handler releases only when it reaches 0. A normal (non-charged) shot acquires with
  `pierceLeft=1` ⇒ byte-identical "dies on first hit" (identity). NO new pool object; one counter field.
- **Directional finisher — which input?** `moveX` already encodes left/right; the finisher direction we
  want is DOWN (a ground-slam). `down`/`s` keys are bound but RESERVED-unused (Input.ts:65) — perfect:
  expose `downHeld` and read it ONLY at the Sword finisher swing. KISS: a held-down at the finisher picks
  a variant swing row (more knockback); not-held = the current finisher byte-for-byte.
- **Parry — reuse a key or add one?** The forbidden set already covers dodge (Shift/K), attack (J),
  jump (Space), flask (Q), interact (E), swap (R), mute (M), skills (F/C). A parry must be a SEPARATE,
  always-available defensive action (you parry WHILE you could also dodge), so reusing dodge would
  conflict with the roll. The constraint allows ONE new key. `V` is unbound and outside the forbidden
  set ⇒ add `V` for parry (Decision 5). KISS — a single timing window, no held-guard resource.
- **Parry — where is the negation applied?** Incoming player damage flows through `_hurtPlayer(result)`
  (GameScene.ts:1609 — the SINGLE player-damage point) → `player.onHit(result)`. The cleanest negation is
  in `Player.onHit`: if the parry window is live, consume it (negate, riposte buff, cue) and RETURN before
  HP/knockback. `isHittable()` need NOT change (the parry is a *consume-the-hit* reaction, not an i-frame
  — a parried hit still "arrives", it's just negated + rewarded, which is the genre-correct feel). This
  keeps the negation in ONE place that ALL four player-hit sites already funnel through (DRY).
- **Armor-break — reuse the affliction vulnerability hook?** The affliction-synergy slice added
  `vsAfflictedDamageMult` (a ×damage-vs-afflicted-target fold in `_mutationDamageMult`, GameScene.ts:1694)
  and the stun status. The hammer's "armor-break" is most cheaply expressed as **a longer stun**, which
  already counts as "afflicted" for that fold — so on a Hemorrhage build the armor-broken (stunned) enemy
  already takes bonus damage. We do NOT add a NEW per-enemy "armor" stat (YAGNI — no enemy has armor
  today). KISS: armor-break = a longer stun (the genre's stagger) applied by the charged smash; the
  damage-vulnerability is the existing vs-afflicted path for builds that opt into it. (See Decision 6.)

## 5. Decision Log

**1. Add an OPTIONAL `moveset` sub-object to `WeaponSpec`, not parallel top-level fields.**
- Options: A) flat optional fields on `WeaponSpec` (`chargeTime?`, `flurryHits?`, …) · B) one optional
  `moveset?: { charge?, flurry?, finisher?, pierce? }` nested object.
- Decision: **B**. One nested optional groups the playstyle data, keeps `WeaponSpec`'s top level (read by
  the Player/Pickup/Hub generic code) clean, and makes the verifier sweep a single "if `moveset` present,
  validate its blocks" pass. `undefined moveset` = the default tap behavior (identity). All blocks are
  optional so a weapon picks exactly the modes it wants (Hammer: `charge`; Spear: `flurry`; Bow:
  `charge`+`pierce`; Sword: `finisher`). PURE plain data — no Phaser, node-importable.

**2. `attackHeld` drives a charge-OR-flurry machine in `Player.update`, split by `moveset` block.**
- The Player reads `input.attackHeld` (NEW, mirrors `jumpHeld`). In `update`:
  - If `equippedWeapon.moveset?.charge` AND `attackHeld`: accrue `chargeTimer += dt` (entering a CHARGE
    state — no swing fires while charging). On the RELEASE edge (`!attackHeld && chargeTimer > 0`): fire
    `_startSwing({ charged: chargeTimer >= charge.chargeTime })` — a charged swing if held long enough,
    else a normal tap swing (a brief hold that didn't reach the threshold = a normal attack, forgiving).
  - If `equippedWeapon.moveset?.flurry` AND `attackHeld`: fire a poke every `flurry.interval` (a
    `flurryTimer`) up to `flurry.hits`, then stop until release+re-press (so a flurry is bounded, KISS).
  - Else (no moveset, OR a charge/flurry weapon used via a single tap edge): the EXISTING edge `attack()`
    path fires one tap swing (identity — the Sword/any plain weapon is unchanged).
- The edge `attack()` (latch) is KEPT for the tap path; charge/flurry are HELD-state additions that do not
  touch the edge contract (so a hit-stop frozen frame still can't double-fire).
- KISS/YAGNI: a weapon has at most ONE of `charge`/`flurry`. A single binary charge (held-enough vs tap),
  not multi-tier charge levels.

**3. The hammer's AoE smash reuses `GameScene._radialDamage` (no new combat primitive).**
- On a CHARGED hammer release, the melee hit handler (`_onPlayerHitEnemy`) — or the release path — calls
  `_radialDamage(impactX, impactY, charge.aoeRadius, smashDamage, knockback, stunSpec)` after the primary
  hit, so every enemy in the radius takes the smash + the (longer) stun. This is the SAME primitive the
  skill `blast` uses (GameScene.ts:1249), so it's proven, deterministic (no RNG), and pools-correct.
- The charged DAMAGE is the finisher swing's `damage × charge.damageMult`, resolved ONCE via `resolveHit`
  with the existing `damageMult` fold (so meta/scroll/mutation mults still apply — DRY).

**4. The Sword directional finisher reads a held-DOWN flag, default = the current finisher.**
- Options: A) a 4th sword swing row + branch on `moveX` · B) read a `downHeld` flag at the finisher and
  pick a variant row from `moveset.finisher`.
- Decision: **B**. `moveset.finisher` holds an OPTIONAL `down` variant swing row (more knockback / a small
  shove). At `_startSwing` when `comboIndex === swings.length - 1` (the finisher) AND `input.downHeld` AND
  `moveset.finisher?.down`: use the variant row's deltas; else the EXISTING finisher row byte-for-byte
  (identity). This keeps the Sword's default 3-combo unchanged and adds the directional flourish only
  when the player explicitly holds down — identity-leaning, exactly as the constraint requires.

**5. The parry adds ONE new key (`V`), negates in `Player.onHit`, and is a timing window (not a guard).**
- Options: A) a held shield-block with a stamina/posture meter · B) a brief PARRY WINDOW armed by a key
  press, negating any hit that lands inside it.
- Decision: **B** (KISS — the slice asks for ONE defensive option that rewards TIMING; a window is purer
  than a resource-managed guard). `V` is the only new key (outside the forbidden set). On `parryPressed`,
  the Player arms `parryTimer = PARRY_WINDOW` (and a `parryCooldownTimer` so it can't be spammed). In
  `onHit`: if `parryTimer > 0`, NEGATE (no HP, no knockback), set `parryCooldownTimer`, grant a brief
  `riposteTimer` buff (a short damage bump on the next hit — read at the hit site like the other mults),
  pop a "PARRY!" cue, and RETURN. Outside the window, `onHit` is byte-identical. `isHittable()` is
  UNCHANGED (a parried hit "arrives" and is consumed — the genre-correct active-defense feel, distinct
  from the dodge's i-frame "the hit never connected").
- YAGNI: no posture/stamina meter; no per-enemy parryable flag (parry negates ANY hit in the window); no
  deflect-projectile-back (a parried enemy projectile is consumed in `_onEnemyProjectileHitPlayer` /
  `_hurtPlayer` by the same `onHit`-returns-negated path).

**6. Armor-break = a LONGER stun (reuse the existing status + vs-afflicted fold), NOT a new armor stat.**
- Options: A) add an `armor` HP-reduction stat to enemies + an armor-break debuff · B) express armor-break
  as a longer STUN (the genre's stagger) — which already counts as "afflicted" for the affliction-synergy
  `vsAfflictedDamageMult` fold, so a build that wants the damage-vulnerability gets it for free.
- Decision: **B** (KISS/YAGNI — no enemy has armor today; adding an armor stat is a whole subsystem for
  one weapon's flavor). The charged hammer smash applies a LONGER stun (a `chargeStunDuration` in the
  hammer's `moveset.charge`, OVERRIDING the base 0.6s stun on a charged hit) to every enemy the AoE
  catches. The "break" reads as: the enemy is frozen LONGER, and on a vs-afflicted build it also takes
  more damage while stunned (the existing fold). This ships the "armor-break" *feel* with zero new enemy
  state.

**7. Bow pierce = a `pierceLeft` counter on the projectile context (one field), default 1 = identity.**
- The projectile context gains `pierceLeft: number` (mutated on `acquire`, like `releaseTimer`). A normal
  shot acquires `pierceLeft = 1` ⇒ the handler releases on first hit exactly as today (identity). A
  CHARGED bow shot acquires `pierceLeft = pierce.maxTargets` ⇒ `_onProjectileHitEnemy` decrements it and
  releases ONLY when it hits 0 (the dedup `hitSet` already prevents hitting the same enemy twice, so a
  pierce passes THROUGH a line of distinct enemies). One counter field, no new pool object, no new
  overlap. `acquire`'s signature gains an OPTIONAL trailing `pierce` arg (defaulting to 1) so every
  existing call is unchanged (identity).

**8. Charge state machine timers decay on the GAMEPLAY dt; charge does NOT touch the level/seed pins.**
- `chargeTimer`/`flurryTimer`/`parryTimer`/`parryCooldownTimer`/`riposteTimer` all decay by the gameplay
  `dt` in `Player.update` alongside every other timer (so they freeze during hit-stop / the shop pause —
  consistent). None reads RNG, none touches the generator. The level regression pin + determinism pins
  are unaffected (no `LevelGenerator.ts` change, no seed read).

**9. The verifier sweep validates `moveset` WHEN PRESENT, preserving the existing contracts verbatim.**
- The §5d loop keeps EVERY current assertion (non-empty swings, the 9 fields, active/recovery, projectile-
  iff-ranged). It ADDS: if `w.moveset` is present, validate each sub-block's required numeric fields
  (charge: `chargeTime>0`, `damageMult>=1`; flurry: `hits>=2`, `interval>0`; pierce: `maxTargets>=2`;
  finisher.down, if present, a well-formed partial swing row), and assert the mode matches the type (a
  `flurry`/`finisher`/`aoeRadius` only on a `melee` weapon; `pierce` only on a `ranged` weapon — a
  malformed pairing fails loudly). A NEW one-line check asserts `foldWeaponAffix(SWORD, KEEN).moveset`
  is shape-preserved (the fold doesn't drop the moveset). All deliberate, all loud-on-malformed.

## 6. Design

All edits are code-level and named. The PURE module `weapons.ts` gains Phaser-free data only.
`LevelGenerator.ts` is untouched.

### 6.1 `src/config/weapons.ts` (PURE) — the `moveset` schema + per-weapon data

Add the moveset interfaces (all fields optional plain data) and attach a `moveset` to Hammer/Spear/Bow/Sword:

```ts
// A hold-to-charge mode (Hammer melee smash / Bow charged shot). All plain data.
export interface ChargeMode {
  chargeTime: number          // s — HOLD the attack key at least this long for the charged variant.
  damageMult: number          // ×finisher/projectile damage on a charged release (>= 1).
  aoeRadius?: number          // px — MELEE only: a radial smash hit around the impact (0/absent = none).
  chargeStunDuration?: number // s — MELEE only: OVERRIDE stun duration on a charged hit (armor-break).
}
// A hold-to-repeat flurry (Spear drill). Repeats a poke while held.
export interface FlurryMode {
  hits: number      // total pokes in one flurry (>= 2).
  interval: number  // s — gap between pokes (> 0).
}
// A directional finisher variant (Sword ground-slam). The `down` row OVERRIDES the finisher when DOWN is held.
export interface FinisherMode {
  down?: Partial<SwingRow>  // deltas applied over the base finisher row when DOWN is held.
}
// Bow charged pierce — the shot survives N hits instead of dying on the first.
export interface PierceMode {
  maxTargets: number  // a charged shot pierces up to this many enemies (>= 2).
}
export interface WeaponMoveset {
  charge?: ChargeMode
  flurry?: FlurryMode
  finisher?: FinisherMode
  pierce?: PierceMode
}
// WeaponSpec gains: moveset?: WeaponMoveset
```

Per-weapon `moveset` data (alongside the existing `status`):
- **HAMMER**: `moveset: { charge: { chargeTime: 0.45, damageMult: 1.8, aoeRadius: 120, chargeStunDuration: 1.2 } }`.
- **SPEAR**: `moveset: { flurry: { hits: 4, interval: 0.11 } }`.
- **BOW**: `moveset: { charge: { chargeTime: 0.5, damageMult: 1.9 }, pierce: { maxTargets: 3 } }`.
- **SWORD**: `moveset: { finisher: { down: { knockback: 620, forward: 18 } } }` (the ground-slam shoves harder;
  the forward combo is otherwise byte-unchanged).

`foldWeaponAffix` (weapons.ts:283): the `{ ...weapon }` spread already COPIES `moveset` onto the folded
weapon (a shallow ref-copy — the moveset is immutable pattern data, never mutated, so sharing the ref is
safe, mirroring how `status` was handled before addStatus override). No fold change needed beyond a
one-line comment noting `moveset` rides the spread. (The affix-scaled `swings`/`projectile` already carry
the damage mults; the moveset's `damageMult` composes on top at the hit site.)

### 6.2 `src/core/Input.ts` — `attackHeld` + `parryPressed` + `downHeld` (no collisions)

- Bind `v: KC.V` in `addKeys` (the ONLY new key; outside the forbidden set).
- `InputSnapshot` gains `attackHeld: boolean`, `parryPressed: boolean`, `downHeld: boolean`.
- In `sample()`:
  - `attackHeld = keys.j.isDown || this.scene.input.activePointer.isDown` (the HELD state, mirroring
    `jumpHeld = keys.space.isDown`; the existing `attackPressed` edge is unchanged).
  - `parryPressed = Phaser.Input.Keyboard.JustDown(keys.v)` (sole-owned JustDown, like every other edge).
  - `downHeld = keys.down.isDown || keys.s.isDown` (reading the previously-reserved DOWN/S, Input.ts:65).
- These are ADDITIVE: no existing field changes, so any consumer that ignores them is unaffected (identity).

### 6.3 `src/entities/Player.ts` — the charge/flurry machine, the directional finisher, the parry

New state fields (seeded to the neutral/inactive identity in the ctor):
```ts
chargeTimer = 0          // s — accrued while holding the attack key on a charge weapon (0 = not charging).
flurryShotsLeft = 0      // pokes remaining in the current spear flurry (0 = none).
flurryTimer = 0          // s — gap timer until the next flurry poke.
parryTimer = 0           // s — > 0 = the parry window is live (a hit in it is negated).
parryCooldownTimer = 0   // s — > 0 = parry is gated (no spam).
riposteTimer = 0         // s — > 0 = a post-parry damage buff is live (read at the hit site).
```
Tuning consts (next to DODGE_*):
```ts
const PARRY_WINDOW = 0.18      // s — the timing window a hit must land in to be parried.
const PARRY_COOLDOWN = 0.6     // s — gate before parry can re-arm.
const RIPOSTE_DURATION = 1.2   // s — post-parry damage-bump window.
const RIPOSTE_DAMAGE_MULT = 1.5// ×next-hit damage after a successful parry.
const FLURRY_LOCK = 0.08       // s — the brief lock each flurry poke arms (so pokes read as distinct).
```

- **`attack()`** (edge latch) is UNCHANGED (still sets `_pendingAttack` for the tap path).
- **`update(dt, input)`** additions (all decay timers in step 1, gate the new logic on `input.*`):
  - Decay `chargeTimer` is NOT auto-decayed (it ACCRUES while held); decay `flurryTimer`, `parryTimer`,
    `parryCooldownTimer`, `riposteTimer` by `dt` with the other timers.
  - **Parry arm** (in the dodge-start vicinity, an always-available reaction): on `input.parryPressed`
    AND `parryCooldownTimer <= 0`: `parryTimer = PARRY_WINDOW`; `parryCooldownTimer = PARRY_COOLDOWN`;
    `sound?.parry()` (a new façade blip) + a brief tint pop. (Parrying does NOT cancel an attack/dodge —
    it overlays, like the hurt lockout.)
  - **Charge machine** (after the existing pending-attack resolve, gated on `equippedWeapon.moveset?.charge`):
    - while `input.attackHeld` AND not dodging AND `attackTimer <= 0`: `chargeTimer += dt` (enter a brief
      "charging" tint; no swing fires).
    - on the RELEASE edge (`!input.attackHeld && chargeTimer > 0`): call
      `_startSwing({ charged: chargeTimer >= charge.chargeTime })`, then `chargeTimer = 0`. A short hold
      that didn't reach the threshold fires a normal tap swing (forgiving — identity-ish).
    - NOTE: for a charge weapon the EDGE `_pendingAttack` is consumed WITHOUT firing (the release fires
      instead) so a tap-and-instant-release on a charge weapon still produces exactly one swing.
  - **Flurry machine** (gated on `equippedWeapon.moveset?.flurry`):
    - on the attack edge (first press) start a flurry: `flurryShotsLeft = flurry.hits`, fire poke #1 via
      `_startSwing({})`, `flurryTimer = flurry.interval`.
    - while `flurryShotsLeft > 0` AND `input.attackHeld`: when `flurryTimer <= 0`, fire the next poke
      (`_startSwing({})` with a short `FLURRY_LOCK`), `flurryShotsLeft--`, reset `flurryTimer`.
    - releasing the key OR exhausting `flurryShotsLeft` ends the flurry (a re-press starts a new one).
- **`_startSwing(opts = {})`** gains an options object `{ charged?: boolean }`:
  - resolves `swing` = the equipped weapon's row as today; if `charged` AND `moveset.charge`: multiply the
    resolved damage by `charge.damageMult` for the hit (passed to the hitbox/projectile context) and, for
    melee, set a `pendingAoe = { radius: charge.aoeRadius, stun: charge.chargeStunDuration }` the scene
    reads on the resulting hit (see §6.4).
  - **Directional finisher**: when `this.comboIndex === swings.length - 1` AND `input.downHeld` (threaded
    via a cached `this._downHeld` set at the top of `update`) AND `moveset.finisher?.down`: apply the
    `down` partial row's deltas over the finisher row (a fresh row object — never mutating the shared
    spec). Else the finisher row is unchanged (identity).
  - **Bow charged pierce**: for `type === 'ranged'`, pass `charged ? pierce.maxTargets : 1` as the
    projectile `pierce` arg to `projectilePool.acquire` (§6.5). A non-charged shot passes 1 (identity).
- **`onHit(result)`** parry negation (the FIRST thing, before the `isHittable` early-return read):
  ```ts
  if (this.parryTimer > 0) {
    this.parryTimer = 0
    this.riposteTimer = RIPOSTE_DURATION
    this.sound?.parrySuccess()
    // (the scene pops the "PARRY!" cue + a flash via the hit path / a new effects.parry — see §6.6)
    return // NEGATE: no HP, no knockback.
  }
  ```
  Everything below is unchanged (identity when `parryTimer === 0`).
- **Riposte read**: expose the riposte buff so the scene's `_mutationDamageMult` (or the melee/projectile
  hit fold) multiplies the NEXT hit by `RIPOSTE_DAMAGE_MULT` while `riposteTimer > 0`, then the scene
  clears it (one-shot). KISS: read `player.riposteTimer > 0` at the hit site and zero it after applying
  (so the buff is spent on the next connecting hit, not decayed silently).

### 6.4 `src/scenes/GameScene.ts` — wire the held attack, the charged AoE, the parry cue, the riposte

- **Input** (the update gate, GameScene.ts:2296-2312): pass `inputState.attackHeld` / `downHeld` /
  `parryPressed` through to the Player via `this.player.update(gdt, inputState)` (already passes the whole
  snapshot — so just extending `InputSnapshot` is enough; no new call). The `attackPressed` edge call
  `this.player.attack()` stays for the tap path.
- **Charged hammer AoE**: in `_onPlayerHitEnemy` (GameScene.ts:1622), after the primary `enemy.onHit` +
  status, if the player has a pending charged-melee AoE (a `player.consumePendingAoe()` returning
  `{ radius, stun } | null`), call
  `this._radialDamage(enemy.body.center.x, enemy.body.center.y, radius, result.damage, hb.swing.knockback, { kind: 'stun', duration: stun })`
  — reusing the existing radial primitive. The pending-AoE is set by `_startSwing` on the charged release
  and consumed on the first connecting hit (so the smash radiates from where it landed). If the charged
  swing whiffs (no hit), the pending-AoE is cleared on the next swing (no stale AoE — KISS).
- **Riposte fold**: in `_mutationDamageMult(target)` (GameScene.ts:1682), after the vs-afflicted fold, if
  `this.player.riposteTimer > 0` multiply by `RIPOSTE_DAMAGE_MULT` (read off a constant mirrored from the
  Player, or expose `player.riposteDamageMult`); the CALLER (`_onPlayerHitEnemy`/`_onProjectileHitEnemy`)
  zeroes `player.riposteTimer` after a connecting hit so it's spent once. Default `riposteTimer === 0` ⇒
  no change (identity).
- **Parry cue**: add `effects.parry(x, y)` (a one-shot "PARRY!" label + a bright flash, NO hit-stop —
  it's a defensive read), popped from `_hurtPlayer` when `player.onHit` reports a parry. Since `onHit`
  currently returns void, the cleanest seam is: `_hurtPlayer` checks `player.parryTimer > 0` BEFORE
  calling `onHit` (the window is still live at that instant), and if so pops the cue + skips nothing (the
  Player's `onHit` does the negation). Mirror the same check in `_onEnemyProjectileHitPlayer` /
  the hazard path (all funnel through `_hurtPlayer` — DRY, one place). (A parried ENEMY PROJECTILE is
  simply consumed by `onHit` returning negated; no deflect — YAGNI.)
- **Pierce release**: in `_onProjectileHitEnemy` (GameScene.ts:1770), replace the unconditional
  `this.projectilePool.release(projRect)` with: decrement `pj.pierceLeft`; release ONLY when it reaches 0
  (a non-charged shot's `pierceLeft` is 1 ⇒ released on first hit = identity). The dedup `hitSet` already
  prevents re-hitting the same enemy, so a charged shot passes through a line of distinct enemies.

### 6.5 `src/combat/ProjectilePool.ts` — a `pierceLeft` counter (one field)

- The `ProjectileContext` gains `pierceLeft: number`.
- `acquire(attacker, spec, ownerId, status, aim, pierce = 1)` — a new OPTIONAL trailing `pierce` arg; set
  `pj.pierceLeft = pierce` on acquire. Every existing caller omits it ⇒ `pierceLeft = 1` ⇒ byte-identical
  "dies on first hit" (identity). `_disable` resets `pierceLeft = 1` so a recycled shot never inherits a
  stale pierce.
- NO other pool change (no new overlap, no new object) — `tick`/release are unchanged; only the HANDLER
  (§6.4) decides when to release based on `pierceLeft`.

### 6.6 `src/effects/Effects.ts` + `src/audio/Sound.ts` — the parry cue + charge/parry blips

- `Effects.parry(x, y)`: a one-shot "PARRY!" label (reuse `ParticlePool.spawnNumber` with a string value,
  exactly like `statusApply`, Effects.ts:89) in a bright cyan, plus a few sparks. NO shake / NO hit-stop
  (a defensive read, not an impact). Optional small camera flash done by the scene.
- `Sound` (façade, Sound.ts): add `parry()` (a rising "ting" on the arm) and `parrySuccess()` (a brighter
  "clang" on a successful parry) and OPTIONALLY a `chargeReady()` blip when `chargeTimer` crosses the
  threshold (so the player hears the smash is ready) — all null-safe (`this.sound?.x()`), mirroring the
  existing swing/dodge/swap blips. KISS: procedural WebAudio, no assets.

### 6.7 `scripts/verify-gen.mjs` — extend the weapon sweep (AC54/AC55), keep it green

- §5d (verify-gen.mjs:690): KEEP every current assertion verbatim (non-empty swings, the 9 SWING_FIELDS,
  `active>0 && recovery>=0`, projectile-IFF-ranged). ADD, after the projectile check:
  ```js
  if (w.moveset) {
    const m = w.moveset
    if (m.charge) {
      if (!(m.charge.chargeTime > 0)) fail(`weapon ${w.id}: charge.chargeTime must be > 0`)
      if (!(m.charge.damageMult >= 1)) fail(`weapon ${w.id}: charge.damageMult must be >= 1`)
      if (m.charge.aoeRadius !== undefined && !(m.charge.aoeRadius >= 0)) fail(`weapon ${w.id}: charge.aoeRadius must be >= 0`)
    }
    if (m.flurry) {
      if (w.type !== 'melee') fail(`weapon ${w.id}: flurry only on a melee weapon`)
      if (!(m.flurry.hits >= 2)) fail(`weapon ${w.id}: flurry.hits must be >= 2`)
      if (!(m.flurry.interval > 0)) fail(`weapon ${w.id}: flurry.interval must be > 0`)
    }
    if (m.pierce) {
      if (w.type !== 'ranged') fail(`weapon ${w.id}: pierce only on a ranged weapon`)
      if (!(m.pierce.maxTargets >= 2)) fail(`weapon ${w.id}: pierce.maxTargets must be >= 2`)
    }
    if (m.finisher && w.type !== 'melee') fail(`weapon ${w.id}: finisher only on a melee weapon`)
  }
  ```
- §10 (verify-gen.mjs:1077, the fold sweep): ADD a one-liner asserting the fold preserves the moveset, e.g.
  `if (SWORD.moveset && !foldWeaponAffix(SWORD, WEAPON_KEEN).moveset) fail('foldWeaponAffix dropped the moveset')`.
- The §8a/§10a status/addStatus sweeps are UNCHANGED (no new status kind this slice — armor-break reuses
  the existing `stun`).

### Data flow (end to end)

1. Player equips a Hammer (slot 0) + Bow (slot 1, swap with R). Holds J → `chargeTimer` accrues; a
   `chargeReady` blip fires at 0.45s. Releases → `_startSwing({charged:true})` → a finisher swing at
   ×1.8 damage; on the first connecting hit `_onPlayerHitEnemy` reads the pending AoE → `_radialDamage`
   smashes + LONG-stuns every enemy within 120px (the armor-break stagger).
2. Swaps to the Bow (R). Taps J → a normal single shot (`pierceLeft=1`, dies on first hit — identity).
   Holds J past 0.5s, releases → a ×1.9 charged shot with `pierceLeft=3` → it passes through up to 3
   enemies in a line (`_onProjectileHitEnemy` decrements `pierceLeft`, releases at 0).
3. Equips a Spear. Holds J → a 4-hit flurry of fast long pokes (the drill); releasing ends it.
4. Equips a Sword. Combo 1→2→3 forward is byte-identical; holding DOWN at swing 3 → the ground-slam
   finisher (×harder knockback). No down held = the exact current finisher (identity).
5. An enemy winds up an attack → the player presses V just before impact → `parryTimer` is live → the hit
   is NEGATED, a "PARRY!" cue pops, `riposteTimer` arms → the next player hit deals ×1.5 (the riposte).

### Identity safety (the hard constraint)

- No attack-HOLD: `chargeTimer` never accrues (the release branch never fires); flurry never starts (it
  needs the hold to continue past poke #1); the edge `attack()` tap path is byte-identical.
- No DOWN held at the finisher: the finisher row is the current row verbatim.
- No parry press: `parryTimer`/`parryCooldownTimer`/`riposteTimer` stay 0; `onHit`'s parry branch is
  skipped (returns into the EXACT current code); `_mutationDamageMult`'s riposte fold is `riposteTimer===0`
  ⇒ no change; `isHittable()` is unchanged.
- A weapon with NO `moveset` (or the verifier's headless usage of the table) behaves exactly as today.
- Every new projectile call omits the `pierce` arg ⇒ `pierceLeft=1` ⇒ "dies on first hit" (identity).
- `weapons.ts` adds OPTIONAL plain-data fields only (no Phaser) ⇒ node-importable; the verifier's existing
  contracts are preserved verbatim and only EXTENDED for the optional fields.
- `LevelGenerator.ts` untouched ⇒ the level regression pin is unaffected. No new RNG read ⇒ the seed
  chain / biome-sequence determinism pins are unaffected.

## 7. Files Changed

- `src/config/weapons.ts` (PURE) — add `ChargeMode`/`FlurryMode`/`FinisherMode`/`PierceMode`/
  `WeaponMoveset` interfaces + `moveset?` on `WeaponSpec`; attach `moveset` to HAMMER/SPEAR/BOW/SWORD;
  one-line comment that `foldWeaponAffix` carries `moveset` via the spread (no fold logic change).
- `src/core/Input.ts` — bind `v: KC.V` (the ONLY new key); add `attackHeld` / `parryPressed` / `downHeld`
  to `InputSnapshot` + `sample()` (reusing the J/pointer HELD state + the reserved DOWN/S; sole-owned
  JustDown for V).
- `src/entities/Player.ts` — charge/flurry state machine (`chargeTimer`/`flurryShotsLeft`/`flurryTimer`);
  parry state (`parryTimer`/`parryCooldownTimer`/`riposteTimer`) + PARRY_*/RIPOSTE_*/FLURRY_LOCK consts;
  `onHit` parry-negation branch; `_startSwing(opts)` charged-damage + directional-finisher + pierce-arg;
  a `consumePendingAoe()` helper for the charged smash; the timer decays in `update`.
- `src/scenes/GameScene.ts` — read the pending charged AoE in `_onPlayerHitEnemy` → `_radialDamage`;
  the riposte fold in `_mutationDamageMult` (+ zero `riposteTimer` after a connecting hit); the parry cue
  in `_hurtPlayer` (DRY — all player-hit sites funnel through it); the pierce-aware release in
  `_onProjectileHitEnemy`; pass the charged `pierce` count when the player fires a charged bow shot
  (already routed via `_startSwing` → `projectilePool.acquire`).
- `src/combat/ProjectilePool.ts` — `pierceLeft` field on the context; an OPTIONAL trailing `pierce = 1`
  arg on `acquire`; reset it in `_disable`. No new pool object / overlap.
- `src/effects/Effects.ts` — `parry(x, y)` one-shot cue (reuses `spawnNumber` string value, like
  `statusApply`).
- `src/audio/Sound.ts` — `parry()` / `parrySuccess()` (+ optional `chargeReady()`) procedural blips
  (null-safe, no assets).
- `scripts/verify-gen.mjs` — extend §5d with the `moveset` well-formedness pass (preserving every current
  assertion verbatim) + a §10 one-liner that the fold preserves `moveset`.
- `src/scenes/HUDScene.ts` — none required (the weapon label already shows the active weapon name + affix;
  the moveset reads on-screen via the charge tint + the flurry/AoE/parry FX, not a HUD panel — YAGNI).
- `src/world/LevelGenerator.ts` — NOT MODIFIED (constraint).

## 8. Verification

1. `npm run typecheck` — passes (the new optional schema fields, the `InputSnapshot` additions, the
   `_startSwing(opts)`/`acquire(pierce)` signatures are all typed).
2. `npm run verify` — green: §5d preserves the non-empty-swings + 9-field + active/recovery +
   projectile-IFF-ranged contracts VERBATIM and the NEW `moveset` pass validates the four weapons' modes
   (a malformed mode fails loudly); §10 still proves `foldWeaponAffix` never mutates BASE / preserves the
   schema / never weakens damage, plus the new "fold keeps the moveset" check; the §8a/§10a status sweeps
   are unaffected (no new status kind); the level regression + determinism pins are untouched (no
   generator / RNG change).
3. Manual (`npm run dev`):
   - [AC4] Hammer: tap J → the current 2-hit combo; HOLD J ≥0.45s + release → a heavier smash that
     radial-stuns nearby enemies for longer (the armor-break stagger).
   - [AC5] Spear: HOLD J → a rapid 4-poke flurry that keeps the long reach; tap → a single thrust.
   - [AC6] Sword: combo 1→2→3 forward is unchanged; HOLD DOWN at the 3rd swing → a harder-knockback
     ground-slam finisher.
   - [AC7] Bow: tap J → a single shot (dies on first hit); HOLD J ≥0.5s + release → a charged shot that
     pierces a line of up to 3 enemies and hits harder.
   - [AC8] Press V just before an incoming hit → the hit is NEGATED + a "PARRY!" cue pops + the next hit
     deals ×1.5 (riposte); press V too early/late → you take the hit normally; V is gated by a cooldown.
   - [AC9] V collides with no existing binding; DOWN/S drive the finisher variant with no movement side
     effect (they were reserved-unused).
   - [AC10] Never hold the attack key, never hold DOWN at the finisher, never press V → the Sword forward
     combo / Spear tap / Bow tap / Hammer tap combo and player damage-taking are byte-identical to before.
