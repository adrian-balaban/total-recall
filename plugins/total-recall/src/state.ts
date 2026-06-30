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

// #21: amortized-O(1) bounded append. The prior `if (length > CAP) shift()`
// re-indexed the whole array on every push past the cap — O(N) per push, O(N²)
// over a long-lived session (one process per Claude Code session, potentially
// days of recurring errors / tool calls). `shift` is a single cap-sized memmove
// each time; doing it every push moves the same tail over and over. Instead let
// the buffer grow to 2×CAP, then splice down to CAP in one shot: each element is
// memmoved at most once over its lifetime, so amortized cost per push is O(1)
// (one cap-sized memmove every CAP pushes). The buffer oscillates in [CAP, 2×CAP],
// so tail reads (errors.slice(-10) in getStats, [...perfSamples].sort for
// percentiles) see only the most-recent entries — semantically identical to the
// per-push shift, just with up to 2×CAP held momentarily between trims.
// N is capped at 1000 (~8KB), so this is a micro-optimization, not a bottleneck —
// but it removes the O(N²) shape that would bite only in a pathological
// error-storm / multi-day session. getStats only returns the last 10 errors, so
// the exact cap is invisible to consumers either way.
const ERROR_CAP = 1000;
const PERF_CAP = 1000;
function trimTo<T>(arr: T[], cap: number): void {
  if (arr.length > cap * 2) arr.splice(0, arr.length - cap);
}

// Append to the shared `errors` singleton with a cap (see trimTo above). A
// long-lived stdio server with a recurring error — a misbehaving client hitting
// an unknown tool, or a teammate-pushed malformed org file failing indexFile on
// every reconcile — would otherwise grow `errors` without limit. Centralized
// here so every push site (server.ts dispatch catch, vault-scan indexFile catch,
// persistence debounce/flush catches) is bounded uniformly.
export function recordError(msg: string): void {
  errors.push({ time: new Date().toISOString(), msg });
  trimTo(errors, ERROR_CAP);
}

// Record a tool-call latency sample with the same bounded-append policy as
// recordError. server.ts' CallTool handler is the only producer; getStats
// derives p50/p95/p99 from [...perfSamples].sort. Centralized so the cap + trim
// live in one place (the prior inline `push; if (>1000) shift` in server.ts was
// a second copy of the same O(N²) pattern).
export function recordPerfSample(ms: number): void {
  perfSamples.push(ms);
  trimTo(perfSamples, PERF_CAP);
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