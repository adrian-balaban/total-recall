import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';

// Exercises getVectors against the real sqlite-vec/better-sqlite3 native deps
// (no vi.doMock). Kept in its own file — vectorStore.test.ts registers
// sqlite-vec/better-sqlite3 mocks via vi.doMock in several describe blocks,
// and vi.unmock is hoisted to file-load time by Vitest, so it cannot be used
// mid-file to "undo" a doMock registered later in the same file's beforeEach
// hooks. A separate file has no such mocks to begin with.

describe('vectorStore — getVectors batch read (real sqlite-vec)', () => {
  const tmpDb = path.join(os.tmpdir(), `tr-vec-getvectors-${process.pid}.db`);

  // NOTE: no afterEach unlink. vectorStore caches the better-sqlite3 handle per
  // db path (dbPromise); unlinking tmpDb between tests leaves the open handle
  // pointing at a deleted file, so the vec_memories shadow tables become readonly
  // and the next upsert throws "attempt to write a readonly database". The tmpDb
  // path is pid-scoped so there is no cross-run leakage; within a run, tests use
  // unique keys so accumulation is harmless. fs.unlinkSync at process exit is
  // unnecessary (os.tmpdir() is reaped by the OS).
  it('round-trips stored embeddings via vec_to_json, keyed by requested keys', async () => {
    const { upsertVector, getVectors } = await import('../vectorStore.js');
    await upsertVector(tmpDb, 'k/a', [0.1, 0.2, 0.3]);
    await upsertVector(tmpDb, 'k/b', [0.4, 0.5, 0.6]);

    const res = await getVectors(tmpDb, ['k/a', 'k/b', 'k/missing']);

    expect(res.size).toBe(2);
    expect(res.get('k/a')!.map((n) => Number(n.toFixed(1)))).toEqual([0.1, 0.2, 0.3]);
    expect(res.get('k/b')!.map((n) => Number(n.toFixed(1)))).toEqual([0.4, 0.5, 0.6]);
    expect(res.has('k/missing')).toBe(false);
  });

  it('11.3a (3.2): returns an empty Map when expectedDim mismatches the stored dim (rerank re-embeds fresh)', async () => {
    // The read-path dim guard: a stale vectors.db whose table was built at a
    // different embedding dim (e.g. 384 → 3 after a model swap) must NOT return
    // dimensionally-wrong vectors that would crash cosine search. It returns an
    // empty Map and records an error, so the rerank/cosine caller falls back to
    // a fresh embed instead of feeding a 3-dim vector into a 384-dim index.
    // Uses a unique key: the cached db handle persists across tests in this file
    // (afterEach unlinks the path but the open sqlite handle keeps the table),
    // so re-inserting 'k/a' would hit vec_memories' UNIQUE constraint.
    const { upsertVector, getVectors } = await import('../vectorStore.js');
    await upsertVector(tmpDb, 'k/dimMismatch', [0.1, 0.2, 0.3]); // stored dim = 3
    const res = await getVectors(tmpDb, ['k/dimMismatch'], 384); // expectedDim = 384 ≠ 3
    expect(res.size).toBe(0); // mismatch → empty Map, caller re-embeds
  });

  it('11.3a (3.2): returns vectors when expectedDim matches the stored dim', async () => {
    const { upsertVector, getVectors } = await import('../vectorStore.js');
    await upsertVector(tmpDb, 'k/dimMatch', [0.1, 0.2, 0.3]); // stored dim = 3
    const res = await getVectors(tmpDb, ['k/dimMatch'], 3); // expectedDim = 3 == 3
    expect(res.size).toBe(1);
    expect(res.has('k/dimMatch')).toBe(true);
  });
});
