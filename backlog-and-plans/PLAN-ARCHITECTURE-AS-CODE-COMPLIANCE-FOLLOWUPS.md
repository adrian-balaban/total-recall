# Plan — Architecture-as-Code checklist follow-ups

**Owner:** maintainer · **Created:** 2026-11-28 · **Baseline:** `main` @ `307c288`
**Inputs:** `plugins/total-recall/architecture/adl/*.adl`, `architecture/GOVERNANCE.md`, `architecture/REVIEW.md` (pass at `69116ef`), checklist `ARCHITECTURE_AS_CODE_CHECKLIST.md`
**Predecessor:** `PLAN-ARCHITECTURE-AS-CODE-COMPLIANCE.md` (WP-0…WP-7). This plan finishes its open WPs and adds the gaps found in the 2026-11-28 re-review.

## 0. Starting point

- No open **Fail**. Every Partial in `REVIEW.md` has a WP or a BACKLOG entry with an expiry.
- 72 tagged assertions across 9 ADL files. `REVIEW.md` §3 still says 66.
- Three items are already registered and time-boxed: TR-P6/P7 tagging, WP-5 (measurement refresh), WP-7 (contract churn and version fixtures).
- Several governance rules are policy only, with no machine check: expiry enforcement, stale `it.fails`, the quantum rule, and the known-pass/known-fail fixtures.

## 1. Work packages

Ordered by value ÷ effort. **Expiry** is the date after which the item counts as a Fail at the next REVIEW pass (GOVERNANCE §3).

### P1 — Housekeeping (now, ~30 min)

- [ ] `REVIEW.md` §3: change "66 tagged assertions" to 72.
- [ ] `REVIEW.md` header: move the baseline to the commit where this plan lands.
- [ ] Register this plan in `REVIEW.md` §12 and in the Actions column of the affected rows.

### P2 — Make governance self-enforcing (now, ~half day) — checklist §10.10, §10.11

- [ ] **Expiry gate:** add `src/__tests__/architecture/backlog-expiry.test.ts`. It parses the `Expiry:` lines of every DEFERRED entry in `BACKLOG.md`, treats an entry without one as 2027-06-30, and fails when today is past the expiry. Tag the test `[TR-G1]`.
- [ ] **Stale `it.fails` gate:** list `it.fails('[TR-…]')` calls (there are none today) and fail if one is older than one release, using `git log -S` on the line. Tag `[TR-G2]`.
- [ ] Add a new `governance.adl` with both ASSERTs, and a row for it in the GOVERNANCE §1 register.
- Known-pass case: the current tree passes. Known-fail case: a fixture BACKLOG with a past expiry, and a fixture test file containing `it.fails`.

### P3 — Quanta as checked assertions (now, ~half day) — checklist §5.3, §5.4

- [ ] `system.adl`: turn the quantum comments into a parseable line format, `# quantum <name> = { … }`, the same pattern as the stressor lines checked by `[TR-E1]`.
- [ ] `ASSERT(Every actor, service, database and external belongs to exactly one declared quantum) # [TR-A1]`, enforced in `adl-consistency.test.ts`.
- [ ] `ASSERT(Static coupling between quanta exists only through TR-S13, TR-S14 and TR-R5) # [TR-A2]`. Concretely: the hook bundles import nothing from the server entry, and session-end is the one exception. Most of this already exists across S13/S14/R5. The new assertion makes the quantum rule itself visible and tagged.

### P4 — Tag the scale targets TR-P6 / TR-P7 (gated) — checklist §10.3, §12.8

- **Trigger:** ≥ 3 green weekly `benchmark-full` runs on the same runner image (`mutation.yml`, Mon 03:00).
- [ ] Recalibrate `scripts/loadtest-budget.json` on the CI runner and drop the "provisional" status.
- [ ] Tag the two ASSERTs in `capabilities.adl` as `[TR-P6]` (≥ 1000 writes/s flat to 20k) and `[TR-P7]` (recall p95 < 150 ms). Add the smoke-scale architecture test that carries both IDs.
- [ ] Remove "TR-P6/P7 pending" from GOVERNANCE §2.
- [ ] `RELEASE-SMOKE-TEST.md` §10: replace the interim "run locally and record" item with a checkbox against the latest scheduled run.
- **Expiry:** 2027-03-31 (decide after ≥ 12 scheduled runs).

### P5 — Remaining capability budgets (~2 h) — checklist §1.4, §4.8

- [ ] Check whether existing tests already cover the REVIEW §0 targets: startup < 500 ms and SessionStart index ≤ 300 entries (`indexMaxEntries`). Look at `index-cache.test.ts` and `server.integration.test.ts`.
- [ ] Add `DEFINE CONST MAX_INDEX_ENTRIES = 300` and `MAX_STARTUP_MS = 500` to `capabilities.adl`, as tagged ASSERTs `[TR-P8]` and `[TR-P9]`. Tag the existing test if one covers it, otherwise add one. Put startup in the benchmark job, not unit tests, to avoid runner flakiness.

