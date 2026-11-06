import { describe, it, expect, vi, beforeEach } from 'vitest';

// embeddings.ts behaviour that the main embeddings.test.ts mocks away: the dependency probe behind
// get_stats (with each optional module present, absent or broken), the real model-load path (task
// name, pooling options, one load per process), the canonical embed text, and the test-only guards
// on the seams. Every case imports a fresh copy so module state (latches, cached load) starts clean.
vi.hoisted(() => { process.env.HOME = '/tmp/tr-emb-behaviour-' + process.pid; });

const st = vi.hoisted(() => ({
  pipelineCalls: [] as unknown[][],
  extractorCalls: [] as unknown[][],
  dbArgs: [] as unknown[],
  dbClosed: 0,
  dbThrows: false,
  upserts: [] as unknown[][],
}));

type Variant = { hf?: 'ok' | 'no-pipeline' | 'load-fails'; sv?: 'both' | 'load' | 'path' | 'none' };

async function load(v: Variant = {}) {
  vi.resetModules();
  const hf = v.hf ?? 'ok';
  // vitest throws on a missing export of a mock, so an absent function is an explicit undefined.
  vi.doMock('@huggingface/transformers', () => (hf === 'no-pipeline' ? { env: {}, pipeline: undefined } : {
    env: {},
    pipeline: async (task: string, model: string) => {
      st.pipelineCalls.push([task, model]);
      if (hf === 'load-fails') throw new Error('hub said 404');
      return async (text: string, opts: unknown) => {
        st.extractorCalls.push([text, opts]);
        return { data: new Float32Array([0.5, 0.25]) };
      };
    },
  }));
  const sv = v.sv ?? 'both';
  vi.doMock('sqlite-vec', () => ({
    load: sv === 'both' || sv === 'load' ? () => {} : undefined,
    getLoadablePath: sv === 'both' || sv === 'path' ? () => '/x' : undefined,
  }));
  vi.doMock('better-sqlite3', () => ({
    default: class {
      constructor(arg: unknown) {
        st.dbArgs.push(arg);
        if (st.dbThrows) throw new Error('Could not locate the bindings file');
      }
      close() { st.dbClosed++; }
    },
  }));
  vi.doMock('../vectorStore.js', () => ({
    upsertVector: async (...a: unknown[]) => { st.upserts.push(a); },
    searchVector: async () => [], deleteVector: async () => {}, listVectorKeys: async () => null,
  }));
  const emb = await import('../embeddings.js');
  const state = await import('../state.js');
  const paths = await import('../paths.js');
  return { emb, state, paths };
}

beforeEach(() => {
  st.pipelineCalls = []; st.extractorCalls = []; st.dbArgs = []; st.dbClosed = 0; st.dbThrows = false; st.upserts = [];
});

describe('depsInstalled: the optional-dependency probe', () => {
  it('is true when all three load, and opens an in-memory database once to test the native binding', async () => {
    const { emb } = await load();
    expect(await emb.depsInstalled()).toBe(true);
    expect(st.dbArgs).toEqual([':memory:']);
    expect(st.dbClosed).toBe(1);
  });

  it('latches a true result: a binding that breaks later does not flip it', async () => {
    const { emb } = await load();
    expect(await emb.depsInstalled()).toBe(true);
    st.dbThrows = true;
    expect(await emb.depsInstalled()).toBe(true);
    expect(st.dbArgs).toHaveLength(1);
  });

  it('re-probes after a false result, so a mid-session rebuild is seen', async () => {
    const { emb } = await load();
    st.dbThrows = true;
    expect(await emb.depsInstalled()).toBe(false);
    st.dbThrows = false;
    expect(await emb.depsInstalled()).toBe(true);
  });

  it('is false when transformers has no pipeline export', async () => {
    const { emb } = await load({ hf: 'no-pipeline' });
    expect(await emb.depsInstalled()).toBe(false);
  });

  it('accepts sqlite-vec with either load or getLoadablePath, and rejects it with neither', async () => {
    expect(await (await load({ sv: 'load' })).emb.depsInstalled()).toBe(true);
    expect(await (await load({ sv: 'path' })).emb.depsInstalled()).toBe(true);
    expect(await (await load({ sv: 'none' })).emb.depsInstalled()).toBe(false);
  });

  it('the seam: an injected value wins; null clears both the value and the latch, so the real probe runs', async () => {
    const { emb } = await load();
    expect(await emb.depsInstalled()).toBe(true);        // latched true
    emb.__testSetDepsInstalled(false);
    expect(await emb.depsInstalled()).toBe(false);       // injected value wins over the latch
    emb.__testSetDepsInstalled(null);
    st.dbThrows = true;
    expect(await emb.depsInstalled()).toBe(false);       // latch cleared: the broken binding is seen
    expect(st.dbArgs).toHaveLength(2);
  });
});

