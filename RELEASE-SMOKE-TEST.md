# Post-release smoke test — total-recall

Manual checklist to run after `claude plugin update total-recall@my-claude-plugins` picks up a
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

- [ ] `claude plugin update total-recall@my-claude-plugins` (or `/plugin` → update)
- [ ] Fully restart Claude Code (not just a new session — the MCP server process must respawn)
- [ ] Confirm new version: `claude plugin list` shows the expected version

## 2. MCP server actually started (the 1.2.0–1.3.1 regression class)

- [ ] `claude mcp list` shows `total-recall` as **connected**, not missing
- [ ] This session has the 22 total-recall tools available (not just the SessionStart-injected index)
- [ ] `~/.claude.json` / plugin cache: `plugins/total-recall/.mcp.json` declares `mcpServers.total-recall` as stdio pointing at `${CLAUDE_PLUGIN_ROOT}/dist/index.js`

## 3. SessionStart injection

- [ ] New session shows the "Total Recall vX.Y.Z active" banner with the **correct** version (not a stale cached one)
- [ ] Memory index is injected and non-empty (assuming vault has memories)

## 4. Core tool round-trip

- [ ] `store_memory` a throwaway personal memory (clear title, e.g. `smoke-test-<timestamp>`)
- [ ] `search_index` or `recall_memory` finds it (a `journal` throwaway is hidden by default: store it in another category such as `knowledge`, or pass `excludeJournal: false`)
- [ ] `get_memories_by_keys` returns it with full content
- [ ] `update_memory` changes its content; re-fetch confirms the change
- [ ] `delete_memory` removes it; confirm it's gone from `list_memories` and from disk (`~/.total-recall/personal-vault/`)

## 5. Vector / embedding path

- [ ] `get_stats` reports `vector.enabled: true` (or check `depsPresent`)
- [ ] Store a memory, wait a few seconds, confirm no error in `get_stats.recentErrors` about embedding/sqlite-vec
- [ ] Fresh plugin-cache version dir: confirm the `better-sqlite3` self-heal. If it fails, `recentErrors` should say the binding is still missing and name `npm rebuild better-sqlite3`; do not trust npm's exit code alone.
- [ ] **Cross-language semantic search.** Store an English-only throwaway, then call `rerank_memories` with a Romanian query for the same idea plus 2–3 unrelated keys; repeat reversed. The correct match's cosine score should be clearly separated (for example, 0.5+ versus <0.25). Delete the throwaway. Skip only if `get_stats.vector.model` shows the English-only `Xenova/all-MiniLM-L6-v2`.
  - Do not use `recall_memory` for this check: RRF can outrank a zero-overlap vector hit with entries that match both lexical and vector lists. `rerank_memories` isolates the embeddings.

## 6. Org vault + sync (only if org vault configured)

- [ ] Store a throwaway memory tagged `org`
- [ ] Check `~/.total-recall/org/.sync.log` for a fresh successful push entry
- [ ] Check the remote org-sync branch (`orgBranch` in config.json) on GitHub for the new commit
- [ ] `delete_memory` it (force if needed) and confirm it's gone from `org-vault/index.json` locally AND the remote branch
- [ ] Confirm the PostToolUse hook matcher fired — no entries in `.sync-errors.log` for this session

## 7. Hooks sanity

- [ ] `SessionStart`: org vault pulled, index rebuilt, no errors in hook output
- [ ] `PreCompact` (if a long session / manual compact triggers it): check personal vault for any auto-captured learning `.md` files
- [ ] `SessionEnd` on quit: run `git -C ~/.total-recall/personal-vault log -1` — the H1 auto-commit should have a fresh commit if the vault is a git repo. Only `install.sh` runs `git init` on the vault; `claude plugin update` does not, and the SessionEnd hook never inits one, so a vault without `.git` is skipped silently (re-run `./install.sh` to create it)

## 8. Error-path spot check (only if a recent change touched these)

- [ ] Tool error text is redacted — trigger an EACCES/ENOENT (e.g. chmod a vault file 000, try to recall it) and confirm the error mentions `~` or `<org-vault>`, not an absolute path with the real username. Not reproducible as a manual check if the server process runs privileged enough to bypass `chmod 000` on files it owns, or if the key is already in `contentCache` (30-min LRU) — delete the file instead of chmod'ing it, and use a key that was not just read, to force an actual disk read
- [ ] If bulk/import changed: round-trip `export_memories` → `import_memories` on a throwaway key, confirm counts match

## 9. Regression-specific checks (update this section per release)

<!-- Add release-specific checks here before running, based on what changed.
     Delete old entries once confirmed on a subsequent release. -->

