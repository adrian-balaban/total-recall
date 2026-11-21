# Governance register — Total Recall

**Owner:** Adrian Balaban (maintainer) · **Established:** 2026-11-21 (WP-4 of PLAN-ARCHITECTURE-AS-CODE-COMPLIANCE.md) · **Review record:** `architecture/REVIEW.md`

## 1. Fitness-function register

Every ADL assertion is a fitness function enforced by a test that carries its ID (`adl-coverage.test.ts` keeps the two in step). This register says, per family, who owns it, where the threshold lives, what triggers it, and what happens when it fails.

| ADL file (family) | Owner | Threshold lives in | Trigger | Data source | Remediation on failure |
|---|---|---|---|---|---|
| `structure.adl` (`TR-S*`) | maintainer | the assertions + `components.ts` sets | every push/PR (`mutation.yml`) | ArchUnitTS import graph | fix the import; or revise `structure.adl` + `components.ts` together |
| `data-governance.adl` (`TR-D*`) | maintainer (org sync: same) | the assertions | every push/PR | unit + e2e sync tests | fix the code path; a deliberate policy change revises the ADL first |
| `runtime-safety.adl` (`TR-R*`) | maintainer | the assertions + `package.json` build flags (`[TR-R7]`) | every push/PR | unit tests, bundle checks | fix the code/build; never widen the rule to get green |
| `workflows.adl` (`TR-W*`) | maintainer (shutdown / org sync per GOVERNANCE §2) | the assertions | every push/PR | unit + integration + e2e tests | fix the workflow code; crash-matrix row updated in REVIEW §4 |
| `contracts.adl` (`TR-C*`) | maintainer (contracts) | the assertions + the golden schema fixture | every push/PR (incl. `schema-parity` integration test) | integration suite | fix the schema/code; additive-only changes, never silent growth |
| `capabilities.adl` (`TR-P*`) | maintainer (benchmark: same) | the assertions + `scripts/loadtest-budget.json` | every push/PR (smoke, `LT_N=250`) + weekly schedule (full 20k) | `loadtest.ts` JSON artifact | a miss with a calibrated budget is a real regression: fix or exempt with expiry; an uncalibrated miss recalibrates first |
| `code-quality.adl` (`TR-Q*`) | maintainer | the assertions + `stryker.conf.json` + `vitest.config.ts` thresholds + `complexity-baseline.json` | every push/PR | CI runs (coverage, Stryker, source checks) | fix the code or shrink the baseline; the baseline only shrinks |
| `system.adl` (landscape) | maintainer | endpoint consistency + edge labels | every push/PR | `adl-consistency.test.ts` | declare the new edge/element or fix the drift |
| `architecture-style.adl` (stressors) | maintainer | the stressor/residue format (`[TR-E1]`) | every push/PR | `stressor-residues.test.ts` | add the missing residue as a tagged assertion before merging |

## 2. Named ownership

One stream-aligned maintainer owns the system end to end. Per-area owners (same person today, recorded so a second maintainer starts from clarity):

- **Shutdown (`TR-W2`)** and the crash matrix — the release owner.
- **Org sync (`TR-W5`, `TR-W9`, `TR-W10`)** — the durability owner.
- **Contracts (`TR-C*`)** — the compatibility owner.
- **Benchmark (`TR-P6/P7` pending, budget file)** — the performance owner.

**Agents** are contributors with a bounded scope, never approvers: they may not approve their own exemptions, may not remove or weaken tests to make the build pass (`[TR-Q2]`, `[TR-Q4]`, `[TR-Q5]` enforce the mechanical part), and a generated fitness function ships only with a known-passing and a known-failing fixture that demonstrate it can both pass and fail.

## 3. Dispositions for a failed assertion

1. **Fix the implementation** — the default; the architecture was right, the code drifted.
2. **Revise the architecture** — the rule was wrong or the world changed: edit the ADL *and* the enforcing test in the same change, with the reasoning recorded here or in a BACKLOG entry.
3. **Explicit, time-bounded exemption** — record it as a `DEFERRED` entry in `backlog-and-plans/BACKLOG.md` **with an Expiry date** (the legend in that file). An expired entry is a Fail at the next REVIEW pass, not an indefinite deferment.

A newly introduced pre-code objective may temporarily live as `it.fails('[TR-…] …')` (sanctioned by `docs/SPEC-DRIVEN.md`); a release-gating failure must never be parked there. REVIEW.md tracks any `it.fails` ID older than one release cycle.

## 4. Cadence

| Check class | When |
|---|---|
| Static + structural + contract + crash-safety gates | every push/PR (`mutation.yml`) |
| Smoke benchmark (budget-enforced) | every push/PR (`benchmark-smoke` job) |
| Full 20k benchmark | weekly schedule + `workflow_dispatch`, before a release (RELEASE-SMOKE-TEST §10) |
| Trend metrics (QUALITY.md refresh, DORA, NDQMS) | per release, or quarterly — whichever comes first (WP-5) |
| REVIEW.md pass | every release and at major architecture changes |

## 5. Governance boundary

The stable governance boundary for this repository is the `mutation.yml` workflow: everything load-bearing fails there, on the same SHA that `release.yml` is allowed to publish. The shipped spec-driven MCP tools (`validate_architecture`, `index_architecture`) expose the same governance model to users' own repositories — the tool is its own dogfood.

## 6. Reevaluation triggers

Reopen the architecture conversation when any of these changes — not on a calendar: the deployment model (a second deployable, a hosted variant), vault scale (multi-GB vaults, a server DB), the maintainer count, a second consumer of the MCP tools or the org memory format, or a new release channel. The N/A register in PLAN §2 lists what each trigger reopens.