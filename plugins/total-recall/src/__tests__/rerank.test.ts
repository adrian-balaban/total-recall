import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Override HOME before any module that resolves vault paths.
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-rerank-' + process.pid;
});
const TEST_HOME = process.env.HOME!;

import { __testSetEmbedder } from '../embeddings.js';
import { rerankMemories } from '../tools/rerank.js';
import { reconcileIndex } from '../vault-scan.js';

// Keep the optional sqlite-vec dependency out of these tests; vault-scan imports
// vectorStore at module load, so we provide a no-op mock registry.
const vectorStoreMocks = vi.hoisted(() => {
  const registry = {
    upsertVector: vi.fn().mockResolvedValue(undefined),
    searchVector: vi.fn().mockResolvedValue([]),
    deleteVector: vi.fn().mockResolvedValue(undefined),
    listVectorKeys: vi.fn().mockResolvedValue(null),
    getVectors: vi.fn().mockResolvedValue(new Map()),
  };
  (globalThis as any).__totalRecallRerankVectorMocks = registry;
  return registry;
});

function getVectorStoreMocks() {
  return (globalThis as any).__totalRecallRerankVectorMocks as typeof vectorStoreMocks;
}

vi.mock('../vectorStore.js', () => ({
  upsertVector: (...args: any[]) => getVectorStoreMocks().upsertVector(...args),
  searchVector: (...args: any[]) => getVectorStoreMocks().searchVector(...args),
  deleteVector: (...args: any[]) => getVectorStoreMocks().deleteVector(...args),
  listVectorKeys: (...args: any[]) => getVectorStoreMocks().listVectorKeys(...args),
  getVectors: (...args: any[]) => getVectorStoreMocks().getVectors(...args),
}));

const VAULT = path.join(TEST_HOME, '.total-recall', 'personal-vault');

