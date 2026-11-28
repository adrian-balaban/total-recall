// K7 — quanta and coupling (course pp. 40–43): which processes are separate quanta, and are all the
// couplings between them declared? Sketch: katas/s2-k7-quanta-coupling/adl/quanta-kata.adl.
// Fitness functions for [K7-01], [K7-02]; each has a known-pass and a known-fail.
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertTmpPath } from '../assert-tmp-path.js';

const PLUGIN = path.resolve(__dirname, '../../..'); // plugins/total-recall

const tmpDirs: string[] = [];
function tmpTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k7-kata-'));
  tmpDirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}
afterAll(() => { for (const d of tmpDirs) { assertTmpPath(d); fs.rmSync(d, { recursive: true, force: true }); } });

// ---- reading system.adl -----------------------------------------------------------------------
interface Edge { from: string; to: string; id: string; edge: 'sync' | 'async' | null }
function readEdges(adl: string): Edge[] {
  const edges: Edge[] = [];
  let label: 'sync' | 'async' | null = null;
  for (const line of adl.split('\n')) {
    const e = /^\s*# edge: (sync|async)\b/.exec(line);
    if (e) { label = e[1] as 'sync' | 'async'; continue; }
    const c = /^\s*DEFINE COMMUNICATION (.+?) TO (.+?) AS (\S+)\s*$/.exec(line);
    if (c) { edges.push({ from: c[1]!, to: c[2]!, id: c[3]!, edge: label }); label = null; }
  }
  return edges;
}
const externals = (adl: string) => [...adl.matchAll(/^\s*DEFINE EXTERNAL (.+?) AS \S+\s*$/gm)].map(m => m[1]!);

// ---- [K7-01] every cross-quantum coupling found in code is a declared communication ------------
// Quanta (system.adl): server = {MCP server, embedder}, hooks = separate short-lived processes, remote.
// Static coupling across them is restricted (TR-S13, TR-S14, TR-R5). The dynamic couplings are the
// ones that carry no import: a marker file one process drops for another, a signal one sends to
// another. Evidence is read from the hook scripts, so a new coupling cannot hide by being left out of the ADL.
interface Coupling { from: string; to: string; file: string; evidence: RegExp }
const COUPLINGS: Coupling[] = [
  { from: 'Lifecycle Hooks', to: 'MCP Stdio Server', file: 'hooks/scripts/pull-org-vault.sh', evidence: /\.reconcile-requested/ },
  { from: 'Lifecycle Hooks', to: 'MCP Stdio Server', file: 'hooks/scripts/store-learning.mjs', evidence: /\.reconcile-requested/ },
  { from: 'Lifecycle Hooks', to: 'MCP Stdio Server', file: 'hooks/scripts/session-end.sh', evidence: /SIGTERM/ },
];
function undeclaredCouplings(base: string, adl: string): string[] {
  const declared = new Set(readEdges(adl).map(e => `${e.from} TO ${e.to}`));
  const missing = COUPLINGS
    .filter(c => fs.existsSync(path.join(base, c.file)) && c.evidence.test(fs.readFileSync(path.join(base, c.file), 'utf8')))
    .map(c => `${c.from} TO ${c.to}`)
    .filter(pair => !declared.has(pair));
  return [...new Set(missing)];
}

const HOOK_FILES: Record<string, string> = {
  'hooks/scripts/pull-org-vault.sh': 'touch "$HOME/.total-recall/.reconcile-requested"\n',
  'hooks/scripts/store-learning.mjs': "const marker = path.join(h, '.reconcile-requested');\n",
  'hooks/scripts/session-end.sh': 'kill -TERM "$pid" # SIGTERM to the MCP child\n',
};
const ADL_WITH = '# edge: async\nDEFINE COMMUNICATION Lifecycle Hooks TO MCP Stdio Server AS marker\n';
const ADL_WITHOUT = '# edge: sync\nDEFINE COMMUNICATION Host Harness TO MCP Stdio Server AS stdio\n';

describe('[K7-01] every cross-quantum coupling in the hook scripts is a declared communication', () => {
  it('[K7-01] known-pass: a declared hooks-to-server communication covers marker files and the signal', () => {
    expect(undeclaredCouplings(tmpTree(HOOK_FILES), ADL_WITH)).toEqual([]);
  });
  it('[K7-01] known-fail: the same hooks without the declaration report the pair once', () => {
    expect(undeclaredCouplings(tmpTree(HOOK_FILES), ADL_WITHOUT)).toEqual(['Lifecycle Hooks TO MCP Stdio Server']);
  });
  it('[K7-01] known-pass: a coupling with no evidence in the code is not demanded', () => {
    expect(undeclaredCouplings(tmpTree({ 'hooks/scripts/session-end.sh': 'echo done\n' }), ADL_WITHOUT)).toEqual([]);
  });
  it('[K7-01] the real system.adl: the hooks-to-server coupling is the one undeclared edge (finding, pinned)', () => {
    const adl = fs.readFileSync(path.join(PLUGIN, 'architecture/adl/system.adl'), 'utf8');
    expect(readEdges(adl).length).toBeGreaterThanOrEqual(9); // the edges were really read
    // Disposition: declare `Lifecycle Hooks TO MCP Stdio Server` (async, marker file and SIGTERM) at K12.
    expect(undeclaredCouplings(PLUGIN, adl)).toEqual(['Lifecycle Hooks TO MCP Stdio Server']);
  });
});

// ---- [K7-02] nothing is synchronous across the external boundary --------------------------------
// Course Task 3 (pp. 42–43): the link to the slow, unreliable party is asynchronous, and an
// assertion keeps agents to it. The only external is the org git remote.
const syncToExternal = (adl: string) => {
  const ext = new Set(externals(adl));
  return readEdges(adl).filter(e => ext.has(e.to) && e.edge !== 'async').map(e => e.id);
};
const EXT = 'DEFINE EXTERNAL Org Git Remote AS org-remote\n';

describe('[K7-02] edges to an external party are asynchronous', () => {
  it('[K7-02] known-pass: an async edge to the external is fine', () => {
    expect(syncToExternal(`${EXT}# edge: async\nDEFINE COMMUNICATION Org Vault TO Org Git Remote AS git-tls\n`)).toEqual([]);
  });
  it('[K7-02] known-fail: a sync edge, or an unlabelled one, to the external is named', () => {
    expect(syncToExternal(`${EXT}# edge: sync\nDEFINE COMMUNICATION Org Vault TO Org Git Remote AS git-tls\n`)).toEqual(['git-tls']);
    expect(syncToExternal(`${EXT}DEFINE COMMUNICATION Org Vault TO Org Git Remote AS unlabelled\n`)).toEqual(['unlabelled']);
  });
  it('[K7-02] known-pass: on the real system.adl the external exists and every edge to it is async', () => {
    const adl = fs.readFileSync(path.join(PLUGIN, 'architecture/adl/system.adl'), 'utf8');
    expect(externals(adl)).toEqual(['Org Git Remote']); // not vacuous: there is an external to check
    expect(readEdges(adl).some(e => e.to === 'Org Git Remote')).toBe(true);
    expect(syncToExternal(adl)).toEqual([]);
  });
});
