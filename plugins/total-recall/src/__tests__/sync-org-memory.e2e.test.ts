import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

const ME = os.userInfo().username;

// End-to-end test of scripts/sync-org-memory.mjs against a real (local, bare) git
// remote. Proves the #1 fix — org sync actually commits+pushes the file already on
// disk in the org-vault working tree — plus the delete, skip, and privacy-block
// paths. No network: the remote is a local bare repo; HOME is redirected so the
// script reads a temp config and `gh auth token` fails closed (no real token touched).

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-org-memory.mjs');

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Tester',
  GIT_AUTHOR_EMAIL: 'tester@example.com',
  GIT_COMMITTER_NAME: 'Tester',
  GIT_COMMITTER_EMAIL: 'tester@example.com',
  GIT_TERMINAL_PROMPT: '0',
};

function has(bin: string): boolean {
  return spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
}
const OK = has('git') && has('node');

// Symlinks are needed to plant the teammate-push vector (git pull preserves
// symlinks). Linux/macOS always allow them; on a FS that doesn't, skip the
// symlink test rather than fail it on a capability it can't exercise.
const CAN_SYMLINK = (() => {
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-sym-'));
    fs.symlinkSync('nonexistent-target', path.join(d, 'link'));
    fs.rmSync(d, { recursive: true, force: true });
    return true;
  } catch { return false; }
})();

let tmpHome: string;
let remote: string;
let orgDir: string;
let orgVault: string;
let prevHome: string | undefined;

