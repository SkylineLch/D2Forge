import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ds = require('../electron/data-store.cjs');

const GAME = 'E:/SteamLibrary/steamapps/common/dota 2 beta/game';

const t0 = Date.now();
ds.init(GAME);
console.log('init ms', Date.now() - t0);

let t = Date.now();
const heroes = ds.loadHeroes({ withAbilities: true });
console.log('heroes+abilities ms', Date.now() - t);

t = Date.now();
const items = ds.loadItems();
console.log('items ms', Date.now() - t);

t = Date.now();
const abilities = ds.loadAbilities();
console.log('abilities ms', Date.now() - t);

console.log('\n--- first 8 heroes ---');
for (const h of heroes.slice(0, 8)) {
  console.log(`${h.id.padEnd(36)} ${h.name_zh.padEnd(10)} ${h.name_en.padEnd(20)} abilities=${h.abilities.length}`);
}

console.log('\ntotal heroes', heroes.length);
console.log('\n--- items sample ---');
for (const i of items.slice(0, 6)) console.log(`${i.id.padEnd(30)} ${i.name_zh} | ${i.name_en}`);

console.log('\n--- global abilities sample ---');
for (const a of abilities.slice(0, 6)) console.log(`${a.id.padEnd(30)} ${a.name_zh} | ${a.name_en}`);

console.log('\n--- antimage abilities ---');
const am = heroes.find(h => h.id === 'npc_dota_hero_antimage');
for (const a of am.abilities) console.log(`${a.id.padEnd(32)} ${a.name_zh} | ${a.name_en}`);
console.log('\nAbilityValues of mana_break:', JSON.stringify(am.abilities[0].data.AbilityValues, null, 1));

console.log('\nheap MB', Math.round(process.memoryUsage().heapUsed / 1048576));
console.log('total ms', Date.now() - t0);
