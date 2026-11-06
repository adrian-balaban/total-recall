import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => { process.env.HOME = '/tmp/tr-org-sync-' + process.pid; });

const cfg = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../paths.js', async (orig) => ({ ...(await orig<typeof import('../paths.js')>()), loadConfig: () => cfg.value }));

import { afterToolResult, orgSyncMode, __testSetStarter } from '../org-sync.js';
import { errors } from '../state.js';

const calls: Array<{ script: string; payload: any }> = [];

beforeEach(() => {
  calls.length = 0;
  cfg.value = {};
  __testSetStarter((script, payload) => calls.push({ script, payload: JSON.parse(payload) }));
});
afterEach(() => __testSetStarter(null));

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
