# Technology Radar Vol 34 (April 2026) — applicability to the total-recall plugin

Source: `tr_technology_radar_vol_34_en_1.pdf` (Thoughtworks, Vol 34, April 2026).
Scope: only the **Adopt** and **Trial** rings, filtered to what is meaningful for
the total-recall Claude Code memory MCP plugin.

Baseline assumption (per user): the changes in
`reviews/review-synthetized-24072026.txt` are **considered finished** — i.e.
Ollama is removed; the single embedder is the in-process HuggingFace
`Xenova/all-MiniLM-L6-v2` (384-dim); hybrid search = TF-IDF × Ebbinghaus decay
fused with vector embeddings via RRF; memory lives as Markdown+frontmatter with
a personal + org (git-synced) dual vault; distribution is a Claude Code plugin
marketplace via `git-subdir`.

Legend: **[core]** = directly about what total-recall is/does ·
**[applies]** = a concrete improvement or practice to adopt ·
**[context]** = relevant framing / comparison, lighter action.

---

## Tier 1 — Highest relevance (memory + context, the plugin's core)

### Graphiti — *Trial, Platforms (#45)*  **[core]**
The single most on-point blip. Graphiti (Zep) is an open-source temporal
knowledge-graph engine built explicitly for **"the LLM memory problem"**, and the
write-up calls out that *"flat vector stores in RAG pipelines fail to track how
facts change over time."* It ingests data as discrete **episodes**, keeps
**bi-temporal validity windows** so outdated facts are *invalidated rather than
overwritten*, updates incrementally, and does **hybrid retrieval combining
semantic search + BM25 + graph traversal** — and ships a **first-class MCP
server**.
- Why it matters here: total-recall already does hybrid retrieval (TF-IDF≈BM25 +
  vector via RRF) and already has a *temporal* relevance model (Ebbinghaus decay,
  `confirm_memory`/flags). Graphiti is the closest external benchmark and a
  design north-star.
- Actionable ideas to borrow: (a) **don't overwrite facts — supersede them**:
  keep validity windows / provenance instead of `force`-overwriting a key, so
  "what did I believe and when" is recoverable; (b) an **episodic** model of
  memory capture (already partially present via `sessions[]` and PreCompact
  learnings); (c) evaluate a lightweight relation/graph layer between memories
  (currently only `[[wiki-link]]`-style references exist) as a future direction.
- Not a call to replace the store — it's a validated pattern set and a
  competitor to measure recall quality against.

### Context engineering — *Adopt, Techniques (#1)*  **[core]**
Radar's framing: context is a **design surface**; systems should *"start with a
lightweight index of what's available"* and **pull in only what's needed** to
keep signal-to-noise high, using **prompt caching**, **selecting tools**, and
**context graphs**.
- total-recall is precisely a context-engineering tool: the SessionStart
  **injected memory index** is the "lightweight index," and the tiered retrieval
  (`get_memories_by_keys` → `search_index` → `recall_memory`) is "pull in only
  what's needed."
- Actionable: frame the plugin's README/positioning around "context engineering"
  explicitly; ensure the injected index stays lean (ties to the injection-dedup
  cleanup, Phase 8.4 of the synthesis).

### Progressive context disclosure — *Trial, Techniques (#12)*  **[core]**
"Give the agent a lightweight discovery phase … loading detailed information into
the context window only when it becomes relevant," to prevent **context rot** and
**bloating instructions**.
- This is *exactly* the total-recall retrieval decision tree (injected index →
  summary=true → summary=false → full). The plugin is a reference implementation.
- Actionable: keep `summary=true` cheap; make sure the memory-workflow SKILL
  documents this ladder as the intended pattern (it already does — validate it
  stays aligned after the Phase 6 API changes).

### Agent Skills — *Trial, Techniques (#7)*  **[applies]**
Open standard for packaging instructions/scripts/resources that agents **load
only when needed based on their descriptions**, reducing token use and **agent
instruction bloat**. Notes the **plugin-marketplace** ecosystem and cautions
about **supply-chain risk of unreviewed third-party skills**.
- total-recall ships Skills (`memory-workflow`, `review-fix-ship`). This blip
  validates that direction and the description-first loading model.
- Actionable: keep each SKILL's description tight for correct triggering; treat
  the supply-chain caution as a reason to keep the plugin's own skills auditable
  and minimal.

---

## Tier 2 — Practices to adopt in engineering the plugin

### Curated shared instructions for software teams — *Adopt, Techniques (#2)*  **[applies]**
Anchor AI guidance as a **collaborative engineering asset** in repo files
(`CLAUDE.md`, `AGENTS.md`, `.cursorrules`) rather than personal prompts; a live
reference application as source of truth.
- total-recall already lives this: a detailed `CLAUDE.md`, plus the **org vault**
  is itself a mechanism for curated *shared* memory across a team.
- Actionable: position the org-vault feature as the team-instruction/knowledge
  sharing layer; keep `CLAUDE.md` ⇄ `INSTALL.md` ⇄ `README.md` in sync (already
  a documented rule).

### Structured output from LLMs — *Adopt, Techniques (#5)*  **[applies]**
Constrain models to JSON/typed output; use a stable abstraction with validation +
retries.
- The PreCompact learning-extraction path parses **JSON lines** from the model
  into frontmatter `.md` files (`store-learning.mjs`). This is structured-output
  consumption.
- Actionable: harden that boundary (schema-validate each extracted learning; this
  pairs with synthesis Phase 8.2 — apply `withExecutiveSummary`, and reject
  malformed extraction rather than writing a thin file).

