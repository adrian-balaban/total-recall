# 🧭 Review: is Total Recall ready for VS Code / Visual Studio with Claude models?

Status: **review + proposal** · Date: 2026-10-30 · Baseline: `main` at `966d4c2` (v1.3.4) · Author: Claude Code (Opus 5.5)

## ⚡ Verdict

**Ready in one host, partly ready in two, not ready in two.**

| Host (Claude model) | Verdict | Why |
|---|---|---|
| **Claude Code extension for VS Code** (`anthropic.claude-code`) | ✅ Ready, with 2 PATH traps | Same plugin, same hooks, same MCP server as the CLI. This review was written in it. |
| **GitHub Copilot in VS Code**, agent-plugin route | ⚠️ Probably works, unverified | VS Code agent plugins (Preview) read the Claude plugin format, including `hooks/hooks.json` and `.mcp.json` with `${CLAUDE_PLUGIN_ROOT}`. Event names, payloads and matchers differ in detail. |
| **GitHub Copilot in VS Code**, manual `mcp.json` | ⚠️ Tools only | 22 tools work. No index injection, no auto-capture, no org push. |
| **GitHub Copilot in Visual Studio** (IDE) | ❌ Tools only, undocumented | `.mcp.json` registration works in principle; no plugin or hook route documented; no install step. |
| **Cline** (VS Code extension) | ❌ Not wired | Same `mcpServers` shape, but no install step, no docs, different hook envelope (see the Cline review). |

## 🔍 Evidence

### Checked in this session

| Fact | Evidence |
|---|---|
| The extension ran the plugin's SessionStart hooks and injected the index | Session start context: `## Total Recall v1.3.4 — Active Memory Index` |
| The extension's process has **no `node` on `PATH`** | `which node` → not found; `npm` and `npx` also missing (Bash tool, this session) |
| `.mcp.json` starts the server with a **bare `node`** | `plugins/total-recall/.mcp.json`: `"command": "node"` |
| Hooks survive a stripped PATH; the MCP server does not | Every hook script sources `_resolve-node.sh`; `.mcp.json` cannot |
| The MCP server failed to start in this session | MCP log `2026-10-29T20-34-42`: `ENOENT: Executable not found in $PATH: "stdio"`. It is the **only** failure in about 190 logged sessions since July. The cause (why `stdio` and not `node`) is unconfirmed. |
| PreCompact extraction needs `claude` on PATH | `extract-and-store-memories.sh:31`: `command -v claude` or skip silently. The extension's own binary is not on PATH (`INSTALL.md:8`) |
| `install.sh` skips MCP registration without `claude` on PATH | `install.sh:224,246,370` |
| The server exposes tools only | MCP log: `hasPrompts:false, hasResources:false` |
| Org sync happens **only** in the PostToolUse hook | `sync-org-memory.sh`; the server writes `.md` files and never runs git |

### From host docs (fetched 2026-10-30)

| Fact | Source |
|---|---|
| VS Code agent plugins support the Claude format (`.claude-plugin/plugin.json`), load `hooks/hooks.json` and `.mcp.json`, and expand `${CLAUDE_PLUGIN_ROOT}` | [agent plugin reference](https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference) |
| Install from a marketplace via `chat.plugins.marketplaces` (Experimental), enabled by `chat.plugins.enabled` | [agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins) |
| VS Code hooks (Preview): `sessionStart`, `postToolUse`, `preCompact`, `sessionEnd` and more; also read from repo `.claude/settings.json`. Matchers are not documented and one parser "ignores matcher values". `additionalContext` is documented for `postToolUse`, not for `sessionStart` | [VS Code hooks](https://code.visualstudio.com/docs/copilot/customization/hooks) |
| Visual Studio reads `<SOLUTIONDIR>\.mcp.json` or `%USERPROFILE%\.mcp.json` | [Visual Studio MCP servers](https://learn.microsoft.com/visualstudio/ide/mcp-servers) |

## 🕳️ Gaps, by severity

1. **Org sync can silently not happen** in any host where the PostToolUse hook does not fire or its matcher does not match. In VS Code, MCP tool names are not `mcp__plugin_total-recall_total-recall__*`, so the regex in `hooks.json` likely misses. This is a **non-sync, not a leak**: nothing leaves the machine without the hook. The memory just never reaches teammates.
2. **The MCP server depends on `node` on PATH.** It is a latent failure in every GUI-launched host (nvm, fnm, Volta).
3. **Hook envelopes are Claude Code-shaped.** Copilot may ignore `hookSpecificOutput.additionalContext` at `sessionStart`. Cline needs `contextModification`.
4. **PreCompact capture needs the `claude` CLI.** It never runs in Copilot or Cline, and it is skipped in the Claude Code extension when only the bundled binary exists.
5. **No server-side context for hookless hosts.** Without hooks the model never sees the index or the retrieval rules. The server's `instructions` banner is short, and there are no resources or prompts.
6. **No install path or docs** for Copilot, Visual Studio or Cline.
7. **Org inbound injection (`[TR-D12]`).** Any new host that injects the org index inherits the unfiltered-org-content risk. That work must follow 1.4.0.

## 🛠️ Plan (outline)

The merged, ordered plan is in [PLAN-COPILOT-WITH-CLAUDE-FINAL.md](PLAN-COPILOT-WITH-CLAUDE-FINAL.md). In short:

1. **Spike:** install the existing plugin in VS Code Copilot via the agent-plugin route, then record which events fire, the payloads and tool names, and whether matchers are honoured.
2. **Fix the PATH traps:** add a node-resolving launcher for the MCP server and `_resolve-claude.sh` for the bundled binary.
3. **Host-tolerant hooks:** accept Copilot payload variants, match tool names inside the script, and emit the right output envelope per host.
4. **Server-side context:** richer `instructions`, plus resources and prompts. Index injection waits for 1.4.0.
5. **Explicit org-sync mode** for hookless hosts.
6. **Installers and docs:** `--vscode`, `--cline` and a Visual Studio snippet.
