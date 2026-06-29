import * as fs from 'fs';
import * as path from 'path';
import { PERSONAL_VAULT, ensureDir } from './paths.js';
import { assertRegularFile } from './vault-scan.js';

// ─── Journal append ──────────────────────────────────────────────────────────

export function appendJournal(action: string, key: string, title: string) {
  const today = new Date().toISOString().slice(0, 10);
  const journalPath = path.join(PERSONAL_VAULT, 'journal', `${today}.md`);
  ensureDir(path.dirname(journalPath));
  // Reuse the vault-wide regular-file guard (assertRegularFile, see vault-scan.ts):
  // a symlink planted at journal/<today>.md is rejected exactly as the former
  // isSymbolicLink check did (lstat → isFile()=false → throws → caught → skip),
  // and a directory planted there now skips silently instead of throwing EISDIR
  // up into the caller — a behavior change, but the safe direction: this function
  // runs after the file + memIndex write and the journal is a best-effort side-
  // effect that must never throw into a store_memory call. ENOENT (first append of
  // the day) is let through by assertRegularFile, so the happy create-then-append
  // path is unchanged. Mirrors store.ts / mutate.ts.
  try {
    assertRegularFile(journalPath, key);
  } catch {
    return;
  }
  const entry = `\n- ${new Date().toISOString()} [${action}] **${title}** (\`${key}\`)\n`;
  // The journal append is the LAST step of store_memory, AFTER the .md file
  // write, memIndex update, and scheduleSave() have already succeeded — so the
  // memory is already durable when we get here. assertRegularFile above guards
  // the symlink/dir case, but a TOCTOU between that lstat and this append, an
  // ENOSPC (disk full), or an EACCES must NOT throw into the store_memory call:
  // the dispatch catch in server.ts would catch it and return isError:true,
  // making the agent believe the store failed and retry — creating a DUPLICATE
  // memory at the same key (store_memory throws on duplicate without force).
  // The header invariant ("must never throw into a store_memory call") holds
  // only if this append is guarded too. Swallow; the memory itself is safe and
  // a missed journal line is cosmetic. Mirrors the assertRegularFile guard.
  try {
    fs.appendFileSync(journalPath, entry);
  } catch {
    /* best-effort journal; must never throw into store_memory (would surface as isError and trigger a duplicate-key retry) */
  }
}