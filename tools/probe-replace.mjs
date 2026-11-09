import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { openVpk, readText } = require('../electron/vpk.cjs');
const { parseKV } = require('../electron/kv-parser.cjs');
const { setFieldInBlock, findBlockOffset, matchingBrace } = require('../electron/exporter.cjs');

const GAME = 'E:/SteamLibrary/steamapps/common/dota 2 beta/game';
const vpk = openVpk(GAME + '/dota/pak01_dir.vpk');

const rel = 'scripts/npc/heroes/npc_dota_hero_antimage.txt';
const text = readText(vpk, rel);
console.log('original len', text.length);

const off = findBlockOffset(text, ['npc_dota_hero_antimage']);
console.log('block offset', off, 'char', JSON.stringify(text[off]));

// 1. simple scalar
let t1 = setFieldInBlock(text, off, 'MovementSpeed', '420');
console.log('MovementSpeed changed:', t1 !== text);
console.log('  ->', t1.match(/"MovementSpeed"[^\n]*/)[0]);

// 2. verify only one occurrence changed
const count = (s, re) => (s.match(re) || []).length;
console.log('  occurrences of 420:', count(t1, /"420"/g));

// 3. nested block untouched: find AbilityDefinitions offset
const aOff = findBlockOffset(text, ['npc_dota_hero_antimage', 'AbilityDefinitions']);
console.log('AbilityDefinitions offset', aOff, 'ok:', aOff > 0 && text[aOff] === '{');

// 4. ability-level field
const abilityOff = findBlockOffset(text, ['npc_dota_hero_antimage', 'AbilityDefinitions', 'antimage_mana_break']);
console.log('mana_break offset', abilityOff, 'ok:', abilityOff > 0);

const t2 = setFieldInBlock(text, abilityOff, 'AbilityManaCost', '0');
if (t2 !== text) console.log('  AbilityManaCost ->', t2.match(/"AbilityManaCost"[^\n]*/)[0]);
else console.log('  AbilityManaCost not found in that block (expected if absent)');

// 5. round-trip parse of modified text still valid
const { root } = parseKV(t1);
console.log('reparse MovementSpeed =', root.DOTAHeroes.npc_dota_hero_antimage.MovementSpeed);
console.log('reparse AbilityDefinitions keys =', Object.keys(root.DOTAHeroes.npc_dota_hero_antimage.AbilityDefinitions).length);

// 6. structural integrity: brace balance unchanged, line count delta
const bal = s => (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
console.log('brace balance orig/new:', bal(text), bal(t1));
console.log('line count orig/new:', text.split('\n').length, t1.split('\n').length);
console.log('matchingBrace ok:', matchingBrace(text, off) === text.lastIndexOf('}'));
