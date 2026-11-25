import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { COMPONENT_FILES } from '../architecture/components.js';
import { assertTmpPath } from '../assert-tmp-path.js';

// K1 - Entity Trap vs the real structure (katas/s1-k1-structure/adl/structure-kata.adl).
// Sketch IDs [K1-nn] are not TR-* IDs: adl-coverage ignores them. Every check has a known-pass
// (real tree) and a known-fail (synthetic tree under os.tmpdir()), asserted - CI stays green.

const ROOT = path.resolve(__dirname, '..', '..', '..'); // plugins/total-recall
const STRUCTURE_ADL = path.join(ROOT, 'architecture', 'adl', 'structure.adl');

const tmpDirs: string[] = [];
function tmpTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-k1-'));
  tmpDirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}
afterAll(() => { for (const d of tmpDirs) { assertTmpPath(d); fs.rmSync(d, { recursive: true, force: true }); } });

// Repo-relative ('src/...') production .ts files, as the TR-S12 walk sees them.
function listTsFiles(base: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); }
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(path.relative(base, p).split(path.sep).join('/'));
    }
  };
  walk(path.join(base, 'src'));
  return out;
}

// ---- [K1-01] the partition has no missing link ------------------------------------------------
const adlComponentIds = (adl: string): string[] =>
  [...adl.matchAll(/^\s*DEFINE COMPONENT (.+?) AS (\S+)/gm)].map((m) => m[2]!);

function linkMismatch(adlIds: string[], mapKeys: string[]) {
  return {
    adlOnly: adlIds.filter((i) => !mapKeys.includes(i)).sort(),
    mapOnly: mapKeys.filter((k) => !adlIds.includes(k)).sort(),
  };
}

// Components whose file-set matches no production file: every rule about them is vacuously green.
function emptyComponents(sets: Record<string, RegExp>, files: string[]): string[] {
  return Object.entries(sets).filter(([, re]) => !files.some((f) => re.test(f))).map(([n]) => n).sort();
}

describe('K1 structure partition', () => {
  it('[K1-01] known-pass: structure.adl components and COMPONENT_FILES keys match both ways', () => {
    const ids = adlComponentIds(fs.readFileSync(STRUCTURE_ADL, 'utf8'));
    expect(ids.length).toBeGreaterThan(0);
    expect(linkMismatch(ids, Object.keys(COMPONENT_FILES))).toEqual({ adlOnly: [], mapOnly: [] });
  });

  it('[K1-01] known-fail: a ghost ADL component and an unlisted file-set are both reported', () => {
    const adl = 'DEFINE COMPONENT Real AS real\nDEFINE COMPONENT Ghost AS ghost\n';
    const keys = ['real', 'extra'];
    expect(linkMismatch(adlComponentIds(adl), keys)).toEqual({ adlOnly: ['ghost'], mapOnly: ['extra'] });
  });

  it('[K1-01] known-pass: every real component still owns at least one production file', () => {
    expect(emptyComponents(COMPONENT_FILES, listTsFiles(ROOT))).toEqual([]);
  });

  it('[K1-01] known-fail: a file-set matching nothing in a synthetic tree is reported by name', () => {
    const dir = tmpTree({ 'src/state.ts': '', 'src/paths.ts': '' });
    const sets = { state: /^src\/state\.ts$/, paths: /^src\/paths\.ts$/, persistence: /^src\/persistence\.ts$/ };
    expect(emptyComponents(sets, listTsFiles(dir))).toEqual(['persistence']);
  });
});

// ---- [K1-02] allow-lists are exercised --------------------------------------------------------
const importSpecifiers = (src: string): string[] =>
  [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);

// Repo-relative target ('src/state') for each relative import of a file, extension stripped.
function importedTargets(base: string, rel: string): string[] {
  const text = fs.readFileSync(path.join(base, rel), 'utf8');
  return importSpecifiers(text)
    .filter((s) => s.startsWith('.'))
    .map((s) => path.posix.normalize(path.posix.join(path.posix.dirname(rel), s)).replace(/\.(js|ts)$/, ''));
}

interface AllowList { owner: string; files: string[]; allowed: string[] }

// Allow-lists none of whose allowed targets the owner imports even once (existence, not per-file).
function unusedAllowLists(base: string, lists: AllowList[]): string[] {
  return lists
    .filter((l) => !l.files.some((f) => importedTargets(base, f).some((t) => l.allowed.includes(t))))
    .map((l) => l.owner);
}

// The allow-lists TR-S6 and TR-S11 state, written down as the production code names them.
const REAL_LISTS: AllowList[] = [
  { owner: 'Tool Registry [TR-S6]', files: ['src/tools/registry.ts'], allowed: ['src/state', 'src/paths'] },
  { owner: 'bulk tool [TR-S11]', files: ['src/tools/bulk.ts'], allowed: ['src/tools/store', 'src/tools/mutate', 'src/tools/registry'] },
  { owner: 'architecture tool [TR-S11]', files: ['src/tools/architecture.ts'], allowed: ['src/tools/store', 'src/tools/mutate', 'src/tools/registry'] },
];

describe('K1 allow-lists', () => {
  it('[K1-02] known-pass: every real allow-list is exercised by its owner', () => {
    expect(unusedAllowLists(ROOT, REAL_LISTS)).toEqual([]);
  });

  it('[K1-02] known-fail: an owner importing none of its allowed targets is reported', () => {
    const dir = tmpTree({
      'src/tools/bulk.ts': "import { x } from './unrelated.js';\n",
      'src/tools/store.ts': '',
    });
    const lists: AllowList[] = [{ owner: 'bulk', files: ['src/tools/bulk.ts'], allowed: ['src/tools/store'] }];
    expect(unusedAllowLists(dir, lists)).toEqual(['bulk']);
  });

  // Course pp. 23-24: per-class reading vs existence reading of IS DEPENDENT ON.
  const fixture = {
    'src/questionsender/QuestionSender.ts': "import { Model } from '../testmodel/Model.js';\n",
    'src/questionsender/QuestionFormatter.ts': 'export const f = 1;\n',
    'src/testmodel/Model.ts': '',
  };
  const sender = ['src/questionsender/QuestionSender.ts', 'src/questionsender/QuestionFormatter.ts'];
  const importsModel = (base: string, f: string) => importedTargets(base, f).includes('src/testmodel/Model');

  it('[K1-02] lesson: the per-class reading flags correct code, the existence reading does not', () => {
    const dir = tmpTree(fixture);
    const perClassViolations = sender.filter((f) => !importsModel(dir, f));
    expect(perClassViolations).toEqual(['src/questionsender/QuestionFormatter.ts']); // wrong rule
    expect(sender.some((f) => importsModel(dir, f))).toBe(true); // existence: holds
  });

  it('[K1-02] known-fail: the existence reading can fail - no importer, no dependency', () => {
    const dir = tmpTree({ ...fixture, 'src/questionsender/QuestionSender.ts': 'export const s = 1;\n' });
    expect(sender.some((f) => importsModel(dir, f))).toBe(false);
  });
});
