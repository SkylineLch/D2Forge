#!/usr/bin/env node
/**
 * Launcher for D2Forge.
 *
 * Why this file exists instead of a bare `electron .`:
 *
 * Some Windows setups export ELECTRON_RUN_AS_NODE=1 machine-wide (it is a common
 * leftover from VS Code / other Electron tooling). When that variable is present,
 * electron.exe boots as a plain Node.js process: `require('electron')` returns the
 * path to the binary instead of the API object, and main.cjs dies on
 *   TypeError: Cannot read properties of undefined (reading 'whenReady')
 * before any window is created.
 *
 * Blanking the variable (`ELECTRON_RUN_AS_NODE=`) does not help — Electron checks
 * for the presence of the variable, not its value. It has to be removed from the
 * child process environment entirely, which is what this script does.
 *
 * Usage:
 *   node scripts/launch.cjs          -> loads dist/index.html (production build)
 *   node scripts/launch.cjs --dev    -> loads http://localhost:5173 (Vite dev server)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const dev = process.argv.includes('--dev');

// Everything except our own flags goes to the electron process, so callers can
// pass e.g. `--ui-check` through.
const passthrough = process.argv.slice(2).filter((a) => a !== '--dev');

/* ------------------------------ resolve binary ----------------------------- */

let electronBinary;
try {
  // From a real Node process this is the path to the electron executable.
  electronBinary = require('electron');
} catch {
  console.error('[launch] electron is not installed. Run `npm install` first.');
  process.exit(1);
}

if (typeof electronBinary !== 'string') {
  // We are somehow running inside electron-as-node; fall back to the known layout.
  electronBinary = path.join(
    root,
    'node_modules',
    'electron',
    'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron'
  );
}

if (!fs.existsSync(electronBinary)) {
  console.error(`[launch] electron binary not found at:\n         ${electronBinary}`);
  console.error('         Run `npm install` to restore it.');
  process.exit(1);
}

/* -------------------------------- preflight -------------------------------- */

if (!dev) {
  const entry = path.join(root, 'dist', 'index.html');
  if (!fs.existsSync(entry)) {
    console.error('[launch] dist/index.html is missing.');
    console.error('         Run `npm run build` first, then `npm start`.');
    console.error('         Or run `npm run app` for a live-reload dev window.');
    process.exit(1);
  }
}

/* --------------------------------- spawn ----------------------------------- */

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

if (dev) {
  env.NODE_ENV = 'development';
} else {
  delete env.NODE_ENV;
}

const child = spawn(electronBinary, [root, ...passthrough], {
  stdio: 'inherit',
  env,
  windowsHide: false,
});

child.on('error', (err) => {
  console.error('[launch] failed to start electron:', err.message);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});

// Pass Ctrl+C through to the child instead of dying silently.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}
