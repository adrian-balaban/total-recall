import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => { process.env.HOME = '/tmp/tr-org-sync-' + process.pid; });

const cfg = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../paths.js', async (orig) => ({ ...(await orig<typeof import('../paths.js')>()), loadConfig: () => cfg.value }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterToolResult, orgSyncMode, startHookScript, __testSetStarter, __testSetScript } from '../org-sync.js';
import { errors } from '../state.js';

const calls: Array<{ script: string; payload: any }> = [];

beforeEach(() => {
  calls.length = 0;
  cfg.value = {};
  __testSetStarter((script, payload) => calls.push({ script, payload: JSON.parse(payload) }));
});
afterEach(() => { __testSetStarter(null); __testSetScript(null); });

describe('org sync in server mode (ADR orgSync)', () => {
  it('defaults to hook mode, where the server starts nothing', () => {
    expect(orgSyncMode()).toBe('hook');
    afterToolResult('store_memory', { title: 'x' }, { key: 'org/a/b' });
    expect(calls).toEqual([]);
  });

  it('server mode starts the hook script with the payload the hook would have received', () => {
    cfg.value = { orgSync: 'server' };
    afterToolResult('store_memory', { title: 'x' }, { key: 'org/a/b' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.script).toMatch(/hooks\/scripts\/sync-org-memory\.sh$/);
    expect(calls[0]!.payload).toEqual({ tool_name: 'store_memory', tool_input: { key: 'org/a/b', force: false }, tool_response: { key: 'org/a/b' } });
  });

  it('forwards force on delete_memory and handles update_memory', () => {
    cfg.value = { orgSync: 'server' };
    afterToolResult('delete_memory', { key: 'org/a/b', force: true }, { message: 'deleted' });
    afterToolResult('update_memory', { key: 'org/a/c' }, { key: 'org/a/c' });
    expect(calls.map((c) => [c.payload.tool_name, c.payload.tool_input.key, c.payload.tool_input.force])).toEqual([
      ['delete_memory', 'org/a/b', true],
      ['update_memory', 'org/a/c', false],
    ]);
  });

  it('ignores personal keys and other tools', () => {
    cfg.value = { orgSync: 'server' };
    afterToolResult('store_memory', {}, { key: 'knowledge/a' });
    afterToolResult('recall_memory', {}, { key: 'org/a/b' });
    expect(calls).toEqual([]);
  });

  it('never throws: a failing starter is recorded, not raised', () => {
    cfg.value = { orgSync: 'server' };
    __testSetStarter(() => { throw new Error('spawn blew up'); });
    const before = errors.length;
    expect(() => afterToolResult('store_memory', {}, { key: 'org/a/b' })).not.toThrow();
    expect(errors.slice(before).some((e) => e.msg.includes('spawn blew up'))).toBe(true);
  });
});

describe('org sync (server mode): details that used to go unchecked', () => {
  it('takes the key from the tool arguments when the result carries none (delete_memory)', () => {
    cfg.value = { orgSync: 'server' };
    afterToolResult('delete_memory', { key: 'org/x/y' }, { message: 'deleted' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.payload.tool_response).toEqual({ key: 'org/x/y' });
  });

  it('copes with a missing result and missing arguments', () => {
    cfg.value = { orgSync: 'server' };
    expect(() => afterToolResult('store_memory', undefined, undefined)).not.toThrow();
    expect(calls).toEqual([]);
  });

  it('records an error and starts nothing when the sync script is missing', () => {
    cfg.value = { orgSync: 'server' };
    __testSetScript('/nonexistent/sync-org-memory.sh');
    const before = errors.length;
    afterToolResult('store_memory', {}, { key: 'org/a/b' });
    expect(calls).toEqual([]);
    expect(errors.slice(before).map((e) => e.msg).join('\n')).toMatch(/\/nonexistent\/sync-org-memory\.sh not found; the memory stays local/);
  });

  it('uses the real hook script of the plugin by default', () => {
    cfg.value = { orgSync: 'server' };
    afterToolResult('store_memory', {}, { key: 'org/a/b' });
    expect(calls[0]!.script).toBe(path.resolve(__dirname, '..', '..', 'hooks', 'scripts', 'sync-org-memory.sh'));
    expect(fs.existsSync(calls[0]!.script)).toBe(true);
  });
});

describe('startHookScript (the real process start)', () => {
  const wait = async (f: string, ms = 5000): Promise<string> => {
    const t0 = Date.now();
    while (!fs.existsSync(f) || fs.readFileSync(f, 'utf8').split('\n').length < 3) {
      if (Date.now() - t0 > ms) throw new Error('script did not run');
      await new Promise((r) => setTimeout(r, 25));
    }
    return fs.readFileSync(f, 'utf8');
  };

  it('runs the script with bash, the payload on stdin and ORG_SYNC_FROM_SERVER=1', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-orgsync-'));
    const out = path.join(d, 'out.txt');
    const script = path.join(d, 's.sh');
    fs.writeFileSync(script, `#!/usr/bin/env bash\nIN=$(cat)\nprintf '%s\\n%s\\n%s\\n' "$ORG_SYNC_FROM_SERVER" "$IN" "$0" > "${out}.tmp" && mv "${out}.tmp" "${out}"\n`);
    try {
      startHookScript(script, '{"hello":"world"}');
      const lines = (await wait(out)).split('\n');
      expect(lines[0]).toBe('1');
      expect(lines[1]).toBe('{"hello":"world"}');
      expect(lines[2]).toBe(script);   // bash got the script path as its argument
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  it('does not wait for the script and does not keep the server alive for it', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-orgsync-'));
    const script = path.join(d, 'slow.sh');
    fs.writeFileSync(script, '#!/usr/bin/env bash\ncat > /dev/null\nsleep 1\n');
    const t0 = Date.now();
    startHookScript(script, '{}');
    expect(Date.now() - t0).toBeLessThan(500);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('records an error when bash itself cannot be started', async () => {
    const savedPath = process.env.PATH;
    process.env.PATH = '/nonexistent-bin-dir';
    const before = errors.length;
    try { startHookScript('/tmp/whatever.sh', '{}'); } finally { process.env.PATH = savedPath; }
    const t0 = Date.now();
    while (errors.length === before && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 25));
    expect(errors.slice(before).map((e) => e.msg).join('\n')).toMatch(/could not start whatever\.sh/);
  });

  it('survives a script that exits without reading its input', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-orgsync-'));
    const script = path.join(d, 'quick.sh');
    fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n');
    expect(() => startHookScript(script, 'x'.repeat(200000))).not.toThrow();
    await new Promise((r) => setTimeout(r, 200));
    fs.rmSync(d, { recursive: true, force: true });
  });
});
