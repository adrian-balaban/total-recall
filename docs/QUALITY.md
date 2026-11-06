# 📏 Quality metrics

Measured on **v1.7.1** at commit `af0c7cf` (2026-11-06). Test, coverage and mutation figures come from the CI run on `main`; the rest were computed from the source and the git history (the same method reproduces the v1.6.8 figures, see [Reproduce](#reproduce)). Four figures were **not re-measured** and still show their v1.6.8 value, marked as such: server start time, lead time, time to restore and the scale benchmarks. The formulas are from Neal Ford's masterclass *How to Teach Your Agents About Architecture* (Codecamp Iași, October 2026). "House" marks a target that is ours, not the course's.

[← README](../README.md)

## Summary

| Metric | Value | Gate | |
|---|---|---|---|
| Unit / integration tests | 1,022 / 24, all passing (plus 19 for the npx launcher) | — | ✅ |
| Coverage (statements · branches · functions · lines) | 96.7% · 90.9% · 95.0% · 97.9% | 95 · 90 · 95 · 95 | ✅ |
| Mutation score (Stryker, 18 modules in the v1.7.1 baseline) | **81.0%** | ≥ 65% `[TR-Q6]` | ✅ |
| Average cyclomatic complexity (441 functions) | 3.41 | < 4 | ✅ |
| Functions with complexity ≥ 10 | 26 (max 58, `storeMemory`) | 0; frozen by a ratchet `[TR-Q9]` | ⚠️ |
| Mean distance from the main sequence | 0.42 | < 0.6 | ✅ |
| Maintainability Level (12 components) | 72.7% | > 60% | ✅ |
| Longest identical run between two files | 6 lines | ≤ 10 `[TR-Q10]` | ✅ |
| Largest file | 471 lines | ≤ 600 `[TR-Q1]` | ✅ |
| Deployment frequency | 11.0 releases / month | > 1 / week *(house)* | ✅ |
| MCP server start time | 99 ms median (v1.6.8, not re-measured) | < 500 ms *(house)* | ✅ |

## Tests and mutation

Scope of the numbers: coverage is from the unit suite only (the integration tests are not counted); the mutation score is over all mutants Stryker generates in the 18 mutated modules of this v1.7.1 baseline (19 since 1.8.0); CI runs on `ubuntu-latest` with Node 20 ([workflow runs](https://github.com/adrian-balaban/total-recall/actions/workflows/mutation.yml)).

| | |
|---|---|
| Test files | 76, with 2,390 assertions (2.34 per test, house target ≥ 1.5) |
| Assertion-free tests, tautologies | 0, 0 (`[TR-Q4]`, `[TR-Q5]`) |
| Mutants | 1,586 killed, 1 timeout, 310 survived, 63 without coverage |
| Weakest modules | `paths.ts` 36.6%, `embeddings.ts` 52.2%, `atomic-write.ts` 60.9% (v1.7.1). Version 1.8.0 adds tests for these and puts `org-sync.ts` under mutation; a local Stryker run on only those modules gave `paths.ts` 87%, `embeddings.ts` 90%, `atomic-write.ts` 91%, `org-sync.ts` 88%, `index-cache.ts` 77% (CI's run over all 19 modules gives the official figure) |
| Strongest modules | `ebbinghaus.ts`, `journal.ts`, `rrf.ts`, `errors.ts` 100% |

Mutation testing checks whether the tests would notice a bug: Stryker changes small things in the code (`>` becomes `<`, `true` becomes `false`), and a test suite that still passes is not strict enough. Coverage alone cannot show this: `embeddings.ts` is covered well but half its mutants survive, partly because the native and model-loading code is mocked in the tests.

The score drifts about ±1 point between runs with no source change (mutants that time out under varying CI load), so do not read the decimal as exact. The gate is 65%, about 16 points below today's score.

## Complexity

| | |
|---|---|
| Functions | 441; median complexity 2 |
| ≥ 5 | 94 (advisory gate for agent-written code) |
| ≥ 10 | 26, listed in `complexity-baseline.json` |
| > 15 | 12 |
| Highest | `storeMemory` 58 · `parseAdl` 52 · `indexFile` 29 · `buildModels` 22 · `parseYamlish` 21 · `rerankMemories` 20 |

The ratchet test fails when a function not on the baseline reaches 10, or when a listed function gets worse. A function that improves must leave the list, so the list only shrinks.

## Components: abstractness, instability, distance

A = abstract declarations (interfaces, type aliases) ÷ all top-level declarations. I = Ce ÷ (Ce + Ca), counted between components. D = |A + I − 1|. ML = 100 × (1 − ΣCa ÷ k(k − 1)).

| Component | Files | A | Ce | Ca | I | D |
|---|---:|---:|---:|---:|---:|---:|
| helpers | 11 | 0.17 | 0 | 6 | 0.00 | 0.83 |
| paths | 1 | 0.04 | 0 | 8 | 0.00 | 0.96 |
| state | 1 | 0.00 | 1 | 7 | 0.13 | 0.88 |
| walk | 1 | 0.00 | 1 | 2 | 0.33 | 0.67 |
| vectors | 2 | 0.02 | 2 | 3 | 0.40 | 0.58 |
| search | 3 | 0.00 | 2 | 2 | 0.50 | 0.50 |
| registry | 1 | 0.50 | 2 | 2 | 0.50 | 0.00 |
| persistence | 4 | 0.00 | 7 | 3 | 0.70 | 0.30 |
| tools | 7 | 0.00 | 8 | 1 | 0.89 | 0.11 |
| spec | 6 | 0.18 | 3 | 1 | 0.75 | 0.07 |
| indexcache | 2 | 0.20 | 3 | 1 | 0.75 | 0.05 |
| server | 4 | 0.08 | 7 | 0 | 1.00 | 0.08 |
| **Mean** | 43 | | | 36 | | **0.42** |

`helpers`, `paths`, `state` and `walk` sit in the Zone of Pain (concrete and heavily depended on), but they are small, stable leaves with no outgoing dependencies; the zone only hurts when such code also changes often. A undercounts abstraction in functional TypeScript, where function types count as concrete. The components worth watching are `persistence` and `search`: no abstractions, real fan-in, and the highest average complexity. There are no dependency cycles (`[TR-S7]`).

1.7.0 added `org-sync.ts` to `server` and a listener hook in `registry` that `server` sets: the server's outgoing edges rise from 5 to 7 and `registry` gains an incoming edge. The two new edges lower ML from 74.2% (v1.6.8) to 72.7%; the mean distance drops from 0.44 to 0.42 because `registry` now sits on the main sequence.

The earlier figure of 68.9% for ML was computed over 10 components; 1.6.7 added `walk` and `indexcache`, so the two values are not directly comparable.

## Quantum coupling (NDQMS)

| Quantum | Before 1.6.7 | 1.6.7 (estimate) |
|---|---:|---:|
| `srv` — MCP server | 0.64 | **0.46** |
| `hooks` — lifecycle hooks | 0.10 | 0.24 |
| `remote` — org git repo | 1.00 | 1.00 |

1.6.7 made the SessionStart index cache private to the hooks and replaced its bash parser with the server's own TypeScript walk and parser. The coupling between hooks and server now runs through a shared library instead of a shared file, which lowers the server's figure. The hooks' figure rises because the hooks now depend less on the server, which the formula reads as more stable. **These are estimates:** four of the seven traffic inputs are assumed, not measured. The remaining step to reach ≤ 0.30 is a version field that readers check on the files hooks and server still share (`index.json`, the org working tree). `remote` at 1.00 is inherent to a shared git repo. Not re-estimated for 1.7.0: with `orgSync: "server"` (opt-in, off by default) the server starts the hooks' sync script, a new server → hooks edge.

## Delivery (DORA)

Counted over the 28 tags from v1.1.18 (2026-08-20) to v1.7.1 (2026-11-06). Before v1.1.18 versions were bumped on almost every commit and not tagged, so that period is left out.

| | |
|---|---|
| Deployment frequency | 11.0 tags per month; 24 in the last 30 days |
| Lead time (commit → tag) | median 0.26 h, p90 15.2 h (v1.6.8; not recomputed, see below) |
| Time to restore (failed release → fix release) | median 8.1 h (v1.6.8; not recomputed) |
| Rollbacks | 0 reverts |

Lead time and time to restore were not recomputed: the release timestamps GitHub returned gave inconsistent results here (a median near 0 h with one field, a p90 above 1,600 h with another), so the v1.6.8 method could not be reproduced from the API. They need the tag timestamps from git.

## Scale

| | 114 memories (real vault, 1.7.1) | 1,000 (v1.6.8) | 5,000 (v1.6.8) |
|---|---:|---:|---:|
| Index injected at SessionStart | ~4.3k tokens | ~32k tokens | ~162k tokens |
| SessionStart index build | 0.05 s (v1.6.8) | — | 0.14 s (the old bash builder: 14.3 s) |

The injected index costs 30–40 tokens per memory (about 32 with short titles, about 40 on a real vault), plus a fixed header of roughly 250 tokens, and, since 1.8.0, lists at most `indexMaxEntries` memories (default 300, about 10k tokens; `0` removes the cap), keeping no-prune, then the most important, then the most recent. The 1,000 and 5,000 columns above are v1.6.8 figures for an uncapped index. Beyond the cap, prune with `prune_memories`, or set `orgInjection` to `titles` or `off` to shrink the org part.

## Reproduce

From `plugins/total-recall/`: `npm test` · `npm run test:coverage` · `npm run test:integration` · `npm run mutation`; from the repository root, `npm test` runs the launcher's tests. The complexity counter is `src/__tests__/architecture/complexity.ts`; the component map is `src/__tests__/architecture/components.ts`. Abstractness counts interfaces, type aliases and abstract classes as abstract, and functions, classes, enums and top-level `const`/`let` declarations as concrete; coupling counts distinct component-to-component edges, type-only imports included. Run on v1.6.8 this method gives the same figures as the original measurement, except A for `paths` and `indexcache`, which differ by 0.01–0.02.

The start time and the index-build time were not re-measured for 1.7.1 because the measuring machine was under heavy load (a local LLM server on 10 cores): on it, the 1.6.8 bundle itself started in 494 ms median, so a new figure would measure the machine, not the code.
