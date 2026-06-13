# F2 Item Rarity & Forge — loot tiers + a gold-sink reroll/upgrade vendor

## 1. Background

Weapons already roll an **affix** at pickup (`config/weapons.ts:WEAPON_AFFIXES` + `foldWeaponAffix`,
the round-2 build engine), but every found weapon is otherwise the same: a "Sword ✦ Keen" at depth 1
is identical to one at depth 11. The genre's loot hook — *rarity* (Common → Rare → Epic → Legendary,
each tier hitting harder / carrying more affixes / tinting brighter) — is missing, and gold has only
shallow sinks (heal / flask / scroll / weapon / skill in `config/shop.ts`). This slice adds **rarity
tiers** to weapon pickups and a **Forge** shop item that spends gold to reroll the active weapon's
affix or upgrade its rarity one tier.

Every seam this needs already exists — we EXTEND, never duplicate:

- **The pure weapon fold.** `config/weapons.ts:foldWeaponAffix(weapon, affix)` deep-clones a fresh
  weapon, scales every `swing.damage`/`knockback`/`active`/`recovery` + the ranged `projectile`, stamps
  `affixId`/`affixName`/`affixLifestealFrac`, and NEVER mutates the shared `WEAPONS` config. It returns
  the same `WeaponSpec` schema so the Player reads it unchanged. This is the exact composition point for
  a rarity damage mult + an extra/strengthened affix.
- **The run-only value object.** `core/RunState.ts` carries `weaponId`/`weaponAffixId` (primary) +
  `weaponId2`/`weaponAffixId2` (secondary) as SCALARS so a level rebuild re-folds the same weapon. Each
  new field defaults to a neutral identity. Rarity is one more scalar per slot.
- **The pickup pool.** `entities/Pickup.ts` carries `weaponAffixId` on the per-pickup state + meta and
  tints by `kind` (`PICKUP_COLORS`). It already shows the additive-field idiom (`weaponAffixId ?? null`).
- **The equip path.** `GameScene._rollWeaponAffix(rng)` (off a seeded RNG) + `_equipWeaponWithAffix(
  weaponId, affixId)` fold + equip + record on RunState (slot-aware). The weapon pickup placement
  (`_maybePlaceWeaponPickup`, off `mulberry32(desc.seed ^ 0x5eed1234)` — OFF the generator's pinned
  draw) and the branch-reward path roll the affix; the shop weapon buy rolls off `Math.random`.
- **The shop.** `config/shop.ts` is a pure `{ id, name, desc, price, kind }` catalog; `ShopOverlay`
  renders rows GENERICALLY (fixed-x i18n cells); `GameScene._buyShopItem(item)` dispatches on
  `item.kind` (`heal`/`scroll`/`weapon`/`flask`/`skill`). A `forge` kind slots straight in.
- **The colour table.** `config/colors.ts` is the template for a new pure tier table (id list + lookup
  map + numeric `tint` + monotone-at-0-identity math + a verifier sweep in §14).
- **The HUD.** `GameScene._weaponSlotLabel(w)` builds `"<name> ✦ <affix>"` (i18n via `tName`), pushed to
  the registry as `weapon`; `HUDScene` renders it. Rarity name/colour appends here.
- **Pure config + verifier.** `scripts/verify-gen.mjs` node-imports every table (NO Phaser) and sweeps
  well-formedness + never-weaken monotonicity (§5d weapons, §6e shop, §10 affix fold, §14 colours). The
  rarity table + the rarity-aware fold get the same guardrail.
- **i18n.** `i18n/en.ts` (`ui` chrome) + `i18n/zh-CN.ts` (chrome + per-category `name`/`desc` keyed by
  id), read via `t()`/`tName()`/`tDesc()`. A new `rarity` category mirrors `affix`.

What is **missing**: no rarity concept anywhere, no rarity tint on the pickup, no rarity in the fold or
on RunState, and no forge. We add exactly that, gated behind opt-in state so a default run is
byte-identical.

## 2. Requirements Summary

- **A new pure `config/rarity.ts`** (NO Phaser): ordered tiers `[common, rare, epic, legendary]` with
  `{ id, name, tint, damageMult, extraAffix, weight }`, id→lookup map, ordered id list, a seeded
  depth-biased roller, and a `foldRarity(weapon, tier)` composing fold.
