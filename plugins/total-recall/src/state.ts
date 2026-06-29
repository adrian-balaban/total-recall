import type { Index, InvertedIndex } from './types.js';
import { scheduleSave } from './persistence.js';

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

// Bump the access-tracking fields (accessCount + lastAccessed) on a memory entry
// and schedule an index save. Three call sites share the exact same triple:
//   - get_memories_by_keys(full)         — deferred to after a successful read
//   - recall_memory(full=true)           — unconditional, BEFORE the read
//   - (update_memory / delete_memory bypass — they replace the whole metadata object)
// Each site calls this on its own schedule (some pre-read, some post-read, some
// never — get_related_memories' includeContent path never bumps because that
// tool is a discovery query, not a "read"); this helper owns the
// micro-mutation + save only. Centralized so the scheduleSave() cadence is in
// one place and a future "also bump X" change happens once, not three times.
export function bumpAccess(meta: Index[string]): void {
  meta.accessCount++;
  meta.lastAccessed = new Date().toISOString();
  scheduleSave();
}