# Stryker Mutation Audit — 2026-07-26

Run once as an audit (per the Technology Radar vol.34 point: *coverage ≠ fault
detection*). Coverage is gated at 95%, but a perpetually-green suite can still
assert nothing on the kind of logic this codebase has — decay math, RRF
fusion, dim mismatches, atomic-write durability. Stryker mutates the code and
asks: does any test actually notice?

## Setup

- `stryker.conf.json` + `vitest.stryker.config.ts` (dedicated config — the full
  suite's env-sensitive integration/server-boot tests are flaky under Stryker's
  instrumented perTest runner, so the audit uses the stable unit-test allow-list
  that covers the 5 targets: ebbinghaus / tfidf / rrf / persistence / vectorStore).
- `coverageAnalysis: perTest`, `concurrency: 2`, 840 mutants across 5 files.
- HTML report: `reports/mutation/mutation.html`.

## Score

| File           | total | covered | killed | survived | no-cov |
|----------------|------:|--------:|-------:|---------:|-------:|
| All files      | 24.64 |  37.03 |   207  |    352   |   281  |
| ebbinghaus.ts   | 83.78 |  83.78 |    31  |      6   |     0  |
| rrf.ts         | 66.67 |  66.67 |     8  |      4   |     0  |
| tfidf.ts       | 41.22 |  53.51 |    61  |     53   |    34  |
| vectorStore.ts | 28.80 |  53.85 |    91  |     78   |   147  |
| persistence.ts |  4.89 |   7.05 |    16  |    211   |   100  |

(covered = score over mutants whose line is executed by ≥1 test; total = over
all mutants. `no-cov` = the line never ran in the included suite.)

## Verdict — which Phase 3/5 fixes have teeth

- **Phase 5.3 + 11.1 (ebbinghaus confirmations/flags + NaN per-axis guards):
  STRONG TEETH (83.78%).** Only 6 survivors. The `Number.isFinite` per-axis
  guards added in 11.1 are well-pinned — mutating the fallback defaults kills
  the test. This is the best-tested of the audited logic.

- **Phase 3.6 (RRF empty-vector guard): MODERATE TEETH (66.67%).** The
  short-circuit on empty `vecResults` is pinned by `recall.test.ts` 3.6, but 4
  mutants survive in the fusion math — the score-scale assertion is a ratio
  band (0.3, 3), which admits some algebraic mutants. Tightenable, not broken.

- **Phase 5.1/5.2 (TF-IDF exact-token boost + sublinear-TF + length norm):
  PARTIAL TEETH (53.51% covered).** ~half the covered mutants survive and 34
  lines have no unit coverage at all. The unit tests assert specific rankings
  but don't fully pin the scoring formula — the classic "perpetually green"
  risk. **The DeepEval-style recall harness (`scripts/eval/recall_harness.py`)
  closes this end-to-end**: it drives the real MCP `recall_memory` tool and
  proves that on adversarial queries (`cat`→`Catalogue` substring trap,
  `flink`→`General notes` raw-tf trap) the current server ranks the gold doc
  first while the pre-fix shadow baseline promotes the trap (NDCG@5 1.000 vs
  0.815). So 5.1/5.2 are proven at the ranking-quality level even though the
  unit tests are formula-weak.

- **Phase 3.1–3.5 (vectorStore dim guards): WEAK TEETH (53.85% covered, 147
  no-cov).** The dim-mismatch read/write guards are the Phase 3 fixes; the
  audit excluded `vectorStore-getVectors.test.ts` (real sqlite-vec, flaky
  under Stryker's instrumented runner) which carries the 11.3a dim-mismatch
  tests. Re-including it under a stable runner would raise this score; the
  survivors are concentrated in the `no such table` / `if (!d) return`
  graceful-degradation branches of `deleteVector`/`listVectorKeys`, not the
  dim guards themselves.

- **Phase 2.3 + 4.1 (persistence atomicWrite + fsync + last-good-on-fail):
  WEAK TEETH (7.05% covered).** **The headline finding.** The durability fixes
  — parent-dir fsync, leave-last-good on tmp-write fail, rename-fallback guard
  — are the least test-pinned logic in the codebase. Tests verify the happy
  write path but mutants in the crash-recovery branches survive because the
  tests can't easily simulate a mid-rename crash. The fsync calls are
  best-effort `try/catch` (inherently untestable without FS fault injection),
  so a chunk of the survivors are legitimately unkillable — but the
  `last-good` retention logic (4.1) is testable and currently undertested.
  **Recommended follow-up:** a fault-injection test that stubs `fs.renameSync`
  to throw and asserts the previous file is still present and intact.

## What this means

The audit confirms the Radar's thesis: 95% line coverage coexists with logic
that tests don't actually pin. The decay math (ebbinghaus) is well-pinned; the
durability math (persistence) is not. The TF-IDF quality fixes are pinned at
the ranking level by the DeepEval harness, not at the formula level by unit
tests — a defensible split (ranking is what users observe), but the
formula-level survivors mean a future refactor could silently regress scoring
without tripping the unit suite.

The audit is a snapshot, not a gate. It is not added to CI (mutation runs take
~2 min and perturb env-sensitive tests); it lives in `reviews/` as a one-off
verdict and a baseline for future re-runs after targeted test hardening.