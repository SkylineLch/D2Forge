// KeyValues (KV1) text parser for Dota 2 data files.
// Token-stream based so it handles braces on the same or next line,
// quoted/unquoted values, comments, and preprocessor directives.

const DIRECTIVE = /^#(base|include|append|Base|Include)\b/i;

function tokenize(text) {
  const tokens = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];

    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (c === '{') {
      tokens.push({ t: '{' });
      i++;
      continue;
    }
    if (c === '}') {
      tokens.push({ t: '}' });
      i++;
      continue;
    }
    if (c === '"') {
      i++;
      const start = i;
      while (i < n && text[i] !== '"') i++;
      // s/e span the content inside the quotes; qs/qe include them.
      tokens.push({ t: 's', v: text.slice(start, i), s: start, e: i, qs: start - 1, qe: i + 1, quoted: true });
      i++;
      continue;
    }
    // Unquoted token (bare number, identifier, or directive line)
    const start = i;
    // Check if it's a directive at line start
    const isLineStart = (start === 0 || text[start - 1] === '\n' || /^\s*$/.test(text.slice(0, start).split('\n').pop()));
    
    if (c === '#' && isLineStart) {
      // consume to end of line as a directive
      let j = start;
      while (j < n && text[j] !== '\n') j++;
      tokens.push({ t: 'directive', v: text.slice(start, j).trim() });
      i = j;
      continue;
    }
    
    // Regular unquoted token
    while (i < n && !/[\s{}"]/.test(text[i])) i++;
    tokens.push({ t: 's', v: text.slice(start, i) });
  }

  return tokens;
}

/**
 * Parse KV text into a plain object.
 * Returns { root, directives } where directives keep their source order.
 */
function parseKV(text) {
  const tokens = tokenize(text);
  const directives = [];
  const root = {};
  // stack of containers; each frame tracks the object plus the pending key
  const stack = [{ obj: root, key: null }];
  let idx = 0;

  const top = () => stack[stack.length - 1];

  while (idx < tokens.length) {
    const tok = tokens[idx];

    if (tok.t === '}' ) {
      if (stack.length > 1) stack.pop();
      idx++;
      continue;
    }

    if (tok.t === 'directive') {
      directives.push(tok.v);
      idx++;
      continue;
    }

    if (tok.t === 's') {
      const key = tok.v;
      const next = tokens[idx + 1];

      if (next && next.t === '{') {
        const child = {};
        top().obj[key] = child;
        stack.push({ obj: child, key: null });
        idx += 2;
        continue;
      }

      if (next && next.t === 's') {
        top().obj[key] = next.v;
        idx += 2;
        continue;
      }

      // Bare key with no value - keep as empty object placeholder
      if (top().obj[key] === undefined) top().obj[key] = {};
      idx++;
      continue;
    }

    // Stray '{'
    if (tok.t === '{') {
      stack.push({ obj: {}, key: null });
      idx++;
      continue;
    }
    idx++;
  }

  return { root, directives };
}

function quoteValue(v) {
  const s = String(v);
  if (s === '') return '""';
  if (/[\s"{}]/.test(s)) return '"' + s.replace(/"/g, '\\"') + '"';
  return s;
}

/**
 * Serialize an object tree back to KV text.
 * `order` optionally supplies key ordering per object (Map<obj, string[]>).
 */
function serializeKV(obj, opts = {}) {
  const indentUnit = opts.indentUnit ?? '\t';
  const lines = [];

  const walk = (node, depth) => {
    const pad = indentUnit.repeat(depth);
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        lines.push(`${pad}"${key}"`);
        lines.push(`${pad}{`);
        walk(value, depth + 1);
        lines.push(`${pad}}`);
      } else {
        lines.push(`${pad}"${key}"\t\t${quoteValue(value)}`);
      }
    }
  };

  walk(obj, 0);
  return lines.join('\n');
}

module.exports = { parseKV, serializeKV, tokenize, DIRECTIVE };
