import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseFrontmatter, stringifyFrontmatter } from '../frontmatter.js';

// Property-based regression tests for the custom frontmatter parser/serializer
// (G16). The generator stays inside the subset the plugin actually reads/writes:
//   - safe, non-reserved keys
//   - scalar strings without CR/LF (so the serializer never has to throw)
//   - integers, booleans, and arrays of those primitives
//   - arbitrary content bodies (may contain newlines / CRLF)

describe('frontmatter property tests', () => {
  const KNOWN_KEYS = ['title', 'tags', 'author', 'sessions', 'created', 'updated', 'importanceScore'];

  const safeKey = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_-]*$/).filter(
    k => k.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(k),
  );

  const safeString = fc.string({ maxLength: 40 }).filter(s => !/[\r\n]/.test(s));

  const scalarValue = fc.oneof(
    safeString,
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
    fc.boolean(),
  );

  // Arrays in this plugin are always non-empty string arrays (tags, sessions,
  // etc.). Empty array items are dropped by the quote-aware inline-array parser,
  // and booleans/numbers inside arrays are quoted on write and read back as
  // strings, so restrict array items to non-empty strings for a true round-trip.
  const arrayItem = safeString.filter(s => s.length > 0);
  const arrayValue = fc.array(arrayItem, { minLength: 0, maxLength: 6 });

  const value = fc.oneof(scalarValue, arrayValue);

  const content = fc.string({ maxLength: 200 });

  const data = fc.uniqueArray(
    fc.tuple(safeKey, value),
    { selector: ([k]) => k, minLength: 0, maxLength: 12 },
  ).map(entries => Object.fromEntries(entries));

  it('round-trips arbitrary serializable data and content (stringify -> parse)', () => {
    fc.assert(
      fc.property(data, content, (inputData, inputContent) => {
        const raw = stringifyFrontmatter(inputContent, inputData);
        const parsed = parseFrontmatter(raw);
        expect(parsed.data).toEqual(inputData);
        expect(parsed.content).toBe(inputContent);
      }),
      { numRuns: 200 },
    );
  });

  it('serialization is idempotent: parse then stringify yields the same raw text', () => {
    fc.assert(
      fc.property(data, content, (inputData, inputContent) => {
        const raw1 = stringifyFrontmatter(inputContent, inputData);
        const parsed = parseFrontmatter(raw1);
        const raw2 = stringifyFrontmatter(parsed.content, parsed.data);
        expect(raw2).toBe(raw1);
      }),
      { numRuns: 200 },
    );
  });

  it('emits known keys in canonical order, then unknown keys sorted alphabetically', () => {
    fc.assert(
      fc.property(data, (inputData) => {
        const raw = stringifyFrontmatter('body', inputData);
        const headerMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
        const header = headerMatch?.[1] ?? '';
        const keys = header
          .split('\n')
          .map(line => line.match(/^([^:\s]+):\s*/)?.[1])
          .filter((k): k is string => Boolean(k));

        const known = keys.filter(k => KNOWN_KEYS.includes(k));
        expect(known).toEqual(KNOWN_KEYS.filter(k => k in inputData));

        const custom = keys.filter(k => !KNOWN_KEYS.includes(k));
        expect(custom).toEqual([...custom].sort());
      }),
      { numRuns: 200 },
    );
  });
});
