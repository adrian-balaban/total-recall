# my-claude-plugins

**total-recall v1.0.2** | Claude Code plugin repository.

## Plugins

- **total-recall** v1.0.2 — Persistent memory plugin: MCP server (12 tools), SessionStart/PostToolUse/PreCompact hooks, the `memory-workflow` skill, and an `install.sh` setup script. Personal vault at `~/.total-recall/personal-vault/`. Org vault (for `org`-tagged memories) syncs to a GitHub repo configured via `~/.total-recall/config.json` (`orgRepo` key, branch `org-vault`) with privacy filtering on every store/update/delete.

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
