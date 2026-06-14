export const meta = {
  name: 'rich-playability',
  description: 'Ship 4 Dead-Cells features (color scaling, rarity+forge, cursed chests, branching map) via a one-shot pipeline each, committing per feature',
  whenToUse: 'Implement the agreed playability features end-to-end, one /one-shot-style pipeline (design → review → implement → commit) per feature, sequential (shared files, no worktrees).',
  phases: [
    { title: 'F1 Color Scaling' },
    { title: 'F2 Item Rarity & Forge' },
    { title: 'F3 Cursed Chests' },
    { title: 'F4 Branching Map' },
    { title: 'Final Review' },
  ],
}

// ────────────────────────────────────────────────────────────────────────────
// Shared schemas (StructuredOutput contracts the agents must return).
// ────────────────────────────────────────────────────────────────────────────
const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    docPath: { type: 'string', description: 'Path to the design doc written under docs/designs/.' },
    committed: { type: 'boolean', description: 'true if the design doc was committed.' },
    summary: { type: 'string' },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    filesToTouch: { type: 'array', items: { type: 'string' } },
  },
  required: ['docPath', 'committed', 'summary', 'acceptanceCriteria', 'filesToTouch'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['approve', 'revise'] },
    mustFix: { type: 'array', items: { type: 'string' }, description: 'Blocking issues the implementer MUST address.' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'mustFix'],
}

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    committed: { type: 'boolean' },
    commitSha: { type: 'string' },
    verifyPassed: { type: 'boolean' },
    buildPassed: { type: 'boolean' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    remainingIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['committed', 'verifyPassed', 'buildPassed', 'summary'],
}

const FINAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    richEnough: { type: 'boolean' },
    shipped: { type: 'array', items: { type: 'string' } },
    remainingGaps: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['richEnough', 'summary'],
}

// ────────────────────────────────────────────────────────────────────────────
// Conventions every agent must respect (DRY — embedded into each prompt).
// ────────────────────────────────────────────────────────────────────────────
const CONVENTIONS = `
PROJECT: "Dead Cell" — a Phaser 3 + Vite + TypeScript roguelite (Dead Cells clone). Source in src/. Pure
config tables live in src/config/*.ts and MUST stay node-importable (NO Phaser import) because
scripts/verify-gen.mjs node-imports them and asserts their contracts (CI gate). The codebase obsesses over
these invariants — honour them or CI/the build breaks:

1. ADDITIVE IDENTITY: a default save / fresh run must play BYTE-IDENTICALLY to before your change. Every new
   field defaults to the neutral identity (1× / 0 / null / empty). New behaviour is gated behind opt-in state.
2. NEVER-WEAKEN / MONOTONE: any new "scaling" must only ever help or hold (the verifier sweeps this). Costs
   monotone non-decreasing. Difficulty curves monotone non-decreasing.
3. PURE CONFIG: new config tables are pure data (no Phaser), exported with id→lookup maps + ordered lists,
   mirroring config/weapons.ts / enemies.ts / scrolls.ts / roomTypes.ts. Add a verifier sweep in
   scripts/verify-gen.mjs for any new table (well-formedness + monotonicity), matching its existing style.
4. PROGRAMMER-ART ONLY: colored rectangles / Phaser Graphics. No external sprite/audio assets.
5. i18n: ALL user-facing UI text must add BOTH locale strings — src/i18n/en.ts AND src/i18n/zh-CN.ts — and use
   the existing t()/UI_FONT machinery (see how HUDScene/HubScene/ShopOverlay read strings). No bare English
   literals in UI. Keep Hub/Shop column alignment pixel-anchored (CJK fallback is not monospaced).
6. DRY/KISS/YAGNI/SOLID. Reuse existing seams: resolveHit (combat/damage.ts) takes a damageMult passed IN;
   RunState (core/RunState.ts) is the run-only value object; MetaState (core/MetaState.ts) is persistent meta;
   the pickup pool (entities/Pickup.ts), the shop overlay (entities/ShopOverlay.ts + config/shop.ts), and the
   interact-on-E seam (entities/Shop.ts) already exist — extend them, don't duplicate.
7. DETERMINISM: anything that affects the seeded level layout must use the level seed; cosmetic churn (drops)
   uses Math.random and stays OFF the generator's pinned RNG (see Pickup.spawnDrop). Do NOT break the level
   regression pin or the determinism deep-equal in scripts/verify-gen.mjs.
8. COMMITS: conventional, lowercase, descriptive — e.g. "feat: <what> — <why/how>". Match recent git log style.
9. DO NOT use git worktrees. Edit the live working tree.
`

