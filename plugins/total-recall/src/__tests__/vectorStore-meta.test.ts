import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// getVecMeta / dropVectorTable against a REAL sqlite-vec database in a tmp dir.
// Skipped when the optional native deps are absent. vi.resetModules() gives each
// test a fresh vectorStore (its db handle and path are module-level singletons).

const nativeOk = await (async () => {
  try {
    await import('sqlite-vec');
    const Database = (await import('better-sqlite3')).default;
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!nativeOk)('vectorStore — vec_meta and dropVectorTable (real db)', () => {
  let dir: string;
  let db: string;

  beforeEach(() => {
    vi.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-vec-meta-'));
    db = path.join(dir, 'vectors.db');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('getVecMeta is null on a fresh db with no vec_meta table', async () => {
    const vs = await import('../vectorStore.js');
    expect(await vs.getVecMeta(db)).toBeNull();
  });

  it('getVecMeta returns the fingerprint written by an upsert', async () => {
    const vs = await import('../vectorStore.js');
    await vs.upsertVector(db, 'k/a', [0.1, 0.2, 0.3, 0.4]);
    const meta = await vs.getVecMeta(db);
    expect(meta).not.toBeNull();
    expect(meta!.dim).toBe(4);
    expect(typeof meta!.model).toBe('string');
    expect(meta!.model.length).toBeGreaterThan(0);
  });

  it('getVecMeta reports dim null and model "" when those rows are absent', async () => {
    const vs = await import('../vectorStore.js');
    const d = await vs.__testsGetDb(db);
    d.exec('CREATE TABLE vec_meta (key TEXT PRIMARY KEY, value TEXT)');
    expect(await vs.getVecMeta(db)).toEqual({ model: '', dim: null });
  });

  it('dropVectorTable removes both tables and a later upsert recreates them', async () => {
    const vs = await import('../vectorStore.js');
    await vs.upsertVector(db, 'k/a', [0.1, 0.2, 0.3, 0.4]);
    expect(await vs.listVectorKeys(db)).toEqual(['k/a']);
    await vs.dropVectorTable(db);
    expect(await vs.getVecMeta(db)).toBeNull();
    // Recreate at a different dim: the dropped table must not pin the old one.
    await vs.upsertVector(db, 'k/b', [0.1, 0.2]);
    expect((await vs.getVecMeta(db))!.dim).toBe(2);
    expect(await vs.listVectorKeys(db)).toEqual(['k/b']);
  });

  it('dropVectorTable records the error instead of throwing when the DROP fails', async () => {
    const vs = await import('../vectorStore.js');
    const { errors } = await import('../state.js');
    const d = await vs.__testsGetDb(db);
    d.close(); // every later exec() throws "The database connection is not open"
    await expect(vs.dropVectorTable(db)).resolves.toBeUndefined();
    expect(errors.some((e) => e.msg.startsWith('dropVectorTable:'))).toBe(true);
  });

  it('getVecMeta returns null (not a throw) when the db handle is closed', async () => {
    const vs = await import('../vectorStore.js');
    const d = await vs.__testsGetDb(db);
    d.close();
    expect(await vs.getVecMeta(db)).toBeNull();
  });
});
