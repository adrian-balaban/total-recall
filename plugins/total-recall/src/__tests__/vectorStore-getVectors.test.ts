import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Exercises getVectors against the real sqlite-vec/better-sqlite3 native deps
// (no vi.doMock). Kept in its own file — vectorStore.test.ts registers
// sqlite-vec/better-sqlite3 mocks via vi.doMock in several describe blocks,
// and vi.unmock is hoisted to file-load time by Vitest, so it cannot be used
// mid-file to "undo" a doMock registered later in the same file's beforeEach
// hooks. A separate file has no such mocks to begin with.

describe('vectorStore — getVectors batch read (real sqlite-vec)', () => {
  const tmpDb = path.join(os.tmpdir(), `tr-vec-getvectors-${process.pid}.db`);

  afterEach(() => {
    try { fs.unlinkSync(tmpDb); } catch {}
  });

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
});
