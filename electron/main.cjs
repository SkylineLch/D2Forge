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

    // `--ui-check` drives the renderer through a scripted smoke test and dumps
    // screenshots + a DOM report, so UI regressions can be caught without a
    // human clicking around. Never runs unless the flag is passed.
    if (process.argv.includes('--ui-check')) {
      runUiCheck(mainWindow).catch((err) => {
        console.error('[ui-check] failed:', err);
        app.exit(1);
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

/* ------------------------------- ui check -------------------------------- */

/**
 * Scripted UI smoke test, enabled only with `--ui-check`.
 *
 * It exists because the interesting behaviour here is stateful and visual:
 * whether the list keeps its scroll position, whether accordions actually
 * render, whether talents show a translated name. A plain unit test cannot see
 * any of that, and driving the real window by hand is slow and unrepeatable.
 *
 * Writes `<project>/ui-check/*.png` plus a text report to stdout.
 */
async function runUiCheck(win) {
  const fs = require('fs');
  // Inside an asar archive `getAppPath()` is a virtual path that can't be
  // written to, so a packaged build falls back to userData.
  const outDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'ui-check')
    : path.join(app.getAppPath(), 'ui-check');
  fs.mkdirSync(outDir, { recursive: true });

  const wc = win.webContents;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => wc.executeJavaScript(code, true);

  const shot = async (name) => {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
    console.log(`[ui-check] shot: ${name}.png`);
  };

  // Give the renderer time to run its initial IPC round-trips.
  await wait(2500);

  const report = {};

  // 1. Baseline layout.
  report.initial = await js(`(() => ({
    tabs: [...document.querySelectorAll('.toolbar-tabs button')].map(b => b.textContent.trim()),
    toolbarButtons: [...document.querySelectorAll('.toolbar-right button')].map(b => b.textContent.trim()),
    heroCount: document.querySelectorAll('.item-card').length,
    hasSearch: !!document.querySelector('.search-box input'),
    hasModPill: !!document.querySelector('.mod-pill'),
    modPill: document.querySelector('.mod-pill')?.textContent.trim() || null,
  }))()`);
  await shot('01-initial');

  // 2. Search: Chinese, English, raw id.
  report.search = await js(`(() => {
    const input = document.querySelector('.search-box input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const out = {};
    for (const [name, q] of [['zh','幻影'],['en','anti'],['raw','npc_dota_hero_axe']]) {
      setter.call(input, q);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      out[name] = { query: q, hits: document.querySelectorAll('.item-card').length };
    }
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return out;
  })()`);
  await wait(300);
  await shot('02-search');

  // 3. Pick a hero, then open its abilities.
  report.selectHero = await js(`(async () => {
    const cards = [...document.querySelectorAll('.item-card')];
    const target = cards.find(c => /敌法师|Anti/.test(c.textContent)) || cards[0];
    const name = target.textContent.trim();
    target.click();
    await new Promise(r => setTimeout(r, 1400));
    const accordions = [...document.querySelectorAll('.accordion.level-1 > .accordion-head')]
      .map(h => h.textContent.trim());
    return { picked: name, accordions, itemCards: document.querySelectorAll('.item-card').length };
  })()`);
  await wait(600);
  await shot('03-hero-open');

  // 4. Scroll the list far down, click, and confirm the position survived.
  report.scrollKeep = await js(`(async () => {
    const box = document.querySelector('.sidebar-content');
    box.scrollTop = 1200;
    const before = box.scrollTop;
    const cards = [...document.querySelectorAll('.item-card')];
    cards[Math.min(30, cards.length - 1)].click();
    await new Promise(r => setTimeout(r, 1400));
    const box2 = document.querySelector('.sidebar-content');
    return { before, after: box2.scrollTop, survived: Math.abs(box2.scrollTop - before) < 8 };
  })()`);
  await shot('04-scroll-kept');

  // 5. Expand abilities -> first ability -> count fields; then collapse.
  report.accordion = await js(`(async () => {
    const head = [...document.querySelectorAll('.accordion.level-1 > .accordion-head')]
      .find(h => /技能|Abilities/.test(h.textContent));
    if (head && !head.parentElement.classList.contains('open')) { head.click(); await new Promise(r=>setTimeout(r,400)); }
    const inner = [...document.querySelectorAll('.accordion.level-2 > .accordion-head')];
    const firstBefore = inner[0]?.parentElement.classList.contains('open');
    inner[0]?.click();
    await new Promise(r => setTimeout(r, 500));
    const body = inner[0]?.parentElement.querySelector('.accordion-body');
    const inputs = body ? body.querySelectorAll('input').length : 0;
    return {
      abilityCount: inner.length,
      firstWasOpen: firstBefore,
      firstNowOpen: inner[0]?.parentElement.classList.contains('open'),
      fieldsWhenOpen: inputs,
    };
  })()`);
  await shot('05-ability-expanded');

  // 6. Talents: header present, cards rendered, names translated.
  report.talents = await js(`(async () => {
    const head = [...document.querySelectorAll('.accordion.level-1 > .accordion-head')]
      .find(h => /天赋|Talents/.test(h.textContent));
    if (head && !head.parentElement.classList.contains('open')) { head.click(); await new Promise(r=>setTimeout(r,400)); }
    const cards = [...document.querySelectorAll('.talent-card')];
    return {
      count: cards.length,
      sample: cards.slice(0, 6).map(c => ({
        tier: c.querySelector('.talent-tier')?.textContent.trim() || null,
        name: c.querySelector('.talent-name')?.textContent.trim() || null,
        value: c.querySelector('input')?.value ?? null,
        host: c.querySelector('.talent-host')?.textContent.trim() || null,
      })),
      withInput: cards.filter(c => c.querySelector('input')).length,
      rawTemplateLeft: cards.filter(c => /\\{s:/.test(c.textContent)).length,
    };
  })()`);
  await wait(400);
  await shot('06-talents');

  // 7. Edit a talent value, confirm it marks as modified and offers revert.
  report.editTalent = await js(`(async () => {
    const card = document.querySelector('.talent-card');
    const input = card?.querySelector('input');
    if (!input) return { skipped: true };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '+99');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    const card2 = document.querySelector('.talent-card');
    return {
      modified: card2.classList.contains('modified'),
      original: card2.querySelector('.original-value')?.textContent.trim() || null,
      hasRevert: !!card2.querySelector('.revert-one'),
      badge: document.querySelector('.item-card.selected .modified-badge')?.textContent.trim() || null,
    };
  })()`);
  await shot('07-talent-edited');

  // 8. Statistics section comes last.
  report.order = await js(`(() => [...document.querySelectorAll('.accordion.level-1 > .accordion-head')]
    .map(h => h.textContent.replace(/[▾▸]/g,'').replace(/\\s+/g,' ').trim()))()`);

  // 8b. Bulk actions must actually run, not just exist. `confirm()` is stubbed
  //     so the scripted run is non-interactive.
  //
  //     Order matters: it mirrors a real session, and each step consumes the
  //     state the previous one produced.
  //       edit item -> export (override goes live) -> re-index (reconcile keeps
  //       the edit) -> reset (edits cleared) -> revert (override unmounted)
  //     The game ends vanilla, which is also where a first-time user starts.
  report.bulk = await js(`(async () => {
    const out = {};
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const btn = (re) => [...document.querySelectorAll('.toolbar-right button')]
      .find(b => re.test(b.textContent));
    const bannerText = () => document.querySelector('.banner > span')?.textContent.trim() || null;
    const closeBanner = () => document.querySelector('.banner-close')?.click();
    const pill = () => document.querySelector('.mod-pill')?.textContent.trim() || null;
    const badgeTotal = () => document.querySelectorAll('.item-card .modified-badge').length;
    window.confirm = () => true;

    // ---- 1. make an edit on the items tab so there is something to export ----
    [...document.querySelectorAll('.toolbar-tabs button')].find(b => /物品|Items/.test(b.textContent)).click();
    await wait(900);
    document.querySelector('.item-card')?.click();
    await wait(1200);
    // open whatever collapsed groups exist, then grab the first numeric input
    for (const h of [...document.querySelectorAll('.accordion.level-1:not(.open) > .accordion-head')]) {
      h.click(); await wait(200);
    }
    const numInput = [...document.querySelectorAll('.field-group input')]
      .find(i => /^-?[\\d.]+$/.test(i.value));
    if (!numInput) { out.fatal = 'no numeric field to edit'; return out; }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const originalVal = numInput.value;
    const probeVal = String(Number(originalVal) + 7);
    setter.call(numInput, probeVal);
    numInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(600);
    out.edit = { originalVal, newValue: probeVal, badgeTotal: badgeTotal() };

    // ---- 2. 导出 — must build the override VPK and switch the pill on ----
    btn(/导出|Export/).click();
    await wait(2600);
    out.export = { banner: bannerText(), modPill: pill() };
    closeBanner();

    // ---- 3. 重新解包 — reconcile must keep the edit we just made ----
    btn(/重新解包|Re-index/).click();
    await wait(4000);
    out.reload = {
      banner: bannerText(),
      modPill: pill(),
      changeCount: (document.querySelector('.toolbar-right button')?.textContent.match(/(\\d+)/) || [])[1] || null,
      heroCountAfter: null, // filled below on the heroes tab
    };
    closeBanner();

    // ---- 4. 一键还原 — clears the edit set, badge total drops to 0 ----
    out.reset = { wasEnabled: !btn(/一键还原|Reset/).disabled };
    btn(/一键还原|Reset/).click();
    await wait(1400);
    out.reset.banner = bannerText();
    out.reset.badgeTotalAfter = badgeTotal();
    out.reset.exportLabel = btn(/导出|Export/).textContent.trim();
    closeBanner();

    // ---- 5. 恢复原版 — unmounts 0test, pill must read vanilla ----
    btn(/恢复原版|Restore/).click();
    await wait(2200);
    out.revert = { banner: bannerText(), modPill: pill() };
    closeBanner();

    return out;
  })()`);
  await wait(400);
  await shot('09-after-revert');

  // 9. Items tab.
  report.items = await js(`(async () => {
    const btn = [...document.querySelectorAll('.toolbar-tabs button')].find(b => /物品|Items/.test(b.textContent));
    btn.click();
    await new Promise(r => setTimeout(r, 900));
    const cards = [...document.querySelectorAll('.item-card')];
    cards[0]?.click();
    await new Promise(r => setTimeout(r, 1300));
    return {
      listCount: cards.length,
      accordions: [...document.querySelectorAll('.accordion.level-1 > .accordion-head')].map(h => h.textContent.trim()),
      fields: document.querySelectorAll('.field-group input').length,
    };
  })()`);
  await wait(500);
  await shot('08-items');

  /* ------------------------------ assertions ------------------------------ */
  // Raw numbers are easy to skim past, and a run that "produced output" is not
  // the same as a run that passed. Score every requirement explicitly.
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });

  check('列表不因选中而回滚',
    report.scrollKeep?.survived, `before=${report.scrollKeep?.before} after=${report.scrollKeep?.after}`);

  check('无空白技能标签页',
    Array.isArray(report.initial?.tabs) && report.initial.tabs.length === 2
      && !report.initial.tabs.some((t) => /技能|Abilities/.test(t)),
    (report.initial?.tabs || []).join(' / '));

  check('中文搜索命中',
    report.search?.zh?.hits > 0, `"${report.search?.zh?.query}" -> ${report.search?.zh?.hits}`);
  check('英文搜索命中',
    report.search?.en?.hits > 0, `"${report.search?.en?.query}" -> ${report.search?.en?.hits}`);
  check('原始 ID 搜索命中',
    report.search?.raw?.hits > 0, `"${report.search?.raw?.query}" -> ${report.search?.raw?.hits}`);

  check('技能为第一区块',
    /技能|Abilities/.test(report.order?.[0] || ''), report.order?.[0]);
  check('英雄天赋为第二区块',
    /天赋|Talents/.test(report.order?.[1] || ''), report.order?.[1]);
  check('属性区在天赋之后',
    (report.order || []).findIndex((h) => /属性|Attributes/.test(h)) > 1,
    (report.order || []).join(' -> '));

  check('折叠可展开',
    report.accordion?.firstNowOpen === true && report.accordion?.fieldsWhenOpen > 0,
    `fields=${report.accordion?.fieldsWhenOpen}`);

  check('天赋已渲染',
    report.talents?.count > 0, `count=${report.talents?.count}`);
  check('天赋全部可编辑',
    report.talents?.withInput === report.talents?.count, `${report.talents?.withInput}/${report.talents?.count}`);
  check('天赋无残留模板',
    report.talents?.rawTemplateLeft === 0, `left=${report.talents?.rawTemplateLeft}`);
  check('天赋等级正确',
    (report.talents?.sample || []).every((t) => /^Lv(10|15|20|25)$/.test(t.tier || '')),
    (report.talents?.sample || []).map((t) => t.tier).join(','));

  check('改动标记为 modified',
    report.editTalent?.modified === true, `badge=${report.editTalent?.badge}`);
  check('显示原始值并可单独还原',
    !!report.editTalent?.original && report.editTalent?.hasRevert === true,
    report.editTalent?.original);

  check('导出后覆盖启用',
    /启用|active/i.test(report.bulk?.export?.modPill || ''),
    `${report.bulk?.export?.banner} | ${report.bulk?.export?.modPill}`);
  check('重新解包完成',
    /重新解包完成|re-?index/i.test(report.bulk?.reload?.banner || ''),
    report.bulk?.reload?.banner);
  check('重新解包保留改动',
    !/保留 0 项|kept 0/i.test(report.bulk?.reload?.banner || ''),
    report.bulk?.reload?.banner);
  check('一键还原清空修改',
    report.bulk?.reset?.badgeTotalAfter === 0 && /清除|cleared/i.test(report.bulk?.reset?.banner || ''),
    `${report.bulk?.reset?.banner} badge=${report.bulk?.reset?.badgeTotalAfter}`);
  check('恢复原版后状态为原版',
    /原版|vanilla/i.test(report.bulk?.revert?.modPill || ''),
    `${report.bulk?.revert?.banner} | ${report.bulk?.revert?.modPill}`);

  report.checks = checks;
  report.failed = checks.filter((c) => !c.pass).map((c) => c.name);
  report.passed = checks.length - report.failed.length;
  report.total = checks.length;

  console.log('\n[ui-check] REPORT');
  console.log(JSON.stringify(report, null, 2));

  console.log('\n[ui-check] ASSERTIONS');
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}   (${c.detail ?? ''})`);
  }
  console.log(`\n[ui-check] ${report.passed}/${report.total} passed`);

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`[ui-check] done -> ${outDir}`);

  app.exit(report.failed.length ? 1 : 0);
}

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
    const abilityView = abilities.map((a) => buildAbilityView(a, heroId));

    const talents = dataStore.loadHeroTalents(heroId) || [];
    const talentView = talents.map((t) => buildTalentView(t, heroId));

    return {
      ok: true,
      hero: { id: hero.id, name_zh: hero.name_zh, name_en: hero.name_en },
      groups,
      abilities: abilityView,
      talents: talentView,
    };
  } catch (err) {
    console.error('[main] get-hero failed:', err);
    return { ok: false, error: err.message };
  }
});

/**
 * Talent view for the renderer.
 *
 * Unlike an ability, a talent has exactly one editable number, and where that
 * number lives differs per talent:
 *
 *   hero-ability host -> a modifier line inside one of the hero's abilities, so
 *                        the change key names both the ability and the value
 *   global host       -> the talent's own AbilityValues.value in npc_abilities
 *
 * `field` is the ready-made change path, so the renderer never has to know
 * which shape applies.
 */
function buildTalentView(talent, heroId) {
  let field = null;
  if (talent.host?.kind === 'hero-ability') {
    field = `talents.${talent.id}.bonus.${talent.host.abilityId}.${talent.host.field}`;
  } else if (talent.host?.kind === 'global') {
    field = `talents.${talent.id}.value.value`;
  }

  return {
    id: talent.id,
    slot: talent.slot,
    tier: talent.tier,
    scope: 'talents',
    name_zh: talent.name_zh,
    name_en: talent.name_en,
    bonus: talent.bonus,
    field,
    editable: talent.editable && field !== null,
    host: talent.host
      ? {
          kind: talent.host.kind,
          zh: talent.host.kind === 'hero-ability'
            ? `来自技能：${talent.host.abilityName_zh} · ${talent.host.field}`
            : '来自全局技能表',
          en: talent.host.kind === 'hero-ability'
            ? `From ${talent.host.abilityName_en} · ${talent.host.field}`
            : 'From the global ability table',
          extraCount: talent.host.extraCount || 0,
        }
      : null,
  };
}

/**
 * Turn one ability record into the shape the renderer expects.
 * `scope` decides the change-key prefix: hero abilities are `abilities`,
 * talents live under `talents` so their edits do not collide.
 */
function buildAbilityView(ability, heroId, scope = 'abilities') {
  const data = { ...ability.data, __id: ability.id };
  const scalars = labels.ABILITY_SCALARS
    .filter((f) => data[f.key] !== undefined)
    .map((f) => ({ ...f, value: data[f.key] }));

  return {
    id: ability.id,
    scope,
    name_zh: ability.name_zh,
    name_en: ability.name_en,
    scalars,
    values: labels.abilityValueRows(data, (lang, token) => dataStore.lookup(lang, token)),
  };
}

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
  store.save(currentGamePath);
  return { ok: true, count: 0 };
});

ipcMain.handle('remove-change', async (_, key) => {
  const store = ensureStore();
  store.remove(key);
  store.save(currentGamePath);
  return { ok: true, count: store.count() };
});

/**
 * Re-read the game archives after a patch, then reconcile saved edits.
 *
 * This is the "re-unpack after an update" flow: the VPK is indexed fresh, and
 * every stored edit is compared against what the patched files now say. Edits
 * whose field still holds the original value survive; edits whose field the
 * patch moved are dropped and reported so the user can re-apply deliberately.
 */
ipcMain.handle('reload-game', async () => {
  try {
    if (!currentGamePath) return { ok: false, error: '尚未选择游戏目录' };

    const info = dataStore.init(currentGamePath); // fresh index, drops caches
    const store = ensureStore();
    const before = store.all();

    const result = exporter.reconcile(currentGamePath, before, (rel) =>
      dataStore.readFile(rel)
    );

    // Persist the surviving set.
    store.clear();
    for (const ch of result.kept) store.set(ch);
    store.save(currentGamePath);

    return {
      ok: true,
      entries: info.entries,
      version: info.version,
      kept: result.kept.length,
      dropped: result.dropped,
      total: before.length,
    };
  } catch (err) {
    console.error('[main] reload-game failed:', err);
    return { ok: false, error: err.message };
  }
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
    if (!currentGamePath) return { ok: true, isActive: false, vpkExists: false };
    const s = exporter.status(currentGamePath);
    // `isActive` is the name the renderer keys off; keep `active` too so older
    // callers keep working.
    return { ok: true, isActive: s.active, active: s.active, vpkExists: s.vpkExists };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
