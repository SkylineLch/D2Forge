import { openVpk, readEntry } from './vpk.mjs';

const vpkPath = 'E:/SteamLibrary/steamapps/common/dota 2 beta/game/dota/pak01_dir.vpk';
console.log('Opening VPK:', vpkPath);
const vpk = openVpk(vpkPath);
console.log('Total entries:', vpk.entries.size);

const npcFiles = [];
for (const [key, entry] of vpk.entries) {
  if (key.startsWith('scripts/npc/') && key.endsWith('.txt')) {
    npcFiles.push(key);
  }
}
console.log('\nFound', npcFiles.length, 'NPC scripts:');
npcFiles.slice(0, 20).forEach(f => console.log('  ', f));

// 读取英雄数据示例
const heroFile = 'scripts/npc/npc_heroes.txt';
if (vpk.entries.has(heroFile)) {
  console.log(`\n=== Reading ${heroFile} ===`);
  const entry = vpk.entries.get(heroFile);
  const content = readEntry(vpk, entry);
  console.log('Size:', content.length, 'bytes');
  console.log('First 500 chars:\n', content.toString('utf8', 0, Math.min(500, content.length)));
}
