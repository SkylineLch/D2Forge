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

/* ------------------------------ bootstrap ----------------------------- */

function init(gamePath) {
  const vpkPath = path.join(gamePath, 'dota/pak01_dir.vpk');
  vpk = openVpk(vpkPath);
  loc = createLocalizationLookup((relPath) => readText(vpk, relPath));
  heroOrder = null;
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
  loadHeroes,
  loadHero,
  loadItems,
  loadAbilities,
  loadHeroAbilities,
  getHeroOrder,
};
