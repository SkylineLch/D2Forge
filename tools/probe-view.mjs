import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ds = require('../electron/data-store.cjs');
const labels = require('../electron/labels.cjs');
const fs = require('fs');

const conf = fs.readFileSync('data/conf.txt', 'utf8').match(/"path"\s+"(.+?)"/)[1].replace(/\\\\/g, '\\');
ds.init(conf);

const hero = ds.loadHero('npc_dota_hero_antimage');
console.log('HERO:', hero.id, hero.name_zh);

const groups = labels.HERO_STAT_GROUPS.map(g => ({
  id: g.id, zh: g.zh,
  fields: g.fields.filter(f => hero.data[f.key] !== undefined).map(f => ({ key: f.key, val: hero.data[f.key] }))
}));
for (const g of groups) {
  console.log('\n[' + g.zh + '] (' + g.fields.length + ')');
  for (const f of g.fields) console.log('  ' + f.key + ' = ' + JSON.stringify(f.val));
}

const abilities = ds.loadHeroAbilities(hero.id);
console.log('\n=== ability view for', abilities.length, 'abilities ===');
for (const a of abilities) {
  const data = { ...a.data, __id: a.id };
  const rows = labels.abilityValueRows(data, (l, t) => ds.lookup(l, t));
  const scalars = labels.ABILITY_SCALARS.filter(f => data[f.key] !== undefined).map(f => f.key + '=' + data[f.key]);
  console.log('\n* ' + a.id + ' | ' + a.name_zh + ' | scalars: ' + (scalars.join(', ') || 'none'));
  const loc = rows.filter(r => r.localized).length;
  console.log('  values: ' + rows.length + ' rows, ' + loc + ' localized');
  for (const r of rows.slice(0, 4)) {
    console.log('    ' + r.key + '  zh="' + r.label_zh + '" en="' + r.label_en + '" = ' + JSON.stringify(r.value) + (r.extras.length ? ' extras=' + JSON.stringify(r.extras) : ''));
  }
}

console.log('\n=== ITEM item_blink ===');
const blink = ds.loadItems().find(i => i.id === 'item_blink');
const bd = { ...blink.data, __id: blink.id };
console.log('scalars:', labels.ITEM_SCALARS.filter(f => bd[f.key] !== undefined).map(f => f.key + '=' + bd[f.key]).join(', '));
const brows = labels.abilityValueRows(bd, (l, t) => ds.lookup(l, t));
for (const r of brows) console.log('  ' + r.key + ' zh="' + r.label_zh + '" = ' + JSON.stringify(r.value));
