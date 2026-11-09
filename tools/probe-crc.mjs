import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { computeCrc32, patchCrc32, isActive } = require('../electron/gameinfo.cjs');

// 1. known vector
console.log('crc32("123456789") =', computeCrc32(Buffer.from('123456789')).toString(16), '(expect cbf43926)');

// 2. patch round-trip on random buffers
let ok = 0, bad = 0;
for (let t = 0; t < 500; t++) {
  const len = 10 + Math.floor(Math.random() * 200);
  const buf = Buffer.alloc(len);
  for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 256);
  const target = computeCrc32(buf);
  // copy, perturb last 6 bytes, then patch back to target
  const copy = Buffer.from(buf);
  for (let i = 0; i < 6; i++) copy[len - 6 + i] = (copy[len - 6 + i] + 7) & 0xff;
  patchCrc32(copy, target, 4);
  if (computeCrc32(copy) === target) ok++; else bad++;
}
console.log(`patch round-trip: ok=${ok} bad=${bad}`);

// 3. real gameinfo
const GAME = 'E:/SteamLibrary/steamapps/common/dota 2 beta/game';
console.log('isActive(0test):', isActive(GAME, '0test'));
