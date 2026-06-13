// ── 简体中文 (zh-CN) dictionary ───────────────────────────────────────────────────────────────────
// UI chrome (`ui`) + content overrides for the 11 user-facing config categories, keyed by each entry's
// stable `id` (tiers keyed by String(index) → '0'/'1'/'2'). Any missing key falls back to English
// (i18n/index.ts). Config files keep English as the source of truth — these are overrides only.
// `scroll` is intentionally absent (scrolls are apply-only — no name/desc ever renders to the player).
//
// NOTE on alignment: the Hub/Shop list columns are pixel-anchored (each cell is its own fixed-x Text —
// HubScene COL_*, ShopOverlay COL_*_DX), so they align under the proportional CJK fallback font regardless
// of locale. Keyboard tokens (SPACE, [Q], WASD, [ESC], R, J) stay literal — they name physical keys.

import type { Dict } from './index.js'

export const ZH_CN: Dict = {
  ui: {
    // ── 标题 ──
    'title.heading': 'DEAD CELL',
    'title.subtitle': '一款 roguelite 动作平台游戏',
    'title.start': '按 SPACE / ENTER 或点击进入大厅',

    // ── 大厅 ──
    'hub.title': '大厅',
    'hub.footer': '上/下 选择 · SPACE/ENTER 购买或开始 · ESC 返回',
    'hub.cellsHeader': '细胞 {cells}   ·   最深 {depth}',
    'hub.start': '开始游戏',
    'hub.language': '语言',
    'hub.bossCells': '首领细胞',
    'hub.tierMax': '(最高 {max})',
    'hub.cycleHint': '(SPACE 切换)',
    'hub.lv': '等级',
    'hub.max': '已满',
    'hub.cellsCost': '{cost} 细胞',
    'hub.bpPrefix': '蓝图',
    'hub.unlocked': '已解锁',
    'hub.locked': '未解锁',
    'hub.seededRun': '种子局',
    'hub.seedRandom': '随机（每局不同）',
    'hub.seedSet': '(SPACE 设置)',
    'hub.seedClear': '(SPACE 清除)',
    'hub.seedPrompt': '输入要重玩的种子（十进制或 0x 十六进制）。留空 = 随机：',

    'kind.weapon': '武器',
    'kind.skill': '技能',
    'kind.mutation': '突变',

    'locale.en': 'English',
    'locale.zh-CN': '中文',

    // ── 游戏内 ──
    'game.hint':
      '移动 方向键/WASD  跳跃 Space  攻击 J/点击  闪避 Shift/K  切换 R  [ESC] 标题   |   ' +
      '深度 {depth} · {biome} {level}/{levels}  run 0x{runSeed}  level 0x{levelSeed}  →前往黄色的门',
    'game.fastClear': '快速通关  +{gold}金 +{cells} 细胞',

    // ── HUD ──
    'hud.tag': 'HUD（覆盖层）',
    'hud.depth': '深度 {depth} · {biome}',
    'hud.cells': '细胞 {n}',
    'hud.gold': '金币 {n}',
    'hud.weapon': '武器 {weapon}',
    'hud.flask': '药剂 {n}/{max} [Q]',
    'hud.skill': '技能 {key}: {name} [{bar}]',
    'hud.skillEmpty': '技能 {key}: —',
    'hud.mutations': '突变: {list}',
    'hud.curse': '诅咒 —— 还需击杀 {n} 个',
    'hud.timerNoBonus': '通关（无奖励）',
    'hud.timerFast': '快速通关 {secs}s',
    'hud.boss': '首领',

    // ── 结算（失败 / 胜利） ──
    'over.gameOver': '游戏结束',
    'over.runComplete': '通关',
    'over.toHub': '按 SPACE / 点击 → 大厅',
    'victory.title': '胜利',
    'victory.flavor': '守望者倒下了。这一局属于你。',
    'summary.depthReached': '到达深度',
    'summary.biome': '生物群系',
    'summary.time': '用时',
    'summary.kills': '击杀',
    'summary.cellsBanked': '存入细胞',
    'summary.runSeed': '本局种子',

    // ── 突变选择 ──
    'mutation.title': '选择一个突变',
    'mutation.subtitle': '进入新的生物群系 —— 选择一个本局永久强化',
    'mutation.help': '上/下 选择 · E/SPACE/ENTER 确认',

    // ── 颜色加成 (color-scaling-stats §6, AC11) —— 颜色名、选择弹窗、HUD 行标签、描述 ──
    'color.brutality': '残暴',
    'color.tactics': '战术',
    'color.survival': '生存',
    'color.brutality.desc': '+1 残暴 —— 红色，近战伤害',
    'color.tactics.desc': '+1 战术 —— 紫色，远程与技能伤害',
    'color.survival.desc': '+1 生存 —— 绿色，长矛伤害与最大生命',
    'color.title': '提升一种属性颜色',
    'color.subtitle': '进入新的生物群系 —— 本局永久提升一种属性颜色',
    'color.help': '上/下 选择 · E/SPACE/ENTER 确认',

    // ── 路线选择 (F4 branching-biome-map §9, AC7) —— 分岔处的双向路线选择 ──
    'biomechoice.title': '选择路线',
    'biomechoice.subtitle': '前路分岔 —— 选择下一个生物群系',
    'biomechoice.help': '上/下 选择 · E/SPACE/ENTER 确认',
    'biomechoice.hint': '威胁等级 {tier}',
    'scroll.brutality': '残暴卷轴',
    'scroll.tactics': '战术卷轴',
    'scroll.survival': '生存卷轴',

    // ── 商店 / 商人 ──
    'shop.title': '商店',
    'shop.gold': '金币 {n}',
    'shop.leave': '离开',
    'shop.help': '上/下 选择 · E/SPACE/ENTER 购买或离开',
    'shop.prompt': '[E] 商店',

    // ── 诅咒宝箱 (cursed-chests design §6, AC9) —— 悬浮提示 + 开启时的警告横幅 ──
    'chest.prompt': '[E] 诅咒宝箱',
    'chest.cursed': '已被诅咒！击杀 {n} 个敌人以解除。',

    // ── 退出到主菜单确认弹窗 (esc-quit-confirm) ──
    'quit.title': '退出到主菜单？',
    'quit.subtitle': '当前这局进度将丢失。',
    'quit.resume': '继续游戏',
    'quit.confirm': '退出到菜单',
    'quit.help': '上/下 选择 · E/SPACE/ENTER 确认 · ESC 继续',
  },

  // ── 武器 (config/weapons.ts) ──
  weapon: {
    sword: { name: '剑' },
    hammer: { name: '战锤' },
    bow: { name: '弓' },
    spear: { name: '长矛' },
    glaive: { name: '长柄刀' },
  },

  // ── 武器词缀 (config/weapons.ts) ──
  affix: {
    keen: { name: '锋利' },
    heavy: { name: '沉重' },
    swift: { name: '迅捷' },
    vampiric: { name: '吸血' },
    venomous: { name: '剧毒' },
    searing: { name: '灼烧' },
  },

  // ── 武器稀有度 (config/rarity.ts) — common 不显示后缀，仅为完整性保留 ──
  rarity: {
    common: { name: '普通' },
    rare: { name: '稀有' },
    epic: { name: '史诗' },
    legendary: { name: '传说' },
  },

  // ── 突变 (config/mutations.ts) ──
  mutation: {
    berserker: { name: '狂战士', desc: '生命值低于 40% 时伤害 +30%' },
    vampire: { name: '吸血鬼', desc: '治疗造成近战伤害的 12%' },
    predator: { name: '掠食者', desc: '每次击杀回复 3 点生命' },
    assassin: { name: '刺客', desc: '对满血敌人伤害 +40%' },
    toxic: { name: '剧毒', desc: '状态效果持续时间 +50%' },
    nimble: { name: '灵巧', desc: '闪避冷却 -20%' },
    brutality: { name: '残暴', desc: '所有伤害 +20%' },
    ironhide: { name: '铁甲', desc: '治疗药剂 +1 次' },
    hemorrhage: { name: '出血', desc: '对中异常的敌人伤害 +25%；击杀传播异常' },
    virulent: { name: '恶性', desc: '异常每跳伤害 +50%' },
    glasscannon: { name: '玻璃大炮', desc: '所有伤害 +50%' },
  },

  // ── 技能 (config/skills.ts) ──
  skill: {
    knives: { name: '飞刀', desc: '投出 3 把扇形飞刀' },
    iceShards: { name: '冰锥', desc: '喷射 5 枚冰冻碎片' },
    frostGrenade: { name: '冰霜手雷', desc: '范围冰冻爆炸' },
    firebomb: { name: '火焰弹', desc: '范围灼烧爆炸' },
    turret: { name: '炮塔', desc: '部署一座自动开火的炮塔' },
    shockwave: { name: '冲击波', desc: '高威力范围击退爆炸' },
  },

  // ── 首领 / 精英首领 (config/bosses.ts) ──
  boss: {
    rampartsBoss: { name: '守望者' },
    rampartsBoss2: { name: '空洞哨兵' },
    rampartsBoss3: { name: '钢铁暴君' },
    prisonMiniboss: { name: '狱卒' },
    sewersMiniboss: { name: '溺亡者' },
    catacombsMiniboss: { name: '白骨守望者' },
  },

  // ── 生物群系 (config/biomes.ts) ──
  biome: {
    prison: { name: '监狱' },
    sewers: { name: '下水道' },
    catacombs: { name: '地下墓穴' },
    ossuary: { name: '藏骸所' }, // F4 branching-biome-map — the new alternate mid biome (parallel to Catacombs).
    ramparts: { name: '城墙' },
  },

  // ── 永久升级 (config/upgrades.ts) ──
  upgrade: {
    maxHp: { name: '+最大生命', desc: '每级 +20 最大生命' },
    meleeDmg: { name: '+近战伤害', desc: '每级近战伤害 +15%' },
    dodgeCd: { name: '-闪避冷却', desc: '每级闪避冷却 -15%' },
    startWeapon: { name: '初始武器', desc: '1 级战锤 · 2 级弓' },
    rangedDmg: { name: '+远程伤害', desc: '每级远程（弓）伤害 +15%' },
    dodgeIframe: { name: '+闪避无敌帧', desc: '每级闪避无敌 +0.03 秒' },
    startGold: { name: '初始金币', desc: '每级 +40 初始金币' },
    startScrolls: { name: '初始卷轴', desc: '每级 +1 开局卷轴' },
    flaskTier: { name: '强化药剂', desc: '每级 +1 次且治疗量 +10%' },
    weaponSlot: { name: '第二武器槽', desc: '携带第二把武器（R 键切换）' },
  },

  // ── 蓝图 (config/blueprints.ts) ──
  blueprint: {
    bp_weapon_glaive: { name: '长柄刀', desc: '为武器池加入一把横扫长柄刀。' },
    bp_skill_shockwave: { name: '冲击波', desc: '一记高威力范围击退爆炸。' },
    bp_mutation_glasscannon: { name: '玻璃大炮', desc: '一个高伤害的玻璃大炮强化。' },
  },

  // ── 商店物品 (config/shop.ts) ──
  shop: {
    heal: { name: '治疗药水', desc: '回复 35% 最大生命' },
    flaskCharge: { name: '药剂补充', desc: '+1 次治疗药剂' },
    scroll: { name: '神秘卷轴', desc: '获得一个随机本局强化' },
    weaponSpear: { name: '商人长矛', desc: '换装为长矛' },
    skillKnives: { name: '飞刀', desc: '装备飞刀技能' },
    skillFrost: { name: '冰霜手雷', desc: '装备范围冰冻技能' },
    forgeReroll: { name: '锻造：重铸词缀', desc: '重新随机当前武器词缀' },
    forgeUpgrade: { name: '锻造：提升稀有度', desc: '将当前武器稀有度提升一级' },
  },

  // ── 首领细胞难度 (config/tiers.ts) — keyed by String(index) ──
  tier: {
    '0': { name: '0 首领细胞', desc: '基础难度。' },
    '1': { name: '1 首领细胞', desc: '更强更密集的敌人；少一次药剂。' },
    '2': { name: '2 首领细胞', desc: '远为强大；少一次药剂。' },
  },

  // ── 特殊房间 (config/roomTypes.ts) — only the tagged types ('normal' has no banner) ──
  roomType: {
    elite: { name: '精英竞技场' },
    horde: { name: '兽潮' },
    cursed: { name: '诅咒' },
  },
}
