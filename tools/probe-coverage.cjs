'use strict';
// How many ability-value labels still fall back to raw English?
//
// The user's complaint was "some skills still show the game's raw format
// instead of Chinese". This measures the exact size of that gap.
//
// It calls the real `abilityValueRows` rather than reimplementing the lookup
// order — an earlier version of this probe skipped the shared label table and
// over-reported the gap. Measuring through the production path means the
// number can't drift from what the UI actually renders.

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const { openVpk, readText } = require(path.join(ROOT, 'electron/vpk.cjs'));
const { parseKV } = require(path.join(ROOT, 'electron/kv-parser.cjs'));
const labels = require(path.join(ROOT, 'electron/labels.cjs'));

const GAME = process.env.D2_GAME || 'E:/SteamLibrary/steamapps/common/dota 2 beta/game';
const vpk = openVpk(path.join(GAME, 'dota', 'pak01_dir.vpk'));

/* --------------------------- localization lookup -------------------------- */

const loc = new Map();
for (const f of ['dota_schinese.txt', 'abilities_schinese.txt', 'items_schinese.txt']) {
  const t = readText(vpk, `resource/localization/${f}`);
  if (!t) { console.warn('missing loc', f); continue; }
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(/^\s*"([^"]+)"\s+"((?:[^"\\]|\\.)*)"/);
    if (m) loc.set(m[1].toLowerCase(), m[2]);
  }
}
console.log(`localization entries: ${loc.size}`);

/** Same shape labels.cjs expects: (lang, token) => string|null */
function lookup(lang, token) {
  if (!token) return null;
  return loc.get(String(token).toLowerCase()) || null;
}

/* ------------------------------- collect keys ----------------------------- */

const keyCount = new Map();
const untranslated = new Map();

function scanAbility(abilityId, def) {
  if (!def || typeof def !== 'object') return;
  const rows = labels.abilityValueRows({ ...def, __id: abilityId }, lookup);
  for (const r of rows) {
    if (/^special_bonus/i.test(r.key)) continue; // talent stubs, not a label
    keyCount.set(r.key, (keyCount.get(r.key) || 0) + 1);
    if (/[\u4e00-\u9fff]/.test(r.label_zh)) continue;
    const rec = untranslated.get(r.key) || { count: 0, sample: abilityId };
    rec.count++;
    untranslated.set(r.key, rec);
  }
}

/* --------------------------------- heroes -------------------------------- */

const heroFiles = [...vpk.entries.keys()]
  .filter((e) => /^scripts\/npc\/heroes\/npc_dota_hero_.*\.txt$/.test(e));

let heroCount = 0;
for (const f of heroFiles) {
  const text = readText(vpk, f);
  if (!text) continue;
  let tree;
  try { tree = parseKV(text); } catch { continue; }
  const heroes = (tree.root || tree).DOTAHeroes;
  if (!heroes) continue;
  for (const [heroId, hero] of Object.entries(heroes)) {
    if (!heroId.startsWith('npc_dota_hero_') || !hero || typeof hero !== 'object') continue;
    heroCount++;
    const defs = hero.AbilityDefinitions;
    if (!defs) continue;
    for (const [ab, def] of Object.entries(defs)) scanAbility(ab, def);
  }
}

/* ---------------------------------- items -------------------------------- */

const itemsText = readText(vpk, 'scripts/npc/items.txt');
let itemCount = 0;
if (itemsText) {
  const abs = (parseKV(itemsText).root || {}).DOTAAbilities || {};
  for (const [id, def] of Object.entries(abs)) {
    if (!def || typeof def !== 'object') continue;
    itemCount++;
    scanAbility(id, def);
  }
}

/* --------------------------------- report -------------------------------- */

const totalOccurrences = [...keyCount.values()].reduce((a, b) => a + b, 0);
const untranslatedOccurrences = [...untranslated.values()].reduce((a, b) => a + b.count, 0);
const pct = totalOccurrences ? (100 * (1 - untranslatedOccurrences / totalOccurrences)).toFixed(1) : '0';

console.log(`\nheroes: ${heroCount}   items: ${itemCount}`);
console.log(`distinct ability-value keys: ${keyCount.size}`);
console.log(`label occurrences: ${totalOccurrences}`);
console.log(`untranslated occurrences: ${untranslatedOccurrences}  (${pct}% translated)`);
console.log(`untranslated distinct keys: ${untranslated.size}`);

const top = [...untranslated.entries()].sort((a, b) => b[1].count - a[1].count);
console.log('\ntop untranslated keys (by occurrence):');
for (const [k, v] of top.slice(0, 60)) console.log(`  ${String(v.count).padStart(4)}  ${k}   e.g. ${v.sample}`);

fs.writeFileSync(
  path.join(ROOT, 'tools', 'untranslated.json'),
  JSON.stringify({
    game: GAME,
    totalOccurrences,
    untranslatedOccurrences,
    translatedPct: Number(pct),
    keys: top.map(([k, v]) => ({ key: k, ...v })),
  }, null, 2)
);
