'use strict';
// End-to-end check for electron/game-process.cjs (Dota 2 running detection).
//
// The whole point of this module is a name match against `dota2.exe`, so the
// only honest test is a real process with that image name. We stage one by
// copying node.exe to dota2.exe and keeping it alive with an empty timer, then
// assert detection flips on and back off.
//
// Gotcha that cost real time before: launching the fake via PowerShell
// `Start-Process -WindowStyle Hidden` makes it invisible to `tasklist` even
// though Get-Process still lists it (session/desktop isolation). Spawn it
// through child_process from this same process instead — that path is visible.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { isDotaRunning } = require('../electron/game-process.cjs');

const checks = [];
function check(name, pass, extra) {
  checks.push({ name, pass, extra });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const before = await isDotaRunning();
  check('baseline: no dota2.exe running', before.running === false, JSON.stringify(before));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2fake-'));
  const fake = path.join(dir, 'dota2.exe');
  // Use the real node binary so the copy is a working executable.
  fs.copyFileSync(process.execPath, fake);

  const stay = path.join(dir, 'stay.cjs');
  fs.writeFileSync(stay, 'setTimeout(function(){}, 120000);\n');

  const child = spawn(fake, [stay], { stdio: 'ignore', windowsHide: true });
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  // Give the loader a moment to actually create the process.
  let during = null;
  for (let i = 0; i < 20 && !exited; i += 1) {
    await sleep(250);
    during = await isDotaRunning();
    if (during.running) break;
  }

  check('spawned dota2.exe is detected', !!(during && during.running), JSON.stringify(during));
  check('reported pid matches the spawned child', !!(during && during.pids.includes(child.pid)), `expected ${child.pid}, got ${JSON.stringify(during && during.pids)}`);
  check('detection is by image name only', !!(during && during.pids.length === 1));

  child.kill();
  await sleep(600);

  let after = null;
  for (let i = 0; i < 12; i += 1) {
    after = await isDotaRunning();
    if (!after.running) break;
    await sleep(250);
  }
  check('detection clears once the process is gone', !!(after && after.running === false), JSON.stringify(after));

  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* temp dir, best effort */
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
