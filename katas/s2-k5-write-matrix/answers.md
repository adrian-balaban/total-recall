# K5 — The write matrix and privacy (course pp. 33–38)

Sketch: [adl/write-matrix-kata.adl](adl/write-matrix-kata.adl) · Fitness functions: [k5-write-matrix.test.ts](../../plugins/total-recall/src/__tests__/katas/k5-write-matrix.test.ts) · Sketch IDs `[K5-01]`, `[K5-02]` (not `TR-*`; promotion is decided at K12).

**Scenario recap.** Make the Grade picks a database topology (monolithic, domain, dedicated) and writes access assertions: which services may touch which databases, where the answer keys live, and why access is an assertion and not a nested `DEFINE DATABASE`. (Course model: `masterclassNealFord2026/make-the-grade-pages-33-34`, `-35-36`, `-37-38`, outside this repo.)

**Mapping.** total-recall has one "database topology": two vaults of `.md` files (personal, org), a local `index.json` and `invertedIndex.json`, a `vectors.db` sqlite file, a derived `.index-cache.txt` and a journal. Services are the MCP server, the hook scripts and the org-sync script.

## Questions → answers → evidence

| Course question | Answer for total-recall | Evidence |
|---|---|---|
| Task 1–2: which topology, and its ADL? | Domain databases: personal vault (default) and org vault (shared by git), plus derived local files. The ADL exists: `DEFINE DATABASE Personal Vault / Org Vault`, routing `TR-D1`/`TR-D2`. | `data-governance.adl` |
| Task 3: where do the keys (the data nobody else may write) live? | In the index files: `index.json` and `invertedIndex.json` are written only by `persistence.ts` through `atomicWrite`; `vectors.db` only by `vectorStore.ts`; `.index-cache.txt` only by the cache builder (`TR-W8`). | `[K5-01]`, `TR-W1`, `TR-W8` |
| Task 4: why assertions and not nesting? | Same reason here: a writer set is a relation between files and artifacts, not a property of either. `[K5-01]` states it as that relation and inventories the raw writers. | `[K5-01]` |
| 35–36 Task 1: which assertion does a forbidden new connection break, and which analysis catches it first? | A new file writing `index.json` breaks `[K5-01]` (static analysis, at test time). A runtime writer through a new process is only caught by the single-writer note in `plugins/total-recall/CLAUDE.md` (no lock). | `[K5-01]` |
| 35–36 Task 3: prove no answers were lost | The org queue drain already has the reconciliation (`TR-W9`, `TR-W10`); that is K6. | `workflows.adl` |
| What may leave the machine? | Only through `sync-org-memory.mjs`, behind `privacyCheck`. `[K5-02]` makes that a property of every push site, in any language. | `TR-D3`, `[K5-02]` |

## What the sketch adds

- **`[K5-01]`** is the course's access assertion as code: a writer table per artifact, plus an inventory of every production file holding a raw filesystem write. Evidence is read from the source with comments stripped (so a comment naming `writeFileSync` does not count). `vectors.db` is keyed on SQL write statements, because several files only pass its path around.
- **`[K5-02]`** is a push-site inventory across `src`, `hooks/scripts` and `scripts`: `git push` in TypeScript (`['push'`) or shell. `TR-D3` pinned the behaviour of one file; this stops a second pusher from appearing unfiltered.

## Known-pass / known-fail (plan §3.3)

| Check | Known-pass | Known-fail (synthetic, `os.tmpdir()`) |
|---|---|---|
| `[K5-01]` per artifact | real tree: each artifact has exactly its declared writers | a rogue `src/rogue.ts` writing `INDEX_PATH` is named; SQL writes outside the vector store are named |
| `[K5-01]` inventory | real tree: no unlisted raw writer; every list entry still has a sink | an unlisted `unlinkSync` is named; a comment mentioning one is not |
| `[K5-02]` push sites | real tree: one push site, and it imports the filter | a TS/mjs push and a shell push, both without the filter, are named |

8 tests, all green, so CI is never red on purpose.

## Dogfood log

- `index_architecture` on `katas/s2-k5-write-matrix`, `validate_architecture` on the repo root with `record:false`, `trace`, and the decision stored with `store_memory` (`elements: ["assert:K5-01","assert:K5-02"]`).

## Dispositions

| Item | Disposition |
|---|---|
| `[K5-01]` | Promotion candidate at K12 (next free ID `TR-D14`). The `.index-cache.txt` row overlaps `TR-W8`; keep one. |
| `[K5-02]` | Promotion candidate at K12 as a sharpening of `TR-D3` (next free ID `TR-D14` or `TR-W11`). |
| Hook scripts writing `.md` files (`store-learning.mjs`) | Outside the TypeScript matrix. It writes the personal vault only, non-overwriting, and is pinned by its own tests. Not added; revisit at K10 (provenance). |
| No-lock `index.json` (single writer assumption) | Existing documented decision; K10 revisits it. |
