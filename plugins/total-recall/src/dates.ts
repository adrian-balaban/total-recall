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