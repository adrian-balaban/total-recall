import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  embed,
  embedAndUpsert,
  flushEmbeddings,
  isVectorAvailable,
  __testSetEmbedder,
  __testResetEmbedder,
} from '../embeddings.js';
import { errors } from '../state.js';

// Mutable registry for the vector-store mock. Static imports are intercepted
// reliably by `vi.mock`; we use a `vi.hoisted` singleton on `globalThis` so the
// registry survives across tests and is reachable from the hoisted mock factory.
const vectorStoreMocks = vi.hoisted(() => {
  const registry = {
    upsertVector: vi.fn().mockResolvedValue(undefined),
    searchVector: vi.fn().mockResolvedValue([]),
    deleteVector: vi.fn().mockResolvedValue(undefined),
    listVectorKeys: vi.fn().mockResolvedValue(null),
  };
  (globalThis as any).__totalRecallVectorStoreMocks = registry;
  return registry;
});

function getVectorStoreMocks() {
  return (globalThis as any).__totalRecallVectorStoreMocks as typeof vectorStoreMocks;
}

vi.mock('../vectorStore.js', () => ({
  upsertVector: (...args: any[]) => getVectorStoreMocks().upsertVector(...args),
  searchVector: (...args: any[]) => getVectorStoreMocks().searchVector(...args),
  deleteVector: (...args: any[]) => getVectorStoreMocks().deleteVector(...args),
  listVectorKeys: (...args: any[]) => getVectorStoreMocks().listVectorKeys(...args),
}));

// Force the REAL getEmbedder() load path (the dynamic `import('@huggingface/
// transformers')` + `hfPipeline(...)`) to fail, so the "loud failure" test
// below can exercise the catch block. Existing tests never reach this path —
// they inject via __testSetEmbedder, which short-circuits getEmbedder before
// the import — so mocking the module is inert for them.
vi.mock('@huggingface/transformers', () => ({
  pipeline: async () => { throw new Error('model id rejected by hub: 404'); },
}));

function resetVectorStoreMocks() {
  getVectorStoreMocks().upsertVector.mockReset().mockResolvedValue(undefined);
  getVectorStoreMocks().searchVector.mockReset().mockResolvedValue([]);
  getVectorStoreMocks().deleteVector.mockReset().mockResolvedValue(undefined);
  getVectorStoreMocks().listVectorKeys.mockReset().mockResolvedValue(null);
}

function makeVector(dim: number, value: number): number[] {
  return Array.from(new Float32Array(dim).fill(value));
}

// ─── Success path: pipeline loads and returns embeddings ─────────────────────

describe('embeddings — success path', () => {
  beforeEach(() => {
    resetVectorStoreMocks();
    __testSetEmbedder(async () => makeVector(384, 0.1));
  });

  it('returns a float array when pipeline loads and runs successfully', async () => {
    const res = await embed('hello world');
    expect(Array.isArray(res)).toBe(true);
    expect(res!.length).toBe(384);
  });

  it('returns same array length on repeated calls (cached pipeline)', async () => {
    __testSetEmbedder(async () => makeVector(384, 0.5));
    const r1 = await embed('first');
    const r2 = await embed('second');
    expect(r1!.length).toBe(r2!.length);
  });

  it('isVectorAvailable returns true when pipeline loaded', async () => {
    await embed('probe');
    expect(isVectorAvailable()).toBe(true);
  });

  it('isVectorAvailable returns true for an external embedder that returns an empty array', async () => {
    // 3.4: an empty array is a degenerate model output. embed() now returns null
    // + records the error (see the dedicated test below), but isVectorAvailable()
    // reflects pipeline-LOAD state (set by __testSetEmbedder), not a single call's
    // output — so the flag still reports true. The pipeline is "available"; this
    // particular call produced nothing usable.
    __testSetEmbedder(async () => []);
    await embed('probe');
    expect(isVectorAvailable()).toBe(true);
  });

  // 3.4: a model that returns a non-array or empty array must not flow into
  // upsertVector / cosine / searchVector unchecked. embed() records the failure
  // and returns null so callers degrade instead of corrupting the index.
  it('embed() returns null and records when the model returns an empty array (3.4)', async () => {
    __testSetEmbedder(async () => []);
    const before = errors.length;
    const res = await embed('probe');
    expect(res).toBeNull();
    const newErrors = errors.slice(before);
    expect(newErrors.length).toBe(1);
    expect(newErrors[0]!.msg).toContain('empty');
  });

  it('embed() returns null and records when the model returns a non-array (3.4)', async () => {
    __testSetEmbedder(async () => 'not-a-vector' as unknown as number[]);
    const before = errors.length;
    const res = await embed('probe');
    expect(res).toBeNull();
    const newErrors = errors.slice(before);
    expect(newErrors.length).toBe(1);
    expect(newErrors[0]!.msg).toContain('non-array');
  });
});

