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
}, 60000);