import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { openVpk, readText } = require('../electron/vpk.cjs');
const exp = require('../electron/exporter.cjs');
const { parseKV } = require('../electron/kv-parser.cjs');

const src = openVpk('E:/SteamLibrary/steamapps/common/dota 2 beta/game/dota/pak01_dir.vpk');
const REL = 'scripts/npc/heroes/npc_dota_hero_antimage.txt';
const original = readText(src, REL);

const HERO = 'npc_dota_hero_antimage';

function braceBalance(t) {
  let inStr = false, d = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') d++;
    else if (c === '}') d--;
  }
  return d;
}

function check(label, text) {
  const bal = braceBalance(text);
  const parsed = parseKV(text).root;
  const heroObj = parsed.DOTAHeroes?.[HERO];
  const nAbil = heroObj?.AbilityDefinitions ? Object.keys(heroObj.AbilityDefinitions).length : 0;
  console.log(`${label.padEnd(34)} braces=${bal}  bytes=${text.length}  abilities=${nAbil}`);
  return { bal, nAbil };
}

check('original', original);

// one change at a time
const cases = [
  ['hero MovementSpeed', ['DOTAHeroes', HERO], 'scalar', 'MovementSpeed', '999'],
  ['ability castpoint', ['DOTAHeroes', HERO, 'AbilityDefinitions', 'antimage_blink'], 'scalar', 'AbilityCastPoint', '0.01'],
  ['AV object (percent_damage)', ['DOTAHeroes', HERO, 'AbilityDefinitions', 'antimage_mana_break', 'AbilityValues'], 'abilityValue', 'percent_damage_per_burn', '12345'],
  ['AV scalar (illusion_pct)', ['DOTAHeroes', HERO, 'AbilityDefinitions', 'antimage_mana_break', 'AbilityValues'], 'abilityValue', 'illusion_percentage', '777'],
];

for (const [label, path, kind, field, val] of cases) {
  const off = exp.findBlockOffset(original, path);
  if (off === -1) { console.log(`${label}: BLOCK NOT FOUND (${path.join('.')})`); continue; }
  const out = kind === 'abilityValue'
    ? exp.setAbilityValueInBlock(original, off, field, val)
    : exp.setFieldInBlock(original, off, field, val);
  const changed = out !== original;
  console.log(`\n>>> ${label}  changed=${changed}  offset=${off}`);
  check('  after', out);
  if (changed) {
    const i = out.indexOf(field);
    console.log('  context:', JSON.stringify(out.slice(Math.max(0, i - 40), i + 90)));
  }
}
