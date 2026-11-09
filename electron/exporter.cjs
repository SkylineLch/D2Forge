'use strict';
// Export: write user changes back into the game's VPK override folder.
//
// Strategy (mirrors Dota2Editor):
//   1. Collect every file touched by the change set.
//   2. For each, re-read the original text from the game VPK and apply the
//      values by targeted text replacement (never re-serialize the whole tree,
//      which would destroy comments and formatting).
//   3. Write only those files into <game>/dota/0test/pak01_dir.vpk.
//   4. Insert `Game 0test` into gameinfo.gi so the engine mounts the override.

const fs = require('fs');
const path = require('path');

const { openVpk, readText, writeVpk } = require('./vpk.cjs');
const gameinfo = require('./gameinfo.cjs');

const OVERRIDE_DIR = '0test';
const OVERRIDE_PACK = 'pak01_dir.vpk';

/* --------------------- value replacement in KV text --------------------- */

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace the value of a `"field" "value"` pair inside the block that starts
 * at `blockStart` (character offset of the owning object's opening brace).
 *
 * Works on raw text so comments, ordering and whitespace elsewhere survive.
 *
 * @param {string} text
 * @param {number} blockStart  offset of the owning object's `{`
 * @param {string} field
 * @param {string} newValue
 * @returns {string} updated text
 */
function setFieldInBlock(text, blockStart, field, newValue) {
  const end = matchingBrace(text, blockStart);
  if (end === -1) return text;

  const segment = text.slice(blockStart, end);

  // Match `"field"` followed by whitespace then either a quoted value or a bare token.
  // Do not cross into a nested block: stop at the first `{` after the key.
  const re = new RegExp(
    `(["']${escapeRegex(field)}["'])([ \\t]+)("(?:[^"\\\\]|\\\\.)*"|[^\\s{}"'\\r\\n]+)`,
    'g'
  );

  let replaced = false;
  const out = segment.replace(re, (full, key, gap, oldRaw, offset) => {
    if (replaced) return full;
    // Ignore keys that actually belong to a nested child object.
    const before = segment.slice(0, offset);
    const opens = (before.match(/\{/g) || []).length;
    const closes = (before.match(/\}/g) || []).length;
    if (opens !== closes + 1) return full; // not directly inside this block

    replaced = true;
    return `${key}${gap}"${String(newValue).replace(/"/g, '\\"')}"`;
  });

  if (!replaced) return text;
  return text.slice(0, blockStart) + out + text.slice(end);
}

/**
 * Replace one AbilityValues entry inside the block at `blockStart`.
 *
 * Entries come in two shapes and both must keep working:
 *   "mana_threshold"  "60"                        -> replace the scalar
 *   "AbilityCooldown" { "value" "10.5 9 7.5 6" }  -> replace the inner value
 *
 * @param {string} text
 * @param {number} blockStart offset of the AbilityValues `{`
 * @param {string} key
 * @param {string} newValue
 */
function setAbilityValueInBlock(text, blockStart, key, newValue) {
  const end = matchingBrace(text, blockStart);
  if (end === -1) return text;

  // `segment` excludes the block's closing `}` at `end`, so every branch below
  // resumes with `text.slice(end)` to emit it exactly once.
  const segment = text.slice(blockStart, end);
  const safe = String(newValue).replace(/"/g, '\\"');

  // Find the key at depth 1 relative to this block.
  const keyRe = new RegExp(`(["'])${escapeRegex(key)}\\1`, 'g');
  let m;
  while ((m = keyRe.exec(segment)) !== null) {
    const before = segment.slice(0, m.index);
    const opens = (before.match(/\{/g) || []).length;
    const closes = (before.match(/\}/g) || []).length;
    if (opens !== closes + 1) continue; // belongs to a nested object

    let p = m.index + m[0].length;
    while (p < segment.length && /[ \t\r\n]/.test(segment[p])) p++;

    if (segment[p] === '{') {
      // Object form: rewrite the inner "value" pair, or add one if absent.
      const objEnd = matchingBrace(segment, p);
      if (objEnd === -1) return text;
      const inner = segment.slice(p, objEnd);
      // Group 1 is only the quote character, so the key must be re-emitted
      // verbatim rather than reconstructed from the capture.
      const valueRe = /(["'])value\1([ \t\r\n]+)("(?:[^"\\]|\\.)*"|[^\s{}"'\r\n]+)/;

      let newInner;
      if (valueRe.test(inner)) {
        newInner = inner.replace(valueRe, (full, q, gap) => `"value"${gap}"${safe}"`);
      } else {
        // Insert right after the opening brace.
        newInner = inner.replace('{', `{\n\t\t\t\t\t\t"value"\t\t\t\t\t\t"${safe}"`);
      }
      return text.slice(0, blockStart) + segment.slice(0, p) + newInner +
             segment.slice(objEnd) + text.slice(end);
    }

    // Scalar form.
    const scalarRe = /^("(?:[^"\\]|\\.)*"|[^\s{}"'\r\n]+)/;
    const sm = scalarRe.exec(segment.slice(p));
    if (!sm) return text;
    const after = segment.slice(p + sm[0].length);
    return text.slice(0, blockStart) + segment.slice(0, p) + `"${safe}"` + after +
           text.slice(end);
  }

  return text;
}

/** Index of the `}` matching the `{` at `open`, or -1. */
function matchingBrace(text, open) {
  if (text[open] !== '{') return -1;
  let depth = 0;
  let inStr = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Locate the character offset of the block that owns `fieldPath`, walking the
 * KV tree manually so we can return offsets rather than plain values.
 *
 * @param {string} text
 * @param {string[]} fieldPath e.g. ['npc_dota_hero_antimage']
 * @returns {number} offset of the opening `{`, or -1
 */
function findBlockOffset(text, fieldPath) {
  let depth = 0;
  let i = 0;
  let want = 0;
  let lastKeyEnd = -1;

  while (i < text.length) {
    const c = text[i];

    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '"') {
      const start = ++i;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++;
        i++;
      }
      const str = text.slice(start, i);
      i++;
      lastKeyEnd = i;

      if (want < fieldPath.length && str === fieldPath[want]) {
        // Expect a brace soon after.
        let j = i;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (text[j] === '{') {
          want++;
          if (want === fieldPath.length) return j;
          depth++;
          i = j + 1;
          continue;
        }
      }
      continue;
    }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { depth--; i++; continue; }
    i++;
  }
  return -1;
}

/* ------------------------------ export core ----------------------------- */

/** Group changes by the file they belong to and by target object path. */
function groupChanges(changes) {
  /** @type {Map<string, Map<string, {path:string[], kind:string, fields:Array}>>} */
  const byFile = new Map();

  for (const ch of changes) {
    const { file, objectPath, field, kind } = locate(ch);
    if (!file) continue;
    if (!byFile.has(file)) byFile.set(file, new Map());
    const objMap = byFile.get(file);
    const pk = objectPath.join('\u0000');
    if (!objMap.has(pk)) objMap.set(pk, { path: objectPath, kind, fields: [] });
    // Value is stored under `field` for scalars, and under the value key for
    // AbilityValues entries — `locate` already resolved that for us.
    objMap.get(pk).fields.push({ field, newValue: ch.newValue });
  }
  return byFile;
}

/** Map a change to (data file, KV path inside that file). */
function locate(ch) {
  // Frontend passes category='heroes'/'items', field='MovementSpeed' or 'abilities.xxx.values.yyy'.
  const cat = ch.category === 'heroes' ? 'hero' : ch.category === 'items' ? 'item' : ch.category;
  
  if (cat === 'hero') {
    const parts = ch.field.split('.');
    if (parts[0] === 'abilities' && parts.length >= 2) {
      const abilityId = parts[1];
      const rest = parts.slice(2);
      if (rest[0] === 'values' && rest.length === 2) {
        // abilities.antimage_blink.values.AbilityCooldown -> inside AbilityValues
        return {
          file: `scripts/npc/heroes/${ch.id}.txt`,
          objectPath: ['DOTAHeroes', ch.id, 'AbilityDefinitions', abilityId, 'AbilityValues'],
          field: rest[1],
          kind: 'abilityValue',
        };
      }
      if (rest[0] === 'scalars' || rest.length === 1) {
        // abilities.antimage_blink.AbilityCastPoint -> scalar inside the ability
        return {
          file: `scripts/npc/heroes/${ch.id}.txt`,
          objectPath: ['DOTAHeroes', ch.id, 'AbilityDefinitions', abilityId],
          field: rest[rest.length - 1],
          kind: 'scalar',
        };
      }
    }
    // hero base stat
    return {
      file: `scripts/npc/heroes/${ch.id}.txt`,
      objectPath: ['DOTAHeroes', ch.id],
      field: ch.field,
      kind: 'scalar',
    };
  }

  if (cat === 'item') {
    const parts = ch.field.split('.');
    if (parts[0] === 'values' && parts.length === 2) {
      // values.blink_range -> inside AbilityValues
      return {
        file: 'scripts/npc/items.txt',
        objectPath: ['DOTAAbilities', ch.id, 'AbilityValues'],
        field: parts[1],
        kind: 'abilityValue',
      };
    }
    // item scalar
    return {
      file: 'scripts/npc/items.txt',
      objectPath: ['DOTAAbilities', ch.id],
      field: ch.field,
      kind: 'scalar',
    };
  }

  return { file: null, objectPath: [], field: null, kind: null };
}

/**
 * Apply the full change set and write the override VPK.
 * @param {string} gamePath  .../dota 2 beta/game
 * @param {Array} changes
 */
function apply(gamePath, changes) {
  if (!changes.length) {
    // Still make sure the override folder exists so the user can revert cleanly.
    return { files: [], note: 'No changes to export' };
  }

  const vpkPath = path.join(gamePath, 'dota', OVERRIDE_DIR, OVERRIDE_PACK);
  const sourceVpk = openVpk(path.join(gamePath, 'dota', 'pak01_dir.vpk'));

  const byFile = groupChanges(changes);
  const output = [];

  for (const [relFile, objMap] of byFile) {
    const original = readText(sourceVpk, relFile);
    if (!original) {
      console.warn(`[export] source missing, skipping: ${relFile}`);
      continue;
    }

    let text = original;
    let applied = 0;

    for (const { path: objPath, kind, fields } of objMap.values()) {
      for (const f of fields) {
        // Re-locate on every write: earlier replacements shift all later offsets.
        const offset = findBlockOffset(text, objPath);
        if (offset === -1) {
          console.warn(`[export] block not found: ${relFile} :: ${objPath.join('.')}`);
          continue;
        }
        const next = kind === 'abilityValue'
          ? setAbilityValueInBlock(text, offset, f.field, f.newValue)
          : setFieldInBlock(text, offset, f.field, f.newValue);
        if (next !== text) { text = next; applied++; }
        else console.warn(`[export] no change: ${relFile} :: ${objPath.join('.')}.${f.field}`);
      }
    }

    if (applied === 0) continue;
    output.push({ rel: relFile, data: Buffer.from(text, 'utf8') });
    console.log(`[export] ${relFile}: ${applied} field(s)`);
  }

  if (!output.length) {
    return { files: [], note: 'No matching fields found in source data' };
  }

  writeVpk(vpkPath, output);

  const gi = gameinfo.activate(gamePath, path.join(path.dirname(vpkPath), '..', '..', 'data'), OVERRIDE_DIR)
    || {};

  return {
    files: output.map((o) => o.rel),
    vpk: vpkPath,
    gameinfo: gi,
  };
}

/** Remove the override VPK and restore gameinfo.gi. */
function revert(gamePath) {
  const dir = path.join(gamePath, 'dota', OVERRIDE_DIR);
  const vpkPath = path.join(dir, OVERRIDE_PACK);

  let removed = false;
  if (fs.existsSync(vpkPath)) {
    fs.unlinkSync(vpkPath);
    removed = true;
  }
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch { /* ignore */ }

  const gi = gameinfo.revert(gamePath, path.join(process.cwd(), 'data'));
  return { removed, gameinfo: gi };
}

function status(gamePath) {
  const vpkPath = path.join(gamePath, 'dota', OVERRIDE_DIR, OVERRIDE_PACK);
  return {
    active: gameinfo.isActive(gamePath, OVERRIDE_DIR),
    vpkExists: fs.existsSync(vpkPath),
  };
}

module.exports = {
  apply,
  revert,
  status,
  groupChanges,
  setFieldInBlock,
  setAbilityValueInBlock,
  findBlockOffset,
  matchingBrace,
};
