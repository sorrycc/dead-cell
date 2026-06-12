// ── Permanent meta-upgrade table (design §6.5, Decision 57, AC52/AC55) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node
// and asserts cost monotonicity + that `apply` never weakens you (AC55). Keeping upgrades as DATA
// (mirrors config/biomes.js / config/difficulty.js / config/weapons.js) means the Hub renders the
// list GENERICALLY (no per-upgrade UI code), the Player just reads the FOLDED starting stats, and
// the verifier checks the contract — no hard-coded upgrade effects scattered in HubScene/Player.
//
// Each upgrade row is self-contained (Decision 57):
//   id        — stable key stored in MetaState.upgrades { id: ownedLevel }.
//   name      — human label the Hub lists.
//   desc      — a short one-line effect summary for the Hub row.
//   maxLevel  — how many times it can be bought (= costs.length).
//   costs[]   — Cells cost to buy the NEXT level: costs[ownedLevel]. MONOTONE non-decreasing (the
//               verifier asserts, AC55) so deeper levels cost ≥ shallower ones.
//   apply(stats, level) — folds an OWNED level into a starting-stats object. It NEVER mutates its
//               input — it returns a NEW stats object (referential safety, AC55) — and only ever
//               HELPS the player (the verifier asserts the output is ≥ base on every field it touches).
//
// STARTING-STATS CONTRACT (Decision 57/60): the single object the meta fold produces + the Player
// reads — { maxHp, meleeDamageMult, dodgeCooldownMult, startWeaponId }. A fresh meta (no upgrades)
// folds to BASE_PLAYER_STATS unchanged → the Phase-4 player exactly (the additive identity, AC53).

// The unlock order for START_WEAPON: level 1 unlocks the Hammer, level 2 unlocks the Bow as the
// starting weapon (each level OVERRIDES the prior — the highest owned level wins). The Sword is
// always available (the default at level 0); these only change what you START a run holding.
const START_WEAPON_BY_LEVEL = ['sword', 'hammer', 'bow'] // index = owned level (0 = default sword).