- **`common` is the IDENTITY tier**: `damageMult === 1`, `extraAffix === false` — `foldRarity(w, common)`
  returns the weapon UNCHANGED (no clone needed). Default loot stays unchanged.
- **`damageMult` is monotone non-decreasing** across the ordered tiers, every `>= 1` (never-weaken).
- **Higher rarity = a small damage mult AND a stronger affix.** A non-common tier folds a rarity
  damage mult onto every swing + the projectile AND (when the rolled affix permits) bumps the affix's
  effect (the "extra/stronger affix" — see Decision 4 for the KISS choice we make here).
- **Pickup tint by rarity** — `entities/Pickup.ts` carries `rarityId` on state + meta and tints/borders
  the pickup rect by the tier's `tint` (common = the current white weapon colour — the identity).
- **RunState carries `weaponRarityId` + `weaponRarityId2`** (both default `null` = common/identity) so a
  level rebuild re-folds the same weapon at the same rarity.
- **GameScene** rolls rarity at weapon-pickup placement off the LEVEL seed (deterministic), equips via a
  rarity-aware fold, and the forge buy path rerolls/upgrades the ACTIVE weapon (re-fold + update RunState
  + HUD).
- **A `forge` shop kind** in `config/shop.ts` + `_buyShopItem` dispatch: two rows — *reroll affix* and
  *upgrade rarity one tier* — both gold sinks.
- **HUD** shows the active weapon's rarity name + tint next to its name + affix.
- **i18n** — rarity names + the two forge item name/desc in BOTH `en.ts` and `zh-CN.ts`.
- **Verifier sweep** — the rarity table is well-formed (known ids, pinned order, numeric tints),
  `damageMult` is monotone non-decreasing + every `>= 1`, common is the EXACT identity (mult 1, no extra
  affix), and `foldRarity` never weakens the weapon (and `foldRarity(w, common) === w`).

### Identity (the hard constraint)

A default run finds weapons at **common** rarity (`rarityId === null`). `foldRarity(w, common)` returns
the weapon ref UNCHANGED, so the equipped weapon is `foldWeaponAffix(WEAPONS[id], affix)` exactly as
today — same swings, same projectile, same `affixId`. The pickup tints with the current white weapon
colour. RunState's two new rarity fields default `null`. The HUD label shows no rarity suffix for a
common weapon. The level generator and the level regression pin are UNTOUCHED (rarity rolls off the same
off-the-pin `mulberry32` thread the affix already uses — the pinned draw sequence is unchanged). The
weapon/affix/shop/colour verifier pins are unaffected except the deliberate additions below.

### Non-goals (YAGNI)

- **No rarity on non-weapon loot** (scrolls/skills/blueprints stay flat) — KISS; this slice is weapons.
- **No per-rarity affix POOLS or rarity-locked affixes.** A higher tier reuses the existing
  `WEAPON_AFFIXES` roll; "stronger affix" is a single composing mult (Decision 4), not a new affix set.
- **No meta tier / depth that seeds a starting rarity.** A fresh run's starting weapon is common.
- **No rarity downgrade / salvage.** The forge only ever rerolls or UPGRADES (monotone — never weakens).
- **No new combat math in `damage.ts`** (it stays pure; the mult is baked into the folded swings, exactly
  as the affix mult already is).
- **No rarity on the secondary slot's SEPARATE forge** — the forge always targets the ACTIVE slot (the
  swap key already lets the player choose which slot is active before forging). One forge target, KISS.

## 3. Acceptance Criteria

