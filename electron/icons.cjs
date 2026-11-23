'use strict';
// Icon extraction and resolution using Source2Viewer-CLI.
// Exports panorama/images/{heroes,items,spellicons} to userData/icons with
// --vpk_cache so subsequent launches and patch reloads stay incremental.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

let inFlight = null;

function findVrfCli() {
  const candidates = [
    path.join(__dirname, '..', 'tools', 'vrf-cli', 'Source2Viewer-CLI.exe'),
    process.resourcesPath
      ? path.join(process.resourcesPath, 'vrf-cli', 'Source2Viewer-CLI.exe')
      : null,
  ].filter(Boolean);

  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * Extract/update icons from gamePath/dota/pak01_dir.vpk into cacheDir.
 * Non-blocking and deduplicated; resolves with `{ ok, skipped?, error? }`.
 */
function ensureIcons(gamePath, cacheDir) {
  if (inFlight) return inFlight;

  const cli = findVrfCli();
  if (!cli) {
    return Promise.resolve({ ok: false, skipped: true, error: 'Source2Viewer-CLI.exe not found' });
  }

  const vpkPath = path.join(gamePath, 'dota', 'pak01_dir.vpk');
  if (!fs.existsSync(vpkPath)) {
    return Promise.resolve({ ok: false, skipped: true, error: 'pak01_dir.vpk not found' });
  }

  fs.mkdirSync(cacheDir, { recursive: true });

  inFlight = new Promise((resolve) => {
    const t0 = Date.now();
    const args = [
      '-i', vpkPath,
      '-o', cacheDir,
      '-d',
      '-f', 'panorama/images/items/,panorama/images/heroes/,panorama/images/spellicons/',
      '--vpk_cache',
      '--threads', '8',
    ];
    execFile(cli, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err) => {
      inFlight = null;
      if (err) {
        console.warn('[icons] extraction failed:', err.message);
        resolve({ ok: false, error: err.message });
        return;
      }
      console.log(`[icons] synced in ${Date.now() - t0}ms -> ${cacheDir}`);
      resolve({ ok: true });
    });
  });

  return inFlight;
}

function safeName(raw) {
  return String(raw || '').replace(/[^A-Za-z0-9_.\-/]/g, '');
}

/**
 * Resolve a cached PNG path for `(kind, name)`, or null if not yet extracted.
 * `kind` is one of: 'hero', 'hero-icon', 'item', 'ability'.
 */
function resolveIconPath(cacheDir, kind, rawName) {
  const name = safeName(rawName);
  if (!name || name.includes('..')) return null;

  const base = path.join(cacheDir, 'panorama', 'images');
  const candidates = [];

  if (kind === 'hero') {
    candidates.push(path.join(base, 'heroes', `${name}_png.png`));
    candidates.push(path.join(base, 'heroes', `${name}.png`));
  } else if (kind === 'hero-icon') {
    candidates.push(path.join(base, 'heroes', 'icons', `${name}_png.png`));
    candidates.push(path.join(base, 'heroes', `${name}_png.png`));
  } else if (kind === 'item') {
    const short = name.replace(/^item_/, '');
    candidates.push(path.join(base, 'items', `${short}_png.png`));
    candidates.push(path.join(base, 'items', `${short}.png`));
    candidates.push(path.join(base, 'items', `${name}_png.png`));
    if (name.startsWith('item_recipe_')) {
      candidates.push(path.join(base, 'items', 'recipe_png.png'));
    }
  } else if (kind === 'ability') {
    candidates.push(path.join(base, 'spellicons', `${name}_png.png`));
    candidates.push(path.join(base, 'spellicons', `${name}.png`));
  }

  return candidates.find((p) => fs.existsSync(p)) || null;
}

module.exports = { ensureIcons, resolveIconPath };
