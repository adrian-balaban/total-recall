import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// PLAN-COPILOT-WITH-CLAUDE-FINAL step 2: GUI-launched hosts (the Claude Code VS Code
// extension, Copilot) have no node and no claude on PATH. Run the scripts under
// `env -i` with a bare PATH and a fake HOME that only has the discoverable locations.

const SCRIPTS = path.resolve(__dirname, '..', '..', 'hooks', 'scripts');
const OK = spawnSync('bash', ['--version']).status === 0;
const suite = OK ? describe : describe.skip;

suite('PATH resolvers (_resolve-claude.sh, start-server.sh)', () => {
  let home: string;
  let root: string;
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-path-'));
    // a bundled claude in the VS Code extension dir
    const bin = path.join(home, '.vscode/extensions/anthropic.claude-code-2.1.9-linux-x64/resources/native-binary');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\necho bundled-claude\n', { mode: 0o755 });
    // an older one that must lose to the newer one (version sort)
    const old = path.join(home, '.vscode/extensions/anthropic.claude-code-2.1.10-linux-x64/resources/native-binary');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'claude'), '#!/bin/sh\necho newest-claude\n', { mode: 0o755 });
    // node only under nvm, not on PATH
    const nvmBin = path.join(home, '.nvm/versions/node/v99.0.0/bin');
    fs.mkdirSync(nvmBin, { recursive: true });
    fs.symlinkSync(process.execPath, path.join(nvmBin, 'node'));
    // a plugin root whose dist/index.js proves which node ran it
    root = path.join(home, 'plugin');
    fs.mkdirSync(path.join(root, 'hooks/scripts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'dist'));
    fs.copyFileSync(path.join(SCRIPTS, '_resolve-node.sh'), path.join(root, 'hooks/scripts/_resolve-node.sh'));
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync(path.join(SCRIPTS, '..', '..', 'scripts', 'start-server.sh'), path.join(root, 'scripts/start-server.sh'));
    fs.writeFileSync(path.join(root, 'dist/index.js'), 'process.stdout.write("server-ran")');
  });
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  const run = (cmd: string) =>
    spawnSync('bash', ['-c', cmd], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: home } });

  it('_resolve-claude.sh finds the newest extension-bundled claude when PATH has none', () => {
    const r = run(`. ${SCRIPTS}/_resolve-claude.sh; printf %s "$CLAUDE_BIN"`);
    expect(r.stdout).toContain('claude-code-2.1.10');
  });

  it('_resolve-claude.sh leaves CLAUDE_BIN empty when nothing is found', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-path-empty-'));
    const r = spawnSync('/bin/bash', ['-c', `. ${SCRIPTS}/_resolve-claude.sh; printf %s "[$CLAUDE_BIN]"`],
      { encoding: 'utf8', env: { PATH: '/nonexistent', HOME: empty } });
    fs.rmSync(empty, { recursive: true, force: true });
    expect(r.stdout).toBe('[]');
  });

  it('start-server.sh runs dist/index.js with an nvm node when PATH has no node', () => {
    const r = run(`bash ${root}/scripts/start-server.sh`);
    expect(r.stdout).toBe('server-ran'); // nothing else on stdout (MCP transport)
    expect(r.status).toBe(0);
  });

  it('start-server.sh exits 1 with a stderr message and empty stdout when node is missing', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-path-nonode-'));
    // drop the system-node fallbacks so the result does not depend on this machine
    const resolver = path.join(root, 'hooks/scripts/_resolve-node.sh');
    fs.writeFileSync(resolver, fs.readFileSync(resolver, 'utf8').replace('/usr/local/bin/node /usr/bin/node /opt/homebrew/bin/node', ''));
    // a PATH with the coreutils the script needs, but no node
    const tools = path.join(empty, 'bin');
    fs.mkdirSync(tools);
    for (const t of ['bash', 'dirname', 'ls', 'sort', 'tail']) {
      const p = spawnSync('/bin/sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim();
      fs.symlinkSync(p, path.join(tools, t));
    }
    const r = spawnSync('/bin/bash', [`${root}/scripts/start-server.sh`],
      { encoding: 'utf8', env: { PATH: tools, HOME: empty } });
    fs.rmSync(empty, { recursive: true, force: true });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('node not found');
  });
});
