# K4 — Repo topology and shared code (course pp. 26–27)

Sketch: [adl/repo-topology-kata.adl](adl/repo-topology-kata.adl) · Fitness functions: [k4-repo-topology.test.ts](../../plugins/total-recall/src/__tests__/katas/k4-repo-topology.test.ts) · Sketch IDs `[K4-01]`, `[K4-02]` (not `TR-*`; promotion is decided at K12).

**Scenario recap.** A mono-repo has services with an allow-list of dependencies, and an agent adds three forbidden ones. Explicit rules (name each forbidden pair) catch one, implicit rules (deny by default plus an inventory) catch all three. Then the team moves to repo-per-service and must decide what to share and what to duplicate. (Course model: `masterclassNealFord2026/make-the-grade-pages-26-27/answers.md`, outside this repo.)

**Mapping.** total-recall is one repo with three published shapes: the root `npx` bootstrap, the plugin subtree, and the derived `release` branch. The explicit-vs-implicit lesson applies to what `release.yml` strips from the release branch; the share-vs-duplicate table applies to the declarations that exist in more than one place.

## Questions → answers → evidence

| Course question | Answer for total-recall | Evidence |
|---|---|---|
| Tasks 1–3: explicit or implicit restriction? | Imports are already implicit: `structure.adl` states allow-lists per component and `TR-S12` is the inventory (every file has one owner). The **release strip list** is the explicit one: `release.yml` runs `git rm` on a named list, so a new contributor-only file ships by default. It had already drifted: `vitest.katas.config.ts` was added with the katas and not stripped. | `[K4-01]`, `TR-S12`, `release.yml` |
| Task 4: share or duplicate? | See the table below. | `[K4-02]` |
| Where do the checks run? | The authoritative gate stays `mutation.yml`; these checks run in `katas.yml`. | plan §3.6 |

## Share vs duplicate (course Task 4 table, applied)

| Code or declaration | Where | Changes | Decision | Guard |
|---|---|---|---|---|
| Version string | plugin `package.json`, Claude manifest, Gemini manifest, root npx `package.json` | every release | **Duplicate, single source + sync** | `sync-version.mjs`, `TR-Q3` (two copies), `[K4-02]` (all four and the sync list) |
| Hook scripts | `hooks/scripts/*` | rarely | **Share**: both `hooks.json` and `hooks.gemini.json` point at the same scripts | `hooks-parity.test.ts` |
| Hook wiring | `hooks.json` vs `hooks.gemini.json` | rarely | **Duplicate** (event names differ per host) | `hooks-parity.test.ts` |
| Install logic | root `install.sh` (6 lines) → `bin/cli.mjs` → plugin `install.sh` (813 lines) | the plugin one often | **Share by delegation**: the root file is a shim, not a copy | `cli.test.mjs`, `local.test.mjs` |
| Marketplace name and plugin id | `bin/cli.mjs`, `.claude-plugin/marketplace.json` | never (append-only) | **Duplicate**, kept equal | `[K3-02]` |

## What the sketch adds

- **`[K4-01]`** is the implicit form for the release tree. It classifies contributor-only paths by pattern (`vitest*.config.ts`, `stryker*.json`, `__tests__`, `.github/workflows`, `katas`) and requires each tracked match to be on the strip list read from `release.yml`. The test also asserts the list was really read, so an unparsable list cannot pass.
- **`[K4-02]`** closes the gap TR-Q3 leaves: the npx bootstrap is published to npm with provenance and its version was guarded only by a CI build step.

## Known-pass / known-fail (plan §3.3)

| Check | Known-pass | Known-fail (synthetic, `os.tmpdir()`) |
|---|---|---|
| `[K4-01]` strip list | list parsed in order; named paths and everything under a stripped directory covered; real tree → `[]` | a new vitest config and `katas/` would ship; an empty or unparsable list makes every contributor file ship |
| `[K4-02]` versions | four equal versions → `[]`; real tree → `[]` and the sync script names every copy | drifted bootstrap reported by name; a manifest the sync script does not name is reported |

9 tests, all green, so CI is never red on purpose.

## Finding and disposition (the check was red on the real tree before the fix)

On the first run `[K4-01]` reported `plugins/total-recall/vitest.katas.config.ts` as shipped. **Fix implementation, in this PR:** `release.yml` now also strips `plugins/total-recall/vitest.katas.config.ts` and `katas`. `--ignore-unmatch` makes the extra entries harmless while `katas/` is not yet on `main`. This also resolves the K1 note that `katas/` ships on the `release` branch.

## Dogfood log

- `index_architecture` on `katas/s1-k4-repo-topology`, `validate_architecture` on the repo root with `record:false`, `trace`, and the decision stored with `store_memory` (`elements: ["assert:K4-01","assert:K4-02"]`).

## Dispositions

| Item | Disposition |
|---|---|
| `[K4-01]` | Promotion candidate at K12 (next free ID `TR-Q12`). |
| `[K4-02]` | Promotion candidate at K12 (extends `TR-Q3` to the npx bootstrap). |
| Release strip list as a named list | Fixed for the two known paths; the pattern check is what keeps it fixed. |
| Gemini copy (`agy plugin install`, `--gemini`) | Subsumed by `hooks-parity.test.ts` and `TR-Q3`. |
| Repo-per-service split | Not applicable: the plan keeps one repo (non-goals §6). |
