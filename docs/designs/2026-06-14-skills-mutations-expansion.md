# F3 Skills & Mutations — 3 new blueprint-gated SKILLS + 3 new blueprint-gated MUTATIONS

## 1. Background

The loadout layer (`src/config/skills.ts`) ships 6 skills today across the 3 known kinds — KNIVES /
ICE SHARDS (volley), FROST GRENADE / FIREBOMB / SHOCKWAVE (blast), TURRET (turret). SHOCKWAVE is the
ONE blueprint-gated skill; the other 5 are starters. The perk layer (`src/config/mutations.ts`) ships 11
mutations — 10 starters + GLASS CANNON (the ONE blueprint-gated one). Build variety is thin: no heavy
single-shot skill, no poison-cloud AoE, no piercing-volley; and the mutation pool has no "survive a lethal
hit", no "ramp on consecutive hits", no "more drops" perks.

**The entire skill + mutation layer is already data-driven — this slice adds NO new engine kind and only
ONE genuinely new live-read hook (Second Wind). Everything else reuses existing seams:**

- **Skills are kind-dispatched pure data.** `GameScene._useSkill` (`GameScene.ts:1605`) dispatches on
  `spec.kind` over `'volley' | 'blast' | 'turret'` (`skills.ts:34`), reusing `ProjectilePool` (volley),
  `_radialDamage` (blast), and `DeployablePool` (turret). A new skill that supplies the kind's params gets
  its behaviour for FREE. The fired damage is colour-scaled at use time (`m = colorMult(_colorLevel(spec.scaling))`,
  `GameScene.ts:1615`) — `colorMult(0) === 1` so a level-0 skill fires at spec damage (the identity).
- **`status` on a skill is pure data.** A volley shot stamps `spec.status` on the projectile; a blast
  applies it per target via `_applyHitStatus(_scaleStatus(status))` (`GameScene.ts:1676`); a turret stamps
  it on its shots. `bleed`/`poison`/`stun`/`burn` are all known (`STATUS_KINDS`, `verify-gen.mjs:1344`).
  So a CORROSIVE CLOUD whose `status` is `{kind:'poison',…}` poisons with ZERO new wiring.
- **Blueprint gating is the established pattern.** SHOCKWAVE (`skills.ts:151`) / GLASS CANNON
  (`mutations.ts:176`) are the precedents: a `blueprint` tag + a `BLUEPRINTS` catalog entry
  (`blueprints.ts:34-35`). `runSkillPool` / `runMutationPool` (`skills.ts:181`, `mutations.ts:198`) return
  starters ∪ unlocked-blueprint rows; with an empty set they return EXACTLY the starters (the identity pin,
  `verify-gen.mjs:1920-1921`).
- **The skill/mutation pools resolve once.** GameScene computes `this.skillPool = runSkillPool(unlocked)`
  and `this.mutationPool = runMutationPool(unlocked)` in `create()` (`GameScene.ts:350-351`). A newly-banked
  blueprint's row JOINS the skill pickup placement (`_maybePlaceSkillPickup`) and the seeded 3-of-N mutation
  offer (`_pickMutationOffers`) automatically.
- **Most mutation effects reuse existing run-only fields.** `_mutationDamageMult` (`GameScene.ts:2201`)
  folds `lowHpDamageMult`/`firstHitBonusMult`/`vsAfflictedDamageMult`/`riposteDamageMult` at both hit sites.
  `scrollDamageMult` is the flat-damage lever (read live at both hit sites). The enemy `onDeath` hook
  (`GameScene.ts:1841`) reads `onKillHealAmount` + `spreadAffliction`. The drop site (`enemy.onDrop` →
  `Pickup.spawnDrop`, `Pickup.ts:167`) already takes a `lootMult` the curse/room layer threads in. Adding a
  new mutation effect follows the documented pattern (`mutations.ts:16-23`): ONE neutral-default field on
  `MutationRunState`, ONE live read at a single GameScene site.

**What is missing:** only 1 of 6 skills and 1 of 11 mutations is blueprint-gated, and the named archetypes
don't exist. We add exactly 3 `SkillSpec` rows + 3 `MutationSpec` rows, all blueprint-gated, + 6 `BLUEPRINTS`
entries + the i18n. NO new skill kind, NO new combat math, ONE new live-read field+site (Second Wind) and
ONE new field+site (Momentum), and ONE drop-rate thread for Scavenger.

## 2. Requirements Summary

### Skills (3 new `SkillSpec` rows in `src/config/skills.ts`, all blueprint-gated, on EXISTING kinds)

