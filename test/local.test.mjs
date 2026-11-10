import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DIST_ARTIFACTS, resolveLocalPluginRoot, npmCommand, ensureBuilt, stageLocalRelease, installLocal,
} from '../bin/local.mjs';
import { LOCAL_MARKETPLACE_NAME, LOCAL_PLUGIN_ID, PLUGIN_ID, EX_UNAVAILABLE } from '../bin/cli.mjs';

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-local-test-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function writeFile(p, content = '') {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/** A minimal plugin directory: the two marker files, plus whatever extra files the test wants. */
function makePluginDir(dir) {
  writeFile(path.join(dir, '.claude-plugin', 'plugin.json'), '{"name":"total-recall","version":"1.0.0"}');
  writeFile(path.join(dir, 'package.json'), '{"name":"total-recall"}');
}

function makeDist(dir) {
  for (const f of DIST_ARTIFACTS) writeFile(path.join(dir, 'dist', f), `// ${f}`);
}

describe('resolveLocalPluginRoot', () => {
  it('resolves a direct path to the plugin dir', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    assert.equal(resolveLocalPluginRoot({ given: plugin, cwd: tmp }), plugin);
  });

  it('resolves a repo root to plugins/total-recall', () => {
    const plugin = path.join(tmp, 'plugins', 'total-recall');
    makePluginDir(plugin);
    assert.equal(resolveLocalPluginRoot({ given: tmp, cwd: tmp }), plugin);
  });

  it('autodetects from a nested cwd by walking up', () => {
    const plugin = path.join(tmp, 'plugins', 'total-recall');
    makePluginDir(plugin);
    const nested = path.join(tmp, 'a', 'b', 'c');
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(resolveLocalPluginRoot({ cwd: nested }), plugin);
  });

  it('autodetects when cwd IS the plugin dir', () => {
    makePluginDir(tmp);
    assert.equal(resolveLocalPluginRoot({ cwd: tmp }), tmp);
  });

  it('returns null when nothing matches', () => {
    assert.equal(resolveLocalPluginRoot({ cwd: tmp }), null);
  });
});

describe('npmCommand', () => {
  it('uses npm.cmd with shell:true on win32, plain npm elsewhere', () => {
    assert.deepEqual(npmCommand('win32'), { cmd: 'npm.cmd', shell: true });
    assert.deepEqual(npmCommand('linux'), { cmd: 'npm' });
  });
});

describe('ensureBuilt', () => {
  it('runs npm ci only when node_modules/.package-lock.json is missing, always runs build', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    writeFile(path.join(plugin, 'package-lock.json'), '{}');
    const calls = [];
    const run = (cmd, args) => { calls.push(args[0]); makeDist(plugin); return { status: 0 }; };
    ensureBuilt({ pluginDir: plugin, run, platform: 'linux' });
    assert.deepEqual(calls, ['ci', 'run']);
  });

  it('skips npm ci when the lock marker is newer than package-lock.json', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    writeFile(path.join(plugin, 'package-lock.json'), '{}');
    writeFile(path.join(plugin, 'node_modules', '.package-lock.json'), '{}');
    const past = new Date(Date.now() - 10_000);
    fs.utimesSync(path.join(plugin, 'package-lock.json'), past, past);
    const calls = [];
    const run = (cmd, args) => { calls.push(args[0]); makeDist(plugin); return { status: 0 }; };
    ensureBuilt({ pluginDir: plugin, run, platform: 'linux' });
    assert.deepEqual(calls, ['run']);
  });

  it('uses npm.cmd + shell:true on win32', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    const calls = [];
    const run = (cmd, args, opts) => { calls.push([cmd, opts?.shell]); makeDist(plugin); return { status: 0 }; };
    ensureBuilt({ pluginDir: plugin, run, platform: 'win32' });
    assert.ok(calls.every(([cmd, shell]) => cmd === 'npm.cmd' && shell === true));
  });

  it('throws when an artifact is still missing after a successful build', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    const run = () => ({ status: 0 }); // build "succeeds" but writes nothing
    assert.throws(() => ensureBuilt({ pluginDir: plugin, run, platform: 'linux' }), /dist\/ is still missing|still missing/);
  });

  it('throws when the run fails', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    const run = () => ({ status: 1 });
    assert.throws(() => ensureBuilt({ pluginDir: plugin, run, platform: 'linux' }), /npm ci && npm run build/);
  });
});

