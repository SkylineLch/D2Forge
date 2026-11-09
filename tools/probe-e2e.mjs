import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const os = require('os');
const { openVpk, readText, writeVpk } = require('../electron/vpk.cjs');
const { parseKV } = require('../electron/kv-parser.cjs');
const gameinfo = require('../electron/gameinfo.cjs');

const GAME = 'E:/SteamLibrary/steamapps/common/dota 2 beta/game';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd2forge-'));

// 1. build a small override VPK
const src = openVpk(GAME + '/dota/pak01_dir.vpk');
const rel = 'scripts/npc/heroes/npc_dota_hero_antimage.txt';
let text = readText(src, rel);
text = text.replace(/"MovementSpeed"\t\t"[^"]*"/, '"MovementSpeed"\t\t"999"');

const outVpk = path.join(tmp, 'pak01_dir.vpk');
writeVpk(outVpk, [
  { rel, data: Buffer.from(text, 'utf8') },
  { rel: 'scripts/npc/items.txt', data: Buffer.from('"DOTAAbilities"\n{\n}\n', 'utf8') },
]);
console.log('written size', fs.statSync(outVpk).size);

// 2. read it back
const back = openVpk(outVpk);
console.log('entries read back:', back.entries.size);
const backText = readText(back, rel);
console.log('MovementSpeed in new vpk:', backText.match(/"MovementSpeed"[^\n]*/)[0]);
const { root } = parseKV(backText);
console.log('parsed MovementSpeed:', root.DOTAHeroes.npc_dota_hero_antimage.MovementSpeed);
console.log('identical to source text:', backText === text);

// 3. gameinfo activation on a fake tree
const fakeGame = path.join(tmp, 'game');
fs.mkdirSync(path.join(fakeGame, 'dota'), { recursive: true });
const gi = path.join(fakeGame, 'dota', 'gameinfo.gi');
const giSrc = fs.readFileSync(GAME + '/dota/gameinfo.gi');
fs.writeFileSync(gi, giSrc);

const beforeCrc = gameinfo.computeCrc32(fs.readFileSync(gi));
const dataDir = path.join(tmp, 'data');
const r = gameinfo.activate(fakeGame, dataDir, '0test');
const after = fs.readFileSync(gi);
const afterCrc = gameinfo.computeCrc32(after);

console.log('\n--- gameinfo ---');
console.log('changed:', r.changed);
console.log('crc before:', beforeCrc.toString(16), 'after:', afterCrc.toString(16), 'MATCH:', beforeCrc === afterCrc);
console.log('isActive:', gameinfo.isActive(fakeGame, '0test'));
console.log('backup exists:', fs.existsSync(gameinfo.backupPath(dataDir)));

const lines = after.toString('utf8').split('\n');
const idx = lines.findIndex(l => l.includes('SearchPaths'));
console.log('\nSearchPaths block after patch:');
console.log(lines.slice(idx, idx + 8).map(l => '  ' + l).join('\n'));
console.log('\ntail bytes:', JSON.stringify(after.subarray(-12).toString('utf8')));

// 4. idempotent
const r2 = gameinfo.activate(fakeGame, dataDir, '0test');
console.log('\nsecond activate changed:', r2.changed, '| crc still', gameinfo.computeCrc32(fs.readFileSync(gi)).toString(16));

// 5. revert
gameinfo.revert(fakeGame, dataDir);
const reverted = fs.readFileSync(gi);
console.log('reverted crc:', gameinfo.computeCrc32(reverted).toString(16), 'matches original:', gameinfo.computeCrc32(reverted) === beforeCrc);
console.log('reverted active:', gameinfo.isActive(fakeGame, '0test'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\ntmp cleaned');
