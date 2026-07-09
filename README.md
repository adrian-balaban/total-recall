# claude-plugins-total-recall

Claude Code plugin repository with total-recall plugin.

## Plugins

- **total-recall** — Persistent memory plugin: MCP server (12 tools), SessionStart/PostToolUse/PreCompact hooks, the `memory-workflow` and `review-fix-ship` skills, and an `install.sh` setup script. Personal vault at `~/.total-recall/personal-vault/`. Org vault (for `org`-tagged memories) syncs to a GitHub repo configured via `~/.total-recall/config.json` (`orgRepo` key, branch `org-vault`) with privacy filtering on every store/update/delete.

## Proactive memory-saving behavior

Claude saves memories automatically — no explicit request needed — when:

- **Work observations** — style preferences, validated approaches, what worked vs. what didn't
- **Non-obvious project context** — motivations, external constraints, non-trivial decisions
- **At session end** — ask explicitly: "is there anything from today I should remember?"

Not saved: code, architecture, file paths, git history (derivable from the repo).

## Three ways to call total-recall tools

### 1. Via MCP tool directly (in this session)

I call them as tool calls — e.g. `mcp__plugin_total-recall_total-recall__get_stats`. You can ask me to run any of them:

> "run get_timeline" or "list all memories" or "search for X"

### 2. Via the total-recall:memory-workflow skill

```
/total-recall:memory-workflow
```

Guides a structured recall/store session.

### 3. Direct MCP tool names (for asking me to call them)

| What you want | Say / tool name |
|---|---|
| Stats snapshot | "get total-recall stats" → `get_stats` |
| Fetch by known key(s) | "get memory by key" → `get_memories_by_keys` |
| Browse all memories | "list memories" → `list_memories` |
| Search by query | "recall X" → `recall_memory` / `search_index` |
| Store something | "remember X" → `store_memory` |
| Update a memory | "update memory [key]" → `update_memory` |
| Delete a memory | "forget X" → `delete_memory` |
| Recent timeline | "show memory timeline" → `get_timeline` |
| Related memories | "what's related to X" → `get_related_memories` |
| Clean stale entries | "prune memories" → `prune_memories` |
| Rebuild search index | "rebuild index" → `rebuild_index` |

Just ask me in plain English and I'll map it to the right tool. The schemas are deferred (loaded on demand via ToolSearch) so I fetch each one before calling it.

## What each read tool actually returns

Summary of 6 tools called in one session and what they gave back:

**`list_memories`** — full inventory, 18 entries, metadata only (key, title, category, tags, updated, importanceScore, tokenEstimate). Good for auditing what exists.

**`get_timeline`** — same 18 entries ordered newest→oldest. Newest: `org/README` (2026-06-20), oldest: architecture entries (2026-05-30). Useful for "what was stored recently."

**`recall_memory`** (query: "project work") — full-text + vector hybrid search, returns ranked results with contentPreview, accessCount, lastAccessed, and score. Top hit: technical knowledge base (score 1.63). Also bumps `accessCount` and `lastAccessed` on hits.

**`search_index`** (query: "project") — lightweight metadata-only search, no file reads. Returns key/title/preview/score. Faster but shallower than `recall_memory`. Only 1 result here vs 3 from `recall_memory` — shows the difference in depth.

**`get_related_memories`** (key: `project/total-recall-review-fix-loop-converged-2026-06-19`) — Jaccard tag similarity + same-category boost. Returns 6 related memories; all other `project/*` entries scored 0.2, the total-recall architecture entry scored 0.14 (different category, shared tags).

**`prune_memories`** — lists low-retention candidates using Ebbinghaus decay. Does NOT auto-delete (safe to inspect anytime). Excludes memories tagged `no-prune` (immortal, e.g. ADRs); `delete_memory` also refuses `no-prune`-tagged memories unless `force=true` is passed, and `store_memory` refuses to overwrite a `no-prune`-tagged memory even with `force=true` (use `update_memory` to amend, or `delete_memory(force=true)` then re-store to replace).

Skipped (write/destructive): `store_memory`, `update_memory`, `delete_memory`, `rebuild_index` — all need specific inputs or are expensive full re-scans.

