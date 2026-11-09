/*
 * Self-heal for ELECTRON_RUN_AS_NODE.
 *
 * When that variable is set, Electron boots as a plain Node process and
 * `require('electron')` yields the binary path instead of the API, so everything
 * below dies on `app.whenReady()` being undefined. This block must therefore run
 * BEFORE the electron import: it relaunches the same binary with the variable
 * stripped from the child environment, then exits this doomed process.
 *
 * Deleting the variable is required — Electron tests for its presence, so an
 * empty string ("ELECTRON_RUN_AS_NODE=") does not disable the behaviour.
 */
if (process.env.ELECTRON_RUN_AS_NODE) {
  const { spawn } = require('child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(process.execPath, process.argv.slice(1), { stdio: 'inherit', env }).on(
    'close',
    (code) => process.exit(code ?? 0)
  );
  return;
}

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const dataStore = require('./data-store.cjs');
const labels = require('./labels.cjs');
const { createChangeStore } = require('./change-store.cjs');
const exporter = require('./exporter.cjs');

let mainWindow;
const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#1a1d23',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    show: false,
  });

  const startURL = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../dist/index.html')}`;

  mainWindow.loadURL(startURL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* --------------------------------- config -------------------------------- */

/**
 * Returns the writable data directory.
 * - Development (unpacked): `<project>/data`
 * - Production (asar): `app.getPath('userData')/data`
 */
function getDataDir() {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'data');
  }
  return path.join(app.getAppPath(), 'data');
}

const confPath = () => path.join(getDataDir(), 'conf.txt');

function readConfPath() {
  try {
    const content = fs.readFileSync(confPath(), 'utf8');
    const m = content.match(/"path"\s+"(.+?)"/);
    if (!m) return null;
    // Older builds stored whatever the user picked, which was often the Steam
    // root rather than the `game` folder. Normalise on read so an existing
    // config keeps working without the user re-picking.
    return resolveGameDir(m[1].replace(/\\\\/g, '\\'));
  } catch {
    return null;
  }
}

function writeConfPath(gamePath) {
  fs.mkdirSync(path.dirname(confPath()), { recursive: true });
  fs.writeFileSync(confPath(), `"path"\t"${gamePath.replace(/\\/g, '\\\\')}"\n`, 'utf8');
}

/* ---------------------------------- state -------------------------------- */

/** @type {ReturnType<typeof createChangeStore>|null} */
let changeStore = null;
let currentGamePath = null;

function ensureStore() {
  if (!changeStore) {
    changeStore = createChangeStore(getDataDir());
  }
  return changeStore;
}

/* ----------------------------------- IPC --------------------------------- */

/**
 * Normalise a user-picked folder into the real `game` directory.
 *
 * People naturally pick the Steam install root (`...\dota 2 beta`), but every
 * file we need lives one level down in `...\dota 2 beta\game`. Rather than make
 * them guess the right depth, accept any of these and resolve upward:
 *   .../dota 2 beta            -> .../dota 2 beta/game
 *   .../dota 2 beta/game       -> unchanged
 *   .../dota 2 beta/game/dota  -> .../dota 2 beta/game
 */
function resolveGameDir(input) {
  if (!input) return input;
  const candidates = [input, path.join(input, 'game'), path.resolve(input, '..')];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'dota', 'pak01_dir.vpk'))) return dir;
  }
  return input;
}

ipcMain.handle('get-config', async () => {
  return { gamePath: readConfPath() };
});

ipcMain.handle('set-config', async (_, gamePath) => {
  const resolved = resolveGameDir(gamePath);
  writeConfPath(resolved);
  currentGamePath = resolved;
  return resolved;
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Dota 2 game folder',
  });
  return result.canceled ? null : result.filePaths[0];
});

