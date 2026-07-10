import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// ─── Degradation path: sqlite-vec not installed ──────────────────────────────

describe('vectorStore — graceful degradation', () => {
  const tmpDb = path.join(os.tmpdir(), `tr-vec-test-${process.pid}.db`);

  beforeEach(() => {
    vi.resetModules();
    vi.doMock('sqlite-vec', () => { throw new Error('not installed'); });
    vi.doMock('better-sqlite3', () => { throw new Error('not installed'); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { fs.unlinkSync(tmpDb); } catch {}
  });

  it('upsertVector resolves without throwing', async () => {
    const { upsertVector } = await import('../vectorStore.js');
    await expect(upsertVector(tmpDb, 'k/a', [0.1, 0.2])).resolves.toBeUndefined();
  });

  it('searchVector returns empty array', async () => {
    const { searchVector } = await import('../vectorStore.js');
    expect(await searchVector(tmpDb, [0.1, 0.2])).toEqual([]);
  });

  it('deleteVector resolves without throwing', async () => {
    const { deleteVector } = await import('../vectorStore.js');
    await expect(deleteVector(tmpDb, 'k/a')).resolves.toBeUndefined();
  });

  it('all operations remain no-ops after first failed load', async () => {
    const { upsertVector, searchVector, deleteVector, listVectorKeys } = await import('../vectorStore.js');
    await upsertVector(tmpDb, 'k1', [1, 2, 3]);
    const res = await searchVector(tmpDb, [1, 2, 3]);
    await deleteVector(tmpDb, 'k1');
    const keys = await listVectorKeys(tmpDb);
    expect(res).toEqual([]);
    expect(keys).toBeNull();
  });
});

// ─── Path mismatch error ──────────────────────────────────────────────────────

describe('vectorStore — dbPath mismatch', () => {
  const tmpDb1 = path.join(os.tmpdir(), `tr-vec-path1-${process.pid}.db`);
  const tmpDb2 = path.join(os.tmpdir(), `tr-vec-path2-${process.pid}.db`);

  beforeEach(() => {
    vi.resetModules();
    vi.doMock('sqlite-vec', () => ({ load: vi.fn() }));
    vi.doMock('better-sqlite3', () => ({
      default: vi.fn(function (this: any) {
        this.exec = vi.fn();
        this.prepare = vi.fn().mockReturnValue({
          run: vi.fn(),
          all: vi.fn().mockReturnValue([]),
          get: vi.fn().mockReturnValue(undefined),
        });
      }),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const p of [tmpDb1, tmpDb2]) try { fs.unlinkSync(p); } catch {}
  });

  it('throws when called with a different dbPath after initialisation', async () => {
    const { upsertVector } = await import('../vectorStore.js');
    await upsertVector(tmpDb1, 'k/a', [0.1]);
    await expect(upsertVector(tmpDb2, 'k/b', [0.2])).rejects.toThrow(/already initialized/);
  });
});

// ─── Success path: sqlite-vec available ──────────────────────────────────────

describe('vectorStore — success path with real sqlite', () => {
  const tmpDb = path.join(os.tmpdir(), `tr-vec-real-${process.pid}.db`);

  beforeEach(() => {
    vi.resetModules();
    // Mock sqlite-vec.load to be a no-op and better-sqlite3 with in-memory DB
    vi.doMock('sqlite-vec', () => ({ load: vi.fn() }));
    vi.doMock('better-sqlite3', () => ({
      default: vi.fn(function (this: any) {
        this.exec = vi.fn();
        this.prepare = vi.fn().mockReturnValue({
          run: vi.fn(),
          all: vi.fn().mockReturnValue([{ key: 'k/a', distance: 0.1 }]),
          get: vi.fn().mockReturnValue(undefined),
        });
      }),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { fs.unlinkSync(tmpDb); } catch {}
  });

  it('upsertVector calls prepare().run() when db available', async () => {
    const { upsertVector } = await import('../vectorStore.js');
    await expect(upsertVector(tmpDb, 'k/a', [0.1, 0.2, 0.3])).resolves.toBeUndefined();
  });

  it('searchVector returns results when db available', async () => {
    const { searchVector } = await import('../vectorStore.js');
    const res = await searchVector(tmpDb, [0.1, 0.2, 0.3], 5);
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
    expect(res[0]).toHaveProperty('key');
    expect(res[0]).toHaveProperty('score');
  });

  it('deleteVector calls prepare().run() when db available', async () => {
    const { deleteVector } = await import('../vectorStore.js');
    await expect(deleteVector(tmpDb, 'k/a')).resolves.toBeUndefined();
  });

  it('listVectorKeys returns keys when db available', async () => {
    const { listVectorKeys } = await import('../vectorStore.js');
    const res = await listVectorKeys(tmpDb);
    expect(res).toEqual(['k/a']);
  });
});
