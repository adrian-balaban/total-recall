/**
 * Ebbinghaus forgetting curve decay model with confirmation/flag feedback.
 * strength = clamp(importance × exp(-λ × daysSince) × (1 + accessCount × 0.2 + confirmations × 0.1 - flags × 0.1), 0, 1)
 * where λ = 0.16 × (1 − importance × 0.8)
 */
export function computeRetentionStrength(
  importance: number,
  daysSince: number,
  accessCount: number,
  confirmations = 0,
  flags = 0
): number {
  // Coerce each input to a finite number in a sensible range. The store_memory
  // schema clamps importanceScore to [0, 1] and update_memory clamps it on
  // write, but a hand-edited (or teammate-pushed) frontmatter can carry
  // importanceScore: -1 / 5 / NaN / "high" — without these guards the
  // exponential term propagates NaN through the entire formula, and a
  // negative importanceScore would yield negative retention (prune_memories
  // asserts retentionStrength >= 0 in its tests).
  const i = Number.isFinite(importance) ? Math.max(0, Math.min(1, importance)) : 0.5;
  const d = Number.isFinite(daysSince) ? Math.max(0, daysSince) : 0;
  const a = Number.isFinite(accessCount) ? Math.max(0, accessCount) : 0;
  const c = Number.isFinite(confirmations) ? Math.max(0, confirmations) : 0;
  const f = Number.isFinite(flags) ? Math.max(0, flags) : 0;
  const lambda = 0.16 * (1 - i * 0.8);
  // Confirmation / flag feedback: a confirmed memory is reinforced (+0.1 per
  // confirmation); a flagged memory decays faster (−0.1 per flag). The total
  // multiplier is clamped to [0, ∞) and then the final strength to [0, 1].
  const boost = 1 + a * 0.2 + c * 0.1 - f * 0.1;
  const strength = i * Math.exp(-lambda * d) * boost;
  return Math.max(0, Math.min(1, strength));
}

// Clamp a raw importanceScore value — from MCP args, parsed frontmatter, or a
// restored index.json entry — to a finite number in [0, 1]. MCP does not
// enforce the tool's inputSchema, and a hand-edited / teammate-pushed (via the
// shared org vault) / pre-v1.0.9 frontmatter can carry `importanceScore: 'high'`,
// `5`, `-1`, or `NaN`. The Number.isFinite guard is critical: `Math.min(1, NaN)`
// returns NaN (NaN propagates through Math.min/max), so without it a non-numeric
// string would persist as NaN and then surface via list_memories /
// get_related_memories / prune_memories. Fall back to 0.5 (the schema default),
// matching computeRetentionStrength's own fallback. Centralized here so the
// four write/restore/scan paths (store_memory, update_memory, indexFile,
// coerceMemEntry) share one implementation instead of four copies of the clamp
// expression and its rationale.
export function clampImportanceScore(v: unknown, fallback = 0.5): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

export function daysSince(date: string | Date): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 0;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}
