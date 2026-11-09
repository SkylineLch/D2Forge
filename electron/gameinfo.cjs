'use strict';
// gameinfo.gi patching.
//
// To make dota/0test/ override shipped content we must add `Game 0test` inside
// the FileSystem/SearchPaths block. Any edit changes the file's CRC32, which the
// engine uses as a tamper check — so we append a 4-byte comment whose content is
// back-computed to restore the original CRC32.
//
// The inverse-CRC technique comes from Dota2Editor's CRC32.Patch: given the
// running remainder after all but the last `patchLen` bytes, we can solve for
// those last bytes so the final CRC equals the target.

const fs = require('fs');
const path = require('path');

/* ------------------------------- CRC32 ---------------------------------- */

const CRC_TABLE = new Uint32Array(256);
const CRC_INVERSE = new Uint32Array(256);

for (let i = 0; i < 256; i++) {
  let a = i;
  let b = i << 24;
  for (let j = 0; j < 8; j++) {
    a = (a >>> 1) ^ (a & 1 ? 0xedb88320 : 0);
    b = (b << 1) ^ (b & 0x80000000 ? 0xdb710641 : 0);
  }
  CRC_TABLE[i] = a >>> 0;
  CRC_INVERSE[i] = b >>> 0;
}

function computeCrc32(buf) {
  let rem = 0xffffffff;
  for (let i = 0; i < buf.length; i++) rem = (rem >>> 8) ^ CRC_TABLE[(rem ^ buf[i]) & 0xff];
  return (~rem) >>> 0;
}

/**
 * Overwrite the last `patchLen` bytes of `buf` so that crc32(buf) === target.
 * @param {Buffer} buf mutated in place
 */
function patchCrc32(buf, target, patchLen) {
  const pos = buf.length - patchLen;
  if (pos < 0) throw new Error('Buffer shorter than patch length');

  let rem = 0xffffffff;
  for (let i = 0; i < pos; i++) rem = (rem >>> 8) ^ CRC_TABLE[(rem ^ buf[i]) & 0xff];

  for (let i = 0; i < patchLen; i++) buf[pos + i] = (rem >>> (8 * i)) & 0xff;

  rem = ~target >>> 0;
  for (let i = buf.length - 1; i >= pos; i--) {
    rem = ((rem << 8) ^ CRC_INVERSE[rem >>> 24] ^ buf[i]) >>> 0;
  }
  for (let i = 0; i < 4; i++) buf[pos + i] = (rem >>> (8 * i)) & 0xff;
}

/* ---------------------------- gameinfo edit ----------------------------- */

const SEARCH_BLOCK = 'SearchPaths';
const GAME_KEY = 'Game';
const PATCH_LEN = 4;

function gameinfoPath(gamePath) {
  return path.join(gamePath, 'dota', 'gameinfo.gi');
}

function backupPath(dataDir) {
  return path.join(dataDir, 'gameinfo.gi.orig');
}

/** Return the text between the SearchPaths opening brace and its matching brace. */
function searchPathsBody(text) {
  const m = new RegExp(`${SEARCH_BLOCK}[^{]*\\{`).exec(text);
  if (!m) return null;

  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/** Is our override folder already listed inside SearchPaths? */
function isActive(gamePath, folderName = '0test') {
  const p = gameinfoPath(gamePath);
  if (!fs.existsSync(p)) return false;

  const body = searchPathsBody(fs.readFileSync(p, 'utf8'));
  if (body === null) return false;

  // Strip // comments so a commented-out line never counts as active.
  const live = body.replace(/\/\/[^\r\n]*/g, '');
  return new RegExp(`(^|[\\s"])${folderName}([\\s"]|$)`).test(live);
}

/**
 * Insert `Game 0test` into SearchPaths and restore the original CRC32.
 * Backs up the pristine file before the first modification.
 *
 * @param {string} gamePath   .../dota 2 beta/game
 * @param {string} dataDir    where to keep the .orig backup
 * @returns {{changed: boolean, backup?: string, crc?: number}}
 */
function activate(gamePath, dataDir, folderName = '0test') {
  const giPath = gameinfoPath(gamePath);
  if (!fs.existsSync(giPath)) throw new Error(`gameinfo.gi not found: ${giPath}`);

  const original = fs.readFileSync(giPath);
  const text = original.toString('utf8');

  // Already patched: keep the backup, do nothing.
  if (isActive(gamePath, folderName)) {
    return { changed: false, crc: computeCrc32(original) };
  }

  const bk = backupPath(dataDir);
  if (!fs.existsSync(bk)) {
    fs.mkdirSync(path.dirname(bk), { recursive: true });
    fs.writeFileSync(bk, original);
  }

  const patched = insertSearchPath(text, folderName);
  const targetCrc = computeCrc32(original);

  let out = Buffer.from(patched, 'utf8');
  out = Buffer.concat([out, Buffer.from('//' + ' '.repeat(PATCH_LEN), 'utf8')]);
  patchCrc32(out, targetCrc, PATCH_LEN);

  const finalCrc = computeCrc32(out);
  if (finalCrc !== targetCrc) {
    throw new Error(`CRC32 patch failed: ${finalCrc.toString(16)} !== ${targetCrc.toString(16)}`);
  }

  fs.writeFileSync(giPath, out);
  return { changed: true, backup: bk, crc: finalCrc };
}

/**
 * Add the Game line right after the SearchPaths opening brace, keeping the
 * file's existing indentation style.
 */
function insertSearchPath(text, folderName) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  
  // Find SearchPaths { ... }, then locate the position right after the opening {
  const re = new RegExp(
    `(${SEARCH_BLOCK}[^{]*\\{)(\\r?\\n)`,
    's'
  );
  const m = re.exec(text);
  if (!m) throw new Error('SearchPaths block not found in gameinfo.gi');
  
  const insertPos = m.index + m[1].length + m[2].length;
  
  // Extract indentation from the first non-empty line inside the block
  const afterBrace = text.slice(insertPos);
  const indentMatch = afterBrace.match(/^[ \t]+/);
  const indent = indentMatch ? indentMatch[0] : '\t\t\t';
  
  const newLine = `${indent}${GAME_KEY}\t\t\t\t${folderName}${eol}`;
  
  return text.slice(0, insertPos) + newLine + text.slice(insertPos);
}

/** Restore the pristine gameinfo.gi from backup. */
function revert(gamePath, dataDir) {
  const bk = backupPath(dataDir);
  if (!fs.existsSync(bk)) return { changed: false };
  fs.copyFileSync(bk, gameinfoPath(gamePath));
  return { changed: true };
}

module.exports = {
  computeCrc32,
  patchCrc32,
  isActive,
  activate,
  revert,
  gameinfoPath,
  backupPath,
};
