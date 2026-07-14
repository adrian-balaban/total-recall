# 🧠 total-recall plugin

Repository containing the **total-recall** plugin — a persistent, searchable memory system for Claude Code, GitHub Copilot CLI, and Gemini CLI.

## 🔌 Main Plugin

*   **[total-recall](plugins/total-recall)**: Persistent memory plugin.
    *   Exposes 17 MCP tools for knowledge management (CRUD, hybrid search, semantic rerank, bulk export/import/delete, confirm/flag feedback).
    *   Wires lifecycle hooks (SessionStart, PostToolUse/AfterTool, PreCompact/PreCompress, SessionEnd) for automated context injection and sync.
    *   Uses a dual-vault architecture: personal memories stay local, while `org`-tagged memories sync to a shared Git repository through a fail-closed privacy filter.
    *   Implements hybrid search (TF-IDF + Ebbinghaus memory decay, fused optionally with vector embeddings).
    *   Includes a one-shot `install.sh` setup script with two profiles (default: no optional deps; complete: local vector search). Works on Linux, macOS, and Windows (Git Bash).

For detailed features, configuration options, client compatibility matrices, and developer documentation, please refer to the main plugin page:

👉 **[Go to total-recall Plugin Documentation](plugins/total-recall/README.md)**
👉 **[Installation guide (INSTALL.md)](plugins/total-recall/INSTALL.md)**

## 🎤 Talks

*   **Claude vs Ollama & Total Recall Plugin** (Romanian, 21 Jul 2026) — slide deck + per-slide deep-dive notes covering this plugin's architecture, hybrid search, and dual-vault design: [adrian-balaban/presentation-claude-vs-ollama-and-total-recall-plugin](https://github.com/adrian-balaban/presentation-claude-vs-ollama-and-total-recall-plugin)

## 💡 Proactive Memory Saving

The total-recall plugin is designed to automatically capture and save memories (without explicit user command) when:

*   **Work observations** — style preferences, validated approaches, what worked vs. what didn't.
*   **Non-obvious project context** — motivations, external constraints, non-trivial decisions.
*   **Session end** — asks: "Is there anything from today I should remember?"

*Note: Code snippets, raw file paths, and general git history are typically not saved as they can be derived directly from the active workspace.*
