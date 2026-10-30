# 📱 Plan: Total Recall in Cline (VS Code extension) with Claude models

Status: **proposal**, nothing implemented yet. Date: 2026-10-30.

Question that triggered this plan: *"is this plugin ready for being used in Visual Studio plugin with Claude models?"* — read here as **Cline, the VS Code extension**, running **Claude models through its Anthropic provider**.

Every claim below was checked against the code (`plugins/total-recall/` at `68be008`) and against Cline's own docs/blog (fetched 2026-10-30). Where a claim can only be settled by running Cline, it is listed as a spike item and the plan does not depend on it.

---

## ⚡ TL;DR

- **Verdict: not ready.** Nothing in the repo wires Cline today: no MCP registration step, no config template, no docs, no hook mapping. A Cline user can hand-wire the MCP server and get the degraded "Codex-style" experience (22 tools on demand, no proactive injection, no auto-capture) — but the repo neither helps nor documents it.
- **Cline is nevertheless the most portable target of the three harnesses examined** (Claude Code, VS/VS Code Copilot, Cline):
  - its MCP settings file (`cline_mcp_settings.json`) uses the **same top-level `mcpServers` shape** as Claude Code's `.mcp.json`, plus Cline-specific `autoApprove` / `disabled` keys;
  - it runs **Claude models first-class** via the Anthropic provider;
  - since **v3.36 (Nov 2025) it has hooks**, and the event mapping to total-recall's lifecycle is good (see the table below).
- **Ship it in 5 PRs**, targeting **1.5.0** (1.4.0 is earmarked for the org-injection work in BACKLOG.md, which this plan depends on — see Risks):
  1. spike + docs ("Codex-style" support),
  2. `install.sh --cline` (MCP registration),
  3. rules-based proactive memory (works everywhere, including Windows),
  4. hook adapters for macOS/Linux (`TaskStart`, `TaskResume`, `PostToolUse`),
  5. verification + Windows hardening.
- **Two hard platform caveats:** Cline hooks are **macOS/Linux only** (no Windows support), and there is **no PreCompact / TaskCompleted event** — so compaction-time extraction has no hook to hang on and must be rules-driven everywhere.

## 🔍 What the code and Cline's docs say

### What already works with zero changes

