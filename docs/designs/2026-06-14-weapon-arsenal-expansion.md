# F2 Weapon Arsenal — 4 new blueprint-gated weapons, each a DISTINCT playstyle via the existing moveset system

## 1. Background

The game ships 5 weapons today (`src/config/weapons.ts`): SWORD (balanced melee, directional finisher),
HAMMER (heavy melee, charge smash + stun), BOW (ranged, charge + pierce + poison), SPEAR (long poke,
flurry + bleed), and GLAIVE (the ONE blueprint-gated reach weapon). Build variety is thin — there is no
fast assassin melee, no slow heavy ranged, no freeze/lockdown ranged, no AoE-stun melee.

The entire playstyle layer is **already data-driven** — this slice adds NO engine code:

- **The moveset system is pure data the Player reads.** `WeaponSpec.moveset` carries optional
  `charge` / `flurry` / `finisher` / `pierce` blocks (`weapons.ts:79`). `Player.update`
  (`Player.ts:541+`) branches on `this.equippedWeapon.moveset?.charge` / `?.flurry` and runs the
  charge/flurry machine; `Player._startSwing` (`Player.ts:783+`) bakes `charge.damageMult` into the
  swing, arms the `_pendingAoe` from `charge.aoeRadius`/`chargeStunDuration` (the melee smash), and for
  ranged sets `pierceLeft = pierce.maxTargets` on the fired projectile. A NEW weapon that supplies these
  blocks gets the playstyle for FREE.
- **Status-on-hit is pure data too.** `WeaponSpec.status` (a `{kind,duration,…}`). On a MELEE hit
  GameScene applies `this.player.equippedWeapon.status` via `_applyHitStatus`/`_scaleStatus`
  (`GameScene.ts:2146`). On a PROJECTILE hit it applies the shot's stamped `pj.status`
  (`GameScene.ts:2315`) — `Player._startSwing` stamps `weapon.status` onto the projectile at
  `acquire` (`Player.ts:849`). So a Frost Wand whose `status` is `{kind:'stun',…}` STUNS on its
  projectile hit with ZERO new wiring, and a Flail whose `status` is `{kind:'stun',…}` stuns on its
  melee hit + its charged AoE stuns through the existing `_pendingAoe` → `_radialDamage` path
  (`GameScene.ts:2125-2140`).
- **`stun` is already a known status kind** (`STATUS_KINDS` includes bleed/poison/stun/burn —
  `verify-gen.mjs:1344`), with `makeStatus`/`applyStatus`/`tickStatuses` handling it. The Frost Wand
  and Flail reuse it — no new status kind needed (YAGNI).
- **Blueprint gating is the established pattern.** GLAIVE (`weapons.ts:279`) is the precedent: a
  `blueprint: 'bp_weapon_glaive'` tag + a `BLUEPRINTS` catalog entry (`blueprints.ts:33`). `runWeaponPool`
  (`weapons.ts:318`) returns starters ∪ unlocked-blueprint rows; with an empty set it returns EXACTLY
  the 4 starters in the pinned order `['hammer','bow','sword','spear']` (verifier `§13d`,
  `verify-gen.mjs:1908-1918`).
- **The fold carries everything through.** `foldWeaponAffix` (`weapons.ts:423`) ref-copies `moveset`,
  `scaling`, and (when no `addStatus`) `status` via the `...weapon` spread, and deep-clones
  `swings`/`projectile` with the affix mults. A new weapon's moveset/status/scaling ride this unchanged.
- **The pickup/drop pool resolves once.** GameScene computes `this.weaponPool = runWeaponPool(unlocked)`
  in `create()` (`GameScene.ts:349`); `_maybePlaceWeaponPickup` / `_placeBranchReward` / the cursed-chest
  loot all draw `pool.filter(id => id !== equipped)` then `pool[floor(rng()*len)]`
  (`GameScene.ts:1922`, `:2039`, `:2528`). A newly-unlocked weapon JOINS these draws automatically.

What is **missing**: only 1 of the 5 weapons is blueprint-gated, and the 4 archetypes the integration map
names (assassin / heavy ranged / freeze / AoE-stun) don't exist. We add exactly 4 new `WeaponSpec` rows +
4 `BLUEPRINTS` entries + the i18n names. NO engine, NO new moveset/status mode, NO new combat math.

## 2. Requirements Summary

