// ── Run-only scroll boosts (design §6.5, Decision 55/60, AC48/AC52/AC53; Enrichment round 3) ──
// 100% PURE data module — NO Phaser import. Scrolls are the RUN-ONLY economy (lost on death, NEVER
// banked to meta — Decision 55): collecting one arms a multiplier/bonus on the live RunState that the
// Player reads for THIS run only. KISS: a small flat set; each scroll is a { id, name, apply(run) }
// that mutates the RunState's run-only field(s) IN PLACE (the run dies with it, so mutation is safe
// and there is no permadeath leak). The Pickup's `scrollId` selects which one a pickup grants.
//
// THE RUN-ONLY FIELDS (RunState §6.4/§6.5, extended for this enrichment) — all default to a NEUTRAL
// identity so a fresh run with no scroll plays EXACTLY as before:
//   scrollDamageMult       — ×damage at the resolveHit site (melee × ranged), STACKED on the meta mult.
//   scrollMaxHpBonus       — flat +max HP (and a top-up heal when collected).
//   scrollLifestealFrac    — fraction of melee damage DEALT that heals the player (read at the hit site).
//   scrollStatusDurationMult — ×applied bleed/poison/stun duration (a longer DoT/stun — build identity).
// Plus two scrolls that bump EXISTING run/player resources directly (no new field):
//   a dodge-cooldown / i-frame scroll mutates the player's dodge factors via _syncPlayerScrollStats;
//   a flask scroll bumps RunState.maxFlasks + flasks (the heal-valve resource).
//
// BUILD DIVERGENCE (the round-3 replayability fix): the old table had ONLY power + vitality — two flat
// stat bumps with no identity, so every run's run-only economy felt identical. This set gives a run a
// DIRECTION (a melee-lifesteal bruiser, a DoT-stacking poke build, a dodge-spam glass cannon, a flask
// tank) drawn from the same pool the shop / treasure branch / starting-scrolls meta all read — so the
// run-only economy now diverges run-to-run. Every hook is a pure-data field the engine ALREADY reads
// live (or a tiny additive live-read field on the Player), so the verifier sweeps it with near-zero risk.

export const SCROLLS = [
  // ── Power ── +25% damage for the rest of the run (stacks multiplicatively if found again). Melee AND
  // ranged (scrollDamageMult is read at BOTH hit sites in GameScene — Decision 60/62).
  {
    id: 'power',
    name: 'Scroll of Power',
    apply: (run) => {
      run.scrollDamageMult *= 1.25
    },
  },
  // ── Vitality ── +15 max HP for the run AND heal that much (a found-mid-run survivability boost). Run-
  // only: a fresh run resets maxHp to the meta-folded value (the scroll bonus is gone).
  {
    id: 'vitality',
    name: 'Scroll of Vitality',
    apply: (run) => {
      run.scrollMaxHpBonus += 15
    },
  },
  // ── Vampirism ── melee LIFESTEAL: heal a fraction of the damage each MELEE hit deals (a sustain build —
  // the bruiser identity). Stacks additively if found again. Read at the player melee-hit site in GameScene.
  {
    id: 'vampirism',
    name: 'Scroll of Vampirism',
    apply: (run) => {
      run.scrollLifestealFrac += 0.12 // +12% of melee damage dealt healed back.
    },
  },
  // ── Venom ── +50% STATUS-effect duration (bleed/poison/stun last longer — the DoT/crowd-control identity).
  // Stacks multiplicatively. Applied as a duration multiplier when GameScene arms a weapon's status on a hit.
  {
    id: 'venom',
    name: 'Scroll of Venom',
    apply: (run) => {
      run.scrollStatusDurationMult *= 1.5
    },
  },
  // ── Alacrity ── faster DODGE: −20% dodge cooldown AND a wider i-frame window (the dodge-spam / spacing
  // identity). Mutates the EXISTING player dodge factors via _syncPlayerScrollStats (run-only — a fresh run
  // reseeds them from the meta fold). Stacks (the cooldown compounds; the i-frame bonus adds).
  {
    id: 'alacrity',
    name: 'Scroll of Alacrity',
    apply: (run) => {
      run.scrollDodgeCdMult *= 0.8 // ×0.8 dodge cooldown (dodge sooner).
      run.scrollDodgeIframeBonus += 0.03 // +0.03s of dodge invulnerability.
    },
  },
  // ── Endurance ── +1 healing-flask charge for the run (raises the cap AND tops a charge up now) — the
  // tank/sustain identity, leaning on the §6.9 flask valve. Run-only (a fresh run reseeds flasks from meta).
  {
    id: 'endurance',
    name: 'Scroll of Endurance',
    apply: (run) => {
      run.maxFlasks += 1
      run.flasks += 1 // grant the charge immediately (the new cap also holds it).
    },
  },
]

// id → row lookup (the Pickup grants by scrollId; the spawn path picks a random row's id).
export const SCROLLS_BY_ID = Object.fromEntries(SCROLLS.map((s) => [s.id, s]))

// The ordered ids (for the seeded/random pick when an enemy drops a scroll).
export const SCROLL_IDS = SCROLLS.map((s) => s.id)
