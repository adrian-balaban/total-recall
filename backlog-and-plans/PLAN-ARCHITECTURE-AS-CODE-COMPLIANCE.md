# Plan — Architecture as Code conformance for `total-recall`

**Status:** applied — WP-0…WP-4 + WP-6 landed 2026-11-21; WP-5/WP-7 deferred with expiry (BACKLOG); TR-P6/P7 tagging pending benchmark calibration  
**Date:** 2026-11-21  
**Target repository:** `/home/adrianb/_/in-progress/total-recall`  
**Baseline branch/commit:** `main` @ `69116efe84aec5171e18201effab4e34443f4206`  
**Checklist source:** `/home/adrianb/_/in-progress/cursuri/masterclassNealFord2026/ARCHITECTURE_AS_CODE_CHECKLIST.md`  
**Owner (default):** Adrian Balaban  
**Revised:** 2026-11-21 — second review pass incorporated (§1.4); execution plan §2–§7 completed.

## 0. Executive summary

`total-recall` already has a working Architecture-as-Code core:

- nine ADL files under `plugins/total-recall/architecture/adl/`, with metadata, `DEFINE` blocks and tagged `ASSERT(...)` statements;
- `adl-coverage.test.ts` enforcing that every tagged assertion has a test carrying the same ID, and that no test name carries an orphan ID;
- structural fitness functions in `fitness.test.ts` (ArchUnitTS) for the partition, layering, dependency direction, cycles, optional native dependencies, process ownership, code size and the complexity ratchet;
- mutation, coverage, integration and release workflows as the current release gate;
- threat/security documentation and C4 diagrams already aligned with the ADL.

The remaining work is therefore not “adopt ADL from scratch” or “add CI that does not exist” (both already exist). The main gaps are:

1. three load-bearing capabilities that are not yet covered by the ADL gate: the two scale/performance targets in `capabilities.adl` (deliberately untagged, currently run only as a manual `scripts/loadtest.ts`) and the stressor/residue rule in `architecture-style.adl`;
2. six invariants documented in `ARCHITECTURE.md` but still outside the ADL/test-ID system;
3. org sync durability is covered by good point-wise tests, but there is no end-to-end reconciliation check that, after the queue drains, every local org key is present exactly once on the remote, and no automated recovery trigger that does not depend on a new org write;
4. the runtime landscape in `system.adl` declares who talks to whom, but not consistently whether each edge is synchronous or asynchronous at the workflow level;
5. the release gate verifies structure, contracts and crash safety, but the hardest scale objective (20k memories) is not an automated release gate;
6. capability/quality history is only partially current: most figures in `docs/QUALITY.md` are from v1.7.1, while the package is at v1.10.0;
7. there is no single review record that says, per checklist item, whether it is `Pass`, `Fail` or `N/A`, with evidence, owner and action.

This plan stays proportional to a solo-maintained, local-first product. It does **not** propose microservices, a service mesh, a broker, a platform team, enterprise governance, an SBOM scanner or an automatic multi-team commit analysis.

## 1. Review of the earlier inputs

### 1.1 Review of the earlier `deepseek` plan

**Verdict: useful as a set of principles, but factually wrong as an architecture plan for this repository.**

It analyzed a different repository (`/home/.../skill-evidente-sincronizate-telefon-laptop-ubuntu`) and therefore imported a Python, Syncthing, ING-CSV, systemd and Obsidian context that does not exist in `total-recall`. In consequence:

- its proposed `docs/architecture.md`, `README.md`, `tests/test_architecture.py` and `.github/workflows/tests.yml` are not applicable here;
- its claim that ADL should not be adopted is already answered differently: this repository **has** ADL, a coverage gate and ArchUnitTS tests that make those ADL files executable;
- its claim that CI is missing is wrong for this repository — `.github/workflows/mutation.yml` and `release.yml` already exist as a much stronger gate;
- its proposed Python `unittest` + `ast` architecture tests are the wrong implementation language and would duplicate the existing Vitest/ArchUnitTS checks.

What is worth keeping from that plan, translated to this repository:

- keep the response proportional; do not mechanically turn every checklist line into a rule;
- do not invent capability thresholds before a baseline exists (this repo already has baselines, but they need to be refreshed);
- use synthetic fixtures for anything that would otherwise touch real user data, real Git remotes or network services;
- add explicit agent-acceptance scenarios only after the deterministic checks already pass;
- make a `Pass/Fail/N/A` review matrix the starting point, not an afterthought.

### 1.2 Review of the previous `total-recall` plan

**Verdict: the diagnosis was largely correct, but the solution was too large and under-specified in places.**

Good parts to keep:

