// Probe: talent values. Talents are abilities in npc_abilities.txt holding an
// AbilityValues block with the bonus, or a single `value`/`bonus_*` scalar.
const path = require('path');
const GAME = 'E:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game';
const VPK_PATH = path.join(GAME, 'dota/pak01_dir.vpk');

const vpkMod = require('../electron/vpk.cjs');
const kv = require('../electron/kv-parser.cjs');
const locMod = require('../electron/localization.cjs');

const vpk = vpkMod.openVpk(VPK_PATH);
const readText = (p) => vpkMod.readText(vpk, p);
const loc = locMod.createLocalizationLookup(readText);
loc.warm(['zh', 'en']);

const ab = readText('scripts/npc/npc_abilities.txt');
const { root } = kv.parseKV(ab);
const defs = root.DOTAAbilities || {};

const talentIds = Object.keys(defs).filter((k) => /^special_bonus/i.test(k));
console.log('total special_bonus abilities:', talentIds.length);

const samples = ['special_bonus_unique_drow_ranger_1', 'special_bonus_hp_100', 'special_bonus_attributes'];
for (const id of samples) {
  const d = defs[id];
  console.log(`\n=== ${id} ===`);
  console.log(d === undefined ? '(undefined)' : JSON.stringify(d, null, 1).slice(0, 700));
}

// Which keys do talents use to store their numeric bonus?
const keyCount = new Map();
for (const id of talentIds) {
  const d = defs[id];
  if (!d || typeof d !== 'object') continue;
  for (const k of Object.keys(d)) keyCount.set(k, (keyCount.get(k) || 0) + 1);
}
console.log('\n=== keys seen across talents (top) ===');
for (const [k, c] of [...keyCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${String(c).padStart(4)}  ${k}`);
}

// How are talents bound to a hero? Look for a talent list per hero.
console.log('\n=== does a hero file reference talent ids? (drow) ===');
const dt = readText('scripts/npc/heroes/npc_dota_hero_drow_ranger.txt');
const refs = [...dt.matchAll(/special_bonus_unique_drow_ranger_[a-z0-9_]+/g)].map((x) => x[0]);
console.log('refs in hero file:', [...new Set(refs)]);
