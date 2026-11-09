// Verify: label coverage after the dictionary + inference, and talent loading.
const path = require('path');
const GAME = 'E:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game';

const dataStore = require('../electron/data-store.cjs');
const labels = require('../electron/labels.cjs');

const info = dataStore.init(GAME);
console.log('vpk entries:', info.entries);

const heroes = dataStore.loadHeroes();
console.log('heroes:', heroes.length);

// Coverage
let total = 0, game = 0, dict = 0, inferred = 0;
for (const hero of heroes.slice(0, 50)) {
  for (const a of dataStore.loadHeroAbilities(hero.id) || []) {
    for (const row of labels.abilityValueRows(
      { ...a.data, __id: a.id },
      (l, t) => dataStore.lookup(l, t)
    )) {
      total++;
      if (row.localized) game++;
      else if (labels.COMMON_VALUE_LABELS[row.key]) dict++;
      else inferred++;
    }
  }
}
console.log('\n=== label coverage (50 heroes) ===');
console.log(`total rows     : ${total}`);
console.log(`  from game    : ${game}  (${(game / total * 100).toFixed(1)}%)`);
console.log(`  from dict    : ${dict}  (${(dict / total * 100).toFixed(1)}%)`);
console.log(`  inferred raw : ${inferred}  (${(inferred / total * 100).toFixed(1)}%)`);
console.log(`  >>> labelled : ${(((game + dict) / total) * 100).toFixed(1)}%`);

// Talents
console.log('\n=== talents ===');
for (const heroId of ['npc_dota_hero_drow_ranger', 'npc_dota_hero_antimage', 'npc_dota_hero_axe']) {
  const t = dataStore.loadHeroTalents(heroId);
  console.log(`${heroId}: ${t.length} talents`);
  for (const x of t.slice(0, 5)) {
    const rows = labels.abilityValueRows({ ...x.data, __id: x.id }, (l, tk) => dataStore.lookup(l, tk));
    console.log(`   ${x.name_zh || '(no zh)'} | ${x.id}`);
    for (const r of rows) console.log(`      ${r.label_zh} = ${r.value}`);
  }
}