- it correctly identified the true repo, the existing ADL system, the strict `adl-coverage.test.ts` gate, the existing CI workflows, the three untagged assertions and the six uncovered invariants;
- it kept the modular-monolith, local-first architecture as a non-negotiable constraint;
- it explicitly said that brokers, service meshes, microservices and enterprise team structures are out of scope;
- it mapped the existing org sync retry, org index wipe guard, atomic writes and privacy filter to the checklist instead of inventing new mechanisms;
- it separated the release gate, static architecture checks, runtime capability checks and periodic trend checks.

What must be corrected in this final plan:

- “run the full 20k benchmark on every PR/push/main/release” is too much. The right solution is a **small smoke benchmark in the PR gate** and a **full 20k benchmark only on `main` / pre-release or on a schedule**, because the DELETE phase in `loadtest.ts` is I/O-bound and can take minutes;
- it proposed adding a separate `quanta.adl` before proving the need. The first step is to make the existing `system.adl` state sync-vs-async and shared-file ownership explicitly, and only then decide if a dedicated quanta file is still needed;
- it under-specified how a benchmark failure should gate a release. The gate must not silently turn red on CI machine noise: it must require a **calibrated baseline**, an explicit budget file, and an allowed tolerance band;
- it did not distinguish the current measured baseline (v1.7.1) from the current `package.json` version (v1.10.0); any new target must be set from a re-measured current baseline, not from stale figures;
- it proposed too many new files at once (`SPEC.md`, `GOVERNANCE.md`, `REVIEW.md`, `quanta.adl`, `evolvability.adl`, a new workflow). This plan reduces that to two new files and targeted edits to existing files;
- the previous plan did not say how a failed assertion should enter governance. The requested dispositions are: **fix implementation**, **revise architecture**, or **explicit time-bounded exemption** — this is now part of the acceptance criteria.

### 1.3 Review of the repeated prompt

The prompt “citeste fisierele .txt si ARCHITECTURE_AS_CODE_CHECKLIST.md din root folder ... ; propune pentru repo curent un plan...” contains two traps that are now explicit in this plan:

1. “repo curent” is ambiguous. After switching workspaces, an assistant can end up reading from a different directory than the one it writes to — this is exactly how the earlier `deepseek` review ended up planning for the wrong repository. The invariant for all future asks is simple: **before proposing anything, restate the absolute path of the target repository, the current branch and the latest commit SHA in the response**, and do not proceed if those three do not match the user’s workspace.
2. “read the .txt files” must not be read as “adopt the kata as requirements.” The `Make the Grade`, `Sysops Squad`, `Monitor Me` and `TeamTopologies` material is a source of principles and evidence patterns, not documentation about this product. Nothing from those katas (200k concurrent students, queues, service mesh, state teams, a shared LLM grader, consumer-driven contracts between services) should be imported into `total-recall` unless the repository’s own requirements actually contain it.

A better, more precise future prompt would be:

```text
Target repo: /home/adrianb/_/in-progress/total-recall
Read /home/adrianb/_/in-progress/cursuri/masterclassNealFord2026/ARCHITECTURE_AS_CODE_CHECKLIST.md and the .txt files in that folder only as background evidence.
Do not import the kata systems as requirements.
Compare the checklist with this repository’s ADL, tests, workflows, docs and existing code.
Propose a proportional plan that mentions concrete repository facts.
```

### 1.4 Second review — independent verification pass (this session)

A second, from-scratch pass over the same prompt (the checklist, the four `.txt`
course files, and the repository) re-verified the plan above instead of trusting
it. Every factual claim was checked against the working tree at `69116ef`. The
result confirms §1.2 and adds three findings.

Confirmed against the code (evidence):

- nine ADL files with tagged `ASSERT(...)` IDs — `TR-S1–S14`, `TR-D1–D12`,
  `TR-W1–W8`, `TR-C1–C7`, `TR-R1–R6`, `TR-Q1–Q11`, `TR-P1–P5` — under
  `plugins/total-recall/architecture/adl/`;
- exactly three untagged assertions: the two scale targets in `capabilities.adl`
  (marked "untagged on purpose", measured by `scripts/loadtest.ts`) and the
  stressor/residue rule in `architecture-style.adl`;
- the six ADL-uncovered invariants are listed verbatim at the end of the
  invariants table in `plugins/total-recall/ARCHITECTURE.md`;
- `adl-coverage.test.ts` fails on an assertion without a test and on a test ID
  without an assertion; `adl-consistency.test.ts` pins the `system.adl` element
  set; `adl-repo-rules.test.ts` checks `TR-R5`, `TR-Q3`–`Q8`, `TR-W3` against
  repository files;
