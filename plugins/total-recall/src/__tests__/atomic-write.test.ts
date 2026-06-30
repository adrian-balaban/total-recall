import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { atomicWrite, cleanupInFlightTmp } from '../../scripts/atomic-write.mjs';

// #28: the standalone .mjs scripts (sync-org-memory.mjs, store-learning.mjs)
// write via atomicWrite = write-`.tmp` + rename. The window between
// writeFileSync and renameSync can leak the .tmp on a throw (rename across
// devices, ENOSPC, target-is-a-directory) or on a SIGTERM/SIGINT in the same
// window. try/finally recovers the throw path (tested below); cleanupInFlightTmp
// recovers the kill path (the signal handlers call it — tested directly, since
// the handler itself is a 2-liner that's hard to exercise deterministically).
//
// This imports the REAL shared module the scripts use (not a replica), so a
// regression in the cleanup logic fails here.

let scratch: string;

function makeScratch(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-atomic-'));
  scratch = d;
  return d;
}

afterEach(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

function leakedTmps(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => f.includes('.tmp.'));
}

describe('atomicWrite', () => {
  it('writes the full file and leaves no .tmp on success', () => {
    const dir = makeScratch();
    const p = path.join(dir, 'index.json');
    atomicWrite(p, '{"hello":"world"}');
    expect(fs.readFileSync(p, 'utf8')).toBe('{"hello":"world"}');
    expect(leakedTmps(dir)).toEqual([]);
  });

  it('cleans up the .tmp when renameSync throws (no leak)', () => {
    // Make `p` an existing EMPTY directory: writeFileSync(`<p>.tmp.<hex>`)
    // succeeds (a file in p's parent), then renameSync(file, emptyDir) throws
    // EEXIST/EISDIR. The try/finally must unlink the .tmp so it doesn't leak.
    const dir = makeScratch();
    const p = path.join(dir, 'target'); // p will BE a directory
    fs.mkdirSync(p);
    expect(() => atomicWrite(p, 'body')).toThrow();
    // No .tmp.<hex> left in the parent (dir) — the finally unlinked it.
    expect(leakedTmps(dir)).toEqual([]);
    // And p itself is untouched (still the empty dir we created).
    expect(fs.statSync(p).isDirectory()).toBe(true);
    expect(fs.readdirSync(p)).toEqual([]);
  });

  it('rethrows the original error (does not swallow it)', () => {
    const dir = makeScratch();
    const p = path.join(dir, 'target');
    fs.mkdirSync(p);
    let caught: unknown;
    try { atomicWrite(p, 'body'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(Error);
  });
});

describe('cleanupInFlightTmp', () => {
  it('is a no-op when no write is in flight (pendingTmp null)', () => {
    // No active atomicWrite → cleanupInFlightTmp must not throw and must not
    // touch the filesystem. The signal handlers call this unconditionally.
    const dir = makeScratch();
    const sentinel = path.join(dir, 'keep-me.json');
    fs.writeFileSync(sentinel, '{}');
    expect(() => cleanupInFlightTmp()).not.toThrow();
    // Sentinel untouched: cleanup only ever targets the in-flight .tmp.
    expect(fs.existsSync(sentinel)).toBe(true);
  });
});