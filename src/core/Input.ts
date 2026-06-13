import Phaser from 'phaser'

// Per-frame intent snapshot produced by Input.sample() — the FINAL field names match design §6.1.
// Player.update and other consumers read this shape; exported so they can import it (FOUNDATION role).
export interface InputSnapshot {
  moveX: number
  jumpPressed: boolean
  jumpHeld: boolean
  dodgePressed: boolean
  attackPressed: boolean
  // per-weapon-movesets §6.2 (Decision 2, AC9): the HELD state of the attack key (J / left-click), mirroring
  // jumpHeld. Drives the charge accrual + the flurry repeat in Player.update; the attackPressed EDGE is
  // unchanged (the tap path). Purely additive — a consumer that ignores it is byte-identical (identity).
  attackHeld: boolean
  // per-weapon-movesets §6.2 (Decision 5, AC8/AC9): the EDGE of the NEW parry key (V — outside the forbidden
  // set). Arms the brief parry window on the Player. Sole-owned JustDown here like every other edge.
  parryPressed: boolean
  // per-weapon-movesets §6.2 (Decision 4, AC9): the HELD DOWN/S state, read ONLY at the Sword finisher for the
  // directional ground-slam variant (DOWN/S were previously RESERVED-unused — Input.ts:65). No movement side
  // effect (the horizontal axis is right−left; this is a separate flag).
  downHeld: boolean
  healPressed: boolean
  interactPressed: boolean
  swapPressed: boolean
  mutePressed: boolean
  skill1Pressed: boolean
  skill2Pressed: boolean
}

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
//   • `jumpPressed` / `dodgePressed` / `attackPressed` are EDGE-detected via
//     Phaser.Input.Keyboard.JustDown. JustDown mutates the key's internal `_justDown` flag, so
//     calling it twice in a frame returns false the second time. Therefore THIS class is the SOLE
//     owner of the JustDown call for the jump/dodge/attack keys: GameScene calls `sample()`
//     EXACTLY ONCE per frame and stores the snapshot; nothing else (HUD, ESC handler, future
//     consumers) may call JustDown on these keys. The ESC dev hint stays on a `.once('keydown-ESC')`
//     event so it never shares the JustDown path.
//
// ── Combat phase additions (design §6.3, Decision 27, AC20) ──
//   • JUMP moves to SPACE-ONLY (it shared J in Phase 1). J is now the ATTACK key — so there is no
//     double-bind on J. Dodge stays Shift/K.
//   • `attackPressed` is the EDGE of (J key) OR (left mouse). Pointer.isDown is a HELD state, not
//     an edge, so we compute the pointer edge ourselves: `isDown && !_pointerWasDown`, updating the
//     flag at the END of sample(). FIRST-FRAME CARRY-OVER GUARD (review MAJOR #27): the click that
//     pressed START on a menu scene carries its held-down pointer state across scene.start('Game'),
//     so we INITIALIZE `_pointerWasDown` from the CURRENT pointer state in the constructor — a
//     still-held START click reads as "already down" → no edge → no spurious first-frame attack.
export class Input {
  private scene: Phaser.Scene
  private keys!: Record<string, Phaser.Input.Keyboard.Key>
  private _pointerWasDown: boolean

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    // addKeys lets us name each physical key; the snapshot derives intent from these.
    // Up/W and Down/S are RESERVED (climb / future drop-through) but intentionally unwired
    // this phase — YAGNI. Jump is Space-only now (J freed for attack); dodge is Shift OR K.
    const KC = Phaser.Input.Keyboard.KeyCodes
    this.keys = scene.input.keyboard!.addKeys({
      left: KC.LEFT,
      a: KC.A,
      right: KC.RIGHT,
      d: KC.D,
      up: KC.UP, // reserved (unused)
      w: KC.W, // reserved (unused)
      down: KC.DOWN, // reserved (future drop-through)
      s: KC.S, // reserved (future drop-through)
      space: KC.SPACE,
      j: KC.J, // ATTACK (moved off jump in the Combat phase).
      shift: KC.SHIFT,
      k: KC.K,
      q: KC.Q, // §6.9 (Decision 72) — DRINK FLASK (the between-area heal valve).
      e: KC.E, // §6.9 (Decision 74) — INTERACT (open the in-run shop / vendor when in range).
      r: KC.R, // round-3 (item 3) — SWAP WEAPON (toggle the active slot when a 2nd slot is unlocked).
      m: KC.M, // audio §6.5 (Decision 7) — toggle global mute (GameScene flips this.sound.mute).
      f: KC.F, // skills §6.2 (Decision 3) — USE SKILL slot 1 (the left-hand cluster, free of taken keys).
      c: KC.C, // skills §6.2 (Decision 3) — USE SKILL slot 2.
      v: KC.V, // per-weapon-movesets §6.2 (Decision 5) — PARRY (the ONLY new key; outside the forbidden set:
      //          arrows/WASD/Space/J/Shift/K/Q/E/R/M/F/C are all taken, V collides with none of them).
    }) as Record<string, Phaser.Input.Keyboard.Key>

