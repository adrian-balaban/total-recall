# 🏦 Banking readiness — implementation plan

Execution plan derived from [banking-environment-requirements.md](banking-environment-requirements.md). That document says *what's missing*; this one says *what to build, in what order, and what can run in parallel*.

Baseline: total-recall **v1.0.135**, 643 unit tests + 20 integration tests green, **real mutation score 68.28%** (above the 65% break gate — see the repo-root `BACKLOG.md`: up from 59.51% via `vault-scan-reconcile.test.ts`, commit `7d978a7`; the ~24.6% figure in earlier drafts predates the mutation-hardening pass). The verification gate is now GitHub Actions only (`.github/workflows/mutation.yml`: `npm audit` + typecheck + build + Stryker); the local `npm run release:build` script was removed in v1.1.19, `dist/` is gitignored and CI-built, and the plugin is distributed solely through the marketplace's `release` branch.

Sizing is relative (S = hours, M = days, L = weeks) and deliberately coarse — treat it as ordering information, not a schedule.

---

## 🔨 Code changes required (consolidated)

One row per code change implied by the phases below. Governance/paperwork items (Phase 0) and runbook-only items are omitted — this is the engineering change list. Cross-references the phase rows for rationale, ordering, and dependencies.

| File(s) | Change | Phase | Size |
|---------|-------|-------|------|
| `hooks/scripts/extract-and-store-memories.sh`, `src/paths.ts` | Gate the PreCompact transcript hook behind `enableTranscriptExtraction` (default `false`); exit `{"continue":true}` when unset | 1.1 | S |
| `install.sh`, `INSTALL.md` | Add a `--banking` install profile: transcript off, `orgRepo` unset, TF-IDF-only (no HF download, no `better-sqlite3` native build) | 1.2 | M |
| `hooks/scripts/build-memory-index.sh`, `load-memory-index.sh` | Injection-fence injected context: untrusted-data delimiters, strip instruction-shaped text, cap per-entry length | 1.7 | M |
| `.github/workflows/`, `package-lock.json` | `npm audit` CI gate on high/critical (`--omit=dev`); `npm audit fix` for `tar`/`protobufjs`; register `sharp` as accepted risk | 1.3 | S |
| `.github/workflows/`, `hooks/scripts/*.sh`, `scripts/*.mjs` | `shellcheck` + Semgrep CI on the shell surface; fix or justify each finding (incl. `node -e` interpolations) | 1.4 | M |
| Repo settings | Commit signing + branch protection on `main` (this *is* the release gate under git-subdir distribution) | 1.5 | S |
| `INSTALL.md`, ops runbook | Document version pinning + internal-fork sync process so `claude plugin update` can't pull unreviewed upstream | 1.6 | S |
| `src/tools/store.ts`, `src/tools/mutate.ts`, `hooks/scripts/store-learning.mjs` | Run `privacy-filter.ts` on **every** write (not just org sync); `redactOnWrite: 'block'\|'redact'\|'off'`; log every decision | 2.1 | M |
| new `src/audit.ts`, all of `src/tools/` | Append-only JSONL audit log covering **reads + writes**, tamper-evident, shipped to SIEM (does not swallow errors like `journal.ts`) | 2.2 | L |
| `src/types.ts`, `src/frontmatter.ts`, `src/tools/store.ts`, `scripts/sync-org-memory.mjs` | Add `classification` (Public/Internal/Confidential/Restricted) to frontmatter; block org push above configured ceiling; drive retention | 2.3 | M |
| `src/tools/query.ts`, `src/tools/mutate.ts`, runbook | Give `prune_memories` an opt-in delete mode; retention policy by classification; script the org-vault git-history purge path (GDPR Art. 17) | 2.4 | M |
| `INSTALL.md`, ops runbook | Document/implement backup of `~/.total-recall/` (sits outside endpoint-backup folders) | 2.5 | S |
| `scripts/sync-org-memory.mjs`, `hooks/scripts/pull-org-vault.sh` | Pluggable git transport: generic remote + system credential helper (drop `gh auth token`), HTTPS proxy, custom CA bundle | 3.1 | M |
| `src/embeddings.ts`, `install.sh` | Offline embedding model: `modelPath` → local directory, pinned hash, sourced from internal artifact repo; keep TF-IDF-only fallback | 3.2 | M |
| decision record, possibly `src/persistence.ts` | Encryption at rest: decide FDE-as-compensating-control (fast) vs encrypted-vault mode (full); record in threat model | 3.3 | S/L |
| `install.sh`, `INSTALL.md` | Verify `--banking` installs with zero native builds; ship prebuilt `better-sqlite3` binaries if vector search is later needed | 3.4 | M |
| `hooks/hooks.json`, `scripts/sync-org-memory.mjs` | Review-gate org memories: MR flow instead of auto-push-on-`store_memory`; signed commits + branch protection on the org vault | 4.2 | M |
| `src/tools/store.ts`, `src/tools/mutate.ts`, `scripts/sync-org-memory.mjs` | Real access control: derive identity from git/SSO push auth, drop trust in the `author` frontmatter string | 4.3 | L |
| `src/persistence.ts` | Multi-writer safety: `flock` (or CAS) around `index.json` writes, or persist `accessCount`/`lastAccessed` into frontmatter | 4.4 | M |
| `scripts/sync-org-memory.mjs`, `src/privacy-filter.ts` | Enforce the classification ceiling (0.9) on the org-sync path: block + log above-ceiling memories | 4.5 | M |
| runbook, `scripts/` | Org-vault erasure runbook: tested history-rewrite procedure + notification to clone holders (extends 2.4) | 4.6 | M |
| `.github/workflows/`, `src/__tests__/` | Raise the mutation score to a defensible CI gate (already 68.28% post `vault-scan-reconcile`; persistence 58.9% is the weakest *pure-logic* module, lowest vectorStore/embeddings are partly structural native-boundary NoCoverage) | 5.1 | L |
| `hooks/scripts/` (integration coverage) | Automated tests for the shell surface (highest-privilege, currently near-zero coverage), added as part of 1.4 | 5.2 | M |