describe('the real model load', () => {
  it('builds a feature-extraction pipeline for the configured model, once, with mean pooling and normalisation', async () => {
    const { emb, paths } = await load();
    emb.__testResetEmbedder();
    expect(emb.isVectorAvailable()).toBe(false);
    expect(await emb.embed('hello')).toEqual([0.5, 0.25]);
    expect(await emb.embed('again')).toEqual([0.5, 0.25]);
    expect(st.pipelineCalls).toEqual([['feature-extraction', paths.DEFAULT_EMBEDDING_MODEL]]);
    expect(st.extractorCalls.map((c) => c[1])).toEqual([{ pooling: 'mean', normalize: true }, { pooling: 'mean', normalize: true }]);
    expect(emb.isVectorAvailable()).toBe(true);
  });

  it('a failed load records an error and warns on stderr with the fix', async () => {
    const { emb, state } = await load({ hf: 'load-fails' });
    emb.__testResetEmbedder();
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((s: string) => { writes.push(String(s)); return true; }) as any);
    try { expect(await emb.embed('x')).toBeNull(); } finally { spy.mockRestore(); }
    const msg = state.errors.map((e) => e.msg).join('\n');
    expect(msg).toContain('e.g. "Xenova/paraphrase-multilingual-MiniLM-L12-v2")');
    expect(writes.join('')).toContain('Vector search is OFF; recall_memory(hybrid) silently falls back to TF-IDF.');
  });

  it('an empty vector from the model is recorded with the input length and treated as no vector', async () => {
    const { emb, state } = await load();
    emb.__testSetEmbedder(async () => []);
    expect(await emb.embed('12345')).toBeNull();
    expect(state.errors.at(-1)!.msg).toBe('embed: model returned empty vector for text of length 5');
  });
});

describe('isVectorAvailable reflects the embedder seam', () => {
  it('true with an injected embedder, false after injecting null, false after a reset', async () => {
    const { emb } = await load();
    emb.__testSetEmbedder(async () => [1]);
    expect(emb.isVectorAvailable()).toBe(true);
    emb.__testSetEmbedder(null);
    expect(emb.isVectorAvailable()).toBe(false);
    emb.__testResetEmbedder();
    expect(emb.isVectorAvailable()).toBe(false);
  });
});

describe('the text that is embedded', () => {
  it('is the title, a blank line, then the body cut to EMBED_BODY_SLICE characters', async () => {
    const { emb } = await load();
    expect(emb.embedTextFor('T', 'B')).toBe('T\n\nB');
    expect(emb.embedTextFor('', 'B')).toBe('\n\nB');
    expect(emb.embedTextFor(undefined as any, undefined as any)).toBe('\n\n');
    const long = 'x'.repeat(emb.EMBED_BODY_SLICE + 50);
    expect(emb.embedTextFor('T', long)).toBe('T\n\n' + 'x'.repeat(emb.EMBED_BODY_SLICE));
  });

  it('embedAndUpsert uses the memory title from the index, or none, and skips the write without a vector', async () => {
    const { emb, state } = await load();
    const seen: string[] = [];
    emb.__testSetEmbedder(async (t) => { seen.push(t); return t.startsWith('Title') ? [1, 2] : null; });
    (state.memIndex as any)['k/one'] = { key: 'k/one', title: 'Title' };
    emb.embedAndUpsert('k/one', 'body');
    emb.embedAndUpsert('k/missing', 'body');
    await emb.flushEmbeddings();
    expect(seen).toEqual(['Title\n\nbody', '\n\nbody']);
    expect(st.upserts.map((u) => u[1])).toEqual(['k/one']);
    delete (state.memIndex as any)['k/one'];
  });
});

describe('the test-only seams refuse to run outside tests', () => {
  it('throws for each seam when NODE_ENV is not "test"', async () => {
    const { emb } = await load();
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => emb.__testSetEmbedder(null)).toThrow('__testSetEmbedder is test-only');
      expect(() => emb.__testResetEmbedder()).toThrow('__testResetEmbedder is test-only');
      expect(() => emb.__testSetDepsInstalled(null)).toThrow('__testSetDepsInstalled is test-only');
      expect(() => emb.__testResetVectorAvailability()).toThrow('__testResetVectorAvailability is test-only');
    } finally { process.env.NODE_ENV = saved; }
  });
});
