# PLAN — README.md & README-ro.md: persona-review round 2

**Status:** proposed · **Date:** 2026-11-03 · **Branch:** `main` (HEAD `ddc33cc`)
**Supersedes:** the round-1 plan of the same name. Its structure work shipped in #29 and its hooks in #30; this round is driven by evidence from six independent reviews of the shipped READMEs, not by a single-pass evaluation.
**Priorities, in order:** (1) each persona can install and verify from the README alone; (2) honest trust/risk information on the first screen; (3) attention hooks.
**Rules:** every claim traces to code or an existing doc; README ≤ N words (§4); EN and RO structurally identical; plan only, no file other than this one is edited by this round.

## §1 Method and its limits

Six subagents, one per persona (AI developer, AI-augmented developer, team lead, architect, manager, data engineer), each told to read only the 12 docs (the two READMEs, `docs/*.md`, `SECURITY.md`, `BACKLOG.md`, `plugins/total-recall/{INSTALL,ARCHITECTURE,README}.md`), never source code, and to cite line numbers. Findings below were then **checked against the repo by the coordinator** (§2); claims that did not hold were dropped.

| Reviewer | Docs it did **not** read (or only skimmed) |
|---|---|
| AI developer | BACKLOG, SPEC-DRIVEN, ARCHITECTURE; HOW-IT-WORKS and COMPARISON partly |
| AI-augmented dev | TOOLS, SPEC-DRIVEN, ARCHITECTURE; later parts of HOW-IT-WORKS, BACKLOG |
| Team lead | TOOLS, ARCHITECTURE, SPEC-DRIVEN (grepped only) |
| Architect | TOOLS, COMPARISON, INSTALL, BACKLOG, plugin README |
| Manager | BACKLOG, HOW-IT-WORKS, TOOLS, SPEC-DRIVEN, ARCHITECTURE |
| Data engineer | BACKLOG, SPEC-DRIVEN, COMPARISON |

Consequences: the Romanian README was reviewed only structurally (all six say it mirrors the English one line for line); the architect and AI-dev views of ARCHITECTURE/SPEC-DRIVEN are thin. Two reviewers also saw the plugin's `CLAUDE.md` through context injection; findings that rest only on it are marked *outside the doc set* and not used. **Next round must make every reviewer list the files it opened and fail the review if a required file is missing** (§6).

## §2 Coordinator verification of reviewer claims

| Claim | Result | Evidence |
|---|---|---|
| "Three other plugins" is a miscount (manager) | **Rejected** | `docs/COMPARISON.md:7`: three same-name projects; `mozilla-ai/cq` is listed as inspiration, not as a same-name plugin |
| MCP server reports v1.6.6 (four reviewers) | **Rejected as a doc defect** | that is the installed plugin's own banner, not a document |
| BACKLOG says 68.28% mutation score | **Confirmed, stale** | `BACKLOG.md:31`; QUALITY.md says 81.1% |
| BACKLOG calls the plugin "single-user" | **Confirmed, partly stale** | `BACKLOG.md:87,127,184` |
| INSTALL.md overclaims trust | **Confirmed** | `INSTALL.md:55`: "no hand-built artifact can reach you … one thing to trust" while commits, tags and the bundle carry no signature or provenance ([PLAN-SIGNED-RELEASES.md](PLAN-SIGNED-RELEASES.md)) |
| README omits "Windows needs a Windows Node.js" | **Confirmed** | `INSTALL.md:16-18`; README says only "Git Bash" |
| README "emails" blocked is imprecise | **Confirmed** | `src/privacy-filter.ts:75-90` checks the email host against `allowedEmailDomains`; INSTALL.md:149 says "outside your allowed domain" |
| "Accents ignored for any Latin alphabet" is overstated | **Confirmed** | `src/tfidf.ts:90-92`: `NFKD` then every character outside `a–z0–9` becomes a separator; letters with no decomposition (ß, ł, ø, æ) split words |
| "No database" vs SQLite `vectors.db` | **Confirmed (wording)** | README L12 says "no database"; README L119 lists `vectors.db`; `HOW-IT-WORKS` names sqlite-vec |
| Export passes through the model's context | **Confirmed, missing from README** | `docs/TOOLS.md:36` |
| Rebuilding `index.json` resets access counts | **Confirmed, missing from README** | `docs/HOW-IT-WORKS.md:68` (kept only in `index.json`) |
| The "Something looks off / get_stats" check is not on the quick-start path | **Confirmed** | README mentions `get_stats` once, in the troubleshooting list (L185) |
| Cursor and Windsurf have no setup instructions | **Confirmed** | `INSTALL.md` mentions them only in its opening sentence (L3); no config path or instruction-file name exists in any doc |
| **Regression introduced in #30** | **Confirmed** | the removed "Rebuilt automatically" bullet carried the warning that the **org** `index.json` is *not* rebuilt locally and must not be edited; README L119's Derived row now implies it is (`docs/HOW-IT-WORKS.md:30`) |
| CI badge shows "CI" | **Confirmed (label)** | it links `mutation.yml`, which is the gate (audit, typecheck, build, tests, mutation) but is named for one step |
| `gh` is required for the team setup but missing from the README prerequisites | **Partly** | README L170 says `gh auth login` inline; `INSTALL.md:10,126` and `install.sh` (L79, L248) require `gh` authenticated; README's "elsewhere, git credentials" is not reconciled with that |
| Same OS username lets teammates edit each other's org memories | **Plausible, undocumented** | author guard compares OS username (`INSTALL.md:131`); no doc states the collision case |
| Windows native deps are fragile (manager) | **Dropped** | speculation; no doc or code evidence read |

