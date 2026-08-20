import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Set HOME before any module loads so paths.ts resolves into a test directory.
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-auto-' + process.pid;
});

import { checkReconcileRequest, startAutoReconcile } from '../auto-reconcile.js';
import { RECONCILE_REQUEST_FLAG } from '../paths.js';
import { reconcileIndex } from '../vault-scan.js';
import { recalcIdfNow, scheduleSave, markIndexFresh } from '../persistence.js';
import { recordError } from '../state.js';

vi.mock('../vault-scan.js', () => ({
  reconcileIndex: vi.fn(),
}));

vi.mock('../persistence.js', () => ({
  recalcIdfNow: vi.fn(),
  scheduleSave: vi.fn(),
  markIndexFresh: vi.fn(),
  loadIndexes: vi.fn(),
}));

vi.mock('../state.js', () => ({
  recordError: vi.fn(),
  recordPerfSample: vi.fn(),
  errors: [],
  perfSamples: [],
}));

beforeEach(() => {
  vi.clearAllMocks();
  fs.mkdirSync(path.dirname(RECONCILE_REQUEST_FLAG), { recursive: true });
  try { fs.rmSync(RECONCILE_REQUEST_FLAG, { force: true }); } catch {}
});

describe('checkReconcileRequest', () => {
  it('returns false and does nothing when the marker is absent', () => {
    expect(checkReconcileRequest()).toBe(false);
    expect(reconcileIndex).not.toHaveBeenCalled();
    expect(recalcIdfNow).not.toHaveBeenCalled();
    expect(scheduleSave).not.toHaveBeenCalled();
  });

  it('returns true, deletes the marker, and reconciles when the marker exists', () => {
    fs.writeFileSync(RECONCILE_REQUEST_FLAG, '');
    expect(checkReconcileRequest()).toBe(true);
    expect(fs.existsSync(RECONCILE_REQUEST_FLAG)).toBe(false);
    expect(reconcileIndex).toHaveBeenCalledTimes(1);
    expect(recalcIdfNow).toHaveBeenCalledTimes(1);
    expect(scheduleSave).toHaveBeenCalledTimes(1);
  });

  it('8.3: calls markIndexFresh after scheduleSave to skip the redundant +2s rebuild', () => {
    // recalcIdfNow() rebuilds the inverted index synchronously; scheduleSave()
    // sets dirtyTokens, so without markIndexFresh the 1s index-save timer would
    // chain scheduleIdfRecalc (+2s) and rebuild the SAME inverted index again.
    // markIndexFresh clears dirtyTokens, mirroring main()'s boot sequence, so
    // the timer writes index.json only. A regression that drops markIndexFresh
    // fails this assertion (it's never called).
    fs.writeFileSync(RECONCILE_REQUEST_FLAG, '');
    expect(checkReconcileRequest()).toBe(true);
    expect(markIndexFresh).toHaveBeenCalledTimes(1);
    // Ordering matters: markIndexFresh must run AFTER scheduleSave (clearing
    // the flag scheduleSave just set), not before. Verify call order.
    const calls = vi.mocked(scheduleSave).mock.invocationCallOrder[0]!;
    const fresh = vi.mocked(markIndexFresh).mock.invocationCallOrder[0]!;
    expect(fresh).toBeGreaterThan(calls);
  });

  it('records an error and still deletes the marker when reconcileIndex throws', () => {
    vi.mocked(reconcileIndex).mockImplementation(() => {
      throw new Error('reconcile boom');
    });
    fs.writeFileSync(RECONCILE_REQUEST_FLAG, '');
    expect(checkReconcileRequest()).toBe(true);
    expect(fs.existsSync(RECONCILE_REQUEST_FLAG)).toBe(false);
    expect(recordError).toHaveBeenCalled();
    expect(vi.mocked(recordError).mock.calls[0]![0]).toContain('reconcile boom');
  });
});

describe('startAutoReconcile', () => {
  it('polls the marker and triggers reconcile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      startAutoReconcile(10);
      fs.writeFileSync(RECONCILE_REQUEST_FLAG, '');
      await vi.advanceTimersByTimeAsync(25);
      expect(reconcileIndex).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// The `'unref' in interval` guard exists so a poll timer never keeps a test or a
// shutting-down process alive. Node's Timeout exposes hasRef(), which makes the
// effect observable — without this the guard could be deleted outright and no
// test would notice.
describe('startAutoReconcile — timer does not hold the process open', () => {
  it('unrefs the interval it returns', () => {
    const interval = startAutoReconcile(60_000);
    try {
      expect(typeof (interval as any).hasRef).toBe('function');
      expect((interval as any).hasRef()).toBe(false);
    } finally {
      clearInterval(interval);
    }
  });
});
