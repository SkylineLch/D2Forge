'use strict';
// Data layer: aggregates VPK reading + KV parsing + localization lookup.
// Provides hero/item/ability collections with bilingual display names for the UI.

const path = require('path');
const { openVpk, readText } = require('./vpk.cjs');
const { parseKV } = require('./kv-parser.cjs');
const {
  createLocalizationLookup,
  heroNameToken,
  abilityNameTokens,
} = require('./localization.cjs');

let vpk = null;
let loc = null;
let heroOrder = null;
let globalAbilityCache = null;

/* ------------------------------ bootstrap ----------------------------- */

function init(gamePath) {
  const vpkPath = path.join(gamePath, 'dota/pak01_dir.vpk');
  vpk = openVpk(vpkPath);
  loc = createLocalizationLookup((relPath) => readText(vpk, relPath));
  heroOrder = null;
  globalAbilityCache = null; // re-read after a game update
  console.log(`[data-store] VPK indexed: ${vpk.entries.size} entries`);
  return { entries: vpk.entries.size, version: vpk.version };
}

function isReady() {
  return vpk !== null;
}

/** Raw localization passthrough, for callers that need field labels. */
function lookup(lang, token) {
  if (!loc) return null;
  return loc.lookup(lang, token);
}

/** Read a file out of the currently open VPK (used by the reconcile pass). */
function readFile(relPath) {
  if (!vpk) return null;
  return readText(vpk, relPath);
}

/* ------------------------------ naming -------------------------------- */

/** Resolve the first matching token among candidates, for one language. */
function pick(lang, tokens) {
  for (const tok of tokens) {
    const hit = loc.lookup(lang, tok);
    if (hit) return hit;
  }
  return null;
}

function namesFor(tokens) {
  return {
    name_zh: pick('zh', tokens) || null,
    name_en: pick('en', tokens) || null,
  };
}

function heroNames(id) {
  const { name_zh, name_en } = namesFor([heroNameToken(id)]);
  return { name_zh: name_zh || id, name_en: name_en || id };
}

function abilityNames(id) {
  const { name_zh, name_en } = namesFor(abilityNameTokens(id));
  return { name_zh: name_zh || id, name_en: name_en || id };
}

/* -------------------------------- heroes ------------------------------ */

/**
 * Hero ids in game order, derived from the #base list in npc_heroes.txt.
 * Parsing hero files directly would cost ~130 opens; the directive list is free.
 */
function getHeroOrder() {
  if (heroOrder) return heroOrder;

  const text = readText(vpk, 'scripts/npc/npc_heroes.txt');
  if (!text) return (heroOrder = []);

  const ids = [];
  const re = /^[ \t]*#base[ \t]+"heroes\/([A-Za-z0-9_]+)\.txt"/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1] === 'npc_dota_hero_base') continue;
    ids.push(m[1]);
  }

  heroOrder = ids;
  return ids;
}

function loadHero(heroId) {
  const text = readText(vpk, `scripts/npc/heroes/${heroId}.txt`);
  if (!text) return null;

  const { root } = parseKV(text);
  const data = root.DOTAHeroes?.[heroId];
  if (!data) return null;

  return { id: heroId, ...heroNames(heroId), data };
}

/**
 * @param {{withAbilities?: boolean, ids?: string[]}} opts
 */
function loadHeroes(opts = {}) {
  if (!vpk) throw new Error('data-store not initialized');
  loc.warm(['zh', 'en']); // bulk listing: build indexes once

  const t0 = Date.now();
  const ids = opts.ids || getHeroOrder();
  const list = [];

  for (const id of ids) {
    const hero = loadHero(id);
    if (!hero) continue;
    if (opts.withAbilities) hero.abilities = extractAbilities(hero.data);
    list.push(hero);
  }

  console.log(`[data-store] ${list.length} heroes in ${Date.now() - t0}ms`);
  return list;
}

/** Pull AbilityDefinitions out of a hero record. */
function extractAbilities(heroData) {
  const defs = heroData?.AbilityDefinitions || {};
  return Object.entries(defs).map(([id, data]) => ({
    id,
    ...abilityNames(id),
    data,
  }));
}

/**
 * Shared ability table from npc_abilities.txt (items excluded by callers).
 * Cached because talent lookups hit it once per hero open.
 */
function getGlobalAbilities() {
  if (globalAbilityCache) return globalAbilityCache;
  const text = readText(vpk, 'scripts/npc/npc_abilities.txt');
  globalAbilityCache = text ? parseKV(text).root.DOTAAbilities || {} : {};
  return globalAbilityCache;
}

