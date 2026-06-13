// ── Run-only MUTATIONS (build-&-replay design §6.1, AC1/AC2/AC3; the choice-driven perk layer) ──
// 100% PURE data module — NO Phaser import (so scripts/verify-gen.mjs can node-import + sweep it, AC6).
// Mutations are Dead Cells' signature REPLAY lever: at each biome transition the run offers a SEEDED
// 3-of-N choice, and the picked mutation arms a perk on the live RunState for the REST of the run (it is
// run-only — lost on death, NEVER banked to meta, exactly like a scroll — so each run you build a
// different perk loadout from the same pool). KISS: each mutation is a { id, name, desc, apply(run) }
// that mutates the RunState's run-only field(s) IN PLACE (the run dies with it, so mutation is safe and
// there is no permadeath leak). The MutationOverlay selects which one a pick applies.
//
// REUSE FIRST (Decision 4) — most mutations reuse the SAME run-only fields the scroll table already wires
// (scrollLifestealFrac / scrollStatusDurationMult / scrollDodgeCdMult / scrollDamageMult / maxFlasks), so
// they need ZERO new engine wiring (DRY with scrolls — GameScene._syncPlayerScrollStats already pushes
// those fields to the live Player). A FEW add SIMPLE new live-read fields, each read at ONE site in
// GameScene, each a pure scalar/flag defaulting to the neutral identity (so a run with no mutation plays
// byte-identically — AC3):
//   onKillHealAmount  — flat HP healed on each enemy kill   (read in the enemy.onDeath hook).
//   lowHpDamageMult   — ×player damage while below a HP threshold (folded at the resolveHit site).
//   firstHitBonusMult — ×player damage vs a FULL-HP enemy   (folded at the resolveHit site, the opener).
//
// IDENTITY SAFETY (AC3/AC6): every field above defaults to the neutral identity in createRunState
// (onKillHealAmount 0, lowHpDamageMult 1, firstHitBonusMult 1), and every apply() only ever STRENGTHENS a
// bigger-is-better field (or lowers the one smaller-is-better dodge-cooldown mult) — so an empty mutation
// list = the identity, and the verifier's "never weakens" sweep passes (the same sense the scroll sweep uses).

import type { ScrollRunState } from './scrolls.js'

// The subset of RunState fields a mutation's apply() reads/mutates IN PLACE. It EXTENDS ScrollRunState
// (reusing the scroll-armed fields a mutation can also bump — DRY) + the few new live-read perk fields.
// Consumer modules (RunState / the verifier) type their live RunState against this so every site reads
// the same shape. All new fields default to the neutral identity in createRunState.
export interface MutationRunState extends ScrollRunState {
  onKillHealAmount: number // flat HP healed on each enemy kill (Predator). 0 = neutral.
  lowHpDamageMult: number // ×player damage while below the low-HP threshold (Berserker). 1 = neutral.
  firstHitBonusMult: number // ×player damage vs a FULL-HP enemy — the opener bonus (Assassin). 1 = neutral.
  // ── Affliction-synergy fields (affliction-synergy design §6.4, AC6/AC9) ── the build-engine hooks a
  // synergy mutation arms. Each defaults to the neutral identity in createRunState so an empty list = the
  // identity. Bigger-is-better (vsAfflictedDamageMult/statusTickMult); spreadAffliction is a flag a mutation
  // may only turn ON (never off) — the verifier's never-weaken sweep asserts exactly that.
  vsAfflictedDamageMult: number // ×player damage vs an AFFLICTED enemy (Hemorrhage). 1 = neutral.
  statusTickMult: number // ×applied DoT tickDmg (Virulent — "afflictions tick harder"). 1 = neutral.
  spreadAffliction: boolean // killing an afflicted enemy spreads it (Hemorrhage). false = off.
}

// The low-HP threshold (fraction of max HP) below which a Berserker mutation's lowHpDamageMult applies.
// Read at the resolveHit site in GameScene. A SHARED constant so the mutation desc + the live read agree.
export const LOW_HP_THRESHOLD = 0.4 // below 40% HP → the "below 40% HP" damage bonus reads.

