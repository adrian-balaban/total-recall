import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  parseArgs, compareVersions, newestVersionDir, claudeCandidates, resolveClaude, resolveBash, installState, main, PLUGIN_ID, EX_UNAVAILABLE,
} from '../bin/cli.mjs';

// A fake file system: a Set of paths that "exist"; directories list their children.
function fakeFs(paths) {
  const all = new Set(paths);
  const children = (dir) => {
    const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
    const names = new Set();
    for (const p of all) if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split(path.sep)[0]);
    return [...names];
  };
  return {
    existsSync: (p) => all.has(p) || children(p).length > 0,
    readdirSync: (p) => { const c = children(p); if (!c.length) throw new Error('ENOENT'); return c; },
  };
}
const HOME = '/home/u';
const cache = (...p) => path.join(HOME, '.claude/plugins/cache', ...p);

describe('arguments', () => {
  it('removes its own flags and forwards the rest verbatim, in order', () => {
    const { own, forward } = parseArgs(['-y', '--gemini', '--force', '--org-repo', 'https://x/y.git', '--allowed-email-domain', 'a.com']);
    assert.equal(own.force, true);
    assert.deepEqual(forward, ['-y', '--gemini', '--org-repo', 'https://x/y.git', '--allowed-email-domain', 'a.com']);
  });
});

describe('versions', () => {
  it('compares numerically: 1.6.10 > 1.6.9', () => {
    assert.ok(compareVersions('1.6.10', '1.6.9') > 0);
    assert.ok(compareVersions('1.6.9', '1.6.10') < 0);
    assert.equal(compareVersions('1.7.0', '1.7.0'), 0);
  });
  it('picks the newest version dir that has an install.sh', () => {
    const dir = cache('my-claude-plugins/total-recall');
    const fsImpl = fakeFs([`${dir}/1.6.9/install.sh`, `${dir}/1.6.10/install.sh`, `${dir}/1.7.0/README.md`]);
    assert.equal(newestVersionDir(dir, fsImpl), '1.6.10');
  });
  it('returns null when nothing is installed', () => {
    assert.equal(newestVersionDir('/nope', fakeFs([])), null);
  });
});

describe('finding claude', () => {
  it('prefers the one on PATH', () => {
    const calls = [];
    const run = (c) => { calls.push(c); return { status: 0 }; };
    assert.equal(resolveClaude({ run, home: HOME, fsImpl: fakeFs([]), platform: 'linux' }), 'claude');
    assert.deepEqual(calls, ['claude']);
  });
  it('falls back to the newest VS Code extension binary', () => {
    const base = `${HOME}/.vscode/extensions`;
    const bin = (v) => `${base}/anthropic.claude-code-${v}/resources/native-binary/claude`;
    const fsImpl = fakeFs([bin('2.0.9'), bin('2.0.10')]);
    const run = (c) => ({ status: c === 'claude' ? 1 : 0 });
    assert.equal(resolveClaude({ run, home: HOME, fsImpl, platform: 'linux' }), bin('2.0.10'));
  });
  it('lists the extension dirs of VS Code, Insiders and Cursor, then ~/.local/bin', () => {
    const fsImpl = fakeFs([`${HOME}/.cursor/extensions/anthropic.claude-code-1.0.0/resources/native-binary/claude`]);
    const c = claudeCandidates(HOME, fsImpl);
    assert.match(c[0], /\.cursor/);
    assert.equal(c.at(-1), path.join(HOME, '.local/bin/claude'));
  });
  it('returns null when it is nowhere', () => {
    assert.equal(resolveClaude({ run: () => ({ status: 1 }), home: HOME, fsImpl: fakeFs([]), platform: 'linux' }), null);
  });
});

