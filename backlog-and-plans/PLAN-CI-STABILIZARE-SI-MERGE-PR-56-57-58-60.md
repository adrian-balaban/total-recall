# Plan: stabilize CI on `main` and merge PRs #56, #57, #58, #60

Date: 2026-11-12. State verified with `gh` on commit `9c7a912` of `main`.

## 1. PR status

| PR | What it contains | `mutation` check | Merge state | Notes |
|----|------------------|------------------|-------------|-------|
| #56 `chore/npm-audit-fix` | `package-lock.json` only: `@hono/node-server` 2.1.7, `qs`, `@vitest/mocker` (npm audit fix) | ❌ fail (integration) | BLOCKED | Already includes the bump from #58. |
| #57 dependabot `vitest` 4.1.8 → 4.1.11 | `package.json` and lockfile | ❌ fail (integration) | BLOCKED | An earlier run of the same branch passed (`43031786621`), so the failure is intermittent. |
| #58 dependabot `@hono/node-server` 2.0.12 → 2.1.7 | lockfile | ✅ pass | CLEAN | Redundant with #56. |
| #60 `chore/transformers-4` | after #59 was merged, only **the version bump to 1.9.1** is left (5 files, ±6 lines) | ❌ fail (integration) | BLOCKED | `@huggingface/transformers ^4.3.2` is already on `main` via #59. The PR title no longer matches its content. |

All four touch `plugins/total-recall/package-lock.json`, so after each merge the others must be updated (rebase or update branch).

## 2. What is red in Actions

### 2.1 `mutation` (the gate): the same intermittent failure everywhere
The `npm run test:integration` step fails on #56, #57 and #60, and on `main` it failed at the #55 merge (`42914601966`, commit `025aaa1`). All unit tests pass (1093/1093). Only two integration tests fail, both with `Test timed out in 30000ms`:

- `server.integration.test.ts` › "stores a memory and recalls it back"
- `boundary-enforcement.integration.test.ts` › "recall_memory does NOT reject a negative numeric limit"

**Cause.** `recall_memory` defaults to `hybrid = true` (`src/tools/recall.ts:22`), so the first call loads the embedding model `Xenova/paraphrase-multilingual-MiniLM-L12-v2`. The integration tests start the server with a fresh `HOME` in `os.tmpdir()`, and the model cache is `$HOME/.total-recall/models`. As a result the model (hundreds of MB) is downloaded from Hugging Face on every run. The test passes or fails depending on download speed: #58 and `main` @ `9c7a912` passed, while #56, #57 and #60 failed.

Other things checked:
- The `model id rejected by hub: 404` warning in the log comes from unit tests that intentionally use a wrong id, not from the integration tests. The real model answers 200 on `config.json`, `onnx/model_quantized.onnx` and the API.
- `testTimeout: 120_000`, the uncommitted change in `vitest.integration.config.ts`, is **not enough**. The MCP SDK client has its own 60s per-request timeout, and the download still depends on the network.

### 2.2 `Dependabot Updates` on `main`: red runs
These are *security update* jobs for `qs`, `minimatch` and `@vitest/mocker`. The jobs for `vitest`, `sharp` and `@hono/node-server` succeeded in the same period.

**Correction (2026-11-12).** The first hypothesis, the `Failed to parse GITHUB_REGISTRIES_PROXY` error, was wrong: the variable is empty and shows up as noise in every job log. The real cause, read from the jobs' error table, is `security_update_not_possible`: the fix exists, but a parent package does not allow it in.

