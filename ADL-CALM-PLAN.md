# Plan: architecture as code for total-recall (ADL + CALM)

Goal: describe the architecture of `plugins/total-recall` once, declaratively, and have the build fail when the code drifts from it.

- **ADL** (the notation from the "Architecture as Code" course) covers the code level: components, allowed dependencies, runtime-safety rules, data governance and code-quality limits.
- **CALM** (FINOS Common Architecture Language Model) covers the system level: the containers, their connections and the controls on those connections.
- **ArchUnitTS** (already in the repo) stays the engine for the import rules. The ADL becomes the source those tests follow.

Status: plan only. Nothing is implemented yet. Nothing will be committed; the result is reviewed as a diff.

## Starting point

- `ARCHITECTURE.md` gives C4 diagrams, a module map, the data model and the dual-vault routing.
- `src/__tests__/architecture/fitness.test.ts` holds 9 ArchUnitTS rules that encode the module map. It is untracked.
- `package.json` and `package-lock.json` are modified (the `archunit` dependency).
- `banking-environment-requirements.md` and `banking-readiness-plan.md` are deleted in the working tree.

The plan builds on this uncommitted work and does not touch the two deleted files.

## Target layout

```
plugins/total-recall/
├── architecture/
│   ├── adl/
│   │   ├── structure.adl
│   │   ├── runtime-safety.adl
│   │   ├── data-governance.adl
│   │   └── code-quality.adl
│   └── calm/
│       └── total-recall.calm.json
└── src/__tests__/architecture/
    ├── components.ts            # component → file mapping, single source for the regexes
    ├── fitness.test.ts          # existing rules, now importing from components.ts, tagged with ADL IDs
    ├── adl-coverage.test.ts     # every ASSERT has a test with its ID
    ├── privacy-routing.test.ts  # behavioural check of the org-vault rule
    └── calm.test.ts             # CALM node IDs match the ADL / module map (optional, step 4)
```

## Step 1: map what exists (read only)

1. Read `ARCHITECTURE.md` (C2, C3, module map, dual-vault routing, write path) and `fitness.test.ts`.
2. Make a table: each architectural rule → test that enforces it, or "not tested".
3. Record the known debt: the `state.ts` → `persistence.ts` back-edge that causes the six cycles (`it.fails`).

Output: the table, added to this file under "Rule inventory".

## Step 2: write the ADL

Each assertion gets a stable ID in a trailing comment, for example `# [TR-S1]`. The same ID appears in the test name.

| File | Content |
|---|---|
| `structure.adl` | `DEFINE SYSTEM` / `DOMAIN` / `COMPONENT` / `LIBRARY` for the modules: pure helpers, state, persistence, search, vectors, registry, write tools, read tools, server. Assertions: helpers depend on nothing local; core never depends on tools; nothing depends on the server or entry point; production never depends on test code; the registry depends only on state; no cycles (known debt) |
| `runtime-safety.adl` | Only the vectors component loads `@huggingface/transformers`, `better-sqlite3`, `sqlite-vec`; the MCP server never writes to stdout; a missing optional dependency degrades to TF-IDF |
| `data-governance.adl` | `DEFINE DATABASE` for the personal and org vaults. Memories tagged `org` reach the org vault only after the fail-closed privacy filter; untagged memories stay personal; org writes are author-protected |
| `code-quality.adl` | `DEFINE CONST MAX_LINES_PER_FILE = 600`, applied with `FOREACH COMPONENT` |

## Step 3: make the tests follow the ADL

1. **`components.ts`**: one exported map from component ID to file regex. `fitness.test.ts` imports `LEAVES`, `TOOLS`, `ENTRY`, `OPTIONAL_DEP_OWNERS` from it instead of hand-typing them.
2. **Tag the tests**: each existing `it(...)` name starts with its ADL ID, for example `it('[TR-S2] core modules never depend on the tools layer', ...)`.
3. **`adl-coverage.test.ts`**: parses every `.adl` file, collects the assertion IDs, scans the test files for the same IDs, and fails on any ID with no test (and any test ID with no assertion).
4. **`privacy-routing.test.ts`**: through the store path, with an isolated `HOME`:
   - an `org`-tagged memory containing a secret is rejected and no file appears in the org vault;
   - a clean `org`-tagged memory lands in the org vault;
   - an untagged memory lands in the personal vault only.

   It follows the existing test conventions for HOME isolation.

## Step 4: write the CALM document

1. **Check the schema first**: run `npx @finos/calm-cli --help` and look at the CALM 1.0 meta-schema, so the property names come from the spec, not from memory.
2. **`total-recall.calm.json`**:
   - **Nodes**: the Claude Code / Gemini client (actor), the MCP server (service), the lifecycle hooks (service), the personal vault (data store), the org vault git repo (data store), local embeddings (optional service).
   - **Relationships**: client → server over stdio/MCP; client → hooks; server → personal vault (file writes); server → org vault (file writes + git sync); hooks → server's bundled helpers; server → embeddings.
   - **Controls**: privacy filter (fail-closed) and author protection on server → org vault; TF-IDF fallback on server → embeddings.
