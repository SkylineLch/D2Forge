import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { openVpk, readText } = require('../electron/vpk.cjs');

const GAME = 'E:/SteamLibrary/steamapps/common/dota 2 beta/game';
const vpk = openVpk(GAME + '/dota/pak01_dir.vpk');
const text = readText(vpk, 'resource/localization/abilities_schinese.txt');

const lines = text.split('\n');
const show = (prefix, limit = 30) => {
  const hits = lines.filter(l => l.includes(`"${prefix}`));
  console.log(`\n=== ${prefix}  (${hits.length})`);
  console.log(hits.slice(0, limit).map(l => '  ' + l.trim()).join('\n'));
};

show('DOTA_Tooltip_ability_antimage_blink');
show('DOTA_Tooltip_ability_axe_berserkers_call');
show('DOTA_Tooltip_ability_crystal_maiden_frostbite');
show('DOTA_Tooltip_ability_item_blink');
