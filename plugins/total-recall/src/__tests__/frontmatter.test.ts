import { describe, it, expect } from 'vitest';
import { parseFrontmatter, stringifyFrontmatter, withExecutiveSummary } from '../frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses inline arrays and coerces numbers', () => {
    const raw = `---\ntitle: Foo\ntags: [a, b-c, "c"]\nimportanceScore: 0.7\n---\nbody\n`;
    const { data, content } = parseFrontmatter(raw);
    expect(data.title).toBe('Foo');
    expect(data.tags).toEqual(['a', 'b-c', 'c']);
    expect(data.importanceScore).toBe(0.7);
    expect(content).toBe('body\n');
  });

  it('parses block-style arrays (written by legacy gray-matter)', () => {
    const raw = `---\ntitle: Foo\ntags:\n  - a\n  - b-c\nsessions:\n  - s1\n  - s2\n---\nbody\n`;
    const { data } = parseFrontmatter(raw);
    expect(data.tags).toEqual(['a', 'b-c']);
    expect(data.sessions).toEqual(['s1', 's2']);
  });

  it('parses inline array items that themselves contain a comma (quote-aware)', () => {
    // A tag like `cdc,outbox` is single-quoted by the serializer so the inner
    // comma is unambiguous; parseInlineArray must NOT split on a comma inside
    // quotes. The previous naive .split(',') corrupted this on re-parse:
    //   [kafka, 'cdc,outbox'] → ['kafka', 'cdc', 'outbox']
    const raw = `---\ntitle: Foo\ntags: [kafka, 'cdc,outbox']\n---\nbody\n`;
    const { data } = parseFrontmatter(raw);
    expect(data.tags).toEqual(['kafka', 'cdc,outbox']);
  });

  it('keeps ISO date strings as strings (not Date objects)', () => {
    const raw = `---\ncreated: 2026-04-01T10:00:00.000Z\nupdated: 2026-04-01T10:00:00.000Z\n---\nbody\n`;
    const { data } = parseFrontmatter(raw);
    expect(data.created).toBe('2026-04-01T10:00:00.000Z');
    expect(data.updated).toBe('2026-04-01T10:00:00.000Z');
    expect(typeof data.created).toBe('string');
  });

  it("parses single-quoted values (with '' escaping) and double-quoted values", () => {
    const raw = `---\ntitle: 'Kafka: CDC'\nnote: 'it''s here'\nalias: "double"\n---\nbody\n`;
    const { data } = parseFrontmatter(raw);
    expect(data.title).toBe('Kafka: CDC');
    expect(data.note).toBe("it's here");
    expect(data.alias).toBe('double');
  });

  it('coerces booleans and null', () => {
    const raw = `---\nflag: true\ndefault: false\nnothing: null\n---\nbody\n`;
    const { data } = parseFrontmatter(raw);
    expect(data.flag).toBe(true);
    expect(data.default).toBe(false);
    expect(data.nothing).toBe(null);
  });

  it('returns empty data and full raw when no frontmatter present', () => {
    const raw = 'no frontmatter here';
    const { data, content } = parseFrontmatter(raw);
    expect(data).toEqual({});
    expect(content).toBe('no frontmatter here');
  });

  it('returns empty content when file is only frontmatter', () => {
    const raw = `---\ntitle: Foo\n---\n`;
    const { data, content } = parseFrontmatter(raw);
    expect(data.title).toBe('Foo');
    expect(content).toBe('');
  });

  it('preserves the leading newline after the closing delimiter (matches gray-matter)', () => {
    const raw = `---\ntitle: Foo\n---\n\n## Executive Summary\n\nbody\n`;
    const { content } = parseFrontmatter(raw);
    expect(content).toBe('\n## Executive Summary\n\nbody\n');
  });

  it('treats an explicit empty array as []', () => {
    const raw = `---\ntitle: Foo\ntags: []\n---\nbody\n`;
    const { data } = parseFrontmatter(raw);
    expect(data.tags).toEqual([]);
  });

  it('drops a bare key: with no items (no spurious empty array)', () => {
    const raw = `---\ntitle: Foo\ntags:\nimportanceScore: 0.5\n---\nbody\n`;
    const { data } = parseFrontmatter(raw);
    expect('tags' in data).toBe(false);
    expect(data.importanceScore).toBe(0.5);
  });

  it('ignores comment lines', () => {
    const raw = `---\n# a comment\ntitle: Foo\n---\nbody\n`;
    const { data } = parseFrontmatter(raw);
    expect(data).toEqual({ title: 'Foo' });
  });

  it('parses inline arrays and scalars with trailing comments', () => {
    const raw = `---\ntitle: Foo\ntags: [a, b] # a comment\nimportanceScore: 0.7 # also a comment\n---\nbody\n`;
    const { data } = parseFrontmatter(raw);
    expect(data.tags).toEqual(['a', 'b']);
    expect(data.importanceScore).toBe(0.7);
    expect(data.title).toBe('Foo');
  });

  it('keeps # characters inside quoted scalars, not as comment markers', () => {
    const raw = `---\ntitle: 'Issue #42'\nnote: "hash # inside"\n---\nbody\n`;
    const { data } = parseFrontmatter(raw);
    expect(data.title).toBe('Issue #42');
    expect(data.note).toBe('hash # inside');
  });

  it('strips trailing comments from scalar strings', () => {
    const raw = `---\ntitle: Foo # comment\ntags: [a]\n---\nbody\n`;
    const { data } = parseFrontmatter(raw);
    expect(data.title).toBe('Foo');
    expect(data.tags).toEqual(['a']);
  });
});