1. **`config/rarity.ts` (NEW, PURE — no Phaser).** Exports:
   - `RarityId = 'common' | 'rare' | 'epic' | 'legendary'`.
   - `RARITY_IDS: RarityId[]` — the ordered list `['common','rare','epic','legendary']` (lowest→highest).
   - `RaritySpec = { id: RarityId; name: string; tint: number; damageMult: number; extraAffix: boolean;
     weight: number }`.
   - `RARITIES: Record<RarityId, RaritySpec>` — lookup in lockstep with `RARITY_IDS`. Pinned data:
     - `common`: `tint 0xecf0f1` (the CURRENT weapon-pickup white — identity), `damageMult 1`,
       `extraAffix false`, `weight 70`.
     - `rare`: `tint 0x4dd0e1` (cyan), `damageMult 1.08`, `extraAffix false`, `weight 22`.
     - `epic`: `tint 0xc26bff` (magenta/purple), `damageMult 1.18`, `extraAffix true`, `weight 7`.
     - `legendary`: `tint 0xf1c40f` (gold), `damageMult 1.32`, `extraAffix true`, `weight 1`.
   - `damageMult` is monotone non-decreasing and every `>= 1`; `common.damageMult === 1` EXACTLY.
2. **Seeded depth-biased roller.** `rollRarityId(rng, depth) -> RarityId` (PURE, takes a `() => number`
   RNG and the run depth). It biases toward higher rarity at deeper depth by SCALING the higher tiers'
   weights up with depth (e.g. multiply each non-common tier's weight by `1 + depth × DEPTH_BIAS`,
   `DEPTH_BIAS` a small pinned constant), then does the standard weighted pick (the SAME idiom as
   `_rollWeaponAffix`/`ELITE_AFFIXES`). At `depth 0` it must still be able to return `common` (and
   common is the most likely tier at all depths early on). Deterministic given the RNG + depth.
3. **`foldRarity(weapon, tier)` — a PURE composing fold (mirrors `foldWeaponAffix`).** Given an
   ALREADY-affixed (or plain) weapon and a `RaritySpec`:
   - `tier == null` OR `tier.id === 'common'` ⇒ return the weapon UNCHANGED (the identity — same ref,
     no clone). This is the byte-identity guarantee.
   - Otherwise return a NEW weapon object (deep-cloning the swings rows + projectile — the same
     non-mutation discipline `foldWeaponAffix` keeps) with every `swing.damage` and (if ranged) the
     `projectile.damage` multiplied by `tier.damageMult` (rounded once, `Math.round`), and the rarity
     metadata stamped: `rarityId` (and a `rarityName` for the HUD, optional). It must NEVER reduce a
     swing's damage below the input weapon's (`tier.damageMult >= 1`).
   - It does NOT re-roll or replace the affix — affix STRENGTHENING (Decision 4) is handled by the
     `extraAffix` flag composing into the affix mult inside the COMPOSED fold helper (see AC4).
4. **Composed equip fold (Decision 4 — the "stronger affix" choice).** The fold order is
   `foldRarity(foldWeaponAffix(base, affix), tier)`. To make a higher rarity carry a *stronger affix*
   (not just more raw damage) WITHOUT a new affix pool, an `extraAffix === true` tier applies an
   AFFIX-POWER BUMP: when folding, an `extraAffix` tier multiplies the affix's own contribution by a
   pinned `EXTRA_AFFIX_POWER` (e.g. 1.25) — implemented by passing a `powerMult` into a small
   `foldWeaponAffix(base, affix, powerMult = 1)` extension that scales the affix's `damageMult`/
   `knockbackMult`/`lifestealFrac`/DoT `tickDmg` it bakes in. `powerMult` defaults to `1` (the identity
   — every current caller is unchanged), and `extraAffix === false` tiers pass `1`. **KISS:** this is
   ONE extra optional parameter, not a parallel affix table. A common/plain weapon (no affix) is
   unaffected by `extraAffix` (there is nothing to strengthen).
   - *Implementer's choice, documented:* put the `powerMult` parameter ON `foldWeaponAffix` and have the
     GameScene equip helper compute it from the tier (`tier.extraAffix ? EXTRA_AFFIX_POWER : 1`), then
     call `foldRarity(...)` for the raw damage mult + rarity stamp. This keeps `foldRarity` purely about
     the rarity damage mult + metadata and keeps the affix-power knob next to the affix it scales (SRP).
5. **`entities/Pickup.ts` carries rarity.** Add `rarityId: RarityId | null` to `PickupState` + the
   `PickupMeta` shape (mirror `weaponAffixId`): set on `acquire` (`meta.rarityId ?? null`), cleared in
   `_disable`. When a weapon pickup has a non-null rarity, tint the rect by `RARITIES[rarityId].tint`
   and draw a thin stroke/border in the same tint (programmer-art — `rect.setStrokeStyle`); a null/common
   rarity keeps the existing white weapon fill with NO border (the identity). Rarity tint applies ONLY to
   `kind === 'weapon'` pickups (other kinds ignore it).
