#!/usr/bin/env node
// Local-build install channel (--local): build the plugin from this clone and install it
// through a directory marketplace, instead of the git-subdir marketplace on GitHub.
//
// Why a directory marketplace at all: `claude plugin install <path>` does not work (it only
// accepts `plugin[@marketplace]`); only `claude plugin marketplace add <dir>` (which needs
// `<dir>/.claude-plugin/marketplace.json`) does. See backlog-and-plans/PLAN-INSTALARE-LOCALA-FINAL.md.
//
// This module imports ONLY node:* and ./cli.mjs (for readInstalledPlugin/installState and the
// shared constants) — never anything under plugins/, so it stays installable as part of the npm
// bootstrap package without shipping any plugin code (test/pack-guard.mjs enforces the package
// contents; this file's import list is itself pinned by test/local.test.mjs).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  LOCAL_MARKETPLACE_NAME, LOCAL_PLUGIN_ID, EX_UNAVAILABLE,
  installState, readInstalledPlugin, resolveBash,
} from './cli.mjs';

/** The six build artifacts `npm run build` produces in the plugin's dist/ (plugin package.json build:* scripts). */
export const DIST_ARTIFACTS = [
  'index.js', 'frontmatter.mjs', 'build-index-cache.mjs', 'privacy-filter.mjs', 'spec-config.mjs', 'spec-fields.mjs',
];

/** Entries skipped when staging without git (DF4, fail-closed allowlist for dotfiles). */
const DOT_ALLOWLIST = new Set(['.claude-plugin', '.mcp.json']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'reports', 'tmp', '.stryker-tmp']);

/**
 * Resolve the plugin directory from a user-given path, cwd, or autodetection: a direct path to
 * the plugin, a path to the repo root (plugin at plugins/total-recall), or walking up from cwd.
 * Marker: a directory holding both .claude-plugin/plugin.json and package.json.
 */