### P6 — Contract evolution (WP-7) — checklist §6.10, §6.11, §6.12

- [ ] **Endpoint bound:** `DEFINE CONST MAX_TOOLS` in `contracts.adl`, with `ASSERT(The server registers at most MAX_TOOLS tools) # [TR-C10]`. Test it against the registry. The count includes the spec tools; note that number when writing the constant.
- [ ] **Version-fixture matrix:** old-form memory file, old hook envelope and old org `index.json`, all read without error. This extends `[TR-C6]` across versions (`src/__tests__/fixtures/contracts/v<x>/`).
- [ ] **Contract churn report** (advisory, warning only, like `[TR-Q11]`): use git history over the golden schema fixture, the hook-envelope readers, the frontmatter fields and the `index.json` shape. Add `MAX_CONTRACT_CHANGES_PER_RELEASE`.
- **Expiry:** 2027-06-30.

### P7 — Measurement refresh and trends (WP-5) — checklist §1.9, §4.15, §7, §8.7

- [ ] Re-measure for v1.10.0: coverage, mutation (19 modules), complexity table, DORA from tags, startup and index build, and NDQMS with measured inputs. Update `docs/QUALITY.md` and README "At a glance".
- [ ] Automate the refresh: a release-time script writes `metrics/<version>.json` and diffs it against the previous release. The diff is advisory and gets attached to the release PR. Without the automation, the refresh goes stale again.
- **Expiry:** 2027-03-31.

### P8 — Positive dependency rules (~1 h) — checklist §2.7, §9.5

- [ ] `structure.adl` has only "has no dependency" rules. Add the required edges as tagged ASSERTs, for example `Each tool depends on Tool Registry` and `Server depends on Tool Registry`. Implement them the correct way: *at least one file depends on X*, not *every file depends on X*.
- [ ] Known-fail fixture: a tool file with its registry import removed.

### P9 — Sensitive-data isolation, personal side (~2 h) — checklist §4.7

- [ ] `ASSERT(Journal entries and .superseded archives of Personal Vault never enter an org sync) # [TR-D14]`. Add it to the e2e sync test: seed both, sync, and assert they are absent from the remote tree.

### P10 — Agent governance hardening (advisory first) — checklist §7.5, §9.4, §11.7, §11.9

- [ ] **Fixture pairing:** a meta-test that every fitness test file added after this plan contains at least one known-fail case, for example a `describe('known-fail')` or an `it` tagged `(negative)`. Advisory until the spec-driven tools start generating checks in bulk, then gating.
- [ ] **Agent complexity ratchet:** promote the advisory "complexity ≥ 5 for agent code" to warn-then-fail on *new* functions only, keyed on `Co-Authored-By: Claude` commits.
- [ ] **Agent commit identity:** a CI check that agent-authored commits carry the attribution trailer. Revisit CODEOWNERS when a second maintainer joins.

## 2. Not doing (recorded tolerances)

| Item | Why it stays as is | Revisit trigger |
|---|---|---|
| `DEFINE QUANTUM` as a real dialect keyword | ADL here is pseudocode with no parser; P3's comment format plus a test is enough | a second deployment unit |
| Automatic org-sync drain at SessionStart (`[TR-W9]` is a manual `--drain`) | keeps the hook contract intact; the queue retries on the next sync | "heals without user action" becomes a driver |
| `config.orgVault` edit without restart silently stops sync (BACKLOG) | deferred product bug with trigger and shape | org-sync reliability rises in the REVIEW §0 driver table |
| N-of-M consensus, dead-letter queue, platform/enabling teams | no delegated business judgment; one maintainer | N/A register, PLAN-ARCHITECTURE-AS-CODE-COMPLIANCE §2 |
| Conflict and disruption tracking for agents | one maintainer, no parallel streams | second maintainer |

## 3. Sequencing

1. **Now:** P1 → P2 → P3 → P8 → P9. These are cheap, deterministic, and mostly one file each.
2. **Next release:** P5, P7 (with the REVIEW.md pass due per GOVERNANCE §4).
3. **Gated or later:** P4 (benchmark trigger), P6 (by 2027-06-30), P10 (advisory now).

## 4. Done when

- Every new rule is a tagged ASSERT with a test that carries its ID (`adl-coverage.test.ts` green), and each has a known-pass and a known-fail case.
- GOVERNANCE §1 has rows for the new families (`TR-G*`, `TR-A*`), and §2 has no "pending" text.
- A REVIEW.md pass at the new baseline shows the §1, §4, §5, §6, §7, §8 and §10 Partials closed or re-dated, with no expired BACKLOG entry.
