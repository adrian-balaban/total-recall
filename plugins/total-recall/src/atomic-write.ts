import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Leaf module: write-then-rename with fsync, shared by persistence.ts (the index
// files) and the SessionStart index-cache bundle. It imports nothing from the
// project, so the bundle can use it without pulling in state, vectors or persistence;
// failures go to the caller's `onError` sink instead of a recordError import.
//
// A SIGKILL / power loss mid-write must not leave a half-truncated file. rename is
// atomic on POSIX. fsync of the tmp file before the rename, and of the parent dir
// after, makes the guarantee survive a crash; both are best-effort (Windows and some
// network file systems do not support them) and the rename atomicity holds without them.

export type ErrorSink = (message: string) => void;

function fsyncDir(dir: string): void {
  try {
    const fd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch { /* Windows / network FS don't support dir fsync; best-effort */ }
}

export function atomicWrite(p: string, data: string, onError: ErrorSink = () => {}): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Random tmp suffix, not a predictable `${p}.tmp`: a local attacker who can write the
  // vault dir could pre-plant a symlink at the predictable path and writeFileSync would
  // follow it and clobber an outside file.
  const tmp = `${p}.tmp.${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, data);
  } catch (e) {
    // Leave the last-good target untouched. A direct overwrite here would defeat the
    // point of an atomic write, and whatever blocked the tmp (ENOSPC, EACCES, EROFS)
    // blocks a direct write too. Report instead of throwing: callers run from debounced
    // timers and exit handlers, where an uncaught throw kills the stdio server.
    onError(`atomicWrite(${p}) tmp-write failed (last-good left intact): ${(e as Error).message}`);
    return;
  }
  try {
    const fd = fs.openSync(tmp, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch { /* best-effort: fsync unsupported on this FS — rename still atomic */ }
  try {
    fs.renameSync(tmp, p);
  } catch (renErr) {
    // Rename can fail on Windows (open handles, cross-volume). Fall back to a guarded
    // direct overwrite: it loses POSIX atomicity but lands the data. The orphaned tmp
    // is removed either way.
    try {
      fs.writeFileSync(p, data);
    } catch (e) {
      onError(`atomicWrite(${p}) rename-fallback: rename=${(renErr as Error).message}; write=${(e as Error).message}`);
    }
    try { fs.unlinkSync(tmp); } catch { /* best-effort cleanup of the orphaned tmp */ }
    return;
  }
  fsyncDir(path.dirname(p));
}
