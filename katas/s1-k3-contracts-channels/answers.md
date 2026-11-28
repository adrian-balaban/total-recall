# K3 — Install channels and strict/permissive contracts (course pp. 30–31)

Sketch: [adl/contracts-kata.adl](adl/contracts-kata.adl) · Fitness functions: [k3-contracts.test.ts](../../plugins/total-recall/src/__tests__/katas/k3-contracts.test.ts) · Sketch IDs `[K3-01]`, `[K3-02]` (not `TR-*`; promotion is decided at K12).

**Scenario recap.** A new question type must reach two clients with different release speeds: a web UI the team deploys any time and a tablet app that ships through an app store, with old versions staying in the field. Feature toggle or branch? Which contracts are strict, which permissive? How many versions may the endpoint support? What recipe did the agent's rewritten tests find? (Course model: `masterclassNealFord2026/make-the-grade-pages-30-31/answers.md`, outside this repo.)

**Mapping.** The tablet app is the old `npx` bootstrap and any teammate on an older plugin version. The web UI is the plugin running from the `release` branch, which one workflow rebuilds on every green gate.

## Questions → answers → evidence

| Course question | Answer for total-recall | Evidence |
|---|---|---|
| Task 1: feature branch or toggle? | Short-lived branches and a green gate on every PR already stand in for the toggle: `release.yml` runs only after a green `mutation`, so `main` is always releasable. The one runtime toggle is `specDriven` in `config.json`, read once at start. No change needed. | `release.yml`, `TR-Q8` |
| Task 2: strict or permissive per contract | Tool calls: STRICT (one release controls both ends; Zod at the boundary). Hook envelope: permissive (the host adds fields). Memory file: permissive (teammates on other versions write it). **Org `index.json`: the missing one.** It has a version guard in code, which reads the legacy flat shape and refuses to overwrite a newer one, but no contract in `contracts.adl`. | `contracts.adl`, `[K3-01]`, `scripts/sync-org-memory.mjs` |
| Task 3: how many versions may be supported? | Two shapes of the org index: the current wrapped one and the legacy flat one (`unwrapOrgIndex` accepts both and refuses a higher `v`). Channel version skew is held by `TR-Q3`. The data sources for contract churn are the git history of the contract files and the npm download counts per bootstrap version. | `unwrapOrgIndex`, `TR-Q3` |
| Task 4: the agent that weakened tests | Already guarded: `[TR-Q4]` (every test has an assertion), `[TR-Q5]` (no tautology), `[TR-Q6]` (break threshold), and the kata tests are walked by the same two rules. | `TR-Q4`, `TR-Q5` |
| The three install channels | npx bootstrap, marketplace on the `release` branch, `--local` clone. The bootstrap is the long-lived edge: old versions stay on npm and in npx caches, and they call the marketplace by name. | `[K3-02]` |

## What the sketch adds

- **`[K3-01]`** derives the list of cross-version boundaries from the code (evidence in a file) and checks each has a `DEFINE CONTRACT`. On the real tree it finds exactly one gap: `org-index`. The test pins that finding, so it flips when the contract is added.
- **`[K3-02]`** makes the marketplace name, the plugin name and the `release` ref append-only. Renaming any of them strands every old bootstrap, the same way removing an endpoint strands an old tablet app. Nothing checked this: `cli.test.mjs` fakes the file system, and `plugin-manifest.test.ts` checks versions only.

## Known-pass / known-fail (plan §3.3)

| Check | Known-pass | Known-fail (synthetic, `os.tmpdir()`) |
|---|---|---|
| `[K3-01]` coverage | a tree declaring all four contracts → `[]` | one declaration dropped → exactly `org-index`; a boundary with no code evidence is not demanded |
| `[K3-01]` real tree | the three declared contracts are read from `contracts.adl` | the real gap is `['org-index']` (pinned finding) |
| `[K3-02]` names | matching names and ref → `[]`; the real bootstrap and marketplace agree | renamed marketplace → exact message; renamed plugin; ref moved off `release` |

8 tests, all green, so CI is never red on purpose.

## Dogfood log

- `index_architecture` on `katas/s1-k3-contracts-channels`, `validate_architecture` on the repo root with `record:false`, `trace`, and the decision stored with `store_memory` (`elements: ["assert:K3-01","assert:K3-02"]`).

## Dispositions

| Item | Disposition |
|---|---|
| `[K3-01]` real-tree gap (`org-index`) | **Revise ADL** at K12: declare `DEFINE CONTRACT org-index ... AS NAME-VALUE-PAIRS` plus a `TR-C10` assertion that the version guard refuses a newer file. Next free ID `TR-C10`. |
| `[K3-02]` | Promotion candidate at K12 (next free ID `TR-Q12` or `TR-C10`, whichever K12 allocates first). |
| Contract churn (course Task 3 `MAX_CONTRACT_CHANGES`) | Not built. It needs git history in a test, which `[TR-Q11]` already does for helpers as a warning. Decide at K12 whether the contract files get the same warning. |
| `hooks.json` vs `hooks.gemini.json` | Subsumed by `hooks-parity.test.ts` and `[TR-C5]`. |
