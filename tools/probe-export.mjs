import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { openVpk, readText, writeVpk } = require('../electron/vpk.cjs');
const exporter = require('../electron/exporter.cjs');
const { parseKV } = require('../electron/kv-parser.cjs');

const GAME = 'E:/SteamLibrary/steamapps/common/dota 2 beta/game';
const HERO = 'npc_dota_hero_antimage';
const REL = `scripts/npc/heroes/${HERO}.txt`;

const src = openVpk(path.join(GAME, 'dota', 'pak01_dir.vpk'));
const original = readText(src, REL);
if (!original) throw new Error('hero file not found in VPK');
console.log('source bytes:', original.length);

// ---- build a throwaway game folder so nothing real is touched ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd2f-export-'));
const dotaDir = path.join(tmp, 'dota');
fs.mkdirSync(dotaDir, { recursive: true });
writeVpk(path.join(dotaDir, 'pak01_dir.vpk'), [{ rel: REL, data: Buffer.from(original, 'utf8') }]);
fs.copyFileSync(path.join(GAME, 'dota', 'gameinfo.gi'), path.join(dotaDir, 'gameinfo.gi'));

// ---- pick real AbilityValues keys from the parsed file ----
const { root } = parseKV(original);
const heroObj = root.DOTAHeroes[HERO];
const abilities = heroObj.AbilityDefinitions || {};

const scalarFormKeys = [];
const objectFormKeys = [];
let abilityWithValues = null;

for (const [aid, adef] of Object.entries(abilities)) {
  const av = adef.AbilityValues;
  if (!av) continue;
  for (const [k, v] of Object.entries(av)) {
    if (typeof v === 'string') scalarFormKeys.push({ aid, k, v });
    else if (v && typeof v === 'object' && v.value !== undefined) objectFormKeys.push({ aid, k, v: v.value });
  }
  if (!abilityWithValues) abilityWithValues = aid;
}

console.log('object-form values:', objectFormKeys.length, '| scalar-form values:', scalarFormKeys.length);

const changes = [];

// 1) hero base stat
changes.push({ category: 'heroes', id: HERO, field: 'MovementSpeed', oldValue: heroObj.MovementSpeed, newValue: '999' });

// 2) ability scalar
const firstAbility = Object.keys(abilities).find((a) => abilities[a].AbilityCastPoint !== undefined);
if (firstAbility) {
  changes.push({
    category: 'heroes', id: HERO,
    field: `abilities.${firstAbility}.AbilityCastPoint`,
    oldValue: abilities[firstAbility].AbilityCastPoint, newValue: '0.01',
  });
}

// 3) AbilityValues object form
if (objectFormKeys.length) {
  const o = objectFormKeys[0];
  changes.push({
    category: 'heroes', id: HERO,
    field: `abilities.${o.aid}.values.${o.k}`,
    oldValue: o.v, newValue: '12345',
  });
}

// 4) AbilityValues scalar form
if (scalarFormKeys.length) {
  const s = scalarFormKeys[0];
  changes.push({
    category: 'heroes', id: HERO,
    field: `abilities.${s.aid}.values.${s.k}`,
    oldValue: s.v, newValue: '777',
  });
}

console.log('\n--- changes ---');
for (const c of changes) console.log(` ${c.field}  ${c.oldValue} -> ${c.newValue}`);

// ---- run export ----
const res = exporter.apply(tmp, changes);
console.log('\n--- apply result ---');
console.log(JSON.stringify(res, null, 2));

// ---- read back and verify ----
const out = openVpk(path.join(dotaDir, '0test', 'pak01_dir.vpk'));
const patched = readText(out, REL);
if (!patched) throw new Error('patched file missing from override VPK');

const chk = parseKV(patched).root.DOTAHeroes[HERO];
console.log('\n--- verification ---');
console.log('MovementSpeed          =', chk.MovementSpeed, chk.MovementSpeed === '999' ? 'OK' : 'FAIL');
if (firstAbility) {
  const v = chk.AbilityDefinitions[firstAbility].AbilityCastPoint;
  console.log(`${firstAbility}.CastPoint  =`, v, v === '0.01' ? 'OK' : 'FAIL');
}
if (objectFormKeys.length) {
  const o = objectFormKeys[0];
  const v = chk.AbilityDefinitions[o.aid].AbilityValues[o.k].value;
  console.log(`${o.k}.value   =`, JSON.stringify(v), v === '12345' ? 'OK' : 'FAIL');
}
if (scalarFormKeys.length) {
  const s = scalarFormKeys[0];
  const v = chk.AbilityDefinitions[s.aid].AbilityValues[s.k];
  console.log(`${s.k}  =`, JSON.stringify(v), v === '777' ? 'OK' : 'FAIL');
}

// structure must be intact: same top-level keys, same ability count
const beforeKeys = Object.keys(root.DOTAHeroes[HERO]).sort().join(',');
const afterKeys = Object.keys(chk).sort().join(',');
console.log('hero keys preserved     :', beforeKeys === afterKeys ? 'OK' : 'FAIL');
console.log('ability count           :', Object.keys(abilities).length, '->', Object.keys(chk.AbilityDefinitions).length);

// only edited lines should differ
const beforeLines = original.split('\n');
const afterLines = patched.split('\n');
console.log('line count              :', beforeLines.length, '->', afterLines.length);
let diffs = 0;
for (let i = 0; i < Math.max(beforeLines.length, afterLines.length); i++) {
  if (beforeLines[i] !== afterLines[i]) diffs++;
}
console.log('differing lines         :', diffs);

console.log('\ntmp dir:', tmp);
