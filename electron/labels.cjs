'use strict';
// Field presentation layer: which fields are editable, how they group, and what
// they are called in each language.
//
// Two sources of labels exist in Dota 2 data:
//   - Hero base stats have no localization at all, so we ship our own table.
//   - AbilityValues keys DO have localization, as
//     DOTA_Tooltip_ability_<ability>_<key>. Those are read from the game files so
//     the wording matches what the player sees in-game.

const { fieldLabelTokens } = require('./localization.cjs');

/* ------------------------- hero base stat groups ------------------------ */

/**
 * Editable hero base stats, grouped for display. Only numeric stats live here —
 * model, sounds, ability slots and other non-numeric keys are deliberately
 * omitted since the editor is scoped to numbers.
 */
const HERO_STAT_GROUPS = [
  {
    id: 'attributes',
    zh: '属性成长',
    en: 'Attributes',
    fields: [
      { key: 'AttributeBaseStrength', zh: '基础力量', en: 'Base Strength', type: 'number', step: 0.1 },
      { key: 'AttributeStrengthGain', zh: '力量成长', en: 'Strength Gain', type: 'number', step: 0.1 },
      { key: 'AttributeBaseAgility', zh: '基础敏捷', en: 'Base Agility', type: 'number', step: 0.1 },
      { key: 'AttributeAgilityGain', zh: '敏捷成长', en: 'Agility Gain', type: 'number', step: 0.1 },
      { key: 'AttributeBaseIntelligence', zh: '基础智力', en: 'Base Intelligence', type: 'number', step: 0.1 },
      { key: 'AttributeIntelligenceGain', zh: '智力成长', en: 'Intelligence Gain', type: 'number', step: 0.1 },
    ],
  },
  {
    id: 'offense',
    zh: '攻击',
    en: 'Attack',
    fields: [
      { key: 'AttackDamageMin', zh: '最小攻击力', en: 'Attack Damage Min', type: 'number', step: 1 },
      { key: 'AttackDamageMax', zh: '最大攻击力', en: 'Attack Damage Max', type: 'number', step: 1 },
      { key: 'AttackRate', zh: '攻击间隔', en: 'Attack Rate', type: 'number', step: 0.01 },
      { key: 'AttackRange', zh: '攻击距离', en: 'Attack Range', type: 'number', step: 1 },
      { key: 'AttackAcquisitionRange', zh: '攻击获取距离', en: 'Acquisition Range', type: 'number', step: 1 },
      { key: 'AttackAnimationPoint', zh: '攻击前摇', en: 'Attack Animation Point', type: 'number', step: 0.01 },
      { key: 'ProjectileSpeed', zh: '弹道速度', en: 'Projectile Speed', type: 'number', step: 1 },
    ],
  },
  {
    id: 'defense',
    zh: '防御与移动',
    en: 'Defense & Movement',
    fields: [
      { key: 'ArmorPhysical', zh: '基础护甲', en: 'Base Armor', type: 'number', step: 0.1 },
      { key: 'MagicalResistance', zh: '魔法抗性', en: 'Magic Resistance', type: 'number', step: 1 },
      { key: 'StatusHealthRegen', zh: '生命恢复', en: 'Health Regen', type: 'number', step: 0.1 },
      { key: 'StatusManaRegen', zh: '魔法恢复', en: 'Mana Regen', type: 'number', step: 0.1 },
      { key: 'MovementSpeed', zh: '移动速度', en: 'Movement Speed', type: 'number', step: 1 },
      { key: 'ModelScale', zh: '模型缩放', en: 'Model Scale', type: 'number', step: 0.01 },
    ],
  },
];

/* ---------------------------- ability fields --------------------------- */

/**
 * Plain ability scalars worth exposing. AbilityValues is handled separately
 * because its keys are arbitrary and discovered from the data.
 */