describe('stageLocalRelease', () => {
  function gitRun(pluginDir, files) {
    return (cmd, args, opts) => {
      if (cmd === 'git' && args[0] === 'ls-files') {
        return { status: 0, stdout: `${files.join('\n')}\n` };
      }
      return { status: 0, stdout: '' };
    };
  }

  it('stages tracked files + dist/, never node_modules', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    makeDist(plugin);
    writeFile(path.join(plugin, 'src', 'index.ts'), '// src');
    writeFile(path.join(plugin, 'node_modules', 'x', 'index.js'), '// should never be staged');
    fs.mkdirSync(path.join(plugin, '.git')); // marks git as "present"
    const files = ['.claude-plugin/plugin.json', 'package.json', 'src/index.ts'];
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const run = gitRun(plugin, files);
    const result = stageLocalRelease({ pluginDir: plugin, home, run });

    assert.ok(fs.existsSync(path.join(result.pluginStageDir, 'src', 'index.ts')));
    assert.ok(fs.existsSync(path.join(result.pluginStageDir, 'dist', 'index.js')));
    assert.ok(!fs.existsSync(path.join(result.pluginStageDir, 'node_modules')));
    const marketplace = JSON.parse(fs.readFileSync(path.join(result.stagingDir, '.claude-plugin', 'marketplace.json'), 'utf8'));
    assert.equal(marketplace.name, LOCAL_MARKETPLACE_NAME);
    assert.equal(marketplace.plugins[0].source, './plugins/total-recall');
  });

  it('preserves the execute bit on files git marks 100755', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    makeDist(plugin);
    fs.mkdirSync(path.join(plugin, '.git'));
    const scriptPath = path.join(plugin, 'hooks', 'scripts', 'session-end.sh');
    writeFile(scriptPath, '#!/usr/bin/env bash\n');
    fs.chmodSync(scriptPath, 0o755);
    const installShPath = path.join(plugin, 'install.sh');
    writeFile(installShPath, '#!/usr/bin/env bash\n');
    fs.chmodSync(installShPath, 0o755);
    const files = ['.claude-plugin/plugin.json', 'package.json', 'hooks/scripts/session-end.sh', 'install.sh'];
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const run = gitRun(plugin, files);
    const result = stageLocalRelease({ pluginDir: plugin, home, run });

    const mode = (p) => fs.statSync(p).mode & 0o777;
    assert.equal(mode(path.join(result.pluginStageDir, 'hooks', 'scripts', 'session-end.sh')), 0o755);
    assert.equal(mode(path.join(result.pluginStageDir, 'install.sh')), 0o755);
  });

  it('fingerprint is stable on an unchanged re-run and changes after an edit', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    makeDist(plugin);
    fs.mkdirSync(path.join(plugin, '.git'));
    const files = ['.claude-plugin/plugin.json', 'package.json'];
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const run = gitRun(plugin, files);

    const first = stageLocalRelease({ pluginDir: plugin, home, run });
    assert.equal(first.changed, true); // first run: no prior .local-build.json

    const second = stageLocalRelease({ pluginDir: plugin, home, run });
    assert.equal(second.changed, false);
    assert.equal(second.fingerprint, first.fingerprint);

    writeFile(path.join(plugin, 'package.json'), '{"name":"total-recall","version":"2.0.0"}');
    const third = stageLocalRelease({ pluginDir: plugin, home, run });
    assert.equal(third.changed, true);
    assert.notEqual(third.fingerprint, second.fingerprint);
  });

  it('keeps the staged node_modules across a re-stage (vector deps live there)', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    makeDist(plugin);
    fs.mkdirSync(path.join(plugin, '.git'));
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const run = gitRun(plugin, ['.claude-plugin/plugin.json', 'package.json']);

    const first = stageLocalRelease({ pluginDir: plugin, home, run });
    writeFile(path.join(first.pluginStageDir, 'node_modules', 'better-sqlite3', 'package.json'), '{}');
    const second = stageLocalRelease({ pluginDir: plugin, home, run });
    assert.ok(fs.existsSync(path.join(second.pluginStageDir, 'node_modules', 'better-sqlite3', 'package.json')));
  });

  it('fallback without .git is fail-closed: skips unlisted dotfiles, keeps the allowlisted ones', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    makeDist(plugin);
    writeFile(path.join(plugin, '.mcp.json'), '{}');
    writeFile(path.join(plugin, '.remember', 'now.md'), 'private notes');
    writeFile(path.join(plugin, '.claude', 'settings.local.json'), '{"secret":true}');
    writeFile(path.join(plugin, 'tmp', 'scratch.txt'), 'scratch');
    writeFile(path.join(plugin, 'x.tsbuildinfo'), '{}');
    writeFile(path.join(plugin, 'src', 'index.ts'), '// src');
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const run = () => ({ status: 1, stdout: '' }); // git unavailable, irrelevant: no .git ancestor anyway

    const result = stageLocalRelease({ pluginDir: plugin, home, run });

    assert.ok(fs.existsSync(path.join(result.pluginStageDir, '.claude-plugin', 'plugin.json')));
    assert.ok(fs.existsSync(path.join(result.pluginStageDir, '.mcp.json')));
    assert.ok(fs.existsSync(path.join(result.pluginStageDir, 'src', 'index.ts')));
    assert.ok(!fs.existsSync(path.join(result.pluginStageDir, '.remember')));
    assert.ok(!fs.existsSync(path.join(result.pluginStageDir, '.claude')));
    assert.ok(!fs.existsSync(path.join(result.pluginStageDir, 'tmp')));
    assert.ok(!fs.existsSync(path.join(result.pluginStageDir, 'x.tsbuildinfo')));
  });

  it('a .git directory present but git failing is a hard error, with no partial staging', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    makeDist(plugin);
    fs.mkdirSync(path.join(plugin, '.git'));
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const run = () => ({ status: 1, stdout: '' });

    assert.throws(() => stageLocalRelease({ pluginDir: plugin, home, run }), /git.*failed|install git/);
    assert.ok(!fs.existsSync(path.join(home, '.total-recall', 'local-marketplace')));
  });
});

