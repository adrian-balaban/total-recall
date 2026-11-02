# 🛠️ The 22 MCP tools

You rarely call these by name: say *"remember that…"*, *"what did we decide about…"*, *"forget …"* and the model picks the tool. All reads and searches run against an in-memory index, so they do not touch the disk.

[← README](../README.md)

| Tool | Group | What it does | Notes |
| --- | --- | --- | --- |
| `store_memory` | Store | Create a memory | Goes to the org vault when tagged `org`. Overwriting needs `force=true` and archives the old version; refused on `no-prune` memories |
| `recall_memory` | Search | Hybrid search | TF-IDF × decay, fused with vectors (RRF) when semantic search is on |
| `search_index` | Search | Metadata search | Reads no files and does not count as an access |
| `list_memories` | Read | Browse | Paginated, filter by tag or category |
| `get_memories_by_keys` | Read | Fetch by key | Full body or executive summary; LRU-cached |
| `get_stats` | Read | Health check | Totals, cache, latency percentiles, the last 10 errors, and whether vector search is on |
| `get_timeline` | Read | Chronological view | Grouped by modification date |
| `get_related_memories` | Read | Find related | Tag similarity with a category boost, plus shared `elements` |
| `update_memory` | Modify | Edit | Keeps `created`, appends to session history (last 50), re-embeds when needed |
| `delete_memory` | Modify | Delete | Refuses `no-prune` memories unless `force=true` |
| `confirm_memory` | Modify | Feedback | `useful=true` / `false` raises or lowers retention |
| `rebuild_index` | Modify | Rescan the vaults | Keeps access statistics |
| `prune_memories` | Modify | List stale memories | Lists candidates only; never deletes. Skips `no-prune` |
| `rerank_memories` | Re-rank | Semantic rerank | Reorders up to 200 keys by similarity to a query |
| `export_memories` | Bulk | Export to JSON | Filter by keys, category or tag. An unreadable body becomes an `{key, error}` entry, never empty content |
| `import_memories` | Bulk | Import from JSON | Skips existing keys unless `force=true`; skips error entries |
| `delete_memories` | Bulk | Delete many | Needs `confirm=true`; a protected key is reported and the rest continue |
| `index_architecture` | Architecture | Index ADL files | One summary memory per system. See [SPEC-DRIVEN.md](SPEC-DRIVEN.md) |
| `get_architecture_context` | Architecture | Element context | Rules, relationships, decisions, failures and guardrails for one element |
| `trace` | Architecture | Requirement → tests | Requirement, assertion or element → assertions → tests → results and decisions |
| `get_architecture_history` | Architecture | Change log | Architecture changes in time order |
| `validate_architecture` | Architecture | Coverage check | Every tagged assertion has a test carrying its ID; failures are stored |

The five architecture tools are on by default. Switch them off one by one (`specDriven.tools`) or all together (`specDriven.enabled: false`, which also removes the optional spec fields from the other tools).

## Export format

`export_memories` returns:

```json
{
  "count": 1,
  "errors": 0,
  "memories": [
    {
      "key": "decisions/db-choice",
      "title": "Prefer PostgreSQL for relational data",
      "content": "## Executive Summary\n\nPrefer PostgreSQL…",
      "category": "decisions",
      "tags": ["architecture", "database"],
      "importanceScore": 0.8,
      "author": "adrianb",
      "sessions": ["…"],
      "created": "2026-06-01T10:00:00Z",
      "updated": "2026-06-15T14:30:00Z",
      "isOrg": false
    }
  ]
}
```

Spec-driven fields (`system`, `elements`, …) are added when the memory has them. It is plain JSON, so `jq '.memories[] | {key, title}'` or DuckDB's `read_json` work on it directly.
