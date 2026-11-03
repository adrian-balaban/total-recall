# 📐 Spec-driven work and architecture as code (ADL)

Total Recall can tie memories to a spec, and, when a project keeps its architecture in ADL files, link each rule to the tests that enforce it. The ADL files stay in your repository as the source of truth. The memories hold what the files do not: why a rule exists, what was rejected, which checks failed and how they were fixed.

[← README](../README.md)

## Two levels

- **Memories only (no ADL needed).** Any memory can carry optional frontmatter fields: `system`, `artifact` (`spec`, `adl`, `adr`, `fitness-result`), `elements` (`adl:<domain>.<component>`, `assert:<ID>`), `requirements`, `sourcePath`, `sourceRev`, `status` (`proposed`, `accepted`, `superseded`, `failed`, `resolved`) and `supersedes`. `recall_memory` and `search_index` filter on `elements`, `get_related_memories` follows shared elements, and a requirement ID ties its decisions together.
- **With ADL files.** The five architecture tools index the files and connect rules, tests, decisions and failures.

## ⏱️ Five-minute walkthrough on your own project

1. **Write one ADL file**, for example `architecture/adl/structure.adl` (start from [starter.adl.template](../plugins/total-recall/skills/spec-driven-workflow/templates/starter.adl.template)):

   ```
   DEFINE SYSTEM Orders AS ord
       DEFINE COMPONENT Api AS api
       DEFINE COMPONENT Domain AS domain
   ASSERT(Domain HAS NO DEPENDENCY ON Api) # [ORD-S1]
   ```

   The `# [ORD-S1]` tag is the assertion ID. Give every assertion one.

2. **Write a test that carries the ID.** Any framework works: a line containing `[ORD-S1]` in a test file links that test to the assertion, so put the ID in the test name. The indexer looks in `*.test.*` / `*.spec.*` (JS/TS), `*Test` / `*Tests` `.java` `.kt` `.cs`, `*_test.go`, `*_test.py` and `test_*.py`. It does not look at `*IT.java`, Spock or Kotest `*Spec` files, or Scala:

   ```java
   @Test
   @DisplayName("[ORD-S1] domain never depends on the api layer")
   void domainDoesNotDependOnApi() { /* an ArchUnit rule */ }
   ```

3. **Ask Claude**, in a session opened in that project:
   - *"index the architecture of this repo"* → `index_architecture(path="/abs/path/to/repo")` stores one summary memory for the system. Use an absolute path: a relative one is resolved against the MCP server's working directory, which differs between assistants. The scan reads at most 5,000 files and skips `node_modules`, `.git`, `dist`, `build` and `coverage`; add `target`, `out` or `vendor` to `specDriven.excludeDirs` if you have them.
   - *"validate the architecture"* → `validate_architecture(path="/abs/path/to/repo")` lists any tagged assertion with no test and stores it as a `fitness-result` memory; a later pass marks it resolved.
   - *"trace ORD-S1"* → `trace("ORD-S1")` shows the assertion, its tests, past failures and the decisions linked to it.
   - Before you change a component: *"what do we know about the Domain component of ord?"* → `get_architecture_context(system="ord", element="adl:domain")`. The system is named by its `AS` id (`ord`) and is a namespace, not part of the element ID. Element IDs are `adl:<component>`, or `adl:<domain>.<component>` when the component sits inside a `DEFINE DOMAIN`.

4. **Record decisions** as you go: *"store the decision to split Domain from Api, linked to ORD-S1"*. The `spec-driven-workflow` skill describes the whole loop (spec → requirement IDs → ADL → tagged tests → code → validation → captured decisions) and ships a [spec template](../plugins/total-recall/skills/spec-driven-workflow/templates/spec.md).

**What `validate_architecture` checks and what it doesn't.** It checks **coverage**: every tagged assertion has at least one test file line containing its ID. That match is purely textual, so a comment or a disabled test counts too. It does not run your tests or read their results; the rules are enforced by your own tests running in your CI. Untagged assertions are skipped, an ID found in tests with no matching assertion is not reported, and results (`fitness-result` memories) go to your personal vault, so teammates do not see each other's failures.

## ADL in one paragraph