- `mutation.yml` (the gate on every push/PR to `main`): npm audit → typecheck →
  build + manifest version-sync → coverage (95/90/95/95) → integration over the
  real bundle → Stryker ≥ 65 → launcher tests; `release.yml` publishes only from
  the SHA the gate validated (`workflow_run`) and tags only when the version
  changes;
- `scripts/loadtest.ts`: the exit code reflects operational errors only
  (`errors > 0` → exit 1); the performance targets are reported, not enforced;
  the DELETE phase is I/O-bound (~79 deletes/s at 20k in the recorded run,
  ≈ 4–5 minutes); `LT_N` supports reduced runs; the TF-IDF-only comparison mode
  is manual (rename the transformers package);
- `docs/QUALITY.md`: measured on v1.7.1 (`af0c7cf`), four figures not
  re-measured since v1.6.8, NDQMS with four of seven traffic inputs assumed —
  while the package is at v1.10.0;
- the org-sync e2e test already runs against a local bare git remote with no
  network (`sync-org-memory.e2e.test.ts`: commit+push, delete, skip,
  privacy-block, branch detection, wipe guard) — but there is no post-drain
  reconciliation and no recovery trigger independent of a new org write;
- automatic capture is sandboxed (THREAT-MODEL T3: the nested `claude -p` runs
  with no tools, no MCP servers, no skills, no saved session) and the agent
  context is pinned in `CLAUDE.md`;
- no rule is currently hidden in `it.fails`: zero `it.fails('[TR-…')` calls
  exist, and `docs/SPEC-DRIVEN.md` sanctions `it.fails` only for a rule the
  code does not meet yet (a pre-code objective).

New findings this pass:

1. **`system.adl` does not declare the `orgSync: "server"` edge.** QUALITY.md
   documents that server-mode sync starts the hooks' sync script — "a new
   server → hooks edge" — but the landscape file has no such communication and
   `adl-consistency.test.ts` pins the landscape to exactly five elements.
   Until it is declared (or recorded as a deliberate omission), checklist 5.9
   ("observed runtime calls match the declarations") cannot pass. Adding an
   edge between already-defined elements does not break the pinned element list.
2. **`scripts/loadtest.ts` and `scripts/eval/` are stripped from the `release`
   branch** (`release.yml` `git rm`). The benchmark cannot live in any released
   artifact; its automation belongs on the `main` side of the gate
   (`mutation.yml`), not in the published tree.
3. **Exit-code and target semantics must be separated.** Today `1` means
   operational error. A future target miss needs its own signal (e.g. exit 3),
   or the gate cannot distinguish "the engine is broken" from "the runner is
   slow".

From the course material, the remaining stages borrow: the quanta syntax
(`DEFINE QUANTUM`, `... WITHIN q`) as background for the quanta declaration, the
three residue-prioritisation tests (core area, number of stressors,
probability), the rule that a residue becomes an ADL assertion because "a
residue is invisible in the code until someone, or some agent, simplifies it
away", and the toggle/branch expiry pattern. None of these require new
infrastructure here.

## 2. Conformance snapshot against the checklist

Static inspection at `69116ef`, not an audit. The item-by-item record with
evidence links lives in `plugins/total-recall/architecture/REVIEW.md` (WP-0).

| # | Checklist section | Status | Strongest existing evidence | Principal gap |
|---|---|---|---|---|
| 1 | Business drivers and intent | Partial | `architecture-style.adl` (style, capabilities, cost); README constraints (solo maintainer, best-effort, local-first); `docs/QUALITY.md` gates | Drivers not prioritised in one place with IDs and measurable targets; no reevaluation trigger on change |
| 2 | Logical and physical structure | Pass | C1–C4 diagrams + `[TR-S12]` partition + `components.ts`; `[TR-S1–S14]` enforced by ArchUnitTS | Keep; link each component to the workflow it serves (REVIEW.md) |
| 3 | ADL and documentation | Pass | 9 ADL files with metadata; `adl-coverage.test.ts`; `docs/SPEC-DRIVEN.md` documents the dialect honestly | 3 untagged assertions; 6 invariants outside the ID system; sync/async not stated per edge |
| 4 | Data architecture and durability | Mostly Pass | `[TR-D1–D12]`, `[TR-W1–W8]`, atomic writes, threat model with per-threat tests | No end-to-end org reconciliation; no recovery trigger independent of a new org write; growth budgets partially measured |
| 5 | Distributed coupling and quanta | Partial | `system.adl` landscape; per-quantum NDQMS figures in QUALITY.md | Edges not labelled sync/async; the `orgSync:"server"` edge undeclared; quanta not declared in the ADL; NDQMS partly assumed |
| 6 | Workflows, sagas, contracts | Mostly Pass | Shutdown + org-sync sagas (coordination/consistency); strict/permissive contracts `[TR-C1–C7]`; golden 17-tool schema | No contract-churn measurement; no version-fixture matrix for older frontmatter/index/envelopes |

