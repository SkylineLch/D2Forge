'use strict';
/**
 * End-to-end probe for the export path.
 *
 * Reproduces the exact failure the packaged build hit: edits saved but the
 * game showing vanilla numbers. It asserts on the ONE thing that decides
 * whether the engine ever sees the override — the directory the VPK lands in —
 * then round-trips through revert.
 *
 *   node tools/probe-export-path.cjs [gamePath]
 */

const fs = require('fs');
const path = require('path');

const exporter = require('../electron/exporter.cjs');
const gameinfo = require('../electron/gameinfo.cjs');

const gamePath = process.argv[2] || 'E:/SteamLibrary/steamapps/common/dota 2 beta/game';

let pass = 0;
let fail = 0;

function check(label, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log(`game: ${gamePath}\n`);

// --- start from a clean slate so the assertions below mean something -------
exporter.revert(gamePath);
const stale = path.join(gamePath, 'dota', '0test');
check('no stale override at the old depth', !fs.existsSync(stale), stale);

// --- export one real edit --------------------------------------------------
const changes = [{
  category: 'items',
  id: 'item_octarine_core',
  field: 'values.bonus_cooldown',
  oldValue: '25',
  newValue: '50',
  timestamp: Date.now(),
}];

const result = exporter.apply(gamePath, changes);
console.log('\napply() ->', JSON.stringify({
  files: result.files,
  note: result.note,
  skipped: result.skipped,
}, null, 2), '\n');

check('apply wrote at least one file', (result.files?.length ?? 0) > 0, result.note || '');

const expectedVpk = path.join(gamePath, '0test', 'pak01_dir.vpk');
check('override VPK is at <game>/0test', fs.existsSync(expectedVpk), expectedVpk);
check('override VPK is NOT at <game>/dota/0test', !fs.existsSync(stale));
check('gameinfo is mounted', gameinfo.isActive(gamePath, '0test'));

// --- verify the VPK actually carries the new value and a valid header ------
if (fs.existsSync(expectedVpk)) {
  const { openVpk, readText } = require('../electron/vpk.cjs');
  const vpk = openVpk(expectedVpk);
  const text = readText(vpk, 'scripts/npc/items.txt');
  check('items.txt present in override', !!text);

  if (text) {
    const block = /"item_octarine_core"[\s\S]{0,4000}?"bonus_cooldown"\s+"([^"]+)"/.exec(text);
    check('bonus_cooldown written as 50', block?.[1] === '50', `got ${block?.[1]}`);
  }

  const buf = fs.readFileSync(expectedVpk);
  check('VPK signature ok', buf.readUInt32LE(0) === 0x55aa1234);
  check('VPK version 2', buf.readUInt32LE(4) === 2);

  const treeSize = buf.readUInt32LE(8);
  const dataSize = buf.readUInt32LE(12);
  const otherMd5 = buf.readUInt32LE(20);

  check('otherMD5SectionSize is 48', otherMd5 === 48, `got ${otherMd5}`);
  check(
    'file length matches header + trailing hashes',
    buf.length === 28 + treeSize + dataSize + otherMd5,
    `${buf.length} vs ${28 + treeSize + dataSize + otherMd5}`
  );
}

// --- revert must leave the game byte-clean ---------------------------------
const reverted = exporter.revert(gamePath);
check('revert removed the VPK', reverted.removed);
check('revert unmounted gameinfo', !gameinfo.isActive(gamePath, '0test'));
check('override dir is gone', !fs.existsSync(path.join(gamePath, '0test')));

const giPath = path.join(gamePath, 'dota', 'gameinfo.gi');
const giBytes = fs.statSync(giPath).size;
check('gameinfo.gi back to 8382 bytes', giBytes === 8382, `got ${giBytes}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