// One mutation row: a pure-data { id, name, desc, apply(run) } that arms a run-only perk on the RunState
// for THIS run. `desc` is the player-facing one-line shown in the MutationOverlay choice.
export interface MutationSpec {
  id: string
  name: string
  desc: string
  apply: (run: MutationRunState) => void
  // ── BLUEPRINT tag (meta-progression §6.5, Decision 6, AC6) ── absent/undefined ⇒ a STARTER mutation (always
  // in the offer pool — the identity). A non-empty id ⇒ a GATED mutation that joins the pool ONLY when that
  // blueprint is unlocked (runMutationPool filters on it). EVERY current mutation is a starter; only the NEW
  // row this slice adds carries a tag — so a default save's 3-of-N offer draws from the same rows as today.
  blueprint?: string
}

export const MUTATIONS: MutationSpec[] = [
  // ── Berserker ── +30% damage while below 40% HP (the low-HP brawler identity — fight harder cornered).
  // A NEW live-read field (lowHpDamageMult), folded at the resolveHit site only when player HP is low.
  // Math.max so re-picking never WEAKENS it (a second Berserker is a no-op rather than a stack) — keeps
  // the verifier's never-weaken sweep clean and the effect bounded.
  {
    id: 'berserker',
    name: 'Berserker',
    desc: '+30% damage while below 40% HP',
    apply: (run) => {
      run.lowHpDamageMult = Math.max(run.lowHpDamageMult, 1.3)
    },
  },
  // ── Vampire ── heal 12% of MELEE damage dealt (the sustain/bruiser identity). Reuses the EXISTING
  // run-only lifesteal field the Vampirism scroll arms (DRY — zero new wiring; stacks additively with it).
  {
    id: 'vampire',
    name: 'Vampire',
    desc: 'Heal 12% of melee damage dealt',
    apply: (run) => {
      run.scrollLifestealFrac += 0.12
    },
  },
  // ── Predator ── heal 3 HP per kill (the aggressive-clear identity — momentum sustains you). A NEW
  // live-read field (onKillHealAmount), read in the enemy.onDeath hook. Additive (stacks if re-picked).
  {
    id: 'predator',
    name: 'Predator',
    desc: 'Heal 3 HP on each kill',
    apply: (run) => {
      run.onKillHealAmount += 3
    },
  },
  // ── Assassin ── +40% damage vs a FULL-HP enemy (the opener/burst identity — reward the first strike).
  // A NEW live-read field (firstHitBonusMult), folded at the resolveHit site when the struck enemy is at
  // full HP. Math.max so re-picking never weakens it (bounded; a no-op second pick — verifier-clean).
  {
    id: 'assassin',
    name: 'Assassin',
    desc: '+40% damage vs a full-HP enemy',
    apply: (run) => {
      run.firstHitBonusMult = Math.max(run.firstHitBonusMult, 1.4)
    },
  },
  // ── Toxic ── +50% status-effect duration (the DoT/crowd-control identity — longer bleed/poison/stun).
  // Reuses the EXISTING run-only status-duration field the Venom scroll arms (DRY — zero new wiring).
  {
    id: 'toxic',
    name: 'Toxic',
    desc: '+50% status-effect duration',
    apply: (run) => {
      run.scrollStatusDurationMult *= 1.5
    },
  },
  // ── Nimble ── −20% dodge cooldown (the dodge-spam / spacing identity — dodge sooner). Reuses the
  // EXISTING run-only dodge-cooldown factor the Alacrity scroll arms (DRY — synced to the player; stacks).
  {
    id: 'nimble',
    name: 'Nimble',
    desc: '-20% dodge cooldown',
    apply: (run) => {
      run.scrollDodgeCdMult *= 0.8
    },
  },
  // ── Brutality ── +20% raw damage (the flat-power identity — a straightforward DPS pick). Reuses the
  // EXISTING run-only damage multiplier (read LIVE at both hit sites — melee AND ranged; DRY, no wiring).
  {
    id: 'brutality',
    name: 'Brutality',
    desc: '+20% all damage',
    apply: (run) => {
      run.scrollDamageMult *= 1.2
    },
  },
  // ── Ironhide ── +1 healing-flask charge (the tank/sustain identity — more heal-valve uses). Reuses the
  // EXISTING flask resource the Endurance scroll bumps (DRY — raises the cap AND tops a charge up now).
  {
    id: 'ironhide',
    name: 'Ironhide',
    desc: '+1 healing-flask charge',
    apply: (run) => {
      run.maxFlasks += 1
      run.flasks += 1
    },
  },
  // ── Hemorrhage (affliction-synergy §6.4, AC6) ── the AFFLICTION-BUILD damage payoff: +25% damage vs an
  // afflicted enemy (vsAfflictedDamageMult — hook 1, folded at both hit sites) AND kills SPREAD the dominant
  // affliction to nearby enemies (spreadAffliction — hook 3, the onDeath spread). Math.max / = true so a
  // re-pick is a no-op (never-weaken clean): a second Hemorrhage can only re-arm the same values.
  {
    id: 'hemorrhage',
    name: 'Hemorrhage',
    desc: '+25% damage vs afflicted enemies; kills spread the affliction',
    apply: (run) => {
      run.vsAfflictedDamageMult = Math.max(run.vsAfflictedDamageMult, 1.25)
      run.spreadAffliction = true
    },
  },
  // ── Virulent (affliction-synergy §6.4, AC6) ── afflictions tick 50% HARDER: scales an armed damaging
  // status's tickDmg (statusTickMult — hook 2, applied in _scaleStatus alongside the duration mult). Stacks
  // multiplicatively if re-picked (never weakens — *= 1.5 only grows it).
  {
    id: 'virulent',
    name: 'Virulent',
    desc: 'Afflictions tick 50% harder',
    apply: (run) => {
      run.statusTickMult *= 1.5
    },
  },
  // ── Glass Cannon (BLUEPRINT-GATED) (meta-progression §6.5, Decision 6, AC6) ── the NEW run-pool mutation this
  // slice ships behind a blueprint unlock (`blueprint: 'bp_mutation_glasscannon'`). DEAD config (never offered)
  // until banked — so a default save's 3-of-N pool === the pre-slice starters (the identity, AC11). The high-risk
  // payoff perk: +50% all damage (the genre's glass-cannon). Reuses the EXISTING run-only damage multiplier (read
  // LIVE at both hit sites — DRY, zero new wiring; never-weaken safe — *= 1.5 only grows the bigger-is-better mult).
  {
    id: 'glasscannon',
    name: 'Glass Cannon',
    desc: '+50% all damage',
    blueprint: 'bp_mutation_glasscannon', // the gating blueprint id (matches config/blueprints.js BLUEPRINTS).
    apply: (run) => {
      run.scrollDamageMult *= 1.5
    },
  },
]

// id → row lookup (the overlay pick resolves an offered id to its spec to call apply()).
export const MUTATIONS_BY_ID: Record<string, MutationSpec> = Object.fromEntries(MUTATIONS.map((m) => [m.id, m]))

// The ordered mutation rows (the seeded 3-of-N picker draws distinct entries from this list).
export const MUTATION_ORDER = MUTATIONS.map((m) => m)

// ── runMutationPool(unlocked) → the MutationSpecs available given the unlocked-blueprint set (meta-progression
// §6.5, Decision 6, AC6) ── PURE (node-importable, verifier-swept). ALWAYS the STARTERS (untagged), PLUS any
// gated row whose blueprint id is unlocked. With an EMPTY set this returns exactly the starter rows === the
// pre-slice MUTATION_ORDER (the identity pin — a default save's 3-of-N draws from the same rows as today).
// GameScene computes it ONCE in create() from meta.getBlueprints() and _pickMutationOffers shuffles a COPY of it.
export function runMutationPool(unlocked: ReadonlySet<string>): MutationSpec[] {
  return MUTATION_ORDER.filter((m) => !m.blueprint || unlocked.has(m.blueprint))
}
