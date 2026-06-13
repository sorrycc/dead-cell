// ── Room-type table (Enrichment round-2 — tagged special rooms, §6.15) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node and
// asserts the table is well-formed (a non-empty weighted set, sane modifier ranges). Mirrors the project's
// other pure config tables (biomes/enemies/weapons/bosses): the room type is PLAIN DATA the GameScene reads
// to FLAVOUR a normal level — more elites, more enemies, richer loot, an optional debuff — reusing the
// EXISTING elite-affix, enemyCountBonus, and pickup systems (mostly scene wiring + this tiny table).
//
// THE GAP IT CLOSES: a run was 12 structurally-identical rooms + one boss, the only spice a per-level
// treasure branch + a shop roll. Dead Cells uses TAGGED room types (elite room, horde, cursed chest) to
// vary PACING. We tag a small fraction of NORMAL levels (the miniboss + boss levels are never tagged — they
// already ARE the set-piece) with a room type rolled off the LEVEL seed (a fresh sub-RNG, OFF the generator's
// pinned draw — the same discipline as the weapon pickup / shop, so the level regression pin stays intact).
// Most levels stay 'normal' (the identity — byte-unchanged), so the tags read as a spike, not the baseline.
//
// THE ROOM-TYPE FIELDS (GameScene._applyRoomType reads these; all optional — an absent field is neutral):
//   id              — the room-type id (for the verifier sweep + the HUD banner).
//   name            — the human banner shown when the room is entered (a brief tell so the type reads).
//   bannerColor     — the camera-flash / banner tint (a readable colour per type — elite gold, cursed purple).
//   w               — the weighted-pick weight (room types are picked off the seed via these weights).
//   forceElite      — force EVERY enemy spawn in the room to roll an elite (the elite-ARENA — a wall of
//                     affixed enemies; reuses the existing elite-affix fold with the roll gate skipped).
//   extraEnemies    — ADD this many extra enemies on top of the depth bonus (the HORDE — drawn from the
//                     generator's spawnCandidates surplus, capped at the biome max, like enemyCountBonus).
//   lootMult        — multiply the room's loot (extra gold/cell drops) — the risk/reward payout. The
//                     elite/cursed rooms drop richer (a reason to take the harder fight).
//   playerDamageTakenMult — a DEBUFF: the player takes this ×damage for the room (the CURSED room's risk;
//                     1 = neutral). Read at the player-hit site (a per-room mult, reset on level rebuild).
//   guaranteedReward— place a guaranteed bonus reward (a fat gold / a scroll) on clear — the room's carrot.

// The room-type data shape — the FOUNDATION spec consumers (GameScene._applyRoomType) read. All flavour
// fields are optional (an absent field is neutral); id/name/bannerColor/w are present on every room type.
export interface RoomType {
  id: string
  name: string
  bannerColor: number
  w: number
  forceElite?: boolean
  extraEnemies?: number
  lootMult?: number
  playerDamageTakenMult?: number
  guaranteedReward?: string
}

// An entry in the weighted roll set (ROOM_TYPES): the room type + its pick weight.
export interface RoomTypeEntry {
  type: RoomType
  w: number
}

// NORMAL — the untagged baseline (the identity — no modifiers). The highest weight so most rooms are normal
// and the special tags read as a spike. A 'normal' room applies NOTHING (GameScene's _applyRoomType no-ops).
export const ROOM_NORMAL: RoomType = {
  id: 'normal',
  name: '',
  bannerColor: 0xffffff,
  w: 6,
}

// ELITE ARENA — a guaranteed wall of affixed enemies + richer loot. The genre's "elite room": a harder fight
// for a better payout. forceElite makes every spawn roll an affix; lootMult sweetens the clear.
export const ROOM_ELITE: RoomType = {
  id: 'elite',
  name: 'ELITE ARENA',
  bannerColor: 0xf1c40f, // gold — the elite tell.
  w: 2,
  forceElite: true,
  lootMult: 1.5,
  guaranteedReward: 'gold', // a fat gold payout on entry (the carrot for the harder room).
}

// HORDE — a crowded room: extra enemies (a density spike). The "they just keep coming" pacing beat. Reuses
// the spawnCandidates surplus (so the extra spawns are real standable cells, never floating). A touch richer.
export const ROOM_HORDE: RoomType = {
  id: 'horde',
  name: 'HORDE',
  bannerColor: 0xe67e22, // orange — the swarm tell.
  w: 2,
  extraEnemies: 3,
  lootMult: 1.3,
}

// CURSED — more loot, but the player takes more damage for the room (a risk/reward gamble — the genre's
// cursed chest as a room). The debuff resets on the next level (it's a per-room curse, not permanent).
export const ROOM_CURSED: RoomType = {
  id: 'cursed',
  name: 'CURSED',
  bannerColor: 0x8e44ad, // purple — the curse tell.
  w: 1,
  lootMult: 2.0, // the biggest payout (the reason to risk it).
  playerDamageTakenMult: 1.4, // the curse: +40% damage taken for this room.
  guaranteedReward: 'scroll', // a guaranteed run-only scroll (build power) for braving the curse.
}

// ── ROOM_TYPES (the weighted roll set) ── GameScene picks ONE off the level seed via the weights (the SAME
// weighted-pick idiom as enemyPool / ELITE_AFFIXES / WEAPON_AFFIXES — DRY). 'normal' dominates so the tags
// are a spike. The non-normal types only fire on NORMAL levels (miniboss/boss levels are never tagged).
export const ROOM_TYPES: RoomTypeEntry[] = [
  { type: ROOM_NORMAL, w: ROOM_NORMAL.w },
  { type: ROOM_ELITE, w: ROOM_ELITE.w },
  { type: ROOM_HORDE, w: ROOM_HORDE.w },
  { type: ROOM_CURSED, w: ROOM_CURSED.w },
]

// id → room-type lookup (for any id-keyed read + the verifier). KISS: a flat map mirroring the other tables.
export const ROOM_TYPES_BY_ID: Record<string, RoomType> = Object.fromEntries(ROOM_TYPES.map((e) => [e.type.id, e.type]))

// The ordered list (for the verifier sweep + any list rendering).
export const ROOM_TYPE_ORDER: RoomType[] = ROOM_TYPES.map((e) => e.type)