    // Pointer edge state for the left-click attack (Decision 27). Seed from the CURRENT pointer
    // state so a START-click still held on the first GameScene frame does NOT read as a fresh edge.
    this._pointerWasDown = scene.input.activePointer.isDown
  }

  // Build ONE intent snapshot for this frame. Called exactly once per GameScene.update.
  // Pure read of key/pointer state → no side effects on gameplay, no physics-callback coupling.
  sample(): InputSnapshot {
    const keys = this.keys

    // Horizontal axis as (right − left): pressing both cancels to 0 (KISS, no last-key
    // tracking). `moveX ∈ {-1, 0, 1}` is what the Player integrator reads as its target dir.
    const left = keys.left.isDown || keys.a.isDown
    const right = keys.right.isDown || keys.d.isDown
    const moveX = (right ? 1 : 0) - (left ? 1 : 0)

    // jumpHeld drives the variable-height HOLD (release-cut in Player); jumpPressed is the
    // discrete down-edge the buffer/coyote logic needs. JustDown read here and ONLY here.
    // Jump is SPACE-only now (J is attack).
    const jumpHeld = keys.space.isDown
    const jumpPressed = Phaser.Input.Keyboard.JustDown(keys.space)

    // Dodge is a one-shot edge (no "held dodge"); read its down-edge once per frame.
    const dodgePressed =
      Phaser.Input.Keyboard.JustDown(keys.shift) || Phaser.Input.Keyboard.JustDown(keys.k)

    // Attack edge: J key OR a FRESH left-click (up→down). The pointer edge is computed from our
    // own previous-down flag (pointer.isDown is HELD, not an edge); the constructor seeded the flag
    // from the live pointer so a carried-over START click is never a spurious edge (Decision 27).
    const pointer = this.scene.input.activePointer
    const pointerEdge = pointer.isDown && !this._pointerWasDown
    this._pointerWasDown = pointer.isDown
    const attackPressed = Phaser.Input.Keyboard.JustDown(keys.j) || pointerEdge
    // per-weapon-movesets §6.2 (Decision 2, AC9) — the HELD state of the attack key (J key OR a held
    // left-click), mirroring jumpHeld = keys.space.isDown. NOT an edge — Player.update reads it to accrue a
    // charge / repeat a flurry while held, then fires on the release edge. Reading isDown does NOT touch the
    // JustDown flag, so the attackPressed edge above stays sole-owned + unchanged (identity).
    const attackHeld = keys.j.isDown || pointer.isDown
    // per-weapon-movesets §6.2 (Decision 5, AC8) — PARRY: a one-shot edge (JustDown, sole-owned here like every
    // other key) the Player reads to arm its brief parry window. V is the only new key (outside the forbidden set).
    const parryPressed = Phaser.Input.Keyboard.JustDown(keys.v)
    // per-weapon-movesets §6.2 (Decision 4, AC9) — the HELD DOWN/S state (previously reserved-unused). Read ONLY
    // at the Sword finisher (Player._startSwing) to pick the ground-slam variant; no movement side effect.
    const downHeld = keys.down.isDown || keys.s.isDown

    // §6.9 — one-shot EDGES (JustDown, sole-owned here like the others): DRINK FLASK (Q) + INTERACT (E).
    const healPressed = Phaser.Input.Keyboard.JustDown(keys.q)
    const interactPressed = Phaser.Input.Keyboard.JustDown(keys.e)
    // round-3 (item 3) — SWAP WEAPON (R): a one-shot edge (JustDown, sole-owned here) that toggles the
    // active weapon slot when a 2nd slot is unlocked (a no-op single-slot — the identity).
    const swapPressed = Phaser.Input.Keyboard.JustDown(keys.r)
    // audio §6.5 (Decision 7) — MUTE TOGGLE (M): a one-shot edge (JustDown, sole-owned here like the
    // others) that GameScene reads to flip the global Phaser/audio mute.
    const mutePressed = Phaser.Input.Keyboard.JustDown(keys.m)
    // skills §6.2 (Decision 3) — USE SKILL slot 1 (F) / slot 2 (C): one-shot EDGES (JustDown, sole-owned
    // here like every other key) GameScene reads to fire each skill slot. An empty / on-cooldown slot is a
    // no-op (Player.tryUseSkill), so on a skill-less run these do nothing (the additive identity, AC8).
    const skill1Pressed = Phaser.Input.Keyboard.JustDown(keys.f)
    const skill2Pressed = Phaser.Input.Keyboard.JustDown(keys.c)

    return { moveX, jumpPressed, jumpHeld, dodgePressed, attackPressed, attackHeld, parryPressed, downHeld, healPressed, interactPressed, swapPressed, mutePressed, skill1Pressed, skill2Pressed }
  }

  // Consume a PENDING interact (E) down-edge so the NEXT sample() does not read it. JustDown() mutates the key's
  // _justDown flag, so calling it here clears the edge — keeping THIS class the sole owner of the E JustDown call
  // (the invariant in the class header). Used when the shop closes via E: the same physical press both fires the
  // overlay's keydown-E (LEAVE → close) and arms JustDown(e), so without this the press would reopen the shop on
  // the next frame (the close→reopen race). A no-op when no E edge is pending (e.g. a SPACE/ENTER close).
  consumeInteract(): void {
    Phaser.Input.Keyboard.JustDown(this.keys.e)
  }
}
