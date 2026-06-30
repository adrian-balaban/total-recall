import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Success path: pipeline loads and returns embeddings ─────────────────────

describe('embeddings — success path', () => {
  beforeEach(() => vi.resetModules());

  it('returns a float array when pipeline loads and runs successfully', async () => {
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ data: new Float32Array(384).fill(0.1) })
      ),
    }));
    const { embed } = await import('../embeddings.js');
    const res = await embed('hello world');
    expect(Array.isArray(res)).toBe(true);
    expect(res!.length).toBe(384);
  });

  it('returns same array length on repeated calls (cached pipeline)', async () => {
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ data: new Float32Array(384).fill(0.5) })
      ),
    }));
    const { embed } = await import('../embeddings.js');
    const r1 = await embed('first');
    const r2 = await embed('second');
    expect(r1!.length).toBe(r2!.length);
  });

  it('isVectorAvailable returns true when pipeline loaded', async () => {
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ data: new Float32Array(384).fill(0.1) })
      ),
    }));
    const { embed, isVectorAvailable } = await import('../embeddings.js');
    await embed('probe');
    expect(isVectorAvailable()).toBe(true);
  });
});

// ─── Failure path: import succeeds but pipeline() call throws ────────────────

describe('embeddings — pipeline() call fails (catch path)', () => {
  beforeEach(() => vi.resetModules());

  it('returns null when hfPipeline() rejects (covers catch → pipeline = null)', async () => {
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockRejectedValue(new Error('model load failed')),
    }));
    const { embed } = await import('../embeddings.js');
    const res = await embed('text');
    expect(res).toBeNull();
  });

  it('isVectorAvailable returns false after failed pipeline call', async () => {
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockRejectedValue(new Error('model load failed')),
    }));
    const { embed, isVectorAvailable } = await import('../embeddings.js');
    await embed('probe');
    expect(isVectorAvailable()).toBe(false);
  });
});

// ─── Failure path: module import itself fails ─────────────────────────────────

describe('embeddings — module not installed (import throws)', () => {
  beforeEach(() => vi.resetModules());

  it('returns null when @huggingface/transformers is not installed', async () => {
    vi.doMock('@huggingface/transformers', () => { throw new Error('Cannot find module'); });
    const { embed } = await import('../embeddings.js');
    expect(await embed('text')).toBeNull();
  });

  it('returns null on second call (cached null pipeline)', async () => {
    vi.doMock('@huggingface/transformers', () => { throw new Error('Cannot find module'); });
    const { embed } = await import('../embeddings.js');
    await embed('first');
    expect(await embed('second')).toBeNull();
  });
});

// ─── Pass 7 fix #1: concurrent-load race (cache the promise, not a boolean) ────
// The boolean-before-import pattern set `loadAttempted` synchronously before the
// `await import` resolved, so a concurrent caller arriving mid-load saw the flag
// set + `pipeline` null, returned null, and embedAndUpsert's `if (vec) upsertVector`
// SILENTLY SKIPPED that key's vector upsert — a permanent hole in the vector index.
// The race is reachable: embedAndUpsert is fire-and-forget (store.ts / mutate.ts
// don't await it), so the server can take a second store_memory — or a hybrid
// recall_memory — during the seconds-to-minutes model init. This test holds the
// mock load mid-flight and fires a second embed() before releasing it.