| 7 | Code quality, repos, change management | Mostly Pass | Coverage/mutation gates; complexity ratchet `[TR-Q9]`; duplication `[TR-Q10]`; assertion hygiene `[TR-Q4/Q5]`; advisory git metric `[TR-Q11]` | Trend metrics partly manual and stale (v1.7.1 vs v1.10.0); DORA partially unmeasured |
| 8 | Evolvability and constant change | Partial | 5 stressors with residues in `architecture-style.adl` | No stressor×component×store matrix; the residue rule is not machine-checked; residues not explicitly prioritised |
| 9 | Agentic AI and delegated judgment | Mostly Pass | Structural generation limits (`[TR-S*]`); sandboxed capture (THREAT-MODEL T3); `[TR-Q2]` anti-weakening; `spec-eval` corpus run in CI | No documented known-pass/known-fail requirement for generated fitness functions; recall quality unmeasured (backlogged by design) |
| 10 | Fitness functions and governance | Partial | Every assertion has an owner (the repo), a trigger (CI) and a threshold (ADL consts) | No per-function register; no formal disposition process with expiry |
| 11 | Teams and enterprise alignment | Pass (lightweight) | Solo maintainer documented in README; agents bound by `[TR-Q*]` gates | Needs one page: owner map, agent membership, monitoring cadence |
| 12 | Minimum release gate | Partial | Structure, dependencies, cycles, data access, contracts all gated | The hardest fitness function (20k) not automated; reconciliation not automated; no disposition register |

### N/A register (with reevaluation triggers)

| Checklist topic | Why N/A here | Reevaluate when |
|---|---|---|
| Brokers, service mesh, microservices, platform teams | Modular monolith; one deployable per machine | A second deployment unit or a hosted variant appears |
| N-of-M consensus, DLQ, Workflow Event Processor for business decisions | No multi-agent business workflow; grading is not delegated | An agent-driven decision becomes load-bearing |
| Connection pools, DB server topology, storage-growth alerting | SQLite and local files only; growth covered by the loadtest and the index cap | A server DB or multi-GB vaults appear |
| Feature toggles; cross-repo duplication | No toggles; one repository | A toggle or a second shipped repository appears |
| Web vs app-store release cadence | One release channel (the `release` branch + npm launcher) | A second channel with a slower cadence appears |
| Enterprise governance / platform organisation | One maintainer | A second maintainer, or installs that must share rules, appear |
| Consumer-driven contracts across independent teams | One release controls both ends of every contract; older plugin versions are already covered by `[TR-C1]`/`[TR-C6]` | An external consumer of the MCP tools or of the org memory format appears |

## 3. Non-goals

Nothing below is introduced just to tick a checklist line:

- microservices, brokers, service meshes, sidecars, or a separate platform;
- a generic interpreter or runtime for the ADL dialect — the tests remain the
  runtime (`docs/SPEC-DRIVEN.md` already documents the dialect as pseudocode
  with no formal grammar, and that honesty stays);
- architectural rules for formatting, logging style, or cosmetics;
- blanket per-function/per-class thresholds beyond the existing ratchet;
- an enterprise team structure for a single-maintainer project;
- a technology inventory inside the ADL — stacks are harvested from manifests,
  lockfiles and builds;
- importing kata requirements (200k concurrent students, queues, service
  meshes, essay-grading consensus) — the katas are method sources, not this
  product's specifications.

## 4. Work packages

Order: WP-0 first (it drives everything else); P0 before P1 before P2. Sizes
assume one maintainer working against an existing suite; every package is
independently shippable.

### WP-0 — Review record (P0, ~half a day)

Create `plugins/total-recall/architecture/REVIEW.md` from the checklist's
review-record template:

- one row per checklist item: Pass / Fail / N/A, evidence (a link to the ADL
  assertion, test file, workflow, doc section or measurement at `69116ef`),
  owner, action, due;
- N/A rows carry the reason and the reevaluation trigger (the §2 register);
- seeded from this plan's §2 snapshot, then corrected item by item;
- maintained at every release and at major architecture changes; each failure
  maps to the work package that closes it.

Acceptance: every item has a status, evidence or reason, owner and action; no
failure without a disposition; the file states its baseline commit.

### WP-1 — Automated performance targets (P0, ~1–2 days)

The two scale assertions in `capabilities.adl` stay deliberately untagged until
this package makes them enforceable; the interim state is a time-bounded
exemption recorded in WP-4.

