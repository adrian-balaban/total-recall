#!/usr/bin/env node
// One-command install bootstrap for the total-recall plugin.
//
// This package ships NO plugin code. It runs the two `claude plugin` commands and then the
// installed plugin's own install.sh. The plugin itself comes only from the GitHub `release`
// branch (built by CI), so provenance is unchanged. See PLAN-NPX-INSTALL-BOOTSTRAP.md.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKETPLACE = 'adrian-balaban/total-recall';
export const MARKETPLACE_NAME = 'my-claude-plugins';
export const PLUGIN_ID = `total-recall@${MARKETPLACE_NAME}`;
export const EX_UNAVAILABLE = 69;

const USAGE = `total-recall — install the total-recall memory plugin (Claude Code, Gemini, VS Code)

Usage: npx @adrian-balaban/total-recall [options]

Adds the marketplace, installs ${PLUGIN_ID}, then runs the plugin's install.sh.
Every option below is passed to install.sh as is.

  -y, --yes                     no prompts (also the default without a terminal)
  --complete | --no-vector      install profile
  --gemini | --vscode           also register for Gemini/Antigravity or VS Code
  --statusline                  install the status line
  --org-repo URL                shared team repo
  --allowed-email-domain D      let a work email domain through the privacy filter

Own options:
  --force      continue even if another plugin called "total-recall" is installed
  --version    print this launcher's version
  -h, --help   print this text
`;

/** Parse argv: own flags are removed, everything else is forwarded verbatim. */
export function parseArgs(argv) {
  const own = { help: false, version: false, force: false };
  const forward = [];
  for (const a of argv) {
    if (a === '-h' || a === '--help') own.help = true;
    else if (a === '--version') own.version = true;
    else if (a === '--force') own.force = true;
    else forward.push(a);
  }
  return { own, forward };
}

/** Compare two dotted versions numerically ("1.6.10" > "1.6.9"). Non-numeric parts count as 0. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Newest version directory name under `dir` that holds an install.sh, or null. */
export function newestVersionDir(dir, fsImpl = fs) {
  let names;
  try { names = fsImpl.readdirSync(dir); } catch { return null; }
  const withInstaller = names.filter((n) => fsImpl.existsSync(path.join(dir, n, 'install.sh')));
  if (!withInstaller.length) return null;
  return withInstaller.sort(compareVersions).at(-1);
}

/** Where `claude` may be: PATH first, then the VS Code/Cursor extension's bundled binary, then ~/.local/bin. */
export function claudeCandidates(home, fsImpl = fs) {
  const out = [];
  for (const root of ['.vscode', '.vscode-insiders', '.cursor']) {
    const ext = path.join(home, root, 'extensions');
    let names = [];
    try { names = fsImpl.readdirSync(ext); } catch { /* none */ }
    const found = names
      .filter((n) => n.startsWith('anthropic.claude-code-'))
      .sort((x, y) => compareVersions(y.replace(/^anthropic\.claude-code-/, ''), x.replace(/^anthropic\.claude-code-/, ''))); // newest first
    for (const n of found) out.push(path.join(ext, n, 'resources', 'native-binary', 'claude'));
  }
  out.push(path.join(home, '.local', 'bin', 'claude'));
  return out;
}

/** Find the claude CLI. `run(cmd,args)` returns { status }. Returns a command string or null. */
export function resolveClaude({ run, home, fsImpl = fs, platform = process.platform }) {
  const probe = platform === 'win32' ? 'claude.exe' : 'claude';
  if (run(probe, ['--version']).status === 0) return probe;
  for (const c of claudeCandidates(home, fsImpl)) {
    if (fsImpl.existsSync(c) && run(c, ['--version']).status === 0) return c;
  }
  return null;
}