describe('embeddings — concurrent load race (Pass 7 fix #1)', () => {
  beforeEach(() => vi.resetModules());

  it('a concurrent caller during the in-flight model load gets the same embedder, not null', async () => {
    // Gate holds hfPipeline suspended until the test releases it, simulating the
    // model-init window during which the second caller races the load. vi.doMock
    // (not hoisted vi.mock) so the factory can close over this test-local gate.
    // `resolve` starts null and is armed by the mock when the IIFE reaches the
    // gated `await hfPipeline` (one microtask after `await import`).
    const gate: { resolve: (() => void) | null } = { resolve: null };
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: async () => {
        await new Promise<void>((r) => { gate.resolve = r; });
        // Tensor-shape stub: the wrapper does Array.from(output.data).
        return async () => ({ data: new Float32Array(384).fill(0.5) });
      },
    }));
    const { embed } = await import('../embeddings.js');
    // Fire two embed() calls BEFORE the load resolves. The first triggers
    // getEmbedder and starts the IIFE (suspended at `await import`). The second
    // enters getEmbedder while the load is still in flight:
    //   - boolean-before-import BUG: loadAttempted=true + pipeline=null → returns
    //     null → embed() returns null → embedAndUpsert silently drops the vector.
    //   - promise-cached FIX: loadPromise set → awaits the SAME promise →
    //     resolves to the embedder alongside the first caller.
    const p1 = embed('alpha');
    const p2 = embed('beta');
    // Yield microtasks until the IIFE has reached the gated hfPipeline and armed
    // the resolver. The IIFE suspends first at `await import` (one microtask),
    // then at `await hfPipeline` where it sets gate.resolve. Releasing before
    // it's armed would call a stale null and hang. The bounded loop + sanity
    // assertion also turn a "mock didn't intercept → real model load → hang"
    // regression into a fast, clear failure instead of a 5s timeout.
    for (let i = 0; i < 1000 && gate.resolve === null; i++) {
      await Promise.resolve();
    }
    expect(gate.resolve).not.toBeNull();
    gate.resolve!();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(Array.isArray(r1)).toBe(true);
    expect(Array.isArray(r2)).toBe(true); // the bug would make this null
    expect((r2 as number[]).length).toBe(384);
  }, 15000);
});

// ─── #3: flushEmbeddings drains fire-and-forget embeds on the exit path ───────
// embedAndUpsert is fire-and-forget; before #3, a SIGTERM between a store_memory
// and its embed landing killed the upsert mid-flight, permanently holing the
// vector index for that key (findable via TF-IDF, invisible to hybrid search).
// flushEmbeddings tracks the in-flight promise set and is awaited by index.ts's
// shutdown() before process.exit. These tests drive the REAL embeddings module
// (doMock + dynamic import) so the pendingEmbeds Set is exercised, mocking only
// the HF pipeline + the vectorStore upsert.

describe('embeddings — flushEmbeddings drains pending upserts (#3)', () => {
  beforeEach(() => vi.resetModules());

  it('awaits a pending embed→upsert before resolving', async () => {
    const upserted: Array<{ key: string; vec: number[] }> = [];
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ data: new Float32Array(384).fill(0.7) })
      ),
    }));
    vi.doMock('../vectorStore.js', () => ({
      VECTORS_DB: '/tmp/tr-flush-test.db',
      upsertVector: vi.fn(async (_db: string, key: string, vec: number[]) => {
        upserted.push({ key, vec });
      }),
      searchVector: vi.fn().mockResolvedValue([]),
      deleteVector: vi.fn().mockResolvedValue(undefined),
      listVectorKeys: vi.fn().mockResolvedValue(null),
    }));
    const { embedAndUpsert, flushEmbeddings } = await import('../embeddings.js');
    embedAndUpsert('knowledge/x', 'some text');
    // Before #3 there was no way to await the fire-and-forget upsert; the drain
    // must land it before resolving.
    await flushEmbeddings();
    expect(upserted.length).toBe(1);
    expect(upserted[0]!.key).toBe('knowledge/x');
    expect(upserted[0]!.vec.length).toBe(384);
  });

  it('returns promptly when nothing is pending (size===0 fast path)', async () => {
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ data: new Float32Array(384).fill(0.7) })
      ),
    }));
    vi.doMock('../vectorStore.js', () => ({
      VECTORS_DB: '/tmp/tr-flush-test.db',
      upsertVector: vi.fn().mockResolvedValue(undefined),
      searchVector: vi.fn().mockResolvedValue([]),
      deleteVector: vi.fn().mockResolvedValue(undefined),
      listVectorKeys: vi.fn().mockResolvedValue(null),
    }));
    const { flushEmbeddings } = await import('../embeddings.js');
    // No embedAndUpsert called → pending set empty → the size===0 guard returns
    // immediately, without ever arming the 2s timeout (a clean shutdown stays fast).
    const start = Date.now();
    await flushEmbeddings();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('is bounded by the timeout when an upsert never resolves', async () => {
    const gate: { resolve: (() => void) | null } = { resolve: null };
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ data: new Float32Array(384).fill(0.7) })
      ),
    }));
    vi.doMock('../vectorStore.js', () => ({
      VECTORS_DB: '/tmp/tr-flush-test.db',
      upsertVector: vi.fn(async () => {
        await new Promise<void>((r) => { gate.resolve = r; });
      }),
      searchVector: vi.fn().mockResolvedValue([]),
      deleteVector: vi.fn().mockResolvedValue(undefined),
      listVectorKeys: vi.fn().mockResolvedValue(null),
    }));
    const { embedAndUpsert, flushEmbeddings } = await import('../embeddings.js');
    embedAndUpsert('knowledge/stuck', 'text');
    // The stuck upsert hangs forever; flushEmbeddings must give up at the timeout
    // and resolve anyway — the exit path can't block indefinitely on one embed.
    const start = Date.now();
    await flushEmbeddings(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(1500);
    // Release the stuck promise so the test leaves no dangling pending handle.
    gate.resolve!();
  });
});

