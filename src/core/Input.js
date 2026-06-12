import Phaser from 'phaser'

// ── Input layer (design §6.1, Decisions 11/13/14 consumers) ──
// The SINGLE owner of keyboard bindings (DRY): no scene or entity hard-codes keycodes.
// Built on Phaser's keyboard plugin (`scene.input.keyboard`) so the bindings live and die
// with the scene that created them — Phaser-native equivalent of crowd-runner's
// core/Input.js role (one place maps physical keys to an intent snapshot).
//
// Contract (review fixes baked in):
//   • `sample()` returns a fresh per-frame snapshot `{ moveX, jumpPressed, jumpHeld,
//     dodgePressed }`. The field names are FINAL and match the design §6.1 API spec, the
//     §7 Files entry, and Player.update — the earlier doc-internal name mismatch
//     (`jumpDown`/`dodgeDown`) is resolved in favour of the edge-detected reading.
//   • `jumpPressed` / `dodgePressed` are EDGE-detected via Phaser.Input.Keyboard.JustDown.
//     JustDown mutates the key's internal `_justDown` flag, so calling it twice in a frame
//     returns false the second time. Therefore THIS class is the SOLE owner of the JustDown
//     call for the jump/dodge keys: GameScene calls `sample()` EXACTLY ONCE per frame and
//     stores the snapshot; nothing else (HUD, ESC handler, future consumers) may call
//     JustDown on these keys. The ESC dev hint stays on a `.once('keydown-ESC')` event so it
//     never shares the JustDown path.
export class Input {
  constructor(scene) {
    // addKeys lets us name each physical key; the snapshot derives intent from these.
    // Up/W and Down/S are RESERVED (climb / future drop-through) but intentionally unwired
    // this phase — YAGNI. Multiple physical keys map to one intent (Space OR J, Shift OR K).
    const KC = Phaser.Input.Keyboard.KeyCodes
    this.keys = scene.input.keyboard.addKeys({
      left: KC.LEFT,
      a: KC.A,
      right: KC.RIGHT,
      d: KC.D,
      up: KC.UP, // reserved (unused Phase 1)
      w: KC.W, // reserved (unused Phase 1)
      down: KC.DOWN, // reserved (future drop-through)
      s: KC.S, // reserved (future drop-through)
      space: KC.SPACE,
      j: KC.J,
      shift: KC.SHIFT,
      k: KC.K,
    })
  }

  // Build ONE intent snapshot for this frame. Called exactly once per GameScene.update.
  // Pure read of key state → no side effects on gameplay, no physics-callback coupling.
  sample() {
    const keys = this.keys

    // Horizontal axis as (right − left): pressing both cancels to 0 (KISS, no last-key
    // tracking). `moveX ∈ {-1, 0, 1}` is what the Player integrator reads as its target dir.
    const left = keys.left.isDown || keys.a.isDown
    const right = keys.right.isDown || keys.d.isDown
    const moveX = (right ? 1 : 0) - (left ? 1 : 0)

    // jumpHeld drives the variable-height HOLD (release-cut in Player); jumpPressed is the
    // discrete down-edge the buffer/coyote logic needs. JustDown is read here and ONLY here.
    const jumpHeld = keys.space.isDown || keys.j.isDown
    const jumpPressed =
      Phaser.Input.Keyboard.JustDown(keys.space) || Phaser.Input.Keyboard.JustDown(keys.j)

    // Dodge is a one-shot edge (no "held dodge"); read its down-edge once per frame.
    const dodgePressed =
      Phaser.Input.Keyboard.JustDown(keys.shift) || Phaser.Input.Keyboard.JustDown(keys.k)

    return { moveX, jumpPressed, jumpHeld, dodgePressed }
  }
}
