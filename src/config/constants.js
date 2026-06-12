// ── Global game constants (design §6.0, Decision 8 & 9) ──
// PURE module — no Phaser import — so it is safe to consume from headless scripts
// (scripts/verify-gen.mjs) AND from any scene. This is the SINGLE owner of the design
// resolution and the world gravity, resolving the Phase-0 ambiguity flagged in review:
// constants that more than one site needs (main.js sizing the canvas, GameScene seeding
// its physics world) live here exactly once (DRY) instead of being inlined and drifting.

// ── Fixed design resolution (Decision 8) ──
// A roguelite platformer needs a FIXED world coordinate system: deterministic level
// layout, camera.setBounds, and tile math all assume stable dimensions. We render at a
// constant 1280×720 and let Phaser.Scale.FIT letterbox it to the viewport (see main.js).
// This deliberately REPLACES Scale.RESIZE — RESIZE re-sizes the world on every window
// resize and gives entities positioned from viewport dimensions a moving target, which
// later phases (tilemaps, camera bounds) would have to fight. Choosing it now is cheap;
// retrofitting it later is not.
export const DESIGN_WIDTH = 1280
export const DESIGN_HEIGHT = 720

// ── World gravity (Decision 9) ──
// Downward acceleration in px/s². Applied PER-SCENE (only GameScene, the one scene with
// bodies, turns it on) rather than globally in the Phaser.Game config — menu/overlay
// scenes (Title/Hub/HUD/GameOver/Victory) have no bodies and must not run a gravity-
// enabled Arcade world (YAGNI/SOLID). Tuned in Phase 1 alongside jump/run feel.
export const GRAVITY = 1500
