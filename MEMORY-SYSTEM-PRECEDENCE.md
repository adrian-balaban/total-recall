# Memory system precedence

**Total Recall is the exclusive memory system for this workspace.** The harness
file-based memory (the `memory/` directory with a `MEMORY.md` index and per-fact
markdown files) and the `.remember/` history system are **disabled** by user
instruction — even though the SessionStart hooks and harness defaults describe
and encourage them.

## Why

The user's global `CLAUDE.md` mandates Total Recall exclusively. Per the
instruction-priority order — **user `CLAUDE.md` > skills > harness defaults** —
the user instruction wins over the conflicting hook/default behavior. The
`.remember/` and `memory/` prompts are background context, not instructions.

## How to apply

- **Store** via Total Recall `store_memory` / `update_memory`.
- **Recall** cheapest-first: injected active-memory index → `get_memories_by_keys`
  → `search_index` → `recall_memory`.
- **Do not** write to the harness `memory/` directory or `MEMORY.md`.
- If Total Recall is unavailable in a session, **tell the user and skip
  persisting** — do not silently fall back to file-based memory.
- The `total-recall:memory-workflow` skill is optional reference (retrieval
  order, dedup, `importanceScore`, org tagging), not a required dependency.

> Mirrored in Total Recall as
> `decisions/memory-system-precedence-total-recall-exclusive-file-based-disabled`.
