# Total Recall — Gemini CLI working notes

This plugin runs in Gemini CLI. The 17 tools are exposed as
`mcp_total-recall_<tool>`. Invoke them by asking in plain English
("recall X", "store a memory about Y", "list memories tagged Z")
— same as in Claude Code.

## Install

```bash
cd plugins/total-recall && npm install && npm run build
./install.sh --gemini          # or: gemini extensions install --consent "$(pwd)"
```

This copies the plugin into `~/.gemini/extensions/total-recall/`, registers
the MCP server (from `gemini-extension.json`), and wires the lifecycle hooks
from `hooks/hooks.gemini.json` (Gemini's event renames: `PostToolUse` →
`AfterTool`, `PreCompact` → `PreCompress`) and a full `mcp_total-recall_*` matcher. Verify with `gemini mcp list`.
For MCP-only registration without hooks, see the README's *💻 Client
Compatibility* section.

## Always-true rules

- **Tag routing**: `org` → shared org vault (git-synced, privacy-filtered
  by `sync-org-memory.sh`). `personal` → local-only. The two are mutually
  exclusive — `store_memory` throws if both are present.
- **Author on org writes**: always the OS user. The caller-supplied
  `author` field is informational, not authoritative; org-author protection
  is enforced on `update_memory` too.
- **Duplicates**: `store_memory` errors on a duplicate key. Use
  `update_memory`, or pass `force=true` to overwrite (preserves `created`
  and `accessCount`).
- **Date filters**: `recall_memory`/`search_index` accept `since`/`before`
  as relative (`7d`, `2w`, `1m`) or ISO. Memories with no `updated` field
  are silently excluded — don't be surprised by missing results.
- **YAML frontmatter is a subset**: scalars, inline arrays, quoted strings.
  No anchors, no merge keys, no folded scalars. Frontmatter values reject
  embedded newlines (injection guard).

## When you need a playbook

Two Claude-specific skills ship with this plugin — `memory-workflow` and
`review-fix-ship`. They are not loadable in Gemini (no `Skill` tool
equivalent). If a task needs the retrieval tree, the "memorize more
proactively" loop, or the multi-pass review-fix-ship discipline, ask the
user to paste the relevant `SKILL.md` body and proceed as a one-shot
knowledge injection.
