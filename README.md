# my-claude-plugins

Claude Code plugin repository.

## Plugins

- **total-recall** — Persistent memory plugin: MCP server (12 tools), SessionStart/PostToolUse/PreCompact hooks, the `memory-workflow` skill, and an `install.sh` setup script. Personal vault at `~/.total-recall/personal-vault/`. Org vault (for `org`-tagged memories) syncs to a GitHub repo configured via `~/.total-recall/config.json` (`orgRepo` key, branch `org-vault`) with privacy filtering on every store/update/delete.

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

**`prune_memories`** — lists low-retention candidates using Ebbinghaus decay. Does NOT auto-delete (safe to inspect anytime).

Skipped (write/destructive): `store_memory`, `update_memory`, `delete_memory`, `rebuild_index` — all need specific inputs or are expensive full re-scans.

## Copilot compatibility

**Short answer: the 12 MCP tools work in GitHub Copilot Chat; the automatic context injection does not.**

total-recall ships three things, and only one of them is portable:

| Component | Works in Copilot? | Why |
|---|---|---|
| **MCP server (12 tools)** | ✅ Yes | It's a plain stdio MCP server — `node dist/index.js`. Any MCP-capable client can consume it. Copilot Chat supports stdio MCP servers in VS Code / VS 2022. |
| **Hooks** (SessionStart/PostToolUse/PreCompact) | ❌ No | Hooks are a Claude Code feature with no Copilot equivalent. No `SessionStart` → no automatic memory-index injection at session start. No `PostToolUse` → org-vault sync after store/update/delete doesn't run. No `PreCompact` → no learning extraction on context compaction. |
| **Skill / slash command** (`/total-recall:memory-workflow`) | ❌ No | Skills and slash commands are Claude Code-specific. |

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

### What you lose without the hooks

- **No injected memory index at session start** — you must call `search_index` / `recall_memory` / `list_memories` explicitly to find anything; the index isn't pre-loaded into context.
- **No org-vault auto-sync** — store/update/delete on `org`-tagged memories won't push to the shared GitHub repo automatically. Run `node scripts/sync-org-memory.cjs` by hand if you need it.
- **No PreCompact learning extraction** — and note this hook also shells out to the `claude` CLI binary, so it's Claude-Code-bound on two counts (the hook *and* the `claude -p` extractor).

The MCP tools alone are still a capable manual memory store — they're just not zero-touch.

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
- **No org-vault auto-sync** — run `node scripts/sync-org-memory.cjs` by hand after `org`-tagged store/update/delete.
- **No PreCompact learning extraction** — doubly Claude-bound (the hook *and* the `claude -p` extractor).

### One Codex-specific note

Codex runs MCP servers under its own sandbox/approval policy. total-recall writes to `~/.total-recall/personal-vault/` and `~/.total-recall/org/org-vault/` (and the index files in `~/.total-recall/`), so those paths must be writable from the sandbox Codex spawns the server in — typically a workspace-write or `--full-auto` approval level, or an explicit allow for `~/.total-recall/`. If Codex sandboxing blocks the writes, tool calls fail on the first store/update/delete; the read-only tools (`search_index`, `recall_memory`, `list_memories`, `get_timeline`, `get_related_memories`, `prune_memories`, `get_stats`, `get_memories_by_keys`) still work against the on-disk index as long as `~/.total-recall/index.json` is readable.

The MCP tools alone are still a capable manual memory store — just not zero-touch.