## §3 Findings and changes, by priority

Numbers in brackets are how many of the six personas raised it.

### Priority 1 — install and verify from the README alone

| # | Gap | Fix (source for the wording) | Placement |
|---|---|---|---|
| 1.1 | No verification beyond "a file appears"; `get_stats` is off the quick-start path [5/6] | Add to step 4: ask the assistant to call `get_stats`; it should list totals and recent errors, and `vector.enabled` (wording from `INSTALL.md:187-189`; do **not** invent exact output) | Quick start, Claude Code step 4 |
| 1.2 | Generic-MCP route has no verify step and one relative path [3/6] | One verify line in the `<details>` block: call `get_stats`, or read `total-recall://index`; give the plugin-folder path for `pull-org-vault.sh` / `sync-org-memory.mjs` (`~/total-recall-plugin/plugins/total-recall`) | `<details>` and Team setup step 3 |
| 1.3 | Cursor and Windsurf cannot be installed from any doc [2/6, and the support table lists them with ✅ tools] | **Requires a real test first.** Install on Cursor and on Windsurf, record the MCP config path and the instruction-file name, then document in `INSTALL.md` and link from README. The README support table now has a **Tested** column (✅ Claude Code and Gemini/Antigravity, ❌ VS Code/Copilot and the generic-MCP row); flip a row to ✅ only after its install has been run end to end | `INSTALL.md` (new section), README support table |
| 1.4 | Team setup has no end-to-end verify [2/6] | Add 3 lines: A stores "remember for the team …", B starts a new session and asks. When it fails: in Claude Code the session start warns when team pushes keep failing (README L185, `check-sync-errors.sh` in `HOW-IT-WORKS.md:177`); `get_stats` shows recent errors. The sync log files are not documented anywhere, so they are not named | Team setup |
| 1.5 | `gh`, `--allowed-email-domain` and the credential rule are unexplained or inconsistent [2/6] | **Open question, answered before PR B:** does org sync work against a non-GitHub host with plain git credentials? Facts so far: README L170 says "elsewhere, git credentials that can push"; `INSTALL.md:126` says `gh auth status` must be green; `install.sh` L248-252 only *warns* when `gh` is not authenticated ("required only for the org vault"). Read `sync-org-memory.mjs` and `pull-org-vault.sh` for `gh` calls, then make README and INSTALL.md say the same thing. Also add one sentence on what `--allowed-email-domain` lets through | Team setup step 2 |
| 1.6 | Step 3 (global `CLAUDE.md` edit): nothing says what breaks if skipped or how to undo [2/6] | Two clauses: already says "required"; add the consequence (Claude keeps its own `MEMORY.md` alongside) and "remove the block to undo" | Quick start step 3 |
| 1.7 | Windows Node note missing [1/6] | One clause: "a Windows `node.exe` on PATH, not WSL-only Node" (`INSTALL.md:18`) | Quick start "You need" |
| 1.8 | Export goes through the model's context; off-machine backup absent [1/6] | One clause in Your data: "returned in the assistant's answer" (`TOOLS.md:36`); one line: copy `personal-vault/` for an off-machine backup (the local git repo is on the same disk) | Your data |

### Priority 2 — honest trust and risk on the first screen

The first screen (about 25 lines) is currently all reassuring; the three facts that block a team or regulated decision live 130–170 lines down [team lead, manager, architect].

