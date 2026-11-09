'use strict';
// Localization lookup for Dota 2 tokens.
//
// Two strategies are tried in order:
//   1. Lazy per-token regex (cheap when only a handful of tokens are needed)
//   2. Full one-pass index (built on demand once enough lookups have been missed
//      by the lazy path, which is what happens when listing hundreds of abilities)
//
// The full index is a flat Map<string,string> — it stays around a few MB, unlike
// a parseKV tree of the same files which blows the heap.

const FILES = {
  en: {
    abilities: 'resource/localization/abilities_english.txt',
    dota: 'resource/localization/dota_english.txt',
  },
  zh: {
    abilities: 'resource/localization/abilities_schinese.txt',
    dota: 'resource/localization/dota_schinese.txt',
  },
};

/**
 * @param {(path: string) => string|null} readText reads a VPK entry as utf8
 * @param {{indexThreshold?: number}} opts
 */
function createLocalizationLookup(readText, opts = {}) {
  const indexThreshold = opts.indexThreshold ?? 40;

  const fileCache = new Map();     // path -> text
  const tokenCache = new Map();    // "lang:token" -> string|null
  const indexes = new Map();       // lang -> Map<token, string>
  const missCount = new Map();     // lang -> number of lazy misses

  const getText = (p) => {
    if (!p) return null;
    if (!fileCache.has(p)) fileCache.set(p, readText(p));
    return fileCache.get(p);
  };

  function buildIndex(lang) {
    if (indexes.has(lang)) return indexes.get(lang);

    const map = new Map();
    const files = FILES[lang];
    if (!files) {
      indexes.set(lang, map);
      return map;
    }

    // Matches lines of the form:  "token"    "value"
    // Values may contain escaped quotes, <font> markup, %% tokens — all fine
    // because we only stop at the closing quote followed by end-of-line.
    const lineRe = /^[ \t]*"([^"\r\n]+)"[ \t]+"((?:[^"\\]|\\.)*)"[ \t]*\r?$/gm;

    for (const kind of ['abilities', 'dota']) {
      const text = getText(files[kind]);
      if (!text) continue;

      const re = new RegExp(lineRe.source, 'gm');
      let m;
      while ((m = re.exec(text)) !== null) {
        const key = m[1];
        if (map.has(key)) continue; // first file wins
        map.set(key, m[2].replace(/\\"/g, '"'));
      }
    }

    indexes.set(lang, map);
    console.log(`[localization] Indexed ${map.size} tokens for ${lang}`);
    return map;
  }

  function lookupLazy(lang, token) {
    const files = FILES[lang];
    if (!files) return null;

    const re = new RegExp(`^[\\t ]*"${escapeRegex(token)}"[\\t ]+"((?:[^"\\\\]|\\\\.)*)"`, 'm');

    for (const kind of ['abilities', 'dota']) {
      const text = getText(files[kind]);
      if (!text) continue;
      const m = text.match(re);
      if (m) return m[1].replace(/\\"/g, '"');
    }
    return null;
  }

  /**
   * @param {'zh'|'en'} lang
   * @param {string} token
   * @returns {string|null}
   */
  function lookup(lang, token) {
    if (!token) return null;
    const key = `${lang}:${token}`;
    if (tokenCache.has(key)) return tokenCache.get(key);

    const idx = indexes.get(lang);
    if (idx) {
      const hit = idx.get(token) ?? null;
      tokenCache.set(key, hit);
      return hit;
    }

    const hit = lookupLazy(lang, token);
    if (hit !== null) {
      tokenCache.set(key, hit);
      return hit;
    }

    // Too many misses: the caller is enumerating, so switch to a full index.
    const misses = (missCount.get(lang) || 0) + 1;
    missCount.set(lang, misses);
    if (misses >= indexThreshold) {
      const built = buildIndex(lang);
      const indexed = built.get(token) ?? null;
      tokenCache.set(key, indexed);
      return indexed;
    }

    tokenCache.set(key, null);
    return null;
  }

  /** Force-build indexes ahead of time (used right after init for bulk lists). */
  function warm(langs = ['zh', 'en']) {
    for (const l of langs) buildIndex(l);
  }

  /**
   * Translate a whole batch without per-token regex thrash.
   * @returns {Map<string,string|null>}
   */
  function lookupMany(lang, tokens) {
    const out = new Map();
    const idx = buildIndex(lang);
    for (const t of tokens) out.set(t, idx.get(t) ?? null);
    return out;
  }

  return { lookup, lookupMany, warm, buildIndex };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Hero display name token, e.g. npc_dota_hero_antimage:n */
function heroNameToken(heroName) {
  return `${heroName}:n`;
}

/**
 * Ability display name candidates. Dota 2 is inconsistent here:
 *   items      -> "DOTA_Tooltip_Ability_item_x"  (capital A)
 *   abilities  -> "DOTA_Tooltip_ability_x"       (lowercase a)
 *   facets     -> "DOTA_Tooltip_Facet_x"
 */
function abilityNameTokens(abilityName) {
  return [
    `DOTA_Tooltip_Ability_${abilityName}`,
    `DOTA_Tooltip_ability_${abilityName}`,
    `DOTA_Tooltip_Facet_${abilityName}`,
  ];
}

/** Ability field label token candidates, e.g. DOTA_Tooltip_ability_antimage_blink_range */
function fieldLabelTokens(abilityName, field) {
  return [
    `DOTA_Tooltip_ability_${abilityName}_${field}`,
    `DOTA_Tooltip_Ability_${abilityName}_${field}`,
  ];
}

/** Short description token candidates. */
function descriptionTokens(abilityName) {
  return [
    `DOTA_Tooltip_ability_${abilityName}_Description`,
    `DOTA_Tooltip_Ability_${abilityName}_Description`,
  ];
}

module.exports = {
  createLocalizationLookup,
  heroNameToken,
  abilityNameTokens,
  fieldLabelTokens,
  descriptionTokens,
  FILES,
};
