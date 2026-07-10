# 🧠 Total Recall

Persistent knowledge and memory management for Claude Code, GitHub Copilot CLI, and Gemini CLI.

Stores memories locally as Markdown files with YAML frontmatter, indexes them for fast search, and uses per-client lifecycle hooks to inject relevant context automatically.

---

## 💾 Architecture & Storage

Two separate vaults live under `~/.total-recall/`:

| Vault | Path | When Used |
|---|---|---|
| **Personal** | `~/.total-recall/personal-vault/` | Default for all memories (stays local). |
| **Org** | `~/.total-recall/org/org-vault/` | Used when tagged `org`. Syncs to a remote Git repo with a privacy filter. |

### Privacy Filter & Org Sync
*   **Fail-closed by default**: Blocks secret tokens/keys and all email addresses before git push.
*   **Email Whitelist**: Allow specific domains via `allowedEmailDomains: ["yourcompany.com"]` in `config.json`.
*   *Note: Personal pronouns and phone numbers are allowed to prevent false-positives blocking legitimate work notes; personal/org tags are mutually exclusive to prevent accidental sync.*

---

## 17 MCP Tools

All tool calls operate against an in-memory primary index (`index.json`), making read/search operations extremely fast and free of disk I/O.

| Tool | Function | Notable Behavior |
|---|---|---|
| `store_memory` | Create a memory | Routes to Org vault if tagged `org`. Overwrite needs `force=true` (refused on `no-prune` files). |
| `update_memory` | Edit a memory | Preserves created timestamp and appends to session history (capped at 50). |
| `delete_memory` | Delete a memory | Refuses `no-prune` memories unless `force=true` is passed. |
| `rebuild_index` | Rescan filesystem | Performs a full re-scan of vaults, rebuilding TF-IDF while preserving access stats. |
| `recall_memory` | Hybrid search | Evaluates TF-IDF, Ebbinghaus decay, and optional vector embeddings (fused via RRF). |
| `search_index` | Metadata search | Fast query scan of the in-memory index; does not read files from disk. |
| `list_memories` | Browse vault | Returns a paginated listing of memory metadata (filter by tag/category/date). |
| `get_memories_by_keys` | Fetch memory | Batch fetch by key; returns full content or summary (if `summary=true`). |
| `get_stats` | Audit plugin | Returns totals, cache stats, recent error log (last 10), and latency percentiles. |
| `get_timeline` | Chronological view | Lists memories grouped and sorted by modification dates. |
| `get_related_memories` | Find relations | Scores Jaccard similarity of tags with a category boost. |
| `prune_memories` | Clean stale entries | Lists Ebbinghaus decay candidates (does not auto-delete). Excludes `no-prune`. |
| `rerank_memories` | Semantic rerank | Reorders candidate keys by cosine similarity to a query using embeddings. |
| `export_memories` | Bulk export | Writes a portable JSON archive; filter by keys, category, or tag. |
| `import_memories` | Bulk import | Restores memories from an `export_memories` archive; skip/force behavior. |
| `delete_memories` | Bulk delete | Deletes a list of keys; requires `confirm=true`; respects `no-prune`. |
| `confirm_memory` | Feedback | `useful=true` increments confirmations; `useful=false` increments flags. |

---

## 🔍 Search Pipeline & Key Concepts

```
recall_memory(query)
  ├── 1. TF-IDF Lexical Match (tokenizes title + tags + preview)
  ├── 2. Ebbinghaus Decay Multiplier (importance × exp(-λ × days) × (1 + 0.2 × accessCount))
  ├── 3. [Optional] Vector Embeddings Similarity (HuggingFace MiniLM-L6-v2 via sqlite-vec)
  └── 4. Reciprocal Rank Fusion (fuses lexical and vector ranks via k=60) -> Top Results
```

*   **Ebbinghaus Decay**: Ranks frequently or recently accessed memories higher.
*   **Immortality (`no-prune` tag)**: Excludes the memory from `prune_memories` and protects it from accidental deletion or routine overwrite. Useful for architecture decisions (ADRs).
*   **Optional Vector Search**: Enabled by installing optional dependencies:
    ```bash
    npm install @huggingface/transformers sqlite-vec better-sqlite3
    ```
    Gracefully falls back to TF-IDF-only if packages are missing.

---

## ⚙️ Configuration (`config.json`)

Configure total-recall settings by editing `~/.total-recall/config.json`:

