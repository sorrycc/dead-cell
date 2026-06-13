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

// ── Player max HP (Decision 44 / §6.4 — review fix: avoid the magic-100 drift) ──
// The carried-HP run state (core/RunState.js, PURE, no Phaser) and the Phaser-coupled Player both
// need the SAME starting/maximum HP. Hoisting it to this PURE constant owner means RunState can
// import it WITHOUT importing Player (which pulls in Phaser and would break the headless-import
// convention), and Player imports the same number — ONE source, no drift (DRY). The HUD reads the
// live value off the player each frame, so it stays consistent automatically.
export const PLAYER_MAX_HP = 100

// ── UI font stack (i18n — CJK support) ──
// EVERY text site uses this single constant instead of a bare 'monospace' so Chinese (zh-CN) renders.
// A bare 'monospace' falls back to a Latin-only font (Courier/Menlo) that has NO CJK glyphs → tofu boxes.
// The fallback chain keeps the programmer-art monospace look for Latin, then hands CJK glyphs to a
// system-installed CJK font (no external/bundled asset — honours the "programmer-art only" constraint,
// Decision 4). TRADE-OFF (accepted, KISS): the CJK fallback is NOT monospaced, so the Hub/Shop padEnd
// columns read slightly ragged in Chinese; English stays perfectly aligned.
export const UI_FONT = 'monospace, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
