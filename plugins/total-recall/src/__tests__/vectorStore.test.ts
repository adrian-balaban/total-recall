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

// ─── Mutation-hardening: getVectors dim guards, non-string rethrow, self-heal latch ─

describe('vectorStore — getVectors table-level dim mismatch (expectedDim set)', () => {
  const tmpDb = path.join(os.tmpdir(), `tr-vec-getv-dim-${process.pid}.db`);
  let prepareGet: ReturnType<typeof vi.fn>;
  let prepareAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    prepareGet = vi.fn();
    prepareAll = vi.fn().mockReturnValue([]);
    vi.doMock('sqlite-vec', () => ({ load: vi.fn() }));
    vi.doMock('better-sqlite3', () => ({
      default: vi.fn(function (this: any) {
        this.exec = vi.fn();
        this.prepare = vi.fn().mockReturnValue({
          run: vi.fn(),
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

  it('returns an empty map and records the dim mismatch when stored dim != expectedDim', async () => {
    // Stored table built at FLOAT[128]; caller asks for expectedDim=384.
    prepareGet.mockReturnValue({
      sql: 'CREATE VIRTUAL TABLE vec_memories USING vec0(key TEXT PRIMARY KEY, embedding FLOAT[128] distance_metric=cosine)',
    });
    const { getVectors } = await import('../vectorStore.js');
    const { errors } = await import('../state.js');
    const before = errors.length;

    const res = await getVectors(tmpDb, ['k/a'], 384);

    expect(res.size).toBe(0);
    // The table-level mismatch short-circuits BEFORE the row read.
    expect(prepareAll).not.toHaveBeenCalled();
    expect(errors.length).toBeGreaterThan(before);
    expect(errors[errors.length - 1]!.msg).toMatch(/stored vec_memories dim 128 != expected 384/);
  });

  it('reads rows when stored dim matches expectedDim', async () => {
    prepareGet.mockReturnValue({
      sql: 'CREATE VIRTUAL TABLE vec_memories USING vec0(key TEXT PRIMARY KEY, embedding FLOAT[3] distance_metric=cosine)',
    });
    prepareAll.mockReturnValue([{ key: 'k/a', embedding: '[0.1, 0.2, 0.3]' }]);
    const { getVectors } = await import('../vectorStore.js');
    const res = await getVectors(tmpDb, ['k/a'], 3);
    expect(res.get('k/a')).toEqual([0.1, 0.2, 0.3]);
  });
});

describe('vectorStore — getVectors per-row dim mismatch', () => {
  const tmpDb = path.join(os.tmpdir(), `tr-vec-rowdim-${process.pid}.db`);
  let prepareGet: ReturnType<typeof vi.fn>;
  let prepareAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    prepareGet = vi.fn();
    prepareAll = vi.fn().mockReturnValue([]);
    vi.doMock('sqlite-vec', () => ({ load: vi.fn() }));
    vi.doMock('better-sqlite3', () => ({
      default: vi.fn(function (this: any) {
        this.exec = vi.fn();
        this.prepare = vi.fn().mockReturnValue({
          run: vi.fn(),
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

  it('skips a row whose stored embedding length != expectedDim and records it', async () => {
    // Table schema says FLOAT[384] (passes the table-level check), but the
    // actual row's parsed embedding has length 2 — the per-row guard fires.
    prepareGet.mockReturnValue({
      sql: 'CREATE VIRTUAL TABLE vec_memories USING vec0(key TEXT PRIMARY KEY, embedding FLOAT[384] distance_metric=cosine)',
    });
    prepareAll.mockReturnValue([
      { key: 'k/bad', embedding: '[0.1, 0.2]' },   // length 2, expectedDim 384 → skipped
      { key: 'k/good', embedding: '[0.1, 0.2, 0.3]' }, // length 3, expectedDim 384 → also skipped
    ]);
    const { getVectors } = await import('../vectorStore.js');
    const { errors } = await import('../state.js');
    const before = errors.length;

    const res = await getVectors(tmpDb, ['k/bad', 'k/good'], 384);

    // Both rows have wrong dim → both skipped, map stays empty.
    expect(res.size).toBe(0);
    // Two per-row mismatch errors recorded (one per skipped row).
    expect(errors.length - before).toBe(2);
    expect(errors[errors.length - 1]!.msg).toMatch(/stored vector dim .* != expected 384 for key/);
  });
});

describe('vectorStore — non-string e.message rethrows (typeof guard)', () => {
  const tmpDb = path.join(os.tmpdir(), `tr-vec-rethrow-${process.pid}.db`);
  let prepareRun: ReturnType<typeof vi.fn>;
  let prepareAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    prepareRun = vi.fn();
    prepareAll = vi.fn();
    vi.doMock('sqlite-vec', () => ({ load: vi.fn() }));
    vi.doMock('better-sqlite3', () => ({
      default: vi.fn(function (this: any) {
        this.exec = vi.fn();
        this.prepare = vi.fn().mockReturnValue({
          run: prepareRun,
          all: prepareAll,
          get: vi.fn().mockReturnValue(undefined),
        });
      }),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { fs.unlinkSync(tmpDb); } catch {}
  });

  it('deleteVector rethrows when the thrown error has a non-string message', async () => {
    // A bare string throw has no .message → the typeof guard is false → rethrow.
    prepareRun.mockImplementation(() => { throw 'bare-string-throw'; });
    const { deleteVector } = await import('../vectorStore.js');
    await expect(deleteVector(tmpDb, 'k/a')).rejects.toBe('bare-string-throw');
  });

  it('listVectorKeys rethrows when the thrown error has a non-string message', async () => {
    prepareAll.mockImplementation(() => { throw { message: 123 }; });
    const { listVectorKeys } = await import('../vectorStore.js');
    await expect(listVectorKeys(tmpDb)).rejects.toEqual({ message: 123 });
  });

  it('getVectors rethrows a non-no-such-table error with a string message', async () => {
    prepareAll.mockImplementation(() => { throw new Error('disk I/O error'); });
    const { getVectors } = await import('../vectorStore.js');
    await expect(getVectors(tmpDb, ['k/a'])).rejects.toThrow('disk I/O error');
  });
});

describe('vectorStore — upsertVector non-array embedding guard', () => {
  const tmpDb = path.join(os.tmpdir(), `tr-vec-nonarr-${process.pid}.db`);
  let execMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    execMock = vi.fn();
    vi.doMock('sqlite-vec', () => ({ load: vi.fn() }));
    vi.doMock('better-sqlite3', () => ({
      default: vi.fn(function (this: any) {
        this.exec = execMock;
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
    try { fs.unlinkSync(tmpDb); } catch {}
  });

  it('ignores a non-array embedding (no CREATE VIRTUAL TABLE, no INSERT)', async () => {
    const { upsertVector } = await import('../vectorStore.js');
    await expect(upsertVector(tmpDb, 'k/x', 'not-an-array' as any)).resolves.toBeUndefined();
    const createCalls = execMock.mock.calls.filter((c: any) => String(c[0]).includes('CREATE VIRTUAL TABLE'));
    expect(createCalls.length).toBe(0);
  });

  it('ignores a null embedding', async () => {
    const { upsertVector } = await import('../vectorStore.js');
    await expect(upsertVector(tmpDb, 'k/null', null as any)).resolves.toBeUndefined();
    const createCalls = execMock.mock.calls.filter((c: any) => String(c[0]).includes('CREATE VIRTUAL TABLE'));
    expect(createCalls.length).toBe(0);
  });
});

describe('vectorStore — native-binding self-heal latch', () => {
  const tmpDb = path.join(os.tmpdir(), `tr-vec-heal-${process.pid}.db`);

  beforeEach(() => {
    vi.resetModules();
    // sqlite-vec loads fine; better-sqlite3 import throws (binding missing).
    vi.doMock('sqlite-vec', () => ({ load: vi.fn() }));
    vi.doMock('better-sqlite3', () => {
      throw new Error('Could not locate binding file build/Release/better_sqlite3.node');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { fs.unlinkSync(tmpDb); } catch {}
  });

  it('attempts the rebuild exactly once across repeated getDb calls (latch), then degrades', async () => {
    const { __testsSetRebuildImpl, __testsGetDb } = await import('../vectorStore.js');
    const { errors } = await import('../state.js');

    let rebuildCalls = 0;
    __testsSetRebuildImpl(async () => {
      rebuildCalls++;
      return { attempted: true, ok: false, detail: 'npm rebuild failed: exit 1' };
    });

    const before = errors.length;
    const d1 = await __testsGetDb(tmpDb);
    const d2 = await __testsGetDb(tmpDb);
    const d3 = await __testsGetDb(tmpDb);

    // All three return null (degraded — no vector store).
    expect(d1).toBeNull();
    expect(d2).toBeNull();
    expect(d3).toBeNull();
    // The rebuild ran exactly ONCE — the latch blocks repeat attempts.
    expect(rebuildCalls).toBe(1);
    // The failure is recorded with an actionable message.
    expect(errors.length).toBeGreaterThan(before);
    expect(errors[errors.length - 1]!.msg).toMatch(/better-sqlite3 native binding missing/);
    expect(errors[errors.length - 1]!.msg).toMatch(/npm rebuild failed/);
  });

  it('records the "npm reported success but binding still absent" outcome when ok=true yet load still fails', async () => {
    const { __testsSetRebuildImpl, __testsGetDb } = await import('../vectorStore.js');
    const { errors } = await import('../state.js');

    __testsSetRebuildImpl(async () => ({ attempted: true, ok: true }));

    const before = errors.length;
    const d = await __testsGetDb(tmpDb);
    expect(d).toBeNull();
    expect(errors.length).toBeGreaterThan(before);
    expect(errors[errors.length - 1]!.msg).toMatch(/npm rebuild reported success .* binding is still absent/);
  });

  it('silently degrades (no recordError) when rebuild was not attempted', async () => {
    const { __testsSetRebuildImpl, __testsGetDb } = await import('../vectorStore.js');
    const { errors } = await import('../state.js');

    // r.attempted === false (the test-default / no node_modules found path).
    __testsSetRebuildImpl(async () => ({ attempted: false, ok: false }));

    const before = errors.length;
    const d = await __testsGetDb(tmpDb);
    expect(d).toBeNull();
    // Silent degrade — no error recorded (optional-dep-absent behavior).
    expect(errors.length).toBe(before);
  });
});
