import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// The REAL rebuildNativeBindings (the default __rebuildImpl is a no-op under
// NODE_ENV=test). node:child_process and node:fs are mocked at the module
// boundary, so nothing is ever spawned and node_modules is never touched.

const spawnSync = vi.fn();
const existsSync = vi.fn();

async function load() {
  vi.resetModules();
  vi.doMock('node:child_process', () => ({ spawnSync }));
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

beforeEach(() => {
  spawnSync.mockReset();
  existsSync.mockReset();
});
afterEach(() => {
  vi.doUnmock('node:child_process');
  vi.doUnmock('node:fs');
});

describe('rebuildNativeBindings', () => {
  it('does nothing when better-sqlite3 is not installed under the plugin root', async () => {
    fsHas();
    const rebuild = await load();
    expect(await rebuild()).toEqual({ attempted: false, ok: false });
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('runs npm-cli.js through the current node binary (no shell) when it is found', async () => {
    fsHas(BSQ, NPM_CLI);
    spawnSync.mockReturnValue({ status: 0 });
    const rebuild = await load();
    expect(await rebuild()).toEqual({ attempted: true, ok: true });
    expect(spawnSync).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnSync.mock.calls[0]!;
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([NPM_CLI, 'rebuild', 'better-sqlite3']);
    expect(opts.shell).toBeUndefined();
    expect(opts.timeout).toBe(180000);
    expect(String(opts.cwd)).not.toMatch(/src$/); // plugin root, not the src dir
  });

  it('falls back to the second npm-cli.js location', async () => {
    fsHas(BSQ, NPM_CLI_ALT);
    spawnSync.mockReturnValue({ status: 0 });
    const rebuild = await load();
    await rebuild();
    expect(spawnSync.mock.calls[0]![1][0]).toBe(NPM_CLI_ALT);
  });

  it('falls back to `npm` through the shell when npm-cli.js cannot be found', async () => {
    fsHas(BSQ);
    spawnSync.mockReturnValue({ status: 0 });
    const rebuild = await load();
    expect(await rebuild()).toEqual({ attempted: true, ok: true });
    const [cmd, args, opts] = spawnSync.mock.calls[0]!;
    expect(cmd).toBe('npm');
    expect(args).toEqual(['rebuild', 'better-sqlite3']);
    expect(opts.shell).toBe(true);
  });

  it('reports the exit code and the last 500 chars of stderr on failure', async () => {
    fsHas(BSQ, NPM_CLI);
    spawnSync.mockReturnValue({ status: 1, stderr: 'x'.repeat(600) + 'END' });
    const rebuild = await load();
    const res = await rebuild();
    expect(res.attempted).toBe(true);
    expect(res.ok).toBe(false);
    expect(res.detail).toBe(`exit 1: ${'x'.repeat(497)}END`);
  });

  it('reports the spawn error message when spawnSync returns an error', async () => {
    fsHas(BSQ, NPM_CLI);
    spawnSync.mockReturnValue({ status: null, error: new Error('ETIMEDOUT') });
    const rebuild = await load();
    const res = await rebuild();
    expect(res).toEqual({ attempted: true, ok: false, detail: 'exit n/a: ETIMEDOUT' });
  });

  it('treats non-string stderr as empty', async () => {
    fsHas(BSQ, NPM_CLI);
    spawnSync.mockReturnValue({ status: 2, stderr: undefined });
    const rebuild = await load();
    expect((await rebuild()).detail).toBe('exit 2:');
  });

  it('catches a throwing spawnSync', async () => {
    fsHas(BSQ, NPM_CLI);
    spawnSync.mockImplementation(() => { throw new Error('EACCES'); });
    const rebuild = await load();
    expect(await rebuild()).toEqual({ attempted: true, ok: false, detail: 'threw: EACCES' });
  });
});
