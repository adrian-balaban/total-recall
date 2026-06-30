import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

// Spawn-based tests for the SessionStart hook scripts (load-memory-index.sh,
// build-memory-index.sh). These are bash scripts invoked by Claude Code hooks,
// so exercising them means spawning real bash with a controlled HOME + plugin
// root, not importing TS. Mirrors sync-org-memory.e2e.test.ts's OK-gated pattern.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LOAD_SCRIPT = path.join(REPO_ROOT, 'hooks', 'scripts', 'load-memory-index.sh');
const BUILD_SCRIPT = path.join(REPO_ROOT, 'hooks', 'scripts', 'build-memory-index.sh');
const OQ_SCRIPT = path.join(REPO_ROOT, 'hooks', 'scripts', 'load-open-questions.sh');

function has(bin: string): boolean {
  return spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
}
const OK = has('bash') && has('node');

// Symlinks are needed to plant the teammate-push vector (git pull preserves
// symlinks) for the build-memory-index test. Skip on a FS that disallows them.
const CAN_SYMLINK = (() => {
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-hook-sym-'));
    fs.symlinkSync('nonexistent-target', path.join(d, 'link'));
    fs.rmSync(d, { recursive: true, force: true });
    return true;
  } catch { return false; }
})();

let tmpHome: string;

const suite = OK ? describe : describe.skip;

