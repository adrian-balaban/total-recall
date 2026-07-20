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

// ─── Dynamic dimension handling ───────────────────────────────────────────────

describe('vectorStore — dynamic dimension migration', () => {
  const tmpDb = path.join(os.tmpdir(), `tr-vec-dim-${process.pid}.db`);
  let execMock: ReturnType<typeof vi.fn>;
  let prepareGet: ReturnType<typeof vi.fn>;
  let prepareAll: ReturnType<typeof vi.fn>;
  let prepareRun: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    execMock = vi.fn();
    prepareGet = vi.fn().mockReturnValue(undefined);
    prepareAll = vi.fn().mockReturnValue([]);
    prepareRun = vi.fn();

    vi.doMock('sqlite-vec', () => ({ load: vi.fn() }));
    vi.doMock('better-sqlite3', () => ({
      default: vi.fn(function (this: any) {
        this.exec = execMock;
        this.prepare = vi.fn().mockReturnValue({
          run: prepareRun,
          all: prepareAll,
          get: prepareGet,
        });
      }),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { fs.unlinkSync(tmpDb); } catch {}
  });

  function createSql(dim: number): string {
    return `CREATE VIRTUAL TABLE vec_memories USING vec0(key TEXT PRIMARY KEY, embedding FLOAT[${dim}] distance_metric=cosine)`;
  }

  it('creates the vector table using the first embedding dimension', async () => {
    const { upsertVector } = await import('../vectorStore.js');
    await upsertVector(tmpDb, 'k/a', [1, 2, 3]);

    const createCalls = execMock.mock.calls.filter((c: any) => String(c[0]).includes('CREATE VIRTUAL TABLE'));
    expect(createCalls.length).toBe(1);
    expect((createCalls[0] as any[])[0]).toMatch(/FLOAT\[3\]/);
    expect((createCalls[0] as any[])[0]).toMatch(/distance_metric=cosine/i);
  });

  it('migrates the table when the stored dimension differs from the embedding', async () => {
    prepareGet.mockReturnValue({ sql: createSql(384) });
    const { upsertVector } = await import('../vectorStore.js');

    await upsertVector(tmpDb, 'k/a', [1, 2, 3]); // dimension 3, but table is 384

    expect(execMock).toHaveBeenCalledWith('DROP TABLE vec_memories');
    const createCalls = execMock.mock.calls.filter((c: any) => String(c[0]).includes('CREATE VIRTUAL TABLE'));
    expect(createCalls.length).toBe(1);
    expect((createCalls[0] as any[])[0]).toMatch(/FLOAT\[3\]/);
  });

  it('keeps an existing table when dimension and metric already match', async () => {
    prepareGet.mockReturnValue({ sql: createSql(3) });
    const { upsertVector } = await import('../vectorStore.js');

    await upsertVector(tmpDb, 'k/a', [1, 2, 3]);

    expect(execMock).not.toHaveBeenCalledWith('DROP TABLE vec_memories');
    const createCalls = execMock.mock.calls.filter((c: any) => String(c[0]).includes('CREATE VIRTUAL TABLE'));
    expect(createCalls.length).toBe(0);
  });

  it('migrates the table when distance_metric is not cosine', async () => {
    prepareGet.mockReturnValue({ sql: 'CREATE VIRTUAL TABLE vec_memories USING vec0(key TEXT PRIMARY KEY, embedding FLOAT[3] distance_metric=l2);' });
    const { upsertVector } = await import('../vectorStore.js');

    await upsertVector(tmpDb, 'k/a', [1, 2, 3]);

    expect(execMock).toHaveBeenCalledWith('DROP TABLE vec_memories');
    const createCalls = execMock.mock.calls.filter((c: any) => String(c[0]).includes('CREATE VIRTUAL TABLE'));
    expect(createCalls.length).toBe(1);
    expect((createCalls[0] as any[])[0]).toMatch(/distance_metric=cosine/i);
  });

  it('deleteVector and listVectorKeys tolerate a missing vec_memories table', async () => {
    // Simulate the first vector operation failing with a "no such table" error.
    const noSuchTable = new Error('no such table: vec_memories');
    prepareAll.mockImplementation(() => { throw noSuchTable; });
    prepareRun.mockImplementation(() => { throw noSuchTable; });

    const { deleteVector, listVectorKeys } = await import('../vectorStore.js');
    await expect(deleteVector(tmpDb, 'k/a')).resolves.toBeUndefined();
    await expect(listVectorKeys(tmpDb)).resolves.toEqual([]);
  });

  // REVIEW 1.5: the read path must NOT drop the stored table when the query
  // embedding dim differs from the stored dim. A single recall with a stale-dim
  // query (embedding model changed) would otherwise wipe every stored vector.
  it('searchVector does NOT drop the table on a dim mismatch — returns [] and records the error', async () => {
    prepareGet.mockReturnValue({ sql: createSql(384) });
    const { searchVector } = await import('../vectorStore.js');
    const { errors } = await import('../state.js');
    const before = errors.length;

    const res = await searchVector(tmpDb, [1, 2, 3], 5); // query dim 3, stored dim 384

    expect(res).toEqual([]);
    expect(execMock).not.toHaveBeenCalledWith('DROP TABLE vec_memories');
    expect(errors.length).toBeGreaterThan(before);
    expect(errors[errors.length - 1]!.msg).toMatch(/query embedding dim 3 != stored/);
  });

  it('upsertVector ignores an empty embedding array', async () => {
    const { upsertVector } = await import('../vectorStore.js');
    await upsertVector(tmpDb, 'k/empty', []);
    // No CREATE VIRTUAL TABLE call should be issued for an empty vector.
    const createCalls = execMock.mock.calls.filter((c: any) => String(c[0]).includes('CREATE VIRTUAL TABLE'));
    expect(createCalls.length).toBe(0);
  });

  it('getVectors returns an empty map without querying when keys is empty', async () => {
    const { getVectors } = await import('../vectorStore.js');
    const res = await getVectors(tmpDb, []);
    expect(res).toEqual(new Map());
    expect(prepareAll).not.toHaveBeenCalled();
  });

  it('getVectors tolerates a missing vec_memories table', async () => {
    prepareAll.mockImplementation(() => { throw new Error('no such table: vec_memories'); });
    const { getVectors } = await import('../vectorStore.js');
    const res = await getVectors(tmpDb, ['k/a']);
    expect(res).toEqual(new Map());
  });
});