describe('bash on Windows', () => {
  it('uses plain bash off Windows', () => {
    assert.equal(resolveBash({ platform: 'linux', run: () => ({ status: 1 }) }), 'bash');
  });
  it('uses bash on PATH when it works, else Git for Windows, else null', () => {
    assert.equal(resolveBash({ platform: 'win32', run: () => ({ status: 0 }) }), 'bash');
    const gitBash = path.win32.join('C:\\Program Files', 'Git', 'bin', 'bash.exe');
    const fsImpl = { existsSync: (p) => p === gitBash };
    assert.equal(resolveBash({ platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' }, fsImpl, run: () => ({ status: 1 }) }), gitBash);
    assert.equal(resolveBash({ platform: 'win32', env: {}, fsImpl: { existsSync: () => false }, run: () => ({ status: 1 }) }), null);
  });
});

describe('install state', () => {
  it('ours / foreign / none', () => {
    const ours = fakeFs([cache('my-claude-plugins/total-recall/1.7.0/install.sh')]);
    const foreign = fakeFs([cache('someone-else/total-recall/0.1.0/x')]);
    assert.equal(installState(HOME, ours), 'ours');
    assert.equal(installState(HOME, foreign), 'foreign');
    assert.equal(installState(HOME, fakeFs([])), 'none');
  });
});

describe('main', () => {
  const installed = () => fakeFs([cache('my-claude-plugins/total-recall/1.6.9/install.sh'), cache('my-claude-plugins/total-recall/1.6.10/install.sh')]);
  function harness(over = {}) {
    const calls = []; const out = []; const err = [];
    const deps = {
      run: (cmd, args) => { calls.push([cmd, ...args]); return { status: 0 }; },
      out: (s) => out.push(s), err: (s) => err.push(s),
      home: HOME, fsImpl: installed(), platform: 'linux', nodeVersion: '20.1.0', version: '9.9.9',
      ...over,
    };
    return { deps, calls, out, err };
  }

  it('--help and --version run nothing', () => {
    const h = harness();
    assert.equal(main(['--help'], h.deps), 0);
    assert.equal(main(['--version'], h.deps), 0);
    assert.deepEqual(h.calls, []);
    assert.equal(h.out.at(-1), '9.9.9');
    assert.match(h.out[0], /Usage: npx @adrian-balaban\/total-recall/);
  });

  it('already installed: skips the marketplace and runs install.sh of the newest version with the flags', () => {
    const h = harness();
    assert.equal(main(['-y', '--vscode'], h.deps), 0);
    const last = h.calls.at(-1);
    assert.deepEqual(last, ['bash', cache('my-claude-plugins/total-recall/1.6.10/install.sh'), '-y', '--vscode']);
    assert.ok(!h.calls.some((c) => c.includes('marketplace')));
  });

  it('fresh machine: adds the marketplace, installs the plugin, then runs install.sh', () => {
    // After `plugin install`, the cache appears.
    let installedNow = false;
    const fsImpl = { existsSync: (p) => installedNow && installed().existsSync(p), readdirSync: (p) => { if (!installedNow) throw new Error('ENOENT'); return installed().readdirSync(p); } };
    const h = harness({ fsImpl });
    h.deps.run = (cmd, args) => { h.calls.push([cmd, ...args]); if (args[1] === 'install') installedNow = true; return { status: 0 }; };
    assert.equal(main([], h.deps), 0);
    const subs = h.calls.map((c) => c.slice(0, 4).join(' '));
    assert.ok(subs.includes('claude plugin marketplace add'));
    assert.ok(subs.includes(`claude plugin install ${PLUGIN_ID}`));
    assert.equal(h.calls.at(-1)[0], 'bash');
  });

  it('stops with a clear message when the marketplace step fails', () => {
    const h = harness({ fsImpl: fakeFs([]) });
    h.deps.run = (cmd, args) => (args[0] === 'plugin' ? { status: 1 } : { status: 0 });
    assert.equal(main([], h.deps), 1);
    assert.match(h.err[0], /could not add the marketplace/);
  });

  it('aborts on a same-named plugin from another marketplace, unless --force', () => {
    const fsImpl = fakeFs([cache('someone-else/total-recall/0.1.0/x')]);
    const a = harness({ fsImpl });
    assert.equal(main([], a.deps), 1);
    assert.match(a.err[0], /another plugin named "total-recall"/);
    assert.deepEqual(a.calls.filter((c) => c[1] === 'plugin'), []);
    const b = harness({ fsImpl: fakeFs([cache('someone-else/total-recall/0.1.0/x'), cache('my-claude-plugins/total-recall/1.0.0/install.sh')]) });
    assert.equal(main(['--force'], b.deps), 0);
  });

  it('fails when claude is missing, and on Node older than 18', () => {
    const noClaude = harness(); noClaude.deps.run = () => ({ status: 1 });
    assert.equal(main([], noClaude.deps), 1);
    assert.match(noClaude.err[0], /`claude` CLI was not found/);
    const old = harness({ nodeVersion: '16.20.0' });
    assert.equal(main([], old.deps), 1);
    assert.match(old.err[0], /Node 18/);
  });

  it('exits 69 on Windows without Git Bash', () => {
    const h = harness({ platform: 'win32', env: {} });
    h.deps.run = (cmd) => ({ status: cmd.startsWith('claude') ? 0 : 1 });
    assert.equal(main([], h.deps), EX_UNAVAILABLE);
    assert.match(h.err[0], /Git Bash/);
  });

  it('returns the exit code of install.sh', () => {
    const h = harness();
    h.deps.run = (cmd) => ({ status: cmd === 'bash' ? 3 : 0 });
    assert.equal(main([], h.deps), 3);
  });
});
