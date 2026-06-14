import Phaser from 'phaser'
import { RARITIES } from '../config/rarity.js'
import type { RarityId } from '../config/rarity.js'

type PickupKind = 'cell' | 'gold' | 'scroll' | 'weapon' | 'heal' | 'skill' | 'blueprint'

// Per-pickup mutable state stored on the rect (mutated on acquire — never re-allocated).
interface PickupState {
  active: boolean
  id: number
  kind: PickupKind | null
  weaponId: string | null
  weaponAffixId: string | null
  rarityId: RarityId | null // item-rarity-forge §6 — the rarity tier rolled at placement (null = common/identity).
  scrollId: string | null
  skillId: string | null
  blueprintId: string | null // meta-progression §6.8 — the blueprint id a 'blueprint' pickup carries (null = not one).
  goldAmount: number
  healFrac: number
}

// A pool rect carries dynamic state props (`pk` / `pickupRef`) attached at construction.
type PickupRect = Phaser.GameObjects.Rectangle & { pk: PickupState; pickupRef: PickupState }

// Kind-specific data passed to acquire().
interface PickupMeta {
  weaponId?: string | null
  weaponAffixId?: string | null
  rarityId?: RarityId | null // item-rarity-forge §6 — the rarity tier for a 'weapon' pickup (null = common).
  scrollId?: string | null
  skillId?: string | null
  blueprintId?: string | null // meta-progression §6.8 — the blueprint id for a 'blueprint' pickup.
  amount?: number
  healFrac?: number
}

// ── Pooled pickup (design §6.5, Decision 54, AC48) ──
// Phaser-COUPLED. A POOLED pickup — the SAME mandated pooling convention as HitboxPool / ParticlePool
// / ProjectilePool: a FIXED set of pre-created rectangle+sensor-body members, acquired/released, ZERO
// per-pickup allocation after warm-up. A pickup is a KIND tag + a tiny arc-then-settle (KISS — no full
// physics, just a one-shot upward velocity that gravity pulls back down onto whatever's below; the
// body sits as a SENSOR so it only OVERLAPS the player, never separates).
//
// KINDS (Decision 54/55/63): 'cell' (meta currency — banked), 'gold' (run-only), 'scroll' (run-only
// stat boost, carries a scrollId), 'weapon' (swaps the equipped weapon, carries a weaponId). Colors
// are primitives: cyan Cell, gold gold, magenta scroll, white weapon.
//
// DECOUPLING (Decision 54): the pool knows NOTHING about currencies/weapons/scrolls — GameScene wires
// ONE overlap (player.collider, pool.group) and the CALLBACK reads `rect.pk.kind` (+ weaponId/scrollId)
// to resolve collection, then release()s the pickup. So Enemy.js stays self-contained (it only fires a
// coordinate hook — Decision 54) and the economy logic lives in ONE place (the scene).
//
// HIT-STOP BOUNDARY: pickups arc under ARCADE gravity (the world physics step), independent of the
// gameplay-dt freeze — they're cosmetic settling, not combat, so a micro-freeze needn't pause them.
// They PERSIST across level rebuilds (the pool is scene-owned); live pickups are released on teardown.

const PICKUP_COLORS = {
  cell: 0x4dd0e1, // cyan — the meta currency (Cells).
  gold: 0xf1c40f, // gold — the run-only currency.
  scroll: 0xc26bff, // magenta — a run-only stat boost.
  weapon: 0xecf0f1, // white — a weapon swap.
  heal: 0x2ecc71, // green — §6.9 (Decision 72): a fountain/heart that restores HP on touch.
  skill: 0xff9f43, // orange — skills slice: a skill pickup (the loadout layer; distinct from weapon white).
  blueprint: 0x5dade2, // sky-blue — meta-progression §6.8: a blueprint drop (a special run-pool unlock find).
}
const PICKUP_SIZE = 16 // px — a small square pickup (programmer-art primitive).
const ARC_VELOCITY_Y = -260 // px/s — the upward pop on spawn (gravity pulls it back to settle).
const ARC_VELOCITY_X = 90 // px/s — a small random horizontal scatter so a multi-drop fans out.
const GOLD_AMOUNT = 5 // gold granted per gold pickup (run-only currency).
const GOLD_DROP_CHANCE = 0.6 // chance an enemy death also drops a gold pickup (run-only).
const SCROLL_DROP_CHANCE = 0.12 // rarer — chance a death drops a run-only scroll boost.
const HEAL_PICKUP_FRAC = 0.35 // §6.9 (Decision 72) — a heal pickup restores this fraction of MAX HP.

let _nextPickupId = 1 // monotonic id (handy for debugging; not load-bearing).

export class PickupPool {
  private scene: Phaser.Scene
  group: Phaser.Physics.Arcade.Group
  private _items: PickupRect[]