/** Open the game: index the VPK, prepare the change store. */
ipcMain.handle('open-game', async (_, rawPath) => {
  try {
    const gamePath = resolveGameDir(rawPath);
    const vpk = path.join(gamePath, 'dota', 'pak01_dir.vpk');

    if (!fs.existsSync(vpk)) {
      return {
        ok: false,
        error:
          `在此目录下找不到 dota/pak01_dir.vpk：\n${gamePath}\n\n` +
          '请选择 Dota 2 的 game 文件夹，例如：\n' +
          'Steam\\steamapps\\common\\dota 2 beta\\game',
      };
    }

    const info = dataStore.init(gamePath);
    currentGamePath = gamePath;
    writeConfPath(gamePath);

    const store = ensureStore();
    store.load(gamePath);

    return {
      ok: true,
      gamePath,
      entries: info.entries,
      version: info.version,
      changes: store.count(),
    };
  } catch (err) {
    console.error('[main] open-game failed:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('list-heroes', async () => {
  try {
    return { ok: true, heroes: dataStore.loadHeroes() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('list-items', async () => {
  try {
    return { ok: true, items: dataStore.loadItems() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-hero', async (_, heroId) => {
  try {
    const hero = dataStore.loadHero(heroId);
    if (!hero) return { ok: false, error: `Hero not found: ${heroId}` };

    const groups = labels.HERO_STAT_GROUPS.map((g) => ({
      id: g.id,
      zh: g.zh,
      en: g.en,
      fields: g.fields
        .filter((f) => hero.data[f.key] !== undefined)
        .map((f) => ({ ...f, value: hero.data[f.key] })),
    }));

    const abilities = dataStore.loadHeroAbilities(heroId) || [];
    const abilityView = abilities.map((a) => {
      const data = { ...a.data, __id: a.id };
      const scalars = labels.ABILITY_SCALARS
        .filter((f) => data[f.key] !== undefined)
        .map((f) => ({ ...f, value: data[f.key] }));
      return {
        id: a.id,
        name_zh: a.name_zh,
        name_en: a.name_en,
        scalars,
        values: labels.abilityValueRows(data, (lang, token) => dataStore.lookup(lang, token)),
      };
    });

    return {
      ok: true,
      hero: { id: hero.id, name_zh: hero.name_zh, name_en: hero.name_en },
      groups,
      abilities: abilityView,
    };
  } catch (err) {
    console.error('[main] get-hero failed:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-item', async (_, itemId) => {
  try {
    const items = dataStore.loadItems();
    const item = items.find((i) => i.id === itemId);
    if (!item) return { ok: false, error: `Item not found: ${itemId}` };

    const data = { ...item.data, __id: item.id };
    const scalars = labels.ITEM_SCALARS
      .filter((f) => data[f.key] !== undefined)
      .map((f) => ({ ...f, value: data[f.key] }));

    return {
      ok: true,
      item: {
        id: item.id,
        name_zh: item.name_zh,
        name_en: item.name_en,
        scalars,
        values: labels.abilityValueRows(data, (lang, token) => dataStore.lookup(lang, token)),
      },
    };
  } catch (err) {
    console.error('[main] get-item failed:', err);
    return { ok: false, error: err.message };
  }
});

/* ------------------------------ change store ----------------------------- */

ipcMain.handle('get-changes', async () => {
  const store = ensureStore();
  return { ok: true, changes: store.all() };
});

ipcMain.handle('set-change', async (_, change) => {
  const store = ensureStore();
  store.set(change);
  return { ok: true, count: store.count() };
});

ipcMain.handle('clear-change', async (_, key) => {
  const store = ensureStore();
  store.remove(key);
  return { ok: true, count: store.count() };
});

ipcMain.handle('reset-changes', async () => {
  const store = ensureStore();
  store.clear();
  return { ok: true, count: 0 };
});

/* --------------------------------- export -------------------------------- */

ipcMain.handle('export-mod', async () => {
  try {
    if (!currentGamePath) throw new Error('No game folder selected');
    const store = ensureStore();
    const result = await exporter.apply(currentGamePath, store.all());
    return { ok: true, ...result };
  } catch (err) {
    console.error('[main] export-mod failed:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('revert-mod', async () => {
  try {
    if (!currentGamePath) throw new Error('No game folder selected');
    const result = exporter.revert(currentGamePath);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('check-mod', async () => {
  try {
    if (!currentGamePath) return { ok: true, active: false };
    return { ok: true, ...exporter.status(currentGamePath) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
