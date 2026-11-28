# Review record — Architecture as Code checklist

**Repository:** `total-recall` · **Baseline:** `main` @ `307c288` (2026-11-28 follow-up — PLAN-ARCHITECTURE-AS-CODE-COMPLIANCE-FOLLOWUPS.md) · **Owner:** Adrian Balaban (maintainer)
**Checklist:** `/home/adrianb/_/in-progress/cursuri/masterclassNealFord2026/ARCHITECTURE_AS_CODE_CHECKLIST.md`
**Method:** static inspection plus the repository's own gates at the baseline commit. Refresh at every release and at major architecture changes.
**Status legend:** Pass · Fail · Partial (a Fail with an action) · N/A (reason + reevaluation trigger, see the N/A register in applied/PLAN-ARCHITECTURE-AS-CODE-COMPLIANCE.md §2).
**Dispositions & exemptions:** `architecture/GOVERNANCE.md`; deferred work lives in `backlog-and-plans/BACKLOG.md` (DEFERRED + Expiry). Actions reference the work packages (WP-0…WP-7) of `backlog-and-plans/applied/PLAN-ARCHITECTURE-AS-CODE-COMPLIANCE.md`.

## 0. Prioritized business drivers (checklist §1)

| # | Driver | Target (measurable) | Measured by |
|---|---|---|---|
| 1 | Durability & privacy — no confirmed `.md` loss; nothing unfiltered leaves the machine | zero-loss invariant `[TR-W3]`; fail-closed filter `[TR-D3]`; crash/recovery matrix (§4 below) | unit + integration suites, e2e sync tests |
| 2 | Simplicity & cost — one Node process, Markdown files, zero runtime cost | 2 runtime deps; no server; local-first | package.json, architecture-style.adl |
| 3 | Recall responsiveness at scale | store ≥ 1000 writes/s flat to 20k; recall p95 < 150 ms; startup < 500 ms; SessionStart index ≤ 300 entries | `scripts/loadtest.ts` + budget (WP-1); QUALITY.md |
| 4 | Evolvability under constant change | mutation ≥ 65 `[TR-Q6]`; complexity ratchet `[TR-Q9]`; residues as ADL `[TR-E1]` | Stryker, fitness tests |
| 5 | Deployability — one command, three channels | gate green → release branch + npm provenance | mutation.yml → release.yml |

## 1. Business drivers and architectural intent

| Item | Status | Evidence | Action |
|---|---|---|---|
| Workflows and domain boundaries documented | Pass | `ARCHITECTURE.md` (C1–C4, write path, hooks), `system.adl` | none |
| Functional requirements separated from capabilities | Pass | README (what you get) vs `capabilities.adl` / `architecture-style.adl` | none |
| Driving capabilities identified and prioritized | Pass | table §0 above (WP-0) | none |
| Each driving capability has a measurable target | Partial | §0 table; retrieval quality unmeasured (BACKLOG, by design) | WP-1 automates the two scale targets |
| Budget, deadline, team size, maturity, change frequency explicit | Pass | README (solo maintainer, best-effort, MIT); QUALITY.md DORA (11 releases/month) | none |
| Style chosen through trade-offs, not by default | Pass | `architecture-style.adl` (Modular Monolith, local-first); README design story | none |
| Cost/simplicity/consistency/scalability/fault-tolerance weighed | Pass | `architecture-style.adl` capability definitions; THREAT-MODEL.md | none |
| Architecture reevaluated when the environment changes | Pass | GOVERNANCE.md reevaluation triggers (WP-4) | none |
| Current capability measurements compared with future needs | Partial | QUALITY.md figures from v1.7.1 on a v1.10.0 package | WP-5 (deferred, expiry in BACKLOG) |
| Complexity proportional; no speculative distribution | Pass | 2 runtime deps; one deployable; non-goals list (PLAN §3) | none |

## 2. Logical and physical structure