**Layout change required.** Lines 1–25 are already full (badges L3, pitch L5–7, language switch L9, three bullets L11–13, comparison line L15, session-loop SVG L17, At a glance from L19). Adding 2.1–2.3 there would push them to about L24–30. PR A therefore also:
- moves the session-loop SVG below At a glance (it explains the loop; it does not decide anything);
- folds the comparison line (L15) into the "Where it lives" bullet as one clause.

That frees about six lines, so the three risk bullets land inside the first 25.

| # | Gap | Fix | Source line |
|---|---|---|---|
| 2.1 | Weak org access control is first mentioned at README L161 | Add a "Risks" bullet to At a glance: org vault = anyone with push access can edit any memory, nothing reviewed | README L161 |
| 2.2 | "Data stays local" omits the auto-capture transcript [2/6] | Reword the bullet: files stay local; **the model provider sees what the assistant reads, and Claude Code sends the last 1 MiB of transcript to `claude -p`** | README L153 |
| 2.3 | Uncapped index cost is shown only under Limits [4/6] | One bullet in At a glance: 30–40 tokens per memory, no cap (4.4k at 100, 32k at 1,000, 162k at 5,000) | README L191, `QUALITY.md:98-101` |
| 2.4 | Cost bullet says semantic search is "optional" but the default profile installs it | Reword: "the default profile downloads a local multilingual model once (449 MB); `--no-vector` skips it" | `INSTALL.md:22` |
| 2.5 | "Blocks … emails" is imprecise | "emails outside your allowed domains" | `privacy-filter.ts:75-90` |
| 2.6 | "no database" vs SQLite | "no database to run; an optional SQLite file holds the vectors" | README L119 |
| 2.7 | "Accents ignored" overstated | README: "most accents are ignored" (soften, no detail). HOW-IT-WORKS tokenizer paragraph: add that letters with no accent-free form (ß, ł, ø, æ) split a word | `tfidf.ts:90-92` |
| 2.8 | "Releases not signed" understates: commits and tags are unsigned too, and `INSTALL.md:55` claims more than is proven | Keep "not signed"; align INSTALL.md:55 ("one thing to trust" → state that CI builds it and nothing is signed yet) until [PLAN-SIGNED-RELEASES.md](PLAN-SIGNED-RELEASES.md) ships | `INSTALL.md:55` |
| 2.9 | **Regression:** the org `index.json` warning was dropped in #30 | Restore as one clause in the Derived row: "the org `index.json` in the team repo is not rebuilt; leave it alone"; add "access counts are reset" | `HOW-IT-WORKS.md:30,68` |
| 2.10 | Badge label | Decided by the maintainer (§7 item 4) | `.github/workflows/mutation.yml` |
| 2.11 | Same-OS-username collision | **In `INSTALL.md:131`, not the README:** add that two teammates with the same OS username (for example `ubuntu`) count as the same author | `INSTALL.md:131` |

### Priority 3 — attention hooks

