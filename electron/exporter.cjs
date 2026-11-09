'use strict';
// Export: write user changes back into the game's VPK override folder.
//
// Strategy (mirrors Dota2Editor):
//   1. Collect every file touched by the change set.
//   2. For each, re-read the original text from the game VPK and apply the
//      values by targeted text replacement (never re-serialize the whole tree,
//      which would destroy comments and formatting).
//   3. Write only those files into <game>/0test/pak01_dir.vpk.
//   4. Insert `Game 0test` into gameinfo.gi so the engine mounts the override.

const fs = require('fs');
const path = require('path');

const { openVpk, readText, writeVpk } = require('./vpk.cjs');
const gameinfo = require('./gameinfo.cjs');

const OVERRIDE_DIR = '0test';
const OVERRIDE_PACK = 'pak01_dir.vpk';

/**
 * Where the override archive goes.
 *
 * `SearchPaths` entries resolve against the GAME ROOT (`...\dota 2 beta\game`),
 * not against `dota/` — you can see that from the shipped `Game dota` line,
 * which points at `game/dota`. So `Game 0test` means `game/0test`.
 *
 * This used to be `<game>/dota/0test`, i.e. one level too deep. The engine
 * looked in `game/0test`, found nothing, and quietly fell back to the stock
 * pak01 — the export reported success (the VPK really had been written) while
 * the game showed vanilla numbers. Keep both helpers below so the path is
 * derived in exactly one place.
 */
function overrideDirFor(gamePath) {
  return path.join(gamePath, OVERRIDE_DIR);
}

function overrideVpkFor(gamePath) {
  return path.join(gamePath, OVERRIDE_DIR, OVERRIDE_PACK);
}

/**
 * Delete an override written by an older build at the wrong depth.
 *
 * Harmless if absent. Only removes the folder when it holds nothing but our
 * own archive, so it can never eat anything the user put there.
 */
function removeLegacyOverride(gamePath) {
  const legacyDir = path.join(gamePath, 'dota', OVERRIDE_DIR);
  const legacyVpk = path.join(legacyDir, OVERRIDE_PACK);
  try {
    if (!fs.existsSync(legacyVpk)) return false;
    fs.unlinkSync(legacyVpk);
    if (fs.existsSync(legacyDir) && fs.readdirSync(legacyDir).length === 0) {
      fs.rmdirSync(legacyDir);
    }
    console.log(`[export] removed legacy override at wrong depth: ${legacyDir}`);
    return true;
  } catch (err) {
    console.warn('[export] could not remove legacy override:', err.message);
    return false;
  }
}

/**
 * Where the gameinfo.gi backup lives.
 *
 * Must be the SAME path for activate and revert. It used to be computed two
 * different ways — activate wrote `<game>/data/gameinfo.gi.orig` while revert
 * looked in `<process.cwd()>/data/`, which in a packaged build is somewhere
 * else entirely. Revert then silently found no backup, left the `Game 0test`
 * line in place, and the status pill kept claiming the override was live even
 * though the VPK was gone. Keep it in one function.
 */
function backupDirFor(gamePath) {
  return path.join(gamePath, 'data');
}

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

/**
 * Replace a talent modifier line inside one AbilityValues entry.
 *
 * Hero talents are stored as an extra key on the affected value object:
 *
 *     "arrow_damage_pct"
 *     {
 *         "value"                                  "80 100 120 140"
 *         "special_bonus_unique_drow_ranger_1"     "+25"
 *     }
 *
 * so the target is a two-level path: the entry key first, then the talent id
 * inside it. Missing keys are appended, which keeps legacy files editable.
 *
 * @param {string} text
 * @param {number} blockStart offset of the AbilityValues `{`
 * @param {string} entryKey   e.g. 'arrow_damage_pct'
 * @param {string} talentId   e.g. 'special_bonus_unique_drow_ranger_1'
 * @param {string} newValue   e.g. '+30'
 */
