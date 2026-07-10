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
import { recalcIdfNow, scheduleSave } from '../persistence.js';
import { recordError } from '../state.js';

vi.mock('../vault-scan.js', () => ({
  reconcileIndex: vi.fn(),
}));

vi.mock('../persistence.js', () => ({
  recalcIdfNow: vi.fn(),
  scheduleSave: vi.fn(),
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