// ─── Failure path: embedder unavailable ────────────────────────────────────────

describe('embeddings — embedder unavailable', () => {
  beforeEach(() => {
    resetVectorStoreMocks();
    __testSetEmbedder(null);
  });

  it('returns null when the embedder is unavailable', async () => {
    expect(await embed('text')).toBeNull();
  });

  it('isVectorAvailable returns false when the embedder is unavailable', async () => {
    await embed('probe');
    expect(isVectorAvailable()).toBe(false);
  });

  it('returns null on second call (cached unavailable state)', async () => {
    await embed('first');
    expect(await embed('second')).toBeNull();
  });
});

// ─── Pass 7 fix #1: concurrent callers during in-flight load ───────────────────
// Before the promise-cached fix, a second caller arriving while the model was
// still loading saw a boolean flag set + pipeline null and got null back,
// silently dropping its vector upsert. This test holds the embedder behind a
// gate and fires two concurrent calls to prove neither returns null.

describe('embeddings — concurrent load race (Pass 7 fix #1)', () => {
  beforeEach(() => {
    resetVectorStoreMocks();
  });

  it('a concurrent caller during the in-flight model load gets an embedder, not null', async () => {
    let release: (() => void) | null = null;
    const wait = new Promise<void>((r) => { release = r; });
    __testSetEmbedder(async () => {
      await wait;
      return makeVector(384, 0.5);
    });

    const p1 = embed('alpha');
    const p2 = embed('beta');

    // Give the two embed() calls a chance to enter the gated embedder.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(release).not.toBeNull();
    release!();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(Array.isArray(r1)).toBe(true);
    expect(Array.isArray(r2)).toBe(true);
    expect((r2 as number[]).length).toBe(384);
  }, 15000);
});

// ─── #3: flushEmbeddings drains fire-and-forget embeds on the exit path ───────
// embedAndUpsert is fire-and-forget; before #3, a SIGTERM between a store_memory
// and its embed landing killed the upsert mid-flight, permanently holing the
// vector index for that key (findable via TF-IDF, invisible to hybrid search).
// flushEmbeddings tracks the in-flight promise set and is awaited by index.ts's
// shutdown() before process.exit.