export const UPGRADES = [
  // ── +MAX HP ── each level adds flat max HP (and, via the fold, the run starts at that full HP).
  {
    id: 'maxHp',
    name: '+Max HP',
    desc: '+20 max HP per level',
    maxLevel: 3,
    costs: [15, 30, 50], // monotone non-decreasing.
    apply: (stats, level) => ({ ...stats, maxHp: stats.maxHp + 20 * level }),
  },
  // ── +MELEE DAMAGE ── each level raises the melee damage multiplier (applied at the resolveHit site,
  // Decision 60 — keeps combat/damage.js pure; the mult is passed in, not imported).
  {
    id: 'meleeDmg',
    name: '+Melee Damage',
    desc: '+15% melee damage per level',
    maxLevel: 3,
    costs: [20, 40, 70],
    apply: (stats, level) => ({ ...stats, meleeDamageMult: stats.meleeDamageMult + 0.15 * level }),
  },
  // ── SHORTER DODGE COOLDOWN ── each level multiplies the dodge cooldown by 0.85 (so the cooldown
  // SHRINKS — dodge sooner). dodgeCooldownMult is a non-increasing factor; the Player multiplies its
  // DODGE_COOLDOWN by it. "Never weaker" means the EFFECTIVE cooldown only drops (the verifier asserts
  // dodgeCooldownMult ≤ base, the one field where SMALLER is better — see the verifier's note).
  {
    id: 'dodgeCd',
    name: '-Dodge Cooldown',
    desc: '-15% dodge cooldown per level',
    maxLevel: 2,
    costs: [25, 50],
    apply: (stats, level) => ({ ...stats, dodgeCooldownMult: stats.dodgeCooldownMult * Math.pow(0.85, level) }),
  },
  // ── STARTING WEAPON UNLOCK ── level 1 → start with the Hammer; level 2 → start with the Bow. Sets
  // startStats.startWeaponId; the Player equips WEAPONS[startWeaponId] at run start (Decision 60/63).
  {
    id: 'startWeapon',
    name: 'Starting Weapon',
    desc: 'Lv1 Hammer · Lv2 Bow',
    maxLevel: 2,
    costs: [40, 80],
    apply: (stats, level) => ({
      ...stats,
      // Clamp into the table so a stored level beyond the array (corrupt save) degrades to the last.
      startWeaponId: START_WEAPON_BY_LEVEL[Math.min(level, START_WEAPON_BY_LEVEL.length - 1)],
    }),
  },

  // ── ENRICHMENT (Decision 75) — the FIVE previously-phantom meta tiers (review MAJOR) ──────────────
  // MetaState.BASE_PLAYER_STATS + Player.applyStartStats already DEFINE + CONSUME rangedDamageMult,
  // dodgeIframeBonus, startGold, startScrolls, maxFlasks/flaskHealFrac — but NO upgrade row ever raised
  // them, so the bow-damage / wider-dodge / gold-/scroll-head-start / bigger-flask tiers the comments
  // describe were UNREACHABLE. These rows close that gap: pure DATA only (the Player reads the folded
  // fields live, RunState seeds them — no engine change). Each `apply` returns a NEW object (never
  // mutates — the §5b verifier pin) and only ever HELPS (bigger-is-better, so the §5c never-weaker sense
  // holds trivially on the fields it touches — the verifier auto-validates cost-monotonicity + identity).

  // ── +RANGED DAMAGE ── raises the bow/projectile damage multiplier (Player.rangedDamageMult, read at
  // the projectile→enemy hit site, Decision 73). Mirrors +Melee Damage for the ranged build path so the
  // Bow start-weapon tier has a damage tree to invest in (otherwise ranged scaled with NOTHING).
  {
    id: 'rangedDmg',
    name: '+Ranged Damage',
    desc: '+15% ranged (bow) damage per level',
    maxLevel: 3,
    costs: [20, 40, 70],
    apply: (stats, level) => ({ ...stats, rangedDamageMult: stats.rangedDamageMult + 0.15 * level }),
  },
  // ── +DODGE I-FRAMES ── flat extra dodge invulnerability seconds (Player.dodgeIframeBonus, Decision 73).
  // A more forgiving roll — the defensive complement to -Dodge Cooldown (dodge MORE OFTEN vs dodge through
  // MORE). +0.03s per level (the base window is 0.18s, so +0.06s at max ≈ a third wider — meaningful but
  // never trivialising; the cooldown still gates spam).
  {
    id: 'dodgeIframe',
    name: '+Dodge I-Frames',
    desc: '+0.03s dodge invuln per level',
    maxLevel: 2,
    costs: [30, 60],
    apply: (stats, level) => ({ ...stats, dodgeIframeBonus: stats.dodgeIframeBonus + 0.03 * level }),
  },
  // ── GOLD HEAD-START ── run-only gold the run STARTS with (RunState seeds gold from startGold, §6.9).
  // Lets a meta investment seed the in-run SHOP economy (Decision 74) — buy a boost on the first vendor
  // without grinding gold first. Run-only (never banked — permadeath), so it's a per-run convenience, not
  // a compounding advantage. +40 gold per level (≈ one cheap shop item's worth).
  {
    id: 'startGold',
    name: 'Gold Head-Start',
    desc: '+40 starting gold per level',
    maxLevel: 2,
    costs: [25, 50],
    apply: (stats, level) => ({ ...stats, startGold: stats.startGold + 40 * level }),
  },
  // ── STARTING SCROLLS ── N run-only scroll boosts auto-applied at run start (GameScene._applyStartingScrolls
  // off the RUN seed, §6.9). A head-start on BUILD VARIETY (a power/vitality scroll from level 1) without
  // finding one mid-run. Run-only (the scrolls die with the run — permadeath). +1 scroll per level.
  {
    id: 'startScrolls',
    name: 'Starting Scrolls',
    desc: '+1 run-start scroll per level',
    maxLevel: 2,
    costs: [35, 70],
    apply: (stats, level) => ({ ...stats, startScrolls: stats.startScrolls + level }),
  },
  // ── BIGGER FLASK ── grows BOTH the flask charge count (maxFlasks — more drinks per biome) AND the per-
  // drink heal fraction (flaskHealFrac — each drink restores more). Together they turn the healing valve
  // (Decision 72) into a real survivability tree: more HP recovered across a run. +1 charge and +0.1 heal-
  // fraction per level (base 2 charges / 0.4 frac → 4 charges / 0.6 frac at max). Both bigger-is-better.
  {
    id: 'flaskTier',
    name: 'Bigger Flask',
    desc: '+1 charge & +10% heal per level',
    maxLevel: 2,
    costs: [30, 60],
    apply: (stats, level) => ({
      ...stats,
      maxFlasks: stats.maxFlasks + level,
      flaskHealFrac: stats.flaskHealFrac + 0.1 * level,
    }),
  },
]

// id → row lookup (for MetaState.buy + the Hub's affordability/owned-level readout). DRY: one source.
export const UPGRADES_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]))