export function resolveLocalPluginRoot({ given, cwd = process.cwd(), fsImpl = fs }) {
  const isPluginDir = (p) => fsImpl.existsSync(path.join(p, '.claude-plugin', 'plugin.json')) && fsImpl.existsSync(path.join(p, 'package.json'));
  const candidates = [];
  if (given) {
    const g = path.resolve(given);
    candidates.push(g, path.join(g, 'plugins', 'total-recall'));
  }
  let dir = path.resolve(cwd);
  for (let i = 0; i < 20; i++) {
    candidates.push(dir, path.join(dir, 'plugins', 'total-recall'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const c of candidates) {
    if (isPluginDir(c)) return path.resolve(c);
  }
  return null;
}

/** npm invocation for this platform. Windows needs shell:true for npm.cmd (CVE-2024-27980). */
export function npmCommand(platform = process.platform) {
  return platform === 'win32' ? { cmd: 'npm.cmd', shell: true } : { cmd: 'npm' };
}

/**
 * Ensures `pluginDir/dist` has all DIST_ARTIFACTS, building if needed (DF5). `npm ci` only runs
 * when node_modules/.package-lock.json is missing or older than package-lock.json; `npm run
 * build` always runs under --local (esbuild, seconds) because a stale dist/ after `git pull`
 * must never be served silently.
 */
export function ensureBuilt({ pluginDir, run, fsImpl = fs, platform = process.platform, out = () => {} }) {
  const { cmd, shell } = npmCommand(platform);
  const lockMarker = path.join(pluginDir, 'node_modules', '.package-lock.json');
  const lockFile = path.join(pluginDir, 'package-lock.json');
  const needsCi = (() => {
    if (!fsImpl.existsSync(lockMarker)) return true;
    try {
      const a = fsImpl.statSync(lockMarker).mtimeMs;
      const b = fsImpl.statSync(lockFile).mtimeMs;
      return a < b;
    } catch { return true; }
  })();

  if (needsCi) {
    const r = run(cmd, ['ci', '--no-audit', '--no-fund'], { cwd: pluginDir, shell, inherit: true });
    if (r.status !== 0) {
      throw new Error(`local build needs Node ≥18 and npm registry access; run \`npm ci && npm run build\` in ${pluginDir} to see the error`);
    }
  }

  const r = run(cmd, ['run', 'build'], { cwd: pluginDir, shell, inherit: true });
  if (r.status !== 0) {
    throw new Error(`local build needs Node ≥18 and npm registry access; run \`npm ci && npm run build\` in ${pluginDir} to see the error`);
  }
  // npm run build runs sync:version first, which may rewrite versioned files (plugin.json,
  // gemini-extension.json, root npx manifest) when the clone's versions are out of sync. This is
  // normal `npm run build` behavior; report it, never block on it.
  out('Built the plugin bundle (npm run build).');

  const missing = DIST_ARTIFACTS.filter((f) => !fsImpl.existsSync(path.join(pluginDir, 'dist', f)));
  if (missing.length) {
    throw new Error(`build completed but dist/ is still missing: ${missing.join(', ')}`);
  }
}

/** List files to stage: tracked + untracked-not-ignored, via `git ls-files -co --exclude-standard`. */
function gitFileList({ pluginDir, run }) {
  const r = run('git', ['ls-files', '-co', '--exclude-standard'], { cwd: pluginDir, capture: true });
  if (r.status !== 0) return null;
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** True if pluginDir or any ancestor (up to repo-ish bound) holds a .git entry. */
function hasGitAncestor(pluginDir, fsImpl) {
  let dir = pluginDir;
  for (let i = 0; i < 20; i++) {
    if (fsImpl.existsSync(path.join(dir, '.git'))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
  return false;
}

/** Fallback file walk when there is no .git: fail-closed allowlist for dotfiles (DF4, [R6]). */
function walkFileList(pluginDir, fsImpl) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(pluginDir, rel);
    let entries;
    try { entries = fsImpl.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const name = e.name;
      const relPath = rel ? path.join(rel, name) : name;
      if (name.startsWith('.') && !DOT_ALLOWLIST.has(name)) continue;
      if (SKIP_DIRS.has(name)) continue;
      if (name.endsWith('.tsbuildinfo')) continue;
      const absPath = path.join(pluginDir, relPath);
      let isDir;
      try { isDir = e.isDirectory ? e.isDirectory() : fsImpl.statSync(absPath).isDirectory(); } catch { continue; }
      if (isDir) walk(relPath);
      else out.push(relPath);
    }
  };
  walk('');
  return out;
}

/** List the files to stage from pluginDir, honoring DF4's fail-closed git-vs-fallback rule. */
export function listStagingFiles({ pluginDir, run, fsImpl = fs }) {
  const gitPresent = hasGitAncestor(pluginDir, fsImpl);
  if (gitPresent) {
    const files = gitFileList({ pluginDir, run });
    if (files === null) {
      throw new Error(`a .git directory is present but \`git\` failed in ${pluginDir}. ` +
        'Install git, or copy the plugin without dev files and pass --plugin-root to a clean copy.');
    }
    return files;
  }
  return walkFileList(pluginDir, fsImpl);
}

/** sha256 over sorted relative paths + file contents — used to detect whether a rebuild changed anything. */
function fingerprintFiles(pluginDir, files, fsImpl) {
  const hash = crypto.createHash('sha256');
  for (const f of [...files].sort()) {
    hash.update(f);
    try { hash.update(fsImpl.readFileSync(path.join(pluginDir, f))); } catch { /* skip unreadable */ }
  }
  return hash.digest('hex');
}

function copyPreservingMode(src, dest, fsImpl) {
  fsImpl.mkdirSync(path.dirname(dest), { recursive: true });
  fsImpl.copyFileSync(src, dest);
  try {
    const mode = fsImpl.statSync(src).mode;
    fsImpl.chmodSync(dest, mode);
  } catch { /* best effort */ }
}

function copyDirRecursive(srcDir, destDir, fsImpl) {
  let entries;
  try { entries = fsImpl.readdirSync(srcDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const s = path.join(srcDir, e.name);
    const d = path.join(destDir, e.name);
    const isDir = e.isDirectory ? e.isDirectory() : fsImpl.statSync(s).isDirectory();
    if (isDir) copyDirRecursive(s, d, fsImpl);
    else copyPreservingMode(s, d, fsImpl);
  }
}

/**
 * Stages a clean "local release" at ~/.total-recall/local-marketplace: a directory marketplace
 * (.claude-plugin/marketplace.json naming LOCAL_MARKETPLACE_NAME, source "./plugins/total-recall")
 * plus plugins/total-recall/ (tracked+untracked-not-ignored files, plus dist/, never node_modules).
 * Atomic via a sibling temp dir + rename. Returns { stagingDir, pluginStageDir, fingerprint, changed }.
 */
export function stageLocalRelease({ pluginDir, home, run, fsImpl = fs, gitSha }) {
  const stagingDir = path.join(home, '.total-recall', 'local-marketplace');
  const buildMetaFile = path.join(stagingDir, '.local-build.json');

  const files = listStagingFiles({ pluginDir, run, fsImpl });
  const distFiles = DIST_ARTIFACTS.map((f) => path.join('dist', f)).filter((f) => fsImpl.existsSync(path.join(pluginDir, f)));
  const allFiles = [...new Set([...files, ...distFiles])];
  const fingerprint = fingerprintFiles(pluginDir, allFiles, fsImpl);

  let prevMeta = null;
  try { prevMeta = JSON.parse(fsImpl.readFileSync(buildMetaFile, 'utf8')); } catch { /* none yet */ }
  const changed = !prevMeta || prevMeta.fingerprint !== fingerprint;

  const tmpDir = `${stagingDir}.tmp-${process.pid}-${Date.now()}`;
  fsImpl.mkdirSync(path.join(tmpDir, '.claude-plugin'), { recursive: true });
  fsImpl.writeFileSync(
    path.join(tmpDir, '.claude-plugin', 'marketplace.json'),
    `${JSON.stringify({
      name: LOCAL_MARKETPLACE_NAME,
      owner: { name: 'total-recall (local build)' },
      plugins: [{ name: 'total-recall', source: './plugins/total-recall', description: 'total-recall (local build from a git clone)' }],
    }, null, 2)}\n`,
  );

  const pluginStageDir = path.join(tmpDir, 'plugins', 'total-recall');
  for (const rel of allFiles) {
    copyPreservingMode(path.join(pluginDir, rel), path.join(pluginStageDir, rel), fsImpl);
  }
  // dist/ may contain files not individually listed above if listStagingFiles already included
  // it (e.g. git-tracked dist in an unusual setup); otherwise copy the whole dir to be safe.
  copyDirRecursive(path.join(pluginDir, 'dist'), path.join(pluginStageDir, 'dist'), fsImpl);

  fsImpl.writeFileSync(
    path.join(tmpDir, '.local-build.json'),
    `${JSON.stringify({ source: pluginDir, gitSha: gitSha ?? null, fingerprint, builtAt: new Date().toISOString() }, null, 2)}\n`,
  );

  // Carry the previous staging dir's node_modules over. Claude Code runs a directory-marketplace
  // plugin straight from this staging dir (not from its plugins/cache copy), so install.sh Step 7
  // installs the vector-search deps here; dropping them on every re-stage would turn vector
  // search off until the next full npm install.
  const prevModules = path.join(stagingDir, 'plugins', 'total-recall', 'node_modules');
  if (fsImpl.existsSync(prevModules)) {
    try { fsImpl.renameSync(prevModules, path.join(pluginStageDir, 'node_modules')); } catch { /* reinstalled by install.sh */ }
  }

  // Atomic swap: remove any previous staging dir, then rename the temp dir into place.
  try { fsImpl.rmSync(stagingDir, { recursive: true, force: true }); } catch { /* none yet */ }
  fsImpl.renameSync(tmpDir, stagingDir);

  return { stagingDir, pluginStageDir: path.join(stagingDir, 'plugins', 'total-recall'), fingerprint, changed };
}

/**
 * Orchestrates the whole --local flow (DF7/DF8/DF10). Exit codes: 1 for errors, EX_UNAVAILABLE
 * (69) on Windows without Git Bash, otherwise install.sh's own exit code.
 */
export function installLocal(forward, own, deps = {}) {
  const {
    run, out = () => {}, err = () => {}, home, fsImpl = fs, platform = process.platform, cwd = process.cwd(),
    claudeDeps = { run, home, fsImpl, platform },
  } = deps;

  const given = typeof own.local === 'string' ? own.local : undefined;
  const pluginDir = resolveLocalPluginRoot({ given, cwd, fsImpl });
  if (!pluginDir) {
    err('total-recall: could not find the plugin (looked for .claude-plugin/plugin.json + package.json). ' +
      'Pass a path: --local <path to clone or plugins/total-recall>.');
    return 1;
  }

  const state = installState(home, claudeDeps.fsImpl ?? fsImpl);
  if (state === 'ours' && !own.force) {
    err(`total-recall: the marketplace plugin (${LOCAL_PLUGIN_ID.replace(LOCAL_MARKETPLACE_NAME, 'my-claude-plugins')}) is already installed. ` +
      'Switch to the local build with `claude plugin uninstall total-recall@my-claude-plugins`, or re-run with --force.');
    return 1;
  }
  if (state === 'foreign' && !own.force) {
    err('total-recall: another plugin named "total-recall" is installed from a different marketplace. ' +
      'Remove it, or re-run with --force.');
    return 1;
  }

  let gitSha;
  try {
    const r = run('git', ['-C', pluginDir, 'rev-parse', '--short', 'HEAD'], { capture: true });
    if (r.status === 0) gitSha = r.stdout.trim();
  } catch { /* optional */ }

  try {
    ensureBuilt({ pluginDir, run, fsImpl, platform, out });
  } catch (e) {
    err(`total-recall: ${e.message}`);
    return 1;
  }

  let staged;
  try {
    staged = stageLocalRelease({ pluginDir, home, run, fsImpl, gitSha });
  } catch (e) {
    err(`total-recall: ${e.message}`);
    return 1;
  }

  const claude = resolveClaudeSafe(claudeDeps);
  if (claude) {
    out(`Adding the local marketplace ${LOCAL_MARKETPLACE_NAME} …`);
    if (run(claude, ['plugin', 'marketplace', 'add', staged.stagingDir], { inherit: true }).status !== 0) {
      err('total-recall: could not add the local marketplace.');
      return 1;
    }

    let entry = readInstalledPlugin(home, LOCAL_PLUGIN_ID, fsImpl);
    const distOk = entry && fsImpl.existsSync(path.join(entry.installPath, 'dist', 'index.js'));

    if (!entry) {
      out(`Installing ${LOCAL_PLUGIN_ID} …`);
      if (run(claude, ['plugin', 'install', LOCAL_PLUGIN_ID], { inherit: true }).status !== 0) {
        err(`total-recall: \`claude plugin install ${LOCAL_PLUGIN_ID}\` failed. Run it by hand to see the reason.`);
        return 1;
      }
    } else if (staged.changed || !distOk) {
      out(`${LOCAL_PLUGIN_ID} changed; refreshing (uninstall + install) …`);
      run(claude, ['plugin', 'uninstall', LOCAL_PLUGIN_ID], { inherit: true });
      if (run(claude, ['plugin', 'install', LOCAL_PLUGIN_ID], { inherit: true }).status !== 0) {
        err(`total-recall: \`claude plugin install ${LOCAL_PLUGIN_ID}\` failed. Run it by hand to see the reason.`);
        return 1;
      }
      out('Restart running Claude Code sessions to load the new build.');
    } else {
      out(`${LOCAL_PLUGIN_ID} is unchanged; running its setup again (safe to re-run).`);
    }

    // Re-read installPath AFTER install/uninstall+install completed — never reuse a value read before ([R7]).
    entry = readInstalledPlugin(home, LOCAL_PLUGIN_ID, fsImpl);
    if (!entry || !entry.installPath || !fsImpl.existsSync(path.join(entry.installPath, 'install.sh'))) {
      err(`total-recall: the plugin was installed but no install.sh was found under its installPath. ` +
        `Run \`claude plugin list\` to check, then \`bash <installPath>/install.sh --plugin-root <installPath> ...\` by hand.`);
      return 1;
    }

    const bash = resolveBash({ platform, env: deps.env ?? process.env, fsImpl, run });
    if (!bash) {
      err('total-recall: on Windows, install.sh needs Git Bash (https://gitforwindows.org/). Install it and run this command again.');
      return EX_UNAVAILABLE;
    }
    // Set up the directory Claude Code actually loads. For a "directory" marketplace that is the
    // staging dir itself (the MCP server runs from <staging>/plugins/total-recall/dist/index.js,
    // with CLAUDE_PLUGIN_ROOT pointing there), not entry.installPath under plugins/cache —
    // installing the vector-search deps into installPath left the running server without them.
    const r = run(bash, [path.join(staged.pluginStageDir, 'install.sh'), '--plugin-root', staged.pluginStageDir, ...forward], { inherit: true });
    return r.status ?? 1;
  }

  // No claude: run install.sh directly against the staging dir. install.sh itself skips Step 3
  // (MCP registration) without claude, except for --vscode / --gemini, which register the host
  // directly from this same staging path.
  const bash = resolveBash({ platform, env: deps.env ?? process.env, fsImpl, run });
  if (!bash) {
    err('total-recall: on Windows, install.sh needs Git Bash (https://gitforwindows.org/). Install it and run this command again.');
    return EX_UNAVAILABLE;
  }
  const r = run(bash, [path.join(staged.pluginStageDir, 'install.sh'), '--plugin-root', staged.pluginStageDir, ...forward], { inherit: true });
  return r.status ?? 1;
}

function resolveClaudeSafe(deps) {
  const probe = (deps.platform ?? process.platform) === 'win32' ? 'claude.exe' : 'claude';
  try {
    if (deps.run(probe, ['--version']).status === 0) return probe;
  } catch { /* not found */ }
  return null;
}