describe('installLocal invariant: bin/local.mjs imports only node:* and ./cli.mjs', () => {
  it('has no other import/require', () => {
    const src = fs.readFileSync(new URL('../bin/local.mjs', import.meta.url), 'utf8');
    const specifiers = [...src.matchAll(/(?:import[^'"]*from\s+|require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.ok(specifiers.length > 0, 'expected at least one import to check');
    for (const spec of specifiers) {
      assert.ok(spec.startsWith('node:') || spec === './cli.mjs', `unexpected import in bin/local.mjs: ${spec}`);
    }
  });
});

describe('installLocal with claude', () => {
  function setup({ installedEntries = {}, distOk = true } = {}) {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    makeDist(plugin);
    fs.mkdirSync(path.join(plugin, '.git'));
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);

    const installedPluginsPath = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
    const writeInstalled = (entries) => {
      fs.mkdirSync(path.dirname(installedPluginsPath), { recursive: true });
      const plugins = {};
      for (const [id, installPath] of Object.entries(entries)) {
        plugins[id] = installPath === null ? [] : [{ scope: 'user', installPath }];
      }
      fs.writeFileSync(installedPluginsPath, JSON.stringify({ version: 2, plugins }));
    };
    writeInstalled(installedEntries);

    const calls = [];
    const outLines = [];
    const errLines = [];
    const out = (s) => outLines.push(s);
    const err = (s) => errLines.push(s);
    let currentInstallPath = installedEntries[LOCAL_PLUGIN_ID] ?? null;

    const run = (cmd, args, opts) => {
      calls.push([cmd, ...args]);
      if (cmd === 'git' && args[0] === 'ls-files') return { status: 0, stdout: '.claude-plugin/plugin.json\npackage.json\n' };
      if (cmd === 'git' && args.includes('rev-parse')) return { status: 0, stdout: 'abc123\n' };
      if (cmd === 'claude' && args[0] === '--version') return { status: 0 };
      if (cmd === 'claude' && args[1] === 'marketplace' && args[2] === 'add') return { status: 0 };
      if (cmd === 'claude' && args[1] === 'install') {
        const installPath = path.join(home, '.claude', 'plugins', 'cache', LOCAL_MARKETPLACE_NAME, 'total-recall', 'new');
        fs.mkdirSync(installPath, { recursive: true });
        writeFile(path.join(installPath, 'install.sh'), '#!/usr/bin/env bash\n');
        if (distOk) makeDist(installPath);
        writeInstalled({ [LOCAL_PLUGIN_ID]: installPath });
        currentInstallPath = installPath;
        return { status: 0 };
      }
      if (cmd === 'claude' && args[1] === 'uninstall') {
        writeInstalled({ [LOCAL_PLUGIN_ID]: null });
        return { status: 0 };
      }
      if (cmd === 'bash') return { status: 0 };
      return { status: 0, stdout: '' };
    };

    return { plugin, home, calls, out, err, run, installedPluginsPath, writeInstalled, get currentInstallPath() { return currentInstallPath; } };
  }

  it('fresh install: npm build -> marketplace add -> install -> install.sh --plugin-root <installPath>', () => {
    const ctx = setup();
    const code = installLocal([], { local: ctx.plugin }, {
      run: ctx.run, out: ctx.out, err: ctx.err, home: ctx.home, platform: 'linux', cwd: ctx.plugin,
    });
    assert.equal(code, 0);
    const subs = ctx.calls.map((c) => c.join(' '));
    const iAdd = subs.findIndex((s) => s.includes('marketplace add'));
    const iInstall = subs.findIndex((s) => s.startsWith('claude plugin install'));
    const iBash = subs.findIndex((s) => s.startsWith('bash'));
    assert.ok(iAdd >= 0 && iInstall > iAdd && iBash > iInstall);
    assert.match(ctx.calls[iBash].join(' '), /install\.sh --plugin-root/);
  });

  it('changed: refreshes via uninstall + install', () => {
    const oldInstallPath = path.join(tmp, 'old-install');
    fs.mkdirSync(oldInstallPath, { recursive: true });
    writeFile(path.join(oldInstallPath, 'install.sh'), '#!/usr/bin/env bash\n');
    makeDist(oldInstallPath);
    const ctx = setup({ installedEntries: { [LOCAL_PLUGIN_ID]: oldInstallPath } });
    const code = installLocal([], { local: ctx.plugin }, {
      run: ctx.run, out: ctx.out, err: ctx.err, home: ctx.home, platform: 'linux', cwd: ctx.plugin,
    });
    assert.equal(code, 0);
    const subs = ctx.calls.map((c) => c.join(' '));
    assert.ok(subs.some((s) => s.startsWith('claude plugin uninstall')));
    assert.ok(subs.some((s) => s.startsWith('claude plugin install')));
  });

  it('unchanged: no install/uninstall, install.sh still runs against the existing installPath', () => {
    const existingPath = path.join(tmp, 'existing-install');
    fs.mkdirSync(existingPath, { recursive: true });
    writeFile(path.join(existingPath, 'install.sh'), '#!/usr/bin/env bash\n');
    makeDist(existingPath);
    const ctx = setup({ installedEntries: { [LOCAL_PLUGIN_ID]: existingPath } });

    // First run stages and leaves a .local-build.json; run it twice so "changed" is false the 2nd time.
    installLocal([], { local: ctx.plugin }, { run: ctx.run, out: ctx.out, err: ctx.err, home: ctx.home, platform: 'linux', cwd: ctx.plugin });
    ctx.calls.length = 0;

    const code = installLocal([], { local: ctx.plugin }, {
      run: ctx.run, out: ctx.out, err: ctx.err, home: ctx.home, platform: 'linux', cwd: ctx.plugin,
    });
    assert.equal(code, 0);
    const subs = ctx.calls.map((c) => c.join(' '));
    assert.ok(!subs.some((s) => s.startsWith('claude plugin install')));
    assert.ok(!subs.some((s) => s.startsWith('claude plugin uninstall')));
    assert.ok(subs.some((s) => s.startsWith('bash')));
  });

  it('cache without dist/index.js forces a refresh even when the fingerprint is unchanged', () => {
    const existingPath = path.join(tmp, 'existing-install-no-dist');
    fs.mkdirSync(existingPath, { recursive: true });
    writeFile(path.join(existingPath, 'install.sh'), '#!/usr/bin/env bash\n');
    // deliberately NOT calling makeDist(existingPath)
    const ctx = setup({ installedEntries: { [LOCAL_PLUGIN_ID]: existingPath } });
    const code = installLocal([], { local: ctx.plugin }, {
      run: ctx.run, out: ctx.out, err: ctx.err, home: ctx.home, platform: 'linux', cwd: ctx.plugin,
    });
    assert.equal(code, 0);
    const subs = ctx.calls.map((c) => c.join(' '));
    assert.ok(subs.some((s) => s.startsWith('claude plugin install')));
  });

  it('re-reads installPath after uninstall+install completes, and runs install.sh from the staging dir Claude Code loads', () => {
    const oldInstallPath = path.join(tmp, 'old2');
    fs.mkdirSync(oldInstallPath, { recursive: true });
    writeFile(path.join(oldInstallPath, 'install.sh'), '#!/usr/bin/env bash\n');
    makeDist(oldInstallPath);
    const ctx = setup({ installedEntries: { [LOCAL_PLUGIN_ID]: oldInstallPath } });

    const newInstallPath = path.join(tmp, 'brand-new-install-path');
    const originalRun = ctx.run;
    const run = (cmd, args, opts) => {
      if (cmd === 'claude' && args[1] === 'install') {
        fs.mkdirSync(newInstallPath, { recursive: true });
        writeFile(path.join(newInstallPath, 'install.sh'), '#!/usr/bin/env bash\n');
        makeDist(newInstallPath);
        ctx.writeInstalled({ [LOCAL_PLUGIN_ID]: newInstallPath });
        ctx.calls.push([cmd, ...args]);
        return { status: 0 };
      }
      return originalRun(cmd, args, opts);
    };

    const code = installLocal([], { local: ctx.plugin }, {
      run, out: ctx.out, err: ctx.err, home: ctx.home, platform: 'linux', cwd: ctx.plugin,
    });
    assert.equal(code, 0);
    // A directory marketplace runs the plugin from the staging dir, not from installPath, so
    // install.sh (and its Step 7 vector deps) must target the staging dir.
    const bashCall = ctx.calls.find((c) => c[0] === 'bash');
    const stage = path.join(ctx.home, '.total-recall', 'local-marketplace', 'plugins', 'total-recall');
    assert.deepEqual(bashCall, ['bash', path.join(stage, 'install.sh'), '--plugin-root', stage]);
  });

  it('exits 1 when installPath is missing after install', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    makeDist(plugin);
    fs.mkdirSync(path.join(plugin, '.git'));
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const run = (cmd, args) => {
      if (cmd === 'git' && args[0] === 'ls-files') return { status: 0, stdout: '.claude-plugin/plugin.json\npackage.json\n' };
      if (cmd === 'claude' && args[0] === '--version') return { status: 0 };
      if (cmd === 'claude') return { status: 0 }; // marketplace add / install "succeed" but never populate installed_plugins.json
      return { status: 0, stdout: '' };
    };
    const err = [];
    const code = installLocal([], { local: plugin }, { run, out: () => {}, err: (s) => err.push(s), home, platform: 'linux', cwd: plugin });
    assert.equal(code, 1);
    assert.ok(err.some((s) => /install\.sh/.test(s)));
  });

  it('--local + ours already installed: exits 1, continues with --force', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    makeDist(plugin);
    fs.mkdirSync(path.join(plugin, '.git'));
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const installedPluginsPath = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
    fs.mkdirSync(path.dirname(installedPluginsPath), { recursive: true });
    fs.writeFileSync(installedPluginsPath, JSON.stringify({ version: 2, plugins: { [PLUGIN_ID]: [{ scope: 'user', installPath: '/cache/ours' }] } }));

    const run = (cmd, args) => {
      if (cmd === 'git' && args[0] === 'ls-files') return { status: 0, stdout: '.claude-plugin/plugin.json\npackage.json\n' };
      if (cmd === 'claude' && args[0] === '--version') return { status: 0 };
      if (cmd === 'claude' && args[1] === 'install') {
        const installPath = path.join(home, '.claude', 'plugins', 'cache', LOCAL_MARKETPLACE_NAME, 'total-recall', 'v1');
        fs.mkdirSync(installPath, { recursive: true });
        writeFile(path.join(installPath, 'install.sh'), '#!/usr/bin/env bash\n');
        makeDist(installPath);
        fs.writeFileSync(installedPluginsPath, JSON.stringify({
          version: 2,
          plugins: { [PLUGIN_ID]: [{ scope: 'user', installPath: '/cache/ours' }], [LOCAL_PLUGIN_ID]: [{ scope: 'user', installPath }] },
        }));
        return { status: 0 };
      }
      return { status: 0, stdout: '' };
    };
    const err1 = [];
    const noForce = installLocal([], { local: plugin }, { run, out: () => {}, err: (s) => err1.push(s), home, platform: 'linux', cwd: plugin });
    assert.equal(noForce, 1);
    assert.ok(err1.some((s) => /already installed/.test(s)));

    const err2 = [];
    const withForce = installLocal([], { local: plugin, force: true }, { run, out: () => {}, err: (s) => err2.push(s), home, platform: 'linux', cwd: plugin });
    assert.equal(withForce, 0);
  });
});

describe('installLocal without claude', () => {
  it('runs install.sh --plugin-root <staging>/plugins/total-recall', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    makeDist(plugin);
    fs.mkdirSync(path.join(plugin, '.git'));
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const calls = [];
    const run = (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'git' && args[0] === 'ls-files') return { status: 0, stdout: '.claude-plugin/plugin.json\npackage.json\n' };
      if (cmd === 'claude') return { status: 1 }; // not found
      if (cmd === 'bash') return { status: 0 };
      return { status: 0, stdout: '' };
    };
    const code = installLocal([], { local: plugin }, { run, out: () => {}, err: () => {}, home, platform: 'linux', cwd: plugin });
    assert.equal(code, 0);
    const bashCall = calls.find((c) => c[0] === 'bash');
    assert.match(bashCall.join(' '), /local-marketplace.*plugins.*total-recall.*install\.sh --plugin-root/);
  });
});