- **THROWING AXE** — `id:'throwingaxe'`, `kind:'volley'`, `scaling:'brutality'`,
  `blueprint:'bp_skill_throwingaxe'`. A SINGLE heavy volley shot (`count:1`, `spread:0`) — a slow,
  high-damage thrown projectile (the brawler's ranged finisher). Longer cooldown than KNIVES. No status, OR
  a light bleed (optional). Reuses the `volley` dispatch verbatim (a 1-shot fan fires straight,
  `GameScene.ts:1627`).
- **CORROSIVE CLOUD** — `id:'corrosivecloud'`, `kind:'blast'`, `scaling:'tactics'`,
  `blueprint:'bp_skill_corrosivecloud'`. An instant radial blast + a POISON DoT to every enemy in range
  (`radius`, `damage`, `knockback`, `status:{kind:'poison', duration, tickInterval, tickDmg}`). The
  damage-over-time AoE (drop it on a pack and let the acid finish them). Reuses the `blast` dispatch
  verbatim.
- **LIGHTNING** — `id:'lightning'`, `kind:'volley'`, `scaling:'tactics'`,
  `blueprint:'bp_skill_lightning'`. A fast PIERCING volley — a few high-speed bolts that thread a line
  (`count ≥ 3`, tight `spread`, a fast `projectile`). The "piercing volley" is realised by tuning: a high
  `projectile.speed` + a tight fan so the bolts overlap a line of enemies (the ProjectilePool already
  resolves a shot against every overlapping enemy along its flight). No new pierce mechanic — KISS. A short
  cooldown. No status, OR a light stun (optional). NOTE: skill `volley` projectiles do NOT carry the weapon
  `pierce` moveset block (that is a weapon-only field); LIGHTNING's "piercing" identity is the fast
  multi-bolt line, not a per-shot pierce counter — keep it honest in the desc ("a fast bolt volley").

### Mutations (3 new `MutationSpec` rows in `src/config/mutations.ts`, all blueprint-gated)

- **SECOND WIND** — `id:'secondwind'`, `blueprint:'bp_mutation_secondwind'`. Survive ONE otherwise-lethal
  hit per biome (snap to a small HP floor instead of dying), then disarm until the next biome refreshes it.
  ONE new live-read field pair on `MutationRunState`: `secondWind` (the armed flag) — `apply()` sets it
  `true`. The "available this biome" charge is a SECOND RunState field, `secondWindAvailable`, reset to
  `secondWind` on each biome transition (the "once per biome" reset). Both default to the neutral identity
  (`false`) so a run with no Second Wind plays byte-identically.
- **MOMENTUM** — `id:'momentum'`, `blueprint:'bp_mutation_momentum'`. Damage RAMPS with consecutive hits
  inside a short window: each connecting player hit within `MOMENTUM_WINDOW` of the last bumps a stack
  (capped), and the per-hit damage scales by `1 + stacks × MOMENTUM_PER_STACK`. ONE new field on
  `MutationRunState`: `momentumPerStack` (0 = neutral; `apply()` raises it). The live stack counter + the
  window timer are SCENE-LOCAL transient state (NOT run-only — they are per-combat, like the riposte timer),
  read/folded in `_mutationDamageMult`. Defaults to the neutral identity (0) so a run with no Momentum is
  byte-identical (the `!== 0` guard skips the fold entirely).
- **SCAVENGER** — `id:'scavenger'`, `blueprint:'bp_mutation_scavenger'`. +gold/cell drop rate. ONE new
  field on `MutationRunState`: `dropRateMult` (1 = neutral; `apply()` raises it via `Math.max`). The single
  read site is the drop hook: thread it into `Pickup.spawnDrop` (which already takes `lootMult`) so the
  Cell count + gold/scroll roll scale by it. Defaults to 1 so a run with no Scavenger drops byte-identically.

### Blueprints + i18n + verifier

- **6 `BLUEPRINTS` catalog entries** in `src/config/blueprints.ts` (3 `kind:'skill'`, 3 `kind:'mutation'`,
  `id ===` each row's `blueprint` tag, name + one-line `desc`).
- **i18n (BOTH locales).** `src/i18n/zh-CN.ts` `skill:` map gains 3 rows, `mutation:` map gains 3 rows,
  `blueprint:` map gains 6 rows. `src/i18n/en.ts` needs NO content rows (English content lives in the config
  `name`/`desc` via the `tName`/`tDesc` `en` fallback — `en.ts:2-4`); the Hub `kind.skill`/`kind.mutation`
  chrome already exists.
- **Verifier green.** The existing `§11` skill sweep, `§12` mutation sweep, `§13c` catalog↔tags
  consistency, and `§13d` identity pins all cover the new rows. The mutation `§12b`/`§12c` never-weaken
  sweep gains coverage for the 3 NEW `MutationRunState` fields (`secondWind`/`momentumPerStack`/
  `dropRateMult`) — add their before/after assertions to the existing `§12` block.

### Identity (the hard constraint)

Every new skill + mutation carries a `blueprint` tag, so `runSkillPool(new Set())` and
`runMutationPool(new Set())` return EXACTLY today's starters (verifier `§13d`, `verify-gen.mjs:1920-1921`).
The 6 new rows are **dead config** in a default save: never placed by `_maybePlaceSkillPickup`, never
offered by `_pickMutationOffers`. Every new `MutationRunState`/`RunState` field defaults to the neutral
identity (`secondWind:false`, `secondWindAvailable:false`, `momentumPerStack:0`, `dropRateMult:1`), and
every new GameScene read is guarded so it is a no-op at the identity value. A default run's skill/mutation
offers, drops, damage, and HP behaviour are byte-for-byte unchanged. No level-layout RNG is involved (skill
placement + mutation offers already use the off-the-pin scene RNG; the drop site uses `Math.random`, off
the pinned generator draw — `Pickup.ts:156-159`).

### Non-goals (YAGNI)

- **No new skill KIND.** All 3 skills use `volley`/`blast`. `SKILL_KINDS` stays `['volley','blast','turret']`
  (the `§11` dead-kind check still passes — all 3 kinds remain used). No `trap`/`DeployablePool` new arm.
- **No new status KIND.** CORROSIVE CLOUD uses `poison` (already known + verifier-checked); LIGHTNING /
  THROWING AXE statuses (if any) reuse `stun`/`bleed`. `STATUS_KINDS` length pin is untouched.
- **No per-shot pierce mechanic for LIGHTNING.** Its "piercing" identity is the fast multi-bolt line via
  the existing volley dispatch; we do NOT add a `pierceLeft` to skill projectiles (that is a weapon-moveset
  field; adding it to skills is new engine — out of scope).
- **No starter (untagged) skill/mutation.** That would break the `runSkillPool/runMutationPool(new Set())`
  identity pins + seed-replay determinism — forbidden.
- **No new run-only field for Momentum's live stacks.** The stack count + window timer are per-combat
  transient SCENE state (like `player.riposteTimer`), NOT carried on RunState (a build's *capability*
  `momentumPerStack` is run-only; the *live ramp* is ephemeral). KISS — no RunState carry/reset for it.
- **No Hub/Shop layout work.** The Hub lists blueprints generically; 6 more rows render with no new code,
  no column re-alignment.
- **No new overlay / picker.** Mutations flow through the existing `MutationOverlay` 3-of-N; skills through
  the existing pickup. No UI work beyond i18n names.

## 3. Acceptance Criteria

1. **3 new `SkillSpec` rows in `src/config/skills.ts`**, each with a unique `id`, `name`, `desc`, a kind ∈
   `SKILL_KINDS`, a positive `cooldown`, a KNOWN `scaling` colour, the kind-specific fields present + numeric,
   and a `blueprint` tag:
   - `throwingaxe` — `kind:'volley'`, `scaling:'brutality'`, `cooldown` > KNIVES' 2.0 (e.g. 3.5),
     `count:1`, `spread:0`, a heavy `projectile` (high `damage`, decent `speed`/`knockback`/`lifetime`/
     `w`/`h`), `blueprint:'bp_skill_throwingaxe'`. Optional light `bleed` status (if present, well-formed:
     `duration > 0`, `tickInterval > 0`, `tickDmg > 0`).
   - `corrosivecloud` — `kind:'blast'`, `scaling:'tactics'`, `cooldown` (e.g. 6.0), `radius > 0`,
     `damage > 0`, numeric `knockback`, `status:{kind:'poison', duration > 0, tickInterval > 0, tickDmg > 0}`,
     `blueprint:'bp_skill_corrosivecloud'`.
   - `lightning` — `kind:'volley'`, `scaling:'tactics'`, `cooldown` (e.g. 3.0), `count ≥ 3`, a tight
     numeric `spread`, a FAST `projectile` (high `speed`, all `PROJ_FIELDS` numeric),
     `blueprint:'bp_skill_lightning'`. Optional light `stun` status (if present, `duration > 0`, no tick
     fields — a stun is non-damaging).
2. **3 new `MutationSpec` rows in `src/config/mutations.ts`**, each with a unique `id`/`name`/`desc` + a
   function `apply`, and a `blueprint` tag, each `apply()` strengthening exactly its field(s) (never-weaken):
   - `secondwind` — `apply: (run) => { run.secondWind = true }`. `blueprint:'bp_mutation_secondwind'`.
   - `momentum` — `apply: (run) => { run.momentumPerStack = Math.max(run.momentumPerStack, MOMENTUM_PER_STACK) }`.
     `blueprint:'bp_mutation_momentum'`.
   - `scavenger` — `apply: (run) => { run.dropRateMult = Math.max(run.dropRateMult, SCAVENGER_DROP_MULT) }`.
     `blueprint:'bp_mutation_scavenger'`.
   (`MOMENTUM_PER_STACK`/`SCAVENGER_DROP_MULT` are shared module constants in `mutations.ts` so the desc +
   the live read agree; mirror `LOW_HP_THRESHOLD`’s pattern, `mutations.ts:46`.)
3. **`MutationRunState` extended (`src/config/mutations.ts`).** Add `secondWind: boolean`,
   `momentumPerStack: number`, `dropRateMult: number` (plus the run-carried `secondWindAvailable: boolean`
   — see §4.4). Document each with its neutral default in the interface comment (the `mutations.ts:16-23`
   pattern). Also export `MOMENTUM_WINDOW` (the consecutive-hit window, s) + `MOMENTUM_MAX_STACKS` if the
   stack is capped, used by the scene fold.
4. **`RunState` extended + reset (`src/core/RunState.ts`).** `createRunState` seeds the new fields to the
   neutral identity: `secondWind:false`, `secondWindAvailable:false`, `momentumPerStack:0`, `dropRateMult:1`.
   They carry across level rebuilds (the persisted RunState object). The interface `RunState` declares them.
   (`secondWindAvailable` is reset to `secondWind` on a biome transition — wired in GameScene, §4.4.)
5. **6 `BLUEPRINTS` catalog entries in `src/config/blueprints.ts`** — `bp_skill_throwingaxe`,
   `bp_skill_corrosivecloud`, `bp_skill_lightning` (`kind:'skill'`) and `bp_mutation_secondwind`,
   `bp_mutation_momentum`, `bp_mutation_scavenger` (`kind:'mutation'`), each `id ===` the row's `blueprint`
   tag, with `name` + a one-line `desc`. Appended to `BLUEPRINTS`.
6. **GameScene wiring (`src/scenes/GameScene.ts`), each at ONE documented site:**
   - **Second Wind (the ONE new live hook).** In `_hurtPlayer` (`GameScene.ts:2079`), AFTER the curse/room
     mult is folded into `result.damage` and BEFORE `this.player.onHit(result)`: if the hit would be lethal
     (`this.player.hp - result.damage <= 0`) AND `this.runState.secondWindAvailable`, consume the charge
     (`secondWindAvailable = false`), clamp `result.damage` so the player survives at a small HP floor (e.g.
     `result.damage = max(0, player.hp - SECOND_WIND_FLOOR)`), and pop a one-shot FX (reuse
     `effects`/camera flash + a HUD/SFX cue). Guarded by `secondWindAvailable` so it is a no-op when no
     Second Wind is armed (the identity).
   - **Second Wind per-biome reset.** In `_continueTransition` (`GameScene.ts:1156`), inside the
     `if (rolled)` block (alongside the flask refill), reset `this.runState.secondWindAvailable =
     this.runState.secondWind` — re-arm the charge for the new biome. No-op within a biome / for an unarmed
     run.
   - **Second Wind initial arm.** `_applyMutation` (`GameScene.ts:2850`) calls the mutation's `apply()`
     then `_syncPlayerScrollStats()`/etc — after picking Second Wind, ALSO set
     `this.runState.secondWindAvailable = true` so the charge is live for the CURRENT biome immediately
     (a fresh pick is usable now, not only next biome). Mirror the existing post-apply sync.
   - **Momentum.** In `_mutationDamageMult` (`GameScene.ts:2201`), fold `(1 + stacks × momentumPerStack)`
     when `momentumPerStack !== 0`, reading a scene-local stack counter the two player-hit sites bump:
     `_onPlayerHitEnemy` (`GameScene.ts:2107`) and `_onProjectileHitEnemy` (`GameScene.ts:~2300`) increment
     the stack (capped at `MOMENTUM_MAX_STACKS`) + reset a window timer on each connecting hit; the window
     timer decays in `update()` and zeroes the stack when it lapses. `momentumPerStack` is mirrored onto the
     player in `_syncPlayerScrollStats` (like the other folds). Guarded by `!== 0` → no-op (identity).
   - **Scavenger.** In the `enemy.onDrop` hook (`GameScene.ts:1865`), multiply the `lootMult` arg passed to
     `spawnDrop` by `this.runState.dropRateMult` (or thread a separate arg — see §4.6). `dropRateMult === 1`
     → byte-identical drops (identity).
7. **Player field mirrors (`src/entities/Player.ts`).** Add `momentumPerStack` (mirrored from RunState in
   `_syncPlayerScrollStats`) alongside the existing perk mirrors (`Player.ts:234-243`), default 0 in the
   reset. (`secondWind`/`secondWindAvailable`/`dropRateMult` are read off RunState directly — no player
   mirror, mirroring `spreadAffliction` `Player.ts:241`.)
8. **Identity pins hold.** `runSkillPool(new Set())` returns no gated skill; `runMutationPool(new Set())`
   returns no gated mutation (verifier `§13d`, `verify-gen.mjs:1920-1921`). `runSkillPool(full).length ==
   starters + 3`; `runMutationPool(full).length == starters + 3`. A default save's offers/drops are
   byte-unchanged.
9. **i18n (BOTH locales).** `zh-CN.ts` `skill:` map gains `throwingaxe`/`corrosivecloud`/`lightning`
   `{name,desc}`; `mutation:` map gains `secondwind`/`momentum`/`scavenger` `{name,desc}`; `blueprint:` map
   gains the 6 `bp_*` `{name,desc}` rows. `en.ts` needs NO content rows (config `name`/`desc` is the English
   source). NO bare English UI literal added (any new FX uses an existing cue or a new i18n key in BOTH
   locales).
10. **Verifier sweep (`scripts/verify-gen.mjs`).** The `§11`/`§12`/`§13c`/`§13d` sweeps pass over the new
    rows with NO structural change EXCEPT: extend the `§12` mutation never-weaken sweep
    (`verify-gen.mjs:1734-1803`) with before/after + aggregate assertions for the 3 NEW `MutationRunState`
    fields (`secondWind` flag may only arm false→true; `momentumPerStack`/`dropRateMult` bigger-is-better,
    each ≥ its neutral identity in aggregate). Add them to the `before` snapshot, the per-mutation never-
    weaken checks, the `changed` test, and the aggregate block. Optionally update the final summary
    `console.log`.
11. **Build + verifier green.** `npm run verify` exits 0 and the Vite/tsc build passes. The level
    regression pin + the determinism deep-equal are unchanged (no new field touches level layout; the
    verifier's `createRunState` determinism walk seeds all new fields to the neutral identity).

## 4. Numbered Decisions

1. **Every new skill + mutation is BLUEPRINT-GATED — copy the SHOCKWAVE / GLASS CANNON precedent exactly.**
   A `blueprint` tag + a matching `BLUEPRINTS` entry. MANDATORY: an untagged starter breaks the
   `runSkillPool/runMutationPool(new Set())` identity pins (`§13d`) and seed-replay determinism. The 6 rows
   are dead config until banked → a default save is byte-identical.

2. **Reuse the existing skill KINDS — no new kind, no new dispatch arm.** THROWING AXE + LIGHTNING = `volley`;
   CORROSIVE CLOUD = `blast`. `SKILL_KINDS` is untouched (the `§11` dead-kind check still passes). The
   integration map allowed a new `trap` kind via DeployablePool but explicitly prefers existing kinds — we
   take that (KISS). Distinctness comes from the kind+param TUNING, not a new mechanic:
   - THROWING AXE vs KNIVES: `count:1` heavy single shot (vs the 3-knife fan), `scaling:'brutality'` (vs
     tactics), a much longer cooldown + far higher per-shot damage. The brawler ranged finisher.
   - CORROSIVE CLOUD vs FROST GRENADE / FIREBOMB: a POISON DoT (vs stun / bleed) — the acid-pool identity.
   - LIGHTNING vs ICE SHARDS: a fast tight bolt-line (high `speed`, narrow `spread`) vs a wide freezing
     spray. The line-clear poke. Both `volley`+`tactics` but tuned oppositely (line vs spread; speed vs CC).

3. **CORROSIVE CLOUD uses `poison` — a known status kind.** `STATUS_KINDS` already includes
   bleed/poison/stun/burn (`verify-gen.mjs:1344`); the `§11` skill status sweep validates a damaging kind
   (poison) needs `tickInterval > 0 && tickDmg > 0`. No new status kind (the pin is untouched).

4. **Second Wind = one flag (capability) + one charge (per-biome) — the documented single-field pattern.**
   - `MutationRunState.secondWind: boolean` (false = neutral) — the CAPABILITY a Second Wind pick arms.
   - `RunState.secondWindAvailable: boolean` (false = neutral) — the per-biome CHARGE. Reset to `secondWind`
     on each biome transition (`_continueTransition`'s `if (rolled)` block, alongside the flask refill — the
     existing per-biome reset seam) and armed `true` immediately on pick (`_applyMutation`).
   - The ONE live read: `_hurtPlayer` intercepts an otherwise-lethal hit BEFORE `player.onHit`, clamping
     damage so the player survives at `SECOND_WIND_FLOOR` HP and consuming the charge. `_hurtPlayer` is the
     SINGLE player-damage point all four hit sites funnel through (`GameScene.ts:2071`) — exactly one site,
     and it leaves `Player.onHit` byte-identical (no Player.ts logic change; only a field mirror). When
     `secondWindAvailable` is false the branch is skipped → byte-identical (identity).
   This matches the integration map ("a flag + a once-per-biome reset"). KISS: no death-undo on the
   `player.dead` path — we intercept BEFORE the lethal `onHit`, so the player never enters the death edge.

5. **Momentum's live ramp is SCENE-LOCAL transient state, not run-only.** The build CAPABILITY
   (`momentumPerStack`) is run-only (carried/reset like every perk field). The live STACK count + window
   timer are per-combat ephemeral (they reset constantly), exactly like `player.riposteTimer`
   (`Player.ts:326`) — so they live as scene fields, bumped at the two player-hit sites and decayed in
   `update()`. This keeps RunState lean (no carry/reset churn for a value that resets every second) and
   keeps the fold local to `_mutationDamageMult`. `momentumPerStack === 0` → the fold is skipped → identity.
   The stack is CAPPED (`MOMENTUM_MAX_STACKS`) so the ramp is bounded (never-weaken-safe: it only ever
   multiplies UP, ≥ 1×).

6. **Scavenger threads `dropRateMult` into the EXISTING `spawnDrop(lootMult)` seam.** The drop hook
   (`enemy.onDrop`, `GameScene.ts:1865`) already multiplies a `lootMult` (the room/curse richness) into the
   Cell count + gold drop inside `spawnDrop` (`Pickup.ts:167-171`). Scavenger composes multiplicatively:
   pass `this.roomType?.lootMult ?? 1) * this.runState.dropRateMult` as the `lootMult` arg (or add a
   distinct `dropRateMult` param to `spawnDrop` and apply it to the cell count + gold/scroll roll — EITHER
   is fine; folding into `lootMult` is the DRY choice with the fewest edits). It scales the cell count + the
   gold amount; to also raise the GOLD/SCROLL *chance*, apply the mult to the `Math.random()` thresholds in
   `spawnDrop` (a small extension to the existing function). `dropRateMult === 1` → byte-identical drops.
   The drop site uses `Math.random` (NOT the seeded generator draw) so this never touches the level pin.

7. **`momentumPerStack` is mirrored onto the Player; the others are read off RunState.** Follow the existing
   split: hit-site folds read player mirrors (`lowHpDamageMult`/`firstHitBonusMult`/`vsAfflictedDamageMult`),
   so `momentumPerStack` mirrors in `_syncPlayerScrollStats` (`GameScene.ts:2415`). `secondWind`/
   `secondWindAvailable` (read in `_hurtPlayer`/`_continueTransition`) and `dropRateMult` (read in the
   `onDrop` hook) are read off `runState` directly — no player mirror — mirroring `spreadAffliction`
   (`GameScene.ts:1854`, `Player.ts:241`). KISS — read where it's used.

8. **Tuning is monotone-safe by construction.** A skill/mutation row is player power, not on any
   difficulty/cost curve. Each new mutation `apply()` only strengthens its field (`= true` /
   `Math.max(..., k)`), so the `§12` never-weaken sweep passes. Each new skill fires at spec damage at
   colour level 0 (`colorMult(0) === 1`), preserving the identity. The new RunState fields default to the
   neutral identity, so the verifier's determinism + monotonicity walks (which never pick a mutation) are
   unaffected.

9. **NO new verifier SECTION; extend `§12` only.** The `§11` skill sweep iterates `SKILLS` (covers the 3
   new rows: kind/colour/cooldown/params/status). `§13c` builds tag→kind from the resolvers (covers the 6
   new tags ↔ catalog entries, both ways). `§13d` re-asserts the empty-set identity pins (the new rows MUST
   be excluded by their tag — guaranteed). The `§12` mutation sweep already iterates `MUTATIONS` for
   well-formedness; it needs the 3 NEW `MutationRunState` fields added to its before/after never-weaken +
   aggregate checks (the only structural verifier edit). This is the cleanest change: pure-data additions
   the CI gate already polices, plus one field-coverage extension.

## 5. Integration Map (files the implementer will touch)

- **`src/config/skills.ts`** — add 3 `SkillSpec` rows (`throwingaxe`/`corrosivecloud`/`lightning`), each
  blueprint-gated, mirroring the SHOCKWAVE precedent (`skills.ts:151`). No change to `SkillKind`,
  `SKILL_KINDS`, `runSkillPool`, or the interface (the optional params already exist). House-style comments.
- **`src/config/mutations.ts`** — add 3 `MutationSpec` rows (`secondwind`/`momentum`/`scavenger`), each
  blueprint-gated (the GLASS CANNON precedent, `mutations.ts:176`). Extend the `MutationRunState` interface
  with `secondWind`/`momentumPerStack`/`dropRateMult` (+ document their neutral defaults). Add the shared
  constants `MOMENTUM_PER_STACK` / `MOMENTUM_WINDOW` / `MOMENTUM_MAX_STACKS` / `SCAVENGER_DROP_MULT` /
  `SECOND_WIND_FLOOR` (mirror `LOW_HP_THRESHOLD`, `mutations.ts:46`). No change to `runMutationPool`.
- **`src/core/RunState.ts`** — extend the `RunState` interface with `secondWind`/`secondWindAvailable`/
  `momentumPerStack`/`dropRateMult`; seed them to the neutral identity in `createRunState`
  (`RunState.ts:228+`, in the MUTATION-perk block). They carry across rebuilds (the persisted object);
  `secondWindAvailable` is RESET on biome transition by GameScene (not in RunState — kept where the other
  per-biome resets live).
- **`src/scenes/GameScene.ts`** — wire the 5 hook touches (Decision 6): the `_hurtPlayer` Second Wind
  interception (`:2079`); the `_continueTransition` per-biome reset (`:1156`, the `if (rolled)` block); the
  `_applyMutation` initial arm (`:2850`); the `_mutationDamageMult` Momentum fold + the two hit-site stack
  bumps + the `update()` window decay (`:2201`, `:2107`, `:~2300`); the `enemy.onDrop` Scavenger thread
  (`:1865`). Mirror `momentumPerStack` in `_syncPlayerScrollStats` (`:2415`). Reuse existing FX/SFX for the
  Second Wind cue (or a new i18n-keyed HUD pop, both locales).
- **`src/entities/Player.ts`** — add a `momentumPerStack` field (declaration + reset to 0 +
  `_syncPlayerScrollStats` mirror), alongside the existing perk mirrors (`Player.ts:234-243`). No `onHit`
  logic change (Second Wind is intercepted in `_hurtPlayer`, leaving `onHit` byte-identical).
- **`src/entities/Pickup.ts`** — extend `spawnDrop` to apply the drop-rate mult (either fold into the
  existing `lootMult` arg at the call site, OR add a `dropRateMult` param scaling the cell count + the
  gold/scroll chance + amount). Default 1 → byte-identical (`Pickup.ts:167`).
- **`src/config/blueprints.ts`** — append 6 `BlueprintEntry` rows (3 `kind:'skill'`, 3 `kind:'mutation'`)
  with ids matching the tags. `BLUEPRINTS_BY_ID`/`BLUEPRINT_IDS` derive automatically (`blueprints.ts:32`).
- **`src/i18n/zh-CN.ts`** — add 3 `skill:` rows, 3 `mutation:` rows, 6 `blueprint:` rows (`zh-CN.ts:204`/
  `:219`/the `blueprint:` map). The English source is the config `name`/`desc`.
- **`src/i18n/en.ts`** — NO content rows required (config `name`/`desc` is the English source via the
  `tName`/`tDesc` `en` fallback, `en.ts:2-4`). If a NEW HUD/FX string is added for Second Wind, add its key
  to BOTH `en.ts` AND `zh-CN.ts` (no bare English literal).
- **`scripts/verify-gen.mjs`** — extend the `§12` mutation never-weaken sweep (`:1734-1803`) for the 3 new
  `MutationRunState` fields (before snapshot + per-mutation never-weaken + `changed` test + aggregate). No
  other structural change. Optionally extend the final summary `console.log`.

## 6. Identity-Preservation Checklist (the implementer MUST verify)

- [ ] Every new skill + mutation carries a `blueprint` tag → `runSkillPool(new Set())` /
      `runMutationPool(new Set())` return NO gated row (verifier `§13d`, `:1920-1921`).
- [ ] `runSkillPool(full).length` and `runMutationPool(full).length` each grew by exactly 3.
- [ ] Each `bp_skill_*` / `bp_mutation_*` tag maps 1:1 to a `BLUEPRINTS` entry of the matching kind, and
      vice-versa (verifier `§13c` — no orphan tag, no orphan catalog entry).
- [ ] `SKILL_KINDS` is unchanged (`['volley','blast','turret']`); all 3 kinds remain used (verifier `§11`
      dead-kind check).
- [ ] `STATUS_KINDS` is unchanged (CORROSIVE CLOUD reuses `poison`; any optional statuses reuse
      `bleed`/`stun`).
- [ ] Every new skill's `scaling` is a known colour (`brutality`/`tactics`); fires at spec damage at level
      0 (`colorMult(0) === 1`).
- [ ] New `MutationRunState`/`RunState` fields default to the neutral identity (`secondWind:false`,
      `secondWindAvailable:false`, `momentumPerStack:0`, `dropRateMult:1`) in `createRunState`; carried
      across level rebuilds.
- [ ] Each new mutation `apply()` only strengthens its field (flag false→true; mults via `Math.max`/`=`);
      the `§12` never-weaken sweep (extended for the 3 new fields) passes; each mutation changes ≥1 field.
- [ ] `_hurtPlayer` is byte-identical when `secondWindAvailable` is false; `_mutationDamageMult` is
      byte-identical when `momentumPerStack === 0`; the drop site is byte-identical when `dropRateMult === 1`.
- [ ] `Player.onHit` is byte-identical (Second Wind intercepts in `_hurtPlayer`, not in onHit).
- [ ] A default save (no blueprints banked) never offers/places/applies a new skill or mutation; offers,
      drops, damage, and HP behaviour are byte-unchanged; the level regression pin + determinism deep-equal
      are untouched (no new field touches level layout; the verifier's determinism walk seeds all new fields
      to the neutral identity).
- [ ] Both locales: `zh-CN.ts` `skill:`/`mutation:`/`blueprint:` gain 3/3/6 rows; the Hub renders the 6 new
      blueprint rows with no layout change.

## 7. Verifier Notes (the CI gate)

No new section; the new rows are exercised by EXISTING sweeps, plus one field-coverage extension to `§12`:

- **`§11` (`verify-gen.mjs:1640-1699`)** — iterates `SKILLS`: each row's `kind ∈ SKILL_KINDS`, `cooldown >
  0`, `scaling` a known colour, `SKILLS_BY_ID` resolves it, the kind-specific fields present + numeric
  (volley: `count > 0` + numeric `spread` + a `projectile` with `PROJ_FIELDS` numeric; blast: `radius > 0`
  + `damage > 0` + numeric `knockback`), and an optional `status` references a known kind with `duration >
  0` (a damaging poison needs `tickInterval > 0 && tickDmg > 0`). All 3 kinds stay used (the dead-kind
  check).
- **`§12` (`verify-gen.mjs:1709-1804`)** — iterates `MUTATIONS` for well-formedness + the never-weaken
  sweep. EXTEND the `before` snapshot, the per-mutation never-weaken checks, the `changed` test, and the
  aggregate block with the 3 NEW fields: `secondWind` (a flag — may only go false→true, never true→false),
  `momentumPerStack` (bigger-is-better, ≥ 0 / ≥ neutral 0 in aggregate), `dropRateMult` (bigger-is-better,
  ≥ neutral 1 in aggregate). NOTE: the sweep uses `createRunStateForScrolls` (= `createRunState`,
  `verify-gen.mjs:74`), so the new RunState defaults must be present for the snapshot to read them.
- **`§13c` (`verify-gen.mjs:1850-1901`)** — builds `tag→kind` from `runSkillPool(full)` /
  `runMutationPool(full)` minus the empty-set pools; asserts each new `bp_skill_*` / `bp_mutation_*` maps
  1:1 to a `BLUEPRINTS` entry of `kind:'skill'`/`'mutation'` (no orphan tag, no orphan entry).
- **`§13d` (`verify-gen.mjs:1920-1937`)** — `runSkillPool(new Set())` has no gated skill;
  `runMutationPool(new Set())` has no gated mutation; starters + gated == full for each; a one-blueprint set
  adds exactly the named row.

OPTIONAL: extend the final summary `console.log` (`:2211`) to note the wider skill/mutation pools. Run
`npm run verify` (must exit 0) and the build (`tsc`/Vite) after the edit.
