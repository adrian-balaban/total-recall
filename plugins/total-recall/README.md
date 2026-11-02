# 🧠 Total Recall

Persistent knowledge management for Claude Code, Gemini/Antigravity and VS Code (GitHub Copilot agent mode).

The main documentation lives in the repository root to avoid duplication. Because the plugin is installed as a `git-subdir` (this directory only), the root documents are linked on GitHub rather than by relative path:

- 📖 **[Main documentation (`README.md`)](https://github.com/adrian-balaban/total-recall#readme)** — overview, storage layout, the 22 MCP tools, search pipeline (TF-IDF × Ebbinghaus + vector fusion), lifecycle hooks, `config.json`, spec-driven architecture (ADL), client compatibility, Obsidian notes, status, and project comparison.
- 🇷🇴 **[Documentația în română (`README-ro.md`)](https://github.com/adrian-balaban/total-recall/blob/main/README-ro.md)**
- 🔒 **[Security policy (`SECURITY.md`)](https://github.com/adrian-balaban/total-recall/blob/main/SECURITY.md)** — privacy filter and org-vault trust model.

These two ship inside the plugin and are available offline after install:

- 📦 **[Installation guide (`INSTALL.md`)](INSTALL.md)** — profiles (`minimal` / `complete`), per-client setup, Windows (Git Bash) notes, and org vault configuration.
- 🏗️ **[Architecture & internals (`ARCHITECTURE.md`)](ARCHITECTURE.md)** — C4 diagrams, data model, write path, server lifecycle, and ADL fitness rules.
