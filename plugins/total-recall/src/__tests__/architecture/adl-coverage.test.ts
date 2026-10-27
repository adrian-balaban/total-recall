import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The ADL has no runtime, so its assertions are enforced by the tests that carry
// their ID. This test keeps the two in step: every `# [TR-xx]` tag on an ASSERT in
// architecture/adl/*.adl needs a test whose name contains `[TR-xx]`, and every
// `[TR-xx]` in a test name needs an assertion.

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ADL_DIR = path.join(ROOT, 'architecture', 'adl');
const TESTS_DIR = path.join(ROOT, 'src', '__tests__');
const SELF = path.basename(__filename);
const ID = /\[(TR-[A-Z][0-9]+)\]/g;

function ids(text: string): string[] {
  return [...text.matchAll(ID)].map((m) => m[1]!);
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const adlFiles = fs.readdirSync(ADL_DIR).filter((f) => f.endsWith('.adl'));

// ASSERT lines only, so an ID mentioned in a comment is not an assertion.
const assertIds = adlFiles.flatMap((f) =>
  fs.readFileSync(path.join(ADL_DIR, f), 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('ASSERT(') || l.startsWith('    ASSERT('))
    .flatMap(ids),
);

const testIds = walk(TESTS_DIR)
  .filter((f) => f.endsWith('.test.ts') && path.basename(f) !== SELF)
  .flatMap((f) =>
    fs.readFileSync(f, 'utf8').split('\n')
      .filter((l) => /\b(it|it\.fails|it\.each\([^)]*\))\s*\(/.test(l) || /^\s*['"`]\[TR-/.test(l))
      .flatMap(ids),
  );

describe('ADL ↔ test coverage', () => {
  it('finds the ADL files and assertions', () => {
    expect(adlFiles.length).toBeGreaterThanOrEqual(4);
    expect(assertIds.length).toBeGreaterThan(0);
  });

  it('every ASSERT ID is unique', () => {
    const dupes = assertIds.filter((id, i) => assertIds.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it('every ASSERT in architecture/adl has a test carrying its ID', () => {
    const missing = assertIds.filter((id) => !testIds.includes(id));
    expect(missing).toEqual([]);
  });

  it('every ID in a test name has an ASSERT in architecture/adl', () => {
    const orphan = [...new Set(testIds)].filter((id) => !assertIds.includes(id));
    expect(orphan).toEqual([]);
  });
});