/**
 * Talent slots are Ability10..Ability17, two choices per talent tier. The data
 * carries no RequiredLevel for them, but the engine's mapping is fixed:
 *
 *     slots 10,11 -> level 10      slots 12,13 -> level 15
 *     slots 14,15 -> level 20      slots 16,17 -> level 25
 */
function tierForSlot(slot) {
  if (slot == null || slot < 10) return null;
  return 10 + Math.floor((slot - 10) / 2) * 5;
}

/**
 * Hero talents.
 *
 * A Dota talent is an ability stub (`special_bonus_*`). Two shapes exist:
 *
 *   1. Hero-specific talents (`special_bonus_unique_<hero>_N`). The stub lives
 *      in the hero file under AbilityDefinitions with no ability values at all.
 *      The actual bonus is a *modifier line* inside some ability's
 *      AbilityValues, keyed by the talent id:
 *
 *          "arrow_damage_pct"
 *          {
 *              "value"                                   "80 100 120 140"
 *              "special_bonus_unique_drow_ranger_1"      "+25"
 *          }
 *
 *      That malformed-looking `{s:bonus_arrow_damage_pct}` in the tooltip is
 *      resolved by the engine from exactly this line.
 *
 *   2. Generic talents (`special_bonus_attack_range_75`, `special_bonus_hp_100`)
 *      are defined once in npc_abilities.txt with an own AbilityValues.value.
 *
 * So the talent bonus is either a hero-file modifier value or a global value,
 * and editing has to target whichever one applies.
 */
const TALENT_SLOT_RE = /^Ability(\d+)$/;

/**
 * `special_bonus_scepter` / `special_bonus_shard` are Aghanim upgrade markers
 * written into AbilityValues, not talents a hero can pick. Keep them out.
 */
const NON_TALENT_BONUS = /^special_bonus_(scepter|shard|aghanims?)/i;

function isTalentId(id) {
  return /^special_bonus/i.test(id) && !NON_TALENT_BONUS.test(id);
}

/** Slots Ability10..AbilityN in a hero record, ordered by slot number. */
function talentSlots(heroData) {
  const out = [];
  for (const [k, v] of Object.entries(heroData)) {
    const m = TALENT_SLOT_RE.exec(k);
    if (!m) continue;
    const slot = Number(m[1]);
    if (slot < 10) continue;
    if (typeof v !== 'string' || !isTalentId(v)) continue;
    out.push({ slot, id: v });
  }
  out.sort((a, b) => a.slot - b.slot);
  return out;
}

/**
 * Every `special_bonus_*` modifier line inside the hero's abilities.
 * @returns {Map<string, Array<{abilityId: string, field: string, bonus: string}>>}
 */
function collectTalentModifiers(heroData) {
  const map = new Map();
  const defs = heroData?.AbilityDefinitions || {};

  const add = (talentId, ref) => {
    if (!map.has(talentId)) map.set(talentId, []);
    map.get(talentId).push(ref);
  };

  for (const [abilityId, ability] of Object.entries(defs)) {
    const values = ability?.AbilityValues;
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;

    for (const [field, entry] of Object.entries(values)) {
      // Only object-form entries can carry modifiers; scalars have no room.
      const forms = Array.isArray(entry) ? entry : [entry];
      for (const form of forms) {
        if (!form || typeof form !== 'object' || Array.isArray(form)) continue;
        for (const [modKey, modVal] of Object.entries(form)) {
          if (!isTalentId(modKey)) continue;
          if (typeof modVal !== 'string') continue;
          add(modKey, { abilityId, field, bonus: modVal });
        }
      }
    }
  }

  return map;
}

/**
 * Tooltips carry engine placeholders such as `+{s:bonus_arrow_damage_pct}%`
 * which the game fills in from the modifier value. Do the same substitution so
 * the UI shows `+25%` instead of raw template syntax.
 *
 * The stored bonus carries its own sign (`+25`, `-6`, `-18%`) and sometimes its
 * own `%`, so the template's sign is replaced rather than kept (otherwise
 * `+` + `-6` renders as `+-6`). The template's `%` is kept, because it is the
 * unit the sentence is written around.
 */
function fillTalentTemplate(raw, bonus) {
  if (!raw || bonus == null) return raw || null;
  const placeholders = raw.match(/\{s:[^}]+\}/g) || [];
  if (placeholders.length !== 1) return raw; // ambiguous, leave as authored

  const b = String(bonus).trim();
  const sign = /^[+\-]/.test(b) ? b[0] : '';
  const num = b.replace(/^[+\-]/, '').replace(/%$/, '').trim();

  const placeholder = placeholders[0];
  const at = raw.indexOf(placeholder);
  const before = raw.slice(0, at);
  const after = raw.slice(at + placeholder.length);

  let head;
  if (sign) {
    // Replace a literal sign already sitting before the placeholder, if any.
    head = /[+\-]\s*$/.test(before) ? before.replace(/[+\-]\s*$/, sign) : before + sign;
  } else {
    head = before;
  }

  return head + (num || b) + after;
}

