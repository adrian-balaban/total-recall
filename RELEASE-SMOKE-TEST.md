# Post-release smoke test — total-recall

Manual checklist to run after `claude plugin update total-recall` picks up a
new version. CI (`mutation.yml`) already proves the code is correct in
isolation; this catches packaging/runtime regressions that no unit test can
see — a missing `.mcp.json` server, a stale plugin cache, a broken native
binding — because those only surface in a real installed plugin, in a real
Claude Code session, talking to the real filesystem.

Run this after every release, not just hardening ones. 
---

## 0. Before updating

- [ ] Note current version: `claude plugin list` or check `~/.claude/plugins/cache/.../total-recall/<old-version>/`
- [ ] Note current `claude mcp list` output (should show `total-recall` connected)
- [ ] If testing org sync, note `~/.total-recall/org/.sync.log` tail and `.sync-ok` timestamp

## 1. Update + restart

- [ ] `claude plugin update total-recall` (or `/plugin` → update)
- [ ] Fully restart Claude Code (not just a new session — the MCP server process must respawn)
- [ ] Confirm new version: `claude plugin list` shows the expected version

## 2. MCP server actually started (the 1.2.0–1.3.1 regression class)

- [ ] `claude mcp list` shows `total-recall` as **connected**, not missing
- [ ] This session has the 22 total-recall tools available (not just the SessionStart-injected index)
- [ ] `~/.claude.json` / plugin cache: `plugins/total-recall/.mcp.json` declares `mcpServers.total-recall` as stdio pointing at `${CLAUDE_PLUGIN_ROOT}/dist/index.js`

## 3. SessionStart injection

- [ ] New session shows the "Total Recall vX.Y.Z active" banner with the **correct** version (not a stale cached one — this drifted before, see TR-REVIEW-PLAN P3)
- [ ] Memory index is injected and non-empty (assuming vault has memories)

## 4. Core tool round-trip

- [ ] `store_memory` a throwaway personal memory (clear title, e.g. `smoke-test-<timestamp>`)
- [ ] `search_index` or `recall_memory` finds it
- [ ] `get_memories_by_keys` returns it with full content
- [ ] `update_memory` changes its content; re-fetch confirms the change
- [ ] `delete_memory` removes it; confirm it's gone from `list_memories` and from disk (`~/.total-recall/personal-vault/`)

## 5. Vector / embedding path

- [ ] `get_stats` reports `vector.enabled: true` (or check `depsPresent`)
- [ ] Store a memory, wait a few seconds, confirm no error in `get_stats.recentErrors` about embedding/sqlite-vec
- [ ] If this is a **fresh plugin-cache version dir** (first run after `claude plugin update`, not just a restart): specifically check for the "Could not locate binding file" self-heal path — `better-sqlite3` ships source-only per version dir and needs a rebuild. Should self-heal silently; if it doesn't, `recentErrors` should say the binding is "still missing" and name `npm rebuild better-sqlite3` as the fix (never trust npm's exit code alone here)
- [ ] **Cross-language semantic search.** `get_stats.vector.model` should be `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (or whatever `embeddingModel` is configured) — a genuinely multilingual model, not an English-only one. Store a throwaway memory with ENGLISH-only content (no Romanian words), then call `rerank_memories` with a ROMANIAN query describing the same idea against a candidate list containing that key plus 2-3 unrelated keys (and vice versa: a Romanian memory, an English query). The correct match's cosine score should be clearly separated from the unrelated candidates (e.g. 0.5+ vs <0.25) — that is direct evidence the embeddings do cross-language semantic matching, isolated from ranking/fusion effects. Delete the throwaway after.
  - Do **not** use `recall_memory` for this check — its hybrid path merges TF-IDF and vector lists via Reciprocal Rank Fusion (`rrf.ts`, rank-based, not score-based), and a memory with ZERO lexical overlap can rank #1 in the vector list yet still be out-ranked in the fused result by memories that place decently in *both* lists. That's RRF behaving as designed, not a vector-search defect — but it means `recall_memory` alone is the wrong tool to verify the embeddings are doing their job.

## 6. Org vault + sync (only if org vault configured)

- [ ] Store a throwaway memory tagged `org`
- [ ] Check `~/.total-recall/org/.sync.log` for a fresh successful push entry
- [ ] Check the remote org-sync branch (`orgBranch` in config.json) on GitHub for the new commit
- [ ] `delete_memory` it (force if needed) and confirm it's gone from `org-vault/index.json` locally AND the remote branch
- [ ] Confirm the PostToolUse hook matcher fired — no entries in `.sync-errors.log` for this session

## 7. Hooks sanity

- [ ] `SessionStart`: org vault pulled, index rebuilt, no errors in hook output
- [ ] `PreCompact` (if a long session / manual compact triggers it): check personal vault for any auto-captured learning `.md` files
- [ ] `SessionEnd` on quit: check `~/.total-recall/personal-vault/.git log -1` — H1 auto-commit should have a fresh commit if the vault is a git repo

## 8. Error-path spot check (only if a recent change touched these)

- [ ] Tool error text is redacted — trigger an EACCES/ENOENT (e.g. chmod a vault file 000, try to recall it) and confirm the error mentions `~` or `<org-vault>`, not an absolute path with the real username
- [ ] If bulk/import changed: round-trip `export_memories` → `import_memories` on a throwaway key, confirm counts match

## 9. Regression-specific checks (update this section per release)

<!-- Add release-specific checks here before running, based on what changed.
     Delete old entries once confirmed on a subsequent release. -->

- [ ] (1.3.3) Confirm `redactPaths` applies to tool errors generally, not just `get_stats.recentErrors`
- [ ] (1.3.3) Confirm embed bursts (bulk import of ~10 memories) don't throw or hang — the bounded-concurrency limiter was tried and reverted this release, so embeds are unbounded again by design; just confirm nothing crashes

---

## If something fails

- MCP server missing → check `.mcp.json` wasn't emptied again (`plugin-manifest.test.ts` should have caught this in CI, but verify the installed cache dir matches what's on `release` branch)
- Vector binding issue → `npm rebuild better-sqlite3` inside the plugin's version dir, or reinstall
- Org sync silent failure → check `.sync-errors.log`, confirm `orgRepo`/`orgBranch` in config.json are still correct
- Anything else → check `get_stats.recentErrors` first; it's the one place runtime errors are supposed to surface
