# K6 — Org-sync as a saga: failure modes (course pp. 44–45)

Sketch: [adl/saga-kata.adl](adl/saga-kata.adl) · Fitness functions: [k6-org-sync-saga.test.ts](../../plugins/total-recall/src/__tests__/katas/k6-org-sync-saga.test.ts) · Sketch IDs `[K6-01]`, `[K6-02]` (not `TR-*`; promotion is decided at K12).

**Scenario recap.** The Close Test saga needs a communication style, coordination and consistency chosen against the requirements; a teammate wants atomic consistency with choreography; the saga ADL and a contract ADL are written; agents regenerate the service, so guardrails must pass first. (Course model: `masterclassNealFord2026/make-the-grade-pages-44-45/answers.md`, outside this repo.)

**This kata is an audit, not a build.** `workflows.adl` already declares the Org Sync Saga (choreography, eventual) and `TR-W5`, `TR-W6`, `TR-W9`, `TR-W10` cover push failure, corrupt index and wipe, the drain, and the exactly-once reconciliation. The question is what the saga does at the failure sites those assertions do not name.

## Questions → answers → evidence

| Course question | Answer for total-recall | Evidence |
|---|---|---|
| Task 1: communication, coordination, consistency | Asynchronous (the hook backgrounds the script), choreography (server write, hook, script, git; no orchestrator), eventual (teammates see it on their next pull). Already declared. | `workflows.adl` saga block |
| Task 2: why is atomic consistency with choreography hard to govern? | It is the case that would need a distributed lock across a teammate's machine and a remote. The design avoids it: compensation is block, keep, record, never roll back across the network. | `TR-W5`, `TR-W6` |
| Task 3: saga ADL and a contract that leaves the protocol open | Saga ADL exists. The contract for the queue file and the org `index.json` is the gap K3 found (`org-index` has no `DEFINE CONTRACT`). | K3 `[K3-01]` |
| Task 4: guardrails before regeneration | The existing gate plus the two checks below: a regenerated `sync-org-memory.mjs` cannot add a failure path without a declared compensation, and cannot drop one without a test noticing. | `[K6-01]`, `[K6-02]` |

## Failure-mode matrix (from the script)

| Failure site (message) | Compensation | Test that exercises it |
|---|---|---|
| privacy filter blocked | block (nothing staged) | yes: "blocks (does not push)…" |
| refuses to rewrite a corrupt / forward-incompatible org index | block (file untouched) | yes: `TR-W6`, forward-incompatible test |
| working-tree wipe detected / ABORT | record (restore from HEAD, throw, logged) | yes: `sync-org-wipe-guard.test.ts` |
| delete refused (wrong author, no-prune, symlink, unreadable frontmatter) | block | yes for author and no-prune; **no test for unreadable frontmatter** |
| reserved key | block | yes |
| push failure | keep (`reset --soft`, job stays) | yes: `TR-W9`, `TR-W10` |
| usage error; `orgRepo` unset | block | **no** |
| key with a NUL byte; key escaping the vault | block | **no** |
| org file not found | skip | **no** |
| branch switch fails | skip (never pushes from the wrong branch) | **no** |
| note tagged both `org` and `personal` | block (rejected before staging) | **no** |

## What the sketch adds

- **`[K6-01]`** reads every `console.error(...)` and `new Error(...)` opening in the script (comments stripped) and requires each to be a row of the matrix with a compensation class. A new failure path fails the check until someone classifies it.
- **`[K6-02]`** requires each row to have a test that names it. On the real tree it finds **seven untested failure modes**, and pins them as the finding.

## Known-pass / known-fail (plan §3.3)

| Check | Known-pass | Known-fail |
|---|---|---|
| `[K6-01]` | sites read from a script are all declared; the real script has none undeclared and none stale | a new, unclassified message is named; a commented-out one is not a site; stale rows are reported |
| `[K6-02]` | a test text naming every mode leaves nothing untested | an empty test text leaves every mode untested; the real untested set is pinned |

7 tests, all green, so CI is never red on purpose.

## Dogfood log

- `index_architecture` on `katas/s2-k6-org-sync-saga`, `validate_architecture` on the repo root with `record:false`, `trace`, and the decision stored with `store_memory` (`elements: ["assert:K6-01","assert:K6-02"]`).

## Dispositions

| Item | Disposition |
|---|---|
| Seven untested failure modes | **Exemption with expiry:** a `DEFERRED` entry in `BACKLOG.md` (trigger: next change to `sync-org-memory.mjs`; expiry 2027-06-30). The pinned list in the test shrinks as tests land. |
| `[K6-01]` | Promotion candidate at K12 (next free ID `TR-W11`). |
| `[K6-02]` | Promotion at K12 only once the pinned list is empty; until then it stays a sketch. |
| Saga contract (Task 3) | Carried by K3's `org-index` finding. |
