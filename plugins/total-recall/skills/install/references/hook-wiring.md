# Manual Hook Wiring Reference

This reference applies **only to standalone (non-plugin) installs**. Plugin installs (via `claude plugin install`) auto-load `hooks/hooks.json` — skip this entirely.

## hooks.json Record Format

Add to `~/.claude/settings.json` under `"hooks"`. This is an object keyed by event name, not an array:

```json
{
  "SessionStart": [
    {
      "hooks": [
        {"type":"command","command":"bash <plugin>/hooks/scripts/pull-org-vault.sh","timeout":30},
        {"type":"command","command":"bash <plugin>/hooks/scripts/build-memory-index.sh","timeout":15},
        {"type":"command","command":"bash <plugin>/hooks/scripts/load-memory-index.sh","timeout":5},
        {"type":"command","command":"bash <plugin>/hooks/scripts/load-open-questions.sh","timeout":5}
      ]
    }
  ],
  "PostToolUse": [
    {
      "matcher": "store_memory|update_memory|delete_memory",
      "hooks": [
        {"type":"command","command":"bash <plugin>/hooks/scripts/sync-org-memory.sh","timeout":30}
      ]
    }
  ],
  "PreCompact": [
    {
      "hooks": [
        {"type":"command","command":"bash <plugin>/hooks/scripts/extract-and-store-memories.sh","timeout":60}
      ]
    }
  ]
}
```

`build-memory-index.sh` must run **before** `load-memory-index.sh` on each SessionStart so the injected index reflects the latest vault state.

`extract-and-store-memories.sh` pipes JSON lines to `hooks/scripts/store-learning.cjs`, which writes learnings directly to the personal vault as `.md` files — no MCP round-trip.

## Hook Output Format

All hooks must output valid JSON `{"continue":true,...}` — any non-JSON output or non-zero exit causes the hook to fail silently (by design, to not block sessions). `sync-org-memory.cjs` logs its errors to `~/.total-recall/org/.sync-errors.log` so failures are still discoverable.
