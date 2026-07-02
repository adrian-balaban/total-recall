// Minimal YAML-frontmatter parser/serializer for memory files.
//
// Replaces gray-matter (which pulled in EOL js-yaml 3.x — GHSA-h67p-54hq-rp68,
// no 3.x patch). Memory frontmatter is a fixed, simple schema
// (title, tags, author, sessions, created, updated, importanceScore), so this
// targeted parser covers the cases the plugin actually writes and reads:
//   - inline arrays:   tags: [a, b, "c"]
//   - block arrays:    tags:\n  - a\n  - b      (still produced by older files)
//   - quoted strings:  'single' / "double" (with '' escaping inside single quotes)
//   - bare strings, numbers, booleans
// It does NOT support arbitrary YAML (merge keys, anchors, multi-line scalars) —
// by design, which also makes it immune to the js-yaml merge-key DoS.

export interface Frontmatter {
  data: Record<string, unknown>;
  content: string;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// Escape regex metacharacters in a parsed frontmatter KEY before interpolating it
// into a RegExp. Frontmatter keys come from `^([^:\s]+):` in parseYamlish, so a
// key may legitimately contain metacharacters like `()[]{}*+?|.\^$`. A crafted
// key (e.g. `(a+)+`) interpolated raw into `new RegExp(\`^${key}:\`)` allows
// catastrophic backtracking (ReDoS) — and because the org vault is shared via
// git, one malicious teammate could hang every member's boot (parseFrontmatter
// runs over all vault files at boot via reconcileIndex). Escape first.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseFrontmatter(raw: string): Frontmatter {
  const match = raw.match(FM_RE);
  if (!match) return { data: {}, content: raw };
  // Group 1 of FM_RE is guaranteed by the regex when match succeeds.
  const data = parseYamlish(match[1]!);
  const content = raw.slice(match.index! + match[0]!.length);
  return { data, content };
}

export function stringifyFrontmatter(content: string, data: object): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    lines.push(`${k}: ${serializeValue(v)}`);
  }
  return `---\n${lines.join('\n')}\n---\n${content}`;
}

// Ensure a memory body begins with a "## Executive Summary" section. Idempotent:
// if the content already starts with that header, leave it as-is (avoids doubling
// it when a caller passes content that already includes the heading). Returns the
// body string to hand to stringifyFrontmatter — leading newline included so the
// on-disk body matches what parseFrontmatter(content) yields on the read path.
export function withExecutiveSummary(content: string): string {
  return content.trimStart().startsWith('## Executive Summary')
    ? `\n${content.trimStart()}`
    : `\n## Executive Summary\n\n${content}`;
}

// ─── parse ───────────────────────────────────────────────────────────────────

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    const inner = t.slice(1, -1);
    return t.startsWith("'") ? inner.replace(/''/g, "'") : inner.replace(/\\"/g, '"');
  }
  return t;
}

function coerceScalar(s: string): unknown {
  const t = s.trim();
  if (t === '') return '';
  // Already-quoted → string (don't coerce "0.7" that was intentionally quoted, but
  // our writer only quotes when necessary, so a quoted value is meant to be a string).
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return unquote(t);
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === 'true' || t === 'True' || t === 'TRUE') return true;
  if (t === 'false' || t === 'False' || t === 'FALSE') return false;
  if (t === 'null' || t === '~') return null;
  return t;
}

function parseInlineArray(s: string): string[] {
  // Content between [ ... ]; items are simple tokens (tags, session ids) — but
  // an item may itself contain a comma (e.g. a tag `cdc,outbox`), which the
  // serializer single-quotes so the inner comma is unambiguous (see
  // serializeArrayItem → needsQuotes → the comma check below). A naive
  // .split(',') would split `'cdc,outbox'` at the inner comma on re-parse,
  // corrupting the tag into two entries and breaking the round-trip:
  //   tags: [kafka, 'cdc,outbox']  →  parse  →  ['kafka', 'cdc', 'outbox']
  //                                                 →  re-serialize  →  [kafka, cdc, outbox]
  // Walk the string with a small quote-aware scanner: break only on commas
  // OUTSIDE single/double quotes, accumulate every char (quote chars included)
  // into the current segment, and unquote each segment at the end. Because the
  // quote chars are always accumulated into the segment regardless of toggle
  // state, the toggle only governs comma-breaking — so `''` (single-quote
  // escape) and `\"` (double-quote escape) inside an item are still repaired by
  // unquote() on the full token. Preserves the prior behavior for unquoted
  // simple tokens (whitespace trimmed, empties dropped).
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      const v = unquote(cur);
      if (v !== '') out.push(v);
      cur = '';
    } else {
      cur += ch;
    }
  }
  const last = unquote(cur);
  if (last !== '') out.push(last);
  return out;
}

