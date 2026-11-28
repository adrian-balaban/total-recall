// K8 — stressor × component audit (course pp. 66–67). Sketch: plugins/total-recall/architecture/katas/s2-k8-stressors/adl/stressors-kata.adl.
// Fitness functions for [K8-01], [K8-02]; each has a known-pass and a known-fail.
// The stressor list and its residue rule ([TR-E1]) already exist; this kata audits what they leave out.
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertTmpPath } from '../assert-tmp-path.js';

const PLUGIN = path.resolve(__dirname, '../../..'); // plugins/total-recall

const tmpDirs: string[] = [];
function tmpTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k8-kata-'));
  tmpDirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}
afterAll(() => { for (const d of tmpDirs) { assertTmpPath(d); fs.rmSync(d, { recursive: true, force: true }); } });

const styleOf = (base: string) => fs.readFileSync(path.join(base, 'architecture/adl/architecture-style.adl'), 'utf8');

function walkFiles(base: string, sub: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__tests__') walk(p); }
      else out.push(path.relative(base, p).split(path.sep).join('/'));
    }
  };
  walk(path.join(base, sub));
  return out;
}

// ---- [K8-01] the incidence matrix points at things that exist ---------------------------------
// architecture-style.adl maps each stressor to the files it hits (`#   S1 → hooks/hooks.json, ...`).
// [TR-E1] checks the residue IDs; nothing checks these pointers, so a renamed file leaves a matrix
// that still reads well and points nowhere. Runtime artifacts (index files, the vector db) are not
// source files and are not checked.
const RUNTIME = new Set(['index.json', 'invertedIndex.json', '.index-cache.txt', 'vectors.db']);
function matrixFiles(style: string): string[] {
  const out: string[] = [];
  for (const line of style.split('\n')) {
    if (!/^#\s+S\d+\s*→/.test(line)) continue;
    for (const m of line.matchAll(/[\w./-]+\.(?:ts|mjs|json|sh|adl)\b/g)) if (!RUNTIME.has(m[0])) out.push(m[0]);
  }
  return [...new Set(out)];
}
function danglingMatrixFiles(base: string, style: string): string[] {
  const all = [...walkFiles(base, 'src'), ...walkFiles(base, 'hooks'), ...walkFiles(base, 'scripts'), ...walkFiles(base, 'architecture')];
  return matrixFiles(style).filter(f => !all.some(a => a === f || a.endsWith('/' + f)));
}

describe('[K8-01] every file the incidence matrix names exists', () => {
  const style = '# S1 → hooks/hooks.json, hooks.gemini.json (Lifecycle Hooks)\n#   S2 → Vectors: embeddings.ts, vectorStore.ts\n';
  const FILES = { 'hooks/hooks.json': '{}', 'hooks/hooks.gemini.json': '{}', 'src/embeddings.ts': '', 'src/vectorStore.ts': '' };
  it('[K8-01] known-pass: a matrix whose files all exist has no dangling pointer', () => {
    expect(danglingMatrixFiles(tmpTree(FILES), style.replace(/^# S1/, '#   S1'))).toEqual([]);
  });
  it('[K8-01] known-fail: a renamed file leaves a dangling pointer, named exactly', () => {
    const files = { ...FILES }; delete (files as Record<string, string>)['src/vectorStore.ts'];
    expect(danglingMatrixFiles(tmpTree(files), style.replace(/^# S1/, '#   S1'))).toEqual(['vectorStore.ts']);
  });
  it('[K8-01] known-pass: on the real tree the matrix names files and none dangles', () => {
    const real = styleOf(PLUGIN);
    expect(matrixFiles(real).length).toBeGreaterThanOrEqual(4); // the matrix was really read
    expect(danglingMatrixFiles(PLUGIN, real)).toEqual([]);
  });
});

// ---- [K8-02] every source of variability in the code is a stressor -----------------------------
// A stressor is a change the architecture must survive. Evidence of variability is read from the code
// (an engines range, a value read once at load, a nested CLI call); each must be named by some
// stressor line in architecture-style.adl. The audit finds the ones the seven stressors leave out.
interface Variability { name: string; file: string; evidence: RegExp; mentioned: RegExp }
const VARIABILITY: Variability[] = [
  { name: 'node-version', file: 'package.json', evidence: /"engines"\s*:\s*\{[^}]*"node"/, mentioned: /\bnode\b.*\bversion|\bnode\s*\d/i },
  { name: 'config-read-once', file: 'src/server.ts', evidence: /read once/, mentioned: /restart|read once|config.*(change|without)/i },
  { name: 'nested-claude-cli', file: 'hooks/scripts/extract-and-store-memories.sh', evidence: /claude -p/, mentioned: /claude (cli|-p)|nested claude|extraction cli/i },
];
const stressorLines = (style: string) => style.split('\n').filter(l => /^#\s*S\d+\s/.test(l) && /residue/i.test(l)).join('\n');
function unnamedVariability(base: string, style: string): string[] {
  const lines = stressorLines(style);
  return VARIABILITY
    .filter(v => fs.existsSync(path.join(base, v.file)) && v.evidence.test(fs.readFileSync(path.join(base, v.file), 'utf8')))
    .filter(v => !v.mentioned.test(lines))
    .map(v => v.name);
}

describe('[K8-02] every source of variability in the code is named by a stressor', () => {
  const SRC = {
    'package.json': '{"engines":{"node":">=18"}}', 'src/server.ts': '// specDriven is read once here\n',
    'hooks/scripts/extract-and-store-memories.sh': 'claude -p "$prompt"\n',
  };
  it('[K8-02] known-pass: stressors that name all three leave nothing unnamed', () => {
    const style = '# S8 the Node version changes under the plugin: residue TR-R1\n# S9 config changes need a restart: residue TR-C1\n# S10 the nested claude CLI changes flags: residue TR-C9\n';
    expect(unnamedVariability(tmpTree(SRC), style)).toEqual([]);
  });
  it('[K8-02] known-fail: with no stressor for them, all three are named as unnamed', () => {
    expect(unnamedVariability(tmpTree(SRC), '# S1 the host changes its hook API: residue TR-C5\n')).toEqual(
      ['node-version', 'config-read-once', 'nested-claude-cli']);
  });
  it('[K8-02] known-pass: a source of variability that is not in the code is not demanded', () => {
    expect(unnamedVariability(tmpTree({ 'package.json': '{}' }), '# S1 x: residue TR-C5\n')).toEqual([]);
  });
  it('[K8-02] the real architecture-style.adl: only config-read-once still has no stressor (S8, S9 added; config-read-once tracked in BACKLOG)', () => {
    expect(stressorLines(styleOf(PLUGIN)).split('\n').length).toBeGreaterThanOrEqual(7); // the seven stressors were read
    // Disposition: S8 (Node version) and S9 (nested claude -p) added. Config-read-once has no tagged residue to
    // name, so it stays a recorded gap (BACKLOG: config.orgVault change without restart). When a residue exists,
    // add `# S10 ...: residue TR-xx` and this becomes [].
    expect(unnamedVariability(PLUGIN, styleOf(PLUGIN))).toEqual(['config-read-once']);
  });
});