// The 4 features, in dependency order. Each carries the integration map I (the orchestrator) already gathered.
const FEATURES = [
  {
    key: 'color-scaling',
    title: 'F1 Color Scaling',
    slug: 'color-scaling-stats',
    brief: `Add Dead Cells' signature COLOR-SCALING build engine: three stat colours — BRUTALITY (red, melee),
TACTICS (purple, ranged/skills), SURVIVAL (green, sustain/HP). Each weapon & skill is TAGGED a colour; the run
tracks a per-colour LEVEL (run-only, starts 0); an item's damage scales with ITS colour's level. Picking up a
"stat scroll" / choosing at an exit raises one chosen colour by +1 (offer the player a 3-of choice, reusing the
MutationOverlay picker pattern). SURVIVAL also grants flat +max HP per level. This makes loot exciting ("a
Brutality sword feeds my build") and scroll choices a real commitment.`,
    integration: `
- config/weapons.ts: add a required \`scaling: 'brutality'|'tactics'|'survival'\` field to every WeaponSpec
  (SWORD/HAMMER/SPEAR/GLAIVE → brutality or survival; BOW → tactics). foldWeaponAffix must carry it through.
- config/skills.ts: add the same \`scaling\` tag to every SkillSpec (volley/turret → tactics; blast → brutality
  or survival as fits).
- NEW pure config (e.g. config/colors.ts): the three colour ids, display names, tints, the per-level damage
  scaling (e.g. PER_LEVEL = 0.15 → mult = 1 + level*PER_LEVEL, monotone), and SURVIVAL's per-level +HP.
- config/scrolls.ts: ADD three colour scrolls (Scroll of Brutality/Tactics/Survival, apply() bumps that
  colour's run level). Keep existing scrolls OR fold them — your call, but preserve identity for default runs.
- core/RunState.ts: add brutality/tactics/survival levels (default 0) + survivalHpBonus derivation. Carry across
  level rebuilds. Seed from meta if you add a meta tier (optional — keep KISS).
- combat/damage.ts: it already takes opts.damageMult passed IN. Do NOT import config there. GameScene computes
  the colour-scaled mult (player colour level for the EQUIPPED weapon's colour) and passes it in at the existing
  melee + ranged resolveHit call sites. Skills similarly scale by their colour at their hit site.
- scenes/GameScene.ts: compute & apply the colour mult at resolveHit/projectile/skill hit sites; wire the
  3-of colour-up choice at biome transitions (reuse the mutation-picker seam) and/or a colour stat-scroll pickup.
- scenes/HUDScene.ts: show the three colour levels (small coloured pips/numbers) + highlight the equipped
  weapon's colour.
- i18n: en.ts + zh-CN.ts strings for the colour names + scroll names + any picker text.
- scripts/verify-gen.mjs: sweep — every weapon AND skill has a KNOWN scaling colour; the scaling fold is
  monotone non-decreasing (never weakens); level 0 ⇒ mult exactly 1 (identity).`,
    acceptance: `Default run (no colour scrolls) = byte-identical damage to before (all levels 0 ⇒ ×1). Picking a
colour raises matching-colour weapon/skill damage and (Survival) max HP. HUD shows the three levels. Verifier +
build green.`,
  },
  {
    key: 'item-rarity',
    title: 'F2 Item Rarity & Forge',
    slug: 'item-rarity-forge',
    brief: `Add item RARITY tiers (Common → Rare → Epic → Legendary) to weapon pickups: rarity scales affix
strength and/or grants an extra affix + a small damage mult, and tints the pickup. Add a FORGE to the in-run
shop: spend gold to REROLL the active weapon's affix or UPGRADE its rarity one tier. Makes loot pop and gives
gold a deeper sink. Common = the identity (no change), so default loot is unchanged.`,
    integration: `
- NEW pure config (config/rarity.ts): ordered tiers [common, rare, epic, legendary] with { id, name, tint,
  damageMult (common=1.0 identity, monotone non-decreasing), affixPowerMult or extraAffix flag, weight }.
  A deeper-depth/level roll biases toward higher rarity (off the LEVEL seed — deterministic).
- config/weapons.ts: extend foldWeaponAffix (or add foldRarity composing after it) to apply a rarity's
  damageMult/affix-power to the folded weapon WITHOUT mutating shared config (deep-clone, same discipline).
- entities/Pickup.ts: carry rarityId on the pickup state + meta; tint/border by rarity tint.
- core/RunState.ts: carry weaponRarityId + weaponRarityId2 (null = common/identity) so a level rebuild
  re-folds the same weapon.
- scenes/GameScene.ts: roll rarity at weapon-pickup placement off the level seed; equip path folds rarity;
  forge buy path rerolls/upgrades the active weapon (re-fold + update RunState + HUD).
- config/shop.ts + entities/ShopOverlay.ts: add a 'forge' item kind (reroll affix; upgrade rarity) — a gold
  sink. Generic kind-dispatch like the existing 'heal'/'scroll'/'weapon'/'flask'/'skill'.
- scenes/HUDScene.ts: show the active weapon's rarity name/colour next to its name + affix.
- i18n: en.ts + zh-CN.ts for rarity names + forge item name/desc.
- scripts/verify-gen.mjs: sweep the rarity table (monotone damageMult, known ids, common=identity) + assert
  the fold never weakens.`,
    acceptance: `Common-rarity weapon = identical to a plain weapon today (identity). Higher rarities hit harder /
carry stronger affixes and tint differently. Forge spends gold to reroll/upgrade. Verifier + build green.`,
  },
  {
    key: 'cursed-chests',
    title: 'F3 Cursed Chests',
    slug: 'cursed-chests',
    brief: `Add Dead Cells' CURSED CHEST: a rare interactable chest. Opening it (E) grants GUARANTEED strong loot
(a high-rarity affixed weapon or a colour scroll + gold) but applies a CURSE: the player is one-shot (or takes
greatly amplified damage) until they kill N enemies; each kill removes a curse stack. A real risk/reward choice —
the player can walk past it. HUD shows curse stacks. Distinct from the existing CURSED *room type* (a per-room
damage debuff) — this is a choice-driven interactable object.`,
    integration: `
- Reuse the EXISTING interact-on-E seam: entities/Shop.ts shows an "[E] SHOP" prompt + an in-range flag and a
  consumed edge (see recent commits "shop now opens on E"). Model the chest the same way (an interactable with a
  prompt + an E edge), OR extend that seam generically. KISS — don't build a whole new input system.
- NEW pure config (config/curses.ts): { killsToClear, damageMultWhileCursed OR oneShot flag, lootTier }. Plain
  data, verifier-swept.
- core/RunState.ts: curseStacks (default 0 = identity). Banked? No — run-only.
- entities/Player.ts onHit (or GameScene's _hurtPlayer funnel): while cursed, apply the lethal/amplified rule.
  Keep parry/dodge i-frames working (curse only changes damage taken, not invulnerability).
- scenes/GameScene.ts: place a chest rarely off the level seed on normal levels (never on boss/miniboss
  levels); open → grant guaranteed loot (reuse F2 rarity to give a high-rarity weapon) + set curseStacks; on
  enemy kill, decrement curseStacks (existing onDeath hook). Reset the per-room debuff cleanly on rebuild.
- scenes/HUDScene.ts: a curse indicator (stacks remaining + a clear tell while cursed).
- i18n: en.ts + zh-CN.ts for the chest prompt, the curse warning, and the HUD label.
- scripts/verify-gen.mjs: sweep the curse config (positive killsToClear, sane mult).`,
    acceptance: `Walking past the chest = no effect (identity). Opening grants strong guaranteed loot + a curse;
killing N enemies clears it; HUD shows stacks. Dodge/parry still negate hits while cursed. Verifier + build green.`,
  },
  {
    key: 'branching-map',
    title: 'F4 Branching Map',
    slug: 'branching-biome-map',
    brief: `Replace the strictly LINEAR biome order (Prison→Sewers→Catacombs→Ramparts) with a BRANCHING map: at
each biome transition the player CHOOSES between 2 next biomes (e.g. a safer route vs a harder route with richer
loot), reusing the MutationOverlay-style picker. The run still converges on the boss biome (Ramparts) finale.
Adds run agency + replayability. The verifier's whole-run monotonicity proof must hold over EVERY path.`,
    integration: `
- config/biomes.ts: add a biome GRAPH — each biome node declares \`exits: string[]\` (the biome ids it can lead
  to). Keep difficultyTier monotone along EVERY path (so every route is non-decreasing — the verifier asserts
  it). Add at least one ALTERNATE mid biome so a real 2-way choice exists (e.g. a parallel to Catacombs). All
  paths must reach the boss biome (Ramparts). Reuse existing biome configs; add one new biome for branch variety.
- core/RunState.ts: replace biomeIndex-into-array with a biomeId + a chosen path. advance() at a biome boundary
  must consult the chosen next biome (set by the picker) instead of biomeIndex+1. isLastBiome/isRunComplete/
  isBossLevel/biome() updated to the graph model. Keep depth run-global + monotone. Determinism preserved
  (the verifier drives advance()).
- scenes/GameScene.ts: at a biome boundary, present a 2-of biome choice (reuse the mutation-picker seam +
  fountain/flask-refill timing). Default/auto-pick deterministically off the seed if no UI (headless safety).
- A biome-choice overlay (reuse entities/MutationOverlay.ts pattern, or generalise it).
- scenes/HUDScene.ts: optionally show the route/biome name (already shows depth·biome).
- i18n: en.ts + zh-CN.ts for any new biome name + the choice prompt.
- scripts/verify-gen.mjs: this is the SENSITIVE one — update the whole-run monotonicity walk to traverse the
  GRAPH (assert every reachable path has non-decreasing effectiveDifficulty AND ends at the boss biome AND every
  biome is reachable). Keep the existing per-tier walks. Do NOT weaken the proof — strengthen it to cover paths.`,
    acceptance: `Each transition offers a 2-way biome choice; every path is monotone non-decreasing and ends at
the boss. A linear default path still works. Determinism + the verifier's path-monotonicity proof + build green.`,
  },
]

