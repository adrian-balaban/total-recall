/**
 * Ebbinghaus forgetting curve decay model.
 * strength = clamp(importance × exp(-λ × daysSince) × (1 + accessCount × 0.2), 0, 1)
 * where λ = 0.16 × (1 − importance × 0.8)
 */
export function computeRetentionStrength(
  importance: number,
  daysSince: number,
  accessCount: number
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
  const lambda = 0.16 * (1 - i * 0.8);
  const strength = i * Math.exp(-lambda * d) * (1 + a * 0.2);
  return Math.max(0, Math.min(1, strength));
}

export function daysSince(date: string | Date): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 0;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}