ADL is the notation from Neal Ford's masterclass [How to Teach Your Agents About Architecture](https://codecamp.ro/masterclasses/how-to-teach-your-agents-about-architecture-iasi-2026/) (Codecamp Iași, October 2026). It is pseudocode with no formal grammar: `DEFINE` lines name the system, domains and components; `ASSERT(…)` lines state the rules the code must keep; `DEFINE COMMUNICATION <from> TO <to> AS <style>` describes the runtime connections. An ADL file is never executed: each assertion is checked by a test written for it (a fitness function). The `# [ID]` tag is a Total Recall convention, not part of ADL. The course material is not published here; every example is from this repository.

## This repository's own ADL

Total Recall describes itself in nine ADL files under [plugins/total-recall/architecture/adl/](../plugins/total-recall/architecture/adl/), each assertion enforced by a tagged test (ArchUnitTS for the dependency rules). `adl-coverage.test.ts` fails when an assertion has no test.

| File | What it governs |
|---|---|
| [structure.adl](../plugins/total-recall/architecture/adl/structure.adl) | Allowed dependencies between the modules (`[TR-S*]`) |
| [data-governance.adl](../plugins/total-recall/architecture/adl/data-governance.adl) | Which vault a memory lands in, and what may leave the machine (`[TR-D*]`) |
| [runtime-safety.adl](../plugins/total-recall/architecture/adl/runtime-safety.adl) | Optional native dependencies and the stdio transport (`[TR-R*]`) |
| [workflows.adl](../plugins/total-recall/architecture/adl/workflows.adl) | Asynchronous workflows and what survives a crash (`[TR-W*]`) |
| [contracts.adl](../plugins/total-recall/architecture/adl/contracts.adl) | Contracts at the boundaries: strict where one release controls both ends, tolerant where it does not (`[TR-C*]`) |
| [capabilities.adl](../plugins/total-recall/architecture/adl/capabilities.adl) | Bounded work per tool call, and every tool call observed (`[TR-P*]`) |
| [code-quality.adl](../plugins/total-recall/architecture/adl/code-quality.adl) | Complexity, file size, duplication, mutation gate (`[TR-Q*]`) |
| [system.adl](../plugins/total-recall/architecture/adl/system.adl) | The runtime landscape: who talks to whom |
| [architecture-style.adl](../plugins/total-recall/architecture/adl/architecture-style.adl) | The architecture style, the capabilities it favours, and the stressors it must survive |

## Org guardrails

Memories tagged `guardrail` (a reusable ADL assertion, the reason, and the incident behind it) are returned by `get_architecture_context` for every system. Store them with the `org` tag to share them with the team. Their bodies reach the model as written, not framed as teammate data (see [SECURITY.md](../SECURITY.md)), so they are only as trustworthy as the people who can push to the team repo. An org memory with `artifact: "spec"` is refused when it names a credential, a term in `orgBlockedTerms`, or a host name on a common top-level domain, so specs stay personal; the host check is a fixed list, not a guarantee.

## ⚙️ Configuration (`specDriven`)

Every key is optional. `"specDriven": {"enabled": false}` gives back the plain 17-tool behaviour.

```json
{
  "specDriven": {
    "enabled": true,
    "tools": ["index_architecture", "get_architecture_context", "trace", "get_architecture_history", "validate_architecture"],
    "categories": ["specs", "architecture-changes"],
    "adlExtensions": [".adl"],
    "excludeDirs": ["node_modules", ".git", "dist", "build", "coverage"],
    "sessionSummary": true,
    "sessionSummaryMaxChars": 1500,
    "captureChanges": true,
    "extractDecisions": true,
    "guardrails": true,
    "orgBlockedTerms": []
  }
}
```

| Key | Effect |
| --- | --- |
| `enabled` | `false` switches everything below off: 17 tools, no extra schema fields, no extra hook output |
| `tools` | Only the listed architecture tools are registered (`[]` for none). Read at server start: restart after a change |
| `categories` | Extra category folders created at start |
| `adlExtensions`, `excludeDirs` | What a project scan picks up and skips |
| `sessionSummary`, `sessionSummaryMaxChars` | The architecture summary added at SessionStart, and its size |
| `captureChanges` | The prompt to record a change after an ADL edit |
| `extractDecisions` | Ask PreCompact capture for decisions with element IDs |
| `guardrails` | Org guardrails in `get_architecture_context` |
| `orgBlockedTerms` | Client names and other terms an org spec memory must not contain |

On Gemini/Antigravity the tools and filters work, but the session summary and the change prompt are not shown, because Gemini drops hook context.

Earlier versions also read a [CALM](https://calm.finos.org/) document for the system level; that was removed in 1.3.0. Use `DEFINE COMMUNICATION` in an `.adl` file instead.
