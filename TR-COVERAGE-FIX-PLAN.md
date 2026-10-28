# 📋 Plan — make `npm run test:coverage` pass

## 🎯 Goal

Meet all four thresholds in `plugins/total-recall/vitest.config.ts` (statements 95,
functions 95, branches 90, lines 95) **without lowering them and without `v8 ignore`
comments**, then keep them met in CI.

## 🔍 Diagnosis (measured 2026-10-28, branch `fix/tr-s7-break-state-persistence-cycle`, 1.3.1)

| Metric | Covered / total | % | Gate | **Missing** |
|---|---|---|---|---|
| Statements | 2267 / 2421 | 93.63 | 95 | **33** |
| Functions | 372 / 403 | 92.30 | 95 | **11** |
| Branches | 1533 / 1748 | 87.70 | 90 | **41** |
| Lines | 1905 / 1988 | 95.82 | 95 | ✅ |

The gaps are concentrated in a few files (uncovered statements / branches / functions):

| File | Stmts | Branches | Funcs | What is uncovered |
|---|---|---|---|---|
| `vectorStore.ts` | 47 | 43 | 6 | the native self-heal (`pluginRootForRebuild`, `resolveNpmCli`, `rebuildNativeBindings`, lines 43-99), plus `getVecMeta` and `dropVectorTable`, which no test calls |
| `persistence.ts` | 23 | 12 | 1 | `recordError` paths inside the debounce timers (386, 400), the `flushPending` catch (471), corrupt index shape (92), path escape (224) |
| `spec/indexer.ts` | 19 | 18 | 4 | error paths: unreadable dir (38), `MAX_FILES` truncation (41), oversize file (57), unreadable `.adl` (82); `DEFINE` lines (93, 161) |
| `embeddings.ts` | 12 | 15 | 1 | model-load fallback paths (267-310) |
| `spec/context.ts` | 10 | 16 | **8** | the `definitions` map/filter callbacks (99, 129), `trace('')` throwing (145), fitness-result and history sorting (166-178) |
| `tools/architecture.ts` | 8 | 13 | 2 | |
| `tools/mutate.ts` | 4 | 16 | 1 | |

Facts that shape the plan:
- The optional native deps (`better-sqlite3`, `sqlite-vec`) are installed locally **and** in CI
  (`mutation.yml` installs them for Stryker), so `vectorStore` can be tested for real against
  a tmp DB.
- The self-heal is reached only through the `__rebuildImpl` seam, which is a no-op under
  `NODE_ENV=test`. The real `rebuildNativeBindings` never runs in tests, which is correct.
  It must **never** run for real, because it spawns `npm rebuild better-sqlite3` in
  `node_modules` with a 180 s timeout.
- Most of the 8 uncovered functions in `spec/context.ts` are callbacks over
  `model.definitions`. No fixture contains an ADL `DEFINE` line that targets an element.

## 🛠️ Steps

Ordered by yield. After each phase, run `npm run test:coverage` and record the numbers.
**Phases 1 and 2 are expected to be enough. Phase 3 is the reserve.**

### Phase 1 — `vectorStore.ts` (≈ +40 stmts, +6 funcs, +25 branches)

1. **`getVecMeta` / `dropVectorTable`**, real DB in a tmp dir (new
   `vectorStore-meta.test.ts`):
   - a fresh DB → `getVecMeta` returns `null` (no `vec_meta` table)
   - after an upsert → `{ model, dim }`; a missing `dim` row → `dim: null`
   - `dropVectorTable` → `getVecMeta` is `null` again, and a later upsert recreates both tables
   - a DROP failure (a closed or read-only DB handle) → `recordError` is called and nothing is thrown
