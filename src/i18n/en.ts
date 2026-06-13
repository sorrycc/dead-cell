// ── English UI-chrome dictionary (the SOURCE locale) ──────────────────────────────────────────────
// Only the `ui` namespace lives here. Config content (weapon/mutation/… name+desc) is NOT duplicated —
// its English source is the config object's own `name`/`desc`, read via tName/tDesc's `en` fallback.
// This is also the FALLBACK every locale degrades to (i18n/index.ts: zh key missing → this → the key).

import type { Dict } from './index.js'

export const EN: Dict = {
  ui: {
    // ── Title ──
    'title.heading': 'DEAD CELL',
    'title.subtitle': 'A roguelite action-platformer',
    'title.start': 'Press SPACE / ENTER or click to ENTER HUB',

    // ── Hub ──
    'hub.title': 'HUB',
    'hub.footer': 'UP/DOWN select · SPACE/ENTER buy or start · ESC return',
    'hub.cellsHeader': 'CELLS {cells}   ·   BEST DEPTH {depth}',
    'hub.start': 'START RUN',
    'hub.language': 'LANGUAGE',
    'hub.bossCells': 'BOSS CELLS',
    'hub.tierMax': '(max {max})',
    'hub.cycleHint': '(SPACE to cycle)',
    'hub.lv': 'Lv',
    'hub.max': 'MAX',
    'hub.cellsCost': '{cost} cells',
    'hub.bpPrefix': 'BP',
    'hub.unlocked': 'UNLOCKED',
    'hub.locked': 'LOCKED',
    'hub.seededRun': 'SEEDED RUN',
    'hub.seedRandom': 'RANDOM (each run varies)',
    'hub.seedSet': '(SPACE to set)',
    'hub.seedClear': '(SPACE to clear)',
    'hub.seedPrompt': 'Enter a run seed to replay (decimal or 0x-hex). Blank = random:',

    // Blueprint kinds (the middle column of a Hub blueprint row).
    'kind.weapon': 'weapon',
    'kind.skill': 'skill',
    'kind.mutation': 'mutation',

    // Locale display names (the LANGUAGE row marks the active one).
    'locale.en': 'English',
    'locale.zh-CN': '中文',

    // ── In-game (GameScene) ──
    'game.hint':
      'MOVE arrows/WASD  JUMP Space  ATTACK J/click  DODGE Shift/K  SWAP R  [ESC] Title   |   ' +
      'DEPTH {depth} · {biome} {level}/{levels}  run 0x{runSeed}  level 0x{levelSeed}  →reach the yellow DOOR',
    'game.fastClear': 'FAST CLEAR  +{gold}g +{cells} cells',

    // ── HUD ──
    'hud.tag': 'HUD (overlay)',
    'hud.depth': 'DEPTH {depth} · {biome}',
    'hud.cells': 'CELLS {n}',
    'hud.gold': 'GOLD {n}',
    'hud.weapon': 'WEAPON {weapon}',
    'hud.flask': 'FLASK {n}/{max} [Q]',
    'hud.skill': 'SKILL {key}: {name} [{bar}]',
    'hud.skillEmpty': 'SKILL {key}: —',
    'hud.mutations': 'MUTATIONS: {list}',
    'hud.curse': 'CURSED — {n} kills left',
    'hud.timerNoBonus': 'CLEAR (no bonus)',
    'hud.timerFast': 'FAST CLEAR {secs}s',
    'hud.boss': 'BOSS',

    // ── Run-end (GameOver / Victory; shared summary labels) ──
    'over.gameOver': 'GAME OVER',
    'over.runComplete': 'RUN COMPLETE',
    'over.toHub': 'Press SPACE / click → HUB',
    'victory.title': 'VICTORY',
    'victory.flavor': 'The Warden falls. The run is yours.',
    'summary.depthReached': 'DEPTH REACHED',
    'summary.biome': 'BIOME',
    'summary.time': 'TIME',
    'summary.kills': 'KILLS',
    'summary.cellsBanked': 'CELLS BANKED',
    'summary.runSeed': 'RUN SEED',

    // ── Mutation overlay ──
    'mutation.title': 'CHOOSE A MUTATION',
    'mutation.subtitle': 'A new biome — pick one perk for the rest of the run',
    'mutation.help': 'UP/DOWN select · E/SPACE/ENTER confirm',

    // ── Colour scaling (color-scaling-stats §6, AC11) — colour names, picker chrome, HUD row label, descs. ──
    'color.brutality': 'Brutality',
    'color.tactics': 'Tactics',
    'color.survival': 'Survival',
    'color.brutality.desc': '+1 Brutality — red, melee damage',
    'color.tactics.desc': '+1 Tactics — purple, ranged & skill damage',
    'color.survival.desc': '+1 Survival — green, spear damage & +max HP',
    'color.title': 'RAISE A STAT COLOUR',
    'color.subtitle': 'A new biome — boost one stat colour for the rest of the run',
    'color.help': 'UP/DOWN select · E/SPACE/ENTER confirm',
    // Colour-scroll names (scrolls are apply-only — these mirror the others for future list rendering).
    'scroll.brutality': 'Scroll of Brutality',
    'scroll.tactics': 'Scroll of Tactics',
    'scroll.survival': 'Scroll of Survival',

    // ── Shop overlay + vendor ──
    'shop.title': 'SHOP',
    'shop.gold': 'GOLD {n}',
    'shop.leave': 'LEAVE',
    'shop.help': 'UP/DOWN select · E/SPACE/ENTER buy or LEAVE',
    'shop.prompt': '[E] SHOP',

    // ── Cursed chest (cursed-chests design §6, AC9) — the floating prompt + the on-open warning banner. ──
    'chest.prompt': '[E] CURSED CHEST',
    'chest.cursed': 'CURSED! Kill {n} enemies to break it.',

    // ── Quit-to-Title confirm overlay (esc-quit-confirm) ──
    'quit.title': 'QUIT TO MAIN MENU?',
    'quit.subtitle': 'Your current run will be lost.',
    'quit.resume': 'RESUME RUN',
    'quit.confirm': 'QUIT TO MENU',
    'quit.help': 'UP/DOWN select · E/SPACE/ENTER confirm · ESC resume',
  },
}