// ─── #14: a transient embed/upsert failure is recorded, not silently swallowed ─
// Before #14, embedAndUpsert's `.catch(() => {})` discarded any upsertVector
// rejection (e.g. a sqlite I/O error mid-write) with no recordError, no stderr —
// a holed vector index with zero observability while get_stats still advertised
// vectorSearchEnabled. The catch now routes through recordError (the bounded sink
// surfaced via get_stats.recentErrors). A later store/update at the same key
// re-attempts INSERT OR REPLACE, so this is observability, not a permanent hole.

describe('embeddings — transient upsert failure is recorded (#14)', () => {
  beforeEach(() => vi.resetModules());

  it('records via recordError when upsertVector rejects', async () => {
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ data: new Float32Array(384).fill(0.7) })
      ),
    }));
    vi.doMock('../vectorStore.js', () => ({
      VECTORS_DB: '/tmp/tr-err-test.db',
      upsertVector: vi.fn(async () => { throw new Error('sqlite I/O'); }),
      searchVector: vi.fn().mockResolvedValue([]),
      deleteVector: vi.fn().mockResolvedValue(undefined),
      listVectorKeys: vi.fn().mockResolvedValue(null),
    }));
    const { embedAndUpsert, flushEmbeddings } = await import('../embeddings.js');
    const { errors } = await import('../state.js');
    const before = errors.length;
    embedAndUpsert('knowledge/holed', 'text');
    await flushEmbeddings();
    // The fire-and-forget catch ran during the drain; the error is now in the
    // shared sink with the offending key in the message.
    const newErrors = errors.slice(before);
    expect(newErrors.length).toBe(1);
    expect(newErrors[0]!.msg).toContain('embedAndUpsert(knowledge/holed)');
    expect(newErrors[0]!.msg).toContain('sqlite I/O');
  });

  it('records when the embed step itself rejects', async () => {
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockRejectedValue(new Error('inference blew up'))
      ),
    }));
    vi.doMock('../vectorStore.js', () => ({
      VECTORS_DB: '/tmp/tr-err-test.db',
      upsertVector: vi.fn().mockResolvedValue(undefined),
      searchVector: vi.fn().mockResolvedValue([]),
      deleteVector: vi.fn().mockResolvedValue(undefined),
      listVectorKeys: vi.fn().mockResolvedValue(null),
    }));
    const { embedAndUpsert, flushEmbeddings } = await import('../embeddings.js');
    const { errors } = await import('../state.js');
    const before = errors.length;
    embedAndUpsert('knowledge/embed-fail', 'text');
    await flushEmbeddings();
    const newErrors = errors.slice(before);
    expect(newErrors.length).toBe(1);
    expect(newErrors[0]!.msg).toContain('embedAndUpsert(knowledge/embed-fail)');
  });
});