const ABILITY_SCALARS = [
  { key: 'MaxLevel', zh: '最大等级', en: 'Max Level', type: 'number', step: 1 },
  { key: 'AbilityManaCost', zh: '魔法消耗', en: 'Mana Cost', type: 'text' },
  { key: 'AbilityCooldown', zh: '冷却时间', en: 'Cooldown', type: 'text' },
  { key: 'AbilityCastRange', zh: '施法距离', en: 'Cast Range', type: 'text' },
  { key: 'AbilityCastPoint', zh: '施法前摇', en: 'Cast Point', type: 'text' },
  { key: 'AbilityChannelTime', zh: '持续施法时间', en: 'Channel Time', type: 'text' },
  { key: 'AbilityDamage', zh: '技能伤害', en: 'Ability Damage', type: 'text' },
  { key: 'AbilityDuration', zh: '持续时间', en: 'Duration', type: 'text' },
];

/* ------------------------------ item fields ---------------------------- */

const ITEM_SCALARS = [
  { key: 'ItemCost', zh: '价格', en: 'Cost', type: 'number', step: 1 },
  { key: 'AbilityManaCost', zh: '魔法消耗', en: 'Mana Cost', type: 'text' },
  { key: 'AbilityCooldown', zh: '冷却时间', en: 'Cooldown', type: 'text' },
  { key: 'AbilityCastRange', zh: '施法距离', en: 'Cast Range', type: 'text' },
  { key: 'AbilityCastPoint', zh: '施法前摇', en: 'Cast Point', type: 'text' },
  { key: 'AbilityChannelTime', zh: '持续施法时间', en: 'Channel Time', type: 'text' },
  { key: 'AbilityDuration', zh: '持续时间', en: 'Duration', type: 'text' },
];

/* --------------------------- AbilityValues ----------------------------- */

/**
 * Well-known AbilityValues keys.
 *
 * Why this table has to be big: the game only ships a per-ability label token
 * (`DOTA_Tooltip_ability_<ability>_<key>`) for keys that appear in that
 * ability's tooltip. Across a full install roughly 43% of (ability, key) pairs
 * have one; the rest are data-only keys the UI never prints. Those keys get
 * their Chinese from this shared table instead, which covers the frequent ones.
 *
 * Order matters for readability, not correctness — lookups are hash-based.
 */
