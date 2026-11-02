# 📏 Quality metrics

Measured on **v1.6.7** (commit `d0ace52`, 2026-11-02). Test, coverage and mutation figures come from the CI run on `main`; the rest were computed from the source and the git history with the formulas from Neal Ford's masterclass *How to Teach Your Agents About Architecture* (Codecamp Iași, October 2026). "House" marks a target that is ours, not the course's.

[← README](../README.md)

## Summary

| Metric | Value | Gate | |
|---|---|---|---|
| Unit / integration tests | 1,006 / 24, all passing | — | ✅ |
| Coverage (statements · branches · functions · lines) | 97.1% · 90.9% · 95.1% · 98.3% | 95 · 90 · 95 · 95 | ✅ |
| Mutation score (Stryker, 18 modules) | **80.4%** | ≥ 65% `[TR-Q6]` | ✅ |
| Average cyclomatic complexity (430 functions) | 3.44 | < 4 | ✅ |
| Functions with complexity ≥ 10 | 26 (max 58, `storeMemory`) | 0; frozen by a ratchet `[TR-Q9]` | ⚠️ |
| Mean distance from the main sequence | 0.44 | < 0.6 | ✅ |
| Maintainability Level (12 components) | 74.2% | > 60% | ✅ |
| Longest identical run between two files | 6 lines | ≤ 10 `[TR-Q10]` | ✅ |
| Largest file | 471 lines | ≤ 600 `[TR-Q1]` | ✅ |
| Quantum coupling, MCP server (NDQMS, estimated) | 0.46 (was 0.64) | ≤ 0.30 *(house)* | ⚠️ |
| Deployment frequency | 9.9 releases / month | > 1 / week *(house)* | ✅ |
| Change failure rate | 30.4% (17.4% user-facing) | < 15% *(house)* | ❌ |
| MCP server start time | 99 ms median | < 500 ms *(house)* | ✅ |

## Tests and mutation

| | |
|---|---|
| Test files | 74, with 2,363 assertions (2.35 per test, house target ≥ 1.5) |
| Assertion-free tests, tautologies | 0, 0 (`[TR-Q4]`, `[TR-Q5]`) |
| Mutants | 1,567 killed, 1 timeout, 314 survived, 68 without coverage |
| Weakest modules | `paths.ts` 31.8%, `embeddings.ts` 51.2%, `atomic-write.ts` 60.9% |
| Strongest modules | `ebbinghaus.ts`, `journal.ts`, `rrf.ts`, `errors.ts` 100% |

Mutation testing checks whether the tests would notice a bug: Stryker changes small things in the code (`>` becomes `<`, `true` becomes `false`), and a test suite that still passes is not strict enough. Coverage alone cannot show this: `embeddings.ts` is covered well but half its mutants survive, partly because the native and model-loading code is mocked in the tests.

The score drifts about ±1 point between runs with no source change (mutants that time out under varying CI load), so do not read the decimal as exact. The gate is 65%, about 15 points below today's score.

## Complexity

| | |
|---|---|
| Functions | 430; median complexity 2 |
| ≥ 5 | 91 (advisory gate for agent-written code) |
| ≥ 10 | 26, listed in `complexity-baseline.json` |
| > 15 | 12 |
| Highest | `storeMemory` 58 · `parseAdl` 52 · `indexFile` 29 · `buildModels` 22 · `parseYamlish` 21 · `rerankMemories` 21 |

The ratchet test fails when a function not on the baseline reaches 10, or when a listed function gets worse. A function that improves must leave the list, so the list only shrinks.

## Components: abstractness, instability, distance

A = abstract declarations (interfaces, type aliases) ÷ all top-level declarations. I = Ce ÷ (Ce + Ca), counted between components. D = |A + I − 1|. ML = 100 × (1 − ΣCa ÷ k(k − 1)).

