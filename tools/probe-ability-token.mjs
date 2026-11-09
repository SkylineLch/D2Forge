import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { openVpk, readText } = require('../electron/vpk.cjs');

const GAME = 'E:/SteamLibrary/steamapps/common/dota 2 beta/game';
const vpk = openVpk(GAME + '/dota/pak01_dir.vpk');
const text = readText(vpk, 'resource/localization/abilities_schinese.txt');
console.log('len', text.length);

const names = ['antimage_mana_break', 'antimage_blink', 'antimage_mana_void', 'axe_berserkers_call', 'crystal_maiden_frostbite'];

for (const n of names) {
  // find all lines mentioning the ability id
  const lines = text.split('\n').filter(l => l.includes(n));
  console.log(`\n=== ${n} -> ${lines.length} lines`);
  console.log(lines.slice(0, 8).map(l => '  ' + l.trim()).join('\n'));
}

// Reverse: find 法力损毁
console.log('\n=== reverse search 法力损毁 ===');
console.log(text.split('\n').filter(l => l.includes('法力损毁')).slice(0, 10).map(l => '  ' + l.trim()).join('\n'));

console.log('\n=== reverse search 闪烁 ===');
console.log(text.split('\n').filter(l => l.includes('闪烁')).slice(0, 10).map(l => '  ' + l.trim()).join('\n'));
