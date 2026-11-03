# PLAN — README.md & README-ro.md: multi-persona review and essential-first redesign

**Status:** proposed, revised after review · **Date:** 2026-11-03 · **Branch:** `main`
**Goal:** make the README pair essential, trustworthy and install-ready for six user types — AI devs, devs who use AI for augmented development, team leads, architects, managers, data engineers — by keeping only essential information on the surface, routing deep content to the doc it already lives in, and adding attention hooks ("cârlige de atenție": first-screen elements that make a persona keep reading).
**Priorities, in order:** (1) each persona can install and verify from the README alone; (2) honest trust/risk information on the first screen; (3) attention hooks. A hook that costs words a higher priority needs is dropped.
**Accuracy rule:** every claim traces to code or an existing doc; no new numbers without a source.
**Method note:** the persona findings in §2 come from one evaluation pass, not from independent agents, so they risk sharing one model's blind spots. Acceptance (§8) re-checks them with one agent per persona, each given only the new README and the files it links to.

## §1 Scope — audited documentation suite (13 files, ~14,200 words)

| File | Lines | Words | Role |
|---|---|---|---|
| `README.md` / `README-ro.md` | 180 each | ~2,130 each | entry point, EN/RO symmetric |
| `docs/HOW-IT-WORKS.md` | 185 | 1,819 | storage tree, frontmatter, search pipeline, hooks, Obsidian |
| `docs/TOOLS.md` | 60 | 626 | the 22 tools, export JSON format (jq/DuckDB) |
| `docs/SPEC-DRIVEN.md` | 103 | 1,208 | ADL walkthrough + `specDriven` config |
| `docs/QUALITY.md` | 105 | 1,242 | metrics, delivery, scale |
| `docs/COMPARISON.md` | 28 | 382 | alternatives table (3 same-name plugins + cq) |
| `SECURITY.md` | 30 | 217 | policy, org-vault trust model |
| `plugins/total-recall/INSTALL.md` | 183 | 1,728 | per-client install, Windows, org vault, privacy model |
| `plugins/total-recall/ARCHITECTURE.md` | 107 | 405 | C4 diagrams + key invariants table |
| `plugins/total-recall/README.md` | 14 | 156 | pointer stub (installed with the plugin) |
| `BACKLOG.md` | 252 | 2,157 | roadmap with triggers |

## §2 Persona findings (what they perceive, where they stop, what hooks them)

### 2.1 AI developer (builds agents / MCP integrations)
- **Perceives positively:** "or any other client that speaks MCP" up front (README L5), honest Limits, ARCHITECTURE.md link.
- **Blockers:** the MCP server registration (command `bash`, argument `scripts/start-server.sh`) is **never shown in README** — it is one sentence in INSTALL.md §"Install without Claude Code" (L67); MCP resources/prompts (`total-recall://index`, `memory-workflow`) appear only in INSTALL.md §VS Code / §Codex; the "Other assistants" path is one outbound link (README L59–61).
- **Hooks for them:** collapsed `<details>` with the full non-Claude install (clone + `install.sh` + `mcpServers` JSON); one line naming the MCP resources & prompts; tool count surfaced.

### 2.2 Developer using AI for augmented development (Cursor / Copilot / Claude Code, pragmatic)
- **Perceives positively:** Quick start is correct; the Daily-use table ("You say → What happens → Tool", L63–71) is the strongest section in the file.
- **Blockers:** the one-liner `bash "$(ls -d ~/.claude/plugins/cache/…)"` (L40, identical in README-ro and INSTALL.md) **looks fragile** — the explanation under it (L43) helps but is easy to skip; step 3 edits the global `~/.claude/CLAUDE.md` (L45) = real friction, but required; Cursor/Windsurf/Codex users must leave the README to install; no recording of a real session (only an abstract SVG, L14).
- **Hooks for them:** "a memory that survives restart" framing on Quick start, backed by the existing verify step (L57); the glob's explanation moved directly above the command.

### 2.3 Team lead (adopts for the team)
- **Perceives positively:** bold honesty "Access control is weak…" (README L100) — trust through candor; the 5 operational bullets (shared / protected / not reviewed / cost / someone leaves, L117–121).
- **Blockers:** **no rollout guidance anywhere in the suite** (no pilot → measure → team path); cost-per-teammate growth appears only at L120; team section sits mid-document and is long.
- **Hooks for them:** a short rollout checklist (new content in INSTALL.md §Org vault, linked from README). A "start solo, add the team later" line **only if** §8 step 0 verifies that re-running `install.sh --org-repo` on an existing install works.