| Item | Status | Evidence | Action |
|---|---|---|---|
| Logical architecture identifies domains/components/layers | Pass | C4 diagrams, `structure.adl` components | none |
| Domains are capabilities, not database nouns | Pass | components are behaviors (state, persistence, search, tools) | none |
| Repo/deployment structure implements the logical architecture | Pass | dist bundles + hooks dirs ↔ `[TR-S13]`, `[TR-S14]`, `[TR-R5]` | none |
| Every production unit has an architectural home | Pass | `[TR-S12]` + `components.ts` | none |
| Shared areas have explicit ownership, no dumping ground | Pass | Pure Helpers enumerated; `[TR-Q11]` churn watch | none |
| Responsibilities cohesive, inferable from names/location | Pass | CLAUDE.md module map; review culture | none |
| Required AND forbidden dependencies documented | Pass | `[TR-S1–S17]`; contracts `BETWEEN`; positive edges `[TR-S16/S17]` | none |
| Deliberate shared-library use distinguished from forbidden cross-service deps | Pass | standalone hook bundles `[TR-R5]` vs tool isolation `[TR-S5]` | none |
| No unintended cyclic dependencies | Pass | `[TR-S7]` (ArchUnitTS `haveNoCycles`) | none |
| Layer rules enforced | Pass | `[TR-S2]`, `[TR-S3]` | none |
| Async messaging treated as communication, not code dependency | Pass | `system.adl` communications; git edges carry no imports | none |
| Functional tests passing is not treated as architecture proof | Pass | ADL coverage gate + fitness functions are separate checks | none |

## 3. Architecture Definition Language and documentation

| Item | Status | Evidence | Action |
|---|---|---|---|
| Load-bearing decisions as ADL definitions and ASSERT statements | Pass | 10 ADL files, 79 tagged assertions | none |
| Files carry metadata (DESCRIPTION/CATEGORY/NAMESPACE) | Pass | every ADL file header | none |
| Logical names bound to physical identifiers | Pass | `AS` aliases ↔ `components.ts` patterns, real dirs/files | none |
| High-level and per-concern detail files separated | Pass | structure/system/workflows/contracts/… split | none |
| Static-coupling rules and capability thresholds in separate files | Pass | `structure.adl` vs `capabilities.adl`/`code-quality.adl` | none |
| Database ownership via access assertions | Pass | `[TR-D1–D4]` | none |
| ADL states intent, not a technology inventory | Pass | dialect documented as pseudocode (SPEC-DRIVEN.md) | none |
| `USING` only where deliberate | Pass | no `USING` in the dialect's use here | none |
| Schemas/connection strings not duplicated into ADL | Pass | ADL names contracts, not field lists | none |
| Agents receive the relevant ADL as context | Pass | CLAUDE.md pins; `get_architecture_context`; `architecture-change.sh` on `.adl` edits | none |
| Documentation covers only decisions worth preserving | Pass | ARCHITECTURE.md invariant table + CLAUDE.md gotchas | none |

## 4. Data architecture and durability

| Item | Status | Evidence | Action |
|---|---|---|---|
| Data topology chosen through explicit trade-offs | Pass | Markdown vaults + local SQLite vs DB server (README, PLAN non-goals) | none |
| Every store has documented ownership and accessors | Pass | `[TR-D1]`, `[TR-D2]`, `[TR-D4]` | none |
| Credentials/config do not contradict access rules | Pass | privacy filter fail-closed `[TR-D3]`; THREAT-MODEL T5/T13 | none |
| No cross-domain "just read" reaches | Pass | personal/org vault separation `[TR-D7]` | none |
| Cross-domain needs met deliberately (APIs/events/replicas) | Pass | org sync saga (choreography, eventual) | none |
| Freshness/consistency/duplication/availability/cost trade-offs recorded | Pass | saga CONSISTENCY eventual; QUALITY.md NDQMS notes | none |
| Sensitive data isolated from unauthorized clients/agents | Pass | `[TR-D3]`, `[TR-D5]`, `[TR-D9]`, `[TR-D14]`, `[TR-C3]`; THREAT-MODEL T1/T2 | none |
| Storage growth and peak-load budgets measurable | Partial | loadtest + `indexMaxEntries` cap; not automated | WP-1 (done in this pass; tagging pending calibration) |
| Schema-change frequency reviewed | Partial | contract churn unmeasured | WP-7 (deferred, expiry in BACKLOG) |
| Reconciliation proves critical records flow end to end | Pass | `[TR-W10]` e2e: local org keys == remote tree, exactly once (WP-2) | none |
| Consumers never acknowledge before persistence | Pass | queue job removed only after successful sync (`[TR-W5]`); `.md` before index `[TR-W3]` | none |
| Failure scenarios cover crashes/duplicates/retries/outages | Pass | crash matrix §4 below (`[TR-W1–W8]` + `[TR-W9]`) | none |
| Idempotency / durable receipts protect critical workflows | Pass | idempotent re-sync; staged changes as the durable receipt; `--drain` recovery `[TR-W9]` | none |
| Observability covers infra and domain metrics | Pass | perf/error samples `[TR-P4]`; `.sync-errors.log` + SessionStart warning; `.extract.log` | none |
| Production measurements periodically revalidate the topology | Partial | loadtest manual → scheduled (WP-1); no periodic NDQMS re-estimate | WP-5 (deferred) |

