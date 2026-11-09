const path = require('path');
const GAME = 'E:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game';
const store = require('../electron/data-store.cjs');
const exp = require('../electron/exporter.cjs');

store.init(GAME);
store.loadHeroes({ ids: ['npc_dota_hero_drow_ranger'] });

// Build a change set mirroring what the UI sends.
const changes = [
  {
    category: 'heroes',
    id: 'npc_dota_hero_drow_ranger',
    field: 'talents.special_bonus_unique_drow_ranger_1.bonus.drow_ranger_multishot.arrow_damage_pct',
    oldValue: '+25',
    newValue: '+33',
  },
  {
    category: 'heroes',
    id: 'npc_dota_hero_drow_ranger',
    field: 'talents.special_bonus_attack_range_75.value.value',
    oldValue: '75',
    newValue: '90',
  },
  {
    category: 'heroes',
    id: 'npc_dota_hero_drow_ranger',
    field: 'abilities.drow_ranger_multishot.values.arrow_width',
    oldValue: '90',
    newValue: '120',
  },
];

console.log('=== locate ===');
for (const ch of changes) console.log(' ', JSON.stringify(exp.locate(ch)));

const groups = exp.groupChanges(changes);
console.log('\n=== groupChanges ===');
for (const [file, objs] of groups) {
  console.log(' file:', file);
  for (const o of objs.values()) {
    console.log('   kind:', o.kind, '| path:', o.path.join(' > '));
    for (const f of o.fields) console.log(`     field=${f.field} modifier=${f.modifier} new=${f.newValue}`);
  }
}

// reconcile should read the ORIGINAL values back and confirm they still match.
const rec = exp.reconcile(GAME, changes, (rel) => store.readFile ? store.readFile(rel) : null);
console.log('\n=== reconcile ===');
console.log(' kept:', rec.kept.length, ' dropped:', rec.dropped.length);
for (const d of rec.dropped) {
  console.log('  DROPPED', d.field, '->', d.reason, 'now=', d.gameNow, 'was=', d.wasAtEdit);
}