const COMMON_VALUE_LABELS = {
  // Universal ability scalars
  AbilityCooldown: { zh: '冷却时间', en: 'Cooldown' },
  AbilityCastRange: { zh: '施法距离', en: 'Cast Range' },
  AbilityManaCost: { zh: '魔法消耗', en: 'Mana Cost' },
  AbilityCastPoint: { zh: '施法前摇', en: 'Cast Point' },
  AbilityChannelTime: { zh: '持续施法时间', en: 'Channel Time' },
  AbilityDuration: { zh: '持续时间', en: 'Duration' },
  AbilityDamage: { zh: '技能伤害', en: 'Ability Damage' },
  AbilityCharges: { zh: '能量点数', en: 'Charges' },
  AbilityChargeRestoreTime: { zh: '补充时间', en: 'Charge Restore Time' },
  AbilityLevel: { zh: '等级', en: 'Level' },
  MaxLevel: { zh: '最大等级', en: 'Max Level' },
  max_level: { zh: '最大等级', en: 'Max Level' },
  RequiredLevel: { zh: '需求等级', en: 'Required Level' },

  // Geometry / targeting
  radius: { zh: '作用范围', en: 'Radius' },
  aoe_radius: { zh: '作用范围', en: 'AOE Radius' },
  end_radius: { zh: '末端范围', en: 'End Radius' },
  start_radius: { zh: '起始范围', en: 'Start Radius' },
  aura_radius: { zh: '光环范围', en: 'Aura Radius' },
  vision_radius: { zh: '视野范围', en: 'Vision Radius' },
  range: { zh: '距离', en: 'Range' },
  max_distance: { zh: '最大距离', en: 'Max Distance' },
  break_distance: { zh: '断开距离', en: 'Break Distance' },
  width: { zh: '宽度', en: 'Width' },
  projectile_width: { zh: '弹道宽度', en: 'Projectile Width' },
  knockback_distance: { zh: '击退距离', en: 'Knockback Distance' },
  knockback_height: { zh: '击退高度', en: 'Knockback Height' },

  // Timing
  duration: { zh: '持续时间', en: 'Duration' },
  slow_duration: { zh: '减速持续时间', en: 'Slow Duration' },
  stun_duration: { zh: '眩晕时间', en: 'Stun Duration' },
  debuff_duration: { zh: '负面状态持续时间', en: 'Debuff Duration' },
  buff_duration: { zh: '增益持续时间', en: 'Buff Duration' },
  knockback_duration: { zh: '击退时间', en: 'Knockback Duration' },
  vision_duration: { zh: '视野持续时间', en: 'Vision Duration' },
  linger_duration: { zh: '残留持续时间', en: 'Linger Duration' },
  pull_duration: { zh: '牵引持续时间', en: 'Pull Duration' },
  fade_time: { zh: '渐隐时间', en: 'Fade Time' },
  delay: { zh: '延迟', en: 'Delay' },
  tick_interval: { zh: '伤害间隔', en: 'Tick Interval' },
  tick_rate: { zh: '跳动频率', en: 'Tick Rate' },
  damage_interval: { zh: '伤害间隔', en: 'Damage Interval' },
  damage_tick_rate: { zh: '伤害跳动频率', en: 'Damage Tick Rate' },
  burn_interval: { zh: '燃烧间隔', en: 'Burn Interval' },

  // Damage / healing
  damage: { zh: '伤害', en: 'Damage' },
  damage_pct: { zh: '伤害百分比', en: 'Damage Percent' },
  bonus_damage: { zh: '额外伤害', en: 'Bonus Damage' },
  outgoing_damage: { zh: '造成伤害', en: 'Outgoing Damage' },
  incoming_damage: { zh: '承受伤害', en: 'Incoming Damage' },
  heal: { zh: '治疗量', en: 'Heal' },
  heal_pct: { zh: '治疗百分比', en: 'Heal Percent' },
  damage_threshold: { zh: '伤害阈值', en: 'Damage Threshold' },
  immunity_resist: { zh: '免疫抗性', en: 'Immunity Resist' },
  undispellable: { zh: '不可驱散', en: 'Undispellable' },

  // Speed
  speed: { zh: '速度', en: 'Speed' },
  projectile_speed: { zh: '弹道速度', en: 'Projectile Speed' },
  movement_speed: { zh: '移动速度', en: 'Movement Speed' },
  bonus_movespeed: { zh: '额外移动速度', en: 'Bonus Move Speed' },
  attack_speed: { zh: '攻击速度', en: 'Attack Speed' },
  turn_rate: { zh: '转身速率', en: 'Turn Rate' },
  animation_rate: { zh: '动画速率', en: 'Animation Rate' },
  slow: { zh: '减速', en: 'Slow' },
  movement_slow: { zh: '移动减速', en: 'Movement Slow' },

  // Combat modifiers
  bonus_armor: { zh: '额外护甲', en: 'Bonus Armor' },
  bonus_attack_range: { zh: '额外攻击距离', en: 'Bonus Attack Range' },
  attack_range_bonus: { zh: '攻击距离加成', en: 'Attack Range Bonus' },
  max_stacks: { zh: '最大叠加层数', en: 'Max Stacks' },
  max_charges: { zh: '最大能量点数', en: 'Max Charges' },
  cooldown_reduction: { zh: '冷却缩减', en: 'Cooldown Reduction' },
  model_scale: { zh: '模型缩放', en: 'Model Scale' },
};

/**
 * Loose key → label inference for keys the table and the game both miss.
 *
 * Splits on underscores and translates every recognised token, joining the
 * Chinese pieces in order. e.g. `bonus_attack_speed` -> "额外攻击速度".
 *
 * Ordering note: Chinese compounds read modifier-last, so the join is plain
 * concatenation of the parts as they appear. If a part is unrecognised it is
 * kept verbatim, which still beats showing the whole key raw.
 */