1. `scripts/loadtest.ts`:
   - read explicit targets from a budget file (for example
     `scripts/loadtest-budget.json`): minimum store writes/s, maximum recall
     p95 ms, a tolerance band, the scale they were calibrated at, the
     calibration date and the machine class;
   - print `actual vs target` per phase in the summary;
   - separate exit codes: `1` operational error (unchanged), `3` target miss;
   - write a JSON result artifact (phase rates, p50/p95, residuals, target,
     actual, pass/fail) for the trend record.
2. `.github/workflows/mutation.yml` (extended, not a new workflow file):
   - a smoke benchmark on push/PR: `LT_N=250` (500 memories) against a smoke
     budget from (1), calibrated on the runner first, with generous headroom,
     so a slow runner cannot fail a correct build;
   - a scheduled job (`on: schedule`, weekly, plus `workflow_dispatch`): the
     full `LT_N=10000` (20k) run against the recorded targets and tolerance
     band, uploading the JSON artifact; `contents: read` stays — no repo writes.
3. `RELEASE-SMOKE-TEST.md`: an interim manual item — "full 20k benchmark green
   within the last N days (link the scheduled run)" — replaced by a checkbox
   against the scheduled run once it is stable.
4. Tagging, only after at least three green scheduled runs:
   - `capabilities.adl`: `# [TR-P6]` on the store-rate assertion and
     `# [TR-P7]` on the recall-p95 assertion (next free IDs in the P range —
     verified);
   - the tagged tests: a calibrated smoke-scale test under
     `src/__tests__/architecture/` carrying both IDs (a few seconds, generous
     headroom), while the scheduled full run remains the trend and verification
     mechanism;
   - if the smoke test proves flaky on runners, keep the assertions untagged
     and record the exemption with an expiry in GOVERNANCE.md instead — never a
     silently red gate.

Acceptance: a push that regresses the calibrated smoke targets fails the gate
with an actionable message; the scheduled run produces history; no target is
enforced before it is calibrated.

### WP-2 — Org-sync reconciliation and recovery (P0, ~1–2 days)

Extends the existing e2e fixtures (local bare remote, no network, throwaway
HOME):

1. Reconciliation end to end: after the sync queue drains, enumerate the local
   org vault keys and the remote tree (`git ls-tree -r`) and assert the local
   org key set equals the remote key set, each key exactly once; report missing
   keys with their vault-relative paths.
2. Recovery without a new org write: first verify the current retry behaviour
   (a queued job is retried by the next sync run); if draining still requires a
   new org write, add a drain trigger — at SessionStart (the hook already pulls)
   or an explicit `sync-org-memory.mjs --drain` — whichever keeps the hook
   contract intact.
3. Crash matrix in REVIEW.md §4: for each scenario — crash after `.md` before
   index (`[TR-W3]`), push failure and later retry (`[TR-W5]`), corrupt
   committed index or branch-switch wipe (`[TR-W6]`), concurrent shutdown flush
   (`[TR-W2]`), duplicate delivery idempotency (the documented no-op), remote
   unavailable then restored (new) — name the test that proves it, or the
   package that adds it.
4. New assertions in `workflows.adl` (next free IDs, verified):
   - `[TR-W9]` a queued org job is retried without a new org write;
   - `[TR-W10]` after the queue drains, every local org key exists on the
     remote exactly once (the reconciliation);
   the tests carry the same IDs.

Acceptance: the test proves critical org data survives a failed push, retries
neither duplicate nor drop jobs, and reconciliation lists every difference.

### WP-3 — ADL hygiene and the six uncovered invariants (P1, ~1 day)

1. `system.adl` — communication semantics:
   - label every `DEFINE COMMUNICATION` synchronous or asynchronous (a
     documented suffix or trailing-comment convention: `stdio`, `in-process`
     and file I/O are synchronous; the git-based org sync is asynchronous with
     eventual consistency, as its saga already declares);
   - add the conditional `orgSync: "server"` edge
     (`DEFINE COMMUNICATION MCP Stdio Server TO Lifecycle Hooks AS
     server-mode-sync`), which references only already-defined elements, so
     `adl-consistency.test.ts` stays green; note the opt-in condition in the
     comment above it.
2. `architecture-style.adl` — tag the stressor/residue rule `# [TR-E1]` (a new
   E range; the `TR-[A-Z][0-9]+` regex in `adl-coverage.test.ts` accepts it)
   and add its test: parse the ADL and assert that every listed stressor's
   residue ID exists as a tagged assertion somewhere in `architecture/adl/`.
