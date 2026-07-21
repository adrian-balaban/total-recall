import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// providers.ts imports recordError from ../state.js, which captures os.homedir()
// at load. Redirect HOME before any import (same hoisted pattern as the other
// test files) so state.js initializes against a tmp dir.
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-providers-' + process.pid;
});

import { PROVIDERS } from '../embeddings/providers.js';
import { EmbedTimeoutError } from '../embeddings/providers.js';
import { errors } from '../state.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  errors.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// REVIEW 9.1: the PROVIDERS registry is the extension point. A provider is
// purely a name + an embed(text, config) function; embeddings.ts looks it up by
// config.embeddingProvider and calls embed() per call. These tests pin the
// registry contract directly (independent of the embed()/isVectorAvailable()
// orchestration in embeddings.ts, which embeddings-external.test.ts covers).
describe('PROVIDERS embedding-provider registry (REVIEW 9.1)', () => {
  it('registers the ollama provider under its name', () => {
    expect(PROVIDERS.ollama).toBeDefined();
    expect(PROVIDERS.ollama!.name).toBe('ollama');
  });

  it('an unknown provider name is absent — embeddings.ts falls back to TF-IDF with no transport call', () => {
    // The clean-degradation contract: a typo or an as-yet-unimplemented provider
    // resolves to undefined, so getEmbedder returns null and no fetch fires.
    expect(PROVIDERS['openai']).toBeUndefined();
    expect(PROVIDERS['cohere']).toBeUndefined();
  });

  it('ollama.embed returns the vector on a 200', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });

    const vec = await PROVIDERS.ollama!.embed('hello', { embeddingProvider: 'ollama' });
    expect(vec).toEqual([0.1, 0.2, 0.3]);
    // One attempt on success — no retry needed.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(errors.length).toBe(0);
  });

  it('ollama.embed posts to the configured url/model and honors embeddingTimeoutMs', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [1] }),
    });

    await PROVIDERS.ollama!.embed('x', {
      embeddingProvider: 'ollama',
      embeddingUrl: 'http://ollama.local:1234/api/embeddings',
      embeddingModel: 'nomic-embed-text',
      embeddingTimeoutMs: 2500,
    });

    const call = mockFetch.mock.calls[0] as any;
    expect(call[0]).toBe('http://ollama.local:1234/api/embeddings');
    const body = JSON.parse(call[1].body);
    expect(body.model).toBe('nomic-embed-text');
    expect(call[1].signal).toBeDefined(); // AbortController wired for the timeout
  });

  it('ollama.embed returns null and records an error after a retry-exhausting failure', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const vec = await PROVIDERS.ollama!.embed('hello', { embeddingProvider: 'ollama' });
    expect(vec).toBeNull();
    // Two bounded attempts (initial + one retry).
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(errors.length).toBe(1);
    expect(errors[0]!.msg).toMatch(/Ollama embedding failed after retry/);
  });

  it('ollama.embed returns null on a fetch rejection (both attempts reject)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const vec = await PROVIDERS.ollama!.embed('hello', { embeddingProvider: 'ollama' });
    expect(vec).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(errors[0]!.msg).toMatch(/ECONNREFUSED/);
  });

  // REVIEW 1.6: a timeout (AbortController fired — reachable but slow) is a
  // different failure class from "down". The provider surfaces it by THROWING
  // EmbedTimeoutError (not returning null) so embeddings.ts can skip the circuit
  // breaker and emit a targeted hint. Crucially a timeout does NOT retry: a
  // slow model would be just as slow 200ms later, so one attempt only.
  it('ollama.embed throws EmbedTimeoutError on an abort (timeout), without retrying', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    mockFetch.mockRejectedValue(abortErr);

    await expect(
      PROVIDERS.ollama!.embed('slow', { embeddingProvider: 'ollama', embeddingTimeoutMs: 15000 })
    ).rejects.toBeInstanceOf(EmbedTimeoutError);
    // One attempt only — a timeout is not retried.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // A timeout is not a "down" failure, so no recordError from the provider.
    expect(errors.length).toBe(0);
  });

  it('a non-abort rejection still returns null with a recorded error (down, not timeout)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const vec = await PROVIDERS.ollama!.embed('down', { embeddingProvider: 'ollama' });
    expect(vec).toBeNull();
    expect(errors.length).toBe(1);
    expect(errors[0]!.msg).toMatch(/ECONNREFUSED/);
  });

  // The point of the registry: a new provider is one entry, no if/else to edit
  // in embeddings.ts. This proves a registered provider is callable through the
  // same EmbeddingProvider interface.
  it('a custom provider registered at runtime is callable through the same interface', async () => {
    const custom = {
      name: 'fake',
      embed: async (text: string) => [text.length, 0],
    };
    PROVIDERS['fake'] = custom;
    try {
      expect(await PROVIDERS['fake']!.embed('abcd', {})).toEqual([4, 0]);
    } finally {
      delete PROVIDERS['fake'];
    }
    expect(PROVIDERS['fake']).toBeUndefined();
  });
});