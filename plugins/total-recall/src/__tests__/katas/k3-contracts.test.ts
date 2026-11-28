// K3 — install channels + strict/permissive contracts (course pp. 30–31).
// Sketch: plugins/total-recall/architecture/katas/s1-k3-contracts-channels/adl/contracts-kata.adl. Fitness functions for [K3-01], [K3-02];
// each has a known-pass and a known-fail. Fixtures are synthetic and live under os.tmpdir().
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertTmpPath } from '../assert-tmp-path.js';

const PLUGIN = path.resolve(__dirname, '../../..'); // plugins/total-recall
const REPO = path.resolve(PLUGIN, '../..');

const tmpDirs: string[] = [];
function tmpTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k3-kata-'));
  tmpDirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}
afterAll(() => { for (const d of tmpDirs) { assertTmpPath(d); fs.rmSync(d, { recursive: true, force: true }); } });

// ---- [K3-01] every shape that crosses a version boundary is a declared contract ----
// A boundary exists when its evidence is in the code; it is covered when contracts.adl has a
// DEFINE CONTRACT for it. Evidence is looked up in the code, not in the ADL, so a new boundary
// cannot hide by being left out of the ADL.
interface Boundary { contract: string; file: string; evidence: RegExp }
const BOUNDARIES: Boundary[] = [
  { contract: 'mcp-tools', file: 'src/tools/registry.ts', evidence: /registerTool/ },
  { contract: 'hook-envelope', file: 'hooks/hooks.json', evidence: /hookEventName|SessionStart/ },
  { contract: 'memory-file', file: 'src/frontmatter.ts', evidence: /parseFrontmatter|stringify/i },
  // The org index.json is written by one client version and read by another through the shared org vault.
  { contract: 'org-index', file: 'scripts/sync-org-memory.mjs', evidence: /ORG_INDEX_VERSION/ },
];

function declaredContracts(adlText: string): string[] {
  return [...adlText.matchAll(/^\s*DEFINE CONTRACT\s+(\S+)\s+BETWEEN/gm)].map(m => m[1]!);
}
function undeclaredBoundaries(root: string, adlText: string): string[] {
  const declared = new Set(declaredContracts(adlText));
  return BOUNDARIES
    .filter(b => fs.existsSync(path.join(root, b.file)) && b.evidence.test(fs.readFileSync(path.join(root, b.file), 'utf8')))
    .filter(b => !declared.has(b.contract))
    .map(b => b.contract);
}
const SYNTH_FILES: Record<string, string> = {
  'src/tools/registry.ts': 'export function registerTool() {}\n',
  'hooks/hooks.json': '{"hooks":{"SessionStart":[]}}\n',
  'src/frontmatter.ts': 'export function parseFrontmatter() {}\n',
  'scripts/sync-org-memory.mjs': 'const ORG_INDEX_VERSION = 1;\n',
};
const ADL = (names: string[]) => names.map(n => `DEFINE CONTRACT ${n} BETWEEN {A, B} AS STRICT`).join('\n');

describe('[K3-01] every cross-version boundary is a declared contract', () => {
  it('[K3-01] known-pass: a tree whose ADL declares all four contracts has no gap', () => {
    const root = tmpTree(SYNTH_FILES);
    expect(undeclaredBoundaries(root, ADL(['mcp-tools', 'hook-envelope', 'memory-file', 'org-index']))).toEqual([]);
  });
  it('[K3-01] known-fail: dropping one declaration reports exactly that boundary', () => {
    const root = tmpTree(SYNTH_FILES);
    expect(undeclaredBoundaries(root, ADL(['mcp-tools', 'hook-envelope', 'memory-file']))).toEqual(['org-index']);
  });
  it('[K3-01] known-fail: a boundary with no evidence in the code is not demanded', () => {
    const root = tmpTree({ ...SYNTH_FILES, 'scripts/sync-org-memory.mjs': 'export {};\n' });
    expect(undeclaredBoundaries(root, ADL(['mcp-tools', 'hook-envelope', 'memory-file']))).toEqual([]);
  });
  it('[K3-01] the real contracts.adl declares all four boundaries, org-index included (finding closed)', () => {
    const adl = fs.readFileSync(path.join(PLUGIN, 'architecture/adl/contracts.adl'), 'utf8');
    expect(declaredContracts(adl)).toEqual(['mcp-tools', 'hook-envelope', 'memory-file', 'org-index']);
    // Disposition (done): `org-index` declared in contracts.adl; the version guard is already tested in sync-org-memory tests.
    expect(undeclaredBoundaries(PLUGIN, adl)).toEqual([]);
  });
});

// ---- [K3-02] the npx bootstrap and the marketplace agree on names --------------------
// Old bootstrap versions stay on npm and in `npx` caches the way old tablet apps stay in the field.
// They call `claude plugin marketplace add` and install `total-recall@<marketplace name>`, so the
// marketplace name, the plugin name and the `release` ref are append-only.
function bootstrapNames(cliSrc: string): { marketplace: string | null } {
  const m = /export const MARKETPLACE_NAME\s*=\s*'([^']+)'/.exec(cliSrc);
  return { marketplace: m ? m[1]! : null };
}
function bootstrapMismatches(cliSrc: string, marketplaceJson: string): string[] {
  const problems: string[] = [];
  const mk = JSON.parse(marketplaceJson) as { name: string; plugins: Array<{ name: string; source: { ref?: string } }> };
  const { marketplace } = bootstrapNames(cliSrc);
  if (marketplace !== mk.name) problems.push(`marketplace name: bootstrap says ${marketplace}, marketplace.json says ${mk.name}`);
  if (!mk.plugins.some(p => p.name === 'total-recall')) problems.push('marketplace.json has no plugin named total-recall');
  if (!mk.plugins.every(p => p.source.ref === 'release')) problems.push('a plugin source is not pinned to the release ref');
  return problems;
}
const CLI = "export const MARKETPLACE_NAME = 'my-claude-plugins';\nexport const PLUGIN_ID = `total-recall@${MARKETPLACE_NAME}`;\n";
const MK = (name: string, ref: string, plugin = 'total-recall') =>
  JSON.stringify({ name, plugins: [{ name: plugin, source: { source: 'git-subdir', ref } }] });

describe('[K3-02] bootstrap and marketplace names are append-only', () => {
  it('[K3-02] known-pass: matching names and the release ref give no mismatch', () => {
    expect(bootstrapMismatches(CLI, MK('my-claude-plugins', 'release'))).toEqual([]);
  });
  it('[K3-02] known-fail: a renamed marketplace breaks every old bootstrap', () => {
    expect(bootstrapMismatches(CLI, MK('renamed', 'release'))).toEqual(
      ['marketplace name: bootstrap says my-claude-plugins, marketplace.json says renamed']);
  });
  it('[K3-02] known-fail: a renamed plugin or a moved ref is reported', () => {
    expect(bootstrapMismatches(CLI, MK('my-claude-plugins', 'release', 'tr'))).toEqual(['marketplace.json has no plugin named total-recall']);
    expect(bootstrapMismatches(CLI, MK('my-claude-plugins', 'main'))).toEqual(['a plugin source is not pinned to the release ref']);
  });
  it('[K3-02] known-pass: the real bootstrap and the real marketplace agree', () => {
    const cli = fs.readFileSync(path.join(REPO, 'bin/cli.mjs'), 'utf8');
    const mk = fs.readFileSync(path.join(REPO, '.claude-plugin/marketplace.json'), 'utf8');
    expect(bootstrapNames(cli).marketplace).not.toBeNull();
    expect(bootstrapMismatches(cli, mk)).toEqual([]);
  });
});