3. The six invariants from `ARCHITECTURE.md` become tagged assertions; the
   tests that already enforce them gain the ID in their names; where no test
   exists, add the small missing one. Proposed IDs (next free per file,
   verified against the current files):
   - one `memIndex` per process → `structure.adl` `[TR-S15]`;
   - journal only on personal writes → `data-governance.adl` `[TR-D13]`;
   - optional dependencies never bundled → `runtime-safety.adl` `[TR-R7]`
     (if untested: assert the three `--external` flags in the build script);
   - PostToolUse matcher stays a regex → `contracts.adl` `[TR-C8]`;
   - PreCompact reads `transcript_path` from stdin JSON → `contracts.adl` `[TR-C9]`;
   - SessionEnd extraction detached and recursion-guarded → `runtime-safety.adl` `[TR-R8]`.
   `ARCHITECTURE.md`'s closing sentence about the six disappears when the last
   one is tagged.
4. `docs/SPEC-DRIVEN.md` "Adding a rule" keeps working unchanged: the new IDs
   follow the documented next-free-ID convention.

Acceptance: `adl-coverage.test.ts` passes with the new IDs; no assertion is
tagged without a real test carrying it; `ARCHITECTURE.md` no longer lists
untagged invariants.

### WP-4 — Governance register (P1, ~half to one day)

Create `plugins/total-recall/architecture/GOVERNANCE.md`:

- the fitness-function register: for each ADL file — the owner (the
  maintainer; per-area owners where it matters: shutdown, org sync, contracts,
  benchmark), the data source (CI run, loadtest artifact, git history), the
  trigger (push/PR via `mutation.yml`; scheduled for performance; periodic for
  trends), the threshold (ADL consts, `stryker.conf.json`, `vitest.config.ts`)
  and the remediation path;
- the three dispositions for a failed assertion: fix the implementation, revise
  the architecture (ADL edit plus a BACKLOG entry), or an explicit, time-bounded
  exemption;
- exemptions are `backlog-and-plans/BACKLOG.md` DEFERRED entries extended with
  an **Expiry** field (add it to the legend); an expired entry is a Fail at the
  next review, not an indefinite deferment;
- the `it.fails` rule: a pre-code objective may start as `it.fails('[TR-…]')`
  (sanctioned by `docs/SPEC-DRIVEN.md`); a release-gating failure must never be
  parked there — REVIEW.md tracks any `it.fails` ID older than one release
  cycle;
- agent rules: agents do not approve their own exemptions and do not remove or
  weaken tests to make the build pass (`[TR-Q2]`, `[TR-Q4]`, `[TR-Q5]` enforce
  the mechanical part); a generated fitness function ships only together with a
  known-passing and a known-failing fixture that demonstrate it can both pass
  and fail (add one paragraph to `docs/SPEC-DRIVEN.md` "Adding a rule");
- the governance-boundary note: this repository's stable governance boundary is
  the `mutation.yml` gate; the shipped spec-driven MCP tools
  (`validate_architecture`) are the same governance exposed to users
  (checklist 10.8 evidence).

Acceptance: every fitness function in the register has owner, trigger,
threshold and remediation; every open failure has a disposition and, if
exempted, an expiry date.

### WP-5 — Refresh the measurement baseline (P2, ~half to one day)

- re-measure on v1.10.0 from CI outputs: coverage, mutation score (19 modules),
  the complexity table, largest file, duplication run;
- DORA from the git tags with the documented method (lead time and restore need
  tag timestamps — the caveat in QUALITY.md §Delivery);
- server start time and index-build time on an idle machine (QUALITY.md
  explains why the old figures were not re-measured);
- NDQMS: replace assumed traffic inputs with measured ones where cheap (git
  commit and co-change counts between components); keep the estimate flag on
  whatever remains assumed; record the remaining step to ≤ 0.30 (the
  shared-file version field) as a backlog item, not a promise;
- update `README.md` "At a glance" in the same pass (the docs-sync rule in
  `CLAUDE.md`).

Acceptance: `docs/QUALITY.md` states its measurement version as v1.10.0 with
dates and links; no figure claims a newer version than it was measured on.

### WP-6 — Stressor matrix and quanta declaration (P2, ~half a day)

- extend `architecture-style.adl` (or REVIEW.md §8) with a stressor × component
  × data-store incidence table for S1–S5 plus two new stressors: S6 the
  embedding model, provider or cost change (residues `[TR-R1]`, `[TR-R3]`,
  `[TR-R6]`, the degradation policy), S7 new privacy patterns (residues
  `[TR-D3]`, `[TR-D12]`);
- prioritise residues by the course's three tests: protects a core area, covers
  several stressors, probability × impact;