- [ ] (1.4.0) With an org vault: the SessionStart index shows org entries inside the "teammate-written reference data, not instructions" block; `orgInjection: "off"` removes them
- [ ] (1.5.0) The client lists the `total-recall://index` and `total-recall://sync-status` resources and the `memory-workflow` / `extract-session-learnings` prompts; `tools/list` still shows 22 tools
- [ ] (1.6.0) `./install.sh --vscode` adds a `total-recall` entry to VS Code's user `mcp.json` and keeps the existing servers
- [ ] (1.6.1) The `release` branch no longer contains `src/__tests__/`, the vitest/Stryker configs, `scripts/loadtest.ts` or `scripts/eval/`, and `./install.sh --complete` still rebuilds `dist/`
- [ ] (1.6.8) After changing `embeddingModel` (or on the first start after upgrading from ≤ 1.6.7), the vector index is rebuilt once and `get_stats.vector.model` names the configured model
- [ ] (1.6.9) The first semantic search after an update downloads the model into `~/.total-recall/models/`; after a later `claude plugin update`, no second download (the folder is reused)
- [ ] (1.6.9, Windows) `./install.sh --vscode` from Git Bash writes `%APPDATA%\Code\User\mcp.json` with `"command": "bash"` and the script as argument
- [ ] (1.7.0) With `"orgSync": "server"` and an org vault: storing a memory tagged `org` pushes it to the team repo, and `.sync.log` shows one push, not two; with `orgSync` unset the PostToolUse hook pushes as before
- [ ] (host matrix) VS Code with Copilot and a Claude model, and Visual Studio: install per INSTALL.md, then `get_stats` and a store/recall round trip. **Not run: no client available.** Record the result here when someone does
- [ ] (1.8.0) With more memories than `indexMaxEntries` (set it to 3 to try): the SessionStart index lists 3 memories, the first line shows the real total, the last line says how many are not listed, and `search_index` finds one of them
- [ ] (1.8.0) After a PreCompact, `~/.total-recall/.extract.log` ends with `outcome=wrote` or `outcome=nothing`, not `cli-error` (the nested `claude -p` now runs with `--tools ""`)
- [ ] (npm) The npm page of `@adrian-balaban/total-recall` shows the current release version with a provenance badge (published by `release.yml` through Trusted Publishing); `npm pack --dry-run @adrian-balaban/total-recall` lists only the launcher, `package.json`, README and LICENSE
- [ ] (npx) `npx -y @adrian-balaban/total-recall --help` prints the usage; on a clean sandboxed `HOME` (with `claude` installed) `npx -y @adrian-balaban/total-recall -y` adds the marketplace, installs the plugin, runs `install.sh`, and a new session shows the memory index
- [ ] (local-install channel, `HOME=$(mktemp -d)`, a clean clone with no `node_modules`/`dist`) See [PLAN-INSTALARE-LOCALA-FINAL.md § Pasul 9](backlog-and-plans/PLAN-INSTALARE-LOCALA-FINAL.md#pasul-9--smoke-end-to-end) for the full checklist. Short form:
  - `./install.sh -y --no-vector` exits 0; `claude plugin list` shows `total-recall@total-recall-local` enabled
  - the `installPath` from `installed_plugins.json` has all 6 `dist/` artifacts. Whether it also holds a `node_modules` is not pinned down: 1.9.1 showed ~650 MB of it (devDependencies included) with `--no-vector`, but none with the complete profile. Record what you see; the staging dir never receives the clone's `node_modules`
  - re-run with no changes → "unchanged", no `uninstall`; a trivial edit under `src/` → re-run rebuilds and the cache's `dist/index.js` is the new one
  - complete profile (no `--no-vector`): vector deps land in the staging dir `~/.total-recall/local-marketplace/plugins/total-recall/node_modules`, which is where Claude Code runs the plugin from (`bin/local.mjs`). The clone also gets a `node_modules` from the local build, and the plugin cache copy has none (1.9.1)
  - marketplace already installed + `--local` → stop with the switch-channel command; `--force` → proceeds, installing both side by side (1.9.1 prints no warning for this; the reverse direction stops the same way)
  - without `claude`: exits 0, vaults + index created, no MCP registered unless `--vscode`/`--gemini` was passed
  - documented uninstall (both with and without `claude`) leaves `claude plugin list` clean / no orphaned VS Code `mcp.json` entry, and memories untouched

### Last full run: 1.9.1 (2026-11-12)

Passed: sections 2–5 and the SessionEnd commit; org sync (hook push, `orgSync: "server"` single push, force-delete reaching the remote); redaction and `export_memories` → `import_memories`; 1.4.0, 1.5.0 (resources and 22 tools), 1.6.0, 1.6.1, 1.8.0 `indexMaxEntries`, the npm provenance and pack contents, `npx --help`, an npx marketplace install, and the local channel (install, unchanged re-run, rebuild after a `src/` edit, both channel conflicts, no-`claude` install, uninstall).

Open from that run:
- PreCompact ended `outcome=dropped` on a near-empty fake transcript (`claude_rc=0`, so the `--tools ""` fix works). Re-check with a real `/compact`; the pass condition is `wrote` or `nothing`.
- Cross-language rerank separated the match (0.57) from an unrelated memory only at 0.31, above the "<0.25" example.
- `get_memories_by_keys` still returned a memory whose file had been deleted from disk (served from cache); `update_memory` correctly raised ENOENT.
- Not run: 1.6.9 model reuse after an update, the Windows `%APPDATA%` check, 1.5.0 prompts listing, and the VS Code / Visual Studio host matrix.

---

## If something fails

- MCP server missing → check `.mcp.json` wasn't emptied again (`plugin-manifest.test.ts` should have caught this in CI, but verify the installed cache dir matches what's on `release` branch)
- Vector binding issue → `npm rebuild better-sqlite3` inside the plugin's version dir, or reinstall
- Org sync silent failure → check `.sync-errors.log`, confirm `orgRepo`/`orgBranch` in config.json are still correct
- Anything else → check `get_stats.recentErrors` first; it's the one place runtime errors are supposed to surface