const KEY_PART_ZH = {
  duration: '持续时间',
  time: '时间',
  damage: '伤害',
  radius: '范围',
  range: '距离',
  speed: '速度',
  cost: '消耗',
  mana: '魔法',
  health: '生命',
  hp: '生命',
  armor: '护甲',
  slow: '减速',
  chance: '几率',
  count: '数量',
  interval: '间隔',
  rate: '频率',
  delay: '延迟',
  amount: '数值',
  pct: '百分比',
  percent: '百分比',
  bonus: '额外',
  max: '最大',
  min: '最小',
  stacks: '叠加',
  charges: '点数',
  vision: '视野',
  width: '宽度',
  distance: '距离',
  height: '高度',
  level: '等级',

  /* ---- words that show up constantly in item and skill keys ---- */
  attack: '攻击',
  movement: '移动',
  move: '移动',
  movespeed: '移动速度',
  regen: '回复',
  regeneration: '回复',
  lifesteal: '吸血',
  resist: '抗性',
  resistance: '抗性',
  magic: '魔法',
  physical: '物理',
  spell: '技能',
  amp: '增强',
  amplification: '增强',
  all: '全部',
  stats: '属性',
  strength: '力量',
  agility: '敏捷',
  intellect: '智力',
  crit: '暴击',
  multiplier: '倍率',
  evasion: '闪避',
  dodge: '闪避',
  night: '夜间',
  day: '白天',
  heal: '治疗',
  healing: '治疗',
  reduction: '削减',
  gain: '获得',
  loss: '损失',
  restore: '恢复',
  restore_time: '恢复时间',
  cooldown: '冷却',
  cd: '冷却',
  cast: '施法',
  point: '前摇',
  backswing: '后摇',
  channel: '持续施法',
  aoe: '范围',
  area: '范围',
  effect: '效果',
  effects: '效果',
  target: '目标',
  self: '自身',
  enemy: '敌方',
  allies: '友方',
  ally: '友方',
  creep: '小兵',
  creeps: '小兵',
  hero: '英雄',
  heroes: '英雄',
  tower: '建筑',
  building: '建筑',
  buildings: '建筑',
  gold: '金钱',
  xp: '经验',
  experience: '经验',
  bounty: '赏金',
  duration_pct: '持续时间百分比',
  stolen: '窃取',
  steal: '窃取',
  summon: '召唤',
  summons: '召唤',
  unit: '单位',
  units: '单位',
  projectile: '弹道',
  splash: '溅射',
  knockback: '击退',
  pull: '牵引',
  push: '推动',
  silence: '沉默',
  stun: '眩晕',
  root: '缠绕',
  hex: '变形',
  fear: '恐惧',
  taunt: '嘲讽',
  disarm: '缴械',
  blind: '致盲',
  break: '破坏',
  dispel: '驱散',
  undispellable: '不可驱散',
  stack: '叠加',
  stack_limit: '叠加上限',
  depletion: '消耗',
  consumption: '消耗',
  consumed: '消耗',
  threshold: '阈值',
  penalty: '惩罚',
  factor: '系数',
  strength_gain: '力量成长',
  accuracy: '命中',
  true_sight: '真实视野',
  detection: '侦测',
  illusions: '幻象',
  illusion: '幻象',
  clone: '复制',
  bounce: '弹射',
  bounces: '弹射次数',
  chain: '连锁',
  leap: '跳跃',
  dash: '冲刺',
  blink: '闪烁',
  teleport: '传送',
  spin: '旋转',
  aura: '光环',
  shield: '护盾',
  barrier: '屏障',
  block: '格挡',
  absorb: '吸收',
  immunity: '免疫',
  pierce: '穿透',
  pierces: '穿透',
  piercing: '穿透',
  dps: '每秒伤害',
  hps: '每秒治疗',
  total: '总计',
  initial: '初始',
  final: '最终',
  start: '起始',
  end: '结束',
  begin: '起始',
  tick: '跳动',
  ticks: '跳动次数',
  interval_pct: '间隔百分比',
  spread: '扩散',
  angle: '角度',
  arc: '弧度',
  length: '长度',
  scale: '缩放',
  model: '模型',
  effect_radius: '效果范围',
  zone: '区域',
  ground: '地面',
  air: '空中',
  flying: '飞行',
  max_targets: '最大目标数',
  secondary: '次级',
  primary: '主要',
  extra: '额外',
  additional: '额外',
  status: '状态',
  acceleration: '加速度',
  deceleration: '减速度',
  velocity: '速度',
  of: '', // filler in keys like `area_of_effect`; drop it
  per: '每',
  second: '秒',
  seconds: '秒',
  aspd: '攻击速度',
  modelscale: '模型缩放',
  truesight: '真实视野',
  lifetime: '存在时间',
  wall_thickness: '墙体厚度',
  grace_period: '宽限时间',
  exists: '存在',
  explosion: '爆炸',
  explode: '爆炸',
  explode_damage: '爆炸伤害',
  spawn: '生成',
  spawns: '生成数量',
  spawn_count: '生成数量',
  jump: '跳跃',
  jumps: '跳跃次数',
  swap: '交换',
  places: '位置',
  power: '威力',
  base_power: '基础威力',
  debuff: '负面状态',
  buff: '增益',
  apply: '施加',
  strike: '打击',
  touch: '接触',
  required: '所需',
  required_hits: '所需命中',
  hits: '命中次数',
  hits_required: '所需命中次数',
  upgrade: '升级',
  upgrades: '升级次数',
  levels: '等级数',
  levels_between: '等级间隔',
  between: '',
  while: '',
  stunned: '眩晕时',
  touch_strike: '接触打击',
  to_atkspd: '转为攻击速度',
  atkspd: '攻击速度',
  int: '智力',
  agi: '敏捷',
  str: '力量',
  procs: '触发',
  process: '处理',
  one_tooltip: '单一提示',
  double: '双重',
  song: '乐章',
  first: '第一',
  third: '第三',
  value: '数值',
  has: '',
  can: '',
  does: '',
  is: '',
  on: '',
  to: '',
  from: '',
  in: '',
  and: '',
};