- declare the quanta in `system.adl` comments and REVIEW.md §5, matching
  QUALITY.md's NDQMS partition: `server` = {mcp-server, embedder (in-process)},
  `hooks` = {hooks}, `remote` = {org-remote}; the static-coupling rules between
  them are the existing `[TR-S13]`, `[TR-S14]`, `[TR-R5]` independence rules;
  formal `DEFINE QUANTUM` syntax stays out (the dialect has no parser for it);
  revisit only if a component gains a second deployment (BACKLOG trigger).

Acceptance: every stressor maps to components and stores; every residue named
by the matrix exists as a tagged assertion (the `[TR-E1]` test from WP-3
guards this).

### WP-7 — Contract churn and version fixtures (P2, optional)

- measure contract churn periodically, advisory like `[TR-Q11]`: git history of
  the contract-bearing files (the golden tool schema, hook envelope fields,
  frontmatter fields, the `index.json` shape) — a trend, not a gate;
- keep a small version-fixture matrix in the integration suite: an old-form
  memory file, an old hook envelope and an old org `index.json` are read
  without error (`[TR-C6]` pins the principle; the fixtures pin it across
  versions).

Acceptance: contract changes are visible in a periodic report; old-version
fixtures stay green.

## 5. Minimum release gate — explicit mapping

| # | Requirement | Status at `69116ef` | Closed by |
|---|---|---|---|
| 1 | Driving capabilities have measurable targets | Partial — targets exist (ADL + QUALITY.md) but are not automated | WP-1 |
| 2 | Repository/deployment structure matches the architecture | Pass — `[TR-S12]`, C4, `components.ts` | — |
| 3 | Forbidden dependencies and cycles are checked | Pass — `[TR-S1–S14]`, `[TR-S7]` in ArchUnitTS | — |
| 4 | Data ownership and sensitive-data access enforced | Pass — `[TR-D1–D12]` + the threat model with tests | — |
| 5 | Critical data survives crashes; reconciliation proves it | Partial — point-wise tests exist; no end-to-end reconciliation | WP-2 |
| 6 | Synchronous dependencies do not invalidate scale/availability | Partial — landscape declared, edges unlabelled | WP-3 |
| 7 | Workflows and contracts have ownership and failure handling | Partial — sagas and contracts tested; ownership implicit | WP-2, WP-4 |
| 8 | The hardest fitness function runs automatically | Fail — the 20k benchmark is manual | WP-1 |
| 9 | Agent-generated changes stay within declared boundaries | Pass — structural gates, `[TR-Q2]`, sandboxed capture; the self-test practice is documented in WP-4 | WP-4 |
| 10 | Every failure has a disposition | Partial — BACKLOG DEFERRED exists; no expiry, no register | WP-0, WP-4 |

## 6. Validation

From `plugins/total-recall/`:

    npm run typecheck
    npm run build
    npm run test:coverage      # 95/90/95/95 thresholds
    npm run test:integration   # the real dist/index.js over stdio
    npx stryker run            # break ≥ 65

From the repository root:

    npm test                   # the npx launcher tests
    node test/pack-guard.mjs

The benchmark runs only against a throwaway HOME (the script refuses the real
one):

    HOME=/tmp/tr-loadtest npx tsx scripts/loadtest.ts

Definition of done for the whole plan:

- every checklist item has a status, evidence and owner in REVIEW.md;
- all ten minimum-gate items are Pass or carry a valid, expiring exemption;
- no release-gating failure is hidden in `it.fails`;
- every load-bearing rule has an ID, a test, and proof that the test detects a
  violation (the known-failing fixture);
- the benchmark and the reconciliation run automatically and produce history;
- the ADL, the C4 diagrams, `ARCHITECTURE.md`, `docs/SPEC-DRIVEN.md` and
  `docs/QUALITY.md` agree with one another;
- no dependency or infrastructure was added that the project's drivers do not
  justify.

## 7. Traceability — review findings to work packages

| Finding (source) | Work package |
|---|---|
| Two scale assertions and the stressor rule untagged; the 20k run is manual (§0.1, §1.2) | WP-1 |
| Six invariants outside the ID system (§0.2) | WP-3 |
| No org reconciliation; recovery tied to a new org write (§0.3) | WP-2 |
| Edges unlabelled sync/async; quanta undeclared; the `orgSync:"server"` edge missing (§0.4, §1.4) | WP-3, WP-6 |
| The gate does not verify the hardest objective (§0.5) | WP-1 |
| Stale figures: v1.7.1 measurements on a v1.10.0 package (§0.6) | WP-5 |
| No review record or disposition register (§0.7, §1.2) | WP-0, WP-4 |
| `loadtest.ts` stripped from `release`; exit-code semantics (§1.4) | WP-1 |
| Contract churn and version fixtures unmeasured (§1.2) | WP-7 |

