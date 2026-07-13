---
name: review-fix-ship
description: Use when asked to "review and improve", "review ; fix ; commit", "harden and ship", or any iterative review-fix-ship loop on a git repository. Drives a closed loop until git status is clean — read the code, propose fixes with file:line citations, apply all of them, run the project's pre-commit checks, bump the version, commit, and push. Exits only when one full pass produces no changes.
---

# Review-Fix-Ship Loop

Iterative, opinionated hardening loop for a git repository. One full pass = one trip through all six steps; repeat the pass until the trip produces zero changes. **Stopping condition: a pass that ends with `git diff` empty.**

## When to use this skill

Trigger when the user asks for any of:

- "review and improve" / "review and fix" / "review; fix all"
- "harden the code" / "find bugs and fix them"
- "review-fix-ship loop" / "iterate until clean"
- Any phrasing that combines review + apply fixes + ship in one breath

## When NOT to use this skill

- The user only wants a review (no fixes) → do the review, do NOT enter the loop.
- The user wants fixes for a single, specific bug → fix it; do not loop the whole codebase.
- The user has not authorized shipping (commit/push) → stop after step 3.
- The repo has no version manifests (`package.json` + plugin manifest) → adapt step 4 or skip it; do not invent versions.

## The loop

Run steps 1–6 in order. After step 6, return to step 1 and re-run the full pass. **If `git diff --stat` is empty after a pass, stop — the loop has converged.**

### 1. Review

Read every file in the project the user pointed at. Read in this order:

1. Top-level `README.md` and `CLAUDE.md` (authoritative — they override everything).
2. Build/manifest files (`package.json`, `tsconfig`, `.claude-plugin/plugin.json`, `Cargo.toml`, etc.).
3. Source modules, smallest first.
4. Test files — they document intended behavior; mismatches are bugs.
5. Hook scripts, install scripts, ancillary shell/cjs files.
6. Already-applied fix commits (`git log --oneline -20`) — don't re-propose them.

As you read, build a working list of findings. For each, capture `file:line` and the exact issue. Distinguish:

- **Real bug** — provable incorrect behavior; fix now.
- **Hardening gap** — defensive code that should exist but doesn't; fix now.
- **Doc gap** — behavior is correct but undocumented; add a comment, do not change code.
- **False positive** — looked like a bug, verified correct (often with an existing comment explaining why); discard and move on.

### 2. Propose fixes and improvements

For each real bug / hardening gap / doc gap, write a one-line proposal with the `file:line` citation and the change. Group by file. Prefer small, surgical edits; resist drive-by refactors that aren't on the finding list.

If a finding is ambiguous (could be a bug, could be by design), do NOT guess — surface it to the user and ask before fixing. Default to "ask" for anything destructive or that changes public API shape.

### 3. Apply all

Apply the proposals from step 2 in this order:

1. Source files first (the actual fix).
2. Tests — add or extend coverage for the behavior you just changed. If existing tests assert behavior that contradicts your fix, update them (and note it in the commit message).
3. Run the project's pre-commit checks (see step 4a). All green before moving on.

Do NOT skip writing tests. A fix without a test is a regression waiting to happen.

### 4. Pre-commit checks + version bump

This step is project-specific. Adapt to whatever the repo declares in `CLAUDE.md`. For the total-recall plugin (the canonical example), the order is mandatory:

**4a. Verify green** — `npm test` + `npm run typecheck`. Both must pass clean. If they don't, fix and re-run; do NOT proceed.

**4b. Bump version in `package.json` only** — it is the single source of truth; do not edit `.claude-plugin/plugin.json`'s version by hand. The `npm run build` step (4c) runs `sync:version` (`scripts/sync-version.mjs`), which copies `package.json`'s version into `plugin.json` automatically, so the two can never drift. The version is what `claude plugin update` keys on; a fix committed at the same version is invisible to consumers.

- Patch (`x.y.Z → x.y.(Z+1)`) for fixes / hardening.
- Minor (`x.Y.z → x.(Y+1).0`) for new tools or features.
- Major (`X.y.z → (X+1).0.0`) is rarely appropriate here.

