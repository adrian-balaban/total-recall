# K10 — "No memory may be lost" (course pp. 35–36, no-lost-answer reconciliation)

Sketch: [adl/no-lost-memory-kata.adl](adl/no-lost-memory-kata.adl) · Fitness functions: [k10-no-lost-memory.test.ts](../../plugins/total-recall/src/__tests__/katas/k10-no-lost-memory.test.ts) · Sketch IDs `[K10-01]`..`[K10-03]` (not `TR-*`; promotion is decided at K12).

**Scenario recap.** Prove that no answer was lost between receipt and grading; say what happens when the consumer crashes right after taking a message off the queue. (Course model: `masterclassNealFord2026/make-the-grade-pages-35-36`, outside this repo; these pages sit in the course's S2 block.)

**Mapping.** The "answer" is a memory. The `.md` file is the only copy of its content (the index files are re-derived from it on boot). A crash can truncate a file, a failed archive can drop a prior body, and an extract can be mistaken for a deliberate memory.

## Questions → answers → evidence

| Course question | Answer for total-recall | Evidence |
|---|---|---|
| What proves nothing is lost between receipt and storage? | `.md` is written before its index entry, so a crash loses index state, never content (`TR-W3`). A force-overwrite archives the prior body and records `supersededAt` (`TR-D11`). Index files are written atomically (`TR-W1`). | `workflows.adl`, `data-governance.adl` |
| What happens if the writer crashes mid-write? (the course's "grading crashes after taking an answer off the queue") | For the hook writer, nothing: it writes tmp then renames and cleans up an in-flight tmp on SIGTERM. For the server writers (`store.ts`, `mutate.ts`) a crash mid-write can truncate the file. That is a recorded `DEFERRED` decision, not an oversight. | `[K10-01]`, `BACKLOG.md` |
| What if the archive of the old body fails? | The overwrite proceeds and the prior body is gone; the failure is not recorded. | `[K10-03]` |
| Can the reconciliation tell what it is reconciling? | Not for the PreCompact extractor: it writes `sessions: []` and no origin. | `[K10-02]` |
| The index with no lock (single-writer assumption) | Documented decision; disk-durable fields are re-derived from `.md` on boot, so a clobber loses only `accessCount` and `lastAccessed`. Nothing to add. | `plugins/total-recall/CLAUDE.md` |

## What the sketch adds

- **`[K10-01]`** counts raw `fs.writeFileSync` sites in `store.ts` and `mutate.ts` (comments stripped) and pins the pairing with the backlog exemption both ways: writes without an entry fail, an entry once the writes are gone is stale. Pinned at **4** sites: store (file and archive) and mutate (update and confirm).
- **`[K10-02]`** flags a memory writer that writes `sessions: []` with no origin marker. The real tree flags only the PreCompact extractor.
- **`[K10-03]`** flags an archive `catch` that neither records the error nor rethrows. The real `store.ts` swallows it.

## Known-pass / known-fail (plan §3.3)

| Check | Known-pass | Known-fail |
|---|---|---|
| `[K10-01]` | raw writes with an entry and a trigger; comments do not count; the real tree has 4 sites, an atomic hook writer and the entry | raw writes with no entry; an entry once the writes are gone |
| `[K10-02]` | a writer that stamps a session, or an origin | a writer with empty sessions and no origin; the real extractor (pinned) |
| `[K10-03]` | a catch that records the error | a catch that swallows it; the real `store.ts` (pinned) |

10 tests, all green, so CI is never red on purpose.

## Dogfood log

- `index_architecture` on `plugins/total-recall/architecture/katas/s3-k10-no-lost-memory`, `validate_architecture` on the repo root with `record:false`, `trace`, and the decision stored with `store_memory` (`elements: ["assert:K10-01","assert:K10-02","assert:K10-03"]`).

## Dispositions

| Item | Disposition |
|---|---|
| Raw `.md` writes in the server | Existing `DEFERRED` entry ("Atomic writes for memory `.md` files"); unchanged. `[K10-01]` keeps it from going stale. |
| Silent archive failure | **Exemption with expiry:** new `DEFERRED` entry in `BACKLOG.md` (trigger: next change to the force-overwrite path; expiry 2027-06-30). One-line fix when picked up. |
| Extractor provenance | **Exemption with expiry:** new `DEFERRED` entry in `BACKLOG.md` (trigger: pruning or recall needs to tell them apart). |
| `[K10-01]` | Promotion candidate at K12 (next free ID `TR-W11`); folds into the atomic-writes ADR when that is decided. |
| `[K10-02]`, `[K10-03]` | Promote at K12 only after the matching backlog fix lands; until then they stay sketches with the finding pinned. |