## 8. Application log

**2026-11-21 — applied in one pass (WP-0…WP-4, WP-6):**

- **WP-0** — `plugins/total-recall/architecture/REVIEW.md`: the full checklist record (12 sections, item by item, with evidence at `69116ef`), including the §0 driver table and the §4 crash/recovery matrix.
- **WP-1** — `scripts/loadtest-budget.json` (new) + `scripts/loadtest.ts`: budget-driven targets (`LT_PROFILE` smoke/full auto-selection), actual-vs-target reporting, exit-code separation (1 = operational error, 3 = target miss), JSON trend artifact (`LT_RESULT_JSON`); the VERIFY phase now excludes the engine-auto-created personal `journal/<date>.md` (the documented false alarm would have failed every gate run). `.github/workflows/mutation.yml`: `benchmark-smoke` job on every push/PR (`LT_N=250`) and `benchmark-full` weekly (`on: schedule` + `workflow_dispatch`), TF-IDF-forced per TR-R3. `RELEASE-SMOKE-TEST.md` §10 adds the interim release-gate item.
- **WP-2** — `sync-org-memory.mjs --drain` (commits/pushes the staged leftovers of failed pushes; key guards skipped, ORG_REPO guard kept) + `hooks/scripts/sync-org-memory.sh --drain` (drains `.sync-queue` under the worker's lock, then runs the .mjs drain; never reads stdin) + `src/__tests__/sync-org-reconcile.e2e.test.ts` (the outage→heal→drain→reconcile scenario against a local bare remote) + `workflows.adl` `[TR-W9]`/`[TR-W10]`.
- **WP-3** — `system.adl`: `# edge: sync/async` labels on every communication (+ consistency test), the conditional `orgSync:"server"` edge declared, quanta comments (server/hooks/remote); `architecture-style.adl`: S1–S7 in the machine-checked residue format + the stressor×component×store incidence table + `[TR-E1]` on the residue rule; the six ARCHITECTURE.md invariants tagged (`[TR-S15]`, `[TR-D13]`, `[TR-R7]`, `[TR-C8]`, `[TR-C9]`, `[TR-R8]`) with their tests (the `it.fails`-style conditional got its ID on its own quoted line so `adl-coverage` sees it); ARCHITECTURE.md closing note updated; new tests: `stressor-residues.test.ts`, `[TR-R7]` in `adl-repo-rules.test.ts`, `[TR-S15]` in `state.test.ts`, the `[TR-D13]` negative (org writes no journal line) in `index.test.ts`.
- **WP-4** — `plugins/total-recall/architecture/GOVERNANCE.md` (fitness-function register, named ownership, three dispositions, cadence, governance boundary, reevaluation triggers) + BACKLOG Expiry convention (explicit on new entries, 2027-06-30 default) + SPEC-DRIVEN.md "Adding a rule": known-pass/known-fail requirement + the edge-label convention.
- **WP-6** — stressors S6 (embedding model/provider/cost) and S7 (new privacy patterns) with residues + the incidence matrix; quanta declared (see WP-3).
- **Deferred with expiry (BACKLOG):** WP-5 (QUALITY.md v1.10.0 refresh — 2027-03-31), WP-7 (contract churn + version fixtures — 2027-06-30), `[TR-P6]`/`[TR-P7]` tagging (2027-03-31, after ≥ 3 green scheduled runs).

**Validation at application time (this machine, `TMPDIR=` to mirror CI):**

- `npm run typecheck` — pass (after installing the missing optional dep `@huggingface/transformers` locally; its absence was a pre-existing environment gap, unrelated to this change set).
- `npm run build` — pass (all five dist bundles).
- `npm test` — **77 files, 1116/1116 tests pass** (up from 1022 at the v1.7.1 baseline), including `adl-coverage` with the nine new IDs, the edge-label consistency check, `[TR-E1]`, and the `[TR-W9]`/`[TR-W10]` e2e.
- `npm run test:integration` — 4 files, 24/24 pass (real `dist/index.js` over stdio).
- Smoke benchmark (`LT_N=50`, throwaway HOME): targets PASS, VERIFY PASS, exit 0, JSON artifact written.
- Repository root: `npm test` (npx launcher) and `node test/pack-guard.mjs` — pass.
- `npx stryker run` deliberately not re-run: no mutated `src/` module changed in this pass; the next CI run produces the score.
- Two implementation lessons recorded by the gate itself: `sync-org-memory.mjs` is plain `.mjs` (tsc never checks it — the block-scoping slip surfaced only as a runtime `ReferenceError` in the e2e), and `adl-coverage.test.ts` requires IDs in `it()` names, not `describe()` names.