describe('stringifyFrontmatter', () => {
  it('serializes arrays inline (compatible with the .cjs sync parser)', () => {
    const out = stringifyFrontmatter('body', { title: 'Foo', tags: ['a', 'b-c'] });
    expect(out).toContain('tags: [a, b-c]');
    expect(out).toContain('title: Foo');
    expect(out).toBe('---\ntitle: Foo\ntags: [a, b-c]\n---\nbody');
  });

  it('serializes empty arrays as []', () => {
    const out = stringifyFrontmatter('body', { title: 'Foo', tags: [] });
    expect(out).toContain('tags: []');
  });

  it('quotes strings containing colons (keeps ISO dates as quoted strings)', () => {
    const out = stringifyFrontmatter('body', {
      created: '2026-04-01T10:00:00.000Z',
      title: 'Kafka: CDC',
    });
    expect(out).toContain("created: '2026-04-01T10:00:00.000Z'");
    expect(out).toContain("title: 'Kafka: CDC'");
  });

  it('serializes numbers and booleans bare', () => {
    const out = stringifyFrontmatter('body', { importanceScore: 0.7, flag: true });
    expect(out).toContain('importanceScore: 0.7');
    expect(out).toContain('flag: true');
  });

  it('omits undefined and null fields', () => {
    const out = stringifyFrontmatter('body', { title: 'Foo', author: undefined, sessions: null });
    expect(out).not.toContain('author');
    expect(out).not.toContain('sessions');
  });

  it('round-trips a full memory frontmatter through parse', () => {
    const data = {
      title: 'Kafka CDC',
      tags: ['kafka', 'cdc', 'org'],
      author: 'adrianb',
      sessions: ['s1', 's2'],
      created: '2026-04-01T10:00:00.000Z',
      updated: '2026-04-01T10:00:00.000Z',
      importanceScore: 0.8,
    };
    const out = stringifyFrontmatter('\n## Executive Summary\n\nbody', data);
    const parsed = parseFrontmatter(out);
    expect(parsed.data).toEqual(data);
    expect(parsed.content).toBe('\n## Executive Summary\n\nbody');
  });

  it('round-trips a tag containing a comma (quotes the item, parses back intact)', () => {
    // The bug: a comma inside a tag was re-split by parseInlineArray on re-parse,
    // so `tags: [kafka, 'cdc,outbox']` → ['kafka','cdc','outbox'] → re-serialized
    // as [kafka, cdc, outbox], silently corrupting the tag. needsQuotes now flags
    // commas (single-quotes the item) and parseInlineArray is quote-aware.
    const data = { title: 'CDC', tags: ['kafka', 'cdc,outbox'] };
    const out = stringifyFrontmatter('body', data);
    expect(out).toContain("tags: [kafka, 'cdc,outbox']");
    const reparsed = parseFrontmatter(out);
    expect(reparsed.data.tags).toEqual(['kafka', 'cdc,outbox']);
    // The round-trip is stable: re-serializing the parse yields the same text.
    const out2 = stringifyFrontmatter('body', reparsed.data);
    expect(out2).toBe(out);
  });

  it('handles apostrophes in strings (mid-string quotes need no escaping)', () => {
    const out = stringifyFrontmatter('body', { title: "it's here" });
    // A mid-string apostrophe is valid in a bare YAML plain scalar, so no
    // quoting is needed (matches js-yaml). Round-trip must still be correct.
    expect(out).toContain("title: it's here");
    expect(parseFrontmatter(out).data.title).toBe("it's here");
  });
  it('quotes and doubles apostrophes when a string starts with one', () => {
    const out = stringifyFrontmatter('body', { title: "'quoted'" });
    expect(out).toContain("title: '''quoted'''");
    expect(parseFrontmatter(out).data.title).toBe("'quoted'");
  });

  // T4: serializeArrayItem throws if an inline-array item contains a CR/LF.
  // A literal newline in `tags: [a\nb]` would terminate the frontmatter line
  // and inject the following text as a new key on re-parse (frontmatter-key
  // injection from an array value). The scalar newline rejection is tested
  // elsewhere; the array-item arm (frontmatter.ts:215) was not. Pin both the
  // LF and CR cases, and that the throw mentions the array item.
  it('throws on a newline in an inline-array item (T4, frontmatter-key injection guard)', () => {
    expect(() => stringifyFrontmatter('body', { title: 'T', tags: ['a\nb'] })).toThrow(/array item/);
    expect(() => stringifyFrontmatter('body', { title: 'T', tags: ['a\rb'] })).toThrow(/array item/);
    // A multi-element array where only ONE item carries a newline still throws
    // (the map runs serializeArrayItem per item; the bad one trips it).
    expect(() => stringifyFrontmatter('body', { title: 'T', tags: ['ok', 'bad\nx'] })).toThrow(/array item/);
    // Clean items still serialize fine (no false positive).
    expect(stringifyFrontmatter('body', { title: 'T', tags: ['ok', 'fine'] })).toContain('tags: [ok, fine]');
  });
});

