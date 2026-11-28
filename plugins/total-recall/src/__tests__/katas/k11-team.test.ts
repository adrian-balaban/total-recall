// K11 — the human + agent team (course pp. 47–50, 69–74): the written instructions and the governance
// register are what a new contributor, human or agent, acts on. Sketch: plugins/total-recall/architecture/katas/s3-k11-team/adl/team-kata.adl.
// Fitness functions for [K11-01]..[K11-03]; each has a known-pass and a known-fail. Fixtures are
// synthetic and live under os.tmpdir(). The checks that cannot be made deterministic (is the rule
// still right? does the prose say what the code does?) stay interactive reviews (checklist §9), see answers.md.
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertTmpPath } from '../assert-tmp-path.js';

const PLUGIN = path.resolve(__dirname, '../../..'); // plugins/total-recall
const REPO = path.resolve(PLUGIN, '../..');

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k11-kata-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => { for (const d of tmpDirs) { assertTmpPath(d); fs.rmSync(d, { recursive: true, force: true }); } });
const read = (base: string, rel: string) => fs.readFileSync(path.join(base, rel), 'utf8');

// ---- [K11-01] the instructions point at things that exist ------------------------------------------
// CLAUDE.md, GOVERNANCE.md, REVIEW.md and ARCHITECTURE.md are what an agent reads before it changes
// anything. A named test file or a TR-* ID that no longer exists sends it to a rule that is gone.
// A line that says the ID is pending, proposed or a candidate may name one that does not exist yet.
function taggedIds(adlTexts: string[]): Set<string> {
  const ids = new Set<string>();
  for (const t of adlTexts) for (const m of t.matchAll(/\[(TR-[A-Z]\d+)\]/g)) ids.add(m[1]!);
  return ids;
}
function staleIds(doc: string, known: Set<string>): string[] {
  const out: string[] = [];
  for (const line of doc.split('\n')) {
    if (/pending|proposed|candidate|future/i.test(line)) continue;
    for (const m of line.matchAll(/TR-[A-Z]\d+/g)) if (!known.has(m[0])) out.push(m[0]);
  }
  return [...new Set(out)];
}
function staleTestFiles(doc: string, existing: string[]): string[] {
  return [...new Set(doc.match(/[A-Za-z0-9_.-]+\.test\.ts/g) ?? [])].filter(f => !existing.includes(f));
}
function listTests(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(path.join(d, e.name)); }
      else if (e.name.endsWith('.test.ts')) out.push(e.name);
    }
  };
  walk(dir);
  return out;
}

describe('[K11-01] the written instructions point at things that exist', () => {
  const known = new Set(['TR-S1', 'TR-Q4']);
  it('[K11-01] known-pass: existing IDs and files, and a pending ID on a line that says so', () => {
    expect(staleIds('See TR-S1 and TR-Q4. TR-P6 pending.\n', known)).toEqual([]);
    expect(staleTestFiles('Pinned by `index.test.ts`.\n', ['index.test.ts'])).toEqual([]);
  });
  it('[K11-01] known-fail: a removed ID and a removed test file are named', () => {
    expect(staleIds('Guarded by TR-Z9 and TR-S1.\n', known)).toEqual(['TR-Z9']);
    expect(staleTestFiles('Pinned by `gone.test.ts` and `index.test.ts`.\n', ['index.test.ts'])).toEqual(['gone.test.ts']);
  });
  it('[K11-01] known-pass: on the real docs nothing is stale', () => {
    const adlDir = path.join(PLUGIN, 'architecture/adl');
    const ids = taggedIds(fs.readdirSync(adlDir).filter(f => f.endsWith('.adl')).map(f => read(adlDir, f)));
    const tests = listTests(path.join(PLUGIN, "src/__tests__"));
    expect(ids.size).toBeGreaterThan(60); // the IDs were really read
    for (const doc of ['CLAUDE.md', 'architecture/GOVERNANCE.md', 'architecture/REVIEW.md', 'ARCHITECTURE.md']) {
      expect([doc, staleIds(read(PLUGIN, doc), ids)]).toEqual([doc, []]);
    }
    const claude = read(PLUGIN, 'CLAUDE.md');
    expect((claude.match(/\.test\.ts/g) ?? []).length).toBeGreaterThan(10); // the pointers exist to be checked
    expect(staleTestFiles(claude, tests)).toEqual([]);
  });
});

