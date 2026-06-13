// ── In-run shop catalog (design §6.10, Decision 76, AC63) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node and
// asserts the catalog is well-formed (positive gold prices, a known kind per item, a non-empty list).
// Mirrors the project's other pure config tables (upgrades/scrolls/weapons): items are PLAIN DATA the
// Phaser-coupled Shop overlay renders GENERICALLY (no per-item UI code) and GameScene resolves a buy off.
//
// THE GOLD SINK (review MAJOR — the phantom-stub fix). GOLD was dropped (Pickup GOLD_DROP_CHANCE),
// collected (RunState.gold), and shown on the HUD — but had ZERO sinks anywhere in src/, so a whole
// currency the genre revolves around was dead weight (and _tryOpenShop referenced an undefined _openShop
// + a Shop that was never spawned — a latent crash if this.shop were ever truthy). This catalog is the
// real vendor: RUN-ONLY boosts bought with run-only gold (both die on death — permadeath), so gold becomes
// a moment-to-moment "spend now vs save for the next vendor" decision instead of an ignored counter.
//
// ITEM SHAPE (Decision 76 — self-contained rows, like config/upgrades.js):
//   id     — stable key (for logging / the overlay cursor).
//   name   — the label the overlay lists.
//   desc   — a short one-line effect summary.
//   price  — GOLD cost (run-only currency; the overlay greys it out when unaffordable). > 0 (verifier).
//   kind   — the effect family GameScene._buyShopItem dispatches on (a small KNOWN set, like Pickup kinds):
//              'heal'   — restore a fraction of MAX HP now (`healFrac`).
//              'scroll' — arm ONE run-only scroll boost (a random SCROLLS row — same as a scroll pickup).
//              'weapon' — swap to a specific weapon (`weaponId`) — a guaranteed vendor weapon.
//              'flask'  — grant +1 flask charge for THIS run (bumps RunState.flasks, capped at maxFlasks+).
//   …params— kind-specific fields read ONLY by that kind's branch (undefined-safe), mirroring how
//            Pickup reads weaponId/scrollId/healFrac.
//
// REPEATABLE (Decision 76): items are NOT one-shot — a vendor sells the same row repeatedly while you can
// afford it (KISS: no per-item stock tracking — gold IS the limiter). The overlay re-renders affordability
// after each buy so a depleted wallet greys the rows. This keeps the data trivial + the genre's "dump gold
// at the shop" loop intact.

// The KNOWN item kinds — the effect family GameScene._buyShopItem dispatches on (a small KNOWN set). The
// skills slice adds 'skill' (buy a specific skill into the loadout — the same kind-dispatch the pickup uses);
// item-rarity-forge adds 'forge' (reroll/upgrade the ACTIVE weapon — a gold sink into the build, Decision 8).
export type ShopItemKind = 'heal' | 'scroll' | 'weapon' | 'flask' | 'skill' | 'forge'

// A forge action (item-rarity-forge §6, Decision 8) — kind-specific param for a 'forge' row, read ONLY by the
// forge branch (undefined-safe). 'reroll' = roll a NEW affix at the current rarity; 'upgrade' = bump rarity +1.
export type ForgeAction = 'reroll' | 'upgrade'

// A self-contained shop catalog row (Decision 76). Kind-specific params are optional and read ONLY by
// that kind's branch (undefined-safe), mirroring how Pickup reads weaponId/scrollId/healFrac.
export interface ShopItem {
  id: string
  name: string
  desc: string
  price: number
  kind: ShopItemKind
  healFrac?: number
  weaponId?: string
  skillId?: string
  forgeAction?: ForgeAction // item-rarity-forge §6 — present iff kind === 'forge' (the verifier asserts it).
}