function designPrompt(f) {
  return `You are the DESIGN stage of a /one-shot pipeline for the "Dead Cell" game. Write a focused, concrete
design doc for this feature, then COMMIT it.

FEATURE — ${f.title}:
${f.brief}

INTEGRATION MAP (already scouted by the orchestrator — verify against the real files, refine as needed):
${f.integration}

ACCEPTANCE TARGET:
${f.acceptance}

${CONVENTIONS}

YOUR JOB:
1. Read the relevant files listed in the integration map to ground the design in the ACTUAL code.
2. Write a design doc at docs/designs/<today's date>-${f.slug}.md following the style/structure of the existing
   docs in docs/designs/ (numbered decisions, acceptance criteria, identity-preservation notes, verifier notes).
   Keep it tight and implementable — this doc is the CONTRACT the implementer will follow.
3. Commit ONLY the design doc: git add docs/designs/<file> && git commit -m "docs: design — ${f.slug}".
   (Do NOT edit src/ in this stage.)
4. Return the doc path, the acceptance criteria list, and the concrete list of files the implementer will touch.

Be decisive (KISS/YAGNI). The doc must make the additive-identity, monotonicity, i18n, and verifier-sweep
obligations explicit so the implementer cannot miss them.`
}

function reviewPrompt(f, design) {
  return `You are the DESIGN-REVIEW stage of a /one-shot pipeline for the "Dead Cell" game. Critique the design
doc at ${design.docPath} for feature "${f.title}".

Acceptance criteria recorded by the design stage:
${(design.acceptanceCriteria || []).map((a) => '- ' + a).join('\n')}

${CONVENTIONS}

Review the doc AGAINST the real codebase (read the files it references). Flag BLOCKING issues only as mustFix —
specifically: any break of the additive identity, any monotonicity/never-weaken hole, missing verifier sweep,
missing i18n strings, broken determinism / level-pin risk, Phaser imports leaking into pure config, or a design
that duplicates an existing seam instead of reusing it. Keep non-blocking thoughts in notes. Return verdict
'approve' if it is implementable as-is, else 'revise' with a concrete mustFix list. Be terse and surgical.`
}

