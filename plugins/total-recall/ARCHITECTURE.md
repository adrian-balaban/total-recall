# 🏗️ Total-Recall — Architecture

An MCP stdio server (`dist/index.js`, TypeScript in `src/`) plus lifecycle hooks that give Claude Code and Gemini CLI persistent, searchable memory.

![Session loop](../../docs/diagrams/session-loop-en.svg)

---

## 🧭 C4 Model

### C1 — System context

![C1 system context](architecture/diagrams/c1-context.svg)

### C2 — Containers

![C2 containers](architecture/diagrams/c2-containers.svg)

### C3 — Components (MCP server)

![C3 components](architecture/diagrams/c3-components.svg)

### C4 — Code: `recall_memory`

![C4 recall_memory](architecture/diagrams/c4-recall.svg)

---

## 🛠️ The 22 MCP tools

![The 22 MCP tools](architecture/diagrams/tools.svg)

With `specDriven.enabled: false` the 5 architecture tools and the spec fields are not registered: `tools/list` is the 17-tool golden (`schema-parity.integration.test.ts`).

---

## 🧬 Data model

![Data model](architecture/diagrams/data-model.svg)

---

## 🔀 Write path

![store_memory routing](../../docs/diagrams/store-routing-en.svg)

![store_memory write path](architecture/diagrams/write-path.svg)

---

## 🚀 Lifecycle and persistence

![Server lifecycle](architecture/diagrams/lifecycle.svg)

![Persistence and debounce](architecture/diagrams/persistence.svg)

---

## 🪝 Hooks

![Hook lifecycle](architecture/diagrams/hooks.svg)

---

## 🔐 Org sync

![Runtime landscape](architecture/diagrams/landscape.svg)

![Org sync saga](architecture/diagrams/org-sync.svg)

The fail-closed filter blocks secret tokens, emails (except `allowedEmailDomains`), Luhn-valid cards, mod-97 IBANs and formatted phone numbers. The "don't sync" guard is the `personal`/`org` tag exclusion.

---

## 📐 Architecture as code

![ADL files and tests](architecture/diagrams/adl-files.svg)

![Where the ADL assertions are checked](architecture/diagrams/fitness.svg)

Each `ASSERT` ends with a tag such as `# [TR-S2]`; the test that checks it carries the same tag. `adl-coverage.test.ts` fails on an untested assertion or an unknown ID.

Sources: `architecture/diagrams/*.puml` and `../../docs/diagrams/*.puml`. Re-render: `java -jar plantuml.jar -tsvg architecture/diagrams/*.puml` (add `!pragma layout smetana` when `dot` is absent).

---

## ⚖️ Key invariants

| Invariant | Enforced in |
|---|---|
| One `memIndex` per process | `state.ts` |
| `.md` written before the index `[TR-W3]` | `store.ts` |
| Index files written atomically `[TR-W1]` | `persistence.ts` `atomicWrite()` |
| `accessCount`/`lastAccessed` survive `rebuild_index` `[TR-W4]` | `vault-scan.ts` |
| `shutdown()` runs once `[TR-W2]` | `index.ts` `shuttingDown` latch |
| `org` + `personal` exclusive `[TR-D7]` | `store.ts` |
| Org writes author-protected, caller `author` ignored `[TR-D4]` `[TR-D8]` | `store.ts` |
| `category` cannot escape the vault `[TR-D6]` | `store.ts`, before `ensureDir` |
| Frontmatter values reject newlines `[TR-D9]`; keys escaped before `RegExp` | `frontmatter.ts` |
| Journal only on personal `store_memory` | `store.ts` |
| `sessions` ≤ 50, deduped `[TR-P2]` | `mutate.ts` |
| `rerank_memories` ≤ 200 keys `[TR-P1]` | `rerank.ts` |
| Unreadable export → `{key, error}`, skipped on import `[TR-W7]` | `bulk.ts` |
| Optional deps never bundled | esbuild `--external` |
| SessionStart output carries `hookEventName` `[TR-C5]` | `load-memory-index.sh` |
| PostToolUse matcher stays a regex | `hooks-matcher.test.ts` |
| PreCompact reads `transcript_path` from stdin JSON | `extract-and-store-memories.sh` |