  // scene: the GameScene. size: pool high-water — a generous handful (enemy drops + generator pickups
  // are sparse and collected fast; recycling the oldest on exhaustion is cosmetic-only, never a leak).
  constructor(scene: Phaser.Scene, size = 32) {
    this.scene = scene

    // The overlap group GameScene registers against the player collider. Members ARE affected by
    // gravity (so they arc + settle) but are immovable sensors (overlap only — no separation).
    this.group = scene.physics.add.group({ allowGravity: true })

    this._items = []
    for (let i = 0; i < size; i++) {
      const rect = scene.add.rectangle(0, 0, PICKUP_SIZE, PICKUP_SIZE, 0xffffff).setVisible(false).setDepth(40) as PickupRect
      this.group.add(rect)
      const body = rect.body as Phaser.Physics.Arcade.Body
      body.setSize(PICKUP_SIZE, PICKUP_SIZE, true)
      // Per-pickup state, mutated on acquire (never re-allocated → no per-pickup GC). weaponAffixId is the
      // Enrichment round-2 weapon affix rolled at placement (null = a plain weapon — the identity).
      rect.pk = { active: false, id: 0, kind: null, weaponId: null, weaponAffixId: null, rarityId: null, scrollId: null, skillId: null, blueprintId: null, goldAmount: 0, healFrac: 0 }
      rect.pickupRef = rect.pk // back-ref so the overlap callback resolves the pickup from its body.
      this._disable(rect)
      this._items.push(rect)
    }
  }

  // ── acquire(x, y, kind, meta) ── position a pickup at (x,y), give it the arc pop, tag it. `meta`
  // carries kind-specific data: { weaponId } for 'weapon', { scrollId } for 'scroll'. Returns the rect
  // (or null if exhausted — recycle the oldest below so a drop is never lost in normal play).
  acquire(x: number, y: number, kind: PickupKind, meta: PickupMeta = {}): PickupRect {
    let rect = this._items.find((r) => !r.pk.active)
    if (!rect) {
      // Pool full: recycle the first (oldest-ish) — cosmetic loss only, never a leak.
      rect = this._items[0]
      this._disable(rect)
    }

    const body = rect.body as Phaser.Physics.Arcade.Body
    body.reset(x, y)
    body.enable = true
    // Arc pop: a fixed upward velocity + a small random horizontal scatter so a multi-drop fans out.
    body.setVelocity((Math.random() - 0.5) * 2 * ARC_VELOCITY_X, ARC_VELOCITY_Y)

    // ── Fill + rarity tint/stroke (item-rarity-forge §6, Decision 7) ── a non-common WEAPON pickup tints by
    // the tier's tint + draws a 2px stroke in the same tint so rarer loot POPS (programmer-art — no assets). A
    // common/null rarity OR any non-weapon kind keeps the kind's base fill + NO stroke (the identity). The
    // stroke MUST be reset on EVERY acquire (not only in _disable): a rect is recycled via acquire under
    // pool-exhaustion (which bypasses a fresh _disable for the recycled member), so without clearing the stroke
    // here a rect that previously held a legendary weapon would leak its gold border onto a common/Cell/gold
    // pickup (reviewer must-fix). So: set the stroke for a non-common weapon, explicitly clear it otherwise.
    const rarityId = (kind === 'weapon' ? meta.rarityId : null) ?? null
    const rarityTint = rarityId && rarityId !== 'common' ? RARITIES[rarityId].tint : null
    const color = rarityTint ?? PICKUP_COLORS[kind] ?? 0xffffff
    rect.setFillStyle(color)
    if (rarityTint !== null) rect.setStrokeStyle(2, rarityTint) // rarer loot gets a thin coloured border.
    else rect.setStrokeStyle() // clear any stale border (common/null/non-weapon — the identity look).
    rect.setPosition(x, y)
    rect.setVisible(true)

    const pk = rect.pk
    pk.active = true
    pk.id = _nextPickupId++
    pk.kind = kind
    pk.weaponId = meta.weaponId ?? null
    pk.weaponAffixId = meta.weaponAffixId ?? null // round-2 — the weapon affix rolled at placement (null = plain).
    pk.rarityId = rarityId // item-rarity-forge §6 — the weapon's rarity tier (null = common/non-weapon — identity).
    pk.scrollId = meta.scrollId ?? null
    pk.skillId = meta.skillId ?? null // skills slice — the skill id for a 'skill' pickup (null = not a skill).
    pk.blueprintId = meta.blueprintId ?? null // meta-progression §6.8 — the blueprint id for a 'blueprint' pickup.
    pk.goldAmount = kind === 'gold' ? (meta.amount ?? GOLD_AMOUNT) : 0
    pk.healFrac = kind === 'heal' ? (meta.healFrac ?? HEAL_PICKUP_FRAC) : 0 // §6.9 — fraction of max HP a heal restores.
    return rect
  }

