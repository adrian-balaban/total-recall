# PLAN — README.md & README-ro.md: persona-review round 2

**Status:** rounds 1–3b applied (#29–#35, #45, #47); round 4 not run yet · **Date:** 2026-11-03, status updated 2026-11-06 · **Branch:** `main`
**Code bugs B1–B8** were filed as #36–#43: B1–B3 fixed in #44, B6 in #45, B8 in #46 (1.6.9); B4 (#39), B5 (#40) and B7 (#42) are open. T1/T2 (Cursor, Windsurf, Claude Desktop) were not run, no client available; the READMEs say so.
**Supersedes:** the round-1 plan of the same name. Its structure work shipped in #29 and its hooks in #30; this round is driven by evidence from six independent reviews of the shipped READMEs, not by a single-pass evaluation.
**Priorities, in order:** (1) each persona can install and verify from the README alone; (2) honest trust/risk information on the first screen; (3) attention hooks.
**Rules:** every claim traces to code or an existing doc; README ≤ N words (§4); EN and RO structurally identical; plan only, no file other than this one is edited by this round.

## $0 Prompt used

Run persona review round 4 of README.md and README-ro.md in this repo.

Context: rounds 1–3b are in PLAN-README-PERSONA-OPTIMIZATION.md (§1–§10).
Report only issues that are new, regressed, or still open there. Give each
reviewer the list of already-found issues from §10.4 and §10.7, so it
doesn't report them again.

Reviewers: one subagent per persona, all run in parallel.

Core personas (README.md; no source code):

1. AI developer
2. Developer using AI for augmented development
3. Team lead
4. Architect
5. Engineering manager
6. Data engineer

Extra personas (each with a focus): 7. Security / AppSec reviewer. Reads README.md and SECURITY.md as an
attacker would: prompt injection through the org vault and through
automatic capture, unsigned releases, what goes to `claude -p`,
privacy-filter bypasses, what the install path makes you trust. 8. Compliance / DPO (GDPR, data residency). Not a developer. Where personal
data goes, retention, erasure (including team-repo history and copies
on teammates' machines), and whether the docs let you fill in a
records-of-processing entry. 9. First-time newcomer / junior developer. Has never configured MCP or
edited ~/.claude/CLAUDE.md, and follows instructions literally. The
strict test of "ready to install and use": lists every term it doesn't
understand before the end of the quick start. 10. Windows-only developer. PowerShell by default, Git Bash installed, a
Windows node.exe, no WSL. Walks the Claude Code and VS Code paths and
names the shell for every step. 11. Platform / DevEx engineer. Rolls the plugin out to 100+ machines:
unattended install.sh (-y), exit codes, pinned versions, upgrades,
central config, offline or air-gapped installs (--no-vector), and the
model cache. 12. Open-source contributor. Wants to build, test and send a PR: where the
contributing path, branch model, gates and commit conventions are
documented for humans (not only in CLAUDE.md). 13. Obsidian / knowledge-management user (non-coder). Drawn by "plain
Markdown files": can the vault be opened and hand-edited outside an
IDE, and when do those edits take effect? 14. QA / test engineer. The second audience for "ADL rules → tagged tests":
tagging per framework (JUnit, pytest, Playwright, Cucumber), CI use,
and whether the quality numbers are stated in a way a tester trusts. 15. Native Romanian reader. Reads README-ro.md next to README.md for
wording, not structure: calques, term consistency, diacritics, quotes
(„…”), content drift from EN, identical code blocks, working anchors.

What each reviewer reads:

- README.md in full. The Romanian reader reads README-ro.md in full and
  README.md for comparison.
- docs/SPEC-DRIVEN.md, required for the vote.
- Any linked doc it needs (docs/\*.md, INSTALL.md, SECURITY.md,
  ARCHITECTURE.md).
- Source code: only reviewers 7, 10, 11, 12 and 14 may read source and
  install.sh, and only to check whether a doc claim holds. Their findings
  must still be about the docs. Code bugs go in a separate list.
- Ignore any CLAUDE.md injected into context.

Each report must:

- Start with FILES OPENED (mark partial reads; list any commands run).
  A report without this list fails and is re-run.
- Answer: (1) Within 30 seconds, do I know what this is and whether it's
  for me? (2) Could I install it and confirm it works using only the
  README? Where did I get stuck? (3) What can I skip, and what is missing
  that I need? Say whether it is missing from the README or from all
  docs. Cite line numbers. Mark speculation as speculation.
- Vote on the spec-driven/ADL question below, and restate the chosen
  option in words so the vote can't be mislabeled.
- End with a FINDINGS table: id | location | problem | severity | fix.

Spec-driven/ADL question: today the spec-driven workflow and the ADL tools
appear only at README.md:152 and in the docs list. The candidate line is
in §10.7 of the plan.
A) leave it where it is
B) one line near the top (At a glance or the feature list), linking to
SPEC-DRIVEN.md
C) a short section of its own (at most 5 lines) near the top
Judge it against the "only essential information" goal: does it help your
persona decide to adopt the plugin, or is it detail for later? If B or C,
propose wording.

Coordinator (you):

1. Check every reviewer claim against the repo, including source where
   needed. Record each claim as confirmed, plausible (needs a test) or
   rejected, with evidence.
2. Combine the results into a table of proposed changes: location,
   problem, personas affected, fix. Keep separate lists for doc fixes,
   code bugs, and product work (not adopted). Include the A/B/C vote
   count across all 15 reviewers and your recommendation.
3. Constraints: the first screen covers what it is, trust/risk notes,
   install, and a check that it works. Every claim can be traced to code
   or an existing doc. EN and RO keep the same structure. State the prose
   word count (code blocks excluded) before and after, and say which cuts
   pay for the additions.
4. Write this up as "round 4" in PLAN-README-PERSONA-OPTIMIZATION.md.
   Edit nothing else, and don't commit. I'll approve the changes before
   they are applied.

## §1 Method and its limits

Six subagents, one per persona (AI developer, AI-augmented developer, team lead, architect, manager, data engineer), each told to read only the 12 docs (the two READMEs, `docs/*.md`, `SECURITY.md`, `BACKLOG.md`, `plugins/total-recall/{INSTALL,ARCHITECTURE,README}.md`), never source code, and to cite line numbers. Findings below were then **checked against the repo by the coordinator** (§2); claims that did not hold were dropped.

| Reviewer         | Docs it did **not** read (or only skimmed)                             |
| ---------------- | ---------------------------------------------------------------------- |
| AI developer     | BACKLOG, SPEC-DRIVEN, ARCHITECTURE; HOW-IT-WORKS and COMPARISON partly |
| AI-augmented dev | TOOLS, SPEC-DRIVEN, ARCHITECTURE; later parts of HOW-IT-WORKS, BACKLOG |
| Team lead        | TOOLS, ARCHITECTURE, SPEC-DRIVEN (grepped only)                        |
| Architect        | TOOLS, COMPARISON, INSTALL, BACKLOG, plugin README                     |
| Manager          | BACKLOG, HOW-IT-WORKS, TOOLS, SPEC-DRIVEN, ARCHITECTURE                |
| Data engineer    | BACKLOG, SPEC-DRIVEN, COMPARISON                                       |

Consequences: the Romanian README was reviewed only structurally (all six say it mirrors the English one line for line); the architect and AI-dev views of ARCHITECTURE/SPEC-DRIVEN are thin. Two reviewers also saw the plugin's `CLAUDE.md` through context injection; findings that rest only on it are marked _outside the doc set_ and not used. **Next round must make every reviewer list the files it opened and fail the review if a required file is missing** (§6).

## §2 Coordinator verification of reviewer claims