### §4 Crash/recovery matrix

| Scenario | Proof |
|---|---|
| Crash after `.md`, before index | `[TR-W3]` (source order + `adl-repo-rules`) — index state may be lost, content never |
| Index files crash-safety | `[TR-W1]` atomic write via tmp+rename |
| Concurrent shutdown | `[TR-W2]` (static + SIGTERM integration test) |
| `rebuild_index` preserves access metadata | `[TR-W4]` |
| Push failure → retry | `[TR-W5]` (queue survives; staging kept via reset --soft) |
| Corrupt committed index / branch-switch wipe | `[TR-W6]` (`guardTreeWipe` + sync-org-wipe-guard tests) |
| Export/import of unreadable bodies | `[TR-W7]` |
| Single-writer index cache | `[TR-W8]` |
| Recovery without a new org write | `[TR-W9]` (e2e: `sync-org-memory.sh --drain`) |
| End-to-end reconciliation | `[TR-W10]` (e2e: local keys == remote keys, exactly once) |

## 5. Distributed coupling and architecture quanta

| Item | Status | Evidence | Action |
|---|---|---|---|
| Shared databases/brokers/libraries/caches identified | Pass | `system.adl` landscape; shared files named (index.json, org tree) | none |
| Quanta identified deliberately | Pass | quanta declared in `system.adl` + QUALITY.md NDQMS (server/hooks/remote/vault/host); coupling rule `[TR-A2]` | none |
| Every element belongs to a declared quantum | Pass | `# quantum` declarations, machine-checked by `[TR-A1]` (`adl-consistency.test.ts`) | none |
| Synchronous dependencies identified | Pass | `# edge: sync/async` labels + consistency test (WP-3) | none |
| Scale/availability implications of sync dependencies stated | Pass | all sync edges are in-process/local; the async ones are git-bound (commented per edge) | none |
| Static and dynamic coupling declared separately | Pass | `structure.adl` (static) vs `system.adl` (runtime) | none |
| Communication semantics declared per edge | Pass | sync/async labels with the saga linkage (WP-3) | none |
| Observed runtime calls match the declarations | Pass | conditional `orgSync:"server"` edge declared (WP-3); TR-R4 limits process starts | none |
| Distributed N/A items carry a reason + trigger | Pass | PLAN §2 N/A register | none |

## 6. Distributed workflows, sagas and contracts

| Item | Status | Evidence | Action |
|---|---|---|---|
| Workflows modeled as sagas with coordination/consistency | Pass | shutdown (orchestrated) + org sync (choreography, eventual) in `workflows.adl` | none |
| Workflows and contracts have explicit owners | Pass | GOVERNANCE.md register (WP-4) | none |
| Failure/timeout/retry handled and tested | Pass | crash matrix §4; `[TR-W5/W6/W9]` | none |
| Contracts strict where one release controls both ends | Pass | `[TR-C1]`, `[TR-C2]`; golden 17-tool schema | none |
| Tolerant (name/value) where cadences differ | Pass | hook envelope, memory file `[TR-C6]` | none |
| Backward compatibility across consumer versions | Partial | `[TR-C6]` tolerance pinned; no cross-version fixture matrix | WP-7 (deferred) |
| Contract churn measured | Partial | unmeasured | WP-7 (deferred) |
| N-of-M consensus, DLQ, Workflow Event Processor | N/A | no multi-agent business workflow | trigger in the N/A register |

