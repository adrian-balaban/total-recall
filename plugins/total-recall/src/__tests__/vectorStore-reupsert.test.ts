import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { upsertVector, listVectorKeys, searchVector } from '../vectorStore.js';

// Against the REAL sqlite-vec + better-sqlite3 modules — kept in its own file
// so no sibling describe block in vectorStore.test.ts mocks these out from
// under it (vi.mock calls are hoisted module-wide, not scoped to a describe).
//
// vec0 virtual tables do not honor `INSERT OR REPLACE` on their declared
// PRIMARY KEY the way a regular table does — it still throws "UNIQUE
// constraint failed" on a key that already has a row. A re-embed of the same
// key (store_memory followed by update_memory, both call embedAndUpsert) hit
// this in a real session (smoke-tested 1.3.3): the row from store_memory's
// upsert already existed when update_memory's re-embed ran the "same" upsert.

describe('vectorStore — upsertVector on an existing key (real sqlite-vec)', () => {
  const tmpDb = path.join(os.tmpdir(), `tr-vec-reupsert-${process.pid}.db`);

  afterEach(() => {
    try { fs.unlinkSync(tmpDb); } catch {}
  });

  it('re-upserting the same key does not throw and keeps exactly one row', async () => {
    await upsertVector(tmpDb, 'k/a', [1, 0, 0]);
    await expect(upsertVector(tmpDb, 'k/a', [0, 1, 0])).resolves.toBeUndefined();

    const keys = await listVectorKeys(tmpDb);
    expect(keys).toEqual(['k/a']);

    // The second embedding should be the one actually stored.
    const res = await searchVector(tmpDb, [0, 1, 0], 1);
    expect(res[0]?.key).toBe('k/a');
  });
});
