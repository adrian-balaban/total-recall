import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Stryker runs ONLY the test files listed in vitest.stryker.config.ts. A unit
// test that exercises a mutated module but is missing from that list kills no
// mutants, so its module's score reads lower than the suite really earns (it
// happened with persistence-access.test.ts, and 15 other files were found
// missing). Every top-level test file that imports a mutated module must
// therefore be allow-listed or sit in EXCLUDED below with a reason.

const ROOT = path.resolve(__dirname, '..', '..');
const TESTS = path.join(ROOT, 'src', '__tests__');

const strykerConf = JSON.parse(fs.readFileSync(path.join(ROOT, 'stryker.conf.json'), 'utf8'));
const mutated: string[] = strykerConf.mutate.map((p: string) => path.basename(p, '.ts'));
const allow = new Set(
  [...fs.readFileSync(path.join(ROOT, 'vitest.stryker.config.ts'), 'utf8').matchAll(/'(src\/__tests__\/[^']+\.test\.ts)'/g)].map((m) => m[1]!),
);

// Files deliberately kept out of the Stryker run. Add a one-line reason.
const EXCLUDED: Record<string, string> = {
  'index.test.ts': 'boots the server; Stryker perturbs module init order (see vitest.stryker.config.ts header)',
};

const testFiles = fs.readdirSync(TESTS).filter((f) => f.endsWith('.test.ts'));
const importsMutated = (f: string) => {
  const src = fs.readFileSync(path.join(TESTS, f), 'utf8');
  return mutated.some((m) => new RegExp(`['"]\\.\\./${m}\\.js['"]`).test(src));
};

describe('Stryker allow-list', () => {
  it('lists every test that imports a mutated module, or excludes it with a reason', () => {
    const missing = testFiles.filter((f) => importsMutated(f) && !allow.has(`src/__tests__/${f}`) && !EXCLUDED[f]);
    expect(missing).toEqual([]);
  });

  it('only lists files that exist', () => {
    const gone = [...allow].filter((p) => !fs.existsSync(path.join(ROOT, p)));
    expect(gone).toEqual([]);
  });

  it('keeps EXCLUDED honest: every entry exists and is not also allow-listed', () => {
    for (const f of Object.keys(EXCLUDED)) {
      expect(testFiles).toContain(f);
      expect(allow.has(`src/__tests__/${f}`)).toBe(false);
    }
  });

  it('mutates only modules that exist', () => {
    for (const m of mutated) expect(fs.existsSync(path.join(ROOT, 'src', `${m}.ts`))).toBe(true);
  });
});
