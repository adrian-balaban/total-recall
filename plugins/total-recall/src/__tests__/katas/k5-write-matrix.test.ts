// K5 — the write matrix and privacy (course pp. 33–38: "which services may touch which database").
// Sketch: plugins/total-recall/architecture/katas/s2-k5-write-matrix/adl/write-matrix-kata.adl. Fitness functions for [K5-01], [K5-02];
// each has a known-pass and a known-fail. Fixtures are synthetic and live under os.tmpdir().
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertTmpPath } from '../assert-tmp-path.js';

const PLUGIN = path.resolve(__dirname, '../../..'); // plugins/total-recall

const tmpDirs: string[] = [];
function tmpTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k5-kata-'));
  tmpDirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}
afterAll(() => { for (const d of tmpDirs) { assertTmpPath(d); fs.rmSync(d, { recursive: true, force: true }); } });

function listFiles(base: string, sub: string, ext: RegExp): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p); }
      else if (ext.test(e.name) && !e.name.endsWith('.d.ts')) out.push(path.relative(base, p).split(path.sep).join('/'));
    }
  };
  walk(path.join(base, sub));
  return out.sort();
}
const read = (base: string, rel: string) => fs.readFileSync(path.join(base, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // code, not comments

// ---- [K5-01] "only written by": the write matrix ------------------------------------------------
// The write matrix of the vault, as the course's access assertions: each persisted artifact has a
// declared set of writer files. Two views. (a) per artifact: the files that reference the artifact's
// path AND hold a write sink. (b) an inventory: every production file with a raw filesystem write
// sink is on the declared list, so a new writer cannot appear unnamed (the K4 implicit form).
const FS_SINK = /\b(?:writeFileSync|appendFileSync|renameSync|unlinkSync|rmSync|copyFileSync)\b/;
const ANY_SINK = /(?:\b(?:writeFileSync|appendFileSync|renameSync|unlinkSync|rmSync|copyFileSync|atomicWrite)|\.run|\.exec)\s*\(/;

interface ArtifactRule { ref: RegExp; writers: string[] }
const MATRIX: Record<string, ArtifactRule> = {
  'index.json': { ref: /\bINDEX_PATH\b/, writers: ['src/persistence.ts'] },
  'invertedIndex.json': { ref: /\bINVERTED_INDEX_PATH\b/, writers: ['src/persistence.ts'] },
  // [TR-W8] pins the bundle entry as the one runner; the render-and-write function lives in index-cache.ts.
  '.index-cache.txt': { ref: /\bINDEX_CACHE_PATH\b/, writers: ['src/hooks/build-index-cache.ts', 'src/index-cache.ts'] },
  // Several files pass VECTORS_DB around; what makes a writer is a SQL write statement, and only the store has them.
  'vectors.db': { ref: /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|DELETE\s+FROM|CREATE\s+(?:VIRTUAL\s+)?TABLE|DROP\s+TABLE)\b/, writers: ['src/vectorStore.ts'] },
};
// Raw fs sinks, by file: atomic-write is the leaf, journal the audit trail, the two tools write memory files.
const FS_WRITERS = ['src/atomic-write.ts', 'src/auto-reconcile.ts', 'src/journal.ts', 'src/tools/mutate.ts', 'src/tools/store.ts'];

function artifactWriters(base: string, rule: ArtifactRule): string[] {
  return listFiles(base, 'src', /\.ts$/)
    .filter(f => { const s = strip(read(base, f)); return rule.ref.test(s) && ANY_SINK.test(s); });
}
function unlistedFsWriters(base: string): string[] {
  return listFiles(base, 'src', /\.ts$/).filter(f => FS_SINK.test(strip(read(base, f))) && !FS_WRITERS.includes(f));
}

describe('[K5-01] every persisted artifact is written only by its declared writers', () => {
  const clean = {
    'src/persistence.ts': "import { INDEX_PATH, INVERTED_INDEX_PATH } from './paths.js';\natomicWrite(INDEX_PATH, 'x');\natomicWrite(INVERTED_INDEX_PATH, 'y');\n",
    'src/paths.ts': "export const INDEX_PATH = 'a';\nexport const INVERTED_INDEX_PATH = 'b';\n",
    'src/tools/store.ts': "fs.writeFileSync(filePath, body);\n",
  };
  it('[K5-01] known-pass: only the declared writer references index.json together with a write sink', () => {
    const root = tmpTree(clean);
    expect(artifactWriters(root, MATRIX['index.json']!)).toEqual(['src/persistence.ts']);
    expect(unlistedFsWriters(root)).toEqual([]);
  });
  it('[K5-01] known-fail: a rogue writer of index.json is named exactly', () => {
    const root = tmpTree({ ...clean, 'src/rogue.ts': "import { INDEX_PATH } from './paths.js';\nfs.writeFileSync(INDEX_PATH, '{}');\n" });
    expect(artifactWriters(root, MATRIX['index.json']!)).toEqual(['src/persistence.ts', 'src/rogue.ts']);
  });
  it('[K5-01] known-fail: an unlisted file with a raw filesystem write is reported, comments are not', () => {
    const root = tmpTree({ ...clean, 'src/sneaky.ts': "fs.unlinkSync(somewhere);\n", 'src/doc.ts': "// fs.writeFileSync(x) in a comment\n/* fs.rmSync(y) */\n" });
    expect(unlistedFsWriters(root)).toEqual(['src/sneaky.ts']);
  });
  it('[K5-01] known-pass: on the real tree each artifact has exactly its declared writers', () => {
    for (const [name, rule] of Object.entries(MATRIX)) expect([name, artifactWriters(PLUGIN, rule)]).toEqual([name, rule.writers]);
    expect(unlistedFsWriters(PLUGIN)).toEqual([]);
    expect(FS_WRITERS.every(w => FS_SINK.test(strip(read(PLUGIN, w))))).toBe(true); // no stale entries in the list
  });
  it('[K5-01] known-fail: SQL writes outside the vector store are reported', () => {
    const root = tmpTree({ 'src/vectorStore.ts': "d.prepare('INSERT INTO vec_memories(key) VALUES (?)').run(k);\n", 'src/other.ts': "db.prepare('DELETE FROM vec_memories').run();\n" });
    expect(artifactWriters(root, MATRIX['vectors.db']!)).toEqual(['src/other.ts', 'src/vectorStore.ts']);
  });
});

// ---- [K5-02] nothing reaches the org remote except through the privacy filter --------------------
// [TR-D3] says Org Sync pushes only after Privacy Filter passes the memory. The matrix view of it:
// every file that can run a git push is on the declared list and itself imports the filter.
const PUSH = /(?:\[\s*'push'|git\s+push\b)/;
const FILTER = /\bprivacyCheck\b|privacy-filter/;
function pushSites(base: string): string[] {
  return [...listFiles(base, 'src', /\.ts$/), ...listFiles(base, 'hooks/scripts', /\.(mjs|sh)$/), ...listFiles(base, 'scripts', /\.(mjs|ts)$/)]
    .filter(f => PUSH.test(strip(read(base, f))));
}
const unfilteredPushSites = (base: string) => pushSites(base).filter(f => !FILTER.test(strip(read(base, f))));

describe('[K5-02] a push site always knows the privacy filter', () => {
  it('[K5-02] known-pass: a push site that imports the filter is fine', () => {
    const root = tmpTree({ 'scripts/sync.mjs': "import { privacyCheck } from '../dist/privacy-filter.mjs';\ngit(dir, ['push', 'origin']);\n" });
    expect(pushSites(root)).toEqual(['scripts/sync.mjs']);
    expect(unfilteredPushSites(root)).toEqual([]);
  });
  it('[K5-02] known-fail: a push site without the filter, in any language, is reported', () => {
    const root = tmpTree({
      'scripts/leak.mjs': "git(dir, ['push', 'origin']);\n",
      'hooks/scripts/leak.sh': "git push origin main\n",
      'src/ok.ts': "export const x = 1;\n",
    });
    expect(unfilteredPushSites(root)).toEqual(['hooks/scripts/leak.sh', 'scripts/leak.mjs']);
  });
  it('[K5-02] known-pass: on the real tree the only push site is sync-org-memory.mjs and it imports the filter', () => {
    expect(pushSites(PLUGIN)).toEqual(['scripts/sync-org-memory.mjs']);
    expect(unfilteredPushSites(PLUGIN)).toEqual([]);
  });
});