describe('embeddings — flushEmbeddings drains pending upserts (#3)', () => {
  beforeEach(() => {
    resetVectorStoreMocks();
    __testSetEmbedder(async () => makeVector(384, 0.7));
  });

  it('awaits a pending embed→upsert before resolving', async () => {
    const upserted: Array<{ key: string; vec: number[] }> = [];
    getVectorStoreMocks().upsertVector.mockImplementation(async (_db: string, key: string, vec: number[]) => {
      upserted.push({ key, vec });
    });
    embedAndUpsert('knowledge/x', 'some text');
    // Before #3 there was no way to await the fire-and-forget upsert; the drain
    // must land it before resolving.
    await flushEmbeddings();
    expect(upserted.length).toBe(1);
    expect(upserted[0]!.key).toBe('knowledge/x');
    expect(upserted[0]!.vec.length).toBe(384);
  });

  it('returns promptly when nothing is pending (size===0 fast path)', async () => {
    const start = Date.now();
    await flushEmbeddings();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('is bounded by the timeout when an upsert never resolves', async () => {
    const gate: { resolve: (() => void) | null } = { resolve: null };
    getVectorStoreMocks().upsertVector.mockImplementation(async () => {
      await new Promise<void>((r) => { gate.resolve = r; });
    });
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
  beforeEach(() => {
    resetVectorStoreMocks();
    __testSetEmbedder(async () => makeVector(384, 0.7));
  });

  it('records via recordError when upsertVector rejects', async () => {
    getVectorStoreMocks().upsertVector.mockRejectedValue(new Error('sqlite I/O'));
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
    __testSetEmbedder(async () => { throw new Error('inference blew up'); });
    const before = errors.length;
    embedAndUpsert('knowledge/embed-fail', 'text');
    await flushEmbeddings();
    const newErrors = errors.slice(before);
    expect(newErrors.length).toBe(1);
    expect(newErrors[0]!.msg).toContain('embedAndUpsert(knowledge/embed-fail)');
  });
});

// ─── Loud embedder-load failure (silent-degradation fix) ───────────────────────
// Before this fix, getEmbedder's catch swallowed the load error: a bad
// embeddingModel (e.g. a bare "bge-m3" with no org/ prefix, or any id the HF
// hub 404s) failed the load, returned null, and recall_memory(hybrid=true)
// SILENTLY degraded to TF-IDF — vector search advertised but never functional,
// with no signal anywhere except a buried get_stats.recentErrors entry. The
// catch now records the error AND emits a one-shot stderr warning naming the
// model + the config key to fix. These tests exercise the REAL load path
// (__testResetEmbedder drops the __testSetEmbedder short-circuit) with the
// @huggingface/transformers mock above forcing the load to throw.

describe('embeddings — loud embedder-load failure', () => {
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetVectorStoreMocks();
    __testResetEmbedder();
    stderrWrite = vi.spyOn(process.stderr, 'write');
  });

  afterEach(() => {
    stderrWrite.mockRestore();
    // Restore the test embedder so later describes aren't left on the real
    // (failing) load path.
    __testSetEmbedder(async () => makeVector(384, 0.1));
  });

  it('returns null, records the failure, and writes a stderr warning naming the model + config', async () => {
    const before = errors.length;
    const res = await embed('probe');
    expect(res).toBeNull();
    const newErrors = errors.slice(before);
    expect(newErrors.length).toBe(1);
    expect(newErrors[0]!.msg).toContain('failed to load');
    expect(newErrors[0]!.msg).toContain('TF-IDF');
    expect(newErrors[0]!.msg).toContain('embeddingModel');
    // The stderr warning names the model and points at the config file.
    const warned = stderrWrite.mock.calls.filter((c: any[]) =>
      String(c[0]).includes('embedding model')
    );
    expect(warned.length).toBe(1);
    expect(String(warned[0]![0])).toContain('failed to load');
    expect(String(warned[0]![0])).toContain('config.json');
  });

  it('dedupes the warning across calls (once-per-process latch)', async () => {
    const before = errors.length;
    await embed('first');
    await embed('second');
    await embed('third');
    // One recordError, one stderr warning — not three, even though the
    // uncached load retries on every embed().
    expect(errors.length - before).toBe(1);
    const warned = stderrWrite.mock.calls.filter((c: any[]) =>
      String(c[0]).includes('embedding model')
    );
    expect(warned.length).toBe(1);
  });

  it('isVectorAvailable reports false while the load keeps failing', async () => {
    await embed('probe');
    expect(isVectorAvailable()).toBe(false);
  });
});
