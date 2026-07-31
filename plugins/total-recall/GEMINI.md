# Total Recall — Gemini CLI working notes

This plugin runs in Gemini CLI. The 17 tools are exposed as
`mcp_total-recall_<tool>` and invoked in plain English ("recall X",
"store a memory about Y", "list memories tagged Z") — same surface as
Claude Code.

> **Install, client-compatibility, and the full gotchas list live in one place
> now.** See `README.md` → *💻 Client Compatibility* for Gemini install +
> event renames (`PostToolUse` → `AfterTool`, `PreCompact` → `PreCompress`),
> and `CLAUDE.md` → *Key Gotchas* for the tag-routing / author /
> duplicates / date-filter / frontmatter rules that apply to *both* clients.
> The notes below are only the Gemini-specific deltas not covered there.

## Gemini-specific deltas

- **Tool namespace:** `mcp_total-recall_<tool>` (single underscore). The full
  matcher is wired in `hooks/hooks.gemini.json`.
- **Event renames:** Gemini's `AfterTool` / `PreCompress` map to Claude Code's
  `PostToolUse` / `PreCompact`. Both hook manifests (`hooks/hooks.json` and
  `hooks/hooks.gemini.json`) must stay in sync — see `CLAUDE.md` gotcha 8.5.
- **No `Skill` tool in Gemini.** The one Claude-specific skill
  (`memory-workflow`) ships in `skills/` but is **not loadable** in Gemini —
  Gemini silently drops it. If a task needs the retrieval tree or the
  "memorize more proactively" loop, ask the user to paste the `SKILL.md`
  body and proceed as a one-shot knowledge injection.
- **MCP-only registration (no hooks):** `agy plugin install "$(pwd)"`
  registers the server from `gemini-extension.json` without wiring
  the lifecycle hooks — see `README.md` → *Client Compatibility* for the
  trade-off (no SessionStart index injection, no PreCompact learning capture).