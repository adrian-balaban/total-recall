# eval/ — offline ranking-quality harness

`recall_harness.py` — a DeepEval-style recall harness that drives the **real**
total-recall MCP tool surface (spawns `dist/index.js`, speaks JSON-RPC over
stdio) and measures ranking quality (recall@5, MRR, NDCG@5) on a labeled,
adversarial query set.

## Why

Phase 5 landed two TF-IDF quality fixes (5.1: substring → exact-token title
boost; 5.2: sublinear-TF + per-doc length normalization). The unit tests assert
specific rankings but, as the Stryker audit shows (`reviews/stryker-mutation-
audit-26072026.md`), ~half the covered TF-IDF mutants survive — the unit tests
are formula-weak. This harness proves the fixes improve **ranking** rather than
guessing, by A/B-ing the live server against a shadow baseline scorer that
reproduces the pre-fix TF-IDF (raw tf, substring title boost, no length norm).

## The proof

On adversarial queries the fixes change the ranking:

| query  | gold (title)   | trap (title)      | live top | baseline top | verdict |
|--------|----------------|-------------------|----------|--------------|---------|
| cat    | Cat            | Catalogue         | Cat ✓    | Catalogue ✗  | PASS    |
| flink  | Flink CDC      | General notes     | Flink CDC ✓ | General notes ✗ | PASS |

NDCG@5: current 1.000 vs baseline 0.815 (+0.185). The trap docs win under the
pre-fix scorer (substring title boost + raw tf / no length norm) and lose
under the current server.

## Run

```
python3 scripts/eval/recall_harness.py
```

Requires a built `dist/index.js` (`npm run build`). stdlib Python only — no
`deepeval` dependency (the harness mimics DeepEval's "evaluate the MCP server
directly" pattern; it is an offline audit, not a plugin runtime dependency).

Exit code 0 = PASS (current beats baseline on NDCG@5 averaged AND every
adversarial query ranks gold first under current while the trap outranks gold
under baseline); 1 = FAIL.