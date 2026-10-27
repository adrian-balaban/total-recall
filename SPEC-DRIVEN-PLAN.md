# Plan: total-recall for spec-driven engineering with ADL and CALM

Goal: when a team (people and agents) builds a new system from a spec, total-recall remembers the spec, the architecture (ADL and CALM), the decisions behind them and how they changed, and gives each session the right part of it at the right time. The build checks the code against the architecture; total-recall keeps the reasons and the history.

Status: implemented, phases 0–7 (see "Result and deviations" at the end). It follows [ADL-CALM-PLAN.md](ADL-CALM-PLAN.md), which applies ADL and CALM to total-recall itself (phase 0 below).

## Principles

1. **The repo is the source of truth, total-recall is the memory.** Spec, `.adl` and `.calm.json` files live in the project's git repo and are versioned and reviewed there. total-recall stores their index, summaries, the decisions and rejected options, and the history of changes. It never holds the only copy of a spec.
2. **Every memory traces to an architecture element.** A decision, a trade-off or a failed attempt is linked to the ADL component, ADL assertion ID or CALM node it is about. That link is what lets recall answer "what do we know about the answer queue?".
3. **Failures are feedback.** A failed fitness function or CALM validation is captured with the decision that followed it: the code was fixed, or the ADL was amended and why.
4. **Fit the existing architecture.** New code respects the current rules: tools in `src/tools/`, pure helpers as leaf modules, optional dependencies isolated in one module, no stdout writes, files under 600 lines, fail-closed privacy filter for anything going to the org vault.
5. **Opt-in.** A project without ADL or CALM files behaves exactly as today.

## What a spec-driven session needs

| Moment | What total-recall should provide |
|---|---|
| Starting a new system | The organisation's guardrails and reusable ADL/CALM patterns from the org vault; templates for spec, ADL and CALM |
| Starting a session on an existing system | A short architecture summary: domains, components, CALM nodes, open assertions, known debt, recent decisions |
| Before changing a component | The ADL rules and CALM controls on that component, plus past decisions and failures about it |
| After a fitness function fails | Earlier failures of the same assertion and how they were resolved |
| When the ADL or CALM changes | A record of what changed, why, and which requirement or decision caused it |
| Ending a session | Prompt to capture decisions with their ADL/CALM references |

## Phase 0: apply ADL and CALM to total-recall itself

Do [ADL-CALM-PLAN.md](ADL-CALM-PLAN.md). This proves the notation, the ID convention (`[TR-S1]`), the coverage test and the CALM validation on a real codebase, and gives this plan its first test data.

## Phase 1: data model

1. **New categories** in `DEFAULT_CATEGORIES` (`src/paths.ts`): `specs` and `architecture-changes`. Existing `architecture` and `decisions` keep their meaning.
2. **Optional frontmatter fields** (`src/types.ts`, `src/frontmatter.ts`):

   | Field | Type | Meaning |
   |---|---|---|
   | `system` | string | System the memory belongs to, for example `make-the-grade` |
   | `artifact` | `spec` \| `adl` \| `calm` \| `adr` \| `fitness-result` | The kind of artifact it is about |
   | `elements` | string[] | ADL component, ADL assertion ID or CALM node IDs, for example `adl:testing.answercapture`, `assert:TR-S2`, `calm:org-vault` |
   | `requirements` | string[] | Requirement IDs from the spec, for example `REQ-7` |
   | `sourcePath` | string | Repo-relative path of the file the memory summarises |
   | `sourceRev` | string | Git commit of that file when the memory was written |
   | `status` | `proposed` \| `accepted` \| `superseded` \| `failed` \| `resolved` | For decisions and specs; `failed` / `resolved` for fitness results |
   | `supersedes` | string | Key of the memory this one replaces |

3. All fields are optional, so existing memories and the import/export format stay valid. Add a schema-version marker at the same time (this closes the "No schema-version marker" backlog item).

**Done when** the frontmatter round-trips the new fields, old files still parse, and export/import preserve them.

## Phase 2: index ADL and CALM files