### 2.4 Architect
- **Perceives positively:** `ARCHITECTURE.md` (C4 diagrams + key-invariants table with rule IDs, L87–107); `SPEC-DRIVEN.md` ties decisions to requirements and architecture rules to tests — the major differentiator.
- **Blockers:** **zero architecture teaser in README** — the first architecture mention is in "More" (L174); spec-driven/ADL is buried at L173 of 180; the token-growth limit (L163) has no pointer to mitigations.
- **Hooks for them:** a 3-line architecture summary (stdio MCP server + lifecycle hooks + flat-file vault; indexes are derived and rebuildable) + C4 link; a 2-line spec-driven teaser with the five-minute walkthrough link.

### 2.5 Manager (skims the first screen, decides)
- **Perceives positively:** "At a glance" (L16–22): license, maintainer honesty, ~10 releases/month, tests/coverage/mutation numbers.
- **Blockers:** it sits **below** 4 bullets + a diagram; no badges row; "releases are **not signed**" is honest but context-free; ~2,100 words is over their budget; `COMPARISON.md` and `QUALITY.md` are buried in "More".
- **Hooks for them:** CI-status + license badges; one comparison line near the top linking `docs/COMPARISON.md`; key numbers in the first screen (1,036 tests · 97% coverage · 81% mutation score · ~10 releases/month, all from QUALITY.md).

### 2.6 Data engineer (data ownership, formats, pipelines)
- **Perceives positively:** "plain Markdown files … read, edit, grep, version with git" (L5); export/import; "derived indexes are rebuilt from the `.md` files" (L156).
- **Blockers:** **no sample memory file in README** — the frontmatter example is in HOW-IT-WORKS.md L39–52 only; the source-vs-derived distinction exists only in the HOW-IT-WORKS tree (L16–31); export format and `jq`/DuckDB readiness are in TOOLS.md L34–60 only; the search caveat (first 500 chars, L164) is buried in Limits.
- **Hooks for them:** a 6-line memory example; a source-vs-derived mini-table; one line "export is plain JSON — `jq` / DuckDB work on it directly".

## §3 Doc-suite audit (the referenced files)

### 3.1 Duplication map — drift risk
| Content | README.md | README-ro.md | INSTALL.md | HOW-IT-WORKS.md |
|---|---|---|---|---|
| Marketplace install commands | L30–41 | L30–41 | L37–50 | — |
| Glob one-liner (identical 3×) | L40 | L40 | L54 | — |
| Languages / embedding model | L75–88 | same | — | L133–152 |
| Team setup | L98–121 | same | L119–127 | — |
| `config.json` example | L134–148 (**only copy**) | same | — | partial (`enableMultilingualSearch`) |

**Single-source-of-truth rule:** README = teaser + minimal snippet + link; detail lives in exactly one file. The marketplace commands stay duplicated in README by design (primary path). Languages detail moves to HOW-IT-WORKS.md (README keeps 2 sentences + the English-only model snippet). Team operations consolidate in INSTALL.md. The `config.json` block **moves to HOW-IT-WORKS.md §Configuration in the same change** — it has no other home today.

### 3.2 Routing gaps (content exists but is unreachable from the entry point)
- Non-Claude install (clone + `install.sh` + server registration) → only INSTALL.md → surface in README `<details>`.
- Memory file example → only HOW-IT-WORKS.md → surface a 6-line excerpt.
- Source-vs-derived table → only HOW-IT-WORKS.md → surface mini-table.
- Export format / jq / DuckDB → only TOOLS.md → one line + link.
- MCP resources & prompts → only INSTALL.md → one line + link.

### 3.3 Genuinely missing across the whole suite
CI badges; a real-session recording (optional, §5); exit strategy ("what if I stop using it"); team rollout checklist. Everything else in the new README is moved, not written.

### 3.4 Already fixed on `main` (2026-11-03, before this plan is implemented)
- INSTALL.md L67 claimed the README "has a snippet for each host" and linked `README.md#other-assistants`, an anchor that did not exist. The heading is now `### Other assistants` (RO: `### Alți asistenți`) and INSTALL.md points to its own per-host sections instead.
- README / README-ro "29% needed a follow-up fix" removed: QUALITY.md no longer reports change failure rate, so the figure had no source.

## §4 New README structure (essential-first)

**Word budget:** ≤ ~1,700 words of prose per README; code blocks and `<details>` bodies are not counted (they are copied, not read). Estimate: today ~2,130; moves out (Languages detail, Configuration, team bullets, Upgrade/Limits overlap) ≈ −650; additions (architecture summary, memory example, source/derived table, spec teaser, comparison line, exit line) ≈ +250 prose.