3. **Optional `calm.test.ts`**: checks that every CALM node has a matching container in `ARCHITECTURE.md`, so the C2 diagram can't drift silently.

## Step 5: CI

1. Add a step to `.github/workflows/mutation.yml` (the single gate), after `npm test`:
   `npx --yes @finos/calm-cli@<pinned version> validate -a architecture/calm/total-recall.calm.json`
2. The ADL coverage and privacy tests run inside the existing `npm test`, so they need no extra step.
3. Pin the CLI version, in line with the repo's supply-chain care (`npm audit` gate).

## Step 6: verify and document

1. Run `npm run typecheck`, `npm test`, `npm run build && npm run test:integration` and the CALM validate command locally.
2. Prove each kind of check fails, then revert:
   - an import from a core module into `src/tools/` → the ArchUnit rule goes red;
   - an `ASSERT` with a new ID and no test → `adl-coverage.test.ts` goes red;
   - a CALM relationship pointing at a missing node → `calm validate` goes red;
   - the privacy filter bypassed → `privacy-routing.test.ts` goes red.
3. Add an "Architecture as code" section to `ARCHITECTURE.md` linking the ADL files, the CALM document and the tests, and explaining the ID convention.
4. Report the results, with the outputs, and list anything not done.

## Out of scope

- Committing, pushing or releasing.
- Paying the cycle debt (`state.ts` → `persistence.ts`). The ADL records it; fixing it is a separate change.
- Changes to the hooks scripts or the build.

## Risks and assumptions

- The course ADL has no runtime. Its assertions are enforced by the tests mapped to them, and the coverage test is what keeps the two in step.
- CALM property names and CLI flags must be checked against the installed version (step 4.1); the sketches in chat were from memory.
- `npx` downloads the CALM CLI in CI. If that is not acceptable, add it as a pinned dev dependency instead.
- The privacy test depends on how `store_memory` resolves vault paths; it will reuse whatever isolation the existing tests use.

## Rule inventory

Built in step 1, before any change. "Starting point" above is partly out of date: `package.json` was already clean (archunit committed), so only the files listed under `git status` were uncommitted.

| Rule | Enforced by (before) | ADL ID (after) |
|---|---|---|
| Leaf modules have no local imports | fitness.test.ts | TR-S1 |
| Core never depends on tools | fitness.test.ts | TR-S2 |
| Nothing depends on server / entry point | fitness.test.ts | TR-S3 |
| Production never depends on test code | fitness.test.ts | TR-S4 |
| Each tool depends on no other tool except the registry | fitness.test.ts (5 cases) | TR-S5 |
| Registry depends only on state | fitness.test.ts | TR-S6 |
| No circular dependencies | fitness.test.ts, `it.fails` (known debt) | TR-S7 |
| Only embeddings / vectorStore load optional deps | fitness.test.ts | TR-R1 |
| No stdout writes | fitness.test.ts | TR-R2 |
| Missing optional dep degrades, never fails | vectorStore-selfheal.test.ts (untagged) | TR-R3 |
| Org tag routes to the org vault | not tested as a rule | TR-D1 |
| Untagged memory stays personal | not tested as a rule | TR-D2 |
| Privacy filter fails closed before the org push | privacy-filter unit tests, sync e2e (email case only) | TR-D3 |
| Org writes are author-protected | mutate.test.ts (delete); store path not tested | TR-D4 |
| Files at most 600 lines | fitness.test.ts | TR-Q1 |

## Result (steps 2–6)

- **Deviation, step 3.4.** The plan assumed the privacy filter rejects a secret inside `store_memory`. It does not: the filter runs in `sync-org-memory.mjs`, and `store_memory` only warns on a secret. `privacy-routing.test.ts` therefore checks routing through `storeMemory` (TR-D1, TR-D2, TR-D4) and the filter through `privacyCheck` (TR-D3), not "rejected and no file in the org vault".
- **CALM.** Controls need a requirement document, so `architecture/calm/controls/*.requirement.json` plus `url-mapping.json` resolve them locally. The CALM 1.0 `protocol` enum has no stdio value, so the transport is in `metadata`.
- **CI.** `Validate CALM architecture` step added to `mutation.yml` after the integration tests, with `@finos/calm-cli@1.66.0` and `--strict`.
- **Failure proofs.** Core → tools import (TR-S2 red), unmatched `ASSERT` (coverage red), relationship to a missing node (`calm.test.ts` and `calm validate` red), privacy filter bypassed (TR-D3 red). All reverted.
