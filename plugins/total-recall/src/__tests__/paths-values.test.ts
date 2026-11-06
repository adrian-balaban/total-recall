import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// paths.ts computes its paths and lists once, at import. These tests import a fresh copy for each
// case (after writing the config they need) and pin the exact values: a wrong file name or a
// missing excluded folder would otherwise go unnoticed, because most callers only join onto them.
const ROOT = vi.hoisted(() => '/tmp/tr-paths-values-' + process.pid);
vi.hoisted(() => { process.env.HOME = '/tmp/tr-paths-values-' + process.pid; });

const TR = path.join(ROOT, '.total-recall');
const writeConfig = (c: object | null) => {
  fs.mkdirSync(TR, { recursive: true });
  const f = path.join(TR, 'config.json');
  if (c === null) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, JSON.stringify(c));
};
const fresh = async () => { vi.resetModules(); return import('../paths.js'); };

beforeEach(() => writeConfig(null));
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe('paths.ts: fixed locations', () => {
  it('derives every file from HOME', async () => {
    const p = await fresh();
    expect(p.HOME).toBe(ROOT);
    expect(p.TOTAL_RECALL_DIR).toBe(TR);
    expect(p.CONFIG_PATH).toBe(path.join(TR, 'config.json'));
    expect(p.PERSONAL_VAULT).toBe(path.join(TR, 'personal-vault'));
    expect(p.ORG_VAULT).toBe(path.join(TR, 'org', 'org-vault'));
    expect(p.VECTORS_DB).toBe(path.join(TR, 'personal-vault', 'vectors.db'));
    expect(p.INDEX_PATH).toBe(path.join(TR, 'index.json'));
    expect(p.INVERTED_INDEX_PATH).toBe(path.join(TR, 'invertedIndex.json'));
    expect(p.INDEX_CACHE_PATH).toBe(path.join(TR, '.index-cache.txt'));
    expect(p.RECONCILE_REQUEST_FLAG).toBe(path.join(TR, '.reconcile-requested'));
  });

  it('skips exactly these folders when scanning a vault', async () => {
    const p = await fresh();
    expect([...p.EXCLUDED_DIRS].sort()).toEqual(
      ['.obsidian', '.superseded', 'completed', 'in-progress', 'projects', 'reference-docs', 'templates'],
    );
  });

  it('creates exactly these default categories', async () => {
    const p = await fresh();
    expect(p.DEFAULT_CATEGORIES).toEqual(['architecture', 'decisions', 'troubleshooting', 'meetings', 'knowledge', 'journal']);
  });
});

describe('paths.ts: vault folders from config.json', () => {
  it('expands a leading ~ in personalVault and orgVault', async () => {
    writeConfig({ personalVault: '~/pv', orgVault: '~' });
    const p = await fresh();
    expect(p.PERSONAL_VAULT).toBe(path.join(ROOT, 'pv'));
    expect(p.ORG_VAULT).toBe(ROOT);
  });

  it('does not expand a ~ that is not the first character or not followed by /', async () => {
    writeConfig({ personalVault: '/data/x~/pv', orgVault: '~other/ov' });
    const p = await fresh();
    expect(p.PERSONAL_VAULT).toBe('/data/x~/pv');
    expect(p.ORG_VAULT).toBe(path.resolve('~other/ov'));
  });
});

describe('paths.ts: redactPaths labels', () => {
  it('replaces each vault with its label and HOME with ~, longest first', async () => {
    const p = await fresh();
    expect(p.redactPaths(`a ${p.PERSONAL_VAULT}/x b ${p.ORG_VAULT}/y c ${ROOT}/z`))
      .toBe('a <personal-vault>/x b <org-vault>/y c ~/z');
  });

  it('leaves every other character alone', async () => {
    const p = await fresh();
    const s = 'Stryker tests: Error at ~/x, <tag>, "quoted" — done';
    expect(p.redactPaths(s)).toBe(s);
  });
});