1. **`src/spec/adl-parse.ts`** (leaf module, no local imports): reads the course ADL syntax (`DEFINE`, `ASSIGN`, `WITHIN`, `FOREACH … DO … END`, `ASSERT(…)`, header directives) into systems, domains, components, constants and assertions with IDs. It is tolerant: an unknown line is kept as text, never fatal.
2. **`src/spec/calm-parse.ts`** (leaf): reads the nodes, relationships, interfaces and controls of a CALM document. Plain JSON parsing only; validation stays with the CALM CLI.
3. **New tool `index_architecture(path)`**: scans a project for `*.adl` and `*.calm.json`, and stores or updates one memory per system with the element list and a summary. It records `sourcePath` and `sourceRev` and never copies the whole file. Re-running it on an unchanged file is a no-op.
4. **Element index**: an in-memory map from element ID to memory keys, rebuilt with the TF-IDF index, so lookups by element do not scan the vault.

**Done when** indexing the Make the Grade ADL folders and the total-recall ADL produces the right elements, and re-indexing an unchanged repo writes nothing.

## Phase 3: architecture-aware retrieval

New tools in `src/tools/architecture.ts`, registered through the existing registry:

| Tool | Returns |
|---|---|
| `get_architecture_context(system, element?)` | The system summary, or for one element: its ADL rules, CALM controls, linked decisions, failures and open questions, newest first |
| `trace(id)` | For a requirement, assertion or CALM node: the chain requirement → ADL assertion / CALM control → test name → recorded results and decisions |
| `get_architecture_history(system, element?)` | `architecture-changes` memories in time order, with what changed and why |

`recall_memory` and `search_index` get an optional `elements` filter, and memories sharing an element get a boost in `get_related_memories`.

**Done when** asking for `calm:org-vault` returns the privacy-filter control, the decision that created it and any recorded failures.

## Phase 4: validation and feedback capture

1. **`validate_architecture(path)` tool**: runs the CALM CLI validation on the project's `.calm.json` and the ADL coverage check (every assertion ID has a test). The CALM CLI is resolved as described in decision 4: `PATH`, then pinned `npx` if allowed, otherwise "not available". It is never bundled.
2. **Capture results**: each failure is stored as an `artifact: fitness-result` memory linked to its assertion or node. A later pass of the same check marks it resolved and links the decision.
3. **No duplicate gate.** CI stays the authority; this tool is the agent's fast feedback loop and the memory of what happened.

**Done when** a broken assertion in a sample project produces a linked failure memory, and the fix produces a resolved one.

## Phase 5: workflow skill and hooks

1. **New skill `spec-driven-workflow`** next to `memory-workflow`. The loop:
   spec → requirement IDs → ADL and CALM drafts → fitness functions with assertion IDs → code → validation → capture decisions → amend the ADL and CALM through review.
   It includes templates for `spec.md`, a starter `.adl` set and a starter `.calm.json`, and the rules from the course: prefer explicit `HAS NO DEPENDENCY ON`, keep database ownership in assertions, no technology inventories, separate static coupling from capabilities.
2. **SessionStart**: `load-memory-index.sh` adds a short architecture summary when the working directory contains ADL or CALM files, within a fixed token budget.
3. **PostToolUse on `Write`/`Edit` of `*.adl` or `*.calm.json`**: re-index that file and ask for an `architecture-changes` memory with the reason.
4. **PreCompact and SessionEnd**: the extraction prompt asks specifically for decisions and their element IDs.
5. **Both clients**: hooks 2–4 are added to `hooks.json` and `hooks.gemini.json`.

**Done when** a new session in a project with ADL files shows the summary, and editing an `.adl` file records an architecture change.

## Phase 6: shared guardrails in the org vault

1. **Guardrail catalogue**: org-tagged memories holding reusable ADL assertions and CALM controls (for example "no shared database between quanta", "every external connection has an authentication control"), each with the reason and the incident or decision behind it.
2. **`new system` starter**: the skill pulls matching guardrails into the first ADL and CALM drafts.
3. **Privacy**: guardrails pass through the existing fail-closed filter. Spec memories stay personal unless tagged `org`, and a spec that mentions client names, hosts or credentials is rejected for the org vault.

**Done when** a second, unrelated project starts with the org's guardrails already in its ADL draft.

## Phase 7: evaluation

Extend the evaluation harness in `scripts/eval` (also a backlog item) with spec-driven cases:
- recall the right decision for an element;
- trace a requirement to its test;
- no stale context: a superseded decision is not returned as current.

Use the Make the Grade material in the masterclass folder as the test corpus: 21 folders, about 35 ADL files, and answers that record decisions.

## Order and size

| Phase | Depends on | Size |
|---|---|---|
| 0 | none | small to medium |
| 1 | 0 | small |
| 2 | 1 | medium |
| 3 | 2 | medium |
| 4 | 2 | medium |
| 5 | 3, 4 | medium |
| 6 | 5 | small |
| 7 | 3 | small to medium |