| Component | Files | A | Ce | Ca | I | D |
|---|---:|---:|---:|---:|---:|---:|
| helpers | 11 | 0.17 | 0 | 6 | 0.00 | 0.83 |
| paths | 1 | 0.05 | 0 | 8 | 0.00 | 0.95 |
| state | 1 | 0.00 | 1 | 6 | 0.14 | 0.86 |
| walk | 1 | 0.00 | 1 | 2 | 0.33 | 0.67 |
| vectors | 2 | 0.02 | 2 | 3 | 0.40 | 0.58 |
| search | 3 | 0.00 | 2 | 2 | 0.50 | 0.50 |
| registry | 1 | 0.67 | 2 | 1 | 0.67 | 0.33 |
| persistence | 4 | 0.00 | 7 | 3 | 0.70 | 0.30 |
| tools | 7 | 0.00 | 8 | 1 | 0.89 | 0.11 |
| spec | 6 | 0.18 | 3 | 1 | 0.75 | 0.07 |
| indexcache | 2 | 0.22 | 3 | 1 | 0.75 | 0.03 |
| server | 3 | 0.00 | 5 | 0 | 1.00 | 0.00 |
| **Mean** | 42 | | | 34 | | **0.44** |

`helpers`, `paths`, `state` and `walk` sit in the Zone of Pain (concrete and heavily depended on), but they are small, stable leaves with no outgoing dependencies; the zone only hurts when such code also changes often. A undercounts abstraction in functional TypeScript, where function types count as concrete. The components worth watching are `persistence` and `search`: no abstractions, real fan-in, and the highest average complexity. There are no dependency cycles (`[TR-S7]`).

The earlier figure of 68.9% for ML was computed over 10 components; 1.6.7 added `walk` and `indexcache`, so the two values are not directly comparable.

## Quantum coupling (NDQMS)

| Quantum | Before 1.6.7 | 1.6.7 (estimate) |
|---|---:|---:|
| `srv` — MCP server | 0.64 | **0.46** |
| `hooks` — lifecycle hooks | 0.10 | 0.24 |
| `remote` — org git repo | 1.00 | 1.00 |

1.6.7 made the SessionStart index cache private to the hooks and replaced its bash parser with the server's own TypeScript walk and parser. The coupling between hooks and server now runs through a shared library instead of a shared file, which lowers the server's figure. The hooks' figure rises because the hooks now depend less on the server, which the formula reads as more stable. **These are estimates:** four of the seven traffic inputs are assumed, not measured. The remaining step to reach ≤ 0.30 is a version field that readers check on the files hooks and server still share (`index.json`, the org working tree). `remote` at 1.00 is inherent to a shared git repo.

## Delivery (DORA)

Counted over the 24 tags from v1.1.18 (2026-08-20) to v1.6.7 (2026-11-02). Before v1.1.18 versions were bumped on almost every commit and not tagged, so that period is left out.

| | |
|---|---|
| Deployment frequency | 9.9 tags per month; 20 in the last 30 days |
| Lead time (commit → tag) | median 0.26 h, p90 15.2 h |
| Change failure rate | 7 of 23 releases needed a production `fix:` in the next patch release = **30.4%** |
| User-facing failures | 4 of 23 = 17.4%: v1.3.1 (`.mcp.json` emptied), v1.3.3 (vector upsert), v1.6.0 (org branch default), v1.6.2 (`install.sh` emptied `.mcp.json`) |
| Time to restore (failed release → fix release) | median 8.1 h |
| Rollbacks | 0 reverts |

## Scale

| | 105 memories (real vault) | 1,000 | 5,000 |
|---|---:|---:|---:|
| Index injected at SessionStart | ~4.4k tokens | ~32k tokens | ~162k tokens |
| SessionStart index build | 0.05 s | — | 0.14 s (the old bash builder: 14.3 s) |

The injected index costs 30–40 tokens per memory (about 32 with short titles, about 40 on a real vault), plus a fixed header of roughly 250 tokens, and has **no size cap** today. Beyond a few hundred memories, prune with `prune_memories`, or set `orgInjection` to `titles` or `off` to shrink the org part.

## Reproduce

From `plugins/total-recall/`: `npm test` · `npm run test:coverage` · `npm run test:integration` · `npm run mutation`. The complexity counter is `src/__tests__/architecture/complexity.ts`; the component map is `src/__tests__/architecture/components.ts`.
