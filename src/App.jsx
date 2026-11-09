import React, { useState, useEffect } from 'react';
import './App.css';

const { ipcRenderer } = window.require('electron');

function App() {
  const [lang, setLang] = useState('zh');
  const [gamePath, setGamePath] = useState(null);
  const [category, setCategory] = useState('heroes');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedData, setSelectedData] = useState(null);
  const [changes, setChanges] = useState(new Map());
  const [heroList, setHeroList] = useState([]);
  const [itemList, setItemList] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    ipcRenderer.invoke('get-config').then(res => {
      if (res.gamePath) {
        setGamePath(res.gamePath);
        loadGame(res.gamePath);
      }
    });
  }, []);

  const loadGame = async (path) => {
    setLoading(true);
    try {
      const openResult = await ipcRenderer.invoke('open-game', path);
      if (!openResult.ok) {
        alert(t('打开游戏失败：', 'Failed to open game: ') + openResult.error);
        return;
      }

      const [heroesRes, itemsRes, changesRes] = await Promise.all([
        ipcRenderer.invoke('list-heroes'),
        ipcRenderer.invoke('list-items'),
        ipcRenderer.invoke('get-changes')
      ]);

      if (heroesRes.ok) setHeroList(heroesRes.heroes);
      if (itemsRes.ok) setItemList(itemsRes.items);
      if (changesRes.ok) {
        const map = new Map();
        for (const c of changesRes.changes) {
          map.set(`${c.category}/${c.id}/${c.field}`, c);
        }
        setChanges(map);
      }
    } catch (err) {
      alert(t('加载失败：', 'Load failed: ') + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectGamePath = async () => {
    const path = await ipcRenderer.invoke('select-directory');
    if (path) {
      setGamePath(path);
      await ipcRenderer.invoke('set-config', path);
      await loadGame(path);
    }
  };

  const handleSelectItem = async (id) => {
    setSelectedId(id);
    setSelectedData(null);
    setLoading(true);
    try {
      if (category === 'heroes') {
        const res = await ipcRenderer.invoke('get-hero', id);
        if (res.ok) setSelectedData(res);
      } else {
        const res = await ipcRenderer.invoke('get-item', id);
        if (res.ok) setSelectedData(res);
      }
    } catch (err) {
      alert(t('加载失败：', 'Load failed: ') + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (field, newValue) => {
    const key = `${category}/${selectedId}/${field}`;
    const change = changes.get(key);
    // `oldValue` must be the value as shipped by the game, not the last edit —
    // otherwise the "original" hint drifts along with every keystroke.
    const oldValue = change ? change.oldValue : findOriginalValue(field);

    const next = { ...change, category, id: selectedId, field, oldValue, newValue, timestamp: Date.now() };
    ipcRenderer.invoke('set-change', next);
    setChanges(new Map(changes).set(key, next));
  };

  /** Look the pristine value up in the currently loaded entity. */
  const findOriginalValue = (field) => {
    const data = selectedData;
    if (!data) return null;

    for (const group of data.groups || []) {
      const hit = group.fields.find((f) => f.key === field);
      if (hit) return hit.value;
    }

    for (const field of data.item?.scalars || []) {
      if (field.key === field) return field.value;
    }
    for (const field of data.item?.scalars || []) {
      if (field.key === field) return field.value;
    }

    const path = field.split('.');
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

  const isModified = (field) => {
    const key = `${category}/${selectedId}/${field}`;
    return changes.has(key);
  };

  const handleExport = async () => {
    if (changes.size === 0) return;
    setLoading(true);
    try {
      const res = await ipcRenderer.invoke('export-mod');
      if (res.ok) {
        alert(t('已导出到游戏目录，重启 Dota2 生效', 'Exported. Restart Dota 2 to apply.'));
      } else {
        alert(t('导出失败：', 'Export failed: ') + res.error);
      }
    } finally {
      setLoading(false);
    }
  };

  const t = (zh, en) => lang === 'zh' ? zh : en;

  return (
    <div className="app">
      {/* 顶部工具栏 */}
      <header className="toolbar">
        <div className="toolbar-left">
          <h1 className="app-title">D2Forge</h1>
          <div className="toolbar-tabs">
            <button 
              className={category === 'heroes' ? 'active' : ''}
              onClick={() => setCategory('heroes')}
            >
              {t('英雄', 'Heroes')}
            </button>
            <button 
              className={category === 'items' ? 'active' : ''}
              onClick={() => setCategory('items')}
            >
              {t('物品', 'Items')}
            </button>
            <button 
              className={category === 'abilities' ? 'active' : ''}
              onClick={() => setCategory('abilities')}
            >
              {t('技能', 'Abilities')}
            </button>
          </div>
        </div>
        <div className="toolbar-right">
          <button className="lang-switch" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>
            {lang === 'zh' ? 'EN' : '中'}
          </button>
          <button onClick={handleSelectGamePath}>
            {t('选择游戏路径', 'Select Game Path')}
          </button>
          <button onClick={handleExport} disabled={!gamePath || changes.size === 0}>
            {t('导出', 'Export')} {changes.size > 0 && `(${changes.size})`}
          </button>
        </div>
      </header>

      <div className="main-container">
        {/* 左侧列表 */}
        <aside className="sidebar">
          <div className="sidebar-header">
            {category === 'heroes' && t('英雄列表', 'Hero List')}
            {category === 'items' && t('物品列表', 'Item List')}
          </div>
          <div className="sidebar-content">
            {!gamePath ? (
              <div className="placeholder">
                {t('请先选择游戏路径', 'Please select game path first')}
              </div>
            ) : loading ? (
              <div className="placeholder">{t('加载中...', 'Loading...')}</div>
            ) : (
              <div className="item-list">
                {category === 'heroes' && heroList.map(hero => {
                  const hasChanges = Array.from(changes.keys()).some(k => k.startsWith(`heroes/${hero.id}/`));
                  return (
                    <div 
                      key={hero.id}
                      className={`item-card ${selectedId === hero.id ? 'selected' : ''}`}
                      onClick={() => handleSelectItem(hero.id)}
                    >
                      <div className="item-name">{lang === 'zh' ? hero.name_zh : hero.name_en}</div>
                      {hasChanges && <span className="modified-badge">*</span>}
                    </div>
                  );
                })}
                {category === 'items' && itemList.map(item => {
                  const hasChanges = Array.from(changes.keys()).some(k => k.startsWith(`items/${item.id}/`));
                  return (
                    <div 
                      key={item.id}
                      className={`item-card ${selectedId === item.id ? 'selected' : ''}`}
                      onClick={() => handleSelectItem(item.id)}
                    >
                      <div className="item-name">{lang === 'zh' ? item.name_zh : item.name_en}</div>
                      {hasChanges && <span className="modified-badge">*</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* 右侧编辑面板 */}
        <main className="editor-panel">
          {!selectedId ? (
            <div className="welcome">
              <h2>{t('欢迎使用 D2Forge', 'Welcome to D2Forge')}</h2>
              <p>{t('从左侧选择项目开始编辑', 'Select an item to start editing')}</p>
            </div>
          ) : loading ? (
            <div className="welcome"><p>{t('加载中...', 'Loading...')}</p></div>
          ) : !selectedData ? (
            <div className="welcome"><p>{t('加载失败', 'Load failed')}</p></div>
          ) : (
            <div className="editor-content">
              <div className="editor-header">
                <h2>{lang === 'zh' ? (selectedData.hero?.name_zh || selectedData.item?.name_zh) : (selectedData.hero?.name_en || selectedData.item?.name_en)}</h2>
                <span className="subtitle">{selectedId}</span>
              </div>

              {category === 'heroes' && selectedData.groups && (
                <>
                  {selectedData.groups.map(group => (
                    <div key={group.id} className="section">
                      <h3>{lang === 'zh' ? group.zh : group.en}</h3>
                      <div className="field-grid">
                        {group.fields.map(field => {
                          const changeKey = `heroes/${selectedId}/${field.key}`;
                          const change = changes.get(changeKey);
                          const currentValue = change ? change.newValue : field.value;
                          return (
                            <div key={field.key} className={`field-group ${change ? 'modified' : ''}`}>
                              <label>{lang === 'zh' ? field.zh : field.en}</label>
                              <input
                                type={field.type || 'text'}
                                value={currentValue}
                                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                                step={field.step}
                              />
                              {change && (
                                <span className="original-value">
                                  {t('原始值', 'Original')}: {change.oldValue}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {selectedData.abilities && selectedData.abilities.length > 0 && (
                    <div className="section">
                      <h3>{t('技能', 'Abilities')}</h3>
                      <div className="ability-list">
                        {selectedData.abilities.map(ability => (
                          <div key={ability.id} className="ability-card">
                            <div className="ability-header">
                              <span className="ability-name">{lang === 'zh' ? ability.name_zh : ability.name_en}</span>
                              <span className="ability-id">{ability.id}</span>
                            </div>

                            {ability.scalars && ability.scalars.length > 0 && (
                              <div className="field-grid">
                                {ability.scalars.map(field => {
                                  const fieldPath = `abilities.${ability.id}.${field.key}`;
                                  const changeKey = `heroes/${selectedId}/${fieldPath}`;
                                  const change = changes.get(changeKey);
                                  const currentValue = change ? change.newValue : field.value;
                                  return (
                                    <div key={field.key} className={`field-group ${change ? 'modified' : ''}`}>
                                      <label>{lang === 'zh' ? field.zh : field.en}</label>
                                      <input
                                        type={field.type || 'text'}
                                        value={currentValue}
                                        onChange={(e) => handleFieldChange(fieldPath, e.target.value)}
                                        step={field.step}
                                      />
                                      {change && (
                                        <span className="original-value">
                                          {t('原始值', 'Original')}: {change.oldValue}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {ability.values && ability.values.length > 0 && (
                              <div className="field-grid">
                                {ability.values.map(row => {
                                  const fieldPath = `abilities.${ability.id}.values.${row.key}`;
                                  const changeKey = `heroes/${selectedId}/${fieldPath}`;
                                  const change = changes.get(changeKey);
                                  const currentValue = change ? change.newValue : row.value;
                                  return (
                                    <div key={row.key} className={`field-group ${change ? 'modified' : ''}`}>
                                      <label>
                                        {lang === 'zh' ? row.label_zh : row.label_en}
                                        {!row.localized && <span className="unlocalized-tip"> (raw)</span>}
                                      </label>
                                      <input
                                        type="text"
                                        value={currentValue}
                                        onChange={(e) => handleFieldChange(fieldPath, e.target.value)}
                                      />
                                      {change && (
                                        <span className="original-value">
                                          {t('原始值', 'Original')}: {change.oldValue}
                                        </span>
                                      )}
                                      {row.extras && row.extras.length > 0 && (
                                        <div className="extras">
                                          {row.extras.map(ex => (
                                            <span key={ex.key} className="extra-badge">
                                              {ex.key}: {ex.value}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {category === 'items' && selectedData.item && (
                <>
                  <div className="section">
                    <h3>{t('物品属性', 'Item Stats')}</h3>
                    <div className="field-grid">
                      {selectedData.item.scalars && selectedData.item.scalars.map(field => {
                        const changeKey = `items/${selectedId}/${field.key}`;
                        const change = changes.get(changeKey);
                        const currentValue = change ? change.newValue : field.value;
                        return (
                          <div key={field.key} className={`field-group ${change ? 'modified' : ''}`}>
                            <label>{lang === 'zh' ? field.zh : field.en}</label>
                            <input
                              type={field.type || 'text'}
                              value={currentValue}
                              onChange={(e) => handleFieldChange(field.key, e.target.value)}
                              step={field.step}
                            />
                            {change && (
                              <span className="original-value">
                                {t('原始值', 'Original')}: {change.oldValue}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {selectedData.item.values && selectedData.item.values.length > 0 && (
                    <div className="section">
                      <h3>{t('数值参数', 'Ability Values')}</h3>
                      <div className="field-grid">
                        {selectedData.item.values.map(row => {
                          const fieldPath = `values.${row.key}`;
                          const changeKey = `items/${selectedId}/${fieldPath}`;
                          const change = changes.get(changeKey);
                          const currentValue = change ? change.newValue : row.value;
                          return (
                            <div key={row.key} className={`field-group ${change ? 'modified' : ''}`}>
                              <label>
                                {lang === 'zh' ? row.label_zh : row.label_en}
                                {!row.localized && <span className="unlocalized-tip"> (raw)</span>}
                              </label>
                              <input
                                type="text"
                                value={currentValue}
                                onChange={(e) => handleFieldChange(fieldPath, e.target.value)}
                              />
                              {change && (
                                <span className="original-value">
                                  {t('原始值', 'Original')}: {change.oldValue}
                                </span>
                              )}
                              {row.extras && row.extras.length > 0 && (
                                <div className="extras">
                                  {row.extras.map(ex => (
                                    <span key={ex.key} className="extra-badge">
                                      {ex.key}: {ex.value}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
