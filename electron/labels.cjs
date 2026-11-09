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
 * Well-known AbilityValues keys. The game localizes most of these as
 * "<label>:" strings, but the universal ones (cooldown, cast range, ...) have no
 * per-ability token at all, so they need a table of their own.
 */
const COMMON_VALUE_LABELS = {
  AbilityCooldown: { zh: '冷却时间', en: 'Cooldown' },
  AbilityCastRange: { zh: '施法距离', en: 'Cast Range' },
  AbilityManaCost: { zh: '魔法消耗', en: 'Mana Cost' },
  AbilityCastPoint: { zh: '施法前摇', en: 'Cast Point' },
  AbilityChannelTime: { zh: '持续施法时间', en: 'Channel Time' },
  AbilityDuration: { zh: '持续时间', en: 'Duration' },
  AbilityDamage: { zh: '技能伤害', en: 'Ability Damage' },
  duration: { zh: '持续时间', en: 'Duration' },
  radius: { zh: '作用范围', en: 'Radius' },
  aoe_radius: { zh: '作用范围', en: 'AOE Radius' },
  damage: { zh: '伤害', en: 'Damage' },
  max_level: { zh: '最大等级', en: 'Max Level' },
};

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
 */
function cleanLabel(s) {
  if (!s) return s;
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/[:：]\s*$/, '')
    .trim();
}

/**
 * Build the display rows for one ability's AbilityValues block.
 * Labels come from the game's own tooltip localization; when missing we fall
 * back to a humanized version of the raw key so the row is never blank.
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
        zh = zh || lookup('zh', tok);
        en = en || lookup('en', tok);
      }
    }

    // Per-ability token wins; the shared table covers the universal keys.
    const common = COMMON_VALUE_LABELS[key];
    if (!zh && common) zh = common.zh;
    if (!en && common) en = common.en;

    rows.push({
      key,
      value,
      extras,
      label_zh: cleanLabel(zh) || humanize(key),
      label_en: cleanLabel(en) || humanize(key),
      localized: Boolean(cleanLabel(zh) || cleanLabel(en)),
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
  abilityValueRows,
  readAbilityValue,
  humanize,
};
