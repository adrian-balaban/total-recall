# 🧠 total-recall plugin

Repository containing the **total-recall** plugin — a persistent, searchable memory system for Claude Code, GitHub Copilot CLI, and Gemini CLI.

## 🔌 Main Plugin

*   **[total-recall](file:///home/adrianb/_/ai-assisted/github/total-recall/plugins/total-recall)**: Persistent memory plugin.
    *   Exposes 12 MCP tools for knowledge management.
    *   Wires lifecycle hooks (SessionStart, PostToolUse/AfterTool, PreCompact/PreCompress, SessionEnd) for automated context injection and sync.
    *   Uses a dual-vault architecture: personal memories stay local, while `org`-tagged memories sync to a shared Git repository through a fail-closed privacy filter.
    *   Implements hybrid search (TF-IDF + Ebbinghaus memory decay, fused optionally with vector embeddings).
    *   Includes a one-shot `install.sh` setup script.

For detailed setup, configuration options, client compatibility matrices, and developer documentation, please refer to the main plugin page:

👉 **[Go to total-recall Plugin Documentation](file:///home/adrianb/_/ai-assisted/github/total-recall/plugins/total-recall/README.md)**

## 💡 Proactive Memory Saving

The total-recall plugin is designed to automatically capture and save memories (without explicit user command) when:

*   **Work observations** — style preferences, validated approaches, what worked vs. what didn't.
*   **Non-obvious project context** — motivations, external constraints, non-trivial decisions.
*   **Session end** — asks: "Is there anything from today I should remember?"

*Note: Code snippets, raw file paths, and general git history are typically not saved as they can be derived directly from the active workspace.*
