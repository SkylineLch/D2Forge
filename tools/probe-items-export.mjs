import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { openVpk, readText, writeVpk } = require('../electron/vpk.cjs');
const exporter = require('../electron/exporter.cjs');
const { parseKV } = require('../electron/kv-parser.cjs');

const GAME = 'E:/SteamLibrary/steamapps/common/dota 2 beta/game';
const REL = 'scripts/npc/items.txt';
const ITEM = 'item_blink';

const src = openVpk(path.join(GAME, 'dota', 'pak01_dir.vpk'));
const original = readText(src, REL);
console.log('items.txt bytes:', original.length);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd2f-items-'));
const dotaDir = path.join(tmp, 'dota');
fs.mkdirSync(dotaDir, { recursive: true });
writeVpk(path.join(dotaDir, 'pak01_dir.vpk'), [{ rel: REL, data: Buffer.from(original, 'utf8') }]);
fs.copyFileSync(path.join(GAME, 'dota', 'gameinfo.gi'), path.join(dotaDir, 'gameinfo.gi'));

const changes = [
  { category: 'items', id: ITEM, field: 'ItemCost', oldValue: '2250', newValue: '1' },
  { category: 'items', id: ITEM, field: 'AbilityCooldown', oldValue: '15.0', newValue: '2.0' },
  { category: 'items', id: ITEM, field: 'values.blink_range', oldValue: '1200', newValue: '5000' },
  { category: 'items', id: 'item_black_king_bar', field: 'ItemCost', oldValue: '4050', newValue: '100' },
];

console.log('\n--- changes ---');
for (const c of changes) console.log(` ${c.id}.${c.field}  ${c.oldValue} -> ${c.newValue}`);

const res = exporter.apply(tmp, changes);
console.log('\nresult files:', res.files);

const out = openVpk(path.join(dotaDir, '0test', 'pak01_dir.vpk'));
const patched = readText(out, REL);

const chk = parseKV(patched).root.DOTAAbilities;
console.log('\n--- verification ---');
console.log('blink.ItemCost          =', chk[ITEM].ItemCost, chk[ITEM].ItemCost === '1' ? 'OK' : 'FAIL');
console.log('blink.AbilityCooldown   =', chk[ITEM].AbilityCooldown, chk[ITEM].AbilityCooldown === '2.0' ? 'OK' : 'FAIL');
console.log('blink.blink_range       =', chk[ITEM].AbilityValues.blink_range, chk[ITEM].AbilityValues.blink_range === '5000' ? 'OK' : 'FAIL');
console.log('bkb.ItemCost            =', chk.item_black_king_bar.ItemCost, chk.item_black_king_bar.ItemCost === '100' ? 'OK' : 'FAIL');

const before = Object.keys(parseKV(original).root.DOTAAbilities).length;
const after = Object.keys(chk).length;
console.log('entry count             :', before, '->', after, before === after ? 'OK' : 'FAIL');

const bl = original.split('\n');
const al = patched.split('\n');
let diffs = 0;
for (let i = 0; i < Math.max(bl.length, al.length); i++) if (bl[i] !== al[i]) diffs++;
console.log('line count / diffs      :', bl.length, '->', al.length, '|', diffs, 'differing');

console.log('\ntmp:', tmp);