suite('hook-scripts (load-memory-index.sh, build-memory-index.sh)', () => {
  beforeAll(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-hook-'));
  }, 30000);

  afterAll(() => {
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // Pass 2 fix #1: load-memory-index.sh must read the plugin version from
  // package.json WITHOUT interpolating $PLUGIN_ROOT into the node -e JS literal.
  // A single quote in the install path (e.g. a username like "O'Brien") would
  // terminate the `require('...')` string literal → SyntaxError → silent fallback
  // to "unknown", so the injected SessionStart index announces the wrong version.
  // The env-pass fix reads the path from process.env.PLUGIN_ROOT, which is immune
  // to path-content injection. Without the fix this test sees "vunknown".
  it('load-memory-index.sh: a quote in the plugin path still reads the real version', () => {
    // Plugin root with a single quote in a path segment.
    const pluginRoot = path.join(tmpHome, "plug'in");
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, 'package.json'), '{"version":"9.9.9"}');
    // A readable index cache so the hook injects the index (mirrors real use; the
    // version banner is announced on either branch, so this isn't load-bearing).
    fs.mkdirSync(path.join(tmpHome, '.total-recall'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.total-recall', '.index-cache.txt'), '0\n');

    const r = spawnSync('bash', [LOAD_SCRIPT], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HOME: tmpHome, CLAUDE_PLUGIN_ROOT: pluginRoot },
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    const ctx = out.hookSpecificOutput.additionalContext;
    expect(ctx).toContain('v9.9.9');
    expect(ctx).not.toContain('vunknown');
  });

  // Pass 2 fix #6: build-memory-index.sh must use `find -type f` so symlinked .md
  // entries (type l) are excluded. Without -type f: (a) a symlinked .md pointing at
  // an outside file is followed and its frontmatter is injected into the cache — the
  // cache then advertises a memory the MCP tools never surface (and a teammate can
  // plant that symlink in the shared org vault via git pull); (b) a DANGLING symlink
  // makes `done < "$mdfile"` fail to open and, under `set -e`, can abort the whole
  // SessionStart cache build, leaving the injected index stale/missing. With -type f
  // both are excluded and the build completes cleanly.
  const symTest = CAN_SYMLINK ? it : it.skip;
  symTest('build-memory-index.sh: excludes symlinked + dangling .md, no set -e crash', () => {
    const knowledge = path.join(tmpHome, '.total-recall', 'personal-vault', 'knowledge');
    fs.mkdirSync(knowledge, { recursive: true });
    // A real file — must appear in the cache.
    fs.writeFileSync(path.join(knowledge, 'real.md'), '---\ntitle: Real\n---\nbody\n');
    // A symlink to an outside file — must NOT appear in the cache.
    const outside = path.join(tmpHome, 'outside.md');
    fs.writeFileSync(outside, '---\ntitle: Linked\n---\nbody\n');
    fs.symlinkSync(outside, path.join(knowledge, 'linked.md'));
    // A dangling symlink — must NOT appear and must NOT crash the build.
    fs.symlinkSync(path.join(tmpHome, 'does-not-exist'), path.join(knowledge, 'dangling.md'));

    const r = spawnSync('bash', [BUILD_SCRIPT], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HOME: tmpHome },
    });
    expect(r.status).toBe(0);
    const cache = fs.readFileSync(path.join(tmpHome, '.total-recall', '.index-cache.txt'), 'utf8');
    expect(cache).toContain('knowledge/real:');
    expect(cache).not.toContain('knowledge/linked:');
    expect(cache).not.toContain('knowledge/dangling:');
  });

  // Pass 5 fix #7: load-open-questions.sh runs under `set -euo pipefail`. The
  // OQ_FILE assignment is `find "$PERSONAL_VAULT" (...) | head -1 || true`. Without
  // `|| true`: on a fresh install the personal vault dir is absent → find exits
  // non-zero → under pipefail the pipeline returns non-zero → set -e ABORTS the
  // SessionStart hook before the `{"continue":true}` fallback runs, so Claude Code
  // treats the hook as failed. `|| true` collapses that to status 0 and the
  // `-z "$OQ_FILE"` guard below emits the continue. Verified empirically: without
  // `|| true` this exact invocation exits 1; with it, exits 0. (The >1-match
  // SIGPIPE sub-case in the fix's comment shares the SAME `|| true` guard but is
  // racy to trigger deterministically — short paths buffer in the pipe and find
  // exits 0 before head closes — so the no-vault case stands in for both.)
  it('load-open-questions.sh: exits 0 + {"continue":true} when the vault dir is absent', () => {
    // Fresh empty HOME — no .total-recall/personal-vault → find's root is missing.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-oq-novault-'));
    try {
      const r = spawnSync('bash', [OQ_SCRIPT], {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, HOME: home },
      });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ continue: true });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  // Pass 5 fix #8: build-memory-index.sh must (a) strip a trailing CR from each
  // frontmatter line so a teammate-pushed CRLF .md doesn't leak \r into the injected
  // title/tags, and (b) parse block-sequence tags (tags:\n  - a\n  - b) so a
  // block-form memory surfaces real tags instead of empty `[]`. Both are parity gaps
  // with the TS parser (which splits on /\r?\n/ and parses block arrays) that desync
  // the injected SessionStart index from list_memories. This single CRLF file with
  // block-array tags exercises both: without the CR strip the cache line carries a
  // literal \r (caught by the global no-\r assertion); without the block-array branch
  // the tags render as `[]` (caught by the [kafka, cdc] assertion).
  it('build-memory-index.sh: strips CRLF + joins block-array tags (parity with list_memories)', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-bmi-crlf-'));
    const knowledge = path.join(home, '.total-recall', 'personal-vault', 'knowledge');
    fs.mkdirSync(knowledge, { recursive: true });
    // CRLF line endings throughout; block-sequence (not inline []) tags.
    const crlf = [
      '---',
      'title: CRLF Title',
      'tags:',
      '  - kafka',
      '  - cdc',
      '---',
      'body',
      '',
    ].join('\r\n');
    fs.writeFileSync(path.join(knowledge, 'crlf-block.md'), crlf);

    try {
      const r = spawnSync('bash', [BUILD_SCRIPT], {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, HOME: home },
      });
      expect(r.status).toBe(0);
      const cache = fs.readFileSync(path.join(home, '.total-recall', '.index-cache.txt'), 'utf8');
      // Block-array tags joined (catches the missing block-array branch → would be []).
      expect(cache).toContain('knowledge/crlf-block: CRLF Title [kafka, cdc] (knowledge)');
      // CRLF strip (catches the missing CR strip → the line would carry a literal \r
      // in the title and/or the joined tags). The script re-emits with LF, so a clean
      // cache has no CR anywhere.
      expect(cache).not.toContain('\r');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  // build-memory-index.sh prunes EXCLUDED_DIRS with `find -iname` (case-
  // insensitive), matching src/vault-scan.ts which checks
  // `EXCLUDED_DIRS.has(e.name.toLowerCase())`. A mixed-case dir like `Projects`
  // IS skipped by the MCP tools but a case-sensitive `find -name projects` would
  // NOT prune it — the cache would inject `Projects/secret` as a memory the tools
  // never surface (the exact desync this script's header warns against).
  it('build-memory-index.sh: prunes a mixed-case excluded dir (Projects/)', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-bmi-case-'));
    const knowledge = path.join(home, '.total-recall', 'personal-vault', 'knowledge');
    fs.mkdirSync(knowledge, { recursive: true });
    fs.writeFileSync(path.join(knowledge, 'mixed.md'), '---\ntitle: Mixed\n---\nbody\n');
    // Mixed-case variant of the `projects` excluded dir.
    const projects = path.join(home, '.total-recall', 'personal-vault', 'Projects');
    fs.mkdirSync(projects, { recursive: true });
    fs.writeFileSync(path.join(projects, 'secret.md'), '---\ntitle: Secret\n---\nbody\n');

    try {
      const r = spawnSync('bash', [BUILD_SCRIPT], {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, HOME: home },
      });
      expect(r.status).toBe(0);
      const cache = fs.readFileSync(path.join(home, '.total-recall', '.index-cache.txt'), 'utf8');
      // The legitimate memory is indexed…
      expect(cache).toContain('knowledge/mixed:');
      // …and the mixed-case excluded dir is pruned in both casings.
      expect(cache).not.toContain('Projects/secret');
      expect(cache).not.toContain('projects/secret');
      expect(cache).not.toContain('Secret');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  // Pass 7 fix #2: extract-and-store-memories.sh must persist node
  // store-learning.mjs's stderr to ~/.total-recall/.extract.log (not /dev/null).
  // store-learning.mjs emits a "X written, Y skipped, Z errors" summary to stderr
  // "for debugging", and any crash/import failure (e.g. a build-drifted missing
  // dist/frontmatter.mjs → ERR_MODULE_NOT_FOUND) lands there too. The old
  // `2>/dev/null` discarded BOTH, so a persistent extraction failure dropped every
  // PreCompact learning with ZERO observable signal — no log, no error, no
  // exit-code change (the trailing `|| true` still swallowed the exit). This test
  // stubs `claude` (empty stdout, exit 0) so store-learning.mjs gets no JSON
  // lines, then asserts the log captured the summary that /dev/null discarded.
  const EXTRACT_SCRIPT = path.join(REPO_ROOT, 'hooks', 'scripts', 'extract-and-store-memories.sh');
  it('extract-and-store-memories.sh: persists the store-learning summary to .extract.log', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-extract-log-'));
    // The PreCompact hook runs post-install, so ~/.total-recall exists (install.sh
    // Step 2). The `2>>"$HOME/.total-recall/.extract.log"` redirect needs the dir
    // to exist or bash can't open the target and store-learning.mjs never runs
    // (store-learning.mjs is self-healing for the vault dir via mkdir recursive,
    // but the bash redirect is not). Mirror the post-install invariant here.
    fs.mkdirSync(path.join(home, '.total-recall'), { recursive: true });
    // Stub `claude` on a tmp PATH: empty stdout, exit 0 → store-learning.mjs gets
    // no JSON lines → 0 written, emits the "0 written, 0 skipped, 0 errors"
    // summary to stderr (the exact stream the old 2>/dev/null discarded).
    const binDir = path.join(home, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const claudeStub = path.join(binDir, 'claude');
    fs.writeFileSync(claudeStub, '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(claudeStub, 0o755);
    // A non-empty transcript file so the script passes the transcript guard and
    // reaches the extract pipeline.
    const transcript = path.join(home, 'transcript.jsonl');
    fs.writeFileSync(transcript, '{"type":"assistant","message":{"content":[]}}\n');
    try {
      const r = spawnSync('bash', [EXTRACT_SCRIPT], {
        encoding: 'utf8',
        stdio: 'pipe',
        input: JSON.stringify({ transcript_path: transcript }),
        env: { ...process.env, HOME: home, PATH: binDir + ':' + (process.env.PATH ?? '') },
      });
      expect(r.status).toBe(0);
      // stdout stays clean: only the hook's {"continue":true}.
      expect(JSON.parse(r.stdout)).toEqual({ continue: true });
      // The summary the old /dev/null discarded is now captured to the log.
      const logPath = path.join(home, '.total-recall', '.extract.log');
      expect(fs.existsSync(logPath)).toBe(true);
      expect(fs.readFileSync(logPath, 'utf8')).toMatch(/written|skipped|errors/);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  // Pass 7 fix #3: install.sh's "Failed to connect" guard runs under
  // `set -o pipefail` (line 78). The real failure case (wrong node path → stdio
  // server unreachable) has `claude mcp get` print "Failed to connect" AND exit
  // non-zero. A bare `claude mcp get … | grep -qi 'failed to connect'` pipeline
  // then exits non-zero (pipefail takes the rightmost non-zero stage = claude's
  // 1), the `if` is false, and the script prints a FALSE
  // `ok "Registered MCP server …"` while SKIPPING the warning that tells the user
  // the node path is wrong — the guard could only ever fire when claude exits 0
  // AND prints "Failed to connect", which is contradictory. The fix captures the
  // output first (`$(… || true)`) and greps the captured string, making the match
  // independent of claude's exit status. This test stubs `claude` to print
  // "Failed to connect" + exit 1 on `mcp get`, then asserts the warning fires and
  // the false success line does NOT.
  const INSTALL_SCRIPT = path.join(REPO_ROOT, 'install.sh');
  it('install.sh: warns (not false-ok) when claude mcp get reports Failed to connect + exits non-zero', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-install-pipefail-'));
    const binDir = path.join(home, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const claudeStub = path.join(binDir, 'claude');
    fs.writeFileSync(claudeStub, [
      '#!/usr/bin/env bash',
      'if [ "$1" = "mcp" ] && [ "$2" = "get" ]; then',
      '  echo "Failed to connect to server."',
      '  exit 1', // the real failure case: claude mcp get exits non-zero
      'fi',
      'if [ "$1" = "mcp" ] && [ "$2" = "add-json" ]; then exit 0; fi',
      'exit 0',
    ].join('\n'));
    fs.chmodSync(claudeStub, 0o755);
    try {
      // Use the REAL plugin root so Step 1's dist/index.js probe passes (a tmp
      // root with no dist/index.js dies at Step 1 before reaching the Step 3
      // guard under test). Step 4 then runs the real build-memory-index.sh
      // against the tmp HOME vault (empty → fast, exit 0); Step 7 --no-vector
      // skips the npm install. No --standalone/--statusline/--org-repo.
      const r = spawnSync('bash', [INSTALL_SCRIPT, '--plugin-root', REPO_ROOT, '-y', '--no-vector'], {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, HOME: home, PATH: binDir + ':' + (process.env.PATH ?? '') },
      });
      // install.sh has no `set -e` → runs all 8 steps and exits 0.
      expect(r.status).toBe(0);
      const out = r.stdout + r.stderr;
      // The warning the guard is meant to surface…
      expect(out).toContain('Failed to connect');
      // …and NOT the false success the buggy pipefail inversion produced.
      expect(out).not.toContain("Registered MCP server 'total-recall' (user scope).");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
}, 60000);

// ─── #5: pull-org-vault.sh — security-critical git-clone hook coverage ──────
// pull-org-vault.sh does `gh repo clone` / `git clone` of a config-supplied
// remote URL into the user's home and carries security-critical defenses:
// GIT_CONFIG protocol.ext.allow=never (ext:: command-exec), GIT_TERMINAL_PROMPT=0,
// https://|git@ URL validation, and --no-recurse-submodules (pushed-.gitmodules
// fetch). Before #5 none were asserted, so a regression dropping any defense
// (e.g. protocol.ext.allow=never or --no-recurse-submodules) would pass CI
// silently. These spawn-based tests mirror the hook-scripts suite's pattern.
const PULL_SCRIPT = path.join(REPO_ROOT, 'hooks', 'scripts', 'pull-org-vault.sh');

function writeOrgConfig(home: string, orgRepo: string): void {
  fs.mkdirSync(path.join(home, '.total-recall'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.total-recall', 'config.json'),
    JSON.stringify({ orgRepo }),
  );
}

const pullSuite = OK ? describe : describe.skip;
pullSuite('pull-org-vault.sh (#5)', () => {
  it('exits 0 with continue:true + SessionStart hookSpecificOutput when orgRepo is unset', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-pull-norepo-'));
    fs.mkdirSync(path.join(home, '.total-recall'), { recursive: true });
    // No config.json → node readFileSync throws → catch writes '' → ORG_REPO empty.
    try {
      const r = spawnSync('bash', [PULL_SCRIPT], {
        encoding: 'utf8', stdio: 'pipe',
        env: { ...process.env, HOME: home },
      });
      expect(r.status).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.continue).toBe(true);
      expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart');
      expect(out.hookSpecificOutput.additionalContext).toContain('orgRepo not set');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('skips with a clear message for a file:// / local-path orgRepo', () => {
    // Only https:// and git@ SSH URLs are valid remotes; a file:// or local path
    // could hand `git clone` an unintended source. The case guard rejects early.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-pull-fileurl-'));
    writeOrgConfig(home, 'file:///etc');
    try {
      const r = spawnSync('bash', [PULL_SCRIPT], {
        encoding: 'utf8', stdio: 'pipe',
        env: { ...process.env, HOME: home },
      });
      expect(r.status).toBe(0);
      const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
      expect(ctx).toContain('not an https:// or git@ SSH URL');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('exports GIT_CONFIG protocol.ext.allow=never to the gh clone subprocess', () => {
    // ext:: submodule URLs are literal command execution (never legitimate). The
    // script exports GIT_CONFIG_KEY_0=protocol.ext.allow / =never BEFORE invoking
    // gh, and gh spawns git inheriting this env — so the defense covers the gh
    // clone path. Stub `gh repo clone` to dump its inherited env + exit 0 (→ the
    // "Org vault cloned." branch), then assert the ext-allow block is present.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-pull-extdef-'));
    writeOrgConfig(home, 'https://github.com/o/r');
    const capture = path.join(home, 'env.txt');
    const binDir = path.join(home, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'gh'), [
      '#!/usr/bin/env bash',
      'if [ "$1" = auth ] && [ "$2" = token ]; then exit 1; fi',
      'if [ "$1" = repo ] && [ "$2" = clone ]; then env | grep "^GIT_CONFIG" > "$CAPTURE_FILE"; exit 0; fi',
      'exit 0',
    ].join('\n'));
    fs.chmodSync(path.join(binDir, 'gh'), 0o755);
    try {
      const r = spawnSync('bash', [PULL_SCRIPT], {
        encoding: 'utf8', stdio: 'pipe',
        env: { ...process.env, HOME: home, CAPTURE_FILE: capture,
               PATH: binDir + ':' + (process.env.PATH ?? '') },
      });
      expect(r.status).toBe(0);
      const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
      expect(ctx).toContain('Org vault cloned');
      const envDump = fs.readFileSync(capture, 'utf8');
      expect(envDump).toContain('GIT_CONFIG_KEY_0=protocol.ext.allow');
      expect(envDump).toContain('GIT_CONFIG_VALUE_0=never');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('passes --no-recurse-submodules to git clone on the gh-fallback path', () => {
    // A pushed .gitmodules must never be fetched. The direct `git clone` fallback
    // (taken when `gh repo clone` fails) carries --no-recurse-submodules. Stub gh
    // to fail on `repo clone` (force the fallback) and git to capture its args +
    // exit 0 (→ "Org vault cloned."), then assert the flag is present.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-pull-nosubmod-'));
    writeOrgConfig(home, 'https://github.com/o/r');
    const capture = path.join(home, 'git-args.txt');
    const binDir = path.join(home, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'gh'), [
      '#!/usr/bin/env bash',
      'if [ "$1" = auth ] && [ "$2" = token ]; then exit 1; fi',
      'if [ "$1" = repo ] && [ "$2" = clone ]; then exit 1; fi',
      'exit 0',
    ].join('\n'));
    fs.writeFileSync(path.join(binDir, 'git'), [
      '#!/usr/bin/env bash',
      'if [ "$1" = clone ]; then printf "%s\\n" "$@" > "$GIT_CAPTURE"; exit 0; fi',
      'exit 0',
    ].join('\n'));
    fs.chmodSync(path.join(binDir, 'gh'), 0o755);
    fs.chmodSync(path.join(binDir, 'git'), 0o755);
    try {
      const r = spawnSync('bash', [PULL_SCRIPT], {
        encoding: 'utf8', stdio: 'pipe',
        env: { ...process.env, HOME: home, GIT_CAPTURE: capture,
               PATH: binDir + ':' + (process.env.PATH ?? '') },
      });
      expect(r.status).toBe(0);
      const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
      expect(ctx).toContain('Org vault cloned');
      const gitArgs = fs.readFileSync(capture, 'utf8');
      expect(gitArgs).toContain('--no-recurse-submodules');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}, 60000);
