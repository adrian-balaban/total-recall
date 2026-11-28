import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

const ME = os.userInfo().username;

// End-to-end reconciliation and recovery for the org sync (TR-W9, TR-W10),
// against the REAL hook script (queue + worker) and the REAL sync script, with
// a local bare git remote. No network: the remote is a local bare repo, HOME is
// redirected (temp config, gh auth fails closed), and the outage is simulated
// by pointing the org repo's origin at a nonexistent path.
//
// Scenario:
//   1. store org/A through the hook → queued, worker syncs, pushed.
//   2. break the remote (set-url to a nonexistent path).
//   3. store org/B → queued, worker runs the real sync, the push FAILS: the
//      .mjs logs to .sync-errors.log and exits 0, so the job leaves the queue
//      while B's changes stay STAGED (commitAndPush resets --soft).
//   4. heal the remote (restore the URL).
//   5. `sync-org-memory.sh --drain` — a recovery command that needs NO new org
//      write — drains the queue and then commits+pushes the staged changes.
//   6. reconciliation: every local org key exists on the remote exactly once.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HOOK_SH = path.join(REPO_ROOT, 'hooks', 'scripts', 'sync-org-memory.sh');
const DIST_OK =
  fs.existsSync(path.join(REPO_ROOT, 'dist', 'frontmatter.mjs')) &&
  fs.existsSync(path.join(REPO_ROOT, 'dist', 'privacy-filter.mjs')) &&
  fs.existsSync(path.join(REPO_ROOT, 'dist', 'build-index-cache.mjs'));

function has(bin: string): boolean {
  return spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
}
const OK = has('git') && has('node') && has('bash') && DIST_OK;

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Tester',
  GIT_AUTHOR_EMAIL: 'tester@example.com',
  GIT_COMMITTER_NAME: 'Tester',
  GIT_COMMITTER_EMAIL: 'tester@example.com',
  GIT_TERMINAL_PROMPT: '0',
  // The test's "remote" is a local bare repo it operates in directly
  // (symbolic-ref, ls-tree). A user-global `safe.bareRepository=explicit`
  // hardening setting would fail every such call; override it for the test
  // processes only via git's env-config mechanism.
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'safe.bareRepository',
  GIT_CONFIG_VALUE_0: 'all',
};

let tmpHome: string;
let remote: string;
let orgDir: string;    // the git repo toplevel ($HOME/.total-recall/org)
let orgVault: string;  // the vault working tree ($HOME/.total-recall/org/org-vault)
let queueDir: string;  // $HOME/.total-recall/org/.sync-queue

function git(args: string[], opts: { cwd?: string } = {}): string {
  const r = spawnSync('git', args, { encoding: 'utf8', stdio: 'pipe', env: GIT_ENV, ...opts });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr ?? '').trim()}`);
  return (r.stdout ?? '').trim();
}

function hookEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...GIT_ENV, HOME: tmpHome, NODE_BIN: process.execPath };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
}

// Deliver a PostToolUse hook payload for a stored org memory (the shape Claude
// Code actually sends: a raw content array with the tool's JSON return inside).
function runHook(key: string): { stdout: string; stderr: string; status: number | null } {
  const payload = JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__plugin_total-recall_total-recall__store_memory',
    tool_input: { key },
    tool_response: [{ type: 'text', text: JSON.stringify({ key }) }],
  });
  return spawnSync('bash', [HOOK_SH], { encoding: 'utf8', stdio: 'pipe', input: payload, env: hookEnv() });
}

// The recovery command: no stdin, no new org write (TR-W9).
function runDrain(): { stdout: string; stderr: string; status: number | null } {
  return spawnSync('bash', [HOOK_SH, '--drain'], { encoding: 'utf8', stdio: 'pipe', env: hookEnv() });
}

async function waitFor(pred: () => boolean, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pred();
}

function remoteTree(): string[] {
  return git(['ls-tree', '-r', '--name-only', 'knowledge'], { cwd: remote }).split('\n').filter(Boolean);
}

function queuedJobs(): string[] {
  return fs.existsSync(queueDir) ? fs.readdirSync(queueDir).filter((f) => !f.startsWith('.')) : [];
}

function localOrgKeys(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.isFile() && e.name.endsWith('.md')) out.push(path.relative(orgVault, path.join(dir, e.name)));
    }
  };
  walk(orgVault);
  return out.sort();
}

// The remote stores `org-vault/<key>.md`; map back to org keys (`org/<key>`).
function remoteOrgKeys(): string[] {
  return remoteTree()
    .filter((p) => p.startsWith('org-vault/') && p.endsWith('.md'))
    .map((p) => 'org/' + p.slice('org-vault/'.length, -'.md'.length))
    .sort();
}

function writeOrgMemory(relKey: string, title: string): void {
  const p = path.join(orgVault, `${relKey}.md`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(
    p,
    `---\ntitle: ${JSON.stringify(title)}\ntags: [org]\nauthor: ${JSON.stringify(ME)}\ncreated: ${now}\nupdated: ${now}\nschemaVersion: 1\n---\n## Executive Summary\n\nReconciliation fixture for ${relKey}.\n`,
  );
}

const suite = OK ? describe : describe.skip;

