import { describe, it, expect } from 'vitest';
import { MemoryExistsError } from '../errors.js';

// errors.ts had NO covering test in the Stryker allow-list, so its mutants were
// reported as "no coverage" and counted against the score at 0.00%. The whole
// point of this class is that import_memories can branch on `instanceof` instead
// of regex-matching a mutable English message — so that is what these pin.

describe('MemoryExistsError', () => {
  it('is an Error and an instanceof itself (prototype chain preserved)', () => {
    const e = new MemoryExistsError('knowledge/foo', 'already exists');
    expect(e).toBeInstanceOf(MemoryExistsError);
    expect(e).toBeInstanceOf(Error);
  });

  it('carries the offending key alongside the message', () => {
    const e = new MemoryExistsError('knowledge/foo', 'already exists');
    expect(e.key).toBe('knowledge/foo');
    expect(e.message).toBe('already exists');
  });

  it('reports a stable name for callers that do check it', () => {
    expect(new MemoryExistsError('k', 'm').name).toBe('MemoryExistsError');
  });

  // The documented contract: a caller must be able to tell this apart from a
  // generic failure WITHOUT substring-matching the message.
  it('is distinguishable from a plain Error by instanceof alone', () => {
    const errs: Error[] = [
      new MemoryExistsError('knowledge/dup', 'duplicate'),
      new Error('duplicate'),
    ];
    const classified = errs.map(e => (e instanceof MemoryExistsError ? 'skipped' : 'error'));
    expect(classified).toEqual(['skipped', 'error']);
  });

  it('survives being thrown and caught', () => {
    let caught: unknown;
    try {
      throw new MemoryExistsError('knowledge/bar', 'exists');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MemoryExistsError);
    expect((caught as MemoryExistsError).key).toBe('knowledge/bar');
  });
});