| Claim                                                                         | Result                             | Evidence                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Three other plugins" is a miscount (manager)                                 | **Rejected**                       | `docs/COMPARISON.md:7`: three same-name projects; `mozilla-ai/cq` is listed as inspiration, not as a same-name plugin                                                                                                 |
| MCP server reports v1.6.6 (four reviewers)                                    | **Rejected as a doc defect**       | that is the installed plugin's own banner, not a document                                                                                                                                                             |
| BACKLOG says 68.28% mutation score                                            | **Confirmed, stale**               | `BACKLOG.md:31`; QUALITY.md says 81.1%                                                                                                                                                                                |
| BACKLOG calls the plugin "single-user"                                        | **Confirmed, partly stale**        | `BACKLOG.md:87,127,184`                                                                                                                                                                                               |
| INSTALL.md overclaims trust                                                   | **Confirmed**                      | `INSTALL.md:55`: "no hand-built artifact can reach you … one thing to trust" while commits, tags and the bundle carry no signature or provenance ([PLAN-SIGNED-RELEASES.md](PLAN-SIGNED-RELEASES.md))                 |
| README omits "Windows needs a Windows Node.js"                                | **Confirmed**                      | `INSTALL.md:16-18`; README says only "Git Bash"                                                                                                                                                                       |
| README "emails" blocked is imprecise                                          | **Confirmed**                      | `src/privacy-filter.ts:75-90` checks the email host against `allowedEmailDomains`; INSTALL.md:149 says "outside your allowed domain"                                                                                  |
| "Accents ignored for any Latin alphabet" is overstated                        | **Confirmed**                      | `src/tfidf.ts:90-92`: `NFKD` then every character outside `a–z0–9` becomes a separator; letters with no decomposition (ß, ł, ø, æ) split words                                                                        |
| "No database" vs SQLite `vectors.db`                                          | **Confirmed (wording)**            | README L12 says "no database"; README L119 lists `vectors.db`; `HOW-IT-WORKS` names sqlite-vec                                                                                                                        |
| Export passes through the model's context                                     | **Confirmed, missing from README** | `docs/TOOLS.md:36`                                                                                                                                                                                                    |
| Rebuilding `index.json` resets access counts                                  | **Confirmed, missing from README** | `docs/HOW-IT-WORKS.md:68` (kept only in `index.json`)                                                                                                                                                                 |
| The "Something looks off / get_stats" check is not on the quick-start path    | **Confirmed**                      | README mentions `get_stats` once, in the troubleshooting list (L185)                                                                                                                                                  |
| Cursor and Windsurf have no setup instructions                                | **Confirmed**                      | `INSTALL.md` mentions them only in its opening sentence (L3); no config path or instruction-file name exists in any doc                                                                                               |
| **Regression introduced in #30**                                              | **Confirmed**                      | the removed "Rebuilt automatically" bullet carried the warning that the **org** `index.json` is _not_ rebuilt locally and must not be edited; README L119's Derived row now implies it is (`docs/HOW-IT-WORKS.md:30`) |
| CI badge shows "CI"                                                           | **Confirmed (label)**              | it links `mutation.yml`, which is the gate (audit, typecheck, build, tests, mutation) but is named for one step                                                                                                       |
| `gh` is required for the team setup but missing from the README prerequisites | **Partly**                         | README L170 says `gh auth login` inline; `INSTALL.md:10,126` and `install.sh` (L79, L248) require `gh` authenticated; README's "elsewhere, git credentials" is not reconciled with that                               |
| Same OS username lets teammates edit each other's org memories                | **Plausible, undocumented**        | author guard compares OS username (`INSTALL.md:131`); no doc states the collision case                                                                                                                                |
| Windows native deps are fragile (manager)                                     | **Dropped**                        | speculation; no doc or code evidence read                                                                                                                                                                             |

## §3 Findings and changes, by priority

Numbers in brackets are how many of the six personas raised it.

### Priority 1 — install and verify from the README alone

