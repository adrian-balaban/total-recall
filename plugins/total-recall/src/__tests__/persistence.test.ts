import { describe, it, expect, vi, afterEach } from 'vitest';

// persistence writes to INDEX_PATH / INVERTED_INDEX_PATH / INDEX_CACHE_PATH —
// fixed paths under the user's real ~/.total-recall. Redirect HOME to a tmp dir
// BEFORE any module import (paths.ts captures os.homedir() once at load; same
// vi.hoisted pattern as index.test.ts).
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-persistence-' + process.pid;
});

// Force fs.writeFileSync + renameSync to throw so atomicWrite's primary write
// AND its rename-fallback write both fail — exercising the recordError path in
// atomicWrite and the belt-and-braces catch in flushPending. Spread the real fs
// so ensureDir (mkdirSync) and any reads keep working.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(() => {
      throw new Error('ENOSPC: no space left on device');
    }),
    renameSync: vi.fn(() => {
      throw new Error('EXDEV: cross-device link');
    }),
  };
});

import { flushPending, scheduleSave } from '../persistence.js';
import { errors } from '../state.js';

afterEach(() => {
  // flushPending + atomicWrite record into the REAL shared `errors` singleton
  // (get_stats reads it). Reset so this suite can't pollute the cross-test index.
  errors.length = 0;
});

describe('flushPending', () => {
  // flushPending runs on the SIGTERM/SIGINT/beforeExit path (index.ts). A throw
  // here escapes the signal handler → skips process.exit(0) → uncaughtException
  // kills the stdio server mid-shutdown. atomicWrite now swallows its own throws
  // and records via recordError; flushPending adds an isolated try/catch around
  // saveNow / recalcIdfNow so a failure in one write still runs the other and
  // nothing propagates. With fs forced to fail, the whole flush must complete
  // without throwing and must record the failure.
  it('does not throw when index writes fail (records error, best-effort)', () => {
    scheduleSave(); // arm the 1s indexSaveTimer so flushPending has work to do
    expect(() => flushPending()).not.toThrow();
    // atomicWrite recorded the ENOSPC via recordError (belt-and-braces catch in
    // flushPending is a backstop; atomicWrite swallows + records first).
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => /atomicWrite|flushPending/.test(e.msg))).toBe(true);
  });

  // The early-return guard: with no debounce timer armed, flushPending must NOT
  // attempt any write (and thus record nothing). Without the guard, a flush on a
  // quiet shutdown would call saveNow unconditionally — a wasted write and, with
  // fs failing, a spurious error entry on every clean exit.
  it('is a no-op when no debounce timer is armed (records nothing)', () => {
    expect(() => flushPending()).not.toThrow();
    expect(errors.length).toBe(0);
  });
});