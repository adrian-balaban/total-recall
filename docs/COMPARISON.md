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

## Versus a shared `MEMORY.md` in git

A plain file kept in a repository is the simplest team memory. This plugin adds search ranked by TF-IDF and a forgetting curve (optionally with local vectors), a privacy filter that runs before anything is pushed, and an author check on org memories. The trust model is the same: anyone with push access can edit the file or the org vault, and nothing is reviewed first. If you only need a handful of stable notes, the plain file costs nothing and has no moving parts.

## Ideas this plugin builds on

- **Hermann Ebbinghaus (1885)**: the forgetting curve behind retention scoring.
- **Reciprocal Rank Fusion** (Cormack, Clarke & Buettcher, 2009): the scale-free merge (k = 60) of lexical and vector rankings.
- **[Obsidian](https://obsidian.md/)**: knowledge as a folder of Markdown files with frontmatter.