## 7. Code quality, repositories and change management

| Item | Status | Evidence | Action |
|---|---|---|---|
| Coverage, mutation, complexity measured and gated | Pass | vitest thresholds 95/90/95/95; Stryker break ≥ 65 `[TR-Q6]`; ratchet `[TR-Q9]` | none |
| Duplication bounded | Pass | `[TR-Q10]` CPD-style check | none |
| Assertion hygiene (no empty tests, no tautologies) | Pass | `[TR-Q4]`, `[TR-Q5]` | none |
| No blanket per-class thresholds | Pass | ratchet + frozen baseline, not uniform caps | none |
| Agent-written code held to a stricter limit | Pass | advisory complexity ≥ 5 gate for agent code (QUALITY.md); `[TR-Q2]` anti-weakening | none |
| Trend metrics tracked over time | Partial | QUALITY.md trend tables, partly manual/stale | WP-5 (deferred) |
| Git health metrics advisory, not gating | Pass | `[TR-Q11]` warning-only shared-churn metric | none |

## 8. Evolvability and constant change

| Item | Status | Evidence | Action |
|---|---|---|---|
| Likely stressors listed | Pass | S1–S7 in `architecture-style.adl` (WP-6 added S6/S7) | none |
| Stressor × component × data-store matrix | Pass | incidence table in `architecture-style.adl` + §5 quanta (WP-6) | none |
| Residues designed for important stressors | Pass | per-stressor residues (adapters, degradation, tolerance contracts) | none |
| Residues prioritized (core area / coverage / probability) | Pass | prioritisation note in `architecture-style.adl` (WP-6) | none |
| Residues preserved as ADL assertions, machine-checked | Pass | `[TR-E1]` stressor-residues.test.ts (WP-3) | none |
| Maintainability/testability/deployability measured | Pass | ML 72.7%, D 0.42, mutation 81% (QUALITY.md) | none |
| Capability trends tracked; single measurements insufficient | Partial | trend tables exist; refresh cadence manual | WP-5 (deferred) |

## 9. Agentic AI and delegated judgment

| Item | Status | Evidence | Action |
|---|---|---|---|
| Generation scope limited to explicit boundaries | Pass | `[TR-S5]`, `[TR-S12]`, `components.ts` partition | none |
| Agents cannot silently add cross-domain deps/coupling | Pass | ArchUnitTS fitness functions fail the build | none |
| Generated fitness functions reviewed by a person | Pass | solo-maintainer PR review; CLAUDE.md pinned contracts | none |
| Generated fitness functions tested known-pass AND known-fail | Pass | documented requirement + SPEC-DRIVEN.md "Adding a rule" (WP-4) | apply to every new generated check |
| Dependency-existence rules implemented correctly | Pass | `hasNoCycles`/`dependOnFiles` forms verified by the suite itself | none |
| LLM evaluations never presented as deterministic proof | Pass | eval harness deferred (BACKLOG); deterministic gates kept separate | none |
| N-of-M / second-opinion / DLQ mechanics | N/A | no delegated business judgment | trigger in the N/A register |
| Delegated decisions audited | Pass | journal + git history per write; SessionStart warnings | none |
| Consensus-threshold changes require approval | N/A | no consensus thresholds | trigger in the N/A register |
| Technology harvested from builds, not an ADL inventory | Pass | esbuild externals pinned `[TR-R7]`; no stack lists in ADL | none |

## 10. Fitness functions and operational governance