Twelve sections, in this order. Every hook from §5 has a slot here.

1. **Header block:** title + one-liner pitch (keep L3–5) + **badge row** (§5.1) + language switcher (L7) + session-loop SVG (L14).
2. **Why — 3 bullets** (fuse today's 4 bullets, L9–12) + **comparison line** (§5.5).
3. **At a glance** (moved up, directly after Why) — key numbers (§5.6) next to the "not signed" caveat.
4. **Quick start — "a memory that survives restart":**
   - *Claude Code:* the 4 steps kept (L28–57); the glob's one-sentence explanation moves **above** the command; step 3 (CLAUDE.md snippet) kept with its "why".
   - *Other assistants* (short ASCII heading, stable anchor): collapsed `<details>` with the **complete** path — `git clone --depth 1 -b release …`, `cd …/plugins/total-recall && ./install.sh -y`, then the `mcpServers` JSON (command `bash`, args `[<abs path>/scripts/start-server.sh]`) + one line naming `total-recall://index` and the `memory-workflow` prompt. Per-host details stay in INSTALL.md.
   - Ends with the verify step (L57).
5. **Daily use** — table kept as-is (L63–73).
6. **Your data** — 6-line memory excerpt (from HOW-IT-WORKS.md L39–52) + **source-vs-derived mini-table** (`.md` = source; `index.json`, `invertedIndex.json`, `.index-cache.txt`, `vectors.db` = derived, rebuilt automatically) + export line → TOOLS.md.
7. **Supported assistants** — table moved up from L123–132, kept verbatim.
8. **How it's built** — 3-line architecture summary + C4 link (§2.4) and the 2-line spec-driven teaser → SPEC-DRIVEN.md.
9. **Privacy & trust** — 4 bullets condensed from L90–96 + **exit line** (§5.7) + SECURITY.md link.
10. **For teams** — bold risk line kept verbatim (L100) + the setup commands (L102–113) + link to INSTALL.md §Org vault (operational bullets L117–121 and the rollout checklist live there).
11. **Upgrade & troubleshooting** — kept as its own section, ≤ 6 bullets. **Must keep:** "`claude plugin update` does not re-run `install.sh` — run it again", the `git reset --hard origin/release` note, `npm rebuild better-sqlite3`, restore from the personal vault's git repo.
12. **Limits** — kept as its own heading (managers and leads read it as a trust signal), then **More** + one-line **Status**.

**What leaves the README:** the Languages deep-dive (→ HOW-IT-WORKS.md), team operational bullets (→ INSTALL.md), the Configuration block (→ HOW-IT-WORKS.md §Configuration, one line + link remains).

### 4.1 Persona → hook → location (acceptance checklist)

| Persona | Hook | Section (§4) | Must appear by line |
|---|---|---|---|
| AI dev | MCP-client `<details>` + resources/prompts line | 4 | ~60 |
| AI-augmented dev | "memory that survives restart" + verify step | 4 | ~35 |
| Team lead | bold risk line + rollout checklist link | 10 | (link in Why, ~15) |
| Architect | architecture summary + spec-driven teaser | 8 | (comparison line, ~15) |
| Manager | badges + key numbers + comparison line | 1–3 | ~25 |
| Data engineer | "plain Markdown" pitch + memory excerpt | 1, 6 | ~5 |

## §5 Attention hooks ("cârlige de atenție")

1. **Badge row:** the GitHub Actions status badge of `mutation.yml` (live, cannot go stale) + MIT license badge. No hand-maintained number badges — numbers live in At a glance and QUALITY.md.
2. **"A memory that survives restart"** framing on Quick start — testable via the verify step (L57).
3. **Session recording — optional, not an acceptance criterion.** If made: record against a throwaway `HOME` (no real memory titles may appear), store as `docs/diagrams/demo.gif`, re-record when the Quick start flow changes. Fallback: the existing SVG loop.
4. **Source-vs-derived mini-table** — answers "what is my data" at a glance.
5. **Comparison line near the top:** "Three other plugins are also called `total-recall` — [how this one differs](docs/COMPARISON.md)"; it also restates the install-by-full-ID warning.
6. **Key numbers in the first screen** (from QUALITY.md): 1,036 tests · 97% coverage · 81% mutation score · ~10 releases/month — next to the "not signed" caveat.
7. **Exit line** (replaces the FAQ idea, which only repeated existing sections): "Stop using it any time: your memories stay as `.md` files, and `export_memories` gives JSON."
8. **Team risk bold line** — kept verbatim; candor is itself a hook.

Dropped from the first draft: a "social proof" line citing a public presentation (no doc links to one — it would break the accuracy rule); a forward note about `npx @adrian-balaban/total-recall` (it contradicts INSTALL.md L55 "no npm package" until [PLAN-NPX-INSTALL-BOOTSTRAP.md](PLAN-NPX-INSTALL-BOOTSTRAP.md) ships — add it in that PR); a `cd <newest-cache-dir>` alternative to the glob (a placeholder is less copy-pasteable than the glob it replaces).

## §6 EN/RO sync

- Same 12 sections, same order in `README.md` and `README-ro.md`; RO keeps its "(în engleză)" markers on deep-doc links (docs stay EN-only).
- **Anchor policy:** headings that other files link to are short and ASCII-safe (`### Other assistants`, `### Claude Code`); renaming one requires `grep -rn '<old-anchor>' --include='*.md'` across the repo in the same change.
- `session-loop-ro.svg` kept; new assets are language-neutral or get `-ro` twins only if they carry text.
- Structural parity check: heading counts and order (`grep -c '^#'`, `grep '^#'`) must match 1:1.

## §7 Changes to the referenced `.md` files (minimal, single-source respecting)

- **`plugins/total-recall/INSTALL.md`** — adds a short **"Team rollout checklist"** in §Org vault: (1) pilot with 1–2 people → (2) watch `get_stats` and injected-index token growth (QUALITY.md §Scale) → (3) add the team, set `orgInjection` per team size → (4) offboarding = revoke push access. INSTALL.md becomes the single source for team operations (absorbs README L117–121).
- **`docs/HOW-IT-WORKS.md`** — single source for Languages/embedding detail (already there) and gains a **§Configuration** with the `config.json` example moved from README L134–148 (`orgRepo`, `orgBranch`, `allowedEmailDomains`, `orgInjection`, `enableMultilingualSearch`, `embeddingModel`, vault paths).
- **`plugins/total-recall/README.md`** — unchanged stub.
- **`docs/QUALITY.md`, `docs/COMPARISON.md`, `docs/TOOLS.md`, `SECURITY.md`, `docs/SPEC-DRIVEN.md`, `plugins/total-recall/ARCHITECTURE.md`** — unchanged; new README links point at them.
- **`BACKLOG.md`** — one line recording the README redesign decision.
- **This file** — deleted after implementation (or moved to `docs/plans/` together with the other root `PLAN-*.md` files); decide once for all three.

## §8 Implementation checklist & acceptance criteria

0. **Verify before writing:** re-running `install.sh --org-repo …` on an existing solo install works without redoing anything. If yes, add "start solo, add the team later" to §10; if not, leave it out.
1. **PR 1 — structure:** move/condense content per §4 and §7 (Configuration → HOW-IT-WORKS, team bullets → INSTALL.md, Languages trimmed), no new hooks. Facts verbatim from existing docs.
2. Mirror to `README-ro.md` (§6).
3. **PR 2 — hooks:** badges, comparison line, data section, architecture summary, exit line, `<details>` block.
4. Link check: every relative link and `#anchor` in both READMEs and INSTALL.md resolves (grep target file + GitHub slug of target heading).
5. Word count and duplication audit (§4 budget; §3.1 map shows each item exactly once outside the intentional marketplace duplicate).

Splitting into two PRs means a rewrite that misses the criteria below can still ship its structural half.

**Acceptance criteria (each checkable):**
- **Install from README alone:** a fresh `HOME` + the README's Claude Code steps → the verify step passes; separately, the `<details>` steps alone → `get_stats` answers from a non-Claude MCP client (Codex CLI or VS Code).
- **First screen:** What / Why / Cost / Trust / Risk all appear within the first ~25 rendered lines.
- **Persona check:** §4.1 table satisfied; then one agent per persona, each given only the new README and its linked files, reports at least one hook and no install blocker.
- **Budget:** ≤ ~1,700 prose words per README (code blocks and `<details>` excluded).
- **Drift:** every `install.sh` flag named in README, README-ro and INSTALL.md appears in `./install.sh --help` (repo CLAUDE.md "Docs must track install.sh").
- **Parity:** EN ≡ RO structurally (§6 check).

**Risks & mitigations:**

| Risk | Mitigation |
|---|---|
| Link/anchor drift after restructure | §6 anchor policy + §8 step 4 link check |
| EN/RO divergence over time | same-order sections + heading-parity check |
| Numbers in README go stale | only the CI-status badge is a badge; numbers update with QUALITY.md each release |
| Recording leaks private memory titles | throwaway `HOME`; recording is optional |
| Content deleted from README with no other home | §3.1 map lists the only copy; moves happen in the same PR as the deletion |