export const SHOP_ITEMS: ShopItem[] = [
  // ── HEAL ── the bread-and-butter gold sink: restore 35% of MAX HP right now (no flask charge spent —
  // it's a purchased heal, distinct from the carried flask). Cheap so a damaged run can always top up.
  {
    id: 'heal',
    name: 'Healing Draught',
    desc: 'Restore 35% max HP',
    price: 18,
    kind: 'heal',
    healFrac: 0.35,
  },
  // ── EXTRA FLASK CHARGE ── refill/extend the healing-flask resource (Decision 72) — +1 charge for this
  // run (the genre's "buy a flask refill from the vendor"). Bumps RunState.flasks so the next biome's
  // fight has more healing in reserve. Mid-priced (a charge heals flaskHealFrac of max HP on demand).
  {
    id: 'flaskCharge',
    name: 'Flask Refill',
    desc: '+1 healing-flask charge',
    price: 22,
    kind: 'flask',
  },
  // ── POWER SCROLL ── arm ONE run-only scroll boost (a random SCROLLS row — power/vitality, same effect
  // a found scroll grants). A guaranteed build-power purchase so gold buys into the run-only scroll economy
  // even on a level with no scroll drops. Pricier (a permanent-for-the-run multiplier).
  {
    id: 'scroll',
    name: 'Mystic Scroll',
    desc: 'Arm a random run boost',
    price: 30,
    kind: 'scroll',
  },
  // ── VENDOR WEAPON (SPEAR) ── a GUARANTEED weapon swap from the vendor (the long-reach Spear, §6.6.5) so
  // a player can buy into a new moveset on demand rather than waiting for a random weapon pickup. Priciest —
  // it's a build-defining pick. The Spear is chosen as a distinct spacing tool; GameScene swaps it in.
  {
    id: 'weaponSpear',
    name: 'Vendor Spear',
    desc: 'Swap to the Spear',
    price: 40,
    kind: 'weapon',
    weaponId: 'spear',
  },
  // ── VENDOR SKILL (KNIVES) ── a guaranteed SKILL the player can buy into the loadout (the skills slice's gold
  // sink into the secondary-item layer). _buyShopItem dispatches 'skill' → equipSkill (fill the first empty
  // slot, else slot 0) — the SAME path the skill pickup uses (DRY). Mid-priced (a cooldown burst tool).
  {
    id: 'skillKnives',
    name: 'Throwing Knives',
    desc: 'Equip a knife-throw skill',
    price: 28,
    kind: 'skill',
    skillId: 'knives',
  },
  // ── VENDOR SKILL (FROST GRENADE) ── a guaranteed radial-freeze blast skill — the build-defining crowd-control
  // pick (so gold can buy into the skill economy even on a level with no skill drops). Pricier — it's a panic-button AoE.
  {
    id: 'skillFrost',
    name: 'Frost Grenade',
    desc: 'Equip a radial-freeze skill',
    price: 36,
    kind: 'skill',
    skillId: 'frostGrenade',
  },
  // ── FORGE: REROLL AFFIX (item-rarity-forge §6, Decision 8) ── a gold-sink gamble — re-roll the ACTIVE
  // weapon's affix at its CURRENT rarity (the new affix may equal the old by luck — that's the risk, KISS).
  // Mid-priced (a deliberate spin). _buyShopItem rerolls + re-folds + re-equips the active slot directly.
  {
    id: 'forgeReroll',
    name: 'Forge: Reroll Affix',
    desc: 'Re-roll the active weapon affix',
    price: 26,
    kind: 'forge',
    forgeAction: 'reroll',
  },
  // ── FORGE: UPGRADE RARITY (item-rarity-forge §6, Decision 8) ── bump the ACTIVE weapon's rarity ONE tier
  // (common→rare→epic→legendary, clamped at legendary). Pricier than the reroll — it's a guaranteed power gain
  // (more damage + a stronger affix on epic/legendary). Rejected (no charge) when already legendary (Decision 6).
  {
    id: 'forgeUpgrade',
    name: 'Forge: Upgrade Rarity',
    desc: 'Raise the active weapon rarity one tier',
    price: 48,
    kind: 'forge',
    forgeAction: 'upgrade',
  },
]

// id → row lookup (handy for logging / a future targeted buy). DRY: one source. KISS — a flat map.
export const SHOP_ITEMS_BY_ID: Record<string, ShopItem> = Object.fromEntries(SHOP_ITEMS.map((it) => [it.id, it]))

// The KNOWN item kinds (the verifier asserts every item.kind is one of these — a malformed catalog fails
// loudly under node, mirroring the boss-attack-kinds + upgrade-table well-formedness checks).
export const SHOP_ITEM_KINDS: ShopItemKind[] = ['heal', 'scroll', 'weapon', 'flask', 'skill', 'forge']