/**
 * Humanize as a last resort, but translate the recognisable parts first so the
 * label is at least partly Chinese when the key is self-describing.
 * Returns { zh, en }.
 */
function inferLabel(key) {
  const parts = key.split('_').filter(Boolean);

  // Longest-match first: `mana_regen` is better read as one unit than as
  // "魔法" + "回复", and `restore_time` should not become "恢复时间时间".
  const pieces = [];
  for (let i = 0; i < parts.length; i++) {
    let matched = null;
    for (let n = Math.min(3, parts.length - i); n >= 1; n--) {
      const candidate = parts.slice(i, i + n).join('_').toLowerCase();
      // `!== undefined`, not truthiness: filler words map to '' on purpose.
      if (KEY_PART_ZH[candidate] !== undefined) { matched = { len: n, zh: KEY_PART_ZH[candidate] }; break; }
    }
    if (matched) { pieces.push(matched.zh); i += matched.len - 1; }
    else pieces.push(parts[i]);
  }

  // Filler words become '' in the table; drop them so `area_of_effect` reads
  // "范围效果" instead of "范围of效果".
  const kept = pieces.filter((p) => p !== '');
  if (!kept.length) return { zh: humanize(key), en: humanize(key) };

  const anyTranslated = kept.some((p) => /[\u4e00-\u9fff]/.test(p));
  if (!anyTranslated) return { zh: humanize(key), en: humanize(key) };

  // Collapse repeats produced by over-eager compound matching, and keep
  // "额外"/"最大" style modifiers in front where Chinese expects them.
  const MODIFIERS = new Set(['额外', '最大', '最小', '总计', '初始', '最终']);
  const tail = kept.filter((p) => !MODIFIERS.has(p));
  const head = kept.filter((p) => MODIFIERS.has(p));
  const joined = [...new Set([...head, ...tail])].join('');

  return { zh: joined, en: humanize(key) };
}

