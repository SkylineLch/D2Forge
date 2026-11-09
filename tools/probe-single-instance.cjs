'use strict';
/**
 * Verifies the single-instance guard against the REAL app.
 *
 * Launch one instance, wait until it holds the lock, then launch a second and
 * assert that it exits on its own instead of opening a second window — and
 * that the first one survives the attempt.
 *
 * `D2FORGE_NO_DIALOG=1` swaps the modal for a log line so the harness isn't
 * stuck waiting for a click that will never come.
 *
 *   node tools/probe-single-instance.cjs
 */

const { spawn } = require('child_process');
const path = require('path');

const electronBin = require('electron'); // resolves to the binary path
const root = path.join(__dirname, '..');
const main = path.join(root, 'electron', 'main.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function launch(extraEnv = {}) {
  const child = spawn(electronBin, [main], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      D2FORGE_NO_DIALOG: '1',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.log = '';
  child.stdout.on('data', (d) => { child.log += d.toString(); });
  child.stderr.on('data', (d) => { child.log += d.toString(); });
  return child;
}

/** Resolve once the child exits, or after `ms` with the current code. */
function settled(child, ms) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timer = setTimeout(() => resolve(child.exitCode), ms);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

(async () => {
  let pass = 0;
  let fail = 0;
  const check = (label, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
  };

  console.log('launching instance #1...');
  const first = launch();
  await wait(7000);
  check('first instance holds the lock (still running)', first.exitCode === null,
    `exitCode=${first.exitCode}`);

  console.log('launching instance #2...');
  const second = launch();
  const code = await settled(second, 20000);

  check('second instance exits by itself', code !== null, `still running after 20s`);
  check('second instance exit code is 0', code === 0, `got ${code}`);
  check(
    'second instance reported the guard',
    /already running/i.test(second.log),
    second.log.slice(0, 300)
  );

  check('first instance survived the second launch', first.exitCode === null,
    `exitCode=${first.exitCode}`);

  for (const p of [first, second]) {
    if (p.exitCode === null) {
      try { p.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }
  await wait(500);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
