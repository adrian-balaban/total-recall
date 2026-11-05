# 💡 Inspiration and similar projects

[← README](../README.md)

## Same name, different plugins

Three other projects are also called `total-recall`. Install this one by its full ID, `total-recall@my-claude-plugins`, and do not install two plugins with the same name side by side.

|                       | This plugin                                      | [strvmarv/total-recall](https://github.com/strvmarv/total-recall) | [davegoldblatt/total-recall](https://github.com/davegoldblatt/total-recall) | [88plug/total-recall](https://github.com/88plug/total-recall) | [mozilla-ai/cq](https://github.com/mozilla-ai/cq) |
| --------------------- | ------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| **Language**          | TypeScript / Node.js                             | .NET 8 + F#                                                       | Bash + Markdown                                                             | Python                                                        | Python                                            |
| **Storage**           | Markdown + JSON index                            | SQLite / Postgres                                                 | Markdown                                                                    | SQLite index over session transcripts                         | Shared knowledge store                            |
| **Text search**       | TF-IDF                                           | BM25                                                              | Plain file scan                                                             | SQLite FTS5                                                   | —                                                 |
| **Vector search**     | Optional sqlite-vec                              | Local ONNX                                                        | None                                                                        | ollama embeddings (on by default)                             | —                                                 |
| **Ranking / decay**   | Ebbinghaus decay × TF-IDF + confirm/flag signals | 4-tier hot/warm/cold                                              | None                                                                        | —                                                             | Human review + endorsements                       |
| **Team sharing**      | Git-synced, privacy filter                       | DB connectors (Jira, Confluence)                                  | None                                                                        | None                                                          | Reviewed shared store (7 hosts)                   |
| **Context injection** | ✅ Claude Code hooks                             | —                                                                 | —                                                                           | ✅ SessionStart signpost + per-prompt retrieval               | ❌ the agent must query                           |
| **Built for**         | Curated local memory                             | Large team deployments                                            | Zero dependencies                                                           | Mining past sessions of many CLIs                             | Cross-agent shared learning                       |

- **88plug/total-recall** mines raw session transcripts of Claude Code and nine other CLIs into a local SQLite + ollama index. This plugin stores curated, human-readable Markdown memories instead. Different problem, same name.
- **`remember@claude-plugins-official`**, the official session-handoff plugin, writes `.remember/*.md` into every project and uses the same hooks for the same job. Run only one of the two.
- **mozilla-ai/cq** is complementary: it shares operational lessons between agents through a reviewed store; total-recall is your own context memory in files and git. cq's endorsement signal inspired `confirm_memory`.

## Versus general memory MCP servers

Other MCP servers also give an assistant persistent memory and work in any MCP client. What they store and how they search differs from this plugin:

- **[Knowledge Graph Memory](https://archestra.ai/mcp-catalog/modelcontextprotocol__servers__src__memory)** (the official reference server, `@modelcontextprotocol/server-memory`) keeps a local knowledge graph of entities and relations, searched with tools such as `search_nodes` and `read_graph`. It does not give you a folder of readable notes, and it has no hooks, so nothing is injected at session start or captured automatically.
- **[Basic Memory](https://docs.basicmemory.com/concepts/knowledge-format)** stores memory as plain Markdown files that [Obsidian can open](https://docs.basicmemory.com/raw/integrations/obsidian.md), builds a graph from `[[wiki-links]]`, and indexes the files in a local SQLite database. It is the closest in spirit; this plugin adds a forgetting curve, hooks for injection and capture in Claude Code, and a git-synced team vault with a privacy filter.
- **[Mem0 and OpenMemory](https://www.cometapi.com/?p=25577)** is a memory layer that runs locally and shares context between clients such as Cursor, Claude Desktop and Windsurf; per that write-up it uses Qdrant for vector search. It is built around an LLM and a vector store, where this plugin works with plain files and TF-IDF and treats vectors as optional.

These descriptions come from the linked pages and a web search, not from running the tools, and they may be out of date. Check each project's own documentation before you choose.

## Versus a shared `MEMORY.md` in git

A plain file kept in a repository is the simplest team memory. This plugin adds search ranked by TF-IDF and a forgetting curve (optionally with local vectors), a privacy filter that runs before anything is pushed, and an author check on org memories. The trust model is the same: anyone with push access can edit the file or the org vault, and nothing is reviewed first. If you only need a handful of stable notes, the plain file costs nothing and has no moving parts.

## Ideas this plugin builds on

- **Hermann Ebbinghaus (1885)**: the forgetting curve behind retention scoring.
- **Reciprocal Rank Fusion** (Cormack, Clarke & Buettcher, 2009): the scale-free merge (k = 60) of lexical and vector rankings.
- **[Obsidian](https://obsidian.md/)**: knowledge as a folder of Markdown files with frontmatter.
