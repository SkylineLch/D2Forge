import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { openVpk, readText } = require('../electron/vpk.cjs');
const { parseKV } = require('../electron/kv-parser.cjs');

const GAME = 'E:/SteamLibrary/steamapps/common/dota 2 beta/game';
const vpk = openVpk(GAME + '/dota/pak01_dir.vpk');

for (const id of ['npc_dota_hero_antimage', 'npc_dota_hero_base']) {
  const text = readText(vpk, `scripts/npc/heroes/${id}.txt`);
  console.log('='.repeat(60));
  console.log(id, 'len', text?.length);
  console.log(text?.slice(0, 900));
  const { root } = parseKV(text);
  console.log('root keys:', Object.keys(root));
  const heroes = root.DOTAHeroes || {};
  console.log('hero keys in DOTAHeroes:', Object.keys(heroes));
  const h = heroes[id];
  if (h) {
    console.log('field count:', Object.keys(h).length);
    console.log('fields:', Object.keys(h).join(', '));
    if (h.AbilityDefinitions) {
      console.log('AbilityDefinitions keys:', Object.keys(h.AbilityDefinitions));
      const first = Object.keys(h.AbilityDefinitions)[0];
      console.log('--- first ability:', first);
      console.log('ability fields:', Object.keys(h.AbilityDefinitions[first]).join(', '));
      console.log('sample:', JSON.stringify(h.AbilityDefinitions[first], null, 2).slice(0, 1200));
    }
  }
}