Each phase ends with `npm run typecheck`, `npm test`, the integration suite and the mutation gate staying green, and with new ADL assertions for the new modules (for example `src/spec/*` are leaves, only one module runs external processes).

## Decisions

1. **Tool count: 5 separate tools (17 → 22).** `index_architecture`, `get_architecture_context`, `trace`, `get_architecture_history` and `validate_architecture` stay separate, each with its own schema. Docs that state "17 tools" are updated to 22 (README, ARCHITECTURE.md, CLAUDE.md, the MCP server instructions).
2. **File paths: `sourcePath` is allowed.** The rule is in [README.md:43](README.md) ("Not saved: code snippets, file paths, git history — all derivable from the workspace"). It describes what auto-capture aims for and is not enforced in code. A `sourcePath` is a pointer to the versioned file, not a copy of derivable content, so it fits the intent. It is a structured frontmatter field only, limited to spec and architecture files, never in the memory body. README line 43 gets a short clarification.
3. **ADL parser: course syntax only.** No YAML/JSON variant.
4. **CALM CLI: an external tool, not an optional dependency.** `@finos/calm-cli` (1.66.0 when checked) pulls in `playwright-core`, `mermaid`, `ts-node` and `execa`, among others. As an optional dependency it would be installed by default for every user, enlarge the `npm audit --omit=dev` surface, and work against the supply-chain review in this repo, all for a tool that only spec-driven projects use. Instead:
   - `validate_architecture` uses a `calm` binary on `PATH` if there is one;
   - otherwise it runs `npx --yes @finos/calm-cli@<pinned>` only when the config allows it (`calm.allowNpx`, off by default), with the version pinned in config;
   - otherwise it reports "CALM CLI not available" with the install command, and still runs the ADL coverage check;
   - CI runs the pinned `npx` command (ADL-CALM-PLAN step 5).
   The external process is started from one module only, and an ADL assertion enforces that.
5. **Gemini/Antigravity: yes.** Every new hook goes into both `hooks.json` and `hooks.gemini.json`, and the hook tests cover both.

6. **Everything is configurable.** Each feature in this plan can be switched off in `~/.total-recall/config.json`, under one `specDriven` block (see "Configuration"). The defaults turn everything on, but nothing happens in a project without ADL or CALM files (principle 5). `specDriven.enabled: false` gives exactly the v1.1.23 behaviour: 17 tools, no new hook output, no new categories.

## Configuration

One block in `~/.total-recall/config.json`. Every key is optional; a missing or wrongly typed key falls back to its default, so a typo never breaks the server.

```json
{
  "specDriven": {
    "enabled": true,
    "tools": ["index_architecture", "get_architecture_context", "trace", "get_architecture_history", "validate_architecture"],
    "categories": ["specs", "architecture-changes"],
    "adlExtensions": [".adl"],
    "calmExtensions": [".calm.json"],
    "excludeDirs": ["node_modules", ".git", "dist", "build", "coverage"],
    "sessionSummary": true,
    "sessionSummaryMaxChars": 1500,
    "captureChanges": true,
    "extractDecisions": true,
    "guardrails": true,
    "orgBlockedTerms": [],
    "calm": { "allowNpx": false, "cliVersion": "1.66.0", "timeoutMs": 120000 }
  }
}
```

| Key | Default | Phase | Effect when changed |
|---|---|---|---|
| `enabled` | `true` | all | `false` switches every feature below off |
| `tools` | all five | 2–4 | Only the listed tools are registered; `[]` registers none. Read at server start, so a change needs a restart |
| `categories` | `specs`, `architecture-changes` | 1 | Extra category folders created at boot; `[]` creates none (the memories can still be stored in any category) |
| `adlExtensions` / `calmExtensions` | `.adl` / `.calm.json` | 2, 5 | Which files are indexed, summarised and watched |
| `excludeDirs` | as above | 2 | Directories skipped when scanning a project |
| `sessionSummary` | `true` | 5 | SessionStart architecture summary |
| `sessionSummaryMaxChars` | `1500` | 5 | Size budget of that summary |
| `captureChanges` | `true` | 5 | PostToolUse re-index and "record the change" prompt on ADL/CALM edits |
| `extractDecisions` | `true` | 5 | PreCompact extraction asks for decisions with their element IDs |
| `guardrails` | `true` | 6 | `get_architecture_context` also returns org guardrails |
| `orgBlockedTerms` | `[]` | 6 | Client names and other terms an org-tagged spec memory must not contain |
| `calm.allowNpx` | `false` | 4 | Allow `npx --yes @finos/calm-cli@<cliVersion>` when no `calm` binary is on `PATH` |
| `calm.cliVersion` | `1.66.0` | 4 | Version pinned for `npx` |
| `calm.timeoutMs` | `120000` | 4 | Kill the CALM CLI after this long |

