import * as fs from 'fs';
import * as path from 'path';
import { PERSONAL_VAULT, ensureDir } from './paths.js';

// ─── Journal append ──────────────────────────────────────────────────────────

export function appendJournal(action: string, key: string, title: string) {
  const today = new Date().toISOString().slice(0, 10);
  const journalPath = path.join(PERSONAL_VAULT, 'journal', `${today}.md`);
  ensureDir(path.dirname(journalPath));
  // Refuse to append through a planted symlink: if `journal/<today>.md` were a
  // symlink to an outside file, appendFileSync would follow it and write the
  // journal entry to the symlink's target (corrupting it). The personal vault
  // is local-only and never git-synced, so there is no remote planting vector,
  // but this mirrors the lstat containment every other write path now does
  // (Pass 1 store.ts / Pass 2 sync-org-memory.cjs) — the last append-without-
  // lstat gap. Silent skip: the journal is a best-effort side-effect and must
  // never throw into a store_memory call (it runs after the file + memIndex
  // write at line ~206). ENOENT = first append of the day (file not yet
  // created) → fall through to appendFileSync, which creates it.
  try {
    if (fs.lstatSync(journalPath).isSymbolicLink()) return;
  } catch (e: any) {
    if (e && e.code !== 'ENOENT') throw e;
  }
  const entry = `\n- ${new Date().toISOString()} [${action}] **${title}** (\`${key}\`)\n`;
  fs.appendFileSync(journalPath, entry);
}