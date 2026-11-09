import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './App.css';

const { ipcRenderer } = window.require('electron');

/* ------------------------------- helpers ------------------------------- */

/** Case-insensitive substring match across every name a row carries. */
function matchesQuery(row, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [row.name_zh, row.name_en, row.id].some(
    (v) => typeof v === 'string' && v.toLowerCase().includes(needle)
  );
}

/** Count changes under one category/id prefix. */
function countChanges(changes, prefix) {
  let n = 0;
  for (const key of changes.keys()) if (key.startsWith(prefix)) n++;
  return n;
}

function App() {
  const [lang, setLang] = useState('zh');
  const [gamePath, setGamePath] = useState(null);
  const [category, setCategory] = useState('heroes');

  const [selectedId, setSelectedId] = useState(null);
  const [selectedData, setSelectedData] = useState(null);
  // Separate flags: `bootLoading` gates the whole app (path pick), while
  // `detailLoading` only affects the editor pane. Conflating them used to blow
  // away the sidebar on every click, which reset its scroll position.
  const [bootLoading, setBootLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const [changes, setChanges] = useState(new Map());
  const [heroList, setHeroList] = useState([]);
  const [itemList, setItemList] = useState([]);

  const [query, setQuery] = useState('');
  const [modState, setModState] = useState(null); // { isActive, ... }
  const [busy, setBusy] = useState(null); // string | null, drives the overlay
  const [banner, setBanner] = useState(null); // { kind, text }

  // Which accordions are open. Keys look like `abilities` / `talents` /
  // `abilities:<id>`. Abilities start closed so a hero with 20 abilities is
  // still scannable.
  const [open, setOpen] = useState(() => new Set(['abilities', 'talents']));

  const t = useCallback((zh, en) => (lang === 'zh' ? zh : en), [lang]);

  /* ------------------------------ boot up ------------------------------ */

  useEffect(() => {
    ipcRenderer.invoke('get-config').then((res) => {
      if (res.gamePath) {
        setGamePath(res.gamePath);
        loadGame(res.gamePath);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshChanges = async () => {
    const res = await ipcRenderer.invoke('get-changes');
    if (res.ok) {
      const map = new Map();
      for (const c of res.changes) map.set(`${c.category}/${c.id}/${c.field}`, c);
      setChanges(map);
    }
  };

  // `loadGame` runs right after `setGamePath`, so the state variable is still
  // stale inside this tick — pass the path explicitly instead of reading it.
  const refreshModState = async (pathOverride) => {
    const p = pathOverride ?? gamePath;
    if (!p) return;
    const res = await ipcRenderer.invoke('check-mod');
    if (res.ok) setModState(res);
  };

  const loadGame = async (path) => {
    setBootLoading(true);
    try {
      const openResult = await ipcRenderer.invoke('open-game', path);
      if (!openResult.ok) {
        alert(t('打开游戏失败：', 'Failed to open game: ') + openResult.error);
        return;
      }

      const [heroesRes, itemsRes] = await Promise.all([
        ipcRenderer.invoke('list-heroes'),
        ipcRenderer.invoke('list-items'),
      ]);

      if (heroesRes.ok) setHeroList(heroesRes.heroes);
      if (itemsRes.ok) setItemList(itemsRes.items);
      await refreshChanges();
      await refreshModState(path);
    } catch (err) {
      alert(t('加载失败：', 'Load failed: ') + err.message);
    } finally {
      setBootLoading(false);
    }
  };

  /* ---------------------------- selection ------------------------------ */

  const handleSelectItem = async (id) => {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const res = category === 'heroes'
        ? await ipcRenderer.invoke('get-hero', id)
        : await ipcRenderer.invoke('get-item', id);
      if (res.ok) setSelectedData(res);
      else setSelectedData(null);
    } catch (err) {
      alert(t('加载失败：', 'Load failed: ') + err.message);
      setSelectedData(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const switchCategory = (next) => {
    if (next === category) return;
    setCategory(next);
    setSelectedId(null);
    setSelectedData(null);
    setQuery('');
    // Heroes default to abilities+talents open, items only have two sections
    // so both start expanded.
    setOpen(next === 'heroes' ? new Set(['abilities', 'talents']) : new Set(['item-stats', 'item-values']));
  };

  /* ------------------------------ editing ------------------------------ */

  /** Look the pristine value up in the currently loaded entity. */
  const findOriginalValue = (field) => {
    const data = selectedData;
    if (!data) return null;

    for (const group of data.groups || []) {
      const hit = group.fields.find((f) => f.key === field);
      if (hit) return hit.value;
    }

    for (const sc of data.item?.scalars || []) {
      if (sc.key === field) return sc.value;
    }

    const path = field.split('.');

    if (path[0] === 'talents' && path.length >= 2) {
      const talent = (data.talents || []).find((x) => x.id === path[1]);
      return talent ? talent.bonus : null;
    }

    if (path[0] === 'abilities' && path.length >= 3) {
      const ability = (data.abilities || []).find((a) => a.id === path[1]);
      if (ability) {
        if (path[2] === 'values' && path.length === 4) {
          const row = (ability.values || []).find((r) => r.key === path[3]);
          if (row) return row.value;
        } else {
          const sc = (ability.scalars || []).find((s) => s.key === path[2]);
          if (sc) return sc.value;
        }
      }
    }

    if (path[0] === 'values' && path.length === 2) {
      const row = (data.item?.values || []).find((r) => r.key === path[1]);
      if (row) return row.value;
    }

    return null;
  };

  const handleFieldChange = (field, newValue) => {
    const key = `${category}/${selectedId}/${field}`;
    const change = changes.get(key);
    // `oldValue` must be the value as shipped by the game, not the last edit —
    // otherwise the "original" hint drifts along with every keystroke.
    const oldValue = change ? change.oldValue : findOriginalValue(field);

    const next = {
      category, id: selectedId, field, oldValue, newValue, timestamp: Date.now(),
    };
    ipcRenderer.invoke('set-change', next);
    setChanges(new Map(changes).set(key, next));
  };

  /** Drop one field back to the game's value. */
  const handleRevertField = async (field) => {
    const key = `${category}/${selectedId}/${field}`;
    if (!changes.has(key)) return;
    await ipcRenderer.invoke('remove-change', key);
    const copy = new Map(changes);
    copy.delete(key);
    setChanges(copy);
  };

  /* --------------------------- bulk actions ---------------------------- */

  /** 一键还原 — throw away every saved edit. */
  const handleResetChanges = async () => {
    const n = changes.size;
    if (!n) return;
    if (!confirm(t(
      `将清除全部 ${n} 项数值修改（不会影响游戏文件）。继续？`,
      `Discard all ${n} saved edits (game files are untouched). Continue?`
    ))) return;

    setBusy(t('正在还原…', 'Reverting…'));
    try {
      const res = await ipcRenderer.invoke('reset-changes');
      if (res.ok) {
        setChanges(new Map());
        setBanner({ kind: 'ok', text: t('已清除全部修改', 'All edits cleared') });
      }
    } finally {
      setBusy(null);
    }
  };

  /** 一键恢复原版 — unmount the override VPK and restore gameinfo.gi. */
  const handleRevertMod = async () => {
    if (!gamePath) return;
    if (!confirm(t(
      '将卸载 0test 覆盖并还原 gameinfo.gi，游戏回到纯原版状态。\n保存的数值修改会保留，可随时再次导出。继续？',
      'This unmounts the 0test override and restores gameinfo.gi, returning the game to vanilla.\nYour saved edits stay in the editor and can be re-exported. Continue?'
    ))) return;

    setBusy(t('正在恢复原版…', 'Restoring vanilla…'));
    try {
      const res = await ipcRenderer.invoke('revert-mod');
      if (res.ok) {
        setBanner({ kind: 'ok', text: t('已恢复原版，重启 Dota2 生效', 'Vanilla restored. Restart Dota 2.') });
        await refreshModState();
      } else {
        setBanner({ kind: 'err', text: t('恢复失败：', 'Revert failed: ') + res.error });
      }
    } finally {
      setBusy(null);
    }
  };

  /** 重新导出 — rebuild the override VPK from the saved edits. */
  const handleExport = async () => {
    if (!changes.size) return;
    setBusy(t('正在导出…', 'Exporting…'));
    try {
      const res = await ipcRenderer.invoke('export-mod');
      if (res.ok) {
        setBanner({ kind: 'ok', text: t('已导出，重启 Dota2 生效', 'Exported. Restart Dota 2.') });
        await refreshModState();
      } else {
        setBanner({ kind: 'err', text: t('导出失败：', 'Export failed: ') + res.error });
      }
    } finally {
      setBusy(null);
    }
  };

  /**
   * 游戏更新后重新解包 — re-index the VPK and reconcile saved edits against
   * the patched files. Edits whose field still holds the original value
   * survive; the rest are dropped with a reason.
   */
  const handleReloadGame = async () => {
    if (!gamePath) return;
    if (!confirm(t(
      '将重新读取游戏 VPK，并核对已保存的数值修改。\n游戏版本变化过的字段会被丢弃（未变化的保留）。继续？',
      'This re-reads the game VPK and reconciles your saved edits.\nFields changed by the patch are dropped; unchanged ones survive. Continue?'
    ))) return;

    setBusy(t('正在重新解包…', 'Re-indexing…'));
    try {
      const res = await ipcRenderer.invoke('reload-game');
      if (!res.ok) {
        setBanner({ kind: 'err', text: t('重新解包失败：', 'Re-index failed: ') + res.error });
        return;
      }
      await refreshChanges();
      await refreshModState();

      // `kept` is a count, `dropped` is the list of discarded edits.
      const kept = res.kept ?? 0;
      const droppedList = Array.isArray(res.dropped) ? res.dropped : [];
      setBanner({
        kind: droppedList.length ? 'warn' : 'ok',
        text: t(
          `重新解包完成：${res.entries?.toLocaleString() ?? '?'} 个条目，保留 ${kept} 项修改${droppedList.length ? `，丢弃 ${droppedList.length} 项` : ''}`,
          `Re-index done: ${res.entries?.toLocaleString() ?? '?'} entries, ${kept} edits kept${droppedList.length ? `, ${droppedList.length} dropped` : ''}`
        ),
        detail: droppedList,
      });

      // Reload the open hero so the panel shows post-patch values.
      if (selectedId) await handleSelectItem(selectedId);
    } catch (err) {
      setBanner({ kind: 'err', text: t('重新解包失败：', 'Re-index failed: ') + err.message });
    } finally {
      setBusy(null);
    }
  };

  /* ------------------------------ derived ------------------------------ */

  const list = category === 'heroes' ? heroList : itemList;

  const filtered = useMemo(
    () => list.filter((row) => matchesQuery(row, query.trim())),
    [list, query]
  );

  const toggleOpen = (key) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allOpen = open.has('abilities') && open.has('talents');

  /* ------------------------------ render ------------------------------- */

  const isHero = category === 'heroes';
  const title = selectedData?.hero?.name_zh != null
    ? (lang === 'zh' ? selectedData.hero.name_zh : selectedData.hero.name_en)
    : selectedData?.item
      ? (lang === 'zh' ? selectedData.item.name_zh : selectedData.item.name_en)
      : '';

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-left">
          <h1 className="app-title">D2Forge</h1>
          <div className="toolbar-tabs">
            <button className={category === 'heroes' ? 'active' : ''} onClick={() => switchCategory('heroes')}>
              {t('英雄', 'Heroes')}
            </button>
            <button className={category === 'items' ? 'active' : ''} onClick={() => switchCategory('items')}>
              {t('物品', 'Items')}
            </button>
          </div>
          {modState && (
            <span className={`mod-pill ${modState.isActive ? 'on' : 'off'}`}>
              {modState.isActive ? t('覆盖已启用', 'Override active') : t('原版状态', 'Vanilla')}
            </span>
          )}
        </div>

        <div className="toolbar-right">
          <button className="lang-switch" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>
            {lang === 'zh' ? 'EN' : '中'}
          </button>
          <button onClick={async () => {
            const path = await ipcRenderer.invoke('select-directory');
            if (path) { setGamePath(path); await ipcRenderer.invoke('set-config', path); await loadGame(path); }
          }}>
            {t('游戏路径', 'Game Path')}
          </button>

          <span className="toolbar-divider" />

          <button onClick={handleReloadGame} disabled={!gamePath || !!busy} title={t('游戏更新后重新解包', 'Re-index after a game update')}>
            {t('重新解包', 'Re-index')}
          </button>
          <button onClick={handleResetChanges} disabled={!changes.size || !!busy} title={t('清除所有数值修改', 'Discard all edits')}>
            {t('一键还原', 'Reset Edits')}
          </button>
          <button onClick={handleRevertMod} disabled={!gamePath || !!busy} title={t('卸载覆盖，回到原版', 'Unmount override, back to vanilla')}>
            {t('恢复原版', 'Restore Vanilla')}
          </button>
          <button className="primary" onClick={handleExport} disabled={!gamePath || !changes.size || !!busy}>
            {t('导出', 'Export')} {changes.size > 0 && `(${changes.size})`}
          </button>
        </div>
      </header>

      {banner && (
        <div className={`banner ${banner.kind}`}>
          <span>{banner.text}</span>
          {banner.detail?.length > 0 && (
            <details className="banner-detail">
              <summary>{t('查看详情', 'Details')}</summary>
              <ul>
                {banner.detail.slice(0, 50).map((d, i) => (
                  <li key={i}>
                    <code>{d.id}.{d.field}</code> — {d.reason}
                    {d.gameNow !== undefined && (
                      <span className="dim"> ({t('游戏现值', 'now')}: {String(d.gameNow).slice(0, 40)})</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button className="banner-close" onClick={() => setBanner(null)}>×</button>
        </div>
      )}

      <div className="main-container">
        <aside className="sidebar">
          <div className="sidebar-header">
            <span>{isHero ? t('英雄列表', 'Hero List') : t('物品列表', 'Item List')}</span>
            <span className="count">{filtered.length}/{list.length}</span>
          </div>

          <div className="search-box">
            <input
              type="search"
              value={query}
              placeholder={t('搜索中文 / 英文 / 原始 ID', 'Search zh / en / raw id')}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && <button className="search-clear" onClick={() => setQuery('')}>×</button>}
          </div>

          {/* The list stays mounted while the detail pane loads; only the pane shows a spinner. */}
          <div className="sidebar-content">
            {!gamePath ? (
              <div className="placeholder">{t('请先选择游戏路径', 'Please select a game path first')}</div>
            ) : bootLoading ? (
              <div className="placeholder">{t('加载中…', 'Loading…')}</div>
            ) : filtered.length === 0 ? (
              <div className="placeholder">{t('没有匹配项', 'No matches')}</div>
            ) : (
              <div className="item-list">
                {filtered.map((row) => {
                  const n = countChanges(changes, `${category}/${row.id}/`);
                  return (
                    <div
                      key={row.id}
                      className={`item-card ${selectedId === row.id ? 'selected' : ''}`}
                      onClick={() => handleSelectItem(row.id)}
                    >
                      <div className="item-name">{lang === 'zh' ? row.name_zh : row.name_en}</div>
                      {n > 0 && <span className="modified-badge">{n}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <main className="editor-panel">
          {!selectedId ? (
            <div className="welcome">
              <h2>{t('欢迎使用 D2Forge', 'Welcome to D2Forge')}</h2>
              <p>{t('从左侧选择项目开始编辑。技能与天赋排在属性之前，点击标题即可展开。',
                   'Pick something on the left. Abilities and talents come before stats — click a header to expand.')}</p>
            </div>
          ) : detailLoading && !selectedData ? (
            <div className="welcome"><p>{t('加载中…', 'Loading…')}</p></div>
          ) : !selectedData ? (
            <div className="welcome"><p>{t('加载失败', 'Load failed')}</p></div>
          ) : (
            <div className="editor-content">
              <div className="editor-header">
                <div>
                  <h2>{title}</h2>
                  <span className="subtitle">{selectedId}</span>
                </div>
                <div className="editor-actions">
                  {isHero && (
                    <button
                      onClick={() => setOpen(allOpen ? new Set() : new Set(['abilities', 'talents']))}
                    >
                      {allOpen ? t('全部收起', 'Collapse all') : t('全部展开', 'Expand all')}
                    </button>
                  )}
                </div>
              </div>

              {detailLoading && <div className="inline-loading">{t('刷新中…', 'Refreshing…')}</div>}

              {isHero ? (
                <>
                  {/* 1. Abilities */}
                  <Accordion
                    id="abilities"
                    title={t('技能', 'Abilities')}
                    subtitle={`${selectedData.abilities?.length || 0}`}
                    open={open.has('abilities')}
                    onToggle={() => toggleOpen('abilities')}
                    badge={countChanges(changes, `heroes/${selectedId}/abilities.`)}
                  >
                    <div className="ability-list">
                      {(selectedData.abilities || []).map((ability) => {
                        const key = `abilities:${ability.id}`;
                        const n = countChanges(changes, `heroes/${selectedId}/abilities.${ability.id}.`);
                        return (
                          <Accordion
                            key={ability.id}
                            id={key}
                            level={2}
                            title={lang === 'zh' ? ability.name_zh : ability.name_en}
                            subtitle={ability.id}
                            open={open.has(key)}
                            onToggle={() => toggleOpen(key)}
                            badge={n}
                          >
                            <FieldGroups
                              ability={ability}
                              prefix="abilities"
                              category="heroes"
                              selectedId={selectedId}
                              changes={changes}
                              lang={lang}
                              onEdit={handleFieldChange}
                              onRevert={handleRevertField}
                              t={t}
                            />
                          </Accordion>
                        );
                      })}
                      {!selectedData.abilities?.length && (
                        <div className="placeholder">{t('该英雄没有可编辑技能', 'No editable abilities')}</div>
                      )}
                    </div>
                  </Accordion>

                  {/* 2. Talents */}
                  <Accordion
                    id="talents"
                    title={t('英雄天赋', 'Talents')}
                    subtitle={`${selectedData.talents?.length || 0}`}
                    open={open.has('talents')}
                    onToggle={() => toggleOpen('talents')}
                    badge={countChanges(changes, `heroes/${selectedId}/talents.`)}
                  >
                    <div className="talent-grid">
                      {(selectedData.talents || []).map((talent) => {
                        const changeKey = talent.field
                          ? `heroes/${selectedId}/${talent.field}`
                          : null;
                        const change = changeKey ? changes.get(changeKey) : null;
                        const current = change ? change.newValue : talent.bonus;
                        return (
                          <div key={talent.id} className={`talent-card ${change ? 'modified' : ''}`}>
                            <div className="talent-head">
                              {talent.tier != null && (
                                <span className="talent-tier" title={t('天赋等级', 'Talent level')}>
                                  Lv{talent.tier}
                                </span>
                              )}
                              <span className="talent-name">
                                {lang === 'zh' ? talent.name_zh : talent.name_en}
                              </span>
                            </div>

                            {talent.editable ? (
                              <div className="field-group">
                                <label>{t('加成值', 'Bonus')}</label>
                                <input
                                  type="text"
                                  value={current ?? ''}
                                  onChange={(e) => handleFieldChange(talent.field, e.target.value)}
                                />
                                {change && (
                                  <span className="original-value">
                                    {t('原始值', 'Original')}: {change.oldValue}
                                    <button className="revert-one" onClick={() => handleRevertField(talent.field)}>
                                      {t('还原', 'Revert')}
                                    </button>
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="talent-readonly">{t('无可编辑数值', 'No editable value')}</div>
                            )}

                            {talent.host && (
                              <div className="talent-host" title={lang === 'zh' ? talent.host.zh : talent.host.en}>
                                {lang === 'zh' ? talent.host.zh : talent.host.en}
                                {talent.host.extraCount > 0 && ` (+${talent.host.extraCount})`}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {!selectedData.talents?.length && (
                        <div className="placeholder">{t('该英雄没有天赋数据', 'No talent data')}</div>
                      )}
                    </div>
                  </Accordion>

                  {/* 3. Hero stats, last */}
                  {(selectedData.groups || []).map((group) => {
                    const key = `stats:${group.id}`;
                    return (
                      <Accordion
                        key={group.id}
                        id={key}
                        title={lang === 'zh' ? group.zh : group.en}
                        open={open.has(key)}
                        onToggle={() => toggleOpen(key)}
                        badge={group.fields.reduce(
                          (acc, f) => acc + (changes.has(`heroes/${selectedId}/${f.key}`) ? 1 : 0), 0
                        )}
                      >
                        <div className="field-grid">
                          {group.fields.map((field) => (
                            <FieldInput
                              key={field.key}
                              field={field}
                              changeKey={`heroes/${selectedId}/${field.key}`}
                              changes={changes}
                              lang={lang}
                              onEdit={(v) => handleFieldChange(field.key, v)}
                              onRevert={() => handleRevertField(field.key)}
                              t={t}
                            />
                          ))}
                        </div>
                      </Accordion>
                    );
                  })}
                </>
              ) : (
                <>
                  <Accordion id="item-stats" title={t('物品属性', 'Item Stats')} open={open.has('item-stats')} onToggle={() => toggleOpen('item-stats')}>
                    <div className="field-grid">
                      {(selectedData.item?.scalars || []).map((field) => (
                        <FieldInput
                          key={field.key}
                          field={field}
                          changeKey={`items/${selectedId}/${field.key}`}
                          changes={changes}
                          lang={lang}
                          onEdit={(v) => handleFieldChange(field.key, v)}
                          onRevert={() => handleRevertField(field.key)}
                          t={t}
                        />
                      ))}
                    </div>
                  </Accordion>

                  <Accordion id="item-values" title={t('数值参数', 'Ability Values')} open={open.has('item-values')} onToggle={() => toggleOpen('item-values')}>
                    <div className="field-grid">
                      {(selectedData.item?.values || []).map((row) => {
                        const fieldPath = `values.${row.key}`;
                        const changeKey = `items/${selectedId}/${fieldPath}`;
                        const change = changes.get(changeKey);
                        return (
                          <div key={row.key} className={`field-group ${change ? 'modified' : ''}`}>
                            <label>
                              {lang === 'zh' ? row.label_zh : row.label_en}
                              {!row.localized && <span className="unlocalized-tip"> raw</span>}
                            </label>
                            <input
                              type="text"
                              value={change ? change.newValue : row.value}
                              onChange={(e) => handleFieldChange(fieldPath, e.target.value)}
                            />
                            {change && (
                              <span className="original-value">
                                {t('原始值', 'Original')}: {change.oldValue}
                                <button className="revert-one" onClick={() => handleRevertField(fieldPath)}>
                                  {t('还原', 'Revert')}
                                </button>
                              </span>
                            )}
                            {row.extras?.length > 0 && (
                              <div className="extras">
                                {row.extras.map((ex) => (
                                  <span key={ex.key} className="extra-badge">{ex.key}: {ex.value}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Accordion>
                </>
              )}
            </div>
          )}
        </main>
      </div>

      {busy && (
        <div className="overlay">
          <div className="overlay-box">{busy}</div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ components ----------------------------- */

function Accordion({ id, title, subtitle, badge, open, onToggle, level = 1, children }) {
  return (
    <section className={`accordion level-${level} ${open ? 'open' : ''}`} data-id={id}>
      <button className="accordion-head" onClick={onToggle} aria-expanded={open}>
        <span className="chevron">{open ? '▾' : '▸'}</span>
        <span className="accordion-title">{title}</span>
        {subtitle && <span className="accordion-sub">{subtitle}</span>}
        {badge > 0 && <span className="modified-badge">{badge}</span>}
        <span className="accordion-spacer" />
        <span className="accordion-hint">{open ? '收起' : '展开'}</span>
      </button>
      {open && <div className="accordion-body">{children}</div>}
    </section>
  );
}

function FieldInput({ field, changeKey, changes, lang, onEdit, onRevert, t }) {
  const change = changes.get(changeKey);
  return (
    <div className={`field-group ${change ? 'modified' : ''}`}>
      <label>{lang === 'zh' ? field.zh : field.en}</label>
      <input
        type={field.type || 'text'}
        value={change ? change.newValue : field.value}
        onChange={(e) => onEdit(e.target.value)}
        step={field.step}
      />
      {change && (
        <span className="original-value">
          {t('原始值', 'Original')}: {change.oldValue}
          <button className="revert-one" onClick={onRevert}>{t('还原', 'Revert')}</button>
        </span>
      )}
    </div>
  );
}

function FieldGroups({ ability, prefix, category, selectedId, changes, lang, onEdit, onRevert, t }) {
  return (
    <>
      {ability.scalars?.length > 0 && (
        <div className="field-grid">
          {ability.scalars.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              changeKey={`${category}/${selectedId}/${prefix}.${ability.id}.${field.key}`}
              changes={changes}
              lang={lang}
              onEdit={(v) => onEdit(`${prefix}.${ability.id}.${field.key}`, v)}
              onRevert={() => onRevert(`${prefix}.${ability.id}.${field.key}`)}
              t={t}
            />
          ))}
        </div>
      )}

      {ability.values?.length > 0 && (
        <div className="field-grid">
          {ability.values.map((row) => {
            const fieldPath = `${prefix}.${ability.id}.values.${row.key}`;
            const changeKey = `${category}/${selectedId}/${fieldPath}`;
            const change = changes.get(changeKey);
            return (
              <div key={row.key} className={`field-group ${change ? 'modified' : ''}`}>
                <label>
                  {lang === 'zh' ? row.label_zh : row.label_en}
                  {!row.localized && <span className="unlocalized-tip"> raw</span>}
                </label>
                <input
                  type="text"
                  value={change ? change.newValue : row.value}
                  onChange={(e) => onEdit(fieldPath, e.target.value)}
                />
                {change && (
                  <span className="original-value">
                    {t('原始值', 'Original')}: {change.oldValue}
                    <button className="revert-one" onClick={() => onRevert(fieldPath)}>
                      {t('还原', 'Revert')}
                    </button>
                  </span>
                )}
                {row.extras?.length > 0 && (
                  <div className="extras">
                    {row.extras.map((ex) => (
                      <span key={ex.key} className="extra-badge">{ex.key}: {ex.value}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default App;