suite('org sync reconciliation and recovery (TR-W9, TR-W10, TR-D14)', () => {
  beforeAll(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-reconcile-'));
    remote = path.join(tmpHome, 'remote.git');
    orgDir = path.join(tmpHome, '.total-recall', 'org');
    orgVault = path.join(orgDir, 'org-vault');
    queueDir = path.join(orgDir, '.sync-queue');

    // Bare remote whose default branch is `knowledge` (the user's setup).
    git(['init', '--bare', remote]);
    git(['symbolic-ref', 'HEAD', 'refs/heads/knowledge'], { cwd: remote });

    // Local org repo on `knowledge`, with org-vault/ as a SUBDIR of the repo
    // toplevel — the same layout the existing sync e2e fixtures use.
    fs.mkdirSync(orgDir, { recursive: true });
    git(['init', orgDir]);
    git(['symbolic-ref', 'HEAD', 'refs/heads/knowledge'], { cwd: orgDir });
    git(['remote', 'add', 'origin', remote], { cwd: orgDir });
    git(['commit', '--allow-empty', '-m', 'init'], { cwd: orgDir });
    git(['push', '-u', 'origin', 'knowledge'], { cwd: orgDir });

    fs.writeFileSync(path.join(tmpHome, '.total-recall', 'config.json'), JSON.stringify({ orgRepo: remote }));
  }, 30000);

  afterAll(() => {
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('[TR-W9] retries pending org sync work via a drain that needs no new org write', async () => {
    // 1. A healthy sync first: org/architecture/reconcile-a reaches the remote.
    writeOrgMemory('architecture/reconcile-a', 'Reconcile A');
    const rA = runHook('org/architecture/reconcile-a');
    expect(rA.status).toBe(0);
    expect(rA.stdout.trim()).toBe('{"continue":true}');
    expect(await waitFor(() => remoteTree().includes('org-vault/architecture/reconcile-a.md'))).toBe(true);

    // 2. Break the remote.
    git(['remote', 'set-url', 'origin', '/nonexistent-reconcile-remote'], { cwd: orgDir });

    // 3. A second org write: enqueued, the worker runs the real sync, the push
    //    fails — the .mjs logs and exits 0 (so the job leaves the queue) while
    //    B's changes stay staged for the next successful sync.
    writeOrgMemory('architecture/reconcile-b', 'Reconcile B');
    const rB = runHook('org/architecture/reconcile-b');
    expect(rB.status).toBe(0);
    expect(rB.stdout.trim()).toBe('{"continue":true}');
    const errorsLog = path.join(tmpHome, '.total-recall', 'org', '.sync-errors.log');
    expect(await waitFor(() => fs.existsSync(errorsLog))).toBe(true);
    expect(await waitFor(() => git(['diff', '--cached', '--name-only'], { cwd: orgDir }).includes('org-vault/architecture/reconcile-b.md'))).toBe(true);
    expect(queuedJobs()).toEqual([]);

    // 4. Heal the remote.
    git(['remote', 'set-url', 'origin', remote], { cwd: orgDir });

    // 5. Drain: a recovery command, not an org write. The staged changes are
    //    committed and pushed; the queue is (and stays) empty.
    const rd = runDrain();
    expect(rd.status).toBe(0);
    expect(await waitFor(() => remoteTree().includes('org-vault/architecture/reconcile-b.md'))).toBe(true);
    expect(queuedJobs()).toEqual([]);
    expect(git(['diff', '--cached', '--name-only'], { cwd: orgDir })).toBe('');
  }, 60000);

  it('[TR-W10] after the queue drains, every local org key exists on the remote exactly once', () => {
    const local = localOrgKeys(); // e.g. `architecture/reconcile-a.md` → key org/architecture/reconcile-a
    const remoteKeys = remoteOrgKeys();
    // Set equality: nothing lost, nothing extra, no impersonation.
    expect(remoteKeys).toEqual(local.map((rel) => 'org/' + rel.replace(/\.md$/, '')));
    // Exactly once: pin the per-key count (git paths are unique by construction,
    // so this guards the mapping, not git).
    const counts = new Map<string, number>();
    for (const k of remoteKeys) counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const k of remoteKeys) expect(counts.get(k)).toBe(1);
    // And the org index reached the remote too.
    expect(remoteTree()).toContain('org-vault/index.json');
  }, 30000);

  it('[TR-D14] journal entries and .superseded archives never enter an org sync', async () => {
    // Personal provenance lives in the Personal Vault (a sibling of the org repo), so it
    // must never reach the shared remote tree even when a sync runs beside it.
    const personal = path.join(tmpHome, '.total-recall', 'personal-vault');
    const today = new Date().toISOString().slice(0, 10);
    fs.mkdirSync(path.join(personal, 'journal'), { recursive: true });
    fs.writeFileSync(path.join(personal, 'journal', `${today}.md`), 'journal fixture\n');
    fs.mkdirSync(path.join(personal, '.superseded', 'architecture'), { recursive: true });
    fs.writeFileSync(path.join(personal, '.superseded', 'architecture', 'fixture.123.md'), 'superseded fixture\n');

    writeOrgMemory('architecture/reconcile-d14', 'Reconcile D14');
    const r = runHook('org/architecture/reconcile-d14');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"continue":true}');
    expect(await waitFor(() => remoteTree().includes('org-vault/architecture/reconcile-d14.md'))).toBe(true);

    const tree = remoteTree();
    expect(tree.some((p) => p.includes('journal/') || p.includes('.superseded/'))).toBe(false);
  }, 60000);
}, 120000);