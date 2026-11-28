# K7 — Quanta and coupling (course pp. 40–43)

Sketch: [adl/quanta-kata.adl](adl/quanta-kata.adl) · Fitness functions: [k7-quanta-coupling.test.ts](../../plugins/total-recall/src/__tests__/katas/k7-quanta-coupling.test.ts) · Sketch IDs `[K7-01]`, `[K7-02]` (not `TR-*`; promotion is decided at K12).

**Scenario recap.** Count the architecture quanta and list every static coupling point that binds them; apply a broker to break the coupling; write the static-coupling ADL; then reason about dynamic coupling (concurrency, entanglement), write capability ADL, and a communication ADL that chooses sync or async per link and an assertion that keeps agents to it. (Course model: `masterclassNealFord2026/make-the-grade-pages-40-41` and `-42-43`, outside this repo.)

## Questions → answers → evidence

| Course question | Answer for total-recall | Evidence |
|---|---|---|
| 40–41 Task 1: how many quanta, and what binds them? | Three, declared in `system.adl`: `server` = {MCP server, embedder} (one Node process), `hooks` = short-lived processes on their own bundles, `remote` = the org git repository. Static coupling across them is restricted by `TR-S13`, `TR-S14` and `TR-R5`. | `system.adl`, `structure.adl` |
| 40–41 Task 2–3: break the coupling, write the ADL | Already broken by construction: the hook bundles import only enumerated leaves and never the server. The ADL exists. | `TR-S13`, `TR-S14` |
| 42–43 Task 1: dynamic coupling (what concurrency can be supported) | The server serialises tool calls in one process; `index.json` is single-writer by assumption (no lock). The hooks add the cross-process couplings below. | `plugins/total-recall/CLAUDE.md` gotcha, `[K7-01]` |
| 42–43 Task 3: sync or async per link, and the assertion | Every edge in `system.adl` already carries `# edge: sync/async` (enforced by `adl-consistency.test.ts`). `[K7-02]` adds the property that matters: nothing synchronous reaches the external party. | `[K7-02]` |

## The dynamic couplings between the hooks and the server

| Evidence in code | Mechanism | Latency | Declared in `system.adl`? |
|---|---|---|---|
| `pull-org-vault.sh` touches `~/.total-recall/.reconcile-requested` | marker file, server polls | up to 10 s (`DEFAULT_POLL_MS`, a decided design) | **no** |
| `store-learning.mjs` touches the same marker | marker file | up to 10 s | **no** |
| `session-end.sh` SIGTERMs the MCP child | signal; the child's `shutdown()` flushes (`TR-W2`) | immediate | **no** |

All three are the same edge, Lifecycle Hooks TO MCP Stdio Server, asynchronous. `system.adl` declares only the opposite direction (`server-mode-sync`).

## What the sketch adds

- **`[K7-01]`** reads the evidence from the hook scripts (marker file name, `SIGTERM`) and requires a `DEFINE COMMUNICATION` between the same two services. On the real tree it finds exactly one missing pair and pins it.
- **`[K7-02]`** is the course's "keep agents to async" assertion for the one external. The real tree passes, and the test asserts the external and an edge to it exist, so it is not vacuous.

## Known-pass / known-fail (plan §3.3)

| Check | Known-pass | Known-fail (synthetic, `os.tmpdir()`) |
|---|---|---|
| `[K7-01]` | hooks with a declared hooks-to-server edge → `[]`; a coupling with no code evidence is not demanded | same hooks without the declaration → the pair, once; the real tree → `['Lifecycle Hooks TO MCP Stdio Server']` (pinned finding) |
| `[K7-02]` | async edge to the external → `[]`; the real `system.adl` → `[]` | a sync edge, or an unlabelled one, to the external is named |

7 tests, all green, so CI is never red on purpose.

## Dogfood log

- `index_architecture` on `katas/s2-k7-quanta-coupling`, `validate_architecture` on the repo root with `record:false`, `trace`, and the decision stored with `store_memory` (`elements: ["assert:K7-01","assert:K7-02"]`).

## Dispositions

| Item | Disposition |
|---|---|
| Missing hooks-to-server edge in `system.adl` | **Revise ADL** at K12: add `# edge: async` + `DEFINE COMMUNICATION Lifecycle Hooks TO MCP Stdio Server AS marker-and-signal`, and a `TR-*` assertion for `[K7-01]` (next free ID `TR-R9`). |
| `[K7-02]` | Promotion candidate at K12 (next free ID `TR-R9` or `TR-C10`, whichever K12 allocates first). |
| Fixed 10 s poll | Existing `DECIDED` entry in `BACKLOG.md`; unchanged. |
| Stressors not yet covered (Node version, config without restart) | K8. |
