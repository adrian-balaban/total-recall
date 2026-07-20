import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-embed-external-' + process.pid;
});

vi.mock('../paths.js', () => ({
  VECTORS_DB: '/tmp/vectors.db',
  loadConfig: vi.fn().mockReturnValue({}),
}));

vi.mock('../vectorStore.js', () => ({
  upsertVector: vi.fn().mockResolvedValue(undefined),
  searchVector: vi.fn().mockResolvedValue([]),
  deleteVector: vi.fn().mockResolvedValue(undefined),
  listVectorKeys: vi.fn().mockResolvedValue(null),
}));

import { embed, isVectorAvailable, __testResetVectorAvailability } from '../embeddings.js';
import { loadConfig } from '../paths.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  __testResetVectorAvailability();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('embeddings — external providers', () => {
  it('Ollama success sets vector available', async () => {
    (loadConfig as any).mockReturnValue({ embeddingProvider: 'ollama' });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });

    expect(isVectorAvailable()).toBe(false);
    const vec = await embed('hello');
    expect(vec).toEqual([0.1, 0.2, 0.3]);
    expect(isVectorAvailable()).toBe(true);
  });

  it('Ollama failure keeps vector unavailable', async () => {
    (loadConfig as any).mockReturnValue({ embeddingProvider: 'ollama' });
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const vec = await embed('hello');
    expect(vec).toBeNull();
    expect(isVectorAvailable()).toBe(false);
  });

  it('Ollama fetch rejection records error and keeps vector unavailable', async () => {
    (loadConfig as any).mockReturnValue({ embeddingProvider: 'ollama' });
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const vec = await embed('hello');
    expect(vec).toBeNull();
    expect(isVectorAvailable()).toBe(false);
  });

  it('unknown external provider returns null and reports vector unavailable', async () => {
    (loadConfig as any).mockReturnValue({ embeddingProvider: 'openai' });

    const vec = await embed('hello');
    expect(vec).toBeNull();
    expect(isVectorAvailable()).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // REVIEW 1.4: a successful embed sets the availability latch, but a later
  // failure must reset it — otherwise isVectorAvailable() keeps reporting true
  // for the whole session even after Ollama has died. The latch reflects "the
  // last embed attempt actually succeeded", not "an embed ever succeeded".
  it('external vector availability resets after a later embed failure', async () => {
    (loadConfig as any).mockReturnValue({ embeddingProvider: 'ollama' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });
    await embed('first');
    expect(isVectorAvailable()).toBe(true);

    mockFetch.mockRejectedValue(new Error('network'));
    await embed('second');
    expect(isVectorAvailable()).toBe(false);
  });
});