describe('Windows without Git Bash', () => {
  it('exits EX_UNAVAILABLE', () => {
    const plugin = path.join(tmp, 'plugin');
    makePluginDir(plugin);
    makeDist(plugin);
    fs.mkdirSync(path.join(plugin, '.git'));
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const run = (cmd, args) => {
      if (cmd === 'git' && args[0] === 'ls-files') return { status: 0, stdout: '.claude-plugin/plugin.json\npackage.json\n' };
      if (cmd === 'claude') return { status: 1 };
      if (cmd === 'bash') return { status: 1 };
      if (cmd === 'npm.cmd') return { status: 0 }; // dist/ is already prebuilt by makeDist(); just let ci/build "succeed"
      return { status: 1, stdout: '' };
    };
    const code = installLocal([], { local: plugin }, { run, out: () => {}, err: () => {}, home, platform: 'win32', env: {}, cwd: plugin });
    assert.equal(code, EX_UNAVAILABLE);
  });
});

describe('consistency with the plugin build', () => {
  it('DIST_ARTIFACTS matches the --outfile targets in plugins/total-recall/package.json', () => {
    const pkgPath = new URL('../plugins/total-recall/package.json', import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const outfiles = new Set();
    for (const script of Object.values(pkg.scripts ?? {})) {
      for (const m of String(script).matchAll(/--outfile=dist\/([^\s]+)/g)) outfiles.add(m[1]);
    }
    assert.ok(outfiles.size > 0, 'expected at least one --outfile in the plugin package.json');
    assert.deepEqual([...outfiles].sort(), [...DIST_ARTIFACTS].sort());
  });
});