function implPrompt(f, design, review) {
  const mustFix = review && review.mustFix && review.mustFix.length
    ? review.mustFix.map((m) => '- ' + m).join('\n')
    : '(none — reviewer approved)'
  return `You are the IMPLEMENT stage of a /one-shot pipeline for the "Dead Cell" game. Implement feature
"${f.title}" per the committed design doc at ${design.docPath}, addressing the reviewer's blocking issues.

REVIEWER MUST-FIX:
${mustFix}

${CONVENTIONS}

PROCESS (follow exactly):
1. Read the design doc + every file it touches. Implement the feature fully and coherently across all files
   (config + RunState/MetaState + GameScene + HUD + i18n + verifier sweep).
2. Run the gates from the repo root:
     npm run verify     # determinism/bounds/pure-config gate (CI gate — MUST pass)
     npm run build      # tsc typecheck + vite build (MUST pass)
   If either fails, READ the error, fix the code, and re-run. Loop until BOTH are green (up to ~6 iterations).
3. On BOTH green: stage and commit ONLY this feature's source changes with a conventional message:
     git add -A && git commit -m "feat: <concise what — why/how for ${f.slug}>"
   Capture the commit sha (git rev-parse HEAD).
4. If you CANNOT get both gates green after your best effort: do NOT commit. Run
     git reset --hard HEAD && git clean -fd src scripts
   to restore a CLEAN tree on the last good commit (the design-doc commit), so the next feature starts clean.
   Then report committed:false with the blocking errors in remainingIssues.

CRITICAL: never commit a red build/verify. Preserve the additive identity (a default save plays unchanged).
Update scripts/verify-gen.mjs to sweep any new pure-config table. Add BOTH en.ts and zh-CN.ts strings for any
new UI text. Return the structured status (committed, commitSha, verifyPassed, buildPassed, filesChanged,
summary, remainingIssues).`
}

