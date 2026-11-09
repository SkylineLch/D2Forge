const path = require('path');
const GAME = 'E:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game';
const store = require('../electron/data-store.cjs');

store.init(GAME);
store.loadHeroes({ ids: ['npc_dota_hero_drow_ranger'] }); // warm localization

for (const hero of ['npc_dota_hero_drow_ranger', 'npc_dota_hero_axe', 'npc_dota_hero_antimage']) {
  const t = store.loadHeroTalents(hero);
  console.log(`\n=== ${hero}: ${t.length} talents ===`);
  for (const x of t) {
    console.log(`  [T${x.tier ?? '-'}] ${x.id}`);
    console.log(`       zh=${x.name_zh}`);
    console.log(`       en=${x.name_en}`);
    console.log(`       bonus=${x.bonus} editable=${x.editable} host=${x.host ? x.host.kind + ':' + (x.host.abilityId || x.host.file) + '.' + x.host.field : 'none'}`);
  }
}
