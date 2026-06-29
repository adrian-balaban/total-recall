// ─── Date filter helpers ──────────────────────────────────────────────────────

export function parseRelativeDate(expr: string): Date | null {
  const m = expr.match(/^(\d+)([dwm])$/);
  if (!m) return null;
  const n = parseInt(m[1]);
  const unit = m[2];
  const ms = unit === 'd' ? n * 86400000 : unit === 'w' ? n * 7 * 86400000 : n * 30 * 86400000;
  return new Date(Date.now() - ms);
}

// Resolve a `since`/`before` bound (relative shorthand OR an ISO date) to a
// valid Date, throwing when NEITHER form parses. The old call sites used
// `parseRelativeDate(expr) ?? new Date(expr)`, so an unparseable relative like
// `1y`, `7days`, or `yesterday` fell through to `new Date(expr)` → Invalid Date,
// and `new Date(updated) >= Invalid` / `< Invalid` are both false — every result
// was silently dropped as if the date filter matched nothing. Surfacing the bad
// input as an error beats an empty result that looks indistinguishable from
// "nothing matches".
export function toCutoff(expr: string): Date {
  const d = parseRelativeDate(expr) ?? new Date(expr);
  if (isNaN(d.getTime())) {
    throw new Error(
      `Invalid date filter "${expr}": expected a relative shorthand (e.g. 7d, 2w, 1m) or an ISO date (e.g. 2026-06-24).`
    );
  }
  return d;
}

// True if `updated` falls in the [lower, upper) window. `lower`/`upper` are
// already-resolved Date cutoffs — callers resolve them ONCE via toCutoff (which
// throws on a bad bound, so the throw point is unchanged) and reuse them across
// the whole result set, so the per-item work stays one `new Date` + two compares
// (resolving the bound inside the predicate would call toCutoff N times). Either
// bound may be null for a one-sided or unbounded window. A missing or unparseable
// `updated` returns false — mirrors list_memories / recall_memory / search_index,
// which silently drop memories lacking a valid `updated` when a date filter is
// active (see CLAUDE.md "Key Gotchas": every memory SHOULD carry `updated`; the
// drop is the safest fallback for externally-authored files that predate the
// field). Lower is inclusive (>= lower), upper exclusive (< upper) — matches the
// prior inlined `updated ? new Date(updated) >= cutoff : false` /
// `new Date(updated) < cutoff` blocks that this consolidates. Callers control
// the no-filter case: recall/searchIndex pass null for a bound only when that
// bound is absent AND guard the whole filter with `if (lower || upper)` so the
// no-filter case keeps every entry (matching the old skip-both-blocks path);
// getTimeline passes a `new Date(0)` epoch default for `lower` so its lower is
// never null and the timeline ALWAYS excludes missing-`updated` entries even with
// no filters (its prior `new Date(m.updated) >= new Date(0)` behavior).
export function inDateWindow(updated: string | undefined | null, lower: Date | null, upper: Date | null): boolean {
  if (!updated) return false;
  const d = new Date(updated);
  if (isNaN(d.getTime())) return false;
  if (lower && d < lower) return false;
  if (upper && d >= upper) return false;
  return true;
}