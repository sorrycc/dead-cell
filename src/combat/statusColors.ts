// ── Affliction tint colours (affliction-synergy slice §6.7, Decision — one source of truth) ──
// 100% PURE module — NO Phaser import — just the four hex ints. Hoisted here so the SAME four colours feed
// THREE consumers without a third copy (DRY): the entity body-colour cascade (Enemy/Boss _updateVisual's
// resting status tint), the always-visible per-enemy `statusMarker`, and Effects' status FX pops. KISS:
// edit a colour once and every cue agrees. The verifier doesn't sweep colours, so this carries no pin.
//
// One entry per StatusKind (combat/status.js): bleed dark-red, poison sickly-green, stun grey-blue, burn
// orange. The damaging DoTs (bleed/poison/burn) read warm/green; stun reads cool grey (it's also cued by
// the FSM freeze + the body grey), so the four are distinguishable at a glance even as a tiny rectangle.

import type { StatusKind } from './status.js'

// The marker/body tint per status kind (a Phaser RGB int, 0xRRGGBB). Used by Enemy/Boss for both the
// resting body tint and the floating statusMarker.
export const STATUS_TINT: Record<StatusKind, number> = {
  bleed: 0xa93226, // dark red — the genre's blood DoT.
  poison: 0x27ae60, // sickly green — the poison DoT.
  stun: 0x95a5a6, // grey-blue — the crowd-control freeze (also cued by the FSM stop).
  burn: 0xe67e22, // orange — the ignite DoT (the Searing affix's identity, the 4th legible colour).
}
