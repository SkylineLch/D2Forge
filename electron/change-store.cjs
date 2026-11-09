'use strict';
// Change store: tracks user modifications to game data.
// Changes are keyed by "<category>/<id>/<field>" and persisted to JSON.

const fs = require('fs');
const path = require('path');

/**
 * @typedef {{
 *   category: 'hero'|'item'|'ability',
 *   id: string,
 *   field: string,
 *   oldValue: string|number|object,
 *   newValue: string|number|object,
 *   timestamp: number
 * }} Change
 */

function createChangeStore(dataDir) {
  const storeFile = path.join(dataDir, 'changes.json');
  
  /** @type {Map<string, Change>} */
  let changes = new Map();
  let dirty = false;

  function key(category, id, field) {
    return `${category}/${id}/${field}`;
  }

  function load(gamePath) {
    if (!fs.existsSync(storeFile)) {
      changes.clear();
      return;
    }
    try {
      const json = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
      if (json.gamePath === gamePath && Array.isArray(json.changes)) {
        changes = new Map(json.changes.map(c => [key(c.category, c.id, c.field), c]));
        console.log(`[change-store] Loaded ${changes.size} changes for ${gamePath}`);
      } else {
        changes.clear();
      }
    } catch (err) {
      console.error('[change-store] Failed to load:', err);
      changes.clear();
    }
    dirty = false;
  }

  function save(gamePath) {
    if (!dirty) return;
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    const json = {
      gamePath,
      changes: Array.from(changes.values()),
    };
    fs.writeFileSync(storeFile, JSON.stringify(json, null, 2), 'utf8');
    dirty = false;
    console.log(`[change-store] Saved ${changes.size} changes`);
  }

  function set(change) {
    const k = key(change.category, change.id, change.field);
    changes.set(k, { ...change, timestamp: Date.now() });
    dirty = true;
  }

  function get(category, id, field) {
    return changes.get(key(category, id, field)) || null;
  }

  function remove(k) {
    if (changes.delete(k)) dirty = true;
  }

  function clear() {
    changes.clear();
    dirty = true;
  }

  function all() {
    return Array.from(changes.values());
  }

  function count() {
    return changes.size;
  }

  function has(category, id, field) {
    return changes.has(key(category, id, field));
  }

  return { load, save, set, get, remove, clear, all, count, has };
}

module.exports = { createChangeStore };
