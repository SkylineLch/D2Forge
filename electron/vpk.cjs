'use strict';
// VPK v1/v2 reader + writer for Dota 2 pak01_dir.vpk archives.
// Reader: parses the directory tree and pulls file bytes out of the split archives.
// Writer: builds a small standalone VPK holding only the files we override.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SIGNATURE = 0x55aa1234;
const ARCH_INDEX = 0x7fff;
const SUFFIX = 0xffff;
const END_OF_STRING = 0;

/* ------------------------------- CRC32 ------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------- Reader ------------------------------ */

function openVpk(dirVpkPath) {
  const buf = fs.readFileSync(dirVpkPath);
  if (buf.readUInt32LE(0) !== SIGNATURE) throw new Error('Not a VPK archive');

  const version = buf.readUInt32LE(4);
  if (version !== 1 && version !== 2) throw new Error(`Unsupported VPK version ${version}`);

  const treeSize = buf.readUInt32LE(8);
  const headerSize = version === 1 ? 12 : 28;
  const base = dirVpkPath.replace(/_dir\.vpk$/i, '');

  const entries = new Map();
  let p = headerSize;
  const treeEnd = headerSize + treeSize;

  const readStr = () => {
    const start = p;
    while (p < treeEnd && buf[p] !== END_OF_STRING) p++;
    const s = buf.toString('utf8', start, p);
    p++;
    return s;
  };

  for (;;) {
    if (p >= treeEnd) break;
    const ext = readStr();
    if (!ext) break;

    for (;;) {
      if (p >= treeEnd) break;
      const dir = readStr();
      if (!dir) break;

      for (;;) {
        if (p >= treeEnd) break;
        const name = readStr();
        if (!name) break;

        const crc = buf.readUInt32LE(p); p += 4;
        const preloadLen = buf.readUInt16LE(p); p += 2;
        const arch = buf.readUInt16LE(p); p += 2;
        const offset = buf.readUInt32LE(p); p += 4;
        const length = buf.readUInt32LE(p); p += 4;
        const suffix = buf.readUInt16LE(p); p += 2;
        if (suffix !== SUFFIX) throw new Error(`Bad entry terminator for ${name}.${ext}`);

        const preload = buf.subarray(p, p + preloadLen);
        p += preloadLen;

        const rel = (dir ? dir + '/' : '') + name + '.' + ext;
        entries.set(rel.toLowerCase(), {
          rel, ext, dir, name, crc, preload, arch, offset, length, base,
        });
      }
    }
  }

  return { entries, treeSize, headerSize, dirVpkPath, base, version };
}

function readEntry(vpk, entry) {
  if (!entry) return null;

  let body;
  if (entry.length === 0) {
    body = Buffer.alloc(0);
  } else if (entry.arch === ARCH_INDEX) {
    const fd = fs.openSync(vpk.dirVpkPath, 'r');
    try {
      body = Buffer.alloc(entry.length);
      fs.readSync(fd, body, 0, entry.length, vpk.headerSize + vpk.treeSize + entry.offset);
    } finally {
      fs.closeSync(fd);
    }
  } else {
    const archive = `${entry.base}_${String(entry.arch).padStart(3, '0')}.vpk`;
    const fd = fs.openSync(archive, 'r');
    try {
      body = Buffer.alloc(entry.length);
      fs.readSync(fd, body, 0, entry.length, entry.offset);
    } finally {
      fs.closeSync(fd);
    }
  }

  return entry.preload.length ? Buffer.concat([Buffer.from(entry.preload), body]) : body;
}

function readText(vpk, relPath) {
  const entry = vpk.entries.get(relPath.toLowerCase());
  if (!entry) return null;
  return readEntry(vpk, entry).toString('utf8');
}

/* ------------------------------- Writer ------------------------------ */

/**
 * Build a single-file VPK (all data inline, arch index 0x7fff) at outputPath.
 * @param {Array<{rel: string, data: Buffer}>} files
 */
function writeVpk(outputPath, files) {
  const tree = new Map(); // ext -> Map<dir, Array<{name, data, crc}>>

  for (const file of files) {
    const slash = file.rel.lastIndexOf('/');
    // VPK encodes root-level files under a single space, never an empty dir
    // string (an empty string is the end-of-list sentinel).
    const dir = slash === -1 ? ' ' : file.rel.slice(0, slash);
    const filename = slash === -1 ? file.rel : file.rel.slice(slash + 1);
    const dot = filename.lastIndexOf('.');
    if (dot === -1) throw new Error(`File without extension: ${file.rel}`);
    const ext = filename.slice(dot + 1);
    const name = filename.slice(0, dot);

    if (!tree.has(ext)) tree.set(ext, new Map());
    const dirs = tree.get(ext);
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir).push({ name, data: file.data, crc: crc32(file.data) });
  }

  // Serialize the tree. Layout per level:
  //   ext \0 { dir \0 { name \0 meta(18) ... } \0 } \0 ... \0
  // The trailing \0 of each list and one final \0 close the whole tree.
  const treeParts = [];
  let dataOffset = 0;
  const dataParts = [];

  for (const [ext, dirs] of tree) {
    treeParts.push(Buffer.from(ext, 'utf8'), Buffer.from([END_OF_STRING]));
    for (const [dir, names] of dirs) {
      treeParts.push(Buffer.from(dir, 'utf8'), Buffer.from([END_OF_STRING]));
      for (const item of names) {
        const meta = Buffer.alloc(18);
        meta.writeUInt32LE(item.crc, 0);
        meta.writeUInt16LE(0, 4);              // preload length
        meta.writeUInt16LE(ARCH_INDEX, 6);     // arch index (inline data)
        meta.writeUInt32LE(dataOffset, 8);     // offset into data section
        meta.writeUInt32LE(item.data.length, 12);
        meta.writeUInt16LE(SUFFIX, 16);
        treeParts.push(Buffer.from(item.name, 'utf8'), Buffer.from([END_OF_STRING]), meta);
        dataParts.push(item.data);
        dataOffset += item.data.length;
      }
      treeParts.push(Buffer.from([END_OF_STRING])); // end of file list
    }
    treeParts.push(Buffer.from([END_OF_STRING]));   // end of dir list
  }
  treeParts.push(Buffer.from([END_OF_STRING]));     // end of ext list

  const treeBuf = Buffer.concat(treeParts);
  const treeLen = treeBuf.length;                   // measured, never estimated
  const dataBuf = Buffer.concat(dataParts);

  const headerSize = 28;
  const header = Buffer.alloc(headerSize);
  header.writeUInt32LE(SIGNATURE, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(treeLen, 8);
  header.writeUInt32LE(dataBuf.length, 12);
  header.writeUInt32LE(0, 16); // chunk hash count
  header.writeUInt32LE(0, 20);
  header.writeUInt32LE(0, 24);

  const body = Buffer.concat([header, treeBuf, dataBuf]);
  const treeHash = crypto.createHash('md5').update(treeBuf).digest();
  const chunkHash = crypto.createHash('md5').update(dataBuf).digest();
  const signature = crypto.createHash('md5').update(Buffer.concat([body, treeHash, chunkHash])).digest();

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.concat([body, treeHash, chunkHash, signature]));
  return outputPath;
}

module.exports = { openVpk, readEntry, readText, writeVpk, crc32, ARCH_INDEX };