function setTalentModifierInBlock(text, blockStart, entryKey, talentId, newValue) {
  const end = matchingBrace(text, blockStart);
  if (end === -1) return text;

  const segment = text.slice(blockStart, end);
  const safe = String(newValue).replace(/"/g, '\\"');

  // Locate the entry key at depth 1 of the AbilityValues block.
  const keyRe = new RegExp(`(["'])${escapeRegex(entryKey)}\\1`, 'g');
  let m;
  while ((m = keyRe.exec(segment)) !== null) {
    const before = segment.slice(0, m.index);
    const opens = (before.match(/\{/g) || []).length;
    const closes = (before.match(/\}/g) || []).length;
    if (opens !== closes + 1) continue;

    let p = m.index + m[0].length;
    while (p < segment.length && /[ \t\r\n]/.test(segment[p])) p++;

    if (segment[p] !== '{') continue; // scalar entry cannot host a modifier
    const objEnd = matchingBrace(segment, p);
    if (objEnd === -1) return text;
    const inner = segment.slice(p, objEnd); // includes both braces

    // Is the talent key already present inside this object?
    const modRe = new RegExp(
      `(["'])${escapeRegex(talentId)}\\1([ \\t]+)("(?:[^"\\\\]|\\\\.)*"|[^\\s{}"'\\r\\n]+)`
    );
    let newInner;
    if (modRe.test(inner)) {
      newInner = inner.replace(modRe, (full, q, gap) => `"${talentId}"${gap}"${safe}"`);
    } else {
      // Append before the closing brace, matching the surrounding indentation.
      const insertAt = inner.lastIndexOf('}');
      const lineStart = inner.lastIndexOf('\n', insertAt);
      const indent = lineStart === -1 ? '\t\t\t\t\t' : inner.slice(lineStart + 1, insertAt).match(/^[ \t]*/)[0];
      newInner = inner.slice(0, insertAt) +
                 `${indent}\t"${talentId}"\t\t"${safe}"\n` +
                 indent + inner.slice(insertAt);
    }

    return text.slice(0, blockStart) + segment.slice(0, p) + newInner +
           segment.slice(objEnd) + text.slice(end);
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
    const { file, objectPath, field, kind, modifier } = locate(ch);
    if (!file) continue;
    if (!byFile.has(file)) byFile.set(file, new Map());
    const objMap = byFile.get(file);
    // The grouping key must include the write strategy, not just the block:
    // one AbilityValues block can hold plain values, talent modifiers and
    // custom keys at once, and they are replaced by different functions.
    const pk = [objectPath.join('\u0000'), kind, modifier || ''].join('\u0001');
    if (!objMap.has(pk)) objMap.set(pk, { path: objectPath, kind, fields: [] });
    // Value is stored under `field` for scalars, and under the value key for
    // AbilityValues entries — `locate` already resolved that for us.
    objMap.get(pk).fields.push({ field, newValue: ch.newValue, modifier });
  }
  return byFile;
}

/** Map a change to (data file, KV path inside that file). */
function locate(ch) {
  // Frontend passes category='heroes'/'items', field='MovementSpeed' or
  // 'abilities.xxx.values.yyy'. Talents use the same shape as abilities but
  // live in the shared npc_abilities.txt, not the hero file.
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
    // Talents. Two storage shapes, decided by where the bonus actually lives:
    //
    //   talents.<talentId>.bonus   -> a modifier line inside one of the hero's
    //                                 abilities (hero-specific talents)
    //   talents.<talentId>.value   -> the talent's own AbilityValues entry in
    //                                 the shared npc_abilities.txt (generic ones)
    //
    // The renderer knows which one applies and sends the matching key, so all
    // this has to do is map the key onto a file + block + field.
    if (parts[0] === 'talents' && parts.length >= 3) {
      const talentId = parts[1];
      const rest = parts.slice(2);

      if (rest[0] === 'bonus' && rest.length === 3) {
        // talents.<talent>.bonus.<abilityId>.<entryKey>
        return {
          file: `scripts/npc/heroes/${ch.id}.txt`,
          objectPath: ['DOTAHeroes', ch.id, 'AbilityDefinitions', rest[1], 'AbilityValues'],
          field: rest[2],
          modifier: talentId,
          kind: 'talentModifier',
        };
      }

      const last = rest[rest.length - 1];
      if (rest[0] === 'value' || rest[0] === 'values') {
        return {
          file: 'scripts/npc/npc_abilities.txt',
          objectPath: ['DOTAAbilities', talentId, 'AbilityValues'],
          field: last,
          kind: 'abilityValue',
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

  const vpkPath = overrideVpkFor(gamePath);
  const sourceVpk = openVpk(path.join(gamePath, 'dota', 'pak01_dir.vpk'));

  const byFile = groupChanges(changes);
  const output = [];
  /** Fields that could not be written, so the UI can report a partial export. */
  const skipped = [];

  for (const [relFile, objMap] of byFile) {
    const original = readText(sourceVpk, relFile);
    if (!original) {
      console.warn(`[export] source missing, skipping: ${relFile}`);
      skipped.push({ file: relFile, reason: 'source-missing' });
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
          skipped.push({ file: relFile, field: f.field, reason: 'block-not-found' });
          continue;
        }
        const next = kind === 'abilityValue'
          ? setAbilityValueInBlock(text, offset, f.field, f.newValue)
          : kind === 'talentModifier'
            ? setTalentModifierInBlock(text, offset, f.field, f.modifier, f.newValue)
            : setFieldInBlock(text, offset, f.field, f.newValue);
        if (next !== text) { text = next; applied++; }
        else {
          console.warn(`[export] no change: ${relFile} :: ${objPath.join('.')}.${f.field}`);
          skipped.push({ file: relFile, field: f.field, reason: 'field-not-found' });
        }
      }
    }

    if (applied === 0) continue;
    output.push({ rel: relFile, data: Buffer.from(text, 'utf8') });
    console.log(`[export] ${relFile}: ${applied} field(s)`);
  }

  if (!output.length) {
    return { files: [], skipped, note: 'No matching fields found in source data' };
  }

  writeVpk(vpkPath, output);

  // Clear out an override left behind at the old, wrong depth so the engine
  // can't pick up two copies of the same files.
  removeLegacyOverride(gamePath);

  const gi = gameinfo.activate(gamePath, backupDirFor(gamePath), OVERRIDE_DIR) || {};

  return {
    files: output.map((o) => o.rel),
    skipped,
    vpk: vpkPath,
    gameinfo: gi,
  };
}

/** Remove the override VPK and restore gameinfo.gi. */
function revert(gamePath) {
  const dir = overrideDirFor(gamePath);
  const vpkPath = overrideVpkFor(gamePath);

  let removed = false;
  if (fs.existsSync(vpkPath)) {
    fs.unlinkSync(vpkPath);
    removed = true;
  }
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch { /* ignore */ }

  // Also sweep the pre-fix location, otherwise a user upgrading from a build
  // that wrote to dota/0test would keep a stale override mounted.
  if (removeLegacyOverride(gamePath)) removed = true;

  // Restore from the backup taken at activate time. Both sides now derive the
  // directory from the game path, so a packaged build can't miss it.
  let gi = gameinfo.revert(gamePath, backupDirFor(gamePath));

  // No backup (fresh clone, Steam "verify integrity", leftover state from an
  // older build): strip the line ourselves so the game still ends up vanilla.
  if (!gi.changed) {
    gi = gameinfo.deactivate(gamePath, OVERRIDE_DIR);
  }

  return { removed, gameinfo: gi };
}

function status(gamePath) {
  const vpkPath = overrideVpkFor(gamePath);
  return {
    active: gameinfo.isActive(gamePath, OVERRIDE_DIR),
    vpkExists: fs.existsSync(vpkPath),
    vpkPath,
  };
}

/**
 * Reconcile saved changes against the currently installed game files.
 *
 * Called after a game patch. For each saved change we look up what the *game*
 * now says for that field:
 *
 *   - field exists, value equals the value we recorded at edit time
 *       -> the patch did not touch it; keep the edit, no action needed
 *   - field exists, value differs from what we recorded
 *       -> the patch changed it; drop the user's edit and report, so the user
 *          re-decides instead of silently running a stale override
 *   - field no longer exists
 *       -> obsoleted by the patch; drop it
 *
 * Returns the surviving changes plus a report of what was dropped and why.
 *
 * @param {string} gamePath
 * @param {Array} changes
 * @param {(file: string) => string|null} readFile reads a VPK entry as utf8
 */
function reconcile(gamePath, changes, readFile) {
  const parseKV = require('./kv-parser.cjs').parseKV;

  const fileCache = new Map();
  const getTree = (file) => {
    if (fileCache.has(file)) return fileCache.get(file);
    const text = readFile(file);
    let tree = null;
    if (text) {
      try {
        tree = parseKV(text).root;
      } catch {
        tree = null;
      }
    }
    fileCache.set(file, tree);
    return tree;
  };

  const kept = [];
  const dropped = [];
  const unchanged = [];

  for (const ch of changes) {
    const loc = locate(ch);
    if (!loc.file) {
      dropped.push({ ...ch, reason: 'unmapped' });
      continue;
    }

    const tree = getTree(loc.file);
    if (!tree) {
      dropped.push({ ...ch, reason: 'file-missing', file: loc.file });
      continue;
    }

    // Walk to the owning object, then read the field.
    let node = tree;
    let ok = true;
    for (const seg of loc.objectPath) {
      if (!node || typeof node !== 'object' || !(seg in node)) {
        ok = false;
        break;
      }
      node = node[seg];
    }
    if (!ok) {
      dropped.push({ ...ch, reason: 'object-missing', file: loc.file });
      continue;
    }

    const entry = node[loc.field];
    if (entry === undefined) {
      dropped.push({ ...ch, reason: 'field-missing', file: loc.file });
      continue;
    }

    // Three storage shapes have to be read differently:
    //   scalar                "AbilityCooldown"  "16 15"
    //   ability value object  { value: "16 15", special_bonus_x: "+2" }
    //   talent modifier       the special_bonus_x key itself
    let current;
    if (loc.modifier) {
      const talentValue =
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? entry[loc.modifier]
          : undefined;
      if (talentValue === undefined) {
        dropped.push({ ...ch, reason: 'field-missing', file: loc.file });
        continue;
      }
      current = String(talentValue);
    } else if (typeof entry === 'string') {
      current = entry;
    } else if (entry && typeof entry === 'object' && entry.value !== undefined) {
      current = String(entry.value);
    } else {
      current = String(entry);
    }

    // `oldValue` is what the game said when the user made the edit.
    if (String(ch.oldValue) === String(current)) {
      kept.push(ch);
      unchanged.push(ch.field);
    } else {
      dropped.push({
        ...ch,
        reason: 'game-changed',
        gameNow: current,
        wasAtEdit: ch.oldValue,
        file: loc.file,
      });
    }
  }

  return { kept, dropped, unchanged };
}

module.exports = {
  apply,
  revert,
  status,
  reconcile,
  locate,
  groupChanges,
  setFieldInBlock,
  setAbilityValueInBlock,
  setTalentModifierInBlock,
  findBlockOffset,
  matchingBrace,
};
