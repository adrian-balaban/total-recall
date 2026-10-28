---
name: spec-driven-workflow
description: Use when building or changing a system from a spec with ADL architecture files — the loop spec → requirement IDs → ADL drafts → fitness functions tagged with assertion IDs → code → validation → captured decisions, with the total-recall architecture tools (index_architecture, get_architecture_context, trace, get_architecture_history, validate_architecture) and the templates in this skill.
---

# 📐 Spec-driven workflow with ADL

The repository holds the spec, and the `.adl` files. Total Recall holds what the files do not: why each rule exists, what was rejected, which checks failed and how they were fixed. Never store a spec or an ADL file as the only copy in a memory.

All of this can be switched off in `~/.total-recall/config.json` under `specDriven` (see the plugin README). If the architecture tools are missing, they are off; use plain `store_memory` with the same fields.

## 🔁 The loop

1. **Spec.** Write `spec.md` from [templates/spec.md](templates/spec.md). Give every requirement an ID (`REQ-1`, `REQ-2`, …).
2. **Guardrails first.** For a new system, `list_memories(tag="guardrail")` lists the organisation's reusable ADL assertions. Copy the ones that apply into the first drafts, keeping their wording.
3. **ADL drafts.** Copy [templates/starter.adl.template](templates/starter.adl.template) to `<project>/architecture/adl/structure.adl`, then fill in the placeholders. Put the runtime landscape (actors, services, external systems) in a separate `system.adl` with `DEFINE COMMUNICATION <from> TO <to> AS <style>` lines. (The `.template` suffix keeps it out of a project scan.) End every `ASSERT` with an ID tag: `# [SYS-S1]`.
4. **Fitness functions.** For each tagged assertion, write a test whose name contains the tag, for example `it('[SYS-S1] core never depends on adapters', …)`.
5. **Index.** `index_architecture(path=<project>)`. Run it again after every ADL change; the PostToolUse hook reminds you.
6. **Code.** Before changing a component: `get_architecture_context(system, element="adl:<domain>.<component>")` for its rules, controls, decisions and past failures.
7. **Validate.** `validate_architecture(path=<project>)`. It stores each failure as a `fitness-result` memory and marks it resolved on a later pass. CI stays the authority.
8. **Capture.** Store each decision with its links:
   `store_memory(category="decisions", system, elements=[…], requirements=[…], artifact="adr", status="accepted", content="… options considered, and why this one …")`.
   A replaced decision gets `supersedes=<old key>` on the new one, and `status="superseded"` on the old one via `update_memory`.
9. **Amend through review.** When the code is right and the rule is wrong, change the `.adl` in a reviewed commit, then store an `architecture-changes` memory: what changed, why, which requirement or decision caused it.

## 🔎 Which tool when

| Situation | Call |
|---|---|
| Session start in a project with ADL | Read the injected "Architecture (spec-driven)" summary |
| What do we know about a component or node? | `get_architecture_context(system, element)` |
| Is this requirement covered and tested? | `trace("REQ-7")` |
| Why does this assertion fail again? | `trace("SYS-S1")`: earlier failures, how they were resolved |
| How did the architecture get here? | `get_architecture_history(system, element?)` |
| Find memories about an element | `search_index(query, elements=["adl:<domain>.<component>"])` |

Element IDs: `adl:<domain>.<component>` (a parent such as `adl:testing` also matches its children), `assert:<ID>` (a bare `SYS-S1` works too), and requirement IDs as they appear in the spec.

## ✍️ ADL rules (from the course)

- Prefer explicit `HAS NO DEPENDENCY ON` assertions to vague layering statements.
- State database ownership and access in assertions (`… is only accessed by …`), not in prose.
- No technology inventories: an ADL file states rules, not a list of tools.
- Keep static coupling (who depends on whom) and capabilities (what a component must do) in separate files.
- One system per ADL file set; `DEFINE SYSTEM <Name> AS <id>` gives the system ID used by every tool.

## 🏢 Sharing with the organisation

- **Guardrails** go to the org vault: `store_memory(tags=["org", "guardrail"], category="architecture", elements=[…optional…], content="the ADL assertion, the reason, and the incident or decision behind it")`. A guardrail without elements applies to every system.
- **Specs stay personal.** An org-tagged memory with `artifact="spec"` is refused when it names a host, a credential or a term in `specDriven.orgBlockedTerms` (client names). Every org memory still passes the fail-closed privacy filter before the git sync.