// ────────────────────────────────────────────────────────────────────────────
// Run: one /one-shot-style pipeline per feature, SEQUENTIAL (shared files + per-feature commit).
// ────────────────────────────────────────────────────────────────────────────
const results = []
for (const f of FEATURES) {
  phase(f.title)
  log(`${f.title}: design → review → implement → commit`)
  try {
    const design = await agent(designPrompt(f), { label: `design:${f.key}`, phase: f.title, schema: DESIGN_SCHEMA })
    if (!design) {
      log(`${f.title}: design stage returned nothing — skipping feature.`)
      results.push({ feature: f.key, status: 'design-failed' })
      continue
    }
    const review = await agent(reviewPrompt(f, design), {
      label: `review:${f.key}`,
      phase: f.title,
      agentType: 'cc-plugins:one-shot-design-reviewer',
      schema: REVIEW_SCHEMA,
    })
    const impl = await agent(implPrompt(f, design, review), { label: `impl:${f.key}`, phase: f.title, schema: IMPL_SCHEMA })
    const committed = !!(impl && impl.committed)
    log(`${f.title}: ${committed ? 'COMMITTED ' + (impl.commitSha || '') : 'NOT committed'} (verify=${impl && impl.verifyPassed}, build=${impl && impl.buildPassed})`)
    results.push({ feature: f.key, design, review, impl })
  } catch (e) {
    log(`${f.title}: pipeline threw — ${String(e && e.message ? e.message : e)}`)
    results.push({ feature: f.key, status: 'threw', error: String(e && e.message ? e.message : e) })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Final playability/completeness review — does the game now read as richly playable?
// ────────────────────────────────────────────────────────────────────────────
phase('Final Review')
const shippedList = results
  .map((r) => `${r.feature}: ${r.impl && r.impl.committed ? 'shipped' : (r.status || 'not shipped')}`)
  .join('; ')
const final = await agent(
  `You are the FINAL REVIEW of a /one-shot pipeline run on the "Dead Cell" Phaser roguelite. Four features were
attempted: ${shippedList}.

${CONVENTIONS}

Assess the CURRENT repo state (read git log, the new configs, GameScene, HUD, verifier). Confirm which of the 4
features are genuinely wired end-to-end (not just config). Run \`npm run verify\` and \`npm run build\` to confirm
the tree is green. Judge whether the game now reads as RICH + PLAYABLE in the Dead Cells sense (build identity via
color scaling, loot excitement via rarity, risk/reward via cursed chests, run agency via branching). List any
remaining high-value gaps that a follow-up pass should close. Return richEnough (true only if the shipped set is
green AND meaningfully raises playability), the shipped list, remaining gaps, and a crisp summary.`,
  { label: 'final-review', phase: 'Final Review', schema: FINAL_SCHEMA },
)

return { results, final }