**4c. Rebuild dist** — for projects that ship pre-built artifacts (the total-recall `dist/` is committed because the plugin is distributed via `git-subdir`): run `npm run build`. The build first runs `sync:version` (copies `package.json` → `plugin.json`), then injects the version into the bundle via `--define:__PLUGIN_VERSION__`, so the bump in 4b MUST happen first. Verify the bundle contains the new version string before committing.

For non-total-recall repos: ask the user what the project's pre-commit ritual is (it may be a Makefile target, `./gradlew build`, `tox`, etc.). Never invent a checklist.

### 5. Git commit

```bash
git add -A
git commit -m "<type>(<scope>): <subject>

<body — 1–4 bullet points, one per finding>
<Co-Authored-By: ...>"
```

- Run from inside the repo's root directory (not the workspace root).
- Subject line ≤ 72 chars; imperative mood.
- Body groups by finding (file:line + what changed and why).
- Note discarded false positives by category ("Investigated and discarded: <reason>") so future-you knows they were considered.
- End with `Co-Authored-By: Claude <noreply@anthropic.com>`.

### 6. Push

```bash
git push origin <branch>
```

Default branch is `main` unless the repo says otherwise. If push is rejected (non-ff), pull and rebase — do NOT force-push unless explicitly authorized.

## Convergence check

After step 6, return to step 1. At the top of the next pass:

```bash
git status            # working tree clean?
git diff --stat HEAD~1  # what did the last commit change?
```

If `git status` is clean AND the changes in the last commit are all intentional, the loop has converged. **Stop.** Tell the user: "Converged after N passes. Final version: X.Y.Z, commit <sha>."

If the next pass surfaces a new finding, fix it, bump patch, commit, push — and loop again.

## Hard rules

- **Do not commit/push without explicit user authorization for THIS run.** A standing "always ship" instruction is sufficient, but a one-off "review only" is binding — respect it.
- **Do not bump the version if you didn't change source.** A docs-only change doesn't need a version bump; a config tweak doesn't either. Bump only when source/manifest changed.
- **Do not skip tests.** Every fix needs a test that would have caught the bug. If the project lacks a test for the affected module, add the test FIRST, watch it fail, then fix.
- **Do not batch unrelated refactors into a hardening commit.** If you spot a refactor opportunity, surface it to the user; don't bundle it.
- **Do not invent a pre-commit ritual.** If the repo doesn't document one, ask.
- **Do not skip the convergence check.** "I think we're done" is not a stop condition — `git diff --stat` empty is.

## Worked example: total-recall plugin

User: "review ; fix all" on `/home/adrianb/_/ai-assisted/github/total-recall/plugins/total-recall`.

Pass 1 (3 findings):

1. `src/vault-scan.ts:117-118` — `new Date()` called 3× per file, can produce `created > updated`. Capture scan-time `now` once.
2. `src/ebbinghaus.ts:11` — `computeRetentionStrength` has no input guards; hand-edited `importanceScore: -1` yields negative strength. Coerce + clamp.
3. `src/tools/query.ts:104` — `get_related_memories` accepts `includeContent` but never reads it. Implement LRU read-through.

→ Apply all → add 2 tests → bump `package.json` to 1.0.6 → `npm run build` (syncs `plugin.json` from `package.json`) → commit `fix(total-recall): harden 4 edge cases + bump to 1.0.6` → push.

Pass 2: re-read all 12 source modules + 9 hook scripts + 7 test files. No new findings. `git diff --stat` empty.

→ Converged. Report: "Converged after 2 passes. Version 1.0.6, commit `be6316e`."

## Why this loop works

- **It converges.** Each pass raises the bar; eventually the only remaining findings are subjective (style, architecture) that the user can decide on out-of-band.
- **It ships incrementally.** Each commit is a coherent, tested, versioned unit — no "WIP: hardening WIP" half-commits.
- **It is reversible.** Every fix has a test; rolling back is `git revert`, not archaeology.
- **It respects the user's standing instructions.** README/CLAUDE.md override the loop's defaults; if the repo says "do not push without asking", the loop stops at step 5.
