import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { openVpk, readText } = require('../electron/vpk.cjs');

const GAME = 'E:/SteamLibrary/steamapps/common/dota 2 beta/game';
const vpk = openVpk(GAME + '/dota/pak01_dir.vpk');
const text = readText(vpk, 'resource/localization/abilities_schinese.txt');

for (const n of ['antimage_spell_shield', 'antimage_mana_overload', 'antimage_mana_thirst']) {
  console.log(`\n=== ${n}`);
  const lines = text.split('\n').filter(l => l.includes(n));
  console.log(lines.length ? lines.slice(0, 6).map(l => '  ' + l.trim()).join('\n') : '  (none)');
}

// check dota_schinese too
const dota = readText(vpk, 'resource/localization/dota_schinese.txt');
for (const n of ['antimage_spell_shield', 'antimage_mana_overload', 'antimage_mana_thirst']) {
  const lines = dota.split('\n').filter(l => l.includes(n));
  console.log(`\n=== dota file ${n}: ${lines.length}`);
  if (lines.length) console.log(lines.slice(0, 4).map(l => '  ' + l.trim()).join('\n'));
}
