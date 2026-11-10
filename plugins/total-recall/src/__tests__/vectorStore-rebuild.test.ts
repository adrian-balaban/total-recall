import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { EventEmitter } from 'events';

// The REAL rebuildNativeBindings (the default __rebuildImpl is a no-op under
// NODE_ENV=test). node:child_process and node:fs are mocked at the module
// boundary, so nothing is ever spawned and node_modules is never touched.
// The rebuild is async (spawn, not spawnSync) so the MCP event loop keeps
// answering while npm compiles; the fake child below emits its own events.

const spawn = vi.fn();
const existsSync = vi.fn();

async function load() {
  vi.resetModules();
  vi.doMock('node:child_process', () => ({ spawn }));
  vi.doMock('node:fs', async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    return { ...actual, existsSync };
  });
  return (await import('../vectorStore.js')).__testRebuildNativeBindings;
}

const NPM_CLI = path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
const NPM_CLI_ALT = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

// existsSync answers by suffix: the better-sqlite3 dir and the chosen npm-cli path.
function fsHas(...present: string[]) {
  existsSync.mockImplementation((p: string) => present.some((s) => String(p) === s || String(p).endsWith(s)));
}
const BSQ = path.join('node_modules', 'better-sqlite3');

type FakeChild = EventEmitter & { stderr: EventEmitter & { setEncoding: () => void }; kill: ReturnType<typeof vi.fn> };

// A child that, on the next tick, writes `stderr` and closes with `code`
// (or emits `error` instead, when given).
function fakeChild({ code = 0, stderr, error }: { code?: number | null; stderr?: string; error?: Error } = {}): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  child.kill = vi.fn(() => { setImmediate(() => child.emit('close', null)); return true; });
  setImmediate(() => {
    if (error) { child.emit('error', error); return; }
    if (stderr !== undefined) child.stderr.emit('data', stderr);
    child.emit('close', code);
  });
  return child;
}

beforeEach(() => {
  spawn.mockReset();
  existsSync.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('node:child_process');
  vi.doUnmock('node:fs');
});

describe('rebuildNativeBindings', () => {
  it('does nothing when better-sqlite3 is not installed under the plugin root', async () => {
    fsHas();
    const rebuild = await load();
    expect(await rebuild()).toEqual({ attempted: false, ok: false });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('runs npm-cli.js through the current node binary (no shell) when it is found', async () => {
    fsHas(BSQ, NPM_CLI);
    spawn.mockImplementation(() => fakeChild({ code: 0 }));
    const rebuild = await load();
    expect(await rebuild()).toEqual({ attempted: true, ok: true });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawn.mock.calls[0]!;
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([NPM_CLI, 'rebuild', 'better-sqlite3']);
    expect(opts.shell).toBeUndefined();
    expect(String(opts.cwd)).not.toMatch(/src$/); // plugin root, not the src dir
  });

  it('never lets npm write to stdout (the MCP stdio channel)', async () => {
    fsHas(BSQ, NPM_CLI);
    spawn.mockImplementation(() => fakeChild({ code: 0 }));
    const rebuild = await load();
    await rebuild();
    const [, , opts] = spawn.mock.calls[0]!;
    expect(opts.stdio[1]).toBe('ignore');
  });

  it('falls back to the second npm-cli.js location', async () => {
    fsHas(BSQ, NPM_CLI_ALT);
    spawn.mockImplementation(() => fakeChild({ code: 0 }));
    const rebuild = await load();
    await rebuild();
    expect(spawn.mock.calls[0]![1][0]).toBe(NPM_CLI_ALT);
  });

  it('falls back to `npm` through the shell when npm-cli.js cannot be found', async () => {
    fsHas(BSQ);
    spawn.mockImplementation(() => fakeChild({ code: 0 }));
    const rebuild = await load();
    expect(await rebuild()).toEqual({ attempted: true, ok: true });
    const [cmd, args, opts] = spawn.mock.calls[0]!;
    expect(cmd).toBe('npm');
    expect(args).toEqual(['rebuild', 'better-sqlite3']);
    expect(opts.shell).toBe(true);
  });

  it('reports the exit code and the last 500 chars of stderr on failure', async () => {
    fsHas(BSQ, NPM_CLI);
    spawn.mockImplementation(() => fakeChild({ code: 1, stderr: 'x'.repeat(600) + 'END' }));
    const rebuild = await load();
    const res = await rebuild();
    expect(res.attempted).toBe(true);
    expect(res.ok).toBe(false);
    expect(res.detail).toBe(`exit 1: ${'x'.repeat(497)}END`);
  });

  it('reports the spawn error message when the child emits an error', async () => {
    fsHas(BSQ, NPM_CLI);
    spawn.mockImplementation(() => fakeChild({ error: new Error('ENOENT') }));
    const rebuild = await load();
    expect(await rebuild()).toEqual({ attempted: true, ok: false, detail: 'exit n/a: ENOENT' });
  });

  it('reports an empty detail when a failing child wrote no stderr', async () => {
    fsHas(BSQ, NPM_CLI);
    spawn.mockImplementation(() => fakeChild({ code: 2 }));
    const rebuild = await load();
    expect((await rebuild()).detail).toBe('exit 2:');
  });

  it('kills the child and reports a timeout when the build runs too long', async () => {
    fsHas(BSQ, NPM_CLI);
    const child = new EventEmitter() as FakeChild;
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
    child.kill = vi.fn(() => { child.emit('close', null); return true; });
    spawn.mockReturnValue(child);
    const rebuild = await load();
    vi.useFakeTimers();
    const pending = rebuild();
    await vi.advanceTimersByTimeAsync(600_000);
    const res = await pending;
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(res).toEqual({ attempted: true, ok: false, detail: 'timed out after 600s' });
  });

  it('catches a throwing spawn', async () => {
    fsHas(BSQ, NPM_CLI);
    spawn.mockImplementation(() => { throw new Error('EACCES'); });
    const rebuild = await load();
    expect(await rebuild()).toEqual({ attempted: true, ok: false, detail: 'threw: EACCES' });
  });
});
