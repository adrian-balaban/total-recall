# K11 — The human + agent team (course pp. 47–50, 69–74)

Sketch: [adl/team-kata.adl](adl/team-kata.adl) · Fitness functions: [k11-team.test.ts](../../plugins/total-recall/src/__tests__/katas/k11-team.test.ts) · Sketch IDs `[K11-01]`..`[K11-03]` (not `TR-*`; promotion is decided at K12).

**Scenario recap.** Team topologies and governance for a group of humans and agents: who owns what, what an agent may and may not do, how decisions are recorded, and which checks cannot be made deterministic. (Course model: `masterclassNealFord2026/make-the-grade-pages-47-48`, `-49-50`, `-69-70`, `-71-72`, `-73-74`, outside this repo.)

**Mapping.** One stream-aligned maintainer owns the system end to end; agents are contributors with a bounded scope, never approvers (`GOVERNANCE.md` §2). The written instructions (`plugins/total-recall/CLAUDE.md`) and the owner register are what a new contributor acts on. The repo root has no `CLAUDE.md`.

## Questions → answers → evidence

| Course question | Answer for total-recall | Evidence |
|---|---|---|
| What team shape is this? | A stream-aligned team of one, with per-area owners recorded for a second maintainer (shutdown, org sync, contracts, benchmark). | `GOVERNANCE.md` §2 |
| What may an agent do? | Contribute and propose; never approve its own exemption, and never weaken a test to get green. The mechanical part is enforced: `[TR-Q2]` (allow-list), `[TR-Q4]` (every test asserts), `[TR-Q5]` (no tautology). | `GOVERNANCE.md` §2, `adl-repo-rules.test.ts` |
| How is a decision recorded? | Dispositions per failed assertion (fix, revise ADL, exempt with expiry); decisions go to memory with `elements: ["assert:…"]`; exemptions are `DEFERRED` entries in `BACKLOG.md`. | `GOVERNANCE.md` §3, `BACKLOG.md` |
| Is the written guidance reliable? | Its machine-checkable half is: every test file and `TR-*` ID it names exists (`[K11-01]`). The prose half (is the rule still right?) cannot be checked by a script. | `[K11-01]` |
| Does every rule have an owner? | Yes: all 9 production ADL files have a register row (`[K11-02]`). | `[K11-02]` |
| Does the history show who changed a rule and why? | Mostly: 16 of the 17 commits that touched the ADL also touched a test or a governance record. The exception is an early docs commit. | `[K11-03]` |

## What cannot be deterministic (stays an interactive review, checklist §9)

| Question | Why a script cannot answer it | Where it lives |
|---|---|---|
| Is the threshold still the right one? | A number is checkable; whether it is the right number is judgement. | `REVIEW.md` pass |
| Does `CLAUDE.md` say what the code does? | The pointers can be checked; the sentence cannot. | `REVIEW.md` pass |
| Was an exemption granted for a good reason? | The expiry can be checked; the reason cannot. | maintainer, at the REVIEW pass |
| Is a generated fitness function testing the right thing? | Known-pass and known-fail show it detects something; whether that is the intent is a review. | per-kata `answers.md` |

These are recorded as reviews by a human (or an LLM-assisted pass whose output a human accepts), never as proof.

## Known-pass / known-fail (plan §3.3)

| Check | Known-pass | Known-fail (synthetic, `os.tmpdir()`) |
|---|---|---|
| `[K11-01]` | existing IDs and files; a pending ID on a line that says so; real docs have nothing stale | a removed ID and a removed test file are named |
| `[K11-02]` | files and rows agree; the real 9 ADL files all have a row | a file with no row; a row for a removed file |
| `[K11-03]` | ADL change with a test, or with a governance record, in a temporary git repository | an ADL change with neither is named by its subject; the real history pins one early commit |

10 tests, all green. The real-history test is skipped in a shallow clone (the `katas` workflow checks out one commit), so it runs locally and the synthetic ones run everywhere.

## Dogfood log

- `index_architecture` on `plugins/total-recall/architecture/katas/s3-k11-team`, `validate_architecture` on the repo root with `record:false`, `trace`, and the decision stored with `store_memory` (`elements: ["assert:K11-01","assert:K11-02","assert:K11-03"]`).

## Dispositions

| Item | Disposition |
|---|---|
| `[K11-01]` | Promotion candidate at K12 (next free ID `TR-Q12`); cheap and it protects what every contributor reads first. |
| `[K11-02]` | Promotion candidate at K12 (next free ID `TR-Q12` or `TR-E2`). |
| `[K11-03]` | Keep as a sketch or reject at K12: it needs full history, which the CI checkout does not have. Making `katas.yml` fetch full history would change the workflow; not done here. |
| The early docs commit without a test | Historical; not rewritten. Pinned so a new one is visible. |
| Interactive reviews | Already the `REVIEW.md` practice; no change. |