function git(args: string[], opts: { cwd?: string } = {}): string {
  const r = spawnSync('git', args, { encoding: 'utf8', stdio: 'pipe', env: GIT_ENV, ...opts });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr ?? '').trim()}`);
  return (r.stdout ?? '').trim();
}

function writeMkdir(p: string, contents: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contents);
}

function runMjs(key: string, extra: string[] = []): { stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...GIT_ENV, HOME: tmpHome };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  const r = spawnSync('node', [SCRIPT, key, ...extra], { encoding: 'utf8', stdio: 'pipe', env });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function remoteTree(): string[] {
  return git(['ls-tree', '-r', '--name-only', 'org-vault'], { cwd: remote }).split('\n').filter(Boolean);
}

function writeOrgMemory(relKey: string, fm: Record<string, unknown>, body: string) {
  const fmLines = Object.entries(fm)
    .map(([k, v]) => (Array.isArray(v) ? `${k}: [${(v as unknown[]).join(', ')}]` : `${k}: ${JSON.stringify(v)}`))
    .join('\n');
  writeMkdir(path.join(orgVault, `${relKey}.md`), `---\n${fmLines}\n---\n${body}`);
}

const suite = OK ? describe : describe.skip;

suite('sync-org-memory.mjs end-to-end (#1: org sync actually commits+pushes)', () => {
  beforeAll(() => {
    prevHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-e2e-'));
    remote = path.join(tmpHome, 'remote.git');
    orgDir = path.join(tmpHome, '.total-recall', 'org');
    orgVault = path.join(orgDir, 'org-vault');

    // Bare remote whose default branch is org-vault.
    git(['init', '--bare', remote]);
    git(['symbolic-ref', 'HEAD', 'refs/heads/org-vault'], { cwd: remote });

    // Local org-vault repo on org-vault with an initial commit, pointing at the remote
    // so the script's `git pull --ff-only` / `git push` have somewhere to go.
    fs.mkdirSync(orgDir, { recursive: true });
    git(['init', orgDir]);
    git(['symbolic-ref', 'HEAD', 'refs/heads/org-vault'], { cwd: orgDir });
    git(['remote', 'add', 'origin', remote], { cwd: orgDir });
    git(['commit', '--allow-empty', '-m', 'init'], { cwd: orgDir });
    git(['push', '-u', 'origin', 'org-vault'], { cwd: orgDir });

    // config.json points orgRepo at the bare remote (no allowedEmailDomains → fail-closed).
    writeMkdir(path.join(tmpHome, '.total-recall', 'config.json'), JSON.stringify({ orgRepo: remote }));
  }, 30000);

  afterAll(() => {
    process.env.HOME = prevHome;
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('commits and pushes an org-tagged memory to the remote', () => {
    const key = 'org/architecture/flink-cdc';
    writeOrgMemory('architecture/flink-cdc', { title: 'Flink CDC Pipeline', tags: ['org', 'architecture'], author: 'tester', importanceScore: 0.7 }, '## Executive Summary\n\nOutbox + CDC pattern via Flink.\n');
    runMjs(key);
    const tree = remoteTree();
    expect(tree).toContain('org-vault/architecture/flink-cdc.md');
    expect(tree).toContain('org-vault/index.json');
  });

  it('removes a memory from the remote when invoked with --delete', () => {
    const key = 'org/decisions/adopt-kafka';
    // Author must match the local OS user or the delete guard refuses authorship.
    writeOrgMemory('decisions/adopt-kafka', { title: 'Adopt Kafka', tags: ['org'], author: ME }, '## Executive Summary\n\nUse Kafka for the event bus.\n');
    runMjs(key);
    expect(remoteTree()).toContain('org-vault/decisions/adopt-kafka.md');
    runMjs(key, ['--delete']);
    expect(remoteTree()).not.toContain('org-vault/decisions/adopt-kafka.md');
  });

  it('skips (does not push) a memory that is not tagged org', () => {
    const key = 'org/architecture/not-org-tagged';
    writeOrgMemory('architecture/not-org-tagged', { title: 'Internal Notes', tags: ['team'], author: 'tester' }, '## Executive Summary\n\nSome notes.\n');
    const res = runMjs(key);
    expect(res.stdout).toContain('not tagged org');
    expect(remoteTree()).not.toContain('org-vault/architecture/not-org-tagged.md');
  });

  it('blocks (does not push) a memory containing a non-allowlisted email', () => {
    const key = 'org/architecture/leaky';
    writeOrgMemory('architecture/leaky', { title: 'Leaky Doc', tags: ['org'], author: 'tester' }, '## Executive Summary\n\nContact user@gmail.com for access.\n');
    const res = runMjs(key);
    expect(res.stderr).toContain('Privacy filter blocked');
    expect(remoteTree()).not.toContain('org-vault/architecture/leaky.md');
  });

  it('syncs a memory whose org tag is in a block-sequence array (older/hand-edited frontmatter)', () => {
    // frontmatter.ts always writes arrays INLINE, so block arrays only appear in older or
    // hand-edited files. matterParse must still extract the `org` tag from
    //   tags:
    //     - org
    //     - architecture
    // or the sync silently no-ops ("not tagged org"). This pins the .cjs parser directly
    // (the replica unit test pins the copy) so the two cannot silently diverge.
    const key = 'org/architecture/block-tags';
    const body = '## Executive Summary\n\nBlock-array frontmatter doc.\n';
    const file = path.join(orgVault, 'architecture/block-tags.md');
    writeMkdir(file, `---\ntitle: Block Array Doc\ntags:\n  - org\n  - architecture\nauthor: tester\n---\n${body}`);
    runMjs(key);
    expect(remoteTree()).toContain('org-vault/architecture/block-tags.md');
  });

  // Pass 2 fix #4: a teammate with push access plants a symlink `architecture/leak.md`
  // → an outside file in the shared org vault; git pull preserves it. The PostToolUse
  // sync fires (even on a failed store_memory over that key), readFileSync follows the
  // link, and — if the victim is org-tagged with an inert body — privacyCheck passes
  // and updateOrgIndex commits contentPreview (the target's first 500 chars) into the
  // shared org index.json: an arbitrary-file leak to every teammate. The orgFileIsSafe
  // lstat+realpath guard must reject the symlink BEFORE readFileSync. The victim is
  // deliberately org-tagged + inert: a non-org victim would be caught by the not-tagged-
  // org check first (no leak even without the guard) → a false-positive test.
  const symTest = CAN_SYMLINK ? it : it.skip;
  symTest('rejects a symlinked org file planted in the shared vault (no contentPreview leak)', () => {
    const SENTINEL = 'tr-symlink-leak-sentinel-7Q2X-no-real-secrets';
    // Victim: an OUTSIDE file (not under orgVault), org-tagged, inert body (no
    // secret/email/phone/pronoun) so privacyCheck would pass without the guard.
    const victimPath = path.join(tmpHome, 'stolen.md');
    writeMkdir(victimPath, `---\ntitle: Stolen Doc\ntags: [org]\nauthor: tester\n---\n## Executive Summary\n\n${SENTINEL} plain body.\n`);
    // Plant the symlink inside the org vault pointing at the outside victim.
    const linkPath = path.join(orgVault, 'architecture/leak.md');
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(victimPath, linkPath);

    const res = runMjs('org/architecture/leak');
    // The guard's rejection message names the symlink / outside-vault reason.
    expect(res.stderr).toMatch(/symlink|outside the org vault/i);
    // The symlinked file is never staged/committed (no symlink blob pushed).
    expect(remoteTree()).not.toContain('org-vault/architecture/leak.md');
    // The victim's content (the sentinel) never reaches the shared org index.json.
    let indexJson = '';
    try { indexJson = git(['show', 'org-vault:org-vault/index.json'], { cwd: remote }); } catch { /* no index.json pushed yet */ }
    expect(indexJson).not.toContain(SENTINEL);
  });

  // Immortal-memory guard for the org-sync delete path. The PostToolUse sync fires
  // on tool invocation INCLUDING errors, and the hook falls back to tool_input.key
  // regardless of the response — so a delete_memory that the TS side refused on the
  // no-prune guard still reaches this .mjs as `--delete`. Without the .mjs-side guard
  // the refused delete would unlink the org-vault file and commitAndPush the removal to
  // the shared branch, defeating no-prune immortality and propagating the deletion to
  // every teammate. The .mjs must refuse a no-prune memory without --force, and honor
  // --force (forwarded by the hook when tool_input.force was true) for a deliberate
  // teardown. The force=true path normally arrives with the file already unlinked by the
  // TS side; here we invoke the .mjs directly with the file present to pin the guard.
  it('refuses to --delete a no-prune org memory without --force (immortal guard; no push)', () => {
    const key = 'org/decisions/immortal-adr';
    // Author must match the local OS user so we reach the no-prune guard, not the
    // authorship guard.
    writeOrgMemory('decisions/immortal-adr', { title: 'Immortal ADR', tags: ['org', 'no-prune'], author: ME }, '## Executive Summary\n\nA decision that must not disappear.\n');
    runMjs(key); // store + push
    expect(remoteTree()).toContain('org-vault/decisions/immortal-adr.md');
    const res = runMjs(key, ['--delete']); // refused — guard fires before unlink/commit
    expect(res.stderr).toMatch(/Refusing to delete.*no-prune/i);
    expect(remoteTree()).toContain('org-vault/decisions/immortal-adr.md');
  });

  it('removes a no-prune org memory with --delete --force (deliberate teardown syncs)', () => {
    const key = 'org/decisions/teardown-adr';
    writeOrgMemory('decisions/teardown-adr', { title: 'Teardown ADR', tags: ['org', 'no-prune'], author: ME }, '## Executive Summary\n\nDeliberately retired.\n');
    runMjs(key);
    expect(remoteTree()).toContain('org-vault/decisions/teardown-adr.md');
    runMjs(key, ['--delete', '--force']);
    expect(remoteTree()).not.toContain('org-vault/decisions/teardown-adr.md');
  });

  // Pass 3 fix: org-author guard. The .mjs delete path must verify the file's frontmatter
  // author matches the local OS user; force=true overrides no-prune but NOT authorship.
  it('refuses to --delete an org memory authored by another user', () => {
    const key = 'org/decisions/foreign';
    writeOrgMemory('decisions/foreign', { title: 'Foreign ADR', tags: ['org'], author: 'someone-else' }, '## Executive Summary\n\nNot mine.\n');
    runMjs(key); // store + push
    expect(remoteTree()).toContain('org-vault/decisions/foreign.md');
    const res = runMjs(key, ['--delete']);
    expect(res.stderr).toMatch(/authored by someone-else/);
    expect(remoteTree()).toContain('org-vault/decisions/foreign.md');
  });

  it('refuses --delete --force for another author (force does not override authorship)', () => {
    const key = 'org/decisions/foreign-force';
    writeOrgMemory('decisions/foreign-force', { title: 'Foreign Force ADR', tags: ['org', 'no-prune'], author: 'someone-else' }, '## Executive Summary\n\nNot mine.\n');
    runMjs(key); // store + push
    expect(remoteTree()).toContain('org-vault/decisions/foreign-force.md');
    const res = runMjs(key, ['--delete', '--force']);
    expect(res.stderr).toMatch(/authored by someone-else/);
    expect(remoteTree()).toContain('org-vault/decisions/foreign-force.md');
  });

  // Pass 3 fix: reserved-key guard. The org prefix + a reserved key segment must be
  // rejected before any git write, matching the TS-side reserved-key guard.
  it('rejects a reserved-key org memory at the entry point', () => {
    const key = 'org/__proto__';
    const res = runMjs(key);
    expect(res.stderr).toMatch(/reserved/i);
    expect(remoteTree()).not.toContain('org-vault/__proto__.md');
  });

  // #2: a corrupt org index.json (interrupted atomicWrite, bad manual edit, or a git-
  // merge conflict marker) used to parse to undefined → the bare `catch {}` set
  // `index = {}` → updateOrgIndex wrote a one-entry index and commitAndPush committed
  // it to the shared org-vault branch, wiping every teammate's full org index on their
  // next pull. loadOrgIndex now throws when the file EXISTS but is corrupt (cold start
  // — no index.json — still returns {}); the throw propagates to main().catch which
  // logs to ~/.total-recall/org/.sync-errors.log and exits 0, leaving the file on disk
  // untouched for manual recovery. Runs LAST and restores index.json from HEAD so the
  // corrupt fixture can't leak into earlier tests' shared org-vault state.
  it('refuses to rewrite a corrupt org index.json (no wipe, logs the error) (#2)', () => {
    const indexPath = path.join(orgVault, 'index.json');
    // A prior test committed a valid index.json to HEAD; corrupt the working-tree copy.
    const GARBAGE = '<<<<<<< HEAD\nnot valid json\n=======\nstill not json\n>>>>>>> branch\n';
    fs.writeFileSync(indexPath, GARBAGE);
    // Store mode on the existing org-tagged flink-cdc file reaches updateOrgIndex,
    // which calls loadOrgIndex and must throw BEFORE atomicWrite.
    const res = runMjs('org/architecture/flink-cdc');
    expect(res.stderr).toMatch(/refusing to rewrite org index/i);
    // The corrupt file on disk is NOT rewritten (no single-entry/empty wipe).
    expect(fs.readFileSync(indexPath, 'utf8')).toBe(GARBAGE);
    // The error was logged to the persistent sync-errors log (main().catch).
    const logPath = path.join(tmpHome, '.total-recall', 'org', '.sync-errors.log');
    expect(fs.readFileSync(logPath, 'utf8')).toMatch(/refusing to rewrite org index/i);
    // Restore the valid committed index.json so the corrupt fixture doesn't leak.
    git(['checkout', '--', path.relative(orgDir, indexPath)], { cwd: orgDir });
  });
}, 60000);