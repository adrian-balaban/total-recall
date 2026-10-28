import { describe, it, expect, afterEach } from 'vitest';

// recordError / errors live in the REAL shared state singleton; reset `errors`
// after each test so the cap test below can't pollute other suites' get_stats.

import { recordError, errors } from '../state.js';

afterEach(() => {
  errors.length = 0;
});

describe('recordError', () => {
  // #21: trimTo trims only when length > 2×CAP (amortized-O(1): one cap-sized
  // splice every CAP pushes instead of a shift per push). So the buffer grows
  // past CAP and only snaps back to CAP at the 2×CAP boundary — the invariant is
  // "bounded, newest preserved at the tail", not "exactly CAP after CAP+1
  // pushes". Push 2×CAP+1 to cross the trim boundary and assert the snap-back.
  it('bounds the errors array at CAP via amortized batched trim (newest preserved)', () => {
    const base = errors.length;
    const cap = 1000;
    // Below the 2×CAP boundary: no trim, the buffer just grows.
    for (let i = 0; i < cap + 1; i++) recordError(`err-${i}`);
    expect(errors.length).toBe(cap + 1);
    // Cross 2×CAP: one splice drops the oldest CAP entries, snapping to CAP.
    for (let i = cap + 1; i < 2 * cap + 1; i++) recordError(`err-${i}`);
    expect(errors.length).toBe(cap);
    // The head is the entry just past the dropped window; the tail is the last
    // push — newest preserved at the end (what getStats' errors.slice(-10) sees).
    expect(errors[0]!.msg).toBe(`err-${cap + 1}`);
    expect(errors[cap - 1]!.msg).toBe(`err-${2 * cap}`);
    // Sanity: the test starts from an empty buffer.
    expect(base).toBe(0);
  });

  it('records the message with an ISO timestamp', () => {
    recordError('boom');
    expect(errors[errors.length - 1]!.msg).toBe('boom');
    expect(errors[errors.length - 1]!.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
