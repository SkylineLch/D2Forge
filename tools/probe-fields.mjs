import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ds = require('../electron/data-store.cjs');
const fs = require('fs');

const conf = fs.readFileSync('data/conf.txt', 'utf8').match(/"path"\s+"(.+?)"/)[1].replace(/\\\\/g, '\\');
ds.init(conf);

const hero = ds.loadHero('antimage_never_more') || ds.loadHero(ds.getHeroOrder()[0]);
console.log('=== HERO:', hero.id, hero.name_zh, '/', hero.name_en);
const d = hero.data;
const scalar = [], obj = [];
for (const [k, v] of Object.entries(d)) {
  if (typeof v === 'string') scalar.push(k);
  else obj.push(k);
}
console.log('--- scalar fields (' + scalar.length + ') ---');
console.log(scalar.join(', '));
console.log('--- object fields (' + obj.length + ') ---');
console.log(obj.join(', '));

const ab = ds.loadHeroAbilities(hero.id);
console.log('\n=== ABILITIES:', ab.length);
for (const a of ab.slice(0, 3)) {
  console.log('\n* ' + a.id, '|', a.name_zh, '/', a.name_en);
  for (const [k, v] of Object.entries(a.data)) {
    if (typeof v === 'string') console.log('   ' + k + ' = ' + JSON.stringify(v));
    else if (k === 'AbilityValues') console.log('   AbilityValues = {' + Object.keys(v).length + ' keys}');
    else console.log('   ' + k + ' = <obj ' + Object.keys(v).length + '>');
  }
  console.log('   --- AbilityValues sample ---');
  const av = a.data.AbilityValues || {};
  let n = 0;
  for (const [k, v] of Object.entries(av)) {
    console.log('     ' + k + ' = ' + (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v)));
    if (++n >= 6) break;
  }
}

console.log('\n=== ITEM: item_blink');
const items = ds.loadItems();
const blink = items.find(i => i.id === 'item_blink');
console.log(blink.name_zh, '/', blink.name_en);
for (const [k, v] of Object.entries(blink.data)) {
  console.log('  ' + k + ' = ' + (typeof v === 'string' ? JSON.stringify(v) : '<obj ' + Object.keys(v).length + '>'));
}