### Mutation testing — *Trial, Techniques (#11)*  **[applies]**
The "most honest signal" for test suites in an AI-assisted world — catches
"perpetually green" tests that pass regardless of logic (via Stryker etc.).
- total-recall has a large vitest suite with coverage gates; coverage ≠
  fault-detection. The synthesis Phase 11 already flags untested guard branches
  (Ebbinghaus non-finite inputs, shutdown handlers).
- Actionable: run **Stryker** (JS/TS mutation testing) against the high-value
  logic — `ebbinghaus.ts`, `tfidf.ts`, `rrf.ts`, `persistence.ts` atomicWrite,
  `vectorStore` dim-mismatch — to prove those tests actually assert behavior.

### Feedback sensors for coding agents — *Trial, Techniques (#9)*  **[context]**
Wire deterministic quality gates (compilers, linters, tests) into the agent loop
so failures trigger self-correction **before commit**.
- Maps onto the plugin's mandatory pre-commit checklist (bump → build → test →
  typecheck) and the `review-fix-ship` skill. Consider surfacing these as
  agent-run gates rather than manual steps.

---

## Tier 3 — Tools / platforms the plugin lives in or could leverage

### Claude Code — *Adopt, Tools (#67)*  **[core]**
The host runtime for total-recall. Being in Adopt reinforces the plugin's target
platform choice; no action beyond staying current with Claude Code plugin/hook
APIs.

### Claude Code plugin marketplace — *Trial, Tools (#72)*  **[core]**
total-recall is **distributed exactly this way** (marketplace via `git-subdir`,
`dist/` committed). The blip's existence validates the distribution model;
combine with the Agent Skills supply-chain caution — keep the shipped bundle
reviewable and version-gated (`plugin.json` version sync is already enforced).

### Langfuse — *Trial, Platforms (#46)*  **[context]**
Open-source LLM observability/eval/prompt-management, now OpenTelemetry-native.
- Not needed inside the plugin, but useful if you want to **measure recall
  quality / embedding behavior** systematically. Lighter than the plugin's own
  `get_stats.recentErrors` observability; only worth it if evaluation becomes a
  workstream.

### LangExtract — *Trial, Languages & Frameworks (#107)*  **[context]**  *(verified against full write-up)*
Python library that uses LLMs to **extract structured information from
unstructured text** based on user-defined instructions, with **precise source
grounding** (each extracted entity links back to its location in the original
document) and **JSONL export**. The Radar notes it is *"better suited to
long-form, unstructured source material"* (vs Pydantic AI for short, predictable
inputs), and that *"teams considering structured output from LLMs for document
processing should evaluate LangExtract."*
- Strong analogue to the PreCompact "extract 0–3 learnings from the transcript"
  step: a compacted transcript **is** long-form unstructured source, and the
  plugin already pipes **JSON lines** into `store-learning.mjs` — the same shape
  LangExtract emits. Source grounding maps naturally onto capturing *where* a
  learning came from (session/provenance).
- Caveat: it's **Python**, and the plugin is TS/Node — so it's a reference
  pattern / optional out-of-process aid for the extraction pipeline, not an
  embeddable dependency.

### DeepEval — *Trial, Languages & Frameworks (#105)*  **[context]**  *(verified against full write-up)*
Open-source, Python-based framework for **assessing LLM performance**, built to
evaluate **RAG systems** with hallucination detection, answer-relevance scoring,
and **custom, use-case-specific metrics**. The write-up specifically calls out
that it now evaluates **agentic workflows including interactions with MCP
servers**, plus multi-turn conversation simulation to auto-generate test cases.
- Very apt as an **offline harness** scoring total-recall's retrieval quality —
  does `recall_memory`/`search_index` return the right memories for a query set?
  The explicit **MCP-server evaluation** support means it can drive the plugin's
  actual tool surface. Pairs with synthesis Phase 11 (test-coverage) and the
  TF-IDF ranking fixes (substring→token boost, length normalization) — those
  changes want a recall-quality metric to prove they help.
- Caveat: **Python** — an external evaluation harness against the MCP server, not
  an in-plugin dependency.

---

## Explicitly NOT applicable (from Adopt/Trial), for the record

- **DORA metrics** (#3), **Passkeys** (#4), **Zero trust architecture** (#6):
  team-delivery / auth / infra concerns, not this single-user local plugin.
  (ZTA's "never trust, always verify" is philosophically echoed by the org-sync
  privacy filter, but the blip is about agent-deployment security.)
- **Browser-based component testing** (#8), **Server-driven UI** (#15),
  **Semantic layer** (#14, a BI/data-warehouse concept — unrelated to the
  plugin's "semantic search"), **Mapping code smells to refactoring** (#10),
  **Sandboxed execution for coding agents** (#13): out of scope.
- Platforms/Tools/Frameworks not listed above (AG-UI, Apache APISIX, Bedrock
  AgentCore, Port, Replit, SigNoz, Dev Containers, Figma Make, OpenAI Codex,
  Typst, cargo-mutants, React/React Native/Svelte/Typer, Apache Iceberg,
  Declarative Automation Bundles, ADK, Docling, LangGraph, LiteLLM, Modern.js):
  no meaningful tie to a TS memory MCP plugin.
  - Note: **cargo-mutants** (#71) is the Rust analogue of the mutation-testing
    idea above; the applicable tool for this codebase is Stryker, not
    cargo-mutants.

---

## One-line takeaways

1. **Graphiti** is the memory benchmark to study — steal its *supersede-don't-
   overwrite* temporal model and consider a light relation layer.
2. total-recall is already a textbook **context engineering / progressive
   context disclosure** implementation — lean into that framing.
3. Harden the two LLM boundaries with **structured output** discipline
   (PreCompact extraction) and prove tests with **mutation testing (Stryker)**.
4. The **Agent Skills + plugin-marketplace** direction is validated; keep the
   shipped skills minimal and auditable (supply-chain caution).
