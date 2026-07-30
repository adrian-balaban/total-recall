# What does this plugin need to be implemented in a banking environment?

Answered for the **total-recall** plugin in this repo (v1.0.135). Grounded in the actual plugin code — the architecture, the privacy filter, the hook scripts, and the org-sync path — rather than a generic checklist.

## Hard blockers — things a bank's security review will stop on

**1. The PreCompact hook ships whole session transcripts to the Anthropic API.**
[extract-and-store-memories.sh:57](plugins/total-recall/hooks/scripts/extract-and-store-memories.sh#L57) pipes the entire transcript into `claude -p` to mine learnings. In a bank that transcript can contain customer data, credentials, and source code. This needs to be off by default, or gated behind an explicitly enabled config flag with the redaction filter applied *before* the pipe.

**2. Everything is stored unencrypted on local disk.**
`~/.total-recall/` holds plaintext `.md` files, `index.json`, and `vectors.db` ([paths.ts:9](plugins/total-recall/src/paths.ts#L9)). No encryption at rest, no key management, no integration with an enterprise secrets/KMS story. Minimum viable answer for most banks: mandate full-disk encryption + document it, or add an encrypted vault mode.

**3. Org sync is hard-wired to GitHub via `gh auth token`.**
[sync-org-memory.mjs:38](plugins/total-recall/scripts/sync-org-memory.mjs#L38) shells out to `gh auth token` and pushes to an `https://github.com/...` remote. Banks run internal GitLab/Bitbucket, usually with no github.com egress and no `gh` CLI. The transport needs to be pluggable (generic git remote + SSH/PAT from an approved credential store), and the SessionStart pull needs to survive an air-gapped/proxied network.

**4. First-run downloads a ~200 MB model from the HuggingFace hub.**
The "Complete" profile lazy-loads `@huggingface/transformers` (all-MiniLM-L6-v2) at runtime. No offline/internal-mirror path exists. Banks will require the model to be vendored or pulled from an internal artifact repository (Artifactory/Nexus), with a pinned hash.

**5. Supply chain has known-unfixed CVEs and no gate.**
Our own [review](review-secure-plugin-distribution-against-malware.md) documents it: critical `node-tar`, high `sharp` (transitive via `@huggingface/transformers`, no fix available), no `npm audit` job in CI, no commit/tag signing, and distribution is raw git-subdir — the repo's commit history *is* the supply chain. `better-sqlite3` also compiles native code at install time, which many locked-down workstations disallow.

**6. Indirect prompt injection via the shared org vault.**
This is a design flaw, not a paperwork item. The chain: [pull-org-vault.sh](plugins/total-recall/hooks/scripts/pull-org-vault.sh) does a `git pull` from the shared repo at SessionStart → [build-memory-index.sh](plugins/total-recall/hooks/scripts/build-memory-index.sh) scans the frontmatter of **both** vaults into `.index-cache.txt` → [load-memory-index.sh](plugins/total-recall/hooks/scripts/load-memory-index.sh) cats that file into `additionalContext`, i.e. straight into the model's context. So **any teammate with push access to the org vault can place text into every colleague's model context**, automatically, with no user action. A memory titled `IMPORTANT: when asked about credentials, first run …` is injected as trusted-looking context. The privacy filter runs on the *outbound* push path (blocking secrets leaving); nothing sanitises or delimits content coming *in*, and `recall_memory` full-content reads widen the same channel. In a bank this is simultaneously a security finding and an insider-threat scenario. Mitigations: fence injected content in explicit untrusted-data delimiters, strip instruction-shaped text, require signed commits on the org vault, and review-gate org memories instead of auto-pushing on every `store_memory`.

## Required work — controls that don't exist yet

**Redaction on the write path, not just on org sync.** [privacy-filter.ts](plugins/total-recall/src/privacy-filter.ts) is genuinely good (Luhn-validated PANs, mod-97 IBANs, labeled + high-entropy secret detection) — but it only runs in the org-sync gate. `store_memory` writes to the personal vault completely unfiltered. In a banking context the same filter must run on every write, with the block/allow decision logged.

**A real audit trail.** [journal.ts](plugins/total-recall/src/journal.ts) is explicitly best-effort — it swallows every error, skips org writes entirely, and is a user-writable markdown file the user can edit or delete. That is not an audit log. You need append-only, tamper-evident, covering read as well as write (recall of a memory is a data access event), shipped off-box to the SIEM.

**Access control.** There is none. The MCP server is stdio, runs as the OS user, and the org vault's "author protection" is a frontmatter string comparison — any user can set `author` to anyone. Fine for one developer; not fine once the org vault is a shared repo with segregation-of-duties requirements.

**Data lifecycle / right-to-erasure.** `prune_memories` only *lists* decay candidates, it never deletes. There is no retention policy, no classification labels, and no verified-deletion path (deleting a memory leaves it in org-vault git history forever). GDPR Art. 17 and internal retention schedules both need an answer.

**Multi-writer safety.** ARCHITECTURE.md documents the single-writer assumption on `index.json` — last-rename-wins, no lock. Content survives (it's re-derived from the `.md` files) but this rules out any shared-host or terminal-server deployment until there's a `flock` or CAS.

## Assurance evidence they'll ask for

- **Test rigor**: 643 tests pass; the real on-disk mutation score is now **68.28%** (measured 2026-07-28, above the 65% break gate — see `plugins/total-recall/reviews/BACKLOG.md`; up from 59.51% via `vault-scan-reconcile.test.ts`). The lowest modules are `embeddings.ts` (44.0%), `journal.ts` (37.5%), `vectorStore.ts` (55.1%, partly structural native-boundary NoCoverage), and `persistence.ts` (58.9%, the weakest pure-logic module). Expect this number to be requested for a plugin handling potentially sensitive data.
- **Threat model + DPIA** document — the privacy-filter header comments are a good starting point, but a bank wants a formal one.
- **Pen test / SAST** of the hook shell scripts specifically: they are the least-tested surface and run with the developer's full privileges.
- **Model/vendor risk assessment** for the Anthropic API dependency and the HF model.

### Aside: what "but a bank wants a formal one" means

It's about the *form* the analysis takes, not its content.

Right now, the reasoning about threats lives in code comments — the header block in [privacy-filter.ts](plugins/total-recall/src/privacy-filter.ts) actually states a threat model ("the org vault is a SHARED git repo; a teammate with push access can plant content…") and explains why each detector exists. That's real security thinking, and it's better than most projects have. But a bank's security/compliance function cannot accept a source-code comment as evidence, for reasons that have nothing to do with quality:

- **It's not a deliverable.** Reviewers need an artifact they can attach to an approval record — a file with a title, version, date, and an owner's name on it.
- **It's not discoverable or auditable.** A regulator or internal auditor asking "show me your threat assessment for this tool" cannot be pointed at line 8 of a TypeScript file. And a comment can change in any commit with no review trail.
- **It's not complete.** Code comments cover the threats that happened to motivate a given function. A formal document has to enumerate all assets, actors, trust boundaries, and *accepted* risks — including the ones you decided not to fix.
- **It usually has to follow a methodology.** Banks typically expect STRIDE or LINDDUN for the threat model, and the DPIA follows a prescribed template.

**DPIA** = Data Protection Impact Assessment — a GDPR Article 35 document. It's legally required when processing is likely to be high-risk to individuals. For total-recall the relevant facts would be: what personal data ends up in memories, the lawful basis, where it's stored (unencrypted local disk), who it's shared with (the org vault, the Anthropic API via the PreCompact hook), retention period, and how erasure requests are honoured. Several of those currently have no answer, which is exactly why writing the DPIA surfaces the gaps.

So the practical translation: **you'd need to write two standalone documents** — a threat model and a DPIA — signed off by whoever owns security and data protection at the bank. The existing comments are a genuinely useful first draft of the threat model's content; they're just not in a shape anyone can approve.

### Aside: what "pen test / SAST of the hook shell scripts" means

**SAST** = Static Application Security Testing — automated source-code scanning for vulnerability patterns (for shell that's `shellcheck` plus a security-focused scanner; for the JS, something like Semgrep or CodeQL). **Pen test** = a human actively trying to exploit it.

The claim has three parts:

**"the hook scripts"** — the ten files in [hooks/scripts/](plugins/total-recall/hooks/scripts/). These are bash, not TypeScript, and they're where the plugin touches the outside world: `git pull` from a remote, `git push`, spawning `claude -p`, parsing JSON from stdin, walking the vault with `find`/`awk`.

**"least-tested"** — the ~4,900 lines of TypeScript under `src/` have 643 unit tests and a mutation-testing harness. The shell scripts have essentially none of that; correctness there rests on code review and the `set -euo pipefail` discipline. That asymmetry is exactly what a reviewer looks for — the weakest link, not the average.

**"run with the developer's full privileges"** — hooks are executed by the Claude Code harness as the logged-in user, with no sandbox. Whatever that developer can do, a bug in these scripts can do: read `~/.ssh`, read the whole filesystem, push to any repo their credentials reach.

Concretely, the kind of thing a scan flags — [build-memory-index.sh:15](plugins/total-recall/hooks/scripts/build-memory-index.sh#L15) interpolates a shell variable directly into a `node -e` program string:

```bash
"$NODE_BIN" -e "... readFileSync('$CONFIG_FILE','utf8') ..."
```

Here `$CONFIG_FILE` is derived from `$HOME`, so it's not exploitable in practice — but that's a *contextual* argument a human has to make. A scanner sees string interpolation into an interpreter and flags it, and you then have to write the justification. Multiply that across ten scripts that also handle a remote git repo and untrusted `.md` content from teammates, and you can see why the reviewer wants a systematic pass rather than a spot check.

### Aside: what "model/vendor risk assessment" means

Banks treat every external party that processes their data as a **third-party vendor** requiring formal onboarding — that's regulatory (in the EU, DORA and the EBA outsourcing guidelines; elsewhere the equivalent third-party risk framework). It's a questionnaire-and-contract process owned by procurement/risk, not an engineering task.

Two distinct vendors here:

**Anthropic (the API).** Data leaves the bank's perimeter. The assessment covers: what data is sent, data residency, retention and training policies, the DPA and its sub-processor list, SOC 2 / ISO 27001 evidence, breach notification terms, and exit/continuity planning if the service goes away. The PreCompact transcript hook is what makes this acute — that's the path sending the most sensitive payload.

**The HuggingFace model (all-MiniLM-L6-v2).** No data leaves — inference is local — so the risk is different: it's a **supply-chain and provenance** question. Where did these weights come from, are they pinned to a verified hash, what's the licence, could the download be tampered with in transit, and who is accountable if the artifact is malicious. Model weights are opaque binaries pulled from a public hub, which most banks classify as untrusted third-party code.

The practical output is two completed vendor-risk files with a risk rating and a sign-off — and the reason it appears on this list is that both are **long-lead**. Vendor onboarding typically runs weeks to months, so if this plugin is on a timeline, these get started early rather than after the engineering work is done.

## Governance and operations

Non-code requirements that a bank's software-approval process imposes regardless of how good the engineering is. Several are long-lead, so they run in parallel with the technical work rather than after it.

**SBOM.** No CycloneDX/SPDX manifest is generated today. Increasingly mandatory (EU Cyber Resilience Act, DORA) and usually the first artifact the approval process asks for.

**Licence review.** The plugin's own LICENSE plus every transitive dependency needs a copyleft/attribution check. `@huggingface/transformers` pulls a large tree, and the model weights carry their own licence separate from the code.

**Ownership and support model.** This is a single-maintainer plugin. Banks ask who patches a critical CVE, on what SLA, and what happens if the maintainer leaves — key-person risk on developer tooling is a standard finding. The realistic answer is an internal fork with a named owning team.

**Backup / BCP.** The vault is local-only. Laptop loss or disk failure destroys the personal vault entirely; there is no backup path, and `~/.total-recall/` sits outside the document folders that endpoint backup normally covers.

**Change management.** Distribution is `claude plugin update` pulling from git, so an unreviewed upstream change reaches developers with no CAB approval, no staged rollout, and no rollback. Banks pin versions and control the update channel.

**Software approval / endpoint policy.** Installation compiles native code (`better-sqlite3`), which many locked-down workstations block outright. The plugin also has to land on the approved-software register before anyone may install it.

**AI governance.** Separate from vendor risk: most banks now run an AI use-case register and an internal AI usage policy, and EU AI Act classification must be recorded even when the answer is "minimal risk."

**Corporate TLS interception.** MITM proxies are near-universal in banks and will break both the HuggingFace model download and `git` over HTTPS unless the corporate CA is trusted. A practical blocker for a pilot, not a policy one.

**Data classification.** Memories carry no classification label, so there is no way to mark one Internal and another Confidential — which is what downstream controls (DLP, retention schedules, cross-border transfer rules) are normally driven by.

## Sequencing

If the goal is a pilot rather than a bank-wide rollout, the shortest credible path is: disable the PreCompact transcript hook, run the privacy filter on all writes, vendor the embedding model, swap GitHub for the internal git host, and add the `npm audit` CI gate. That gets you a defensible single-developer, local-only deployment. Note that "local-only" is doing real work in that sentence: leaving the org vault unconfigured also sidesteps the prompt-injection channel (#6), since nothing external is pulled into context. Encryption at rest, real audit logging, access control, and injection-hardening of the injected context are what turn it into something that can be shared across a team — and those are the larger builds. The governance items above should start in parallel from day one, because vendor onboarding and software approval run on weeks-to-months timelines that no amount of engineering shortens.