describe('frontmatter — DoS immunity', () => {
  it('does not blow up on pathological merge-key/alias YAML (GHSA-h67p-54hq-rp68)', () => {
    // The js-yaml advisory exploits merge keys (<<) + repeated aliases to cause
    // quadratic blowup. This parser treats unknown YAML constructs as plain
    // strings/keys and does not resolve anchors or merges, so the input is
    // handled in linear time and simply ignored.
    const pathological = `---\nfoo: &a\n<<: *a\n<<: *a\n<<: *a\ntitle: Real\n---\nbody\n`;
    const start = Date.now();
    const { data, content } = parseFrontmatter(pathological);
    const ms = Date.now() - start;
    expect(data.title).toBe('Real');
    expect(content).toBe('body\n');
    expect(ms).toBeLessThan(100); // linear; no quadratic blowup
  });

  it('treats a frontmatter key with regex metacharacters as literal (escapeRegExp)', () => {
    // Keys are interpolated into a RegExp to detect `key: []` / block items.
    // Without escaping, a key like `(a+)+` becomes the regex `^(a+)+:`, which
    // fails to match the literal text `(a+)+: []` (the `(` is not `a`), so the
    // "explicit empty array" guard wrongly DELETES the key. Escaping makes the
    // key match literally. This is a correctness guard, not just defense-in-depth:
    // a teammate can push an org-vault memory whose key contains metacharacters.
    const raw = `---\n(a+)+: []\ntitle: T\n---\nbody\n`;
    const start = Date.now();
    const { data } = parseFrontmatter(raw);
    const ms = Date.now() - start;
    expect(data.title).toBe('T');
    expect(data['(a+)+']).toEqual([]); // explicit `[]` must be KEPT, not dropped
    expect(ms).toBeLessThan(100);
  });

  it('drops __proto__/constructor/prototype keys (no prototype pollution)', () => {
    // A teammate can push frontmatter with a crafted __proto__/constructor/
    // prototype key via the shared org vault. parseYamlish must drop these
    // fail-closed so they can't reassign the returned object's prototype: a
    // `__proto__:` line preset to `[]` invokes the Object.prototype __proto__
    // setter, making that array the object's [[Prototype]] (instance pollution
    // — currently inert since known keys are read via direct prop access /
    // Object.keys, which exclude inherited, but a known YAML-parser vuln class).
    const raw = `---\n__proto__:\n  - polluted\nconstructor: evil\nprototype: x\ntitle: Real\n---\nbody\n`;
    const { data } = parseFrontmatter(raw);
    expect(data.title).toBe('Real');
    // __proto__ must NOT have replaced data's prototype with the array.
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    // constructor/prototype must NOT have landed as own enumerable props.
    expect(Object.keys(data)).toEqual(['title']);
    // The block item `- polluted` is an orphan (no prior array key to attach to
    // once __proto__ is dropped), and an array-prototype adds no readable
    // .polluted/.length on data — document that the current threat is structural.
    expect((data as any).polluted).toBeUndefined();
    expect((data as any).length).toBeUndefined();
  });
});