| Package | Fixed version | Blocked by | Newest resolvable |
|---------|---------------|------------|-------------------|
| `minimatch` | 11.0.1 | `@stryker-mutator/core@9.6.1` requires `minimatch@~10.2.4` | 10.2.6 |
| `@vitest/mocker` | 4.1.12 | arrives with a newer `vitest` (`main` has 4.1.8, #57 has 4.1.11) | 4.1.8 |

`qs` was resolved by #56. The remaining alerts are dev-only and medium severity: minimatch #12, @vitest/mocker #9 and #5, vitest #6.

### 2.3 `release`
The latest run is green (`43034928200`). The `skipped` runs of 10–11 Nov are the normal effect of a red gate.

## 3. Solutions

### 3.1 Stabilizing `main` (new PR, merged first)
**Recommended fix:** the integration tests no longer depend on the network or the model.

1. In the two integration tests, `recall_memory` gets `hybrid: false`:
   - `server.integration.test.ts`: `arguments: { query: 'round-tripped stdio', hybrid: false }`
   - `boundary-enforcement.integration.test.ts`: `arguments: { query: 'x', limit: -5, hybrid: false }`

   What the tests verify (stdio round trip, the Zod limit) has nothing to do with vectors. The hybrid path and the TF-IDF fallback are already covered by unit tests with `testEmbedder`.
2. Revert the uncommitted local change in `plugins/total-recall/vitest.integration.config.ts` with `git checkout -- plugins/total-recall/vitest.integration.config.ts`.
3. Optional, in the same PR: `grep -rn "recall_memory\|rerank_memories" src/__tests__/integration/` and apply `hybrid: false` wherever another call would load the model. `rerank_memories` always loads the model and has no opt-out.
4. The version does not change (tests only, `dist/` identical). The bump comes through #60.

**Alternatives, to consider later:**
- An env var (e.g. `TOTAL_RECALL_VECTORS=off`) read in `embeddings.ts` and set in the server `env` in the tests. More general, but it changes production code and goes through the ADL and complexity ratchets (`[TR-Q9]`, `[TR-S12]`).
- A separate vector smoke test with a model cache in CI (`actions/cache` on `~/.total-recall/models`, keyed on the model id, with the test's `HOME` or `cacheDir` pointing at it), a long timeout and a single instance. This keeps end-to-end coverage of the vector path without flakiness.

**Verification:** run the gate 2–3 times on the fix PR (re-run). Integration must pass every time, in a few seconds, not ~30s.

### 3.2 Merge order after the fix
1. **The fix PR** (3.1) → merge when green.
2. **#56** (npm audit fix): update the branch (`gh api -X PUT repos/adrian-balaban/total-recall/pulls/56/update-branch`; this `gh` version has no `gh pr update-branch`), then green CI, then merge. Resolves `qs`, `@vitest/mocker` and `@hono/node-server` 2.1.7.
3. **#58**: redundant after #56. Dependabot closes it itself when it sees the version on `main`. Otherwise `gh pr close 58 -c "Included in #56"`.
4. **#57** (vitest 4.1.11): comment `@dependabot rebase`, wait for green CI, then merge. If the lockfile conflicts with #56, Dependabot regenerates it on rebase.
5. **#60**, last, as the release vehicle:
   - Update the branch (or rebase), and a local `npm run build` confirms the manifests are synced at 1.9.1.
   - Rename it, e.g. `chore: release 1.9.1 (transformers v4, sharp, audit fixes)`, and update the description: transformers and sharp came in through #59, and #60 only raises the version.
   - Merge, then check `release.yml`: tag `v1.9.1`, the `release` branch and the npx publish.

Useful commands:
```bash
gh pr checks <n> --watch
gh run rerun <run-id> --failed
gh pr merge <n> --squash --delete-branch   # or --merge, following the repo convention (#55 was a merge commit)
```

### 3.3 Dependabot (PR #62)
The solution: a new `.github/dependabot.yml` (it did not exist), with:
- `ignore` for `minimatch` and `@vitest/mocker`, each with a comment saying what blocks it and when to remove it;
- `open-pull-requests-limit: 0` on the npm ecosystem in `/plugins/total-recall`: it keeps *version updates* off (otherwise Dependabot would have started daily PRs for everything), while security updates for the other packages work as before.

Notes:
- Ignoring `@vitest/mocker` means no direct PR for it; the 4.1.12 fix still arrives through `vitest`, which is not ignored.
- **Uncertain:** the GitHub documentation does not clearly say whether `ignore` in the file also stops *security update* jobs, not just version-update ones. If the jobs stay red after #62 is merged, the safe fix is to dismiss the alerts as "tolerable risk": `gh api -X PATCH repos/adrian-balaban/total-recall/dependabot/alerts/<n> -f state=dismissed -f dismissed_reason=tolerable_risk` for #12, #9, #5 and #6. The risk decision belongs to the repo owner.
- **When to remove the ignores:** `minimatch` when Stryker accepts minimatch 11; `@vitest/mocker` when there is a vitest with mocker >= 4.1.12.
- Optional, separately: `groups` in the same file (one daily PR instead of one per package) would reduce lockfile conflicts, but it requires enabling version updates.

## 4. Checklist

- [x] Revert `vitest.integration.config.ts` (uncommitted local change)
- [x] Branch `fix/integration-no-model-download`: `hybrid: false` in the 2 tests, PR #61, green CI twice, merged
- [x] #56: update branch, green CI, merged
- [x] #58: closed as included in #56
- [ ] #57: `@dependabot rebase` done, waiting for green CI, merge
- [ ] #60: update branch, new title and description, green CI, merge, verify release 1.9.1
- [ ] #62: `.github/dependabot.yml` ignoring `minimatch` and `@vitest/mocker`, green CI, merge
- [ ] After #62: the Dependabot jobs are no longer red; otherwise dismiss alerts #12, #9, #5, #6 as "tolerable risk"
- [ ] (optional) vector smoke test with a model cache in CI
- [ ] (optional) `.github/dependabot.yml` with grouping
