import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as fs from 'fs';

// loadConfig() caches the parsed ~/.total-recall/config.json by mtimeMs so the hot
// paths (embeddings per embed, tfidf per search) don't re-read+re-parse every call.
// These tests pin the cache contract directly by mocking fs.statSync / readFileSync
// (ESM module namespaces aren't configurable, so vi.spyOn can't override them —
// vi.mock with a real-fs spread + two overridden methods is the ESM-safe way). Each
// case uses a unique mtime (per-file counter) so the first loadConfig() in the case
// is always a guaranteed cache miss regardless of the order vitest runs the tests
// in (within-file module state persists across tests).

const { statMock, readMock } = vi.hoisted(() => ({
  statMock: vi.fn(),
  readMock: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return { ...actual, statSync: statMock, readFileSync: readMock };
});

const fakeStats = (mtimeMs: number) => ({ mtimeMs } as unknown as fs.Stats);
let t = 1_000_000; // unique mtime per case; far from any real config's mtime
const nextT = () => (t += 1000);

// Imported AFTER vi.mock so its module-level `const config = loadConfig()` runs with
// the mocked fs (statMock returns undefined → statSync path throws → {} ; primes an
// empty cache as a clean baseline).
const { loadConfig } = await import('../paths.js');

beforeEach(() => {
  statMock.mockReset();
  readMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('loadConfig mtime cache', () => {
  it('parses config on first call and caches it (no re-read at the same mtime)', () => {
    const T = nextT();
    statMock.mockReturnValue(fakeStats(T));
    readMock.mockReturnValue('{"enableMultilingualSearch":true,"orgRepo":"r"}');
    const a = loadConfig();
    expect(a.enableMultilingualSearch).toBe(true);
    expect(a.orgRepo).toBe('r');
    expect(readMock).toHaveBeenCalledTimes(1);
    // Second call at the same mtime must hit the cache — no second readFileSync.
    const b = loadConfig();
    expect(b).toEqual(a);
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it('re-reads after the mtime changes (runtime config edit is picked up)', () => {
    const T1 = nextT();
    statMock.mockReturnValue(fakeStats(T1));
    readMock.mockReturnValue('{"embeddingProvider":"huggingface"}');
    expect(loadConfig().embeddingProvider).toBe('huggingface');
    const T2 = nextT();
    statMock.mockReturnValue(fakeStats(T2));
    readMock.mockReturnValue('{"embeddingProvider":"ollama"}');
    expect(loadConfig().embeddingProvider).toBe('ollama');
    expect(readMock).toHaveBeenCalledTimes(2);
  });

  it('returns {} and skips readFileSync when statSync throws (no config / cold start)', () => {
    statMock.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(loadConfig()).toEqual({});
    expect(readMock).not.toHaveBeenCalled();
  });

  it('resets the cache on a parse error so a later valid read re-populates', () => {
    const T1 = nextT();
    statMock.mockReturnValue(fakeStats(T1));
    readMock.mockReturnValue('not valid json');
    expect(loadConfig()).toEqual({});
    // Cache was reset on the error → a second call at the SAME mtime re-reads
    // (does not serve a stale {} from cache).
    expect(loadConfig()).toEqual({});
    expect(readMock).toHaveBeenCalledTimes(2);
    // A later valid write (new mtime, valid JSON) must be picked up.
    const T2 = nextT();
    statMock.mockReturnValue(fakeStats(T2));
    readMock.mockReturnValue('{"orgRepo":"fixed"}');
    expect(loadConfig().orgRepo).toBe('fixed');
  });
});