## Copilot compatibility

**Short answer: the 12 MCP tools work in GitHub Copilot CLI; the lifecycle hooks work too (with one documented graceful degradation — `additionalContext` injection into the LLM context is silently lost). The skills are Claude Code-only.**

total-recall ships three things, and the plugin's two-of-three are now portable to Copilot CLI:

| Component | Works in Copilot? | Why |
|---|---|---|
| **MCP server (12 tools)** | ✅ Yes | It's a plain stdio MCP server — `node dist/index.js`. Any MCP-capable client can consume it. Copilot CLI loads stdio MCP servers from `mcpServers` in the plugin manifest. |
| **Hooks** (SessionStart/PostToolUse/PreCompact/SessionEnd) | ⚠️ Partial — side effects run, `additionalContext` is silently lost | `hooks/hooks.copilot.json` uses PascalCase event names, which makes Copilot deliver the **Claude-format (snake_case) stdin payload** — the existing script bodies parse it unchanged. **All side effects still run** — vault pull, index build, org-vault sync, PreCompact learning extraction, SessionEnd flush. The one thing lost is the LLM-facing `additionalContext` injection: Copilot's parser doesn't read the Claude envelope, and for `PreCompact`/`SessionEnd` stdout is documented as not processed at all. The LLM in Copilot doesn't see the memory-index dump at session start; you can still call `search_index` / `recall_memory` / `list_memories` explicitly to find anything. |
| **Skill / slash command** (`/total-recall:memory-workflow`) | ❌ No | Skills and slash commands are Claude Code-specific. |

### Installing as a Copilot extension (recommended)