```json
{
  "personalVault": "~/my-custom-personal-vault",
  "orgVault": "~/my-custom-org-vault",
  "orgRepo": "https://github.com/you/your-vault.git",
  "allowedEmailDomains": ["yourcompany.com"],
  "embeddingProvider": "huggingface",
  "embeddingModel": "bge-m3",
  "enableMultilingualSearch": true
}
```

*   **embeddingProvider**: `'huggingface'` (default, local MiniLM), `'ollama'` (local API), or `'vertexai'` (GCP).
*   **embeddingModel**: Used only for external providers. Ollama defaults to `bge-m3` and Vertex AI to `text-embedding-004`.
*   **enableMultilingualSearch**: Enables Romanian/English query token expansion for cross-language lexical retrieval (e.g. searching `"decizie"` matches `"decision"`).

---

## 🚀 Quick Install by Client

`install.sh` (at the plugin root) is the state-aware setup script. It creates vault directories, registers the MCP server, builds the initial index, and configures the environment.

```bash
cd plugins/total-recall && npm install && npm run build

# Claude Code (Automated plugin hooks)
claude plugin install "$(pwd)"

# GitHub Copilot CLI (MCP + hooks/hooks.copilot.json)
./install.sh --copilot

# Gemini CLI (MCP + hooks/hooks.gemini.json)
./install.sh --gemini

# Standalone (Writes absolute hook paths to ~/.claude/settings.json)
./install.sh --standalone
```

---

## 💻 Client Compatibility

| Client | MCP Tools | Hook Side Effects (Sync/Index) | Context Injection (`additionalContext`) | Playbook Skills |
|---|---|---|---|---|
| **Claude Code** | ✅ Yes | ✅ Yes | ✅ Yes (SessionStart/PostToolUse) | ✅ Yes |
| **Copilot CLI** | ✅ Yes | ✅ Yes | ❌ No (Silently dropped by Copilot) | ❌ No |
| **Gemini CLI** | ✅ Yes | ✅ Yes | ❌ No (Silently dropped by Gemini) | ❌ No |
| **Codex CLI** | ✅ Yes | ❌ No | ❌ No | ❌ No |

### Client-Specific Integration Details

*   **Claude Code**: Zero-touch. Hooks automatically pull git changes, rebuild the local cache, and inject memories at session start.
*   **Gemini CLI**: Registers the extension through `gemini-extension.json`. Standard tool namespace is `mcp_total-recall_<tool>`. Matcher scope in `hooks.gemini.json` uses `mcp_total-recall_` (single underscore).
*   **Copilot CLI**: Configured via `hooks.copilot.json`. Tool namespace is `mcp__total-recall__<tool>` (double underscores). `additionalContext` is dropped by the client, but the background side effects (git sync, index builds) run normally.
*   **Codex CLI**: Register the stdio MCP server in `~/.codex/config.toml`:
    ```toml
    [mcp_servers.total-recall]
    command = "node"
    args = ["/absolute/path/to/plugins/total-recall/dist/index.js"]
    ```

---

## 📝 Obsidian Integration

You can open both vaults (`~/.total-recall/personal-vault/` and `~/.total-recall/org/org-vault/`) directly as Obsidian Vaults. 
*   **Simple YAML**: Stick to flat string arrays and simple scalars. `src/frontmatter.ts` does not support anchors or multi-line block scalars.
*   **No File Watching**: Obsidian edits are not loaded until you start a new terminal session or call `rebuild_index`.
*   **Wiki-links**: `[[wikilinks]]` are tokenized by their raw words. The links graph is not resolved.
*   **Sync Safeguard**: Do not use Obsidian Sync on the org-vault directory; rely exclusively on total-recall's Git-sync to ensure the privacy filter runs before pushing.

---

## ⚖️ Comparison with Similar Projects

| | This Plugin | [strvmarv/total-recall](https://github.com/strvmarv/total-recall) | [davegoldblatt/total-recall](https://github.com/davegoldblatt/total-recall) |
|---|---|---|---|
| **Language** | TypeScript / Node.js | .NET 8 + F# | Bash + Markdown |
| **Storage** | Markdown + JSON index | SQLite / Postgres | Markdown |
| **Text Search** | TF-IDF | BM25 | Plain files scan |
| **Vector Search**| Optional sqlite-vec | Local ONNX | None |
| **Rerank/Decay** | Ebbinghaus Decay × TF-IDF | 4-tier hot/warm/cold | None |
| **Org Sync** | Git-synced, privacy filter | DB Connectors (Jira, Confluence) | None |
| **Target** | Bounded local memory | Large team deployments | Zero dependencies |
