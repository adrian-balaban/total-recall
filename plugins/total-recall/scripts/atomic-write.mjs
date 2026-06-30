// Shared atomic-write helper for the standalone .mjs scripts that write to the
// vault / org index outside the bundled MCP server (scripts/sync-org-memory.mjs
// and hooks/scripts/store-learning.mjs). The server itself uses persistence.ts
// atomicWrite; these scripts can't import the bundled server, so this is the
// .mjs-side equivalent.
//
// Atomic write = write to `<path>.tmp.<random-hex>` then rename onto `<path>`.
// rename is atomic on POSIX, so a reader never sees a half-written file. Two
// leak risks in the window between writeFileSync and renameSync, both fixed here:
//   1. A thrown error (rename across devices, ENOSPC mid-write, target is a
//      directory) → the .tmp is left on disk. try/finally unlinks it.
//   2. A SIGTERM/SIGINT/SIGHUP between the two calls (sync-org-memory.mjs is
//      backgrounded by the PostToolUse hook; PreCompact can be interrupted) →
//      the .tmp is left on disk. The caller registers signal handlers that call
//      cleanupInFlightTmp() to unlink whatever write is in flight.
// Mirrors the `trap cleanup EXIT` pattern in hooks/scripts/build-memory-index.sh.
//
// Random tmp suffix: process.pid is enumerable (a local attacker can read it via
// ps), so a planted symlink at `<path>.tmp.<pid>` could be followed by
// writeFileSync and clobber an outside file. randomBytes makes the tmp path
// unguessable, closing the predictable-tmp symlink race.
import fs from 'node:fs';
import crypto from 'node:crypto';

// The .tmp path currently between writeFileSync and renameSync, or null outside
// an active atomicWrite. Module-level (single-threaded scripts): only one write
// is in flight at a time.
let pendingTmp = null;

export function atomicWrite(p, data) {
  const tmp = `${p}.tmp.${crypto.randomBytes(6).toString('hex')}`;
  pendingTmp = tmp;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, p);
  } finally {
    // On success rename moved tmp → p, so existsSync is false (no-op). On
    // failure (throw) remove the half-written tmp so it can't leak — and, for
    // store-learning.mjs, so a partial .md isn't mistaken for a finished memory
    // by the next run's existsSync guard (which would permanently block that
    // learning from re-extraction).
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    pendingTmp = null;
  }
}

// Remove the in-flight .tmp if a signal interrupts atomicWrite between
// writeFileSync and renameSync. Registered as SIGTERM/SIGINT/SIGHUP handlers by
// the importing scripts. No-op when no write is in flight (pendingTmp null), so
// a signal at any other time just exits with nothing to clean.
export function cleanupInFlightTmp() {
  try { if (pendingTmp && fs.existsSync(pendingTmp)) fs.unlinkSync(pendingTmp); } catch {}
}