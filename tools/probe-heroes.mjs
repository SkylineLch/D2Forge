import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { openVpk, readText } = require('../electron/vpk.cjs');
const { parseKV } = require('../electron/kv-parser.cjs');

const GAME = 'E:/SteamLibrary/steamapps/common/dota 2 beta/game';
const vpk = openVpk(GAME + '/dota/pak01_dir.vpk');

// list candidates
const cands = [...vpk.entries.keys()].filter(k => k.endsWith('npc_heroes.txt') || (k.startsWith('scripts/npc/heroes/') && k.endsWith('.txt')));
console.log('candidates:', cands.length);
console.log(cands.slice(0, 15).join('\n'));

const text = readText(vpk, 'scripts/npc/npc_heroes.txt');
console.log('\nlength', text?.length);
console.log('head:\n', text?.slice(0, 600));

const { root, directives } = parseKV(text);
console.log('\nroot keys:', Object.keys(root));
console.log('directives:', directives.length ? directives.slice(0, 10) : '(none)');
