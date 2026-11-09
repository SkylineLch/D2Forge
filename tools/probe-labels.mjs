import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { openVpk, readText } = require('../electron/vpk.cjs');
const { parseKV } = require('../electron/kv-parser.cjs');
const { createLocalizationLookup } = require('../electron/localization.cjs');

const GAME = 'E:/SteamLibrary/steamapps/common/dota 2 beta/game';
const vpk = openVpk(GAME + '/dota/pak01_dir.vpk');
const loc = createLocalizationLookup(p => readText(vpk, p));
loc.warm(['zh', 'en']);

const text = readText(vpk, 'scripts/npc/heroes/npc_dota_hero_antimage.txt');
const { root } = parseKV(text);
const h = root.DOTAHeroes.npc_dota_hero_antimage;

console.log('=== magic resistance / misc hero fields ===');
for (const k of Object.keys(h)) {
  if (/magic|resist|armor|health|mana|speed|vision/i.test(k)) console.log(`  ${k} = ${JSON.stringify(h[k])}`);
}

console.log('\n=== AbilityValues label lookup (antimage_blink) ===');
for (const f of ['range', 'duration', 'cooldown', 'cast_range']) {
  const zh = loc.lookup('zh', `DOTA_Tooltip_ability_antimage_blink_${f}`);
  const en = loc.lookup('en', `DOTA_Tooltip_ability_antimage_blink_${f}`);
  console.log(`  ${f.padEnd(20)} zh=${zh} | en=${en}`);
}

console.log('\n=== ability AbilityValues shapes across abilities ===');
const { root: ar } = parseKV(readText(vpk, 'scripts/npc/npc_abilities.txt'));
const abil = ar.DOTAAbilities || {};
const shape = { scalar: 0, obj_value: 0, obj_other: 0, other: 0 };
const otherKeys = new Set();
for (const [id, v] of Object.entries(abil)) {
  const av = v.AbilityValues;
  if (!av || typeof av !== 'object') continue;
  for (const [k, vv] of Object.entries(av)) {
    if (typeof vv === 'string') shape.scalar++;
    else if (vv && typeof vv === 'object') {
      if ('value' in vv) shape.obj_value++;
      else shape.obj_other++;
      for (const ok of Object.keys(vv)) otherKeys.add(ok);
    } else shape.other++;
  }
}
console.log(shape);
console.log('object sub-keys:', [...otherKeys].join(', '));

console.log('\n=== sample abilities with rich props ===');
let c = 0;
for (const [id, v] of Object.entries(abil)) {
  if (!id.includes('axe') && !id.includes('crystal_maiden')) continue;
  console.log(`\n--- ${id}`);
  for (const [k, vv] of Object.entries(v)) {
    if (typeof vv !== 'string') { console.log(`  ${k}: <obj ${Object.keys(vv).length} keys>`); continue; }
    if (/ability(cooldown|manacost|castrange|castpoint|duration|damage|channel)/i.test(k)) console.log(`  ${k} = ${vv}`);
  }
  if (v.AbilityValues) console.log('  AbilityValues:', JSON.stringify(v.AbilityValues).slice(0, 700));
  if (++c > 2) break;
}
