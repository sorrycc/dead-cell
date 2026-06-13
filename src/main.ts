import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from './config/constants.js'
import { BootScene } from './scenes/BootScene.js'
import { TitleScene } from './scenes/TitleScene.js'
import { HubScene } from './scenes/HubScene.js'
import { GameScene } from './scenes/GameScene.js'
import { HUDScene } from './scenes/HUDScene.js'
import { GameOverScene } from './scenes/GameOverScene.js'
import { VictoryScene } from './scenes/VictoryScene.js'
import { loadMeta } from './util/save.js'
import { setLocale, detectLocale, getLocale } from './i18n/index.js'

// ── i18n boot (run BEFORE new Phaser.Game so every scene create() renders in the right locale) ──
// Use the saved preference if the player has chosen one; otherwise auto-detect from the browser
// (navigator.language → zh-CN for a Chinese browser, else en). loadMeta is Phaser-free + defensive
// (a disabled storage degrades to defaults), so this never throws. Reflect it on <html lang> too.
setLocale(loadMeta().language ?? detectLocale())
try {
  if (typeof document !== 'undefined') document.documentElement.lang = getLocale()
} catch {
  /* no-op — a non-DOM/headless host has no document; the locale is already set above. */
}

// ── Single boot site (design §6.0, Decision 1) ──
// Builds ONE Phaser.Game config and registers all seven scenes. The scene registration
// ORDER matters: the first entry (Boot) auto-starts (AC3/AC4); every other scene is inert
// until explicitly started via a transition, so the world/HUD never double-runs.
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO, // WebGL with a Canvas fallback.

  // Mount into #game (index.html). Phaser appends its <canvas> here.
  parent: 'game',

  // ── Fixed design resolution + FIT letterboxing (Decision 8) ──
  // The world is a CONSTANT 1280×720 coordinate system; Scale.FIT scales that to the
  // viewport preserving aspect (letterbox bars where needed) and CENTER_BOTH centers it.
  // This intentionally replaces Scale.RESIZE: a stable world is what tilemaps, deterministic
  // level layout, and camera.setBounds (later phases) require.
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
  },

  // ── Physics: Arcade enabled, gravity NOT set here (Decision 9) ──
  // Arcade is available to any scene that opts in, but gravity is configured PER-SCENE
  // (only GameScene, which has bodies) — menu/overlay scenes must not run a gravity world.
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },

  backgroundColor: '#0b0e14', // Dark slate so primitive rectangles read clearly.

  scene: [BootScene, TitleScene, HubScene, GameScene, HUDScene, GameOverScene, VictoryScene],
}

const game = new Phaser.Game(config)

// DEV-ONLY debug handle (stripped from the production build — Vite tree-shakes the `import.meta.env.DEV`
// branch out of `npm run build`). Exposes the live game on window so a dev/headless smoke test can inspect
// the active scene without any production coupling. NEVER read by game code.
if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env && (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env!.DEV) {
  ;(window as Window & { __game?: Phaser.Game }).__game = game
}