6. **`core/RunState.ts` carries rarity.** Add `weaponRarityId: RarityId | null` and
   `weaponRarityId2: RarityId | null`, both seeded `null` (= common/identity), documented like
   `weaponAffixId`/`weaponAffixId2`. Carried across level rebuilds. `createRunState` seeds both `null`
   (the verifier's determinism walk is unaffected — it never sets a rarity).
7. **GameScene rolls + equips rarity.**
   - `_maybePlaceWeaponPickup` (and the branch-reward placement) roll `rollRarityId(rng,
     this.runState.depth)` off the SAME seeded level RNG already in scope, and stamp `rarityId` on the
     pickup meta alongside `weaponAffixId`. (Off-the-pin — the level regression pin is untouched.)
   - `_equipWeaponWithAffix(weaponId, affixId)` gains a `rarityId` parameter (default `null` keeps every
     current caller identity): it resolves the tier, computes the affix `powerMult`, folds
     `foldRarity(foldWeaponAffix(base, affix, powerMult), tier)`, equips into the chosen slot, and records
     `weaponRarityId`/`weaponRarityId2` on RunState alongside the affix id. A level rebuild re-folds BOTH
     slots' weapons at their recorded rarity.
   - The weapon-pickup overlap handler (`pk.rarityId`) and the shop weapon buy thread the rarity through.
8. **Forge shop item.** `config/shop.ts`:
   - Extend `ShopItemKind` to include `'forge'` and `SHOP_ITEM_KINDS` accordingly.
   - Add a `forgeAction?: 'reroll' | 'upgrade'` field to `ShopItem` (kind-specific param, undefined-safe).
   - Add TWO rows: `forgeReroll` (`kind 'forge'`, `forgeAction 'reroll'`) and `forgeUpgrade`
     (`kind 'forge'`, `forgeAction 'upgrade'`), each with a positive gold `price` (upgrade pricier than
     reroll). Both `desc` short one-liners.
   - `GameScene._buyShopItem`: a `case 'forge'` branch that targets the ACTIVE slot's recorded
     `weaponId`/`weaponAffixId`/`weaponRarityId`:
     - **reroll**: roll a NEW affix (`_rollWeaponAffix(Math.random.bind(Math))` — off the seeded layout,
       like the existing weapon buy) at the CURRENT rarity, re-fold + re-equip + record. Guard: if it would
       change nothing meaningful it still costs gold (a reroll is a gamble — KISS; OR reject a no-weapon
       state — see Decision 6 for the no-op guard rule).
     - **upgrade**: bump the rarity to the NEXT tier in `RARITY_IDS` (clamped at `legendary`), re-fold +
       re-equip + record. Guard: if already `legendary`, reject the buy (no charge) — the same
       "don't burn gold on a no-op" guard `heal`/`flask` use.
   - Run-only (forge spends run-only gold; the forged weapon dies on death — permadeath).
9. **HUD shows rarity.** `_weaponSlotLabel(w)` appends the rarity name when the weapon is non-common,
   e.g. `"Sword ✦ Keen · Epic"` (i18n via `tName('rarity', id, name)`); a common/plain weapon shows
   exactly its current label (identity). Optionally tint the label by the rarity (registry can carry a
   `weaponTint`); minimally the rarity NAME in the label satisfies the AC. Pixel-anchored chrome stays
   intact (the weapon label is a single left-anchored Text — no column drift).
10. **i18n (BOTH locales).** Add a `rarity` content category to `en.ts`/`zh-CN.ts` (only zh needs the
    per-id overrides; en is the config `name` source of truth, like `affix`): `rare`/`epic`/`legendary`
    (common renders no suffix, so it needs no string but MAY have one for completeness). Add the two
    forge items to the `shop` category in zh (en is the config `name`/`desc`). The Category union in
    `i18n/index.ts` gains `'rarity'`. NO bare English literals reach the UI.
11. **Verifier sweep (NEW section in `scripts/verify-gen.mjs`).** Node-import `config/rarity.ts` and
    assert:
    - `RARITY_IDS` is EXACTLY `['common','rare','epic','legendary']` (pinned order, length 4); each id
      resolves in `RARITIES` with `RARITIES[id].id === id`, a non-empty `name`, a numeric `tint`, a
      numeric `weight > 0`, and a boolean `extraAffix`.
    - `common.damageMult === 1` EXACTLY and `common.extraAffix === false` (the identity tier).
    - `damageMult` monotone non-decreasing along `RARITY_IDS` and every `>= 1` (never-weaken).
    - `foldRarity(w, RARITIES.common)` returns the SAME weapon ref for every weapon (identity), and
      `foldRarity(w, RARITIES.<higher>)` returns a NEW object that keeps the weapon schema (same type,
      same-length swings, projectile iff ranged) and NEVER reduces a swing's damage below the input
      (sweep every weapon × every non-common tier). It must not mutate the input weapon.
    - The composed `foldWeaponAffix(w, affix, powerMult)` with `powerMult === 1` equals the
      pre-change two-arg fold (the additive-identity pin for the extended signature), and a
      `powerMult > 1` never weakens (each baked affix contribution `>=` the `powerMult === 1` value).
    - The forge shop rows are well-formed (the existing §6e shop sweep already checks `kind` is in
      `SHOP_ITEM_KINDS` + positive prices — extend `SHOP_ITEM_KINDS` so `'forge'` passes, and assert a
      `forge` row's `forgeAction` is `'reroll'` or `'upgrade'`).
12. **Build + verifier green.** `npm run verify` (node `scripts/verify-gen.mjs`) and the Vite/tsc build
    pass. The level regression pin and the determinism deep-equal are unchanged.

## 4. Numbered Decisions

1. **Rarity is a SCALAR tier id per slot, folded — never a new object on the weapon.** Mirrors how the
   affix is a scalar `affixId` carried on RunState and baked by a pure fold. Two run scalars
   (`weaponRarityId` / `weaponRarityId2`), both default `null` = common. A rebuild re-folds.

2. **`common` is `null` on the wire, the identity in the table.** RunState/pickup carry `null` for a
   common weapon (so a fresh run is byte-identical and the field reads "absent"). `config/rarity.ts`
   still defines a `common` `RaritySpec` (`damageMult 1`, `extraAffix false`, `tint 0xecf0f1` = the
   current white) so the roller can RETURN common and the verifier can prove `common` is the identity.
   `foldRarity` treats both `null` and `common` as the no-op. `rollRarityId` MAY return `'common'`; the
   placement code maps `'common'` → `null` before stamping (so the pickup/RunState invariant "null =
   common" holds and the identity reads cleanly).

3. **Rarity rolls off the EXISTING off-the-pin level RNG (determinism).** `_maybePlaceWeaponPickup`
   already runs a `mulberry32(desc.seed ^ 0x5eed1234)` thread that is NOT on the generator's pinned
   draw; the rarity roll consumes from the SAME thread (after the affix roll). A replay places the same
   rarity. The level regression pin + determinism deep-equal are untouched. Shop forge rolls off
   `Math.random` (off the seeded layout — the same discipline the shop weapon buy already uses).

4. **"Stronger affix" = an affix-POWER mult on high tiers, NOT a new affix pool (KISS/YAGNI).** A
   parallel per-rarity affix table would be a lot of content + a second roll site for marginal payoff.
   Instead, an `extraAffix === true` tier (epic/legendary) scales the affix's own contribution by a
   pinned `EXTRA_AFFIX_POWER` via a new OPTIONAL `powerMult` parameter on `foldWeaponAffix` (default 1 =
   identity for every current caller). So a Legendary Keen sword hits harder from BOTH the rarity
   damage mult AND a beefier Keen. A common/rare weapon, or a weapon with no affix, is unaffected. This
   is the minimal change that makes the rarity affect the affix, and it composes cleanly with the
   raw-damage `foldRarity`. (The integration map's "extraAffix flag" is honoured as this power bump; an
   actual *second rolled affix* is the heavier, cut alternative.)

5. **Fold order: affix first, then rarity.** `foldRarity(foldWeaponAffix(base, affix, powerMult), tier)`.
   The affix fold (with the rarity-derived `powerMult`) bakes the affix's strengthened contribution;
   `foldRarity` then applies the FLAT rarity damage mult on top of the already-affixed swings + stamps
   the rarity metadata. Both folds deep-clone, so neither mutates `WEAPONS` (the aliasing-safety every
   fold keeps). The rarity mult composes multiplicatively with the affix mult (both `>= 1` → never
   weakens).

6. **No-op guard rules for the forge (don't burn gold on nothing).** Mirrors the heal/flask
   "check-before-deduct" pattern in `_buyShopItem`:
   - **upgrade** at `legendary` → reject (no charge). Below legendary → always a real upgrade (charge).
   - **reroll** → ALWAYS charges (it is a deliberate gamble; the new affix may equal the old by luck —
     that is the risk, KISS). BUT reject (no charge) if there is no eligible active weapon to forge
     (defensive — the active slot always has a weapon in normal play, so this is a guard, not a feature).
   - Both reject if the run can't afford `price` (the existing affordability guard — silent red row).

7. **Pickup tint + a thin border, weapon-only.** A non-common weapon pickup tints its rect by the tier
   `tint` and draws a 2px stroke in the same tint (`setStrokeStyle`) so rarer loot POPS at a glance
   (programmer-art — no assets). Common (null) keeps the current white fill + no stroke (identity). The
   tint is applied in `acquire` for `kind === 'weapon'` only; `_disable` clears the stroke so a recycled
   rect (re-used for a Cell/gold) never shows a stale border.

8. **HUD: rarity NAME (and optional tint) appended to the slot label.** The weapon label is the single
   place rarity surfaces on the HUD: `"<name> ✦ <affix> · <rarity>"` for a non-common weapon, the
   current label for common. i18n via a new `rarity` category. KISS — no extra HUD widget; the existing
   left-anchored weapon Text holds it (no column-alignment work).

9. **Forge targets the ACTIVE slot only.** The player already swaps which slot is active with R; the
   forge reads/writes the active slot's `weaponId`/`weaponAffixId`/`weaponRarityId`. One target keeps
   `_buyShopItem` simple and the RunState write unambiguous. (A second forge row per slot is YAGNI.)

10. **Pinned constants live in `config/rarity.ts` (the doc is the contract).** `RARITIES` data,
    `RARITY_IDS` order, `DEPTH_BIAS`, and `EXTRA_AFFIX_POWER` are all pinned there with a comment that
    the design doc + the verifier are the contract — exactly as `config/colors.ts` pins `PER_LEVEL`.

## 5. Integration Map (files the implementer will touch)

- **`src/config/rarity.ts`** — NEW pure table: `RarityId`, `RARITY_IDS`, `RaritySpec`, `RARITIES`,
  `rollRarityId(rng, depth)`, `foldRarity(weapon, tier)`, `DEPTH_BIAS`, `EXTRA_AFFIX_POWER`.
- **`src/config/weapons.ts`** — extend `foldWeaponAffix` with an optional `powerMult = 1` parameter
  (identity for existing callers) that scales the affix's baked contribution; extend `FoldedWeaponSpec`
  (or the folded return) to carry an optional `rarityId`/`rarityName`. (No change to the affix TABLE.)
- **`src/entities/Pickup.ts`** — `rarityId` on `PickupState` + `PickupMeta`; set in `acquire`, clear in
  `_disable`; tint + stroke a `kind === 'weapon'` pickup by `RARITIES[rarityId].tint`.
- **`src/core/RunState.ts`** — add `weaponRarityId` + `weaponRarityId2` (default `null`), documented +
  seeded in `createRunState`.
- **`src/scenes/GameScene.ts`** — roll rarity in `_maybePlaceWeaponPickup` + the branch-reward
  placement (off the in-scope level RNG); thread `rarityId` through the weapon-pickup overlap handler;
  add a `rarityId` parameter to `_equipWeaponWithAffix` (compute `powerMult`, call
  `foldRarity(foldWeaponAffix(base, affix, powerMult), tier)`, record on RunState); add the `forge`
  case to `_buyShopItem`; surface rarity in `_weaponSlotLabel`.
- **`src/config/shop.ts`** — `'forge'` in `ShopItemKind`/`SHOP_ITEM_KINDS`; a `forgeAction` field; two
  `forge` rows (`forgeReroll`, `forgeUpgrade`).
- **`src/entities/ShopOverlay.ts`** — no logic change (it renders rows generically); confirm the new
  rows render via the existing fixed-x i18n cells (already iterates `SHOP_ITEMS`).
- **`src/scenes/HUDScene.ts`** — no change needed if the rarity is folded into the `weapon` registry
  string by `_weaponSlotLabel`; (optional) read a `weaponTint` registry key to colour the label.
- **`src/i18n/index.ts`** — add `'rarity'` to the `Category` union.
- **`src/i18n/en.ts`** — (optional) `rarity` chrome only if any rarity UI string is `t()`-based; the
  rarity NAMES are the config `name` (en source of truth). Forge en strings are the config `name`/`desc`.
- **`src/i18n/zh-CN.ts`** — `rarity` category (`rare`/`epic`/`legendary` `{ name }`); the two forge
  rows in the `shop` category (`forgeReroll`/`forgeUpgrade` `{ name, desc }`).
- **`scripts/verify-gen.mjs`** — NEW rarity sweep (well-formedness + monotone `damageMult` + common
  identity + `foldRarity` never-weaken + the `powerMult === 1` fold identity); extend `SHOP_ITEM_KINDS`
  use so the `forge` rows pass the existing §6e shop sweep + assert `forgeAction`; update the final
  `console.log` summary line to mention the rarity table.

## 6. Identity-Preservation Checklist (the implementer MUST verify)

- [ ] A fresh run's weapon pickups roll `common` most of the time at low depth, and a `common` pickup is
      a plain white rect with no border (the current look).
- [ ] `foldRarity(w, common)` (and `foldRarity(w, null)`) returns the SAME weapon ref — no clone, no
      damage change.
- [ ] `foldWeaponAffix(base, affix)` (two-arg) and `foldWeaponAffix(base, affix, 1)` produce identical
      output (the extended signature defaults to identity).
- [ ] RunState's `weaponRarityId`/`weaponRarityId2` default `null`; a default save plays byte-identically.
- [ ] The level regression pin + determinism deep-equal in `verify-gen.mjs` are unchanged (rarity rolls
      off the existing off-the-pin RNG thread; the generator is untouched).
- [ ] A common weapon's HUD label reads exactly as today (no rarity suffix).
- [ ] The shop with the two forge rows still renders aligned under the CJK fallback (generic fixed-x cells).

## 7. Verifier Notes (the CI gate)

Add a new numbered section (after §14 colours) that node-imports `config/rarity.ts` and asserts, in the
existing `fail(...)`-on-violation style:

- **Well-formedness:** `RARITY_IDS === ['common','rare','epic','legendary']` (pinned order, length 4);
  every id resolves in `RARITIES` in lockstep (`RARITIES[id].id === id`); non-empty `name`; numeric
  `tint`; numeric `weight > 0`; boolean `extraAffix`.
- **Common identity:** `RARITIES.common.damageMult === 1` EXACTLY; `RARITIES.common.extraAffix === false`.
- **Monotone never-weaken:** `damageMult` non-decreasing along `RARITY_IDS`, every `>= 1`.
- **Fold identity + never-weaken:** for every weapon, `foldRarity(w, RARITIES.common) === w` and
  `foldRarity(w, null) === w`; for every weapon × every non-common tier, `foldRarity` returns a NEW
  object, preserves the schema (type, swings length, projectile iff ranged), never reduces a swing's
  damage below the input, and does not mutate the input weapon.
- **Extended affix fold identity:** for every weapon × every affix,
  `foldWeaponAffix(w, affix, 1)` deep-equals the legacy `foldWeaponAffix(w, affix)`; a `powerMult > 1`
  never weakens the baked affix contribution.
- **Shop:** extend `SHOP_ITEM_KINDS` to include `'forge'` (so the existing §6e sweep passes the new
  rows) and assert each `forge` row's `forgeAction ∈ {'reroll','upgrade'}`.
- Update the final summary `console.log` to include the rarity table (e.g.
  `+ N rarity tiers (common identity + monotone damageMult, fold never-weaken)`).
