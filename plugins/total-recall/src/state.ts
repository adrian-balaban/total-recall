import type { Index, InvertedIndex } from './types.js';
import { scheduleAccessSave } from './persistence.js';

// ─── In-memory state (shared singletons) ─────────────────────────────────────
// Every module imports these from here so there is exactly one memIndex /
// invertedIndex across the process. They are `const` objects with a stable
// identity: callers mutate in place (`memIndex[key] = …`, `delete memIndex[key]`)
// and the two sites that formerly reassigned them (loadIndexes,
// rebuildInvertedIndex) now clear-then-populate the same object. This preserves
// the single-source-of-truth invariant the test suite depends on (it re-imports
// the live module and resets via rebuild_index).

export const memIndex: Index = {};
export const invertedIndex: InvertedIndex = {};
export const errors: Array<{ time: string; msg: string }> = [];
export const perfSamples: number[] = [];

// Append to the shared `errors` singleton with a cap. A long-lived stdio server
// (one process per Claude Code session, potentially days) with a recurring error
// — a misbehaving client hitting an unknown tool, or a teammate-pushed malformed
// org file failing indexFile on every reconcile — would otherwise grow `errors`
// without limit. Mirror the perfSamples cap (server.ts shifts perfSamples > 1000).
// getStats only returns the last 10, so the cap is invisible to consumers.
// Centralize here so every push site (server.ts dispatch catch, vault-scan
// indexFile catch, persistence debounce/flush catches) is bounded uniformly.
export function recordError(msg: string): void {
  errors.push({ time: new Date().toISOString(), msg });
  if (errors.length > 1000) errors.shift();
}

// Bump the access-tracking fields (accessCount + lastAccessed) on a memory entry
// and schedule a lightweight index save. Three call sites share the exact same
// triple:
//   - get_memories_by_keys(full)         — deferred to after a successful read
//   - recall_memory(full=true)           — unconditional, BEFORE the read
//   - (update_memory / delete_memory bypass — they replace the whole metadata object)
// Each site calls this on its own schedule (some pre-read, some post-read, some
// never — get_related_memories' includeContent path never bumps because that
// tool is a discovery query, not a "read"); this helper owns the
// micro-mutation + save only. Centralized so the save cadence is in one place
// and a future "also bump X" change happens once, not three times.
//
// #4: this is the READ path. scheduleAccessSave (not scheduleSave) persists
// accessCount/lastAccessed to index.json WITHOUT rebuilding the inverted index
// — a read changes zero tokens, so the invertedIndex.json + cache rebuild that
// scheduleSave would trigger is pure waste (O(N) re-tokenization + a disk
// rewrite per access on a read-heavy session). Writes (store/update/delete/
// reconcile) still call scheduleSave, which sets the dirtyTokens flag and
// schedules the rebuild.
export function bumpAccess(meta: Index[string]): void {
  meta.accessCount++;
  meta.lastAccessed = new Date().toISOString();
  scheduleAccessSave();
}