// T5: withExecutiveSummary is idempotent. Re-applying it to content that ALREADY
// begins with the `## Executive Summary` header must NOT prepend a second copy —
// otherwise a caller that normalizes user-supplied content via withExecutiveSummary
// (e.g. update_memory on a body that already shipped) would double the header on
// every edit, growing the file. The check is `content.trimStart().startsWith('## Executive Summary')`;
// pinning the three cases (header at start, after leading whitespace, after leading
// newline) guards against a future "simplify the trim" refactor that re-introduces
// the doubling. store_memory's first-time path (no header yet) is covered by the
// store tests; this pins the re-apply path.
describe('withExecutiveSummary', () => {
  it('prepends the header when the content has none (first-time write path)', () => {
    const out = withExecutiveSummary('Just a body.');
    expect(out).toBe('\n## Executive Summary\n\nJust a body.');
  });

  it('does NOT double the header when called on content that already starts with it (T5 idempotency)', () => {
    const body = '## Executive Summary\n\nExisting body.';
    const out = withExecutiveSummary(body);
    // trimStart() trims leading whitespace, so the result keeps the single header
    // and adds a leading newline so the on-disk body matches parseFrontmatter's
    // yielded content (see withExecutiveSummary in frontmatter.ts).
    expect(out).toBe('\n' + body);
    // Critical: exactly ONE header — a regression that drops the trimStart check
    // would yield two `## Executive Summary` lines.
    expect(out.split('## Executive Summary').length - 1).toBe(1);
  });

  it('handles leading whitespace before the existing header (trimStart cover)', () => {
    const body = '## Executive Summary\n\nAfter whitespace.';
    const out = withExecutiveSummary('   \n\n' + body);
    expect(out.split('## Executive Summary').length - 1).toBe(1);
    expect(out).toContain('## Executive Summary');
    expect(out).toContain('After whitespace.');
  });

  it('serializes arrays containing non-string primitive items (e.g. numbers in tags)', () => {
    const out = stringifyFrontmatter('body', { tags: [2026, 'org'] });
    expect(out).toContain('tags: [2026, org]');
  });
});