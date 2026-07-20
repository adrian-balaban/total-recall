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
| 8 | `new Server(...)` uses the SDK's deprecated low-level `Server` class | `@deprecated` in SDK 1.29.0; candidate for removal in 2.x; new SDK features land in `McpServer` first | Migrate to `McpServer` + `registerTool()` as a dedicated pass — see details below; pairs naturally with item 4 |

These are incremental hardening items, not urgent fixes — the plugin's test discipline (95% coverage gate, regression tests pinning every documented gotcha) is already well above typical for a project this size.

## Item 8 — migrate off the deprecated low-level `Server` class

`new Server(...)` at `src/server.ts:43` uses the low-level `Server` class, which the installed SDK (1.29.0) marks `@deprecated Use McpServer instead for the high-level API. Only use Server for advanced use cases.` "Removing the deprecation" means migrating to `McpServer` with `registerTool()` instead of the manual `ListToolsRequestSchema`/`CallToolRequestSchema` handlers. The trade-off for this codebase specifically:

### Advantages

- **Future-proofing.** New SDK features (tool `outputSchema`/structured content, `tools/list_changed` notifications, elicitation, completions) land in `McpServer` first, and a deprecated class is a candidate for removal in SDK 2.x. Staying on `Server` means eventually migrating anyway, possibly under time pressure.
- **Input validation at the boundary.** `registerTool` takes Zod shapes and validates arguments before the handler runs. Today the 17 tool handlers receive raw args — that's exactly why gotchas like the scalar-`tags` leniency in `update_memory` exist. Malformed calls would be rejected uniformly instead of handled ad hoc per tool.
- **Less boilerplate, better cohesion.** The hand-rolled dispatch table and the giant `tools:[...]` array in `server.ts` disappear; each tool's schema, description, and handler live together in one `registerTool` call. Handler args become typed from the schema instead of casts.

### Disadvantages

- **It's a large, risky diff for zero functional gain.** 17 hand-written JSON Schemas must be converted to Zod, and the tool descriptions/schemas emitted in `tools/list` are load-bearing here — they're what Claude reads. Zod→JSON-Schema conversion can subtly change the emitted payload (how `default`, `minimum`/`maximum`, `items` render), so integration tests asserting schema parity before/after are required.
- **Bundle growth.** Zod becomes a real runtime dependency in the esbuild bundle, and `dist/` is committed and shipped via git-subdir — every consumer pulls the larger artifact.
- **Pinned lenient behaviors change.** Strict validation would reject inputs the code deliberately tolerates today (e.g. the T3-pinned scalar-`tags` "ignore, don't wipe" behavior). Arguably an improvement, but it changes tested, documented semantics and every such test needs rework.
- **The deprecation is advisory only.** It's a JSDoc marker, no runtime warning, and `Server` is explicitly still supported "for advanced use cases." The current code works with the full test suite green — this is churn, not a bug fix.