2. **Self-heal internals** (new `vectorStore-rebuild.test.ts`). Test the real
   `rebuildNativeBindings` with `node:child_process` and `node:fs`'s `existsSync` mocked
   at the module boundary (`vi.mock`), so nothing is ever spawned:
   - `better-sqlite3` is absent under the root → `{ attempted: false }`
   - the npm CLI is found → `spawnSync(process.execPath, [npm-cli.js, 'rebuild', …])`
   - the npm CLI is not found → the `spawnSync('npm', …, { shell: true })` fallback
   - exit 0 → `ok: true`; a non-zero exit → `detail` with the stderr tail; `result.error` set → the error message; `spawnSync` throws → `threw: …`
   - Reaching it needs one seam: export the real function as
     `__testRebuildNativeBindings`, following `__testsSetEmbedder` in `embeddings.ts`.
     This adds no behaviour. `[TR-R4]` stays true, because test files are outside its subject set.
   - Assert the arguments and the results, so the same tests also kill mutants
     (`vectorStore.ts` mutation is 54.0%).

### Phase 2 — `spec/context.ts` + `spec/indexer.ts` (≈ +10 funcs, +25 branches, +20 stmts)

3. **One richer ADL fixture** in `spec-architecture.test.ts`: two `.adl` files, `DEFINE`
   lines that target elements, and a `fitness-result` memory plus history memories with
   different `created` timestamps. Then:
   - `get_architecture_context(element)` returns the element's `definitions`
   - `trace('TR-S2')` returns the linked results, sorted by `created`
   - `trace('')` throws the "trace needs an id" message
4. **Indexer error paths:** an unreadable subdirectory (`chmod 000`, skipped when running
   as root), more than `MAX_FILES` files → `truncated: true`, an `.adl` larger than
   `MAX_FILE_BYTES` and an unreadable `.adl` → a file entry with `error`, and assertion IDs
   with no tagged test.

### Phase 3 — reserve, only if a threshold is still short

5. `persistence.ts` timer error paths: make `atomicWrite` / `rebuildInvertedIndex` throw
   once (a `vi.mock` spy) → `recordError('scheduleSave: …')`, `'scheduleIdfRecalc: …'`,
   `'flushPending saveNow: …'`. This also attacks the 122 surviving mutants.
6. `tools/mutate.ts` (16 branches) and `tools/architecture.ts` (13 branches): validation
   and not-found arms.

### Phase 4 — lock it in

7. **CI.** Change `mutation.yml` to run `npm run test:coverage` instead of the plain unit
   run, so a coverage regression fails the build. It runs the same tests, plus v8
   instrumentation.
8. **Docs.** In `README.md`, `README-ro.md` and `plugins/total-recall/README.md`:
   - delete the "Coverage misses three of four thresholds" known-issue bullet
   - update the Coverage row and the test count
   - update the per-module mutation figures if they moved, after a full `npx stryker run`

## ❌ Rejected alternatives

- **Lowering the thresholds** fixes the number, not the gap. The thresholds were set
  deliberately, and the READMEs already describe the shortfall honestly.
- **`/* v8 ignore */` on the rebuild code.** It is real production code that runs on a
  user's machine after a Node upgrade. It is exactly the code that should be tested.
- **Excluding `vectorStore.ts` from coverage.** Same reason. It is also among the weakest
  mutation modules.

## 🧪 Verify

From `plugins/total-recall/`:

```bash
npm run typecheck && npm run build
npm run test:coverage        # must exit 0
npm run test:integration
npx stryker run              # gate still ≥ 65%; vectorStore/persistence scores should rise
git status node_modules      # rebuild tests must not have touched node_modules
```

## ⚠️ Risks

| Risk | Mitigation |
|---|---|
| A rebuild test really spawns `npm rebuild` and rewrites `node_modules` | `vi.mock('node:child_process')` is hoisted above the import. Assert that the mock was called. Never touch `__rebuildImpl`'s default |
| The `getDb` cache is keyed by path and leaks between tests | A unique tmp DB path per test, removed in `afterEach` |
| The `chmod 000` test behaves differently as root (CI containers) | `it.skipIf(process.getuid?.() === 0)` |
| Coverage drifts below 95 again after future features | Phase 4, step 7: CI fails on it |

## 📦 Scope

About 5 new or extended test files and one test seam in `vectorStore.ts`. There is no
production behaviour change, and the work fits in one PR. It can be released as 1.3.2,
or bundled into the next release.
