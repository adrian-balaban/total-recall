// K4 — repo topology and shared code (course pp. 26–27).
// Sketch: katas/s1-k4-repo-topology/adl/repo-topology-kata.adl. Fitness functions for [K4-01], [K4-02];
// each has a known-pass and a known-fail. Fixtures are synthetic and live under os.tmpdir().
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertTmpPath } from '../assert-tmp-path.js';

const PLUGIN = path.resolve(__dirname, '../../..'); // plugins/total-recall
const REPO = path.resolve(PLUGIN, '../..');

const tmpDirs: string[] = [];
function tmpTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k4-kata-'));
  tmpDirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}
afterAll(() => { for (const d of tmpDirs) { assertTmpPath(d); fs.rmSync(d, { recursive: true, force: true }); } });

// ---- [K4-01] the release strip list is an inventory, not a list of known names ----------------
// release.yml publishes main's tree to the `release` branch after `git rm`-ing the contributor-only
// paths. That is the course's EXPLICIT restriction (Task 1): it only covers paths someone named, so
// a new contributor-only file ships by default. The IMPLICIT form (Task 2) classifies by pattern:
// anything that looks contributor-only must be on the strip list.
const CONTRIBUTOR_ONLY: RegExp[] = [
  /^\.github\/workflows\//,
  /^plugins\/total-recall\/vitest[\w.-]*\.config\.ts$/,
  /^plugins\/total-recall\/stryker[\w.-]*\.json$/,
  /(^|\/)__tests__\//,
  /^katas\//,
];

function stripList(releaseYml: string): string[] {
  const lines = releaseYml.split('\n');
  const start = lines.findIndex(l => /git rm -r -q --ignore-unmatch --\s*\\\s*$/.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    out.push(lines[i]!.replace(/\\\s*$/, '').trim());
    if (!/\\\s*$/.test(lines[i]!)) break; // the last path has no trailing backslash
  }
  return out.filter(Boolean);
}
const isStripped = (file: string, strip: string[]) => strip.some(s => file === s || file.startsWith(s + '/'));
function shippedContributorFiles(tracked: string[], strip: string[]): string[] {
  return tracked.filter(f => CONTRIBUTOR_ONLY.some(re => re.test(f)) && !isStripped(f, strip));
}

const RELEASE_YML = `      - run: |
          git rm -r -q --ignore-unmatch -- \\
            .github/workflows \\
            plugins/total-recall/src/__tests__ \\
            plugins/total-recall/vitest.config.ts \\
            plugins/total-recall/scripts/eval
          git add -f plugins/total-recall/dist
`;

describe('[K4-01] every contributor-only file is on the release strip list', () => {
  it('[K4-01] known-pass: the strip list is read from release.yml, in order', () => {
    expect(stripList(RELEASE_YML)).toEqual([
      '.github/workflows', 'plugins/total-recall/src/__tests__', 'plugins/total-recall/vitest.config.ts', 'plugins/total-recall/scripts/eval']);
  });
  it('[K4-01] known-pass: named paths and everything under a stripped directory are covered', () => {
    const tracked = ['.github/workflows/mutation.yml', 'plugins/total-recall/vitest.config.ts', 'plugins/total-recall/src/__tests__/a.test.ts', 'plugins/total-recall/src/server.ts'];
    expect(shippedContributorFiles(tracked, stripList(RELEASE_YML))).toEqual([]);
  });
  it('[K4-01] known-fail: a new vitest config nobody named would ship, and so would katas/', () => {
    const tracked = ['plugins/total-recall/vitest.katas.config.ts', 'katas/s1-k1/answers.md', 'plugins/total-recall/vitest.config.ts'];
    expect(shippedContributorFiles(tracked, stripList(RELEASE_YML))).toEqual(
      ['plugins/total-recall/vitest.katas.config.ts', 'katas/s1-k1/answers.md']);
  });
  it('[K4-01] known-fail: an empty or unparsable strip list makes every contributor file ship', () => {
    expect(stripList('name: release\n')).toEqual([]);
    expect(shippedContributorFiles(['plugins/total-recall/stryker.conf.json'], [])).toEqual(['plugins/total-recall/stryker.conf.json']);
  });
  it('[K4-01] known-pass: on the real tree no contributor-only file ships', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
    const strip = stripList(fs.readFileSync(path.join(REPO, '.github/workflows/release.yml'), 'utf8'));
    expect(strip.length).toBeGreaterThan(0); // not vacuous: the list was really read
    expect(shippedContributorFiles(tracked, strip)).toEqual([]);
  });
});

// ---- [K4-02] duplicated version declarations are one inventory, all equal --------------------
// The version is duplicated on purpose (Claude manifest, Gemini manifest, npx bootstrap) and made
// safe by one source (plugin package.json) plus sync-version.mjs. TR-Q3 guards two of the three
// copies; the npx bootstrap, which is published to npm, was guarded only by a CI build step.
const MANIFESTS = ['package.json', 'plugins/total-recall/.claude-plugin/plugin.json', 'plugins/total-recall/gemini-extension.json'];
const SOURCE = 'plugins/total-recall/package.json';

function versionDrift(root: string): string[] {
  const version = (rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')).version as string;
  const want = version(SOURCE);
  return MANIFESTS.filter(m => version(m) !== want).map(m => `${m}: ${version(m)} != ${want}`);
}
function unsyncedManifests(syncScript: string): string[] {
  return MANIFESTS.filter(m => !syncScript.includes(path.basename(m)));
}
const manifestTree = (rootV: string) => ({
  'package.json': JSON.stringify({ version: rootV }),
  'plugins/total-recall/package.json': JSON.stringify({ version: '1.10.0' }),
  'plugins/total-recall/.claude-plugin/plugin.json': JSON.stringify({ version: '1.10.0' }),
  'plugins/total-recall/gemini-extension.json': JSON.stringify({ version: '1.10.0' }),
});

describe('[K4-02] every duplicated version declaration equals the single source', () => {
  it('[K4-02] known-pass: four equal versions give no drift', () => {
    expect(versionDrift(tmpTree(manifestTree('1.10.0')))).toEqual([]);
  });
  it('[K4-02] known-fail: a drifted npx bootstrap is reported by name', () => {
    expect(versionDrift(tmpTree(manifestTree('1.9.0')))).toEqual(['package.json: 1.9.0 != 1.10.0']);
  });
  it('[K4-02] known-fail: a manifest the sync script does not name is reported', () => {
    expect(unsyncedManifests("path.join(root, '.claude-plugin', 'plugin.json'), 'gemini-extension.json'")).toEqual(['package.json']);
  });
  it('[K4-02] known-pass: on the real tree there is no drift and the sync script names every copy', () => {
    expect(versionDrift(REPO)).toEqual([]);
    const sync = fs.readFileSync(path.join(PLUGIN, 'scripts/sync-version.mjs'), 'utf8');
    expect(unsyncedManifests(sync)).toEqual([]);
  });
});