function parseYamlish(body: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    i++;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    // Block sequence item belonging to a pending key: "  - value"
    const blockItem = line.match(/^\s+-\s+(.+)$/);
    if (blockItem) {
      // Attach to the most recently seen array-typed key. There is at most one
      // "open" block-sequence array at any time (parsed top-down; the writer
      // emits inline arrays, so a block-sequence here is a legacy / hand-edited
      // fallback). Walk data once for the block, find the array key if any.
      let lastArrayKey: string | null = null;
      for (const [k, v] of Object.entries(data)) if (Array.isArray(v)) lastArrayKey = k;
      if (lastArrayKey) {
        (data[lastArrayKey] as string[]).push(unquote(blockItem[1]!));
        continue;
      }
      // Orphan block item — ignore
      continue;
    }
    const kv = line.match(/^([^:\s]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!;
    // Coerce through "" so the undefined type from noUncheckedIndexedAccess
    // doesn't propagate; the next branches all read `val` as a string.
    const val = kv[2] ?? '';
    // Prototype-pollution guard: a crafted `__proto__:` / `constructor:` /
    // `prototype:` key in frontmatter (a teammate can push one via the shared
    // org vault) would invoke the Object.prototype __proto__ setter on `data`
    // (e.g. a `__proto__:` preset to `[]` reassigns data's [[Prototype]] to an
    // array — instance pollution). Known keys are read via direct prop access
    // and Object.keys (which exclude inherited), so the impact is currently
    // inert, but this is a known YAML-parser vuln class; drop the key fail-closed
    // rather than let a teammate control the shape of a parsed object.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (val === '' ) {
      // Could be a block sequence (value on following lines) — preset an array
      // so subsequent "  - x" items attach to it. If no items follow, drop it.
      data[key] = [];
      continue;
    }
    if (val.startsWith('[') && val.endsWith(']')) {
      data[key] = parseInlineArray(val.slice(1, -1));
      continue;
    }
    data[key] = coerceScalar(val);
  }
  // Drop keys that are empty arrays because a block sequence was expected but
  // none followed (keeps `data` clean for keys like `tags:` with nothing under).
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v) && v.length === 0 && !hadBlockItems(body, k)) {
      // Keep empty arrays only if explicitly written as `[]`; a bare `key:` with
      // no items is treated as absent.
      // nosemgrep: detect-non-literal-regexp — key is escapeRegExp()'d, so it matches literally; reviewed.
      if (!new RegExp(`^${escapeRegExp(k)}:\\s*\\[\\s*\\]\\s*$`, 'm').test(body)) delete data[k];
    }
  }
  return data;
}

function hadBlockItems(body: string, key: string): boolean {
  // True if `key:` is followed by indented "- " items before the next non-indented line.
  // nosemgrep: detect-non-literal-regexp — key is escapeRegExp()'d, so it matches literally; reviewed.
  const re = new RegExp(`^${escapeRegExp(key)}:\\s*\\n(\\s+-\\s+.+\\n)+`, 'm');
  return re.test(body);
}

// ─── serialize ───────────────────────────────────────────────────────────────

function serializeValue(v: unknown): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[${v.map(serializeArrayItem).join(', ')}]`;
  }
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return serializeString(String(v));
}

function serializeArrayItem(s: unknown): string {
  if (typeof s === 'number') return String(s);
  if (typeof s === 'boolean') return s ? 'true' : 'false';
  const str = String(s);
  // A literal newline in an inline-array item would terminate the frontmatter
  // line and inject a following line as a new key on re-parse. Single-quoted
  // YAML scalars can't span lines either, so refuse rather than mis-emit.
  if (/[\r\n]/.test(str)) throw new Error('Frontmatter array item contains a newline — refusing to emit.');
  return needsQuotes(str) ? `'${str.replace(/'/g, "''")}'` : str;
}

function serializeString(s: string): string {
  // Same injection risk as array items: a newline in a scalar value would spill
  // onto the next frontmatter line and be parsed as an extra key. Fail closed.
  if (/[\r\n]/.test(s)) throw new Error('Frontmatter value contains a newline — refusing to emit.');
  return needsQuotes(s) ? `'${s.replace(/'/g, "''")}'` : s;
}

function needsQuotes(s: string): boolean {
  if (s === '') return true;
  if (/^\s|\s$/.test(s)) return true; // leading/trailing whitespace
  if (/^[!&*?|>%@`"'#,[\]{}-]/.test(s)) return true; // YAML indicator chars at start
  if (/:/.test(s)) return true; // any colon (ISO dates, "Title: Sub") — dates stay strings
  if (/,/.test(s)) return true; // any comma — would otherwise re-split on parseInlineArray (see round-trip fix there)
  if (/#/.test(s)) return true; // comment marker
  if (/^(true|false|null|~|yes|no)$/i.test(s)) return true; // YAML keywords
  if (/^-?\d+(\.\d+)?$/.test(s)) return true; // looks numeric
  return false;
}