The defaults and the parsing live in one leaf module, `src/spec/config.ts`. The hooks read the same block through `dist/spec-config.mjs`, a standalone esbuild bundle of that module (as is done for `frontmatter.mjs`), so the shell scripts and the server cannot disagree on a default.

## Out of scope

- Generating code from the spec. total-recall supplies the context; the agent writes the code.
- Replacing ArchUnit, the CALM CLI or CI as the enforcement layer.
- A visual editor for ADL or CALM.

## Result and deviations

All phases are implemented. `npm run typecheck`, `npm test`, `npm run test:integration` and `npm run mutation` were run before the commit (results in the commit message and the hand-over).

| Phase | Where |
|---|---|
| 1 | `src/spec/fields.ts` (fields + sanitiser), `src/spec/schema.ts`, `src/spec/config.ts`; wired into store, update, `indexFile`, `index.json` load, export/import |
| 2 | `src/spec/adl-parse.ts`, `src/spec/calm-parse.ts`, `src/spec/indexer.ts`, `index_architecture` in `src/tools/architecture.ts` |
| 3 | `src/spec/context.ts`, `src/spec/elements.ts`; `elements` filter in `recall_memory` / `search_index`; element boost in `get_related_memories` |
| 4 | `src/spec/validate.ts`, `src/spec/exec.ts`, `validate_architecture` |
| 5 | `skills/spec-driven-workflow/` (skill + templates), `hooks/scripts/architecture-summary.mjs`, `architecture-change.{sh,mjs}`, PreCompact prompt and `store-learning.mjs`, both hook manifests |
| 6 | `src/spec/org-guard.ts` (org spec check), guardrails in `get_architecture_context` |
| 7 | `scripts/eval/spec-eval.ts`, `src/__tests__/spec-eval.test.ts` |

New ADL assertions: `[TR-S8]` (spec modules never depend on tools), `[TR-R4]` (only `vectorStore.ts` and `spec/exec.ts` start processes), `[TR-D5]` (unsafe specs never reach the org vault). The spec leaves joined the `[TR-S1]` leaf set.

Evaluation on the Make the Grade material (18 projects with `.adl` files, 35 files, 93 elements with at least one assertion): decision@1 100%, rule recall 100%, trace hit rate 100%, 0 stale decisions. All 35 files parse with no unknown line.

Deviations from the plan:

1. **Status values.** `failed` and `resolved` were added for fitness results (phase 4 needs them).
2. **Element index.** It is a scan of the in-memory index on each query, not a separate map. It never reads the vault, which was the point; a cached map can come later if a vault gets large enough to need it.
3. **"Re-index that file" (phase 5.3).** A hook cannot call MCP tools, so the PostToolUse hook asks the model to run `index_architecture`, which re-indexes the project and returns the added and removed elements.
4. **SessionEnd (phase 5.4).** Only PreCompact asks for decisions with element IDs. SessionEnd has a 5-second budget and no model call; adding one there was out of proportion.
5. **Gemini (decision 5).** Both new hooks are in `hooks.gemini.json`, but Gemini drops `additionalContext`, so the summary and the change prompt do not reach the model there. The tools work.
6. **Org specs (phase 6.3).** "Client names" cannot be detected in general, so they are a configured list (`orgBlockedTerms`). Hosts and credentials are detected.
7. **ADL value definitions.** The corpus uses `DEFINE CAPABILITY … AS … FOR …`, `DEFINE CONTRACT … BETWEEN {…}`, `AS { … }` blocks, `ASSIGN` lines and `TYPE` / `CAPABILITY` headers. They are read as definitions linked to their elements, not as elements.
8. **Schema with the features off.** `specDriven.enabled: false` also removes the spec fields from the core tools' schemas, so `tools/list` is exactly the pre-spec one (the parity test pins both states).
9. **Templates.** They end in `.template` so that a scan of a repository that contains the plugin does not index them as a system.

