/**
 * Background reconcile trigger for the long-running MCP server.
 *
 * Claude Code SessionStart hooks (e.g. pull-org-vault.sh) cannot call into the
 * stdio MCP server directly, so they drop a marker file instead. The server
 * polls for the marker and, when present, re-runs the same reconcile path used
 * at boot. reconcileIndex is mtime-cached, so the poll is cheap when nothing has
 * changed.
 */

import * as fs from 'fs';
import { RECONCILE_REQUEST_FLAG } from './paths.js';
import { recalcIdfNow, scheduleSave } from './persistence.js';
import { recordError } from './state.js';
import { reconcileIndex } from './vault-scan.js';

const DEFAULT_POLL_MS = 10_000;

/**
 * Check for a pending reconcile request. If the marker exists, delete it and
 * run the reconcile + IDF recalculation path. Returns true if a reconcile was
 * performed, false otherwise.
 */
export function checkReconcileRequest(): boolean {
  try {
    fs.statSync(RECONCILE_REQUEST_FLAG);
  } catch {
    return false;
  }

  try {
    fs.unlinkSync(RECONCILE_REQUEST_FLAG);
  } catch {
    // Another poller may have removed it; still reconcile below.
  }

  try {
    reconcileIndex();
    recalcIdfNow();
    scheduleSave();
  } catch (e) {
    recordError(`auto-reconcile: ${e instanceof Error ? e.message : String(e)}`);
  }
  return true;
}

/**
 * Start the background poller. Returns the interval handle; in production this
 * is never cleared because the server runs for the lifetime of the session. The
 * interval is unref'd so it does not keep a test or shutdown process alive if the
 * rest of the program has finished.
 */
export function startAutoReconcile(pollMs = DEFAULT_POLL_MS): ReturnType<typeof setInterval> {
  const interval = setInterval(() => {
    checkReconcileRequest();
  }, pollMs);
  if ('unref' in interval) {
    (interval as ReturnType<typeof setInterval>).unref();
  }
  return interval;
}
