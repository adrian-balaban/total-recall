# K1 — Entity Trap vs the real structure (course pp. 21–24)

Sketch: [adl/structure-kata.adl](adl/structure-kata.adl) · Fitness functions: [k1-structure.test.ts](../../plugins/total-recall/src/__tests__/katas/k1-structure.test.ts) · Sketch IDs `[K1-01]`, `[K1-02]` (not `TR-*`; promotion is decided at K12).

**Scenario recap.** An agent generates a system from requirements into an "entity" directory structure (one folder per noun) and every functional test passes. Does it implement the logical architecture? The course then shows a rule written with strings that match nothing: it passes while checking zero classes.

## Questions → answers → evidence

| Course question | Answer for total-recall | Evidence |
|---|---|---|
| p.21: is the structure an Entity Trap? | No. The partition is by capability (helpers, state, paths, walk, index cache, persistence, search, vectors, registry, tools, server, spec), not by noun. The shared singletons are confined to `state.ts`. | `structure.adl` (`TR-S1..S15`); `TR-S9`, `TR-S15` ([state.test.ts](../../plugins/total-recall/src/__tests__/state.test.ts)) |
| pp.21–22: write the domains ADL | The production `structure.adl` already is that ADL. Nothing to add. | [structure.adl](../../plugins/total-recall/architecture/adl/structure.adl) |
| p.23: services + a shared library | Three standalone bundles (`frontmatter`, `privacy-filter`, `build-index-cache`) import only enumerated leaves. | `TR-S1`, `TR-S13`, `TR-S14` |
| Task 2: why did the rule pass while checking nothing? | Vacuity. `IS DEPENDENT ON` is an existence claim; a per-class reading is the wrong rule and fails on correct code. We have the same risk in reverse (below). | `[K1-01]`, `[K1-02]` |
| Task 3: an agent adds a `retake` directory | A file outside every file-set is caught by `TR-S12`. | `TR-S12` ([fitness.test.ts](../../plugins/total-recall/src/__tests__/architecture/fitness.test.ts)) |
| Task 4: where do the checks run? | The authoritative gate is `mutation.yml`; kata checks run in the non-gating `katas.yml`; `validate_architecture` is the local dogfood check. | `GOVERNANCE.md` §5 |

## What the sketch adds

- **`[K1-01]` — no missing link.** `TR-S12` proves every file has exactly one owner. Nothing proved the reverse: a component that owns no files (after a rename, or a stale ADL line) makes every rule about it vacuously green. The check compares `structure.adl` component IDs with `COMPONENT_FILES` keys both ways and requires every file-set to match at least one production file.
- **`[K1-02]` — allow-lists are exercised.** `TR-S6` and `TR-S11` are allow-lists (a ceiling), not claims that an edge exists. The first draft asserted that the edges exist, which turns a ceiling into a floor (if `bulk` stopped using `mutate`, `TR-S11` would still hold but the check would fail for no architectural reason). It is reframed as: each owner imports at least one target it allows. An allow-list nothing uses restricts nothing worth restricting.

## Known-pass / known-fail (plan §3.3)

| Check | Known-pass (real tree) | Known-fail (synthetic, `os.tmpdir()`) |
|---|---|---|
| ADL IDs ↔ `COMPONENT_FILES` keys | match both ways | a ghost ADL component and an unlisted file-set → exactly `ghost` / `extra` |
| every file-set owns a file | `[]` on `src/` | a set matching nothing → exactly `persistence` |
| allow-lists exercised | `[]` for registry / bulk / architecture | owner importing nothing allowed → exactly `bulk` |
| existence vs per-class (pp. 23–24) | existence holds with one importer | per-class flags `QuestionFormatter` (wrong rule, asserted); without the importer the existence check fails |

8 tests, all green, so CI is never red on purpose. `[TR-Q4]` and `[TR-Q5]` also walk this folder.

## Dogfood log

- `index_architecture` on `katas/s1-k1-structure` → system `trk1`, 2 components, 2 assertions. On the kata folder alone `trace` shows no tests, because the index cannot see the test file (plan §4); re-indexing at the repo root links all 5 `[K1-01]` tests.
- `validate_architecture` on the repo root, `record:false` → `trk1`: 2 passed, `tr`: 72 passed, no failures. This proves the IDs are wired to tests, not that the checks pass; the proof is `npm run test:katas`.
- `trace` K1-01 / K1-02 and `get_architecture_context(trk1)` run before writing the tests' final shape.
- Decision stored via `store_memory` (`category: architecture-changes`, `elements: ["assert:K1-01","assert:K1-02"]`).

## Dispositions

| Item | Disposition |
|---|---|
| `[K1-01]` | Promotion candidate at K12 (next free ID `TR-S16`). |
| `[K1-02]` | Promotion decision at K12. |
| Junk drawers / orphan nodes | Subsumed by existing `TR-S12`. |
| Enumerated leaves | Subsumed by existing `TR-S1`. |
| State singleton | Subsumed by existing `TR-S15`. |
| `katas/` ships on the `release` branch | `release.yml` strips `src/__tests__` but not `katas/`. Users never receive it (the marketplace installs only `plugins/total-recall`). No fix needed now; if it matters, add `katas` to the `git rm` list. Expiry: revisit at K12. |

No product finding needed a `BACKLOG.md` entry.