**Count: 22 distinct code changes** across 6 phases (governance/paperwork items in Phase 0 excluded). The `src/` changes cluster in Phases 2 (data protection) and 4 (shared-vault hardening); Phase 1 is predominantly hooks/scripts + CI config; Phase 3 is deployment-fit plumbing.

---

## 🎯 Scope: team-shared — decided

The target is a **team deployment with the shared org vault enabled**. That resolves the scope question and has three consequences:

1. **Phase 4 is mandatory, not conditional.** The prompt-injection channel (blocker #6), org access control, review-gating, and multi-writer safety are all in scope. This is roughly half the total engineering.
2. **The org vault stays switched off until Phase 4 lands.** Ship the pilot personal-only, then enable `orgRepo` as a deliberate, separately-approved step. Turning on a shared, auto-pulled, auto-injected vault before 4.1/4.2 exist is the single riskiest thing in this plan.
3. **Identity and lifecycle become real requirements.** A shared vault has joiners/movers/leavers, and a leaver's access to the org repo must be revocable — which the current `author`-string model cannot express.

The sequencing below reflects this: 4.1 (injection fencing) is pulled forward into Phase 1 because it is small, cheap, and blocks the most dangerous capability.

---

## 0️⃣ Phase 0 — Decisions and long-lead paperwork (start day one, no code)

These gate nothing technically but gate *approval*, and they run on weeks-to-months timelines. Starting them last is the most common way this kind of rollout slips.

| # | Item | Owner | Size |
|---|---|---|---|
| 0.1 | ~~Scope decision~~ — **resolved: team-shared** (see above) | — | done |
| 0.2 | Name the owning team; agree the internal-fork model and CVE patch SLA | Eng management | S |
| 0.3 | Open vendor risk assessment: Anthropic API | Procurement / TPRM | L |
| 0.4 | Open vendor risk assessment: HuggingFace model artifact | Procurement / TPRM | L |
| 0.5 | Register the AI use case; EU AI Act classification record | AI governance | M |
| 0.6 | Open the software-approval / endpoint-policy request | IT / Endpoint | L |
| 0.7 | **Provision the org vault repo** on the internal git host: named owner, access group, branch protection, signed commits required | Eng + IT | M |
| 0.8 | **Agree the joiner/mover/leaver process** for org vault access, and what happens to a leaver's contributed memories | Eng management + Security | M |
| 0.9 | **Agree the classification ceiling** for the org vault — the highest data class allowed in a shared developer memory store (drives 2.3) | Data governance | M |

---

## 1️⃣ Phase 1 — Stop the bleeding (config and CI; smallest change, largest risk reduction)

The goal of this phase is that an unmodified install stops doing the things a reviewer will reject. Nearly all of it is gating and defaults, not new subsystems.

| # | Task | Touches | Size |
|---|---|---|---|
| 1.1 | **Disable the PreCompact transcript hook by default.** Gate `extract-and-store-memories.sh` behind a config flag (`enableTranscriptExtraction`, default `false`); exit cleanly with `{"continue":true}` when unset. Fixes blocker #1. | `hooks/scripts/extract-and-store-memories.sh`, `src/paths.ts` (config schema) | S |
| 1.2 | **Add a `--banking` install profile.** Sets `enableTranscriptExtraction: false`, **`orgRepo` unset (org vault off until Phase 4 lands)**, TF-IDF-only search (no HF download, no `better-sqlite3` native build). Sidesteps blockers #1 and #4 and the native-compile endpoint issue in one switch. | `install.sh`, `INSTALL.md` | M |
| 1.7 | **Injection-fence the injected context** (pulled forward from 4.1). Wrap `.index-cache.txt` content in explicit untrusted-data delimiters, strip instruction-shaped text, cap per-entry length. Small change, and it must exist *before* any org vault is ever switched on. Fixes blocker #6. | `hooks/scripts/build-memory-index.sh`, `load-memory-index.sh` | M |
| 1.3 | **`npm audit` CI gate.** Fail the build on high/critical in `--omit=dev`. Run `npm audit fix` for `tar`/`protobufjs` now; register `sharp` as an accepted risk with a review date. Partially fixes blocker #5. | `.github/workflows/`, `package-lock.json` | S |
| 1.4 | **Static analysis on the shell surface.** `shellcheck` + Semgrep over `hooks/scripts/*.sh` and `scripts/*.mjs` in CI. Fix or justify each finding — including the `node -e` interpolations in `build-memory-index.sh`. | `.github/workflows/`, hook scripts | M |
| 1.5 | **Commit signing + branch protection on `main`.** Required reviews, no force-push, signed commits. Since distribution is git-subdir, this *is* the release gate. Completes blocker #5. | Repo settings | S |
| 1.6 | **Pin the update channel.** Document version pinning so `claude plugin update` cannot pull unreviewed upstream changes; define the internal-fork sync process. | `INSTALL.md`, ops runbook | S |

**Exit criterion:** a fresh `install.sh --banking` on a clean machine performs zero outbound network calls beyond the Claude Code client itself, and CI blocks on both CVEs and shell findings.

---

## 2️⃣ Phase 2 — Data protection in code

The substantive engineering. Each item is independently shippable and independently reviewable.

| # | Task | Touches | Size |
|---|---|---|---|
| 2.1 | **Run the privacy filter on every write, not just org sync.** Wire `privacy-filter.ts` into `store_memory`, `update_memory`, and `store-learning.mjs`. Config: `redactOnWrite: 'block' \| 'redact' \| 'off'`. Log every block/allow decision. The detectors already exist and are good — this is plumbing plus policy. | `src/tools/store.ts`, `src/tools/mutate.ts`, `hooks/scripts/store-learning.mjs` | M |
| 2.2 | **Real audit log.** Append-only JSONL at a path the user cannot edit in normal operation, separate from `journal.ts`. Records actor, timestamp, action, memory key, and outcome — for **reads as well as writes** (`recall_memory`, `get_memories_by_keys`, `export_memories` are data-access events). Must not swallow errors the way the journal does. Ship to syslog/SIEM. | new `src/audit.ts`, all of `src/tools/` | L |
| 2.3 | **Data classification field.** Add `classification` to the frontmatter schema (Public/Internal/Confidential/Restricted). Enforce it: block org push above a configured ceiling, and drive retention from it. Prerequisite for DLP and cross-border controls. | `src/types.ts`, `src/frontmatter.ts`, `src/tools/store.ts`, `scripts/sync-org-memory.mjs` | M |
| 2.4 | **Verified deletion + retention.** Give `prune_memories` an opt-in delete mode; add a retention policy driven by classification; document (and script) the org-vault git-history purge path for erasure requests. Answers GDPR Art. 17. | `src/tools/query.ts`, `src/tools/mutate.ts`, runbook | M |
| 2.5 | **Backup path.** Document or implement backup of `~/.total-recall/` — it sits outside the folders endpoint backup normally covers, so laptop loss currently destroys the vault. | `INSTALL.md`, ops runbook | S |

---

## 3️⃣ Phase 3 — Deployment fit (parallelisable with Phase 2)

Making it work *inside* the bank's network and endpoint constraints. None of these depend on Phase 2.

| # | Task | Touches | Size |
|---|---|---|---|
| 3.1 | **Pluggable git transport.** Replace the `gh auth token` call with a generic remote plus the system credential helper; support GitLab/Bitbucket, HTTPS proxies, and a custom CA bundle. Fixes blocker #3 and the TLS-interception issue. | `scripts/sync-org-memory.mjs`, `hooks/scripts/pull-org-vault.sh` | M |
| 3.2 | **Offline embedding model.** Config `modelPath` pointing at a local directory; pin the artifact hash; source it from the internal artifact repo (Artifactory/Nexus). Keep TF-IDF-only as the supported fallback. Fixes blocker #4. | `src/embeddings.ts`, `install.sh` | M |
| 3.3 | **Encryption at rest — decide, then do.** Fast path: mandate full-disk encryption and document it as a compensating control. Full path: an encrypted vault mode with a key-management story. Recommend the fast path for the pilot and record the decision in the threat model. Addresses blocker #2. | decision record, possibly `src/persistence.ts` | S or L |
| 3.4 | **No-compile install path.** Verify `--banking` (TF-IDF only) installs with zero native builds; ship prebuilt `better-sqlite3` binaries if vector search is later required. | `install.sh`, `INSTALL.md` | M |

---

## 4️⃣ Phase 4 — Shared-vault hardening (mandatory — this is a team deployment)

**`orgRepo` stays unset until every item here is done and signed off.** Enabling it is its own approval gate, not a config tweak.

| # | Task | Touches | Size |
|---|---|---|---|
| 4.1 | Injection fencing — **moved to Phase 1.7**, because it must exist before the vault is ever switched on | — | — |
| 4.2 | **Review-gate org memories.** Replace auto-push-on-every-`store_memory` with a merge-request flow; require signed commits and branch protection on the org vault repo (provisioned in 0.7). A shared vault that any member can write to unreviewed is both the injection vector and the exfiltration vector. | `hooks/hooks.json`, `scripts/sync-org-memory.mjs` | M |
| 4.3 | **Real access control.** Drop the trust placed in the `author` frontmatter string; derive identity from the git/SSO identity that authenticated the push. Prerequisite for the JML process agreed in 0.8 — you cannot revoke or attribute what you cannot authenticate. | `src/tools/store.ts`, `src/tools/mutate.ts`, `scripts/sync-org-memory.mjs` | L |
| 4.4 | **Multi-writer safety.** `flock` (or CAS) around `index.json` writes, or persist `accessCount`/`lastAccessed` into frontmatter. | `src/persistence.ts` | M |
| 4.5 | **Enforce the classification ceiling** agreed in 0.9 on the org-sync path: block any memory above the ceiling from being pushed, and log the block. Builds directly on 2.3. | `scripts/sync-org-memory.mjs`, `src/privacy-filter.ts` | M |
| 4.6 | **Org vault erasure runbook.** A memory pushed to a shared repo lives in git history forever; deletion needs a documented, tested history-rewrite procedure plus notification to everyone holding a clone. Extends 2.4 to the shared case. | runbook, `scripts/` | M |

---

## 5️⃣ Phase 5 — Assurance evidence

Produced alongside the engineering, submitted at the end. Several depend on the code being final.

| # | Task | Depends on | Size |
|---|---|---|---|
| 5.1 | **Raise the mutation score to a defensible CI gate.** Real figure is now **68.28%** (above the 65% break gate; see the repo-root `BACKLOG.md`). The lowest modules are `embeddings.ts` (44.0%), `lru-cache.ts` (48.1%), `journal.ts` (37.5%), `vectorStore.ts` (55.1% — partly structural native-boundary NoCoverage), and `persistence.ts` (58.9% — the weakest *pure-logic* module and the one Phase 2.2 touches; prioritize it first). Target: keep the gate in CI and push persistence toward the pack. | Phase 2 | L |
| 5.2 | **Test the shell surface.** The hook scripts have essentially no automated tests and hold the highest-privilege code. Add integration coverage as part of 1.4. | Phase 1.4 | M |
| 5.3 | **Formal threat model** (STRIDE or LINDDUN), as a standalone versioned document with a named owner. The `privacy-filter.ts` header comments are a usable first draft of the content. | Phases 1–4 | M |
| 5.4 | **DPIA** (GDPR Art. 35): data inventory, lawful basis, storage, recipients, retention, erasure. Writing it will surface gaps — that is the point. | Phase 2 | M |
| 5.5 | **SBOM in CI** (CycloneDX or SPDX), published per release. | Phase 1.3 | S |
| 5.6 | **Licence review** of the dependency tree and of the model weights (separate licence from the code). | — | S |
| 5.7 | **Pen test** of the hook scripts and the org-sync path. | Phases 1–4 | M |

---

## 🛤️ Critical path

```
Phase 1 (1.1 → 1.2 → 1.3/1.4/1.5/1.6/1.7 in parallel)   ← fastest risk reduction
     │
     ├─► MILESTONE A: personal-only pilot, org vault OFF
     │
     ├─► Phase 2 (2.1 → 2.2 → 2.3 → 2.4)                 ← the real build
     └─► Phase 3 (3.1 / 3.2 / 3.3 / 3.4, parallel)
              │
              └─► Phase 4 (4.2 → 4.3 → 4.4 / 4.5 / 4.6)  ← gate: needs 2.3 + 3.1
                       │
                       ├─► MILESTONE B: org vault ON, team deployment
                       │
                       └─► Phase 5 (evidence, submit)

Phase 0.2–0.9 (vendor, approval, repo provisioning, JML) runs the whole time
```

Two milestones, deliberately: **A** is a defensible single-developer install that can go to a pilot group early and start generating operational evidence. **B** is the actual goal — and it is a separate approval, because switching on `orgRepo` changes the risk profile more than any other single change in this plan.

Phase 0's paperwork is the true long pole; 0.7–0.9 in particular block Phase 4 and are owned outside engineering, so chase them early. Phase 1 is a few days of work that removes most of what a reviewer would reject on sight.

## 🚧 What this plan deliberately does not do

- **No encrypted vault implementation** in the first pass — full-disk encryption plus a documented decision is the proportionate control, and building key management is weeks that buy little.
- **No shared-host / VDI deployment.** Team-shared here means *many machines syncing through a git repo*, which is what the architecture supports. Several developers driving one host is a different problem; 4.4 makes it safe but does not make it designed-for.
- **No attempt to keep the HuggingFace runtime download.** TF-IDF-only is a supported mode and removes an entire class of approval problems; vector search returns once 3.2 lands.
- **No org vault before Phase 4.** Stated twice on purpose.
