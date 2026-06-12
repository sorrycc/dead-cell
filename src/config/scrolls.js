// ── Run-only scroll boosts (design §6.5, Decision 55/60, AC48/AC52/AC53) ──
// 100% PURE data module — NO Phaser import. Scrolls are the RUN-ONLY economy (lost on death, NEVER
// banked to meta — Decision 55): collecting one arms a multiplier on the live RunState that the
// Player reads for THIS run only. KISS: a small flat set; each scroll is a { id, name, apply(run) }
// that mutates the RunState's run-only multiplier IN PLACE (the run dies with it, so mutation is safe
// and there is no permadeath leak). The Pickup's `scrollId` selects which one a pickup grants.
//
// The run-only multipliers live on RunState (scrollDamageMult / scrollMaxHpBonus etc., §6.4 fields
// extended in §6.5). The Player reads scrollDamageMult LIVE at the resolveHit site, STACKED on top of
// the permanent meta meleeDamageMult (Decision 60) — meta × scroll, both multiplicative.

export const SCROLLS = [
  // ── Damage scroll ── +25% damage for the rest of the run (stacks multiplicatively if found again).
  {
    id: 'power',
    name: 'Scroll of Power',
    apply: (run) => {
      run.scrollDamageMult *= 1.25
    },
  },
  // ── Vitality scroll ── +15 max HP for the run AND heal that much (a found-mid-run survivability
  // boost). Run-only: a fresh run resets maxHp to the meta-folded value (the scroll bonus is gone).
  {
    id: 'vitality',
    name: 'Scroll of Vitality',
    apply: (run) => {
      run.scrollMaxHpBonus += 15
    },
  },
]

// id → row lookup (the Pickup grants by scrollId; the spawn path picks a random row's id).
export const SCROLLS_BY_ID = Object.fromEntries(SCROLLS.map((s) => [s.id, s]))

// The ordered ids (for the seeded/random pick when an enemy drops a scroll).
export const SCROLL_IDS = SCROLLS.map((s) => s.id)