/**
 * Normalize an AbilityValues entry to { value, extras }.
 * Entries are either a scalar string or an object with `value` plus modifiers
 * (special_bonus_scepter, hero_levelup, display_type, ...).
 */
function readAbilityValue(entry) {
  if (typeof entry === 'string') return { value: entry, extras: [] };
  if (!entry || typeof entry !== 'object') return { value: String(entry), extras: [] };

  const extras = [];
  for (const [k, v] of Object.entries(entry)) {
    if (k === 'value' || k === 'display_type' || k === 'linked_bonus') continue;
    extras.push({ key: k, value: String(v) });
  }
  return { value: entry.value !== undefined ? String(entry.value) : '', extras };
}

/**
 * Tooltip labels are written for display, e.g. "DAMAGE PER 1 MANA MISSING:" or
 * "<font color='#2dd5e4'>眩晕</font>时间：". Strip the markup and the trailing
 * colon so they can sit next to an input box.
 *
 * Returns '' for strings that are still unsubstituted templates. Many item
 * tooltips are written as "+$armor" or "%d Damage", where the game fills the
 * variable at render time from the stat system. Pasting those next to our own
 * input box produces exactly the raw-looking text the user complained about
 * ("some skills still show the game's original format"), so they must count as
 * "no translation" and fall through to the Chinese label table.
 */
function cleanLabel(s) {
  if (!s) return s;
  const out = s
    .replace(/<[^>]*>/g, '')
    .replace(/[:：]\s*$/, '')
    .trim();

  // A bare "%" is a real unit ("+10%"); "%d"/"%s"/"%1$s" are placeholders.
  if (/\$\{?[a-z_]/i.test(out)) return '';
  if (/%\d*\$?[a-z]/i.test(out)) return '';
  if (/\{[sd]:/.test(out)) return '';

  return out;
}

/**
 * Build the display rows for one ability's AbilityValues block.
 *
 * Label resolution order:
 *   1. the ability's own tooltip token (the wording the player sees in game)
 *   2. the shared table, which covers keys the game never prints
 *   3. keyword inference from the key itself
 *   4. the humanized raw key
 *
 * Every row keeps `label_raw` so the UI can still show, and search by, the
 * underlying key even when a translation was found.
 *
 * @param {object} abilityData
 * @param {(lang: string, token: string) => string|null} lookup
 */
function abilityValueRows(abilityData, lookup) {
  const av = abilityData?.AbilityValues;
  if (!av || typeof av !== 'object') return [];

  const abilityId = abilityData.__id;
  const rows = [];

  for (const [key, entry] of Object.entries(av)) {
    const { value, extras } = readAbilityValue(entry);

    let zh = null;
    let en = null;
    if (abilityId) {
      for (const tok of fieldLabelTokens(abilityId, key)) {
        zh = zh || cleanLabel(lookup('zh', tok));
        en = en || cleanLabel(lookup('en', tok));
      }
    }

    const fromGame = Boolean(zh || en);

    // Shared table covers data-only keys; inference catches the long tail.
    const common = COMMON_VALUE_LABELS[key];
    if (!zh && common) zh = common.zh;
    if (!en && common) en = common.en;

    if (!zh || !en) {
      const inferred = inferLabel(key);
      if (!zh) zh = inferred.zh;
      if (!en) en = inferred.en;
    }

    rows.push({
      key,
      value,
      extras,
      label_raw: key,
      // Already clean: the lookup values ran through cleanLabel above.
      label_zh: zh || humanize(key),
      label_en: en || humanize(key),
      // Distinguishes "translated from the game's own tooltip" from "we guessed
      // or fell back", so the UI can flag genuinely untranslated fields.
      localized: fromGame,
      translated: Boolean(COMMON_VALUE_LABELS[key] || fromGame),
    });
  }

  return rows;
}

/** "mana_per_hit" -> "Mana per hit" */
function humanize(key) {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = {
  HERO_STAT_GROUPS,
  ABILITY_SCALARS,
  ITEM_SCALARS,
  COMMON_VALUE_LABELS,
  abilityValueRows,
  readAbilityValue,
  inferLabel,
  humanize,
};
