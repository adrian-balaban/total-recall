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

import { embed, isVectorAvailable, __testSetEmbedder, __testResetVectorAvailability } from '../embeddings.js';
import { loadConfig } from '../paths.js';
import { errors } from '../state.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  __testResetVectorAvailability();
  errors.length = 0;
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

// REVIEW 1.2: a down/hung Ollama used to stall every hybrid recall for
// ~2×timeout before falling back to TF-IDF. The session circuit breaker opens
// after CIRCUIT_OPEN_THRESHOLD consecutive failures and short-circuits embed()
// to null for CIRCUIT_OPEN_COOLDOWN_MS without calling the provider, with
// exactly one "circuit open" error logged on the closed→open transition.
describe('embeddings — session circuit breaker (REVIEW 1.2)', () => {
  it('opens after 3 consecutive failures and short-circuits the next call (no fetch, one error)', async () => {
    (loadConfig as any).mockReturnValue({ embeddingProvider: 'ollama' });
    mockFetch.mockRejectedValue(new Error('network'));

    // 3 failing embeds: each does 2 bounded attempts → 6 fetch calls total.
    // The 3rd failure pushes consecutiveFailures to the threshold and opens
    // the circuit (one recordError on the closed→open transition).
    for (let i = 0; i < 3; i++) {
      expect(await embed(`fail${i}`)).toBeNull();
    }
    expect(mockFetch).toHaveBeenCalledTimes(6);
    const openErrors = errors.filter(e => /circuit open/i.test(e.msg));
    expect(openErrors.length).toBe(1);

    // 4th call while the circuit is open: short-circuits to null, NO fetch.
    const callsBefore = mockFetch.mock.calls.length;
    expect(await embed('short')).toBeNull();
    expect(mockFetch.mock.calls.length).toBe(callsBefore);
    // The "circuit open" error is logged once on opening, not re-logged per
    // short-circuited call.
    expect(errors.filter(e => /circuit open/i.test(e.msg)).length).toBe(1);
  });

  it('a successful embed resets the failure counter (circuit never opens)', async () => {
    (loadConfig as any).mockReturnValue({ embeddingProvider: 'ollama' });

    // 2 failures (below the threshold of 3).
    mockFetch.mockRejectedValue(new Error('network'));
    await embed('f1');
    await embed('f2');

    // Success resets consecutiveFailures to 0.
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ embedding: [0.1] }) });
    await embed('ok');

    // 2 more failures → counter goes 0→1→2, still below 3: circuit stays closed.
    mockFetch.mockRejectedValue(new Error('network'));
    await embed('f3');
    await embed('f4');
    expect(errors.filter(e => /circuit open/i.test(e.msg)).length).toBe(0);

    // Circuit closed → the next call actually reaches the provider.
    const callsBefore = mockFetch.mock.calls.length;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ embedding: [0.2] }) });
    const vec = await embed('probe');
    expect(vec).toEqual([0.2]);
    expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('after the cooldown elapses, one probe call is allowed through (half-open)', async () => {
    (loadConfig as any).mockReturnValue({ embeddingProvider: 'ollama' });
    mockFetch.mockRejectedValue(new Error('network'));

    // Freeze time so the cooldown window is deterministic. All circuit math
    // in embed() uses Date.now().
    let fakeNow = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);

    // 3 failures open the circuit: circuitOpenUntil = 1_000_000 + 60_000.
    for (let i = 0; i < 3; i++) await embed(`fail${i}`);

    // While the cooldown is active: short-circuit, no fetch.
    const callsAtOpen = mockFetch.mock.calls.length;
    await embed('blocked');
    expect(mockFetch.mock.calls.length).toBe(callsAtOpen);

    // Advance past the 60s cooldown → half-open: the next call clears the
    // open marker and probes the provider. A probe success closes the circuit.
    fakeNow = 1_070_000;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ embedding: [0.9] }) });
    const vec = await embed('probe');
    expect(vec).toEqual([0.9]);
    expect(mockFetch.mock.calls.length).toBeGreaterThan(callsAtOpen);

    nowSpy.mockRestore();
  });
});

// REVIEW 1.3: an external embed failure is recorded into get_stats.recentErrors
// (via recordError in providers.ts), but that sink is only visible if the user
// calls get_stats. The proactive signal emits ONE stderr warning at the start
// of each down-episode so the degradation is visible in the client's stderr.
describe('embeddings — proactive vector-down stderr warning (REVIEW 1.3)', () => {
  it('emits one stderr warning on the first failure of a down-episode, none on the next', async () => {
    (loadConfig as any).mockReturnValue({ embeddingProvider: 'ollama' });
    mockFetch.mockRejectedValue(new Error('network'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await embed('f1');
    // Exactly one warning line on the first failure.
    const warned = errSpy.mock.calls.some(c => /external embedding provider/.test(String(c[0])));
    expect(warned).toBe(true);

    await embed('f2');
    // Second consecutive failure: no additional warning (still one down-episode).
    const warnCalls = errSpy.mock.calls.filter(c => /external embedding provider/.test(String(c[0])));
    expect(warnCalls.length).toBe(1);

    errSpy.mockRestore();
  });

  it('a successful embed re-arms the warning; a later failure warns again', async () => {
    (loadConfig as any).mockReturnValue({ embeddingProvider: 'ollama' });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // First down-episode: one warning.
    mockFetch.mockRejectedValue(new Error('network'));
    await embed('f1');
    let warnCalls = errSpy.mock.calls.filter(c => /external embedding provider/.test(String(c[0])));
    expect(warnCalls.length).toBe(1);

    // Recovery: success re-arms the latch (vectorDownWarned = false).
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ embedding: [0.1] }) });
    await embed('ok');

    // New down-episode: warns again — one fresh line for this outage.
    mockFetch.mockRejectedValue(new Error('network'));
    await embed('f2');
    warnCalls = errSpy.mock.calls.filter(c => /external embedding provider/.test(String(c[0])));
    expect(warnCalls.length).toBe(2);

    errSpy.mockRestore();
  });

  it('does not warn for HuggingFace (exempt — load-time failure mode)', async () => {
    // HuggingFace path: force the model unavailable via the test seam. embed()
    // returns null but the provider === 'huggingface' branch skips the warning.
    __testSetEmbedder(null);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const vec = await embed('hf-down');
    expect(vec).toBeNull();
    const warnCalls = errSpy.mock.calls.filter(c => /external embedding provider/.test(String(c[0])));
    expect(warnCalls.length).toBe(0);

    errSpy.mockRestore();
  });
});
