---
name: memory-workflow
description: Use when storing or retrieving memories with the Total Recall plugin — establishes the cheapest-first retrieval order (injected index → get_memories_by_keys → search_index → recall_memory), the knowledge-capture rules (executive summary, dedup check, importanceScore, org tagging for the org vault), and the category and quality guidelines for store_memory.
---

# Memory Workflow — Total Recall Retrieval & Capture

## Retrieval Decision Tree

Follow this order strictly — earlier steps are cheaper:

1. **Scan injected index first** (already in context — free, zero tokens)
   - At session start, an index of all memories was injected into context
   - Check it before calling any MCP tool
2. **Key found in index?** → `get_memories_by_keys(keys=[...], summary=true)`
   - Returns ~500-char executive summary per memory
3. **Need full depth?** → `get_memories_by_keys(keys=[...], summary=false)`
   - Returns complete file content
4. **Key NOT in index?** → `search_index(query=...)` (metadata-only, no file reads)
5. **Still not found?** → `recall_memory(query=..., full=false)` (TF-IDF + Ebbinghaus)
6. **Need content?** → `recall_memory(query=..., full=true)`

**Never jump straight to recall_memory if the key is already in the injected index.**

## Knowledge Capture Rules

- Call `store_memory` **directly from the main agent** — never delegate to a subagent
- **Check for duplicates** with `search_index` before storing
- Every memory must include:
  - `## Executive Summary` section — WHY this matters, not just WHAT it is
  - Appropriate tags (use `org` for team-shared knowledge)
  - `importanceScore` between 0.0 and 1.0

## Category Guidelines

| Category | Content | Target length |
|---|---|---|
| `architecture` | System design, ADRs, diagrams | 500–1500 words |
| `decisions` | Decision records with context and tradeoffs | 300–800 words |
| `troubleshooting` | Incident post-mortems, bug resolutions | 200–600 words |
| `meetings` | Action items, decisions, key outcomes | 100–300 words |
| `knowledge` | Concepts, how-tos, references | 200–1000 words |
| `journal` | Auto-appended activity log — do not store manually | — |

## Org Vault Routing

- Tag with `org` to route to shared org vault
- **Never** use both `org` and `personal` tags on the same memory
- Key collisions between vaults are prevented by design, not resolved by precedence: org keys are always prefixed `org/`, and the personal vault reserves (skips scanning) any `org/` subdirectory — so the same key can never resolve to both a personal and an org memory
- Org sync uses `spawnSync` with args as array — no shell interpolation risk

## Quality Checklist

Before calling `store_memory`, verify:
- [ ] Title is searchable and specific (not "Notes from today")
- [ ] Executive summary answers WHY, not just WHAT
- [ ] Tags include relevant service names and technologies
- [ ] No duplicate exists (checked with `search_index`)
- [ ] `importanceScore` reflects actual reuse value (0.3=low, 0.7=high, 1.0=critical)

## Known Gotchas

- `since` date filter silently **excludes** memories with missing `updated` field (by design)
- `rebuild_index` now preserves `accessCount`/`lastAccessed` — safe to run anytime
- Org vault `index.json` is updated on every sync — no manual rebuild needed
- Vector search (`@huggingface/transformers`, `sqlite-vec`) is lazy-loaded; if packages missing, gracefully degrades to TF-IDF only
- `extract-and-store-memories.sh` reads `transcript_path` from the PreCompact hook's stdin JSON (Claude Code's common hook input) — does nothing if the path is absent or the file is missing