- **4 new `WeaponSpec` rows in `src/config/weapons.ts`**, each BLUEPRINT-GATED (a `blueprint` tag), each a
  DISTINCT playstyle reusing the existing moveset/status modes (copy the GLAIVE gating precedent exactly):
  - **TWIN DAGGERS** — melee / `scaling:'brutality'` — the fastest, lowest-commit combo (short reach,
    snappy actives, generous chain) PLUS a hold-to-`flurry` (the assassin's rapid stab string). A light
    bleed status. The backstab assassin (backstab already doubles damage on a finisher via `resolveHit`).
  - **CROSSBOW** — ranged / `scaling:'tactics'` — slow, heavy, high-damage bolt: a long recovery (low
    fire-rate), a big-damage `projectile`, `charge` (×damageMult) + `pierce` (threads a line). The
    deliberate sniper to the Bow's poke-and-poison.
  - **FROST WAND** — ranged / `scaling:'tactics'` — `charge` (×damageMult) applying a STUN/freeze:
    `status:{kind:'stun', duration:…}` stamped on the projectile (lockdown control). Lower raw damage,
    its value is the freeze.
  - **FLAIL** — melee / `scaling:'brutality'` — heavy `charge` AoE smash (`aoeRadius` + a long
    `chargeStunDuration` armor-break) PLUS a base `status:{kind:'stun',…}` on hit. The crowd-stagger
    bruiser (distinct from the Hammer's single-target stagger by the wider AoE identity).
- **4 `BLUEPRINTS` catalog entries** in `src/config/blueprints.ts` (kind `'weapon'`, `id ===` each
  weapon's `blueprint` tag, with name + one-line `desc`).
- **i18n names** in `src/i18n/en.ts` (English source lives in the config `name` strings; only the Hub
  blueprint chrome is in `en.ts` — already present) and `src/i18n/zh-CN.ts` (the `weapon:` + `blueprint:`
  content maps gain 4 rows each).
- **The verifier stays green** — the `§5d` weapon well-formedness + moveset sweep, the `§8a` status sweep,
  the `§13c` blueprint catalog ↔ tags consistency, and the `§13d` `runWeaponPool(new Set())` identity pin
  all pass with the 4 new gated rows. The `§6d` 4-weapon-richness count still holds (we GROW the count).

### Identity (the hard constraint)

Each new weapon carries a `blueprint` tag, so `runWeaponPool(new Set())` returns EXACTLY the 4 untagged
starters in the pinned order `['hammer','bow','sword','spear']` — UNCHANGED (verifier `§13d`,
`verify-gen.mjs:1915-1918`). The 4 new rows are **dead config** in a default save: never drawn by
`_maybePlaceWeaponPickup` / `_placeBranchReward` / the cursed chest, never in the starting pool. A default
save's run pool === the pre-slice pool, byte-for-byte. The new rows append to `WEAPON_ORDER` AFTER the
starters and AFTER GLAIVE, so the starter prefix the empty-set resolver filters out of is untouched, and
the empty-set pool order pin holds. `createRunState` / the seeded generator / the determinism walk never
touch these weapons (they only appear once a blueprint is banked). No level-layout RNG is involved (a
weapon row is pure config; placement uses the existing off-the-pin scene RNG, unchanged).

### Non-goals (YAGNI)

- **No new moveset MODE.** Every new weapon composes existing `charge`/`flurry`/`finisher`/`pierce` +
  `status` blocks. No new mechanic in `WeaponMoveset` / Player / GameScene.
- **No new status KIND.** Freeze/stun reuse `kind:'stun'` (already known + verifier-pinned). We do NOT
  add a separate `freeze` kind — `stun` IS the lockdown (KISS; the `STATUS_KINDS.length === 4` pin would
  otherwise need a deliberate bump, which this slice does not require).
- **No new weapon affix / rarity / colour.** The 4 weapons scale via existing colours
  (`brutality`/`tactics`) and roll existing affixes through the unchanged fold.
- **No starter (untagged) weapon.** Adding an untagged row would break the `runWeaponPool(new Set())`
  identity pin + seed-replay determinism — forbidden by the project invariants.
- **No Hub/Shop layout work.** The Hub already lists blueprints from `BLUEPRINTS` generically (kind ·
  name · LOCKED/UNLOCKED); 4 more rows render with no new code. No column re-alignment.
- **No starting-weapon upgrade for the new weapons.** They are found/unlocked, not a `START_WEAPON` tier
  (KISS — matches GLAIVE).
- **No new projectile pool / no engine change.** Crossbow/Frost-Wand reuse the player `ProjectilePool`
  (`projectile` spec + the stamped-status acquire path).

## 3. Acceptance Criteria

1. **4 new `WeaponSpec` rows in `src/config/weapons.ts`**, each with a unique `id`, a `name`, a `type`
   (`'melee'`/`'ranged'`), a KNOWN `scaling` colour, a well-formed non-empty `SwingRow[]`, a `blueprint`
   tag, and (where ranged) a well-formed `projectile`. Specifically:
   - **`TWIN_DAGGERS`** — `id:'daggers'`, `type:'melee'`, `scaling:'brutality'`,
     `blueprint:'bp_weapon_daggers'`. A 2–3 row combo with the SHORTEST reach + FASTEST actives/recovery
     of any melee (lowest commit), generous `comboWindow`, low per-hit damage. `moveset.flurry`
     (`hits ≥ 2`, `interval > 0`) — the rapid stab string. A light `status:{kind:'bleed', duration,
     tickInterval, tickDmg}` (assassin chip). NO `charge` (a weapon picks at most one of charge/flurry —
     `verify-gen.mjs:1065` allows both blocks structurally but the Player gates flurry only when no charge;
     follow SPEAR — flurry only).
   - **`CROSSBOW`** — `id:'crossbow'`, `type:'ranged'`, `scaling:'tactics'`,
     `blueprint:'bp_weapon_crossbow'`. One "draw" swing row gating a SLOW cadence (long `recovery`, larger
     than the Bow's), with the cosmetic-marker placeholders well-formed (`active > 0`, `recovery ≥ 0`, all
     `SWING_FIELDS` numeric). A heavy `projectile` (high `damage`, decent `speed`/`knockback`, sane
     `lifetime`/`w`/`h`). `moveset.charge` (`chargeTime > 0`, `damageMult ≥ 1`, NO melee-only
     `aoeRadius`/`chargeStunDuration`) + `moveset.pierce` (`maxTargets ≥ 2`). NO status (raw power is its
     identity), OR an optional light status if desired — but NOT required.
   - **`FROST_WAND`** — `id:'frostwand'`, `type:'ranged'`, `scaling:'tactics'`,
     `blueprint:'bp_weapon_frostwand'`. One draw row (moderate cadence), a `projectile` with LOWER damage
     than the Crossbow (its value is control), `moveset.charge` (`chargeTime > 0`, `damageMult ≥ 1`, ranged
     — NO melee-only charge fields), and `status:{kind:'stun', duration}` (the freeze; `duration > 0`, no
     tick fields — a stun is non-damaging, `verify-gen.mjs:1354`). MAY also carry `moveset.pierce` (a
     freeze that threads a line) — optional. NO `aoeRadius`/`chargeStunDuration` (those are melee-only and
     the verifier rejects them on a ranged weapon, `verify-gen.mjs:1073`).
   - **`FLAIL`** — `id:'flail'`, `type:'melee'`, `scaling:'brutality'`, `blueprint:'bp_weapon_flail'`. A
     heavy 2-row combo (big damage/knockback, committed recovery — like the Hammer but with a wider AoE
     identity). `moveset.charge` with `aoeRadius > 0` (the AoE smash) and `chargeStunDuration ≥ 0` (a long
     armor-break, e.g. `≥ 1.0`), `damageMult ≥ 1`, `chargeTime > 0`. A base `status:{kind:'stun', duration}`
     on every hit (the crowd-stagger). NO `projectile` (melee).
2. **4 `BLUEPRINTS` catalog entries in `src/config/blueprints.ts`** — one per weapon, `kind:'weapon'`,
   `id ===` the weapon's `blueprint` tag (`bp_weapon_daggers`, `bp_weapon_crossbow`, `bp_weapon_frostwand`,
   `bp_weapon_flail`), each with a `name` + a one-line `desc`. Appended to `BLUEPRINTS` after the existing
   3 entries (catalog order does not matter to the verifier, only consistency).
3. **`WEAPONS` lookup + `WEAPON_ORDER` updated.** Add each new const to `WEAPONS` (so a banked blueprint
   can equip it by id) and APPEND each to `WEAPON_ORDER` AFTER the 4 starters AND after `GLAIVE` (the
   gated rows trail the starter prefix). The empty-set resolver still returns the starter prefix
   `['hammer','bow','sword','spear']` in order (the order pin), so the append is identity-safe.
4. **Identity pin holds.** `runWeaponPool(new Set())` deep-equals `['hammer','bow','sword','spear']`
   (verifier `§13d`). `runWeaponPool(fullUnlock).length === WEAPON_ORDER.length` (= 9). A default save's
   starter pool is byte-unchanged.
5. **Each new weapon plays distinctly when unlocked.** Unlocking a weapon's blueprint adds its id to
   `this.weaponPool` (via `runWeaponPool`), so it appears in run drops. In-game: Daggers flurry on hold;
   Crossbow charges a heavy piercing bolt; Frost Wand's charged shot stuns; Flail's charged smash AoE-stuns
   + every Flail hit stuns. All via the existing Player/GameScene paths (no engine change).
6. **Verifier green (NO new section needed — the sweeps generalize).** The existing `§5d` weapon +
   moveset sweep, `§8a` status sweep, `§13c` blueprint catalog ↔ tags consistency (both ways), and `§13d`
   identity pin all pass over the 4 new rows. `§6d` (`WEAPON_ORDER.length ≥ 4`) still passes (count grows
   to 9). Optionally update the final summary `console.log` to mention the wider arsenal.
7. **i18n (BOTH locales).**
   - `src/i18n/zh-CN.ts` `weapon:` map gains `daggers`/`crossbow`/`frostwand`/`flail` `{ name }` rows.
   - `src/i18n/zh-CN.ts` `blueprint:` map gains the 4 `bp_weapon_*` `{ name, desc }` rows.
   - `src/i18n/en.ts` needs NO content rows (English comes from the config `name`/`desc` via `tName`/
     `tDesc`'s `en` fallback — confirmed `en.ts:2-4`); the Hub `kind.weapon` chrome already exists. The
     English `name`/`desc` ARE the source strings in `weapons.ts`/`blueprints.ts`.
8. **Build + verifier green.** `npm run verify` and the Vite/tsc build pass. The level regression pin and
   the determinism deep-equal are unchanged (no weapon touches level layout).

## 4. Numbered Decisions

1. **Every new weapon is BLUEPRINT-GATED — copy the GLAIVE precedent exactly.** A `blueprint` tag +
   a matching `BLUEPRINTS` entry. This is MANDATORY: an untagged starter would break the
   `runWeaponPool(new Set())` identity pin (`§13d`) and seed-replay determinism. The 4 rows are dead config
   until banked, so a default save is byte-identical.

2. **Reuse the existing moveset MODES — no new mode.** Daggers = `flurry` (like Spear). Crossbow =
   `charge` + `pierce` (like Bow, but slower/heavier). Frost Wand = `charge` + `status:stun` (charge like
   Bow, status on the projectile like Bow's poison). Flail = `charge` with `aoeRadius` + `chargeStunDuration`
   (like Hammer) + a base `status:stun`. Each is a DISTINCT *combination/tuning* of existing modes — the
   "distinct playstyle" requirement is met by the mode mix + stat tuning, not by new mechanics (KISS/YAGNI).

3. **Freeze == `stun` — no new status kind.** The integration map says "applies a STUN/freeze status";
   `stun` already exists and is verifier-pinned (`STATUS_KINDS.length === 4`). Adding a `freeze` kind would
   require a deliberate pin bump (`verify-gen.mjs:1344`) and new status.js handling — unjustified (a stun
   IS a freeze: the enemy can't act). The Frost Wand's identity is a LONGER stun + the ranged delivery, not
   a different kind. (If a future slice wants a slowing/chilled DoT distinct from a full stun, that is a
   separate deliberate pin update — explicitly out of scope here.)

4. **Distinguish each new weapon from its nearest existing sibling by TUNING, not gimmick.**
   - Daggers vs Sword: shorter reach, faster actives, lower per-hit damage, + a flurry (Sword has none) +
     a bleed (Sword has none). The fastest low-commit melee → leans on backstab (the existing
     `resolveHit` finisher double-damage) for the assassin payoff.
   - Crossbow vs Bow: much slower cadence (long recovery), much higher projectile damage, charge+pierce
     (same modes) but NO poison — raw single-volley punch vs the Bow's tag-and-kite poison.
   - Frost Wand vs Bow: charge applies STUN (control) instead of poison (DoT); lower damage. A lockdown
     tool, not a damage tool.
   - Flail vs Hammer: a base stun on EVERY hit + a charged AoE stun with a wider `aoeRadius` (crowd
     control) — the Hammer is single-target stagger; the Flail is the crowd-stagger bruiser.

5. **Append the new rows AFTER the starters AND after GLAIVE in `WEAPON_ORDER`.** The empty-set resolver
   filters `!w.blueprint`, returning the starter prefix in its pinned order; gated rows never appear there,
   so their position (after GLAIVE) cannot affect the identity pin. The FULL pool's order is NOT pinned, so
   the append order among gated rows is free. Keep `[HAMMER, BOW, SWORD, SPEAR, GLAIVE, <4 new>]` — the
   starter prefix `[HAMMER, BOW, SWORD, SPEAR]` is verbatim the pin's expected order.

6. **NO new verifier section.** The existing sweeps are written to iterate `WEAPON_ORDER` /
   `Object.values(WEAPONS)` / `BLUEPRINTS`, so they cover the 4 new rows automatically: `§5d` validates
   type/swings/projectile-iff-ranged/moveset-modes/scaling-colour; `§8a` validates the status kinds +
   params (a `stun` is non-damaging, a `bleed` needs tick params); `§13c` validates each new
   `bp_weapon_*` tag maps 1:1 to a catalog entry of kind `weapon` (and vice-versa); `§13d` re-asserts the
   identity pin (which now must EXCLUDE the 4 new gated ids — guaranteed by the `blueprint` tag).
   This is the cleanest possible change: pure-data additions that the CI gate already polices.

7. **The fold + scene draws need NO change.** `foldWeaponAffix` carries `moveset`/`scaling`/`status`/
   `projectile` through (`weapons.ts:423`); the verifier `§10` fold sweep iterates `WEAPON_ORDER` so it
   re-proves the fold preserves the new rows' moveset/scaling and never weakens them. GameScene's
   `this.weaponPool = runWeaponPool(unlocked)` (`GameScene.ts:349`) automatically includes a banked
   weapon, and the `pool.filter(id => id !== equipped)` draw idiom handles it. Zero GameScene edits.

8. **Tuning is monotone-safe by construction.** A weapon row is not on any difficulty/cost curve — it is
   player power. New weapons only ADD build options; they never weaken anything (the never-weaken
   invariant is about scaling/cost/difficulty curves, untouched here). The charged `damageMult ≥ 1` and
   flurry `hits ≥ 2` constraints are verifier-enforced (`§5d`).

## 5. Integration Map (files the implementer will touch)

- **`src/config/weapons.ts`** — add 4 new `WeaponSpec` consts (`TWIN_DAGGERS`, `CROSSBOW`, `FROST_WAND`,
  `FLAIL`), each blueprint-gated, mirroring the GLAIVE precedent (`weapons.ts:279`). Register each in the
  `WEAPONS` lookup (`weapons.ts:300`) and APPEND each to `WEAPON_ORDER` after `GLAIVE` (`weapons.ts:311`).
  No change to `runWeaponPool`, `foldWeaponAffix`, or any interface (they already carry the optional
  fields). Each const fully commented in the house style (the SWING SCHEMA / MOVESET / STATUS comments).
- **`src/config/blueprints.ts`** — append 4 `BlueprintEntry` rows to `BLUEPRINTS` (`blueprints.ts:32`),
  `kind:'weapon'`, ids `bp_weapon_daggers`/`bp_weapon_crossbow`/`bp_weapon_frostwand`/`bp_weapon_flail`,
  each with `name` + `desc`. `BLUEPRINTS_BY_ID` / `BLUEPRINT_IDS` derive automatically.
- **`src/i18n/zh-CN.ts`** — add 4 rows to the `weapon:` content map (`zh-CN.ts:173`) and 4 rows to the
  `blueprint:` content map (`zh-CN.ts:258`). The English source is the config `name`/`desc` (no `en.ts`
  content row needed).
- **`src/i18n/en.ts`** — NO change required (UI chrome `kind.weapon` already present; weapon/blueprint
  English content is the config object's own `name`/`desc` via the `tName`/`tDesc` `en` fallback). If the
  implementer prefers an explicit `en.ts` content mirror for symmetry, it is OPTIONAL and must match the
  config strings — but the project convention (`en.ts:2-4`) is to NOT duplicate config content.
- **`scripts/verify-gen.mjs`** — NO structural change needed (the existing `§5d`/`§8a`/`§13c`/`§13d`/`§10`
  sweeps cover the new rows). OPTIONAL: extend the final summary `console.log` to mention the expanded
  arsenal. Run `npm run verify` to confirm green.

## 6. Identity-Preservation Checklist (the implementer MUST verify)

- [ ] Every new weapon row carries a `blueprint` tag → `runWeaponPool(new Set())` deep-equals
      `['hammer','bow','sword','spear']` (verifier `§13d`, the order + set pin).
- [ ] `WEAPON_ORDER` keeps the starter prefix `[HAMMER, BOW, SWORD, SPEAR]` first; the 4 new rows append
      AFTER `GLAIVE` (gated rows trail; the empty-set pool is unchanged).
- [ ] `runWeaponPool(fullUnlock).length === WEAPON_ORDER.length` (= 9) (verifier `§13d`).
- [ ] Each `bp_weapon_*` tag has EXACTLY ONE `BLUEPRINTS` entry of `kind:'weapon'` and vice-versa
      (verifier `§13c` — no orphan tag, no orphan catalog entry).
- [ ] Frost Wand / Flail use `kind:'stun'` (a known kind); no `STATUS_KINDS` change (pin stays 4).
- [ ] Crossbow / Frost Wand are `type:'ranged'` WITH a `projectile`; Daggers / Flail are `type:'melee'`
      WITHOUT a projectile (verifier `§5d` projectile-iff-ranged).
- [ ] Frost Wand / Crossbow carry NO melee-only charge fields (`aoeRadius`/`chargeStunDuration`) —
      those only on the Flail (verifier `§5d` rejects them on a ranged weapon).
- [ ] Every new weapon's `scaling` is a known colour (`brutality`/`tactics`) (verifier `§5d`).
- [ ] `foldWeaponAffix` over each new row preserves its moveset/scaling and never weakens (verifier `§10`,
      iterates `WEAPON_ORDER`).
- [ ] A default save (no blueprints banked) never draws/equips a new weapon; the starter pool is
      byte-unchanged; the level regression pin + determinism deep-equal are untouched (no weapon touches
      level layout).
- [ ] Both locales: `zh-CN.ts` `weapon:` + `blueprint:` each gain 4 rows; the Hub renders the 4 new
      blueprint rows with no layout change.

## 7. Verifier Notes (the CI gate)

No new section is required — the 4 new rows are exercised by the EXISTING sweeps (the same way GLAIVE is):

- **`§5d` (`verify-gen.mjs:1036`)** — iterates `WEAPON_ORDER`: asserts `type ∈ {melee,ranged}`, a
  non-empty well-formed `swings` table (`active > 0`, `recovery ≥ 0`, all `SWING_FIELDS` numeric),
  `projectile` IFF ranged (with `PROJ_FIELDS` numeric), the moveset modes well-formed
  (`charge.chargeTime > 0`/`damageMult ≥ 1`; melee-only `aoeRadius`/`chargeStunDuration ≥ 0` NOT on a
  ranged weapon; `flurry.hits ≥ 2`/`interval > 0` only on melee; `pierce.maxTargets ≥ 2` only on ranged;
  `finisher` only on melee), and a known `scaling` colour with the fold preserving it.
- **`§8·0`/`§8a` (`verify-gen.mjs:1340`)** — `STATUS_KINDS` stays EXACTLY 4 (stun reused, no new kind);
  iterates `Object.values(WEAPONS)`: each `status.kind` is known, `duration > 0`, and a damaging kind
  (bleed for Daggers) needs `tickInterval > 0 && tickDmg > 0` (a stun for Frost Wand/Flail needs neither).
- **`§13c` (`verify-gen.mjs:1850`)** — builds `tag→kind` from `WEAPON_ORDER`'s `blueprint` tags and the
  resolvers; asserts each new `bp_weapon_*` maps 1:1 to a `BLUEPRINTS` entry of `kind:'weapon'` (no orphan
  tag, no orphan catalog entry), each entry has `id`/`name`/`desc`.
- **`§13d` (`verify-gen.mjs:1903`)** — `runWeaponPool(new Set())` deep-equals the starter ids in the
  pinned order `['hammer','bow','sword','spear']` (the new rows MUST be excluded by their tag);
  `runWeaponPool(fullUnlock).length === WEAPON_ORDER.length`; a partial set adds only the named row.
- **`§6d` (`verify-gen.mjs:1288`)** — `WEAPON_ORDER.length ≥ 4` still holds (grows to 9).
- **`§10` (`verify-gen.mjs:1536`)** — the fold sweep iterates `WEAPON_ORDER`, re-proving the fold over
  the new rows keeps projectile-iff-ranged, the moveset, the scaling, and never weakens.

OPTIONAL: extend the final summary `console.log` to note the wider weapon arsenal. Run `npm run verify`
(must exit 0) and the build (`tsc`/Vite) after the edit.
