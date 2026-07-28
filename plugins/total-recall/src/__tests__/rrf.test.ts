import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from '../rrf.js';

describe('reciprocalRankFusion', () => {
  it('returns empty map for empty input', () => {
    expect(reciprocalRankFusion([])).toEqual(new Map());
  });

  it('scores a single-item list: rank-0 gets 1/(k+1)', () => {
    const result = reciprocalRankFusion([[{ key: 'a', score: 10 }]]);
    expect(result.get('a')).toBeCloseTo(1 / 61);
  });

  it('lower rank = lower score within one list', () => {
    const result = reciprocalRankFusion([[{ key: 'a', score: 10 }, { key: 'b', score: 5 }]]);
    expect(result.get('a')!).toBeGreaterThan(result.get('b')!);
  });

  it('doc appearing in two lists scores higher than doc in one list', () => {
    const l1 = [{ key: 'a', score: 10 }, { key: 'b', score: 5 }];
    const l2 = [{ key: 'b', score: 8 }, { key: 'c', score: 3 }];
    const result = reciprocalRankFusion([l1, l2]);
    // b appears in both lists; a appears only in l1 (rank 0)
    // b: 1/62 + 1/61 ≈ 0.0325; a: 1/61 ≈ 0.0164
    expect(result.get('b')!).toBeGreaterThan(result.get('a')!);
  });

  it('doc top in three lists beats docs in one list each', () => {
    const l1 = [{ key: 'a', score: 3 }, { key: 'b', score: 2 }];
    const l2 = [{ key: 'a', score: 5 }, { key: 'c', score: 1 }];
    const l3 = [{ key: 'a', score: 2 }];
    const result = reciprocalRankFusion([l1, l2, l3]);
    // a: 3 * 1/61 ≈ 0.049; b: 1/62 ≈ 0.016; c: 1/62 ≈ 0.016
    const aScore = result.get('a') ?? 0;
    const bScore = result.get('b') ?? 0;
    const cScore = result.get('c') ?? 0;
    expect(aScore).toBeGreaterThan(bScore);
    expect(aScore).toBeGreaterThan(cScore);
  });

  it('custom k: smaller k gives higher score for top-ranked doc', () => {
    const list = [{ key: 'a', score: 1 }];
    expect(reciprocalRankFusion([list], 10).get('a')!).toBeGreaterThan(
      reciprocalRankFusion([list], 60).get('a')!
    );
  });

  it('does not mutate input lists', () => {
    const list = [{ key: 'a', score: 5 }, { key: 'b', score: 3 }];
    const snapshot = list.map(x => ({ ...x }));
    reciprocalRankFusion([list]);
    expect(list).toEqual(snapshot);
  });

  it('handles single-element lists correctly', () => {
    const result = reciprocalRankFusion([[{ key: 'x', score: 1 }], [{ key: 'y', score: 1 }]]);
    expect(result.get('x')).toBeCloseTo(1 / 61);
    expect(result.get('y')).toBeCloseTo(1 / 61);
  });

  it('exact fused scores for multi-list unequal-score inputs (default k=60)', () => {
    // Unequal scores within each list → sort order is exercised; a shared key
    // spans both lists so the +1 rank offset and the accumulator both fire.
    const l1 = [{ key: 'shared', score: 10 }, { key: 'onlyA', score: 4 }];
    const l2 = [{ key: 'onlyB', score: 9 }, { key: 'shared', score: 7 }];
    const result = reciprocalRankFusion([l1, l2], 60);
    // l1 sorted: shared (rank0) → 1/61; onlyA (rank1) → 1/62
    // l2 sorted: onlyB (rank0) → 1/61; shared (rank1) → 1/62
    expect(result.get('shared')!).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(result.get('onlyA')!).toBeCloseTo(1 / 62, 10);
    expect(result.get('onlyB')!).toBeCloseTo(1 / 61, 10);
    // shared outranks onlyB despite onlyB being rank-0 in its list — two-list
    // accumulation beats a single rank-0.
    expect(result.get('shared')!).toBeGreaterThan(result.get('onlyB')!);
    // input lists not mutated
    expect(l1).toEqual([{ key: 'shared', score: 10 }, { key: 'onlyA', score: 4 }]);
    expect(l2).toEqual([{ key: 'onlyB', score: 9 }, { key: 'shared', score: 7 }]);
  });

  it('exact fused scores with custom k=10', () => {
    const l1 = [{ key: 'shared', score: 10 }, { key: 'onlyA', score: 4 }];
    const l2 = [{ key: 'onlyB', score: 9 }, { key: 'shared', score: 7 }];
    const result = reciprocalRankFusion([l1, l2], 10);
    // k=10: rank0 → 1/11; rank1 → 1/12
    expect(result.get('shared')!).toBeCloseTo(1 / 11 + 1 / 12, 10);
    expect(result.get('onlyA')!).toBeCloseTo(1 / 12, 10);
    expect(result.get('onlyB')!).toBeCloseTo(1 / 11, 10);
  });

  it('sorts each list by score descending before ranking', () => {
    // Identical keys, deliberately out-of-order scores: the rank assigned to
    // each key must follow the sorted order, not the input order.
    const l1 = [{ key: 'lo', score: 1 }, { key: 'hi', score: 100 }];
    const result = reciprocalRankFusion([l1], 60);
    expect(result.get('hi')!).toBeCloseTo(1 / 61, 10);
    expect(result.get('lo')!).toBeCloseTo(1 / 62, 10);
    expect(result.get('hi')!).toBeGreaterThan(result.get('lo')!);
  });

  it('accumulates across more than two lists for the same key', () => {
    const lists = [
      [{ key: 'k', score: 5 }],
      [{ key: 'k', score: 5 }],
      [{ key: 'k', score: 5 }],
    ];
    const result = reciprocalRankFusion(lists, 60);
    expect(result.get('k')!).toBeCloseTo(3 * (1 / 61), 10);
  });

  it('k=0 yields 1/(rank+1) exactly', () => {
    const l1 = [{ key: 'a', score: 10 }, { key: 'b', score: 5 }];
    const result = reciprocalRankFusion([l1], 0);
    expect(result.get('a')!).toBeCloseTo(1 / 1, 10); // rank0 → 1/(0+0+1)
    expect(result.get('b')!).toBeCloseTo(1 / 2, 10); // rank1 → 1/(0+1+1)
  });

  it('ignores the input score field in the fused result (only rank matters)', () => {
    // Same key, same rank (0) in two lists, wildly different scores — the fused
    // value must be 2 * 1/(k+1) regardless of the score magnitudes.
    const l1 = [{ key: 'k', score: 999 }];
    const l2 = [{ key: 'k', score: 1 }];
    const result = reciprocalRankFusion([l1, l2], 60);
    expect(result.get('k')!).toBeCloseTo(2 * (1 / 61), 10);
  });
});