// ---- [K11-02] every ADL file has an owner row in the governance register -------------------------------
// GOVERNANCE.md §1 says, per ADL file, who owns it and what happens when it fails. A new ADL file with
// no row is a rule with no owner. The check pairs the files with the rows, both ways.
function registerGaps(adlFiles: string[], governance: string): string[] {
  const out: string[] = [];
  for (const f of adlFiles) if (!new RegExp(`\`${f.replace('.', '\\.')}\``).test(governance)) out.push(`${f}: no row`);
  const rows = [...governance.matchAll(/^\|\s*`([\w-]+\.adl)`/gm)].map(m => m[1]!);
  for (const r of rows) if (!adlFiles.includes(r)) out.push(`${r}: row for a file that is gone`);
  return out;
}
const GOV = '| `a.adl` (`TR-A*`) | maintainer |\n| `b.adl` (stressors) | maintainer |\n';

describe('[K11-02] every ADL file has an owner row in the governance register', () => {
  it('[K11-02] known-pass: files and rows agree', () => {
    expect(registerGaps(['a.adl', 'b.adl'], GOV)).toEqual([]);
  });
  it('[K11-02] known-fail: a file with no row, and a row for a removed file, are named', () => {
    expect(registerGaps(['a.adl', 'b.adl', 'c.adl'], GOV)).toEqual(['c.adl: no row']);
    expect(registerGaps(['a.adl'], GOV)).toEqual(['b.adl: row for a file that is gone']);
  });
  it('[K11-02] known-pass: on the real tree every production ADL file has a row', () => {
    const files = fs.readdirSync(path.join(PLUGIN, 'architecture/adl')).filter(f => f.endsWith('.adl'));
    expect(files.length).toBe(10);
    expect(registerGaps(files, read(PLUGIN, 'architecture/GOVERNANCE.md'))).toEqual([]);
  });
});

// ---- [K11-03] commit history as governance ---------------------------------------------------------------
// A commit that changes an ADL file should carry its evidence: a test, or a governance, review or backlog
// record. The history is the audit trail of the team, human and agent alike. Checked on a synthetic
// repository; on the real one only when the clone is not shallow (CI checks out one commit).
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=k', '-c', 'user.email=k@k', '-c', 'commit.gpgsign=false', ...args], { cwd, env: GIT_ENV, encoding: 'utf8' });
const EVIDENCE = /__tests__\/|REVIEW\.md|GOVERNANCE\.md|BACKLOG\.md/;

function adlCommitsWithoutEvidence(repo: string, adlDir: string): string[] {
  const shas = git(repo, 'log', '--format=%H', '--', adlDir).split('\n').filter(Boolean);
  return shas
    .filter(sha => !git(repo, 'show', '--name-only', '--format=', '-m', '--first-parent', sha).split('\n').some(f => EVIDENCE.test(f)))
    .map(sha => git(repo, 'log', '-1', '--format=%s', sha).trim());
}
function commitFiles(repo: string, files: Record<string, string>, message: string) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
}
const isShallow = () => git(REPO, 'rev-parse', '--is-shallow-repository').trim() === 'true';

describe('[K11-03] a commit that changes an ADL file carries its evidence', () => {
  it('[K11-03] known-pass: an ADL change with a test in the same commit has evidence', () => {
    const repo = tmpDir(); git(repo, 'init', '-q');
    commitFiles(repo, { 'architecture/adl/a.adl': 'ASSERT(x) # [ZZ-A1]\n', 'src/__tests__/a.test.ts': 'it("covers the rule")\n' }, 'add rule with its test');
    expect(adlCommitsWithoutEvidence(repo, 'architecture/adl')).toEqual([]);
  });
  it('[K11-03] known-fail: an ADL change with no test or governance record is named by its subject', () => {
    const repo = tmpDir(); git(repo, 'init', '-q');
    commitFiles(repo, { 'architecture/adl/a.adl': 'ASSERT(x) # [ZZ-A1]\n', 'src/__tests__/a.test.ts': 'it("covers the rule")\n' }, 'add rule with its test');
    commitFiles(repo, { 'architecture/adl/a.adl': 'ASSERT(x, y) # [ZZ-A1]\n' }, 'loosen the rule quietly');
    expect(adlCommitsWithoutEvidence(repo, 'architecture/adl')).toEqual(['loosen the rule quietly']);
  });
  it('[K11-03] known-pass: a governance record in the same commit counts as evidence', () => {
    const repo = tmpDir(); git(repo, 'init', '-q');
    commitFiles(repo, { 'architecture/adl/a.adl': 'x\n', 'architecture/REVIEW.md': 'reviewed\n' }, 'revise ADL with review record');
    expect(adlCommitsWithoutEvidence(repo, 'architecture/adl')).toEqual([]);
  });
  it.skipIf(isShallow())('[K11-03] on the real history the only ADL commit without evidence is the early docs one (pinned)', () => {
    const dir = 'plugins/total-recall/architecture/adl';
    expect(adlCommitsWithoutEvidence(REPO, dir)).toEqual(
      ['docs: add descriptive architecture-style ADL and loadtest targets (PR 3 of ADL expansion) (#9)']);
  });
});
