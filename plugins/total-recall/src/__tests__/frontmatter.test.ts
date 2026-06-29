import { describe, it, expect } from 'vitest';
import { parseFrontmatter, stringifyFrontmatter } from '../frontmatter.js';

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