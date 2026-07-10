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

  it('Vertex AI success sets vector available', async () => {
    (loadConfig as any).mockReturnValue({
      embeddingProvider: 'vertexai',
      vertexProjectId: 'proj',
      embeddingApiKey: 'token',
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        predictions: [{ embeddings: { values: [0.4, 0.5, 0.6] } }],
      }),
    });

    const vec = await embed('hello');
    expect(vec).toEqual([0.4, 0.5, 0.6]);
    expect(isVectorAvailable()).toBe(true);
  });

  it('Vertex AI failure without token keeps unavailable', async () => {
    (loadConfig as any).mockReturnValue({ embeddingProvider: 'vertexai' });

    const vec = await embed('hello');
    expect(vec).toBeNull();
    expect(isVectorAvailable()).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('Ollama fetch rejection records error and keeps vector unavailable', async () => {
    (loadConfig as any).mockReturnValue({ embeddingProvider: 'ollama' });
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const vec = await embed('hello');
    expect(vec).toBeNull();
    expect(isVectorAvailable()).toBe(false);
  });

  it('Vertex AI request failure records error and keeps vector unavailable', async () => {
    (loadConfig as any).mockReturnValue({
      embeddingProvider: 'vertexai',
      vertexProjectId: 'proj',
      embeddingApiKey: 'token',
    });
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const vec = await embed('hello');
    expect(vec).toBeNull();
    expect(isVectorAvailable()).toBe(false);
  });

  it('Vertex AI malformed response records error and keeps vector unavailable', async () => {
    (loadConfig as any).mockReturnValue({
      embeddingProvider: 'vertexai',
      vertexProjectId: 'proj',
      embeddingApiKey: 'token',
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ predictions: [] }),
    });

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

  it('external vector availability persists after a later embed failure', async () => {
    (loadConfig as any).mockReturnValue({ embeddingProvider: 'ollama' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });
    await embed('first');
    expect(isVectorAvailable()).toBe(true);

    mockFetch.mockRejectedValueOnce(new Error('network'));
    await embed('second');
    expect(isVectorAvailable()).toBe(true);
  });
});