| Fact | Source |
|---|---|
| The MCP server is a plain stdio process (`node dist/index.js`) exposing 17 memory + 5 architecture tools (spec tools config-gated); model-agnostic | `plugins/total-recall/.mcp.json`, `src/tools/*` |
| Cline speaks MCP; config shape `{"mcpServers": {"<name>": {"command", "args", "env", "disabled", "autoApprove"}}}` — same envelope as Claude Code's `.mcp.json` plus two Cline keys | [docs.cline.bot/mcp/mcp-overview](https://docs.cline.bot/mcp/mcp-overview) (updated 2026-10-07) |
| Config locations: CLI `~/.cline/data/settings/cline_mcp_settings.json` (override with `CLINE_MCP_SETTINGS_PATH`); VS Code extension: MCP Servers panel → Configure tab; scriptable via `cline mcp add total-recall --yes -- node /abs/path/dist/index.js` | same |
| Claude models are a first-class Cline provider (Anthropic; also OpenRouter/Bedrock routes to Claude) | [docs.cline.bot/provider-config/anthropic](https://docs.cline.bot/provider-config/anthropic) |
| Cline has lifecycle hooks (v3.36+): six event types, script-per-event, JSON on stdin, JSON out | [cline.bot/blog/cline-v3-36-hooks](https://cline.bot/blog/cline-v3-36-hooks) |

### Hook mapping: total-recall (Claude Code) → Cline

| Claude Code hook (what it does) | Cline event | Fit |
|---|---|---|
| `SessionStart` → `pull-org-vault`, `build-memory-index`, `load-memory-index` (injects the Active Memory Index + retrieval decision tree via `hookSpecificOutput.additionalContext`), `check-sync-errors` | **TaskStart** — `contextModification` injects text into the conversation | ✅ good. Fires **per task**, not per session — slightly more often than Claude Code's SessionStart; the existing dedup marker (`## Total Recall v`, `load-memory-index.sh:51-68`) must be preserved so a task resume doesn't double-inject. **TaskResume** re-injects after interruptions — a bonus Claude Code doesn't have. |
| `PostToolUse` matcher `mcp__plugin_total-recall_total-recall__(store_memory\|update_memory\|delete_memory)` → `sync-org-memory.sh` | **PostToolUse** — receives tool name + results | ⚠️ **Cline has no matcher system.** The filter must live *inside* an adapter script (same rule as `[TR-C4]`, enforced in-script instead of in `hooks.json`). Unknown whether Cline's PostToolUse fires for MCP tool calls at all, and with what tool-name format — spike item; the adapter degrades to a no-op until confirmed. |
| `PostToolUse` matcher `Write\|Edit\|MultiEdit` → `architecture-change.sh` | **PostToolUse** | ⚠️ same as above; Cline's built-in file-write tool names (`write_to_file`, `replace_in_file`) differ from Claude Code's — the in-script filter must match Cline's names. |
| `PreCompact` → `extract-and-store-memories.sh` (pulls `transcript_path` from stdin, feeds it to `claude -p`, writes JSON-line learnings via `store-learning.mjs`) | — **no equivalent event** | ❌ No compaction hook exists. Rules-based mitigation (PR 3): the `.clinerules` rule instructs the agent to store learnings *before finishing a task*. Note `extract-and-store-memories.sh` also hard-depends on the `claude` CLI (`extract-and-store-memories.sh:31`) — irrelevant for Cline unless a compaction event appears. |
| `SessionEnd` → `session-end.sh` (log marker, belt-and-braces SIGTERM flush, local git snapshot) | — **no equivalent event** | ❌ Acceptable loss: the MCP server's own stdin-end handler is the primary flush trigger (`session-end.sh:6-16`); the hook is observability + snapshot, not correctness. The vault snapshot idea could hang off **TaskCancel** later (deferred). |

### Why it is not ready — the gap list

1. **No wiring exists for Cline anywhere.** `install.sh` has steps for Claude Code (Step 3 MCP registration), statusline (5b), and Gemini (`5c`, `--gemini`) — nothing for Cline. `INSTALL.md` documents only Claude Code, Gemini, and a "Codex CLI (MCP only, no hooks)" caveat.
2. **`${CLAUDE_PLUGIN_ROOT}` does not resolve in Cline.** `.mcp.json` and `gemini-extension.json` both rely on client-provided path variables (`${CLAUDE_PLUGIN_ROOT}`, `${extensionPath}`); Cline's settings file needs a **resolved absolute path** to `dist/index.js`.
3. **The hook envelopes differ in both directions.** Cline wants one executable script **named exactly the event** (no extension) in `.clinerules/hooks/` (project) or `~/Documents/Cline/Rules/Hooks/` (global), reading a Cline-specific stdin envelope (base fields `clineVersion`, `hookName`, `timestamp`, `taskId`, `workspaceRoots`, `userId`) and emitting `{"cancel": bool, "errorMessage"?, "contextModification"?}` — not Claude Code's `{"continue":true,"hookSpecificOutput":{"hookEventName":...,"additionalContext":...}}`. Reusing the existing scripts unmodified would inject nothing (`load-memory-index.sh` emits a Claude-shaped envelope) and could even **cancel operations** (a `cancel:true`-shaped misfire blocks the tool call). Thin adapters are required — the `hooks.gemini.json` precedent shows this repo already ships per-client envelopes.
4. **Cline hooks don't run on Windows.** Announced macOS/Linux-only in v3.36; not re-confirmed since (spike). Windows Cline users get the rules-only path (PR 3).
5. **`contextModification` shapes the next API request, not the current one** (Cline blog). For TaskStart that is fine (nothing has been generated yet), but it means the injected index behaves slightly differently than Claude Code's SessionStart injection. Document; don't fight it.
6. **The hooks docs moved.** `docs.cline.bot/customization/hooks` is now a stub ("See details under SDK Plugins page") — the hooks system may have been folded into the Cline SDK/Plugins model since v3.36. Spike must confirm the current location, event set (did `TaskCompleted` land?), and settings toggle before PR 4 ships.

---

## 🗂️ The plan — 5 PRs, target release 1.5.0

Legend: every PR is independently shippable; PR 2–4 depend only on PR 1's spike results, not on each other. All new MCP behavior stays **additive and config-gated** (`[TR-C1]`); all tool errors keep path redaction (`[TR-C3]`).

### PR 1 — Spike + docs ("Codex-style" support lands here)

**Spike (manual, results recorded in the PR description):**

1. Register the server in Cline (all three routes): MCP Servers panel → Configure; direct edit of `cline_mcp_settings.json`; `cline mcp add total-recall --yes -- node <abs>/plugins/total-recall/dist/index.js`.
2. Pick a Claude model via the Anthropic provider; confirm all 22 tools are listed; run a store→recall roundtrip; confirm `get_stats` reports `vector.enabled` correctly.
3. Confirm the **PostToolUse-for-MCP-tools** question: does the event fire for MCP tool calls, and what is the tool-name format in the stdin payload?
4. Confirm `autoApprove` semantics for MCP tools (exact tool-name format the list expects) so PR 2 can auto-approve read-only tools safely.
5. Re-confirm hooks status: current docs location (SDK Plugins?), event set (TaskCompleted?), Windows support, settings toggle.
6. Windows: repeat 1–2 on a Windows machine (settings path `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` for the VS Code extension; `~/.cline/data/settings/…` for the CLI).

**Docs (the only change in this PR):**

- `plugins/total-recall/INSTALL.md`: new section **"Cline (VS Code extension, Claude models)"** modeled on the existing Codex CLI section — what works (22 MCP tools on demand), what doesn't without hooks (no index injection, no auto-capture), the three registration routes, Claude model selection, and the macOS/Linux-only hooks caveat.
- `RELEASE-SMOKE-TEST.md`: a Cline smoke entry (register → 22 tools listed → store → recall → `get_stats`).

### PR 2 — `install.sh --cline` (MCP registration)

Mirror Step 5c (Gemini) as **Step 5d**, flag `--cline`:

- Target file: prefer `~/.cline/data/settings/cline_mcp_settings.json` (CLI-canonical, one path for all OSes); honor `CLINE_MCP_SETTINGS_PATH` if set. IDE-only users without the CLI get a printed pointer to the panel route (same warn-but-don't-fail pattern as the missing `agy` CLI).
- Idempotent, state-aware merge into the `mcpServers` object (never clobber other servers; skip if a `total-recall` entry already exists and points at the same absolute path); back up the file before first write.
- Entry (path resolved at install time — no client-side variable substitution):

```json
{
  "mcpServers": {
    "total-recall": {
      "command": "node",
      "args": ["/abs/path/to/plugins/total-recall/dist/index.js"],
      "env": {},
      "disabled": false,
      "autoApprove": ["recall_memory", "search_index", "get_memories_by_keys",
                       "list_memories", "get_related_memories", "get_timeline",
                       "get_stats", "rerank_memories", "confirm_memory"]
    }
  }
}
```

  Read-only tools in `autoApprove` (spike result 4 decides the exact names/format); all write tools (`store_memory`, `update_memory`, `delete_memory`, `delete_memories`, `prune_memories`, `import_memories`, `rebuild_index`, org-synced writes) stay manually approved — consistent with the plugin's fail-closed privacy posture.
- Build `dist/` first if missing (the existing Step-1/4 helpers already do this).
- Tests: follow the repo's hook-script test conventions for the merge helper (temp HOME, assert idempotent re-run and no clobbering of foreign servers); full-path registration asserted.

### PR 3 — Rules-based proactive memory (all platforms, including Windows)

Cline's `.clinerules` are loaded into every conversation — this is the portable stand-in for SessionStart injection, and it is the **only** mechanism that works on Windows and for users who keep hooks off.

- Ship a copy-ready rule file, e.g. `plugins/total-recall/cline/total-recall.clinerule` (workspace: `.clinerules/total-recall.md`; global rules dir also works), with three directives mirroring the injected index's own instructions (`load-memory-index.sh:51-68`):
  1. **At task start** — call `recall_memory` / `get_memories_by_keys` for anything the task touches before proposing an approach (retrieval decision tree, same 4 steps);
  2. **While working** — call `store_memory` directly (not via a subagent) for decisions/preferences/failures, check duplicates first, include the WHY;
  3. **Before finishing** — store a short session summary (this replaces the missing PreCompact/TaskCompleted capture).
- Position it in the docs as the durable backend for Cline's Memory Bank pattern (Cline's own best-practice doc) — total-recall *is* a memory bank that survives workspaces and is greppable/git-versionable.
- Optionally add one **additive, config-gated MCP tool** `get_memory_index` returning the Active Memory Index text (the same content the SessionStart hook injects, read from `~/.total-recall/.index-cache.txt` after `rebuild_index`), so the rule can point at one deterministic call instead of describing the cache file. Gated behind `specDriven`-style config (default off until 1.5.0 flips it on), schema additive per `[TR-C1]`, redaction per `[TR-C3]`. Tests: new file in `src/__tests__/` alongside the other tool tests (the reset-vault pattern used by `rerank.test.ts`).

### PR 4 — Hook adapters (macOS/Linux only)

New directory `plugins/total-recall/hooks/cline/` — thin adapters that **reuse** the existing scripts rather than duplicating them (the memory-file format and cache stay the single source of truth, `[TR-C6]` tolerant reader):

- `TaskStart` → runs `pull-org-vault.sh`, `build-memory-index.sh`, then `load-memory-index.sh`'s core, and emits the **Cline envelope**: `{"cancel": false, "contextModification": "<same Active Memory Index block, including the ## Total Recall v<version> dedup marker>"}`. The dedup marker matters double here: it must also detect a marker already present in Cline's forwarded context and emit `{"cancel": false}` with no `contextModification` (parity with the existing hook-level dedup at `load-memory-index.sh:8-24`).
- `TaskResume` → same adapter, minus the org pull (idempotent re-injection with dedup marker).
- `PostToolUse` → reads Cline's stdin envelope, extracts the tool name + payload, maps it onto the **Claude Code PostToolUse stdin shape** (`tool_name`, `tool_input`, `tool_response`) that `sync-org-memory.sh` already parses (all three `tool_response` shapes, `sync-org-memory.sh:13-66`), and pipes it through. **In-script matcher** replaces `hooks.json`'s regex (Cline has none): fire `sync-org-memory.sh` only for total-recall's `store|update|delete_memory` tool names, `architecture-change.sh` only for Cline's file-write tools — the `[TR-C4]` rule, enforced in-script. If spike result 3 comes back negative (MCP tools may not fire PostToolUse), ship the adapter anyway (it no-ops) and lean on PR 3's rule for org sync until Cline confirms the event. Unknown payload fields degrade to "no key found" → early return (the script already handles that silently).
- No `PreCompact` / `SessionEnd` adapters — events don't exist; document why (flush is the MCP server's stdin-end handler; capture moved to rules).
- Distribution: `install.sh --cline` copies the three adapters into `.clinerules/hooks/` of the **current project** (opt-in, with printed instructions for the global `~/Documents/Cline/Rules/Hooks/` route), and reminds the user to enable Hooks in Cline settings → Features.
- Tests: new `cline-hooks.test.ts` beside `sync-org-memory-hook.test.ts` / `extract-and-store-hook.test.ts` — Cline stdin envelope parsed; Claude envelope never emitted on the Cline path; PostToolUse adapter no-ops for non-matching tools and for malformed stdin; dedup marker suppresses double injection; adapters exit 0 with valid JSON on every input (Cline shows hook failures in the UI).

### PR 5 — Verification + Windows hardening

- Windows smoke (rules-only expected): MCP registration + Claude model + 22 tools + store/recall; confirm hooks are simply absent (no scary errors); document the `better-sqlite3` Windows-native-binding note (same class of issue as the `claude plugin update` case in INSTALL.md, `npm rebuild better-sqlite3`).
- Confirm Cline's multi-root workspace behavior (`workspaceRoots` base field) doesn't break vault path resolution (vault paths come from `~/.total-recall/config.json`, not the workspace — should hold; assert in the spike).
- Re-run the full gates: `npm test`, `test:integration`, `npm run mutation` (new adapters are bash — out of Stryker scope like the other hook scripts), update the plugin manifest description ("Claude Code & Gemini" → "+ Cline"), `README.md` TL;DR, and this plan's status line.

---

## ⚠️ Risks / open questions

| Risk | Mitigation |
|---|---|
| Cline hooks docs now live under "SDK Plugins" — the system may have been renamed/extended since v3.36 | Spike 5 gates PR 4; adapters are additive files, safe to ship after confirmation; the rules path (PR 3) works regardless |
| PostToolUse may not fire for MCP tool calls (org sync would silently no-op — the exact bug class `sync-org-memory.sh:6-10` documents for Claude Code) | Spike 3; if unfireable, PR 3's rule adds an explicit "after storing an `org`-tagged memory, run the org sync" instruction and the adapter ships as a no-op until Cline confirms |
| `contextModification` only shapes the *next* request | Fine for TaskStart/TaskResume (nothing generated yet); documented, not fought |
| Windows: no hooks at all | PR 3 is the Windows story; PR 5 documents it |
| Org-vault inbound injection applies here too — `contextModification` injects the org index into every Cline session, unfiltered | Same known issue as Claude Code (README "Known issues", BACKLOG 1.4.0). **Dependency: land 1.4.0's framing + opt-out first; Cline support rides the same fix.** This is why the target is 1.5.0, not 1.4.x |
| Two clients installed side-by-side (Claude Code + Cline in the same repo) double-inject | Dedup-marker parity in the TaskStart adapter (PR 4); the existing marker already handles two CLI clients |

## 🚫 Rejected or deferred

- **Bundling as a Cline "plugin"** (SDK Plugins) — premature before the spike settles what that system is; the `.clinerules` + settings-file route needs nothing from it. Revisit if Cline gains a plugin marketplace.
- **Porting `skills/` to Cline Skills** — the two `SKILL.md` files are Claude Code-shaped; a Cline port is real work with no user request behind it yet. Deferred with trigger: first user ask.
- **PreCompact / SessionEnd adapters** — events don't exist in Cline. Revisit if `TaskCompleted` / compaction hooks land (spike 5 watches for this).
- **`TaskCancel` adapter** — the SIGTERM-flush job is Claude Code-specific (it papers over the MCP child lifecycle); Cline's MCP server shutdown follows its own stdin-end path. Deferred.
- **npm distribution / zip download** — repo policy is one channel (the marketplace), unchanged by this plan; Cline users clone + `install.sh --cline`, same as `--gemini` users do via `agy`.