/** AbilityValues.value for a global talent, in either scalar/object form. */
function globalTalentValue(def) {
  const v = def?.AbilityValues?.value;
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && !Array.isArray(v)) return v.value ?? null;
  return null;
}

function buildTalent(id, slot, modifiers, global) {
  const refs = modifiers.get(id) || [];
  // A talent can affect several values; prefer the first so the UI has one
  // canonical number to edit, and report the rest as a count.
  const primary = refs[0] || null;
  const def = global[id];

  let host = null;
  if (primary) {
    host = {
      kind: 'hero-ability',
      abilityId: primary.abilityId,
      abilityName_zh: abilityNames(primary.abilityId).name_zh,
      abilityName_en: abilityNames(primary.abilityId).name_en,
      field: primary.field,
      bonus: primary.bonus,
      extraCount: refs.length - 1,
    };
  } else {
    const value = globalTalentValue(def);
    if (value != null) {
      host = { kind: 'global', file: 'scripts/npc/npc_abilities.txt', field: 'value', bonus: value, extraCount: 0 };
    }
  }

  const names = abilityNames(id);
  const bonus = host?.bonus ?? null;

  return {
    id,
    slot,
    tier: tierForSlot(slot),
    name_zh: fillTalentTemplate(names.name_zh, bonus) || names.name_zh || id,
    name_en: fillTalentTemplate(names.name_en, bonus) || names.name_en || id,
    name_raw_zh: names.name_zh,
    name_raw_en: names.name_en,
    bonus,
    host,
    editable: host !== null,
  };
}

/**
 * Talents for one hero: the Ability10..N layout first, then any modifier that
 * was not declared in a slot (Ability Draft variants, legacy ids).
 */
function loadHeroTalents(heroId) {
  if (!vpk) throw new Error('data-store not initialized');
  const hero = loadHero(heroId);
  if (!hero) return [];

  const modifiers = collectTalentModifiers(hero.data);
  const global = getGlobalAbilities();
  const seen = new Set();
  const out = [];

  for (const { slot, id } of talentSlots(hero.data)) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(buildTalent(id, slot, modifiers, global));
  }

  for (const id of modifiers.keys()) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(buildTalent(id, null, modifiers, global));
  }

  // Slot order first (that is the in-game tree), then id for stability.
  out.sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99) || a.id.localeCompare(b.id));
  return out;
}

function loadHeroAbilities(heroId) {
  if (!vpk) throw new Error('data-store not initialized');
  const hero = loadHero(heroId);
  return hero ? extractAbilities(hero.data) : null;
}

/* --------------------------------- items ------------------------------ */

function loadItems() {
  if (!vpk) throw new Error('data-store not initialized');
  loc.warm(['zh', 'en']);

  const text = readText(vpk, 'scripts/npc/items.txt');
  if (!text) return [];

  const { root } = parseKV(text);
  const items = root.DOTAAbilities || {};
  const list = [];

  for (const [id, data] of Object.entries(items)) {
    if (!id.startsWith('item_')) continue;
    list.push({ id, ...abilityNames(id), data });
  }

  console.log(`[data-store] ${list.length} items`);
  return list;
}

/* ------------------------------- abilities ---------------------------- */

/**
 * Global abilities from npc_abilities.txt (not hero-bound).
 * Hero abilities live inside each hero file — see loadHeroAbilities.
 */
function loadAbilities() {
  if (!vpk) throw new Error('data-store not initialized');
  loc.warm(['zh', 'en']);

  const text = readText(vpk, 'scripts/npc/npc_abilities.txt');
  if (!text) return [];

  const { root } = parseKV(text);
  const abilities = root.DOTAAbilities || {};
  const list = [];

  for (const [id, data] of Object.entries(abilities)) {
    if (id.startsWith('item_')) continue;
    if (id === 'Version' || id === 'ability_base') continue;
    list.push({ id, ...abilityNames(id), data });
  }

  console.log(`[data-store] ${list.length} global abilities`);
  return list;
}

module.exports = {
  init,
  isReady,
  lookup,
  readFile,
  loadHeroes,
  loadHero,
  loadItems,
  loadAbilities,
  loadHeroAbilities,
  loadHeroTalents,
  getHeroOrder,
};