| Item | Status | Evidence | Action |
|---|---|---|---|
| Fitness functions protect load-bearing walls, not cosmetics | Pass | all TR-* rules are behavioral/structural; no style rules | none |
| Formatting/logging rules stay linters | Pass | none exist in the ADL | none |
| The hardest design-shaping fitness function attempted first | Pass | the 20k loadtest predates the automation (2026-07-30 reference run); now budget-enforced (WP-1) | keep smoke+schedule green |
| Deterministic empirical checks preferred | Pass | all gates are deterministic; LLM eval stays out of the gate | none |
| Each fitness function has owner/trigger/threshold/remediation | Pass | GOVERNANCE.md register (WP-4) | none |
| Thresholds tuned to feedback loops, not dashboards | Pass | gates fail builds (mutation break, coverage thresholds, budget exit 3) | none |
| Checks run in CI; production checks after business windows | Pass | mutation.yml per push/PR; RELEASE-SMOKE-TEST per release; scheduled benchmark weekly | none |
| Governance exposed at a stable boundary | Pass | `mutation.yml` gate; the shipped spec-driven MCP tools expose the same governance to users | none |
| Checks produce actionable evidence | Pass | coverage/mutation reports; benchmark JSON artifact (WP-1); `.sync-errors.log` | none |
| Failures get one of three dispositions | Pass | GOVERNANCE.md (fix / revise architecture / expiring exemption); expiry now machine-checked `[TR-G1]` | none |
| Pre-code objective vs release-gating failure distinguished | Pass | `it.fails` sanctioned for pre-code (SPEC-DRIVEN.md); staleness now machine-checked `[TR-G2]` | none |
| Repeated agent-caused failures fix the prompt/rule/scope | Pass | BACKLOG DEFERRED entries + CLAUDE.md contract-pinning practice | none |

## 11. Teams and enterprise alignment

| Item | Status | Evidence | Action |
|---|---|---|---|
| Team boundaries align with architecture | Pass (lightweight) | one stream-aligned maintainer; documented in README | none |
| Agents represented in membership and commit governance | Pass | `[TR-Q2]`, `[TR-Q4]`, `[TR-Q5]`; GOVERNANCE.md agent rules | none |
| Cross-cutting resources have explicit owners | Pass | GOVERNANCE.md owner map (shutdown, org sync, contracts, benchmark) | none |
| Co-changes/conflicts monitored with time-bounded assertions | Partial | `[TR-Q11]` advisory monthly churn; agent-conflict tracking not automated | acceptable for one maintainer; revisit with a second |
| Agent effectiveness assessed (disruption + delivery) | Partial | delivery outcomes in QUALITY.md DORA; disruption not tracked | revisit with a second maintainer |
| Enterprise governance / platform teams | N/A | one maintainer; shared platform ownership matches org size | trigger in the N/A register |

## 12. Minimum release gate

See applied/PLAN-ARCHITECTURE-AS-CODE-COMPLIANCE.md §5 for the item-by-item mapping. Summary at this baseline: items 2, 3, 4, 9 Pass with evidence; 1, 6, 7, 10 Partial with owned actions; 5 closed by WP-2 (`[TR-W9]`/`[TR-W10]`); 8 closed by WP-1 (smoke benchmark in the gate, full 20k scheduled).

**2026-11-28 follow-up (PLAN-ARCHITECTURE-AS-CODE-COMPLIANCE-FOLLOWUPS.md)** applied P1 (this pass), P2 (`[TR-G1]/[TR-G2]` governance gates + `governance.adl`), P3 (`[TR-A1]/[TR-A2]` quanta), P8 (`[TR-S16]/[TR-S17]` positive dependencies) and P9 (`[TR-D14]` personal provenance vs org sync), plus the P10 advisory fixture-pairing check. Still pending (time-boxed in BACKLOG): P4 `[TR-P6]/[TR-P7]` (gated on ≥3 green `benchmark-full` runs), P5 `[TR-P8]/[TR-P9]` (capability budgets), P6 `[TR-C10]` + contract churn + version fixtures, P7 (QUALITY.md v1.10.0 refresh).

## Sign-off

- Every item above has a status, evidence and action — initial fill done at `69116ef` (WP-0).
- No open Fail without a disposition: Partial rows carry WP references or BACKLOG entries with expiry.
- Next review: at the next release, or at any change to the deployment model, vault scale, or maintainer count.