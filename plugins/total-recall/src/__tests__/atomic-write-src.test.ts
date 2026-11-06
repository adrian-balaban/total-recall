import { describe, it, expect, afterEach, vi } from 'vitest';

// ES module namespaces of node built-ins cannot be spied on, so `fs` is replaced by call-through
// wrappers; a test overrides one function through `fsOverride` and every call goes to the real fs otherwise.
const fsOverride = vi.hoisted(() => ({} as Record<string, ((...a: any[]) => any) | undefined>));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const wrap = (name: string) => (...a: any[]) => (fsOverride[name] ?? (actual as any)[name])(...a);
  return { ...actual, default: actual, writeFileSync: wrap('writeFileSync'), renameSync: wrap('renameSync'),
    fsyncSync: wrap('fsyncSync'), openSync: wrap('openSync'), closeSync: wrap('closeSync') };
});

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { atomicWrite } from '../atomic-write.js';

// src/atomic-write.ts is the write-tmp, fsync, rename helper behind index.json and the SessionStart
// cache (the .mjs twin used by the standalone scripts is tested in atomic-write.test.ts). It reports
// failures to a sink instead of throwing, because its callers run from timers and exit handlers.

let scratch = '';
const dir = (): string => (scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-aw-src-')));
afterEach(() => {
  for (const k of Object.keys(fsOverride)) delete fsOverride[k];
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = '';
});
const leaked = (d: string): string[] => fs.readdirSync(d).filter((f) => f.includes('.tmp.'));

describe('atomicWrite (src)', () => {
  it('[TR-W1] writes the data, creates missing parent folders and leaves no .tmp behind', () => {
    const p = path.join(dir(), 'a', 'b', 'index.json');
    atomicWrite(p, '{"x":1}');
    expect(fs.readFileSync(p, 'utf8')).toBe('{"x":1}');
    expect(leaked(path.dirname(p))).toEqual([]);
  });

  it('replaces an existing file completely', () => {
    const p = path.join(dir(), 'f.txt');
    fs.writeFileSync(p, 'old old old old');
    atomicWrite(p, 'new');
    expect(fs.readFileSync(p, 'utf8')).toBe('new');
  });

  it('uses a different random temporary name on every write', async () => {
    const realWrite = (await vi.importActual<typeof import('fs')>('fs')).writeFileSync;
    const p = path.join(dir(), 'f.txt');
    const names = new Set<string>();
    fsOverride.writeFileSync = (f: any, d: any, o: any) => { names.add(String(f)); return realWrite(f, d, o); };
    atomicWrite(p, '1');
    atomicWrite(p, '2');
    expect(names.size).toBe(2);
    for (const n of names) expect(n).toMatch(/\.tmp\.[0-9a-f]{12}$/);
  });

  it('reports a failed temporary write to the sink, does not throw, and keeps the last good file', () => {
    const d = dir();
    const p = path.join(d, 'f.txt');
    fs.writeFileSync(p, 'good');
    fsOverride.writeFileSync = () => { throw new Error('ENOSPC: no space left'); };
    const errors: string[] = [];
    expect(() => atomicWrite(p, 'bad', (m) => errors.push(m))).not.toThrow();
    delete fsOverride.writeFileSync;
    expect(fs.readFileSync(p, 'utf8')).toBe('good');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('tmp-write failed');
    expect(errors[0]).toContain('last-good left intact');
    expect(errors[0]).toContain('ENOSPC');
  });

  it('falls back to a direct write when the rename fails, and removes the temporary file', () => {
    const d = dir();
    const p = path.join(d, 'f.txt');
    fsOverride.renameSync = () => { throw new Error('EXDEV: cross-device'); };
    const errors: string[] = [];
    atomicWrite(p, 'landed', (m) => errors.push(m));
    delete fsOverride.renameSync;
    expect(fs.readFileSync(p, 'utf8')).toBe('landed');
    expect(errors).toEqual([]);
    expect(leaked(d)).toEqual([]);
  });

  it('reports both errors when the rename and the fallback write fail (target is a folder)', () => {
    const d = dir();
    const p = path.join(d, 'target');
    fs.mkdirSync(p);
    const errors: string[] = [];
    expect(() => atomicWrite(p, 'x', (m) => errors.push(m))).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('rename-fallback');
    expect(errors[0]).toMatch(/rename=.*; write=/);
    expect(leaked(d)).toEqual([]);
    expect(fs.statSync(p).isDirectory()).toBe(true);
  });

  it('is best-effort about fsync: a failing fsync does not fail the write', () => {
    const p = path.join(dir(), 'f.txt');
    fsOverride.fsyncSync = () => { throw new Error('EINVAL'); };
    const errors: string[] = [];
    atomicWrite(p, 'ok', (m) => errors.push(m));
    delete fsOverride.fsyncSync;
    expect(fs.readFileSync(p, 'utf8')).toBe('ok');
    expect(errors).toEqual([]);
  });

  it('is best-effort about the directory fsync as well, and closes the descriptors it opens', async () => {
    const p = path.join(dir(), 'f.txt');
    const closed: number[] = [];
    const opened: number[] = [];
    const real = await vi.importActual<typeof import('fs')>('fs');
    const openReal = real.openSync;
    const closeReal = real.closeSync;
    fsOverride.openSync = (...a: any[]) => { const fd = (openReal as any)(...a); opened.push(fd); return fd; };
    fsOverride.closeSync = (fd: number) => { closed.push(fd); return closeReal(fd); };
    fsOverride.fsyncSync = () => { throw new Error('EINVAL'); };
    atomicWrite(p, 'ok');
    expect(closed.sort()).toEqual(opened.sort());
    expect(opened.length).toBe(2);   // the temporary file and the folder
  });

  it('works without a sink', () => {
    const d = dir();
    const p = path.join(d, 'target');
    fs.mkdirSync(p);
    expect(() => atomicWrite(p, 'x')).not.toThrow();
  });
});