function writeMemory(relKey: string, title: string, body: string, tags: string[] = []) {
  const file = path.join(VAULT, `${relKey}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fmTags = tags.length ? `[${tags.join(', ')}]` : '[]';
  fs.writeFileSync(
    file,
    `---\ntitle: ${JSON.stringify(title)}\ntags: ${fmTags}\ncreated: "2024-01-01T00:00:00Z"\nupdated: "2024-01-02T00:00:00Z"\n---\n${body}\n`
  );
}

function resetVault() {
  const root = path.join(TEST_HOME, '.total-recall');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(VAULT, { recursive: true });
  getVectorStoreMocks().upsertVector.mockClear();
  getVectorStoreMocks().searchVector.mockClear();
  getVectorStoreMocks().getVectors.mockClear();
  getVectorStoreMocks().getVectors.mockResolvedValue(new Map());
}

// Deterministic, dimension-matched fake embedder. Content that contains the word
// "alpha" aligns with query "alpha", "beta" aligns with "beta", and everything
// else is orthogonal.
function alphaBetaEmbedder(text: string): number[] {
  const t = text.toLowerCase();
  if (t.includes('alpha')) return [1, 0, 0, 0];
  if (t.includes('beta')) return [0, 1, 0, 0];
  return [0, 0, 1, 0];
}

describe('rerank_memories', () => {
  beforeEach(() => {
    resetVault();
    __testSetEmbedder((text) => Promise.resolve(alphaBetaEmbedder(text)));
  });

  afterAll(() => {
    fs.rmSync(path.join(TEST_HOME, '.total-recall'), { recursive: true, force: true });
  });

  it('orders candidates by cosine similarity to the query', async () => {
    writeMemory('knowledge/alpha', 'Alpha Note', 'alpha content');
    writeMemory('knowledge/beta', 'Beta Note', 'beta content');
    writeMemory('knowledge/gamma', 'Gamma Note', 'gamma content');
    reconcileIndex();

    const keys = ['knowledge/alpha', 'knowledge/beta', 'knowledge/gamma'];
    const res = await rerankMemories({ query: 'alpha', keys, limit: 3 });

    expect(Array.isArray(res)).toBe(true);
    expect(res).toHaveLength(3);
    expect(res[0].key).toBe('knowledge/alpha');
    expect(res[0].score).toBeCloseTo(1, 5);
    expect(res[0].score).toBeGreaterThan(res[1].score);
    // beta and gamma are both orthogonal to the alpha query, so they tie at 0;
    // a stable sort preserves the original key order for equal scores.
    expect(res[1].key).toBe('knowledge/beta');
    expect(res[2].key).toBe('knowledge/gamma');
    expect(res[1].score).toBe(0);
    expect(res[2].score).toBe(0);
  });

  it('respects limit and returns metadata + preview by default', async () => {
    writeMemory('knowledge/alpha', 'Alpha Note', 'alpha content');
    writeMemory('knowledge/beta', 'Beta Note', 'beta content');
    reconcileIndex();

    const keys = ['knowledge/alpha', 'knowledge/beta'];
    const res = await rerankMemories({ query: 'beta', keys, limit: 1 });

    expect(res).toHaveLength(1);
    expect(res[0].key).toBe('knowledge/beta');
    expect(res[0].title).toBe('Beta Note');
    expect(res[0].preview).toContain('beta content');
    expect(res[0].content).toBeUndefined();
  });

  it('includes full content when full=true', async () => {
    writeMemory('knowledge/alpha', 'Alpha Note', 'alpha full body');
    reconcileIndex();

    const res = await rerankMemories({ query: 'alpha', keys: ['knowledge/alpha'], full: true });

    expect(res).toHaveLength(1);
    expect(res[0].content).toContain('alpha full body');
  });

  it('drops unknown keys silently', async () => {
    writeMemory('knowledge/alpha', 'Alpha Note', 'alpha content');
    reconcileIndex();

    const res = await rerankMemories({ query: 'alpha', keys: ['knowledge/alpha', 'knowledge/missing'] });

    expect(res).toHaveLength(1);
    expect(res[0].key).toBe('knowledge/alpha');
  });

  it('falls back to original order when embeddings are unavailable', async () => {
    writeMemory('knowledge/alpha', 'Alpha Note', 'alpha content');
    writeMemory('knowledge/beta', 'Beta Note', 'beta content');
    reconcileIndex();
    __testSetEmbedder(null);

    const keys = ['knowledge/alpha', 'knowledge/beta'];
    const res = await rerankMemories({ query: 'alpha', keys, limit: 2 });

    expect(res).toHaveLength(2);
    expect(res[0].key).toBe('knowledge/alpha');
    expect(res[0].score).toBe(0);
    expect(res[1].key).toBe('knowledge/beta');
  });

  it('rejects empty query or keys', async () => {
    await expect(rerankMemories({ query: '', keys: ['knowledge/alpha'] })).rejects.toThrow();
    await expect(rerankMemories({ query: 'x', keys: [] })).rejects.toThrow();
  });

  it('falls back to keys.length when limit is invalid', async () => {
    writeMemory('knowledge/alpha', 'Alpha Note', 'alpha content');
    writeMemory('knowledge/beta', 'Beta Note', 'beta content');
    reconcileIndex();
    __testSetEmbedder(null);

    const res = await rerankMemories({ query: 'alpha', keys: ['knowledge/alpha', 'knowledge/beta'], limit: NaN });
    expect(res).toHaveLength(2);
  });

  it('handles a zero-norm vector without division by zero', async () => {
    // A zero vector makes cosineSimilarity's denom 0; the guard must return 0
    // rather than NaN/Infinity.
    writeMemory('knowledge/zero', 'Zero Note', 'zero content');
    reconcileIndex();
    __testSetEmbedder(() => Promise.resolve([0, 0, 0, 0]));

    const res = await rerankMemories({ query: 'zero', keys: ['knowledge/zero'] });
    expect(res).toHaveLength(1);
    expect(res[0].score).toBe(0);
  });

  it('uses a stored vector instead of re-embedding a candidate that already has one', async () => {
    // REVIEW 1.6: a candidate with a stored vector (embedAndUpsert already ran
    // on store/update) must be scored from that vector, not a fresh embed()
    // call — only candidates missing a stored vector fall back to embed().
    writeMemory('knowledge/alpha', 'Alpha Note', 'alpha content');
    writeMemory('knowledge/beta', 'Beta Note', 'beta content');
    reconcileIndex();

    getVectorStoreMocks().getVectors.mockResolvedValue(
      new Map([['knowledge/beta', [0, 1, 0, 0]]]) // stored vector says "beta", body says "alpha"
    );
    const embedSpy = vi.fn((text: string) => Promise.resolve(alphaBetaEmbedder(text)));
    __testSetEmbedder(embedSpy);

    const res = await rerankMemories({ query: 'beta', keys: ['knowledge/alpha', 'knowledge/beta'] });

    expect(getVectorStoreMocks().getVectors).toHaveBeenCalledWith(
      expect.any(String),
      ['knowledge/alpha', 'knowledge/beta']
    );
    // knowledge/beta scores against its STORED vector (aligned with "beta"),
    // not a fresh embed of its body — proving the stored vector was used.
    expect(res[0].key).toBe('knowledge/beta');
    expect(res[0].score).toBeCloseTo(1, 5);
    // embed() was called for the query and for knowledge/alpha (no stored
    // vector), but never for knowledge/beta's content.
    const embeddedTexts = embedSpy.mock.calls.map((c) => String(c[0]));
    expect(embeddedTexts.some((t) => t.includes('beta content'))).toBe(false);
  });

  it('skips a candidate whose embedding returns null', async () => {
    writeMemory('knowledge/alpha', 'Alpha Note', 'alpha content');
    writeMemory('knowledge/beta', 'Beta Note', 'beta content');
    reconcileIndex();
    __testSetEmbedder((text: string) =>
      text.toLowerCase().includes('beta') ? Promise.resolve(null) : Promise.resolve([1, 0, 0, 0])
    );

    const res = await rerankMemories({ query: 'alpha', keys: ['knowledge/alpha', 'knowledge/beta'] });
    expect(res).toHaveLength(1);
    expect(res[0].key).toBe('knowledge/alpha');
  });
});
