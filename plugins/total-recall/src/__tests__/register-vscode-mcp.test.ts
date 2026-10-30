import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
// @ts-expect-error plain .mjs script without types
import { register, mergeServer } from '../../scripts/register-vscode-mcp.mjs';

const ROOT = '/opt/total-recall';
let file: string;

beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tr-vscode-')), 'Code', 'User', 'mcp.json');
});

describe('register-vscode-mcp (install.sh --vscode)', () => {
  it('creates the file with the servers schema and an absolute launcher path', () => {
    expect(register(file, ROOT)).toBe('written');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      servers: { 'total-recall': { type: 'stdio', command: `${ROOT}/scripts/start-server.sh` } },
    });
  });

  it('is idempotent and keeps foreign servers and other keys', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ inputs: [1], servers: { other: { command: 'x' } } }));
    expect(register(file, ROOT)).toBe('written');
    expect(register(file, ROOT)).toBe('unchanged');
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(j.inputs).toEqual([1]);
    expect(j.servers.other).toEqual({ command: 'x' });
    expect(j.servers['total-recall'].command).toBe(`${ROOT}/scripts/start-server.sh`);
  });

  it('replaces a stale total-recall entry in place', () => {
    const out = mergeServer({ servers: { 'total-recall': { command: 'node' } } }, ROOT);
    expect(out.servers['total-recall']).toEqual({ type: 'stdio', command: `${ROOT}/scripts/start-server.sh` });
  });

  it('leaves a non-strict-JSON file (comments) untouched and exits 2 from the CLI', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const raw = '{\n  // my servers\n  "servers": {}\n}\n';
    fs.writeFileSync(file, raw);
    expect(register(file, ROOT)).toBe('unparseable');
    const r = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/register-vscode-mcp.mjs'), file, ROOT], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(fs.readFileSync(file, 'utf8')).toBe(raw);
  });

  it('install.sh documents --vscode in --help and INSTALL.md', () => {
    const root = path.resolve(__dirname, '../..');
    const help = spawnSync('bash', [path.join(root, 'install.sh'), '--help'], { encoding: 'utf8' }).stdout;
    expect(help).toContain('--vscode');
    expect(fs.readFileSync(path.join(root, 'INSTALL.md'), 'utf8')).toContain('./install.sh --vscode');
  });
});