`copilot plugin install` reads `.claude-plugin/plugin.json` (one of Copilot's four recognized manifest locations; the new `hooks: "hooks/hooks.copilot.json"` field points at the Copilot-shaped hooks file) and registers the MCP server + hooks automatically. The `${PLUGIN_ROOT}` placeholder in the hooks file is resolved at load time, so the same source dir works on any machine.

```bash
cd plugins/total-recall && npm install && npm run build
copilot plugin install "$(pwd)"
```

Verify with `/mcp` inside a session or `copilot mcp list` from the shell. The 12 tools appear namespaced as `mcp__total-recall__<tool>`. The lifecycle hooks (vault pull, index build, org-vault sync) run automatically; `additionalContext` injection into the LLM context is silently lost (documented graceful degradation — the LLM just doesn't see the memory-index dump; the index is still built and the tools still work).

`install.sh --copilot` does the same install in one step.

### Using just the MCP server in Copilot Chat

Register it in your VS Code MCP config (`.vscode/mcp.json` or user settings). The `command` must point at an **absolute path** — Copilot doesn't expand `${CLAUDE_PLUGIN_ROOT}`:

```json
{
  "mcpServers": {
    "total-recall": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/plugins/total-recall/dist/index.js"]
    }
  }
}
```

After cloning the marketplace repo and building once (`cd plugins/total-recall && npm install && npm run build`), point the `args` at the built `dist/index.js`. The 12 tools then appear in Copilot Chat and you can call them by name ("recall X", "store memory", "list memories", etc.) — the same calls as in Claude Code, just without the automatic index injection and org sync.

### What you lose with the Copilot hooks (one documented graceful degradation)

The hooks all RUN — vault pull, index build, org-vault auto-sync, PreCompact learning extraction, SessionEnd write flush all fire as they do in Claude Code. The one thing Copilot's parser silently drops is the `additionalContext` field the SessionStart / PostToolUse scripts emit on stdout. Concretely:

- **No injected memory index at session start** — the script that builds the index runs, but the resulting dump is not injected into the LLM context. The on-disk index is fresh (so `search_index` / `recall_memory` / `list_memories` work without re-scanning), but the LLM doesn't see the pre-loaded index at session start. Call those tools explicitly to find anything.
- **Org-vault auto-sync still runs** — the matched `PostToolUse` fires `sync-org-memory.sh` and the org push goes through. The privacy filter still applies.
- **No PreCompact learning extraction** — and the `claude -p` shell-out is Claude-Code-bound (same as the documented Gemini caveat), so the PreCompact hook is best-effort even when it runs.
- **SessionEnd write flush runs** — pending writes are persisted on exit.

## Codex compatibility

**Short answer: same as Copilot — the 12 MCP tools work in OpenAI Codex CLI; the automatic context injection does not.**

Codex CLI consumes stdio MCP servers configured in `~/.codex/config.toml`. Same portability breakdown as Copilot: the MCP server is plain stdio (`node dist/index.js`), so it runs unchanged; hooks and the skill are Claude Code-specific and have no Codex equivalent.

| Component | Works in Codex? | Why |
|---|---|---|
| **MCP server (12 tools)** | ✅ Yes | Plain stdio MCP server. Codex loads stdio MCP servers from `~/.codex/config.toml` and exposes their tools to the model. |
| **Hooks** (SessionStart/PostToolUse/PreCompact) | ❌ No | Hooks are a Claude Code feature with no Codex equivalent. No session-start index injection, no org-vault auto-sync, no PreCompact learning extraction. |
| **Skill / slash command** (`/total-recall:memory-workflow`) | ❌ No | Skills and slash commands are Claude Code-specific. |

### Registering the MCP server in Codex

Add a stanza to `~/.codex/config.toml`. Codex doesn't expand `${CLAUDE_PLUGIN_ROOT}`, so use an **absolute path**:

```toml
[mcp_servers.total-recall]
command = "node"
args = ["/absolute/path/to/plugins/total-recall/dist/index.js"]
```

After cloning the marketplace repo and building once (`cd plugins/total-recall && npm install && npm run build`), point `args` at the built `dist/index.js`. The 12 tools then appear to the Codex model as callable functions — invoke them by asking in plain English ("recall X", "store memory", "list memories", etc.), same as in Claude Code but with no automatic index injection.

### What you lose without the hooks (Codex, same as Copilot)

- **No injected memory index at session start** — call `search_index` / `recall_memory` / `list_memories` explicitly.
- **No org-vault auto-sync** — run `node scripts/sync-org-memory.mjs` by hand after `org`-tagged store/update/delete.
- **No PreCompact learning extraction** — doubly Claude-bound (the hook *and* the `claude -p` extractor).

### One Codex-specific note

Codex runs MCP servers under its own sandbox/approval policy. total-recall writes to `~/.total-recall/personal-vault/` and `~/.total-recall/org/org-vault/` (and the index files in `~/.total-recall/`), so those paths must be writable from the sandbox Codex spawns the server in — typically a workspace-write or `--full-auto` approval level, or an explicit allow for `~/.total-recall/`. If Codex sandboxing blocks the writes, tool calls fail on the first store/update/delete; the read-only tools (`search_index`, `recall_memory`, `list_memories`, `get_timeline`, `get_related_memories`, `prune_memories`, `get_stats`, `get_memories_by_keys`) still work against the on-disk index as long as `~/.total-recall/index.json` is readable.

The MCP tools alone are still a capable manual memory store — just not zero-touch.

## Gemini compatibility

**Short answer: the 12 MCP tools work; the lifecycle hooks work IF you install the plugin as a Gemini extension (with one documented graceful degradation — `additionalContext` is silently lost for the hooks that try to inject it). The skills are Claude Code-only.**

Gemini CLI consumes stdio MCP servers configured in `~/.gemini/settings.json` (user-level) or `.gemini/settings.json` (project-level). The plugin directory doubles as a Gemini extension — `gemini-extension.json` registers the MCP server, and `hooks/hooks.gemini.json` wires the same lifecycle hooks (with Gemini's event-name renames). One `gemini extensions install <path>` does both.

| Component | Works in Gemini CLI? | Why |
|---|---|---|
| **MCP server (12 tools)** | ✅ Yes | Plain stdio MCP server. Gemini CLI loads stdio MCP servers from `mcpServers` in `settings.json` (or `mcpServers` in `gemini-extension.json` when installed as an extension) and exposes their tools to the model. |
| **Hooks** (SessionStart/AfterTool/PreCompress/SessionEnd) | ✅ Yes, via `hooks/hooks.gemini.json` | Gemini renames the lifecycle events: `PostToolUse` → `AfterTool`, `PreCompact` → `PreCompress` (SessionStart/SessionEnd keep their names). The matcher regex targets the full MCP namespaced tool name (`mcp__total-recall__(store_memory\|update_memory\|delete_memory)`), not the bare suffix. `${extensionPath}` is substituted at load time. The script bodies are the same `hooks/scripts/*.sh` files Claude Code uses. |
| **Skill / slash command** (`/total-recall:memory-workflow`) | ❌ No | The skill is a Claude Code artifact (it references `mcp__plugin_total-recall_total-recall__*` tool names and the `Skill` tool). Gemini CLI has its own skill/`activate_skill` mechanism via `GEMINI.md`, but this plugin's skills are not authored for it. A distilled `GEMINI.md` ships with the plugin for the always-on-context side, but the on-demand playbook skills are Claude-Code-only. |

### Installing as a Gemini extension (recommended)

`gemini extensions install` reads the `gemini-extension.json` manifest at the plugin root + `hooks/hooks.gemini.json` next to the existing `hooks/hooks.json`, copies the tree to `~/.gemini/extensions/total-recall/`, and registers the MCP server and hooks automatically. The `${extensionPath}` placeholder in the hooks file is resolved at load time, so the same source dir works on any machine.

```bash
cd plugins/total-recall && npm install && npm run build
gemini extensions install --consent "$(pwd)"
```

`--consent` skips the secondary "acknowledge the security risk" prompt; you'll still be asked to trust the folder once (a documented Gemini CLI requirement with no documented bypass). Verify with `gemini mcp list` (server listed) and by starting a Gemini session — the 12 tools appear namespaced as `mcp_total-recall_<tool>`.

`install.sh --gemini` does the same install in one step (and prints the exact `gemini extensions install` line if the script can't do it for you, e.g. under `-y`).

### Manual MCP-only registration (no hooks)

If you want just the 12 tools without the lifecycle hooks, add a stanza to `~/.gemini/settings.json` directly. Use an **absolute path** — Gemini does not expand `${CLAUDE_PLUGIN_ROOT}`:

```json
{
  "mcpServers": {
    "total-recall": {
      "command": "node",
      "args": ["/absolute/path/to/plugins/total-recall/dist/index.js"],
      "timeout": 30000
    }
  }
}
```

Or via the CLI command:

```bash
gemini mcp add -s user total-recall node /absolute/path/to/plugins/total-recall/dist/index.js
```

The 12 tools then appear namespaced as `mcp_total-recall_<tool>` — invoke them by asking in plain English ("recall X", "store memory", "list memories", etc.), same as in Claude Code.

### Gemini-specific notes

- **Server name:** keep `total-recall` (hyphen, not underscore). Gemini namespaces discovered tools as `mcp_{serverName}_{toolName}`, and underscores in the server name confuse its policy parser — `total-recall` is fine, `total_recall` is not.
- **Env-var sanitization:** Gemini CLI auto-redacts host env vars matching `*TOKEN*` / `*SECRET*` / `*PASSWORD*` / `*KEY*` unless you explicitly define them in the `env` block. total-recall reads its config from `~/.total-recall/config.json` (not env secrets), so this normally doesn't bite — but if you ever drive the org vault via a `GITHUB_TOKEN`-style env var, declare it explicitly in `env` or it will be stripped.
- **Matcher scope:** for `AfterTool` / `BeforeTool` the regex is matched against the **full MCP namespaced tool name** (`mcp_total-recall_store_memory`), not the bare suffix Claude Code uses. `hooks/hooks.gemini.json` already accounts for this; only relevant if you hand-author your own hook config.
- **`PreCompress` is advisory only:** Gemini explicitly says it "cannot block or modify the compression process." The hook still runs (and `transcript_path` is in stdin), so the learning-extraction script gets a chance — but Gemini may compress before the script finishes. Treat the PreCompress hook as best-effort.
- **Transport field:** Gemini uses `command` for stdio (as above). If copying a config from Claude Code that used `url` for an HTTP server, Gemini wants `httpUrl` instead — not relevant here since total-recall is stdio-only.