/** bash to run install.sh with. On Windows only Git Bash works. Returns null when none is found. */
export function resolveBash({ platform = process.platform, env = process.env, fsImpl = fs, run }) {
  if (platform !== 'win32') return 'bash';
  if (run('bash', ['--version']).status === 0) return 'bash';
  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')]) {
    if (!base) continue;
    const p = path.win32.join(base, 'Git', 'bin', 'bash.exe');
    if (fsImpl.existsSync(p)) return p;
  }
  return null;
}

/**
 * Installed-plugin state from the cache dir: 'ours' (our marketplace), 'foreign' (another
 * plugin called total-recall under a different marketplace) or 'none'.
 */
export function installState(home, fsImpl = fs) {
  const base = path.join(home, '.claude', 'plugins', 'cache');
  let markets = [];
  try { markets = fsImpl.readdirSync(base); } catch { return 'none'; }
  if (markets.includes(MARKETPLACE_NAME) && newestVersionDir(path.join(base, MARKETPLACE_NAME, 'total-recall'), fsImpl)) return 'ours';
  for (const m of markets) {
    if (m !== MARKETPLACE_NAME && fsImpl.existsSync(path.join(base, m, 'total-recall'))) return 'foreign';
  }
  return 'none';
}

/** The whole flow. All side effects come in through `deps`, so tests spawn nothing. */
export function main(argv, deps = {}) {
  const {
    run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: opts.inherit ? 'inherit' : 'ignore' }),
    out = (s) => process.stdout.write(s + '\n'),
    err = (s) => process.stderr.write(s + '\n'),
    home = os.homedir(),
    fsImpl = fs,
    platform = process.platform,
    env = process.env,
    nodeVersion = process.versions.node,
    version = readVersion(),
  } = deps;

  const { own, forward } = parseArgs(argv);
  if (own.help) { out(USAGE); return 0; }
  if (own.version) { out(version); return 0; }

  if (parseInt(nodeVersion.split('.')[0], 10) < 18) { err(`total-recall: Node 18 or newer is required (found ${nodeVersion}).`); return 1; }

  const claude = resolveClaude({ run, home, fsImpl, platform });
  if (!claude) {
    err('total-recall: the `claude` CLI was not found. Install Claude Code first: https://docs.claude.com/en/docs/claude-code/setup');
    return 1;
  }

  const state = installState(home, fsImpl);
  if (state === 'foreign' && !own.force) {
    err('total-recall: another plugin named "total-recall" is installed from a different marketplace. ' +
        `This installer only manages ${PLUGIN_ID}. Remove the other one, or re-run with --force.`);
    return 1;
  }
  if (state !== 'ours') {
    out(`Adding the marketplace ${MARKETPLACE} …`);
    if (run(claude, ['plugin', 'marketplace', 'add', MARKETPLACE], { inherit: true }).status !== 0) {
      err('total-recall: could not add the marketplace. Check your network and that `gh`/git can reach github.com.');
      return 1;
    }
    out(`Installing ${PLUGIN_ID} …`);
    if (run(claude, ['plugin', 'install', PLUGIN_ID], { inherit: true }).status !== 0) {
      err(`total-recall: \`claude plugin install ${PLUGIN_ID}\` failed. Run it by hand to see the reason.`);
      return 1;
    }
  } else {
    out(`${PLUGIN_ID} is already installed; running its setup again (safe to re-run).`);
  }

  const dir = path.join(home, '.claude', 'plugins', 'cache', MARKETPLACE_NAME, 'total-recall');
  const ver = newestVersionDir(dir, fsImpl);
  if (!ver) {
    err(`total-recall: the plugin was installed but ${dir} has no install.sh. Run \`claude plugin list\` to check.`);
    return 1;
  }

  const bash = resolveBash({ platform, env, fsImpl, run });
  if (!bash) {
    err('total-recall: on Windows, install.sh needs Git Bash (https://gitforwindows.org/). Install it and run this command again.');
    return EX_UNAVAILABLE;
  }

  const r = run(bash, [path.join(dir, ver, 'install.sh'), ...forward], { inherit: true });
  return r.status ?? 1;
}

function readVersion() {
  try {
    const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
  } catch { return 'unknown'; }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
