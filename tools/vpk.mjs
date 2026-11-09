import fs from 'node:fs';
import path from 'node:path';

const SIG = 0x55aa1234;

export function openVpk(dirVpkPath) {
  const fd = fs.openSync(dirVpkPath, 'r');
  const head = Buffer.alloc(28);
  fs.readSync(fd, head, 0, 28, 0);
  if (head.readUInt32LE(0) !== SIG) throw new Error('not a vpk');
  const version = head.readUInt32LE(4);
  const treeSize = head.readUInt32LE(8);
  if (version !== 2) throw new Error('unsupported vpk version ' + version);
  const headerSize = 28;
  const tree = fs.readFileSync(dirVpkPath).subarray(headerSize, headerSize + treeSize);
  const entries = new Map();
  let p = 0;
  const readStr = () => {
    const s = p;
    while (tree[p] !== 0) p++;
    const v = tree.toString('utf8', s, p);
    p++;
    return v;
  };
  const base = dirVpkPath.replace(/_dir\.vpk$/i, '');
  for (;;) {
    const ext = readStr();
    if (!ext) break;
    for (;;) {
      const dir = readStr();
      if (!dir) break;
      for (;;) {
        const name = readStr();
        if (!name) break;
        const crc = tree.readUInt32LE(p); p += 4;
        const preload = tree.readUInt16LE(p); p += 2;
        const arch = tree.readUInt16LE(p); p += 2;
        const offset = tree.readUInt32LE(p); p += 4;
        const length = tree.readUInt32LE(p); p += 4;
        p += 2; // terminator
        const preloadBuf = tree.subarray(p, p + preload);
        p += preload;
        const rel = (dir ? dir + '/' : '') + name + '.' + ext;
        entries.set(rel.toLowerCase(), { rel, ext, dir, name, crc, preload: preloadBuf, arch, offset, length, base });
      }
    }
  }
  return { entries, treeSize, headerSize, dirVpkPath };
}

export function readEntry(vpk, entry) {
  if (entry.length === 0) return Buffer.from(entry.preload);
  let data;
  if (entry.arch === 0x7fff) {
    const fd = fs.openSync(vpk.dirVpkPath, 'r');
    data = Buffer.alloc(entry.length);
    fs.readSync(fd, data, 0, entry.length, vpk.headerSize + vpk.treeSize + entry.offset);
    fs.closeSync(fd);
  } else {
    const f = `${entry.base}_${String(entry.arch).padStart(3, '0')}.vpk`;
    const fd = fs.openSync(f, 'r');
    data = Buffer.alloc(entry.length);
    fs.readSync(fd, data, 0, entry.length, entry.offset);
    fs.closeSync(fd);
  }
  return entry.preload.length ? Buffer.concat([Buffer.from(entry.preload), data]) : data;
}