| #   | Gap                                                                                                        | Fix (source for the wording)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Placement                                        |
| --- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1.1 | No verification beyond "a file appears"; `get_stats` is off the quick-start path [5/6]                     | Add to step 4: ask the assistant to call `get_stats`; it should list totals and recent errors, and `vector.enabled` (wording from `INSTALL.md:187-189`; do **not** invent exact output)                                                                                                                                                                                                                                                                                                                                                              | Quick start, Claude Code step 4                  |
| 1.2 | Generic-MCP route has no verify step and one relative path [3/6]                                           | One verify line in the `<details>` block: call `get_stats`, or read `total-recall://index`; give the plugin-folder path for `pull-org-vault.sh` / `sync-org-memory.mjs` (`~/total-recall-plugin/plugins/total-recall`)                                                                                                                                                                                                                                                                                                                               | `<details>` and Team setup step 3                |
| 1.3 | Cursor and Windsurf cannot be installed from any doc [2/6, and the support table lists them with ✅ tools] | **Requires a real test first.** Install on Cursor and on Windsurf, record the MCP config path and the instruction-file name, then document in `INSTALL.md` and link from README. The README support table now has a **Tested** column (✅ Claude Code and Gemini/Antigravity, ❌ VS Code/Copilot and the generic-MCP row); flip a row to ✅ only after its install has been run end to end                                                                                                                                                           | `INSTALL.md` (new section), README support table |
| 1.4 | Team setup has no end-to-end verify [2/6]                                                                  | Add 3 lines: A stores "remember for the team …", B starts a new session and asks. When it fails: in Claude Code the session start warns when team pushes keep failing (README L185, `check-sync-errors.sh` in `HOW-IT-WORKS.md:177`); `get_stats` shows recent errors. The sync log files are not documented anywhere, so they are not named                                                                                                                                                                                                         | Team setup                                       |
| 1.5 | `gh`, `--allowed-email-domain` and the credential rule are unexplained or inconsistent [2/6]               | **Open question, answered before PR B:** does org sync work against a non-GitHub host with plain git credentials? Facts so far: README L170 says "elsewhere, git credentials that can push"; `INSTALL.md:126` says `gh auth status` must be green; `install.sh` L248-252 only _warns_ when `gh` is not authenticated ("required only for the org vault"). Read `sync-org-memory.mjs` and `pull-org-vault.sh` for `gh` calls, then make README and INSTALL.md say the same thing. Also add one sentence on what `--allowed-email-domain` lets through | Team setup step 2                                |
| 1.6 | Step 3 (global `CLAUDE.md` edit): nothing says what breaks if skipped or how to undo [2/6]                 | Two clauses: already says "required"; add the consequence (Claude keeps its own `MEMORY.md` alongside) and "remove the block to undo"                                                                                                                                                                                                                                                                                                                                                                                                                | Quick start step 3                               |
| 1.7 | Windows Node note missing [1/6]                                                                            | One clause: "a Windows `node.exe` on PATH, not WSL-only Node" (`INSTALL.md:18`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Quick start "You need"                           |
| 1.8 | Export goes through the model's context; off-machine backup absent [1/6]                                   | One clause in Your data: "returned in the assistant's answer" (`TOOLS.md:36`); one line: copy `personal-vault/` for an off-machine backup (the local git repo is on the same disk)                                                                                                                                                                                                                                                                                                                                                                   | Your data                                        |

### Priority 2 — honest trust and risk on the first screen

The first screen (about 25 lines) is currently all reassuring; the three facts that block a team or regulated decision live 130–170 lines down [team lead, manager, architect].

**Layout change required.** Lines 1–25 are already full (badges L3, pitch L5–7, language switch L9, three bullets L11–13, comparison line L15, session-loop SVG L17, At a glance from L19). Adding 2.1–2.3 there would push them to about L24–30. PR A therefore also:

- moves the session-loop SVG below At a glance (it explains the loop; it does not decide anything);
- folds the comparison line (L15) into the "Where it lives" bullet as one clause.

That frees about six lines, so the three risk bullets land inside the first 25.

| #    | Gap                                                                                                                  | Fix                                                                                                                                                                              | Source line                      |
| ---- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 2.1  | Weak org access control is first mentioned at README L161                                                            | Add a "Risks" bullet to At a glance: org vault = anyone with push access can edit any memory, nothing reviewed                                                                   | README L161                      |
| 2.2  | "Data stays local" omits the auto-capture transcript [2/6]                                                           | Reword the bullet: files stay local; **the model provider sees what the assistant reads, and Claude Code sends the last 1 MiB of transcript to `claude -p`**                     | README L153                      |
| 2.3  | Uncapped index cost is shown only under Limits [4/6]                                                                 | One bullet in At a glance: 30–40 tokens per memory, no cap (4.4k at 100, 32k at 1,000, 162k at 5,000)                                                                            | README L191, `QUALITY.md:98-101` |
| 2.4  | Cost bullet says semantic search is "optional" but the default profile installs it                                   | Reword: "the default profile downloads a local multilingual model once (449 MB); `--no-vector` skips it"                                                                         | `INSTALL.md:22`                  |
| 2.5  | "Blocks … emails" is imprecise                                                                                       | "emails outside your allowed domains"                                                                                                                                            | `privacy-filter.ts:75-90`        |
| 2.6  | "no database" vs SQLite                                                                                              | "no database to run; an optional SQLite file holds the vectors"                                                                                                                  | README L119                      |
| 2.7  | "Accents ignored" overstated                                                                                         | README: "most accents are ignored" (soften, no detail). HOW-IT-WORKS tokenizer paragraph: add that letters with no accent-free form (ß, ł, ø, æ) split a word                    | `tfidf.ts:90-92`                 |
| 2.8  | "Releases not signed" understates: commits and tags are unsigned too, and `INSTALL.md:55` claims more than is proven | Keep "not signed"; align INSTALL.md:55 ("one thing to trust" → state that CI builds it and nothing is signed yet) until [PLAN-SIGNED-RELEASES.md](PLAN-SIGNED-RELEASES.md) ships | `INSTALL.md:55`                  |
| 2.9  | **Regression:** the org `index.json` warning was dropped in #30                                                      | Restore as one clause in the Derived row: "the org `index.json` in the team repo is not rebuilt; leave it alone"; add "access counts are reset"                                  | `HOW-IT-WORKS.md:30,68`          |
| 2.10 | Badge label                                                                                                          | Decided by the maintainer (§7 item 4)                                                                                                                                            | `.github/workflows/mutation.yml` |
| 2.11 | Same-OS-username collision                                                                                           | **In `INSTALL.md:131`, not the README:** add that two teammates with the same OS username (for example `ubuntu`) count as the same author                                        | `INSTALL.md:131`                 |

### Priority 3 — attention hooks

| #   | Hook                                                                                                                                                  | Raised by                 | Source line                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | "Design in five lines" under At a glance: flat files, derived indexes, fail-closed filter, no LLM in the search path, one-line link to the invariants | architect                 | `HOW-IT-WORKS.md:94-98`, `ARCHITECTURE.md:89-107` (replace, don't add to, "How it's built")                                                                                                        |
| 3.2 | Comparison against sharing a `MEMORY.md` in git                                                                                                       | team lead                 | needs a new row in `docs/COMPARISON.md`; source facts: search/decay (README), privacy filter (README L12), author guard (`INSTALL.md:131`); **trust model is the same** (push access) — state that |
| 3.3 | Uninstall one-liner near the top                                                                                                                      | AI-augmented dev, manager | README L186                                                                                                                                                                                        |
| 3.4 | Start latency number                                                                                                                                  | AI dev                    | `QUALITY.md:21` (99 ms median)                                                                                                                                                                     |
| 3.5 | Sample session: store → new session → recall                                                                                                          | AI-augmented dev          | README step 4 text; optional recording stays out of scope                                                                                                                                          |
| 3.6 | Tool-call example and retrieval-order cheat sheet in `TOOLS.md`                                                                                       | AI dev                    | `skills/memory-workflow/SKILL.md` order, `TOOLS.md:9-30`                                                                                                                                           |

### Documentation fixes outside the READMEs (small, independent)

| File                   | Fix                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKLOG.md:31`        | Replace 68.28% with the current score or mark the line "as of <date>"; reword "single-user" at L87/L127/L184 where it contradicts the team feature |
| `INSTALL.md:55`        | See 2.8                                                                                                                                            |
| `docs/QUALITY.md:3`    | Say "last measured at commit 0625d95; source unchanged since" (only docs changed after it)                                                         |
| `docs/HOW-IT-WORKS.md` | Tokenizer note (2.7)                                                                                                                               |
| `docs/COMPARISON.md`   | New row (3.2)                                                                                                                                      |

## §4 Word budget (N)

`N` was left open in the request. **Proposal: N = 1,950 words of prose per README** (code blocks and the collapsed install block excluded; headings, tables and links counted), RO ≤ 2,000 because Romanian runs about 2% longer. 1,900 was the first proposal; the arithmetic below shows it cannot be reached without cutting content that has no other home.

**Today:** EN 1,924, RO 1,960 (after #30).
**Additions, estimated:** Priority 2 ≈ +130 (three At a glance bullets ≈ +70, rewordings 2.2/2.4/2.5/2.6/2.9 ≈ +60); Priority 1 ≈ +200 (eight items, 1.3 excluded). Total ≈ +330. These are estimates; each PR measures with the word-count script and reports the real figure.

**Cuts** (each must leave the fact in exactly one other file, added there first if needed, checked with `grep` in the same PR):

| Cut                                                                                                                         | Words    | Where the fact lives afterwards                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| Merge "Upgrade (other assistants)" and "Uninstall" into one bullet pointing at `INSTALL.md`                                 | −90      | `INSTALL.md:67`                                                                                                   |
| Privacy section: shorten the transcript and org-trust bullets to one line each, now that At a glance states them (2.1, 2.2) | −60      | At a glance + `SECURITY.md`                                                                                       |
| Shorten the note under Supported assistants                                                                                 | −45      | `INSTALL.md`                                                                                                      |
| Team setup step 3: move the "other assistants have no hooks" sentence to `INSTALL.md` §Org vault                            | −45      | `INSTALL.md` (add first)                                                                                          |
| Languages: drop the benchmark sentence                                                                                      | −30      | `HOW-IT-WORKS.md` §Languages                                                                                      |
| "Several sessions at once" bullet shortened to one line                                                                     | −25      | `HOW-IT-WORKS.md` (add the lock-free `index.json` note there first; BACKLOG is a roadmap, not user documentation) |
| Team setup: shorten the bold risk line's second sentence (At a glance now carries the risk)                                 | −20      | At a glance                                                                                                       |
| **Total**                                                                                                                   | **−315** |                                                                                                                   |

**Kept on purpose:** the closing line under Daily use ("Name the project in the memory…") exists only in the README and is practical advice for multi-project users.

**Actual after PR A and PR B:** EN 2,015, RO 2,028 (PR A: 1,986 / 1,998; PR B: +29 / +30 after its own cuts). The estimate of +330 was too low: the verify steps (1.1, 1.2, 1.4–1.8) cost about +165 on their own, and several planned cuts could not be taken because the removed text exists only in the README. Both figures are above N. After PR D (hooks): EN 2,037, RO 2,058 (+22 / +30; the plan asked for net ≤ 0, but the five-line design block and the uninstall move cost more than the trimmed step 2 saved). Hooks 3.3 and 3.5 were already met by existing text (the exit line now carries the uninstall command; step 4 already is a store-then-recall session). **Decision needed (§7 item 1):** raise N to about 2,050 (EN) / 2,075 (RO), or accept further cuts of README-only content.

**Original estimate (kept for the record):** about 1,924 + 330 − 315 ≈ 1,940 EN, inside 1,950. **Per-PR rule:** PR A and PR B each land at net ≤ +10 words with their own cuts; PR D (hooks) must be net ≤ 0 — 3.1 replaces "How it's built", 3.3 moves the uninstall line rather than duplicating it, 3.5 rewrites step 4 rather than adding to it.

## §5 EN / RO parity

Reviewers found no structural difference between the two READMEs (same sections, order and line count). Keep it that way:

- Same headings in the same order; heading count (`grep -c '^#'`) must match.
- Every new anchor target stays ASCII and short (`### Other assistants`, not a long heading).
- Code, the `## Memory` block and the MCP JSON stay English; links into English-only docs keep the "(în engleză)" mark.
- Run `/tmp/linkcheck`-style link and anchor verification on both files and on every doc edited (the check used in #29/#30 is reproduced in the PR description).

## §6 Delivery and acceptance

**PRs (each merged after CI is green):**

1. **A — facts and risk** (Priority 2, the §2 layout change, the §3 doc fixes including the restored org-`index.json` warning, and the Privacy/Team-setup cuts from §4).
2. **B — verify paths** (Priority 1 except 1.3), with the remaining §4 cuts. **Pre-step:** answer the 1.5 question.
3. **C — client verification**: a real install on Cursor and Windsurf (1.3) **and** a test of the generic `mcpServers` snippet in the README's `<details>` block on at least one client that uses that format (for example Claude Desktop). The snippet follows `INSTALL.md` but has never been run.
4. **D — hooks** (Priority 3), net ≤ 0 words.
5. **E — Romanian quality pass**: one reviewer reading README-ro.md as a Romanian speaker (wording, technical terms, anchors that point at English headings). Round 2 checked RO for structure only.

**Acceptance (re-run this review):**

- Re-run the six persona reviews on the merged READMEs with the prompt in the Appendix and the **required reading list**: each reviewer lists the files it opened, and the review is rejected if any of the 12 is missing.
- Pass condition per persona: can install **and** verify (not just "a file appears"); the first 25 rendered lines state the weak org access control, the transcript flow and the uncapped index cost; at least one hook reaches them without leaving the README.
- Budget: EN ≤ 1,950 and RO ≤ 2,000 prose words; headings identical; zero broken links or anchors.
- Drift: every `install.sh` flag named in README, README-ro and INSTALL.md appears in `./install.sh --help` (repo `CLAUDE.md` rule "Docs must track install.sh").

## §7 Decisions needed from the maintainer

1. **N:** the shipped READMEs are 2,015 (EN) / 2,028 (RO). Accept about 2,050 / 2,075, or choose a lower figure (that means cutting content that exists only in the README).
2. **Cursor and Windsurf:** are you able to test an install on each? Without that, PR C cannot ship and the support table must say "not verified".
3. **BACKLOG.md:** refresh the numbers in place, or mark the section dated?
4. **Badge:** keep "CI" or rename it to describe the mutation gate?
5. **Org index.json warning:** I removed it in #30 by mistake; confirm that restoring it in PR A is wanted (recommended).

## §8 Open work after PRs A, B and D

| #   | Item                                                      | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | Verify installs on **Cursor** and **Windsurf** (item 1.3) | **TODO** (needs real clients)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | On each client: clone, `./install.sh -y`, add the server to the client's MCP configuration, restart, ask for `get_stats` and store/recall a memory. Record the config path and the instruction-file name in `INSTALL.md`; flip the row in the README **Tested** column only after this passes                                                                                                                                                                                                          |
| T2  | Test the README `mcpServers` snippet                      | **Protocol level done, client level TODO**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | _Done 2026-11-03:_ `bash <clone>/plugins/total-recall/scripts/start-server.sh` over stdio with a temporary `HOME`: `initialize` OK, `tools/list` returns 22 tools, `get_stats` returns without error (server 1.6.8). This proves the command, the argument and the server; it does not prove where a given client reads its configuration. _TODO:_ the same steps as T1 on at least one client that uses the `mcpServers` format (Claude Desktop first), then document its config path in `INSTALL.md` |
| T3  | Romanian quality pass on `README-ro.md`                   | **Done, approved by the maintainer on 2026-11-03** (model-run review, 2026-11-03: number format `4,4k`, `leagă` for the verb "tie", `blochează` for "fails closed", profile names `Complete`/`Minimal` as the installer prints them, "(în engleză)" added for SECURITY.md and BACKLOG.md, tone made imperative, "best-effort" and "rollout checklist" reworded; skipped on purpose: the `## Mai mult (în engleză)` heading marker, which is structural). Original method: A Romanian reader goes through it next to the English file with this checklist: consistent technical terms (vault, hook, index, memorie, token), calques from English, diacritics, number format (1.036 vs 1,036), the "(în engleză)" marks, anchors into English headings. Output: a list of proposed edits, applied in one PR. A model-run draft is fine as a starting point; the maintainer signs off |
| T4  | Re-run the six persona reviews                            | **Done 2026-11-03, results in §9**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | On the final text, after T3 (T1/T2 do not block it if the reviewer is told that ❌ in **Tested** means "not tested"). Same personas, plus the required reading list: each reviewer lists the files it opened and the run is rejected if one of the 12 is missing. Pass condition as in §6                                                                                                                                                                                                              |
| T5  | Word budget N                                             | **Decision**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Shipped: EN 2,037, RO 2,058 (§4). Accept about 2,050 / 2,075 or choose cuts of README-only content                                                                                                                                                                                                                                                                                                                                                                                                     |

Order: T3 → T4 can proceed now; T1 and T2 (client level) run whenever a client is at hand and feed the **Tested** column.

## §9 T4 results (2026-11-03, on `main` at `54975aa`)

Six reviewers, one per persona; each read **all 12 docs in full** (all six confirmed; `CLAUDE.md` excluded).

| Persona          | a. install + verify from README                                             | b. three risks in the first 25 lines                                           | c. hook |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------- |
| AI developer     | PASS (Claude Code)                                                          | PASS                                                                           | PASS    |
| AI-augmented dev | **FAIL** (Cursor: no config path, no instruction-file name)                 | PASS, borderline (long bullets wrap on GitHub; risks land near screen line 27) | PASS    |
| Team lead        | PASS                                                                        | PASS                                                                           | PASS    |
| Architect        | PASS                                                                        | PASS                                                                           | PASS    |
| Manager          | PASS                                                                        | PASS                                                                           | PASS    |
| Data engineer    | **FAIL** (export "once you save it" has no how; no backup/round-trip check) | PASS                                                                           | PASS    |

Round 2 had zero full PASS on criterion b; now 6/6.

### Verified findings to fix (docs only)

Each was checked in the repo by the coordinator; reviewers that raised it in brackets.

| #   | Where                                   | Problem                                                                                                                                                                            | Evidence                                                 | Fix                                                                                                                                                                                             |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | README L62 / RO                         | "Per-assistant steps" in INSTALL.md, but INSTALL.md has only Gemini, VS Code, Codex [AI-aug]                                                                                       | `INSTALL.md` headings                                    | Say which clients have steps; others use the generic block (until T1)                                                                                                                           |
| F2  | INSTALL.md L9-11                        | `claude` CLI described as "only for Claude Code" and `agy` as "only for `--gemini`" [AI dev, manager]                                                                              | `HOW-IT-WORKS.md:186`, `hooks.gemini.json`, `install.sh` | Gemini/Antigravity **requires `agy`**; `claude` is optional there and used only for automatic capture (corrected by the maintainer after a first draft that made `claude` a Gemini requirement) |
| F3  | INSTALL.md L10                          | `gh` listed as required for the org vault; L126 says only for GitHub [4 reviewers]                                                                                                 | `INSTALL.md:126`, scripts fall back to `git`             | Align L10 with L126                                                                                                                                                                             |
| F4  | INSTALL.md L152                         | "nothing leaves the host" for the personal vault, while the model provider sees what the assistant reads [3 reviewers]                                                             | README L19, L157                                         | Say the embedder is local; the model provider still sees recalled memories and the transcript                                                                                                   |
| F5  | README L197 / RO                        | "cannot damage memory files": `.md` writes are plain `writeFileSync` (not atomic) [architect]                                                                                      | `store.ts:319`, `mutate.ts:110,239`, `BACKLOG.md:60-70`  | Drop "cannot damage"; keep "each memory is its own file" and the staleness note                                                                                                                 |
| F6  | COMPARISON.md L18                       | "Bounded local memory" contradicts "no size cap" [architect]                                                                                                                       | README L21                                               | "Curated local memory"                                                                                                                                                                          |
| F7  | `plugins/total-recall/README.md` L3, L7 | Lists 3 clients; says the root README holds layout, tools, hooks, config, Obsidian (now in `docs/`) [5 reviewers]                                                                  | README L201-208                                          | Update the client list and the link list                                                                                                                                                        |
| F8  | BACKLOG.md L25-26, L101                 | "highest-coverage file (82.3%)" stale; "single-instance per user session" stale [4 reviewers]                                                                                      | `QUALITY.md:31`; README L197, `HOW-IT-WORKS.md`          | Refresh both                                                                                                                                                                                    |
| F9  | README L21 / RO L20                     | "4.4k at 100" was measured on 105; 1,000/5,000 figures use the low 32-token rate [5 reviewers]                                                                                     | `QUALITY.md:96-101`                                      | "about 4.4k at 105 memories, 32–40k at 1,000, 162–200k at 5,000"                                                                                                                                |
| F10 | README L121, L161 / RO                  | Export presented as the exit/move path; it passes through the model's context and drops access counts, confirmations, flags, `supersededAt` and `.superseded/` [data eng, manager] | `TOOLS.md:46,70`                                         | Say so; recommend copying `personal-vault/` (keeps frontmatter fields) and `config.json`                                                                                                        |
| F11 | README L119 / RO                        | `.index-cache.txt` "rebuilt automatically": only the SessionStart hook writes it (hookless clients never do) [data eng]                                                            | `HOW-IT-WORKS.md:20,175`                                 | "rebuilt at session start (Claude Code, Gemini)"                                                                                                                                                |
| F12 | SECURITY.md L27-28 vs INSTALL.md L134   | "protect its default branch" vs "do not require pull requests" on the sync branch [team lead, manager]                                                                             | both lines                                               | Say: protect the default branch; leave the sync branch (`knowledge`) without required PRs, restrict push instead                                                                                |
| F13 | SPEC-DRIVEN.md L35                      | Recommends an absolute path, then shows `path="."` [AI dev]                                                                                                                        | L34-35                                                   | Use an absolute path in the example                                                                                                                                                             |
| F14 | INSTALL.md L77                          | "with agent plugins on, … hooks load" stated as fact; README marks VS Code as no capture / manual sync [AI-aug]                                                                    | README L141                                              | Add "not verified end to end"                                                                                                                                                                   |
| F15 | HOW-IT-WORKS §Configuration             | Changing `orgVault` (or `personalVault`) needs a restart, else org sync silently stops [architect]                                                                                 | `BACKLOG.md:196-207`                                     | One sentence: restart after changing vault paths                                                                                                                                                |
| F16 | README L140 / RO, HOW-IT-WORKS L186     | Gemini sessions' transcripts go to Claude through `claude -p` (a second provider) [AI dev, manager]                                                                                | `HOW-IT-WORKS.md:186`                                    | State it in the Gemini row note or the privacy bullet                                                                                                                                           |
| F17 | README-ro.md L13-14                     | Missing blank line before `## Dintr-o privire`; `'free'` instead of "'free'" on L13 [5 reviewers / coordinator]                                                                    | file                                                     | Fix both                                                                                                                                                                                        |

### Not adopted here (product work, not README wording)

- Tool contracts (parameters, return shapes) in `TOOLS.md`; an export schema version; pinning versions and the model download; a per-compaction cost figure; a retrieval-quality eval (already in `BACKLOG.md`).
- Atomic `.md` writes (already `BACKLOG.md:60-70`); an off switch for automatic capture; a version check on files shared by teammates (the org `index.json`).

### Remaining after F1–F17

T1 and T2 (client-level) still decide criterion a for Cursor/Windsurf; the data-engineer FAIL is closed by F10.

**Applied 2026-11-03 (uncommitted on `main`):** F1–F17, in README, README-ro, INSTALL.md, SECURITY.md, SPEC-DRIVEN.md, COMPARISON.md, HOW-IT-WORKS.md, BACKLOG.md and the plugin README.

## §10 Round 3 (2026-11-04, on `main` at `ff0b041`)

**Status:** proposed, nothing applied. **Scope:** issues that are new, regressed, or still open after F1–F17, plus one question: should the spec-driven/ADL capability move toward the top of both root READMEs?

### §10.1 Method

Six subagents, one per persona, ran in parallel. Each read README.md in full and any linked doc it needed (no source code), had to list the files it opened, and was given the round-2 resolved list so it would not report those again. Every report carried the file list, so none was rejected. The coordinator then checked each claim against docs **and source** (§10.2).

| Reviewer         | Opened in full                                       | Partial or grep only                                               |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| AI developer     | README, SPEC-DRIVEN, TOOLS, COMPARISON, HOW-IT-WORKS | INSTALL; QUALITY, SECURITY, ARCHITECTURE (headings)                |
| AI-augmented dev | README, SPEC-DRIVEN                                  | INSTALL, HOW-IT-WORKS, TOOLS                                       |
| Team lead        | README, SPEC-DRIVEN, SECURITY, INSTALL               | HOW-IT-WORKS                                                       |
| Architect        | README, SPEC-DRIVEN, ARCHITECTURE                    | TOOLS; HOW-IT-WORKS, INSTALL, SECURITY, QUALITY, COMPARISON (grep) |
| Manager          | README, SECURITY, SPEC-DRIVEN                        | INSTALL, QUALITY                                                   |
| Data engineer    | README, SPEC-DRIVEN, TOOLS                           | HOW-IT-WORKS, QUALITY, INSTALL                                     |

Limits: the reviewers read only README.md. The coordinator checked README-ro.md against every confirmed defect (each one is present in RO too) and found two RO-only typos (R1). The architect is the only reviewer that read ARCHITECTURE.md in full.

### §10.2 Coordinator verification

| Claim (reviewer)                                                                                                    | Result                                                | Evidence                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "30–40 tokens per memory" does not match 4.4k at 105 (AI dev)                                                       | **Rejected**                                          | `QUALITY.md:101` adds a fixed header of ~250 tokens: (4,400 − 250) / 105 ≈ 40                                                                                                                                                                                    |
| **Regression:** nothing says how projects are kept apart in one vault (AI-aug, data eng)                            | **Confirmed, regression**                             | The line "All projects share one vault. Name the project in the memory…" that §4 kept on purpose was removed in `4f6b213` (2026-11-03). No tool has a project filter (`src/tools/`), and no doc mentions it                                                      |
| README L160: teammates' memories arrive "marked as reference data" (team lead)                                      | **Confirmed, misstatement**                           | `SECURITY.md:16-25`: only the index entries are framed; full bodies from `recall_memory` / `get_memories_by_keys` and guardrails are not, and `orgInjection` does not cover them. Same at RO L166                                                                |
| Team setup L177 `./install.sh` does not work for Claude Code users (team lead, manager)                             | **Confirmed**                                         | the script lives in the plugin cache (L43)                                                                                                                                                                                                                       |
| L167 does not warn against required PRs on `knowledge` (team lead)                                                  | **Confirmed**                                         | `INSTALL.md:134`, `SECURITY.md:28-29`                                                                                                                                                                                                                            |
| No way documented to stop team sync, or to purge a leaked item from history (team lead)                             | **Confirmed, all docs**                               | `HOW-IT-WORKS.md:76` shows `orgRepo` only; `INSTALL.md:136` says "ordinary git commits", which keep the item in history                                                                                                                                          |
| At a glance L19 omits "cannot be switched off yet" (manager)                                                        | **Confirmed**                                         | stated only at L157, L198                                                                                                                                                                                                                                        |
| "Personal vault is not encrypted" only in INSTALL (manager)                                                         | **Confirmed**                                         | `INSTALL.md:152`                                                                                                                                                                                                                                                 |
| SECURITY.md covers only the org vault (manager)                                                                     | **Confirmed**                                         | `SECURITY.md` ends at L31; transcript, unsigned releases, model download and plaintext vault are absent                                                                                                                                                          |
| README L69 omits the `--vscode` flag (AI-aug)                                                                       | **Confirmed**                                         | flag only in the L141 table and `INSTALL.md:80`                                                                                                                                                                                                                  |
| README L40 omits that setup registers the MCP server (AI-aug)                                                       | **Confirmed**                                         | `INSTALL.md:47` says it does                                                                                                                                                                                                                                     |
| Without the `claude` CLI, `install.sh` warns that it skipped MCP registration; README L69 doesn't say this (AI dev) | **Confirmed**                                         | `INSTALL.md:67`                                                                                                                                                                                                                                                  |
| "Use the prompt" (L141-142) names no prompt (AI-aug)                                                                | **Confirmed**                                         | `extract-session-learnings` is named only at `INSTALL.md:187`                                                                                                                                                                                                    |
| No "server not loaded" check in the quick start (AI-aug)                                                            | **Confirmed**                                         | `/mcp` / `claude mcp get total-recall` only at `INSTALL.md:104`, in a developer section                                                                                                                                                                          |
| Model download "once" vs "on first use" (AI-aug)                                                                    | **Confirmed (wording)**                               | `install.sh:212`: the model downloads on first semantic search, not during install                                                                                                                                                                               |
| Copilot instruction-file name missing (AI-aug)                                                                      | **Confirmed missing; name not verified**              | no doc names one. `.github/copilot-instructions.md` is Copilot's usual file, but add it only after the T1-style client test                                                                                                                                      |
| ADL syntax not documented anywhere (architect, AI-aug)                                                              | **Confirmed**                                         | the accepted forms exist only in `src/spec/adl-parse.ts:1-5,67-76`: header directives, `DEFINE <KIND> <Name> AS <id>` nested by indentation, `DEFINE CONST`, `DEFINE COMMUNICATION … TO … AS …`, `FOREACH … DO … END`, `ASSERT(…)` with an optional `# [ID]` tag |
| Element ID comes from the name or from the `AS` alias? (architect)                                                  | **Confirmed ambiguous in the doc; source says alias** | `adl-parse.ts:69` captures the `AS` id                                                                                                                                                                                                                           |
| Re-running `index_architecture` is unspecified (architect)                                                          | **Confirmed in the docs**                             | the tool description says "stores or updates … re-running on unchanged files writes nothing" (`src/tools/architecture.ts:154`); SPEC-DRIVEN doesn't say so                                                                                                       |
| Repo gate catches unknown IDs, shipped tool does not (architect)                                                    | **Confirmed**                                         | `spec-architecture.test.ts:62-63` fails on orphan IDs; `SPEC-DRIVEN.md:41` says the tool does not report them; L49 doesn't mention the difference                                                                                                                |
| "ADL" never expanded or defined in README (manager, architect)                                                      | **Confirmed**                                         | README L152, L205; first explanation at `SPEC-DRIVEN.md:45`                                                                                                                                                                                                      |
| 5 ARCHITECTURE invariants carry no TR tag (architect)                                                               | **Confirmed**                                         | `ARCHITECTURE.md:91,100,104,106,107`                                                                                                                                                                                                                             |
| `config.json` vault paths may break a move to another home dir (data eng, speculation)                              | **Rejected for the default setup**                    | paths are absent by default and resolve under `$HOME`; set paths expand `~` (`src/paths.ts:82-88`). Only an absolute custom path needs editing; the missing restore steps are confirmed                                                                          |
| Tool schemas, an export schema version                                                                              | **Not adopted (already decided)**                     | §9 "Not adopted here"                                                                                                                                                                                                                                            |
| No comparison with general memory servers (mem0, Zep, Letta, reference server) (AI dev)                             | **Confirmed, outside README**                         | `COMPARISON.md` covers same-name plugins, cq and `MEMORY.md` only                                                                                                                                                                                                |
| Token cost of the 22 tool definitions not stated (AI dev, AI-aug)                                                   | **Confirmed missing; unmeasured**                     | no figure in any doc. Measure it with `tools/list` before writing a number                                                                                                                                                                                       |

### §10.3 Spec-driven / ADL question

**Vote: B 6, A 0, C 0.** All six agreed for the same two reasons. First, it doesn't decide adoption for five of the six personas, so a section of its own (C) would push the risks down. Second, the five architecture tools are **on by default** (`TOOLS.md:32`), which affects every user's tool list. That makes it something to know before adopting, and today it shows up only at L152. For the architect it does decide adoption: "a memory plugin alone is a commodity; tying decisions to assertions and tests is not."

**Recommendation: B**, as a fourth bullet after "Cost" (L13), with the second sentence of L152 removed so it appears in only two places (top and the docs list). Merged from the six drafts, defining ADL in passing and saying what the check does and doesn't do:

> - **For architects (optional, on by default):** link decisions to requirement IDs, and check that every rule in your ADL files (plain-text architecture rules) has a test carrying its ID; coverage only, your CI runs the tests. Five of the 22 tools; `"specDriven": {"enabled": false}` removes them. [Spec-driven work](../docs/SPEC-DRIVEN.md).

RO:

> - **Pentru arhitecți (opțional, pornit implicit):** leagă deciziile de ID-uri de cerințe și verifică faptul că fiecare regulă din fișierele ADL (reguli de arhitectură în text simplu) are un test care îi poartă ID-ul; se verifică doar acoperirea, testele le rulează CI-ul tău. Cinci din cele 22 de tool-uri; `"specDriven": {"enabled": false}` le elimină. [Lucru spec-driven](../docs/SPEC-DRIVEN.md) (în engleză).

**Placement check:** the bullet adds about two rendered lines, so the three risk bullets move from L19–21 to about L21–23, still inside the first 25. §9 noted that long bullets already wrap to about screen line 27 on GitHub, so check the rendered page after the change.

**SPEC-DRIVEN.md must back the promise** (S1–S6 below). The README line is only honest if the walkthrough runs without guessing.

### §10.4 Proposed changes

Numbers in brackets: personas that raised it. EN and RO get the same change.

**Priority 1: install, verify and use from the README alone**

| #   | Location                    | Problem                                                                                                           | Fix                                                                                                                                                                                    |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Daily use (after the table) | **Regression:** project scoping unexplained [AI-aug, data eng]                                                    | Restore: "All projects share one vault. Name the project in the memory ("in the billing service, …") to keep projects apart in search results."                                        |
| G2  | Team setup step 2, L177     | `./install.sh` doesn't resolve for Claude Code users [team lead, manager]                                         | "Each teammate re-runs the setup script from Quick start step 2 with these flags" and show the L43 command with `--org-repo … --allowed-email-domain …`                                |
| G3  | Team setup step 1, L167     | Required PRs on `knowledge` silently break sync [team lead]                                                       | One clause: "don't require pull requests on it: sync pushes directly"                                                                                                                  |
| G4  | Quick start step 4, L58     | No check when the tools never load [AI-aug]                                                                       | "If the tools are missing, run `/mcp` and look for `total-recall`"                                                                                                                     |
| G5  | `<details>` block, L69      | VS Code users run the wrong command; the "skipped MCP registration" warning looks like a failure [AI-aug, AI dev] | "(VS Code: `--vscode`; without the `claude` CLI, a warning that MCP registration was skipped is expected)"                                                                             |
| G6  | Support table L141-142      | "use the prompt" doesn't name it [AI-aug]                                                                         | "use the `extract-session-learnings` prompt"                                                                                                                                           |
| G7  | Quick start step 2, L40     | Doesn't say setup registers the MCP server [AI-aug]                                                               | "creates the vaults, registers the MCP server and builds the index" (`INSTALL.md:47`)                                                                                                  |
| G8  | Your data, L121             | A move has no order of steps [data eng]                                                                           | "To move: install, copy `personal-vault/` and `config.json` into `~/.total-recall/`, re-run the setup script, then _rebuild the index_." Default paths are portable (`paths.ts:82-88`) |

**Priority 2: honest trust and risk**

| #   | Location               | Problem                                                                                 | Fix                                                                                                                                                         |
| --- | ---------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Privacy L160 (RO L166) | **Misstatement:** says teammates' memories are framed; only index lines are [team lead] | "Teammates' entries in the index are marked as reference data, not instructions; full memories you recall are not, and `orgInjection` does not cover them." |
| T2  | At a glance L19        | Automatic capture can't be switched off; only stated at L157/L198 [manager]             | Add "(cannot be switched off yet)" after `claude -p`                                                                                                        |
| T3  | At a glance L20        | Mixed-assistant teams find out at L141 that sync is manual for them [team lead]         | Add "Team sync is automatic only in Claude Code and Gemini/Antigravity."                                                                                    |
| T4  | Privacy L156           | Plain-text vault only in INSTALL [manager]                                              | "…blocks pushes. The files are not encrypted."                                                                                                              |
| T5  | Cost L13               | "downloads … once" hides when [AI-aug]                                                  | "downloads … on the first semantic search" (`install.sh:212`)                                                                                               |

**Priority 3: spec-driven / ADL (§10.3) and the doc behind it**

| #   | Location             | Fix                                                                                                                                                                 |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0  | README L13 + L152    | The B bullet; remove L152's second sentence                                                                                                                         |
| S1  | SPEC-DRIVEN L1-3     | Define ADL on first use (one clause; the full paragraph stays at L45)                                                                                               |
| S2  | SPEC-DRIVEN L45      | "What the indexer reads": the forms in `adl-parse.ts:1-5`, plus the tag format `# [ID]`                                                                             |
| S3  | SPEC-DRIVEN L19, L37 | Make name and alias differ (`DEFINE COMPONENT DomainCore AS domain`) and say the ID comes from the `AS` alias                                                       |
| S4  | SPEC-DRIVEN L34-35   | Say re-indexing updates in place and writes nothing on unchanged files; add a "see a failure" step: remove the tag, validate, restore                               |
| S5  | SPEC-DRIVEN L41, L49 | State that the repo's own gate also fails on unknown IDs and that the shipped tool does not                                                                         |
| S6  | SPEC-DRIVEN L69      | Start with "On by default." (`TOOLS.md:32`); name the parameter in `trace(id="ORD-S1")` at L36 (check the real parameter name in `src/tools/architecture.ts` first) |

**Cuts (to pay for the additions)**

| #   | Cut                                                                                                                                                                                                                                                                                                         | Prose words | Where the fact lives afterwards                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------- |
| C1  | `## Status` section (L210-212): repeats At a glance [AI dev, team lead, manager, data eng]                                                                                                                                                                                                                  | −16         | At a glance; licence link at L17                |
| C2  | L152, second sentence (moves to the S0 bullet) [team lead, architect, data eng]                                                                                                                                                                                                                             | −18         | S0 bullet, L205                                 |
| C3  | L121 export paragraph cut to two sentences: "Export is plain JSON (`export_memories`), returned in the assistant's answer and missing some fields ([details](../docs/TOOLS.md#export-format)). For a backup or a move, copy `personal-vault/` and `config.json`." plus G8 [AI dev, AI-aug, team lead, manager] | about −60   | `TOOLS.md:44-70` already has every dropped fact |
| C4  | L12 privacy-filter list → "after a privacy filter that blocks secrets and personal data" [team lead, data eng]                                                                                                                                                                                              | −12         | L159, `INSTALL.md:150`                          |
| C5  | Languages L127-131 English-only snippet → one sentence and a link. **First** move the snippet into `HOW-IT-WORKS.md` §Languages, which today points back to the README for it (`HOW-IT-WORKS.md:156`) [AI dev, AI-aug, team lead, manager]                                                                  | −26         | HOW-IT-WORKS §Languages                         |

Not cut, though suggested: "How it's built" (the AI dev and architect want these facts, so keep them); the frontmatter example (mostly code, so it doesn't count toward prose); L18 metrics (the manager and architect use them).

**Outside the READMEs**

| #   | File                                     | Fix                                                                                                                                                                                                                                           |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | SECURITY.md                              | A short "Other data flows" list: transcript to `claude -p` (also from Gemini), plaintext personal vault, unsigned releases, Hugging Face download, linking README#privacy; add "best-effort response, no SLA" to the reporting line [manager] |
| O2  | INSTALL.md §Org vault                    | "Stopping team sync" (remove `orgRepo`, restart; what stays on each machine) and "history keeps it: use `git filter-repo`" at L136 [team lead]. **Check in `install.sh` / `pull-org-vault.sh` how `orgRepo` removal behaves before writing**  |
| O3  | ARCHITECTURE.md:89-107                   | Tag the five untagged invariants or mark them as not covered by the ADL gate [architect]                                                                                                                                                      |
| O4  | HOW-IT-WORKS (Limits) or SPEC-DRIVEN L25 | Scala, `*IT.java`, `.sql` and `.yml` aren't scanned, so dbt or data-contract tests can't link [data eng, AI dev]                                                                                                                              |
| O5  | COMPARISON.md                            | A short paragraph on general memory MCP servers. **Needs research and sources first** [AI dev]                                                                                                                                                |
| O6  | TOOLS.md                                 | Token cost of the 22 tool definitions and how much `specDriven.enabled: false` saves. **Measure with `tools/list` first** [AI dev, AI-aug]                                                                                                    |
| R1  | README-ro.md L7                          | `respecta` → `respectă`; `'căutabilă'` → `căutabilă` (no quotes; coordinator)                                                                                                                                                                 |

**Still open from round 2 (all six hit them):** T1 Cursor/Windsurf install test, T2 client-level `mcpServers` test (§8). A13 adds: L7 lists Cursor and Windsurf without saying they are untested. Proposed: "(Cursor and Windsurf: not yet tested)" at L7 until T1 is done.

### §10.5 Word budget

Prose words (fenced code and the collapsed `<details>` block excluded, as in §4):

|              | Before (`ff0b041`) | After, estimated |
| ------------ | -----------------: | ---------------: |
| README.md    |              2,088 |          ≈ 2,080 |
| README-ro.md |              2,144 |          ≈ 2,140 |

Additions G1–G8, T1–T5 and S0 come to about +150. Cuts C1–C5 come to about −130, plus about −20 from rewording L121 together with G8. Net is about −10. **The after-figures are estimates; the PR that applies this measures with the same script and reports the real numbers.** That still leaves the READMEs above the ~2,050 / 2,075 in §7 item 1. Reaching that needs one more cut of about 30–40 words: the best candidate is rewriting step 2 (L40, 70 words in one sentence, flagged by AI-aug) to about 35.

### §10.6 Decisions needed

1. **Spec-driven placement:** approve B with the wording above (recommended), or keep A.
2. **Order:** apply Priority 1–2, S0 and C1–C5 as one README PR; S1–S6 and O1–O4 as a second PR; O5–O6 need research or measurement first.
3. **Word budget (§7 item 1, still open):** accept ≈ 2,080 / 2,140, or also take the L40 rewrite.
4. **L7 "not yet tested" note for Cursor/Windsurf:** add now, or wait for T1.
5. **Extra personas:** run as round 3b, the same day (§10.7).

### §10.7 Round 3b: nine more personas

Same method and rules as §10.1. Each reviewer also received the round-3 findings so it would not repeat them, and five (security, Windows, platform, contributor, QA) were allowed to read source to check a doc claim. Every report carried its file list.

| Persona                | Vote                                                               | Main theme                                                                                                            |
| ---------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Security / AppSec      | B, amended                                                         | automatic capture as a lasting injection path; the model chooses the `org` tag; filter overclaims; install-time trust |
| Compliance / DPO       | B, reworded for non-developers                                     | no retention, erasure or data-categories facts; Gemini → second provider                                              |
| Newcomer to MCP        | **A**                                                              | undefined terms; where to type each command; what "restart" means; no expected output                                 |
| Windows-only developer | B                                                                  | the shell is never named; `--vscode` and CRLF are broken on Windows                                                   |
| Platform / DevEx       | B (off by default for a fleet)                                     | no exit codes, version pin, model cache or offline path                                                               |
| OSS contributor        | "A" (but asks for a line in At a glance, which is B in our labels) | no CONTRIBUTING; every rule is in the AI-facing `CLAUDE.md`                                                           |
| Obsidian / KM user     | **A**                                                              | Obsidian not mentioned at the top; when hand edits take effect; folder layout                                         |
| QA / test engineer     | B, "architects **and test leads**"                                 | tag rules per framework; no CI recipe; scope of the quality numbers                                                   |
| Native Romanian reader | B, with corrected RO                                               | 20 wording fixes; a broken word at RO L17                                                                             |

**Totals over 15 reviewers: B 12 (the contributor counted as B by intent), A 3, C 0.** The two A votes from personas who don't do architecture (newcomer, Obsidian) both say the line is jargon near the top and suggest putting it lower or adding "ignore it if you don't use ADL".

#### Revised recommendation (replaces the wording in §10.3)

Put the line as the **last bullet of At a glance**, not under "What you get". It is a trade-off (on by default, five extra tools) more than a selling point [contributor, Obsidian], and placed there it doesn't push the three risk bullets down. Wording merged from QA, newcomer, platform, compliance and the Romanian reader:

> - **Spec-driven tools (for architects and test leads, on by default):** link decisions to requirement IDs and check that every tagged rule in your ADL files has a test carrying its ID (coverage only; your tests are not run). Five of the 22 tools. Not using ADL files? Ignore them, or set `"specDriven": {"enabled": false}` in `~/.total-recall/config.json`. [Spec-driven work](../docs/SPEC-DRIVEN.md).

> - **Unelte spec-driven (pentru arhitecți și lideri de testare, active implicit):** leagă deciziile de ID-urile cerințelor și verifică dacă fiecare regulă cu ID din fișierele ADL are un test care conține acel ID (doar acoperirea; testele nu sunt rulate). Cinci din cele 22 de unelte. Nu folosești fișiere ADL? Ignoră-le sau setează `"specDriven": {"enabled": false}` în `~/.total-recall/config.json`. [Lucru spec-driven și ADL](../docs/SPEC-DRIVEN.md) (în engleză).

Security asked for two more facts in the line: any path is accepted, and guardrails come back unframed. Both are true (`src/tools/architecture.ts:23-27`; `SPEC-DRIVEN.md:65`), but they don't fit one line. They go into SPEC-DRIVEN L34 and into SECURITY.md (X1).

#### Coordinator verification (the claims that change the plan)

| Claim                                                                                                                   | Result                                                       | Evidence                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `--vscode` on Windows writes a file VS Code never reads (Windows)                                                       | **Confirmed (code bug)**                                     | `install.sh:588-591` handles only `Darwin`, else `~/.config/Code/User/mcp.json`; Windows uses `%APPDATA%\Code\User` |
| The VS Code entry starts the `.sh` file directly (Windows)                                                              | **Confirmed**; fails on Windows is **plausible**             | `scripts/register-vscode-mcp.mjs:19` `command: …start-server.sh`, no `bash`; README L72 says "command `bash`"       |
| No `.gitattributes`, so `.sh` files can check out as CRLF (Windows)                                                     | **Confirmed absent**; breakage **plausible**, not tested     | repo root                                                                                                           |
| `claude mcp get total-recall` is the wrong name for marketplace installs (platform)                                     | **Confirmed**                                                | `install.sh:717`: `plugin:total-recall:total-recall`; `INSTALL.md:104`                                              |
| `install.sh` exits 0 after failed steps (platform)                                                                      | **Confirmed** for the final check                            | Step 8 only `warn`s (`install.sh:714-722`); `die` is the only exit 1                                                |
| The model downloads once per plugin version, not once (platform, security)                                              | **Plausible, needs a test**                                  | `src/embeddings.ts` sets no cache dir; transformers.js caches under its own `node_modules` by default               |
| Complete profile runs `npm install` of the vector packages at setup (security)                                          | **Confirmed**                                                | `install.sh:680` `npm install --no-save $VEC_DEPS`; no doc names npm traffic                                        |
| Labelled-secret pattern needs 16+ characters, so "nothing … ever reaches" overclaims (security)                         | **Confirmed**                                                | `src/privacy-filter.ts:125` `{16,}`; `INSTALL.md:151`                                                               |
| Nested `claude -p` runs with the user's normal permissions (security)                                                   | **Confirmed: no restricting flags; impact plausible**        | `hooks/scripts/extract-and-store-memories.sh:95` passes no `--allowedTools` / `--disallowedTools`                   |
| `index_architecture` accepts any directory (security)                                                                   | **Confirmed**                                                | `architecture.ts:23-27` checks only "exists and is a directory"                                                     |
| SECURITY L27-28 "protect the default branch" points the wrong way (security)                                            | **Rejected**                                                 | fixed in F12: L28-29 already say the sync branch is controlled through push access                                  |
| Obsidian block-list `tags:` may not parse (Obsidian, rated high)                                                        | **Rejected**                                                 | `src/frontmatter.ts:8` parses block arrays                                                                          |
| `.obsidian/` is indexed (Obsidian)                                                                                      | **Rejected**                                                 | `src/paths.ts:96-97` skips `.obsidian` and `templates`                                                              |
| **New (coordinator):** `projects/`, `reference-docs/`, `in-progress/` and `completed/` folders are silently skipped too | **Confirmed, undocumented**                                  | `src/paths.ts:96-97`; no doc names them. A user who files memories under `projects/` gets nothing indexed           |
| Test IDs must be in square brackets; "put the ID in the test name" is impossible for pytest/Go function names (QA)      | **Confirmed**                                                | `src/spec/indexer.ts:116` `\[([A-Za-z][A-Za-z0-9_.-]*)\]` on any line                                               |
| No CONTRIBUTING, no templates; rules live only in `CLAUDE.md`, which contradicts itself on `-S` (contributor)           | **Confirmed**                                                | repo root and `.github/` (only `workflows/`); `plugins/total-recall/CLAUDE.md:66` vs `:72`                          |
| `package.json` has no `license` field (contributor)                                                                     | **Confirmed**                                                | `require('./package.json').license` is `undefined`                                                                  |
| RO L17 `'free'ă`, RO L13 `'free'` (Romanian)                                                                            | **Confirmed**                                                | file                                                                                                                |
| RO code blocks differ from EN (extra blank lines in `## Memory`) (Romanian)                                             | **Confirmed**; renders the same, but the copied text differs | RO L48-56                                                                                                           |

#### Additions to §10.4

**README (EN + RO), Priority 1: install and verify**

| #   | Location                 | Fix                                                                                                                   | Raised by            |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------- |
| G9  | Step 1, L33              | "Type these in the Claude Code chat (or `claude plugin …` in a terminal)"                                             | newcomer             |
| G10 | Step 2, L40              | "In a terminal (on Windows: **Git Bash**, not PowerShell)" and show where `-y` goes                                   | Windows, newcomer    |
| G11 | Step 3, L46              | "Create the file if it doesn't exist; append the block"                                                               | newcomer, Windows    |
| G12 | Step 4, L58              | "Restart: `/exit`, then `claude`. Approve the total-recall tools when asked." The new file is in a category subfolder | newcomer             |
| G13 | Privacy L161 (uninstall) | "…and remove the `## Memory` block from `~/.claude/CLAUDE.md`; delete `~/.total-recall/` to remove all data"          | newcomer, compliance |
| G14 | L7 or L12                | "(opens as an Obsidian vault)" linking HOW-IT-WORKS#obsidian                                                          | Obsidian             |

**README, Priority 2: trust**

| #   | Location            | Fix                                                                                                                                                                                                                        | Raised by            |
| --- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| T6  | Privacy, new bullet | "Automatic capture reads the end of the session, including web pages and tool output, and stores its lessons without review; they appear in later sessions in every project. Check them with _"list my recent memories"_." | security, compliance |
| T7  | Privacy L159        | "The assistant chooses the `org` tag, and a tagged memory is pushed without asking."                                                                                                                                       | security             |
| T8  | L19                 | "The only other outbound traffic: npm packages and the model at setup (Complete profile), and…" (wording after the cache test below)                                                                                       | security, platform   |
| T9  | L150 or Limits      | "The forgetting curve only ranks results; nothing is deleted automatically. A deleted memory stays in the vault's local git history and `.superseded/`."                                                                   | compliance, security |

**Docs outside the READMEs**

| #   | File                        | Fix                                                                                                                                                                                                                                                                                                             | Raised by             |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| X1  | SECURITY.md                 | Widen O1 to: capture as a lasting injection path (L31 "not affected" is only true for the org-vault threat), `org` chosen by the model, the filter covers only pushes through the sync hook (a raw `git push` skips it), `index_architecture` takes any path, nested `claude -p` permissions                    | security              |
| X2  | INSTALL.md:151              | Replace "Nothing in those categories ever reaches" with the real limits (labelled secrets of 16+ characters, known prefixes, high-entropy mixed-case strings)                                                                                                                                                   | security              |
| X3  | INSTALL.md                  | Windows section: Git Bash for every shell step; `~` = `C:\Users\<you>`; `"command": "C:\\Program Files\\Git\\bin\\bash.exe"` in MCP configs; Build Tools if no better-sqlite3 prebuild matches                                                                                                                  | Windows               |
| X4  | INSTALL.md:104              | `claude mcp get plugin:total-recall:total-recall` for marketplace installs                                                                                                                                                                                                                                      | platform              |
| X5  | INSTALL.md                  | Fleet notes: exit codes (today 0 unless `die`), run as the target user, `install.sh` merges an existing `config.json` (`install.sh:333-345`), network needs per profile, `-y --gemini` skips `agy plugin install` (`install.sh:564-577`), version pinning (none today)                                          | platform              |
| X6  | HOW-IT-WORKS §Obsidian      | When hand edits take effect (each new session in Claude Code; restart or `rebuild_index` elsewhere); which folders are skipped (`src/paths.ts:96-97`); renaming a file changes its key; don't put the personal vault in iCloud/Syncthing (`vectors.db`, nested `.git`); edit org memories through the assistant | Obsidian, coordinator |
| X7  | HOW-IT-WORKS §Configuration | One table with every key, including `embeddingModel`, the vault paths and `specDriven`                                                                                                                                                                                                                          | platform              |
| X8  | SPEC-DRIVEN L25             | "on any line of the test file, in square brackets (`@DisplayName`, docstring, `pytest.param(id=…)`); `@Tag("ORD-S1")` and Playwright `tag:` don't match; Cucumber `.feature` files are not scanned"; counting is per line; several IDs per line work                                                            | QA                    |
| X9  | SPEC-DRIVEN L35             | Result shape, `record:false` (dry run), and "no CLI or exit code: for a CI gate, copy `adl-coverage.test.ts`"                                                                                                                                                                                                   | QA                    |
| X10 | SPEC-DRIVEN L34             | "the path is not limited to the current project"; a Windows example (`C:/Users/me/repo`)                                                                                                                                                                                                                        | security, Windows     |
| X11 | SPEC-DRIVEN, after L49      | "Adding a module or rule here": `components.ts` and `[TR-S12]`, ID naming, the name-tag and unknown-ID rules of the repo's own gate                                                                                                                                                                             | contributor           |
| X13 | QUALITY.md                  | "97% statement coverage, unit suite only; mutation score of all mutants; CI on ubuntu-latest, Node 20" and a link to the Actions run                                                                                                                                                                            | QA                    |
| X14 | README-ro.md                | Adopt R1–R20 from the Romanian review: R1/R2 broken `'free'`, R6 closing quotes `”`, R9 copy the EN code blocks verbatim, plus the calques (R4, R5, R12, R14) and register (R16) fixes                                                                                                                          | Romanian              |

**Code and config bugs found (not doc wording; separate issues)**

| #   | Where                                | Bug                                                                                                                               |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `install.sh:588-591`                 | `--vscode` writes the Linux path on Windows (MINGW)                                                                               |
| B2  | `scripts/register-vscode-mcp.mjs:19` | VS Code entry starts the `.sh` directly, with no `bash`; on Windows that likely fails                                             |
| B3  | repo root                            | No `.gitattributes` (`*.sh text eol=lf`)                                                                                          |
| B4  | `install.sh` Step 8                  | Exits 0 when the MCP server is not registered; add a non-zero exit or `--strict`                                                  |
| B5  | `install.sh --help` and prompt       | `--org-repo` described as a GitHub URL; README says any host                                                                      |
| B6  | `plugins/total-recall/CLAUDE.md:66`  | `git commit -S` contradicts L72 "commits are NOT signed"                                                                          |
| B7  | `plugins/total-recall/package.json`  | No `"license": "MIT"`                                                                                                             |
| B8  | `src/embeddings.ts`                  | **Test first:** whether the model re-downloads after each `claude plugin update`. If so, set a cache dir under `~/.total-recall/` |

**Not adopted:** a "For your DPIA" block and per-client provider names in the README (compliance) are useful but long. Put them in SECURITY.md under X1 if wanted. A PII detector for the personal vault and a capture rule that excludes names are product work. HTTP transport, multi-user use and a CLI health check are product work.

#### Word budget after round 3b

G9–G14 and T6–T9 add about +170 prose words to each README, on top of §10.5. Without new cuts, EN goes to about 2,250. To stay near §7's 2,050 and still meet "only essential information", one structural cut is needed. The candidate several reviewers named [AI dev, data eng, manager] is **Team setup steps 1–4 (L167-184, about 200 words) moved to `INSTALL.md` → Org vault**, leaving the bold risk line, a two-line summary and the link. The team lead wanted _more_ there (G2, G3), so this is a trade-off for the maintainer to decide.

#### Decisions added to §10.6

6. Placement of the spec-driven line: **last bullet of At a glance** (recommended, 12 of 15) vs. under "What you get".
7. Adopt T6–T9 (capture and deletion facts). They are the main new trust facts and cost about 80 words.
8. Move Team setup steps to INSTALL.md to pay for 7 (or accept about 2,250 words).
9. File B1–B8 as issues. B1–B3 block Windows users, so fix them before any Windows claim is made.