| # | Hook | Raised by | Source line |
|---|---|---|---|
| 3.1 | "Design in five lines" under At a glance: flat files, derived indexes, fail-closed filter, no LLM in the search path, one-line link to the invariants | architect | `HOW-IT-WORKS.md:94-98`, `ARCHITECTURE.md:89-107` (replace, don't add to, "How it's built") |
| 3.2 | Comparison against sharing a `MEMORY.md` in git | team lead | needs a new row in `docs/COMPARISON.md`; source facts: search/decay (README), privacy filter (README L12), author guard (`INSTALL.md:131`); **trust model is the same** (push access) — state that |
| 3.3 | Uninstall one-liner near the top | AI-augmented dev, manager | README L186 |
| 3.4 | Start latency number | AI dev | `QUALITY.md:21` (99 ms median) |
| 3.5 | Sample session: store → new session → recall | AI-augmented dev | README step 4 text; optional recording stays out of scope |
| 3.6 | Tool-call example and retrieval-order cheat sheet in `TOOLS.md` | AI dev | `skills/memory-workflow/SKILL.md` order, `TOOLS.md:9-30` |

### Documentation fixes outside the READMEs (small, independent)

| File | Fix |
|---|---|
| `BACKLOG.md:31` | Replace 68.28% with the current score or mark the line "as of <date>"; reword "single-user" at L87/L127/L184 where it contradicts the team feature |
| `INSTALL.md:55` | See 2.8 |
| `docs/QUALITY.md:3` | Say "last measured at commit 0625d95; source unchanged since" (only docs changed after it) |
| `docs/HOW-IT-WORKS.md` | Tokenizer note (2.7) |
| `docs/COMPARISON.md` | New row (3.2) |

## §4 Word budget (N)

`N` was left open in the request. **Proposal: N = 1,950 words of prose per README** (code blocks and the collapsed install block excluded; headings, tables and links counted), RO ≤ 2,000 because Romanian runs about 2% longer. 1,900 was the first proposal; the arithmetic below shows it cannot be reached without cutting content that has no other home.

**Today:** EN 1,924, RO 1,960 (after #30).
**Additions, estimated:** Priority 2 ≈ +130 (three At a glance bullets ≈ +70, rewordings 2.2/2.4/2.5/2.6/2.9 ≈ +60); Priority 1 ≈ +200 (eight items, 1.3 excluded). Total ≈ +330. These are estimates; each PR measures with the word-count script and reports the real figure.

**Cuts** (each must leave the fact in exactly one other file, added there first if needed, checked with `grep` in the same PR):

| Cut | Words | Where the fact lives afterwards |
|---|---|---|
| Merge "Upgrade (other assistants)" and "Uninstall" into one bullet pointing at `INSTALL.md` | −90 | `INSTALL.md:67` |
| Privacy section: shorten the transcript and org-trust bullets to one line each, now that At a glance states them (2.1, 2.2) | −60 | At a glance + `SECURITY.md` |
| Shorten the note under Supported assistants | −45 | `INSTALL.md` |
| Team setup step 3: move the "other assistants have no hooks" sentence to `INSTALL.md` §Org vault | −45 | `INSTALL.md` (add first) |
| Languages: drop the benchmark sentence | −30 | `HOW-IT-WORKS.md` §Languages |
| "Several sessions at once" bullet shortened to one line | −25 | `HOW-IT-WORKS.md` (add the lock-free `index.json` note there first; BACKLOG is a roadmap, not user documentation) |
| Team setup: shorten the bold risk line's second sentence (At a glance now carries the risk) | −20 | At a glance |
| **Total** | **−315** | |

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

| # | Item | Status | How |
|---|---|---|---|
| T1 | Verify installs on **Cursor** and **Windsurf** (item 1.3) | **TODO** (needs real clients) | On each client: clone, `./install.sh -y`, add the server to the client's MCP configuration, restart, ask for `get_stats` and store/recall a memory. Record the config path and the instruction-file name in `INSTALL.md`; flip the row in the README **Tested** column only after this passes |
| T2 | Test the README `mcpServers` snippet | **Protocol level done, client level TODO** | *Done 2026-11-03:* `bash <clone>/plugins/total-recall/scripts/start-server.sh` over stdio with a temporary `HOME`: `initialize` OK, `tools/list` returns 22 tools, `get_stats` returns without error (server 1.6.8). This proves the command, the argument and the server; it does not prove where a given client reads its configuration. *TODO:* the same steps as T1 on at least one client that uses the `mcpServers` format (Claude Desktop first), then document its config path in `INSTALL.md` |
| T3 | Romanian quality pass on `README-ro.md` | **Draft applied, maintainer sign-off pending** (model-run review, 2026-11-03: number format `4,4k`, `leagă` for the verb "tie", `blochează` for "fails closed", profile names `Complete`/`Minimal` as the installer prints them, "(în engleză)" added for SECURITY.md and BACKLOG.md, tone made imperative, "best-effort" and "rollout checklist" reworded; skipped on purpose: the `## Mai mult (în engleză)` heading marker, which is structural). Original method: A Romanian reader goes through it next to the English file with this checklist: consistent technical terms (vault, hook, index, memorie, token), calques from English, diacritics, number format (1.036 vs 1,036), the "(în engleză)" marks, anchors into English headings. Output: a list of proposed edits, applied in one PR. A model-run draft is fine as a starting point; the maintainer signs off |
| T4 | Re-run the six persona reviews | **TODO, last** | On the final text, after T3 (T1/T2 do not block it if the reviewer is told that ❌ in **Tested** means "not tested"). Same personas, plus the required reading list: each reviewer lists the files it opened and the run is rejected if one of the 12 is missing. Pass condition as in §6 |
| T5 | Word budget N | **Decision** | Shipped: EN 2,037, RO 2,058 (§4). Accept about 2,050 / 2,075 or choose cuts of README-only content |

Order: T3 → T4 can proceed now; T1 and T2 (client level) run whenever a client is at hand and feed the **Tested** column.
