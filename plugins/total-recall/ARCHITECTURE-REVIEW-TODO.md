# Architecture review — total-recall plugin

Structure is sound: `index.ts` (boot stub) → `server.ts` (schemas + dispatch) → `tools/*.ts` → shared `state.ts`/`persistence.ts`/`vault-scan.ts` for storage, `tfidf.ts`/`ebbinghaus.ts`/`rrf.ts` for search, `embeddings.ts`/`vectorStore.ts` for the optional vector path. Every advertised feature has matching, tested implementation — no gaps between docs and code.

## Risks identified

| # | Issue | Why it matters | Suggested change |
|---|---|---|---|
| 1 | `index.json` has no lock (single-writer assumption, documented but unmitigated) | Concurrent Claude Code windows can clobber `accessCount`/`lastAccessed` | Advisory lock or merge-on-read for runtime-only fields |
| 2 | Embedding provider is a hardcoded if/else (`embeddings.ts`) | Blocks adding OpenAI/Voyage/Cohere without touching core logic | Extract an `EmbeddingProvider` interface + registry map |
| 3 | Full vault walk on every boot (`vault-scan.ts`) | Won't scale past low tens of thousands of files, even with mtime skip-check | Persist directory-level mtime cache to skip whole subtrees |
| 4 | `server.ts` mixes 17 tool schemas + dispatch in one 356-line file | Growing pains as tool count increases | Co-locate schema with implementation in each `tools/*.ts` |
| 5 | Org sync freshness relies on marker-file polling | Teammate memories can lag until next poll/hook fires | Optional `fs.watch`-based fast path, falling back to polling on network filesystems |
| 6 | No schema-version marker in `index.json`/frontmatter | Future breaking format changes have no clean migration hook | Add `indexVersion`, checked at `loadIndexes()` to trigger rebuild |
| 7 | `state.ts` global singletons couple the whole `tools/*` layer to one process | Blocks any future multi-tenant/worker-pool design | Acceptable now (personal-use tool); worth flagging if scope ever grows beyond single-user |

These are incremental hardening items, not urgent fixes — the plugin's test discipline (95% coverage gate, regression tests pinning every documented gotcha) is already well above typical for a project this size.
