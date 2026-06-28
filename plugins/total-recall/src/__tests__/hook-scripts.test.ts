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
}, 60000);