  // ── spawnDrop(x, y, depth, cellCount, lootMult) ── the enemy-death drop (Decision 54): `cellCount` Cell
  // pickups ALWAYS (the count Enemy.dropCells() returned — threaded through enemy.onDrop), plus a
  // chance of a gold pickup and a rarer scroll. Called from GameScene's `enemy.onDrop` hook with the
  // death CENTER coords (captured before the body is disabled — see Enemy._die). Uses Math.random
  // (drops are cosmetic churn, NOT part of the seeded level layout — keeping them off the pinned
  // generator RNG preserves the level regression pin, per the §6.5 BLOCKER resolution: scroll/weapon
  // pickups are sourced from the DROP path / a scene-side chance, NOT the generator).
  //
  // ── lootMult (Enrichment round-3 BUG fix, §6.15) ── the ROOM's loot multiplier (1 = a normal room — the
  // identity). roomTypes.js documents ELITE/HORDE/CURSED as RICHER to clear, but lootMult only ever scaled
  // the single entry reward — the per-kill drop ignored it, so a wall of elites paid the same as a normal
  // room. We thread it in here: it scales BOTH the Cell count (round up the boosted count → more meta
  // currency) AND the gold drop (a richer gold pile when one drops), so a tagged room's CLEAR is materially
  // richer (the payout that justifies the harder fight). Default 1 → byte-identical to before for a normal room.
  // ── dropRateMult (F3 skills-mutations §3, Decision 6 — Scavenger) ── a SEPARATE run-only multiplier (1 = the
  // neutral identity) kept DISTINCT from the room's `lootMult` so the room behaviour is byte-unchanged: lootMult
  // scales the cell count + the gold AMOUNT exactly as before; dropRateMult scales the cell count AND raises the
  // gold/scroll drop CHANCE (the Scavenger payoff — more drops, not just bigger piles). Both default 1 → a default
  // save (no Scavenger, any room) drops byte-identically. The chance boost is capped at certainty (Math.min(1,…)).
  spawnDrop(x: number, y: number, depth = 0, cellCount = 3, lootMult = 1, dropRateMult = 1) {
    const cells = Math.max(1, Math.round(cellCount * lootMult * dropRateMult)) // room lootMult × Scavenger drop rate.
    for (let i = 0; i < cells; i++) this.acquire(x, y, 'cell') // the fan-out scatters them apart.
    if (Math.random() < Math.min(1, GOLD_DROP_CHANCE * dropRateMult)) this.acquire(x, y, 'gold', { amount: Math.round(GOLD_AMOUNT * lootMult) })
    if (Math.random() < Math.min(1, SCROLL_DROP_CHANCE * dropRateMult)) this.acquire(x, y, 'scroll', { scrollId: _pickScrollId() })
  }

  // Tick: keep the visible rect glued to its (gravity-settled) body, and clamp a settled pickup so it
  // doesn't jitter (Arcade keeps it resting on the floor below it via the scene's solids collider).
  tick() {
    for (const rect of this._items) {
      if (!rect.pk.active) continue
      const body = rect.body as Phaser.Physics.Arcade.Body
      rect.setPosition(body.center.x, body.center.y)
    }
  }

  // Release a collected pickup back into the pool.
  release(rect: PickupRect) {
    if (rect && rect.pk.active) this._disable(rect)
  }

  // Release ALL live pickups (level rebuild teardown — they don't carry across levels).
  releaseAll() {
    for (const rect of this._items) if (rect.pk.active) this._disable(rect)
  }

  _disable(rect: PickupRect) {
    rect.pk.active = false
    rect.pk.kind = null
    rect.pk.weaponId = null
    rect.pk.weaponAffixId = null
    rect.pk.rarityId = null
    rect.pk.scrollId = null
    rect.pk.skillId = null
    rect.pk.blueprintId = null
    rect.pk.healFrac = 0
    rect.setStrokeStyle() // item-rarity-forge §6 (Decision 7) — clear a rarity border so a recycled rect is clean.
    const body = rect.body as Phaser.Physics.Arcade.Body
    body.setVelocity(0, 0)
    body.enable = false
    body.reset(-1000, -1000)
    rect.setVisible(false)
  }
}

// ── Pick a random scroll id (drops are cosmetic churn, off the seeded level RNG — see spawnDrop). ──
// Kept here (not in the hot scene) so the import lives next to its single use. SCROLL_IDS is pure config.
import { SCROLL_IDS } from '../config/scrolls.js'
function _pickScrollId() {
  return SCROLL_IDS[Math.floor(Math.random() * SCROLL_IDS.length)]
}
