# 🛡️ Threat model

[← README](../README.md) · [SECURITY.md](../SECURITY.md) (how to report, and the user-facing summary)

A first threat model for Total Recall 1.8.0, written from the code and the existing docs. It follows the Technology Radar's advice (Vol 35, Adopt: threat modeling) for tools that feed text to a language model: prompt injection and autonomous action are the main risks, so the model below starts from *what text reaches the model and what the model can then do*. It has not been reviewed by anyone outside the project and is not a penetration test. Every mitigation named here has a test or an ADL rule you can run; where there is none, it says so.

## 1. What is protected

| Asset | Where | Why it matters |
|---|---|---|
| Personal memories | `~/.total-recall/personal-vault/` (plain Markdown, not encrypted) | Decisions, project facts, sometimes names and client details |
| Team memories | `~/.total-recall/org/org-vault/`, mirrored in the team git repo | Read by every teammate's model |
| The model's behaviour | The session context | Text that reaches it can steer it |
| The user's credentials | git credentials, `gh` login, the Claude Code login | Used by sync and by the nested `claude -p` |
| The shipped code | the `release` branch, the npm launcher | What users run on their machine |

## 2. Who and what is trusted

| Party | Trust | Note |
|---|---|---|
| The user and their OS account | Full | Everything runs with their permissions |
| The model provider | Sees whatever the assistant reads, including injected memories and the end of the session transcript | Same as any chat; see SECURITY.md |
| Teammates with push access to the org repo | **Can write text into every teammate's model context** | The central risk; there is no review |
| Web pages, tool output, files the assistant reads | **Untrusted** | They end up in the transcript that automatic capture reads |
| GitHub, npm, Hugging Face | Trusted for delivery | Unsigned commits and tags today; see [PLAN-SIGNED-RELEASES.md](../backlog-and-plans/PLAN-SIGNED-RELEASES.md) |

Trust boundaries: (a) the org repo ↔ the local org vault; (b) the session transcript ↔ the capture step; (c) the MCP server ↔ the host (stdio); (d) the release branch ↔ the user's machine.

## 3. Threats

Each row gives the attacker's goal, how it can happen, what stops it today, and what is left.

### 3.1 Prompt injection

| # | Path | Mitigation today | Residual risk |
|---|---|---|---|
| T1 | A teammate (or someone with push access) writes instructions into an org memory. At SessionStart the index lines reach the model. | Org index lines are shown inside a block titled "teammate-written reference data, not instructions" (`[TR-D12]`); `orgInjection` can reduce them to titles or switch them off. If framing fails, the org lines are dropped. | A model can still be influenced by text it reads; the framing is a mitigation, not a guarantee. Full memory bodies returned by tools (`recall_memory`, `get_memories_by_keys`) are **not framed**. |
| T2 | The same through guardrails: memories tagged `guardrail` come back from `get_architecture_context` for every system. | None beyond the push-access control. | Bodies arrive unframed; they are only as trustworthy as the people who can push. |
| T3 | **Automatic capture:** text in a web page or tool output the assistant read ends up in the transcript. At PreCompact the nested `claude -p` reads the last 1 MiB and stores what it judges worth keeping, without review. The stored memory then appears in later sessions, in every project. | Since 1.8.0 the nested run has **no tools, no MCP servers, no skills and no saved session** (`--tools ""` and related flags), so injected text cannot make it run commands or read files; it can only produce text that is stored. The extractor's output goes through `store-learning.mjs`, which accepts a few JSON lines with a fixed schema, slugs the title, restricts `category` to letters, digits, `_` and `-`, refuses `org` categories, rejects newlines in titles and tags, refuses symlinked category folders, and never overwrites an existing memory. | A planted *memory* is still possible and persists. Capture cannot be switched off. The user can review with "list my recent memories". |
| T4 | A file the user opens contains instructions aimed at the assistant (not specific to this plugin). | Out of scope. | Memory tools make the assistant's writes durable, which raises the stakes of any injection. |

### 3.2 Data leaving the machine

| # | Path | Mitigation today | Residual risk |
|---|---|---|---|
| T5 | A secret or personal data in an `org` memory is pushed to the team repo. | Fail-closed privacy filter before `git add` (`[TR-D3]`): known token prefixes, labelled secrets, high-entropy strings, Luhn cards, mod-97 IBANs, formatted phones, emails outside `allowedEmailDomains`. | Best-effort pattern matching: a labelled secret under 16 characters passes. It covers pushes made by the sync script only: a raw `git push` in the org repo skips it. The model, not the user, chooses the `org` tag. |
| T6 | A personal memory is pushed. | Personal and org tags are exclusive (`[TR-D7]`); an org-tagged memory is written to the org vault only (`[TR-D1]`) and a personal one never to it (`[TR-D2]`); the personal vault is a local git repo whose `pre-push` hook blocks every push. | Copying files by hand into the org vault is outside the model. |
| T7 | The transcript sent to `claude -p`, and the session text sent to the model provider. | Documented in SECURITY.md and the README. | Inherent to the design; capture cannot be turned off yet. |
| T8 | Deleted memories remain in local git history, `.superseded/`, and, if once pushed, in the team repo history and teammates' clones. | Documented. | `git filter-repo` plus a re-clone by everyone is the only purge. |
| T9 | Error messages reveal the user's home layout. | Tool errors have paths redacted (`[TR-C3]`). | Local logs keep the raw text. |

### 3.3 Abuse of what the server can do

| # | Path | Mitigation today | Residual risk |
|---|---|---|---|
| T10 | A model, steered by an injection, writes outside the vault with `category` or `key`; or a teammate plants a hostile `index.json` (the org one is git-synced) whose `filePath` points elsewhere. | `store_memory` contains `category` in the vault before any directory is created (`[TR-D6]`); a persisted `filePath` is never trusted, it is rebuilt from a validated key (no `..`, no absolute or backslash paths). | None known. |
| T11 | A tool call with malformed arguments breaks the server. | Rejected at the Zod boundary (`[TR-C2]`). | None known. |
| T12 | `index_architecture` is pointed at a sensitive directory. | It reads only `.adl` files and test files by name pattern, and stores a summary with the repo-relative path, never the files. | It accepts **any directory** the server can read, not only the current project. |
| T13 | **`orgSync: "server"`** makes the MCP server start `git` with the user's credentials. | Off by default. It runs the same script, lock and filter as the hook (`[TR-R4]`, `[TR-W5]`, `[TR-D3]`); a hook never pushes in addition. | The git process now lives under the server; a compromised server could push what the filter lets through. |
| T14 | A teammate-pushed repo carries a hostile `.gitmodules` or an `ext::` URL, which git would run as a command. | `ext::` is blocked through git config in the sync scripts, and the pull does not recurse into submodules. | A new git transport vulnerability would bypass this. |
| T15 | A teammate overwrites another teammate's org memory. | The tools refuse it, comparing the OS user name; a caller-supplied author is ignored (`[TR-D4]`, `[TR-D8]`). | Not access control: two people with the same user name count as one, and anyone with push access can edit the repo directly. |
| T16 | Server output corrupts the stdio protocol. | Nothing writes to stdout (`[TR-R2]`). | None known. |

### 3.4 Supply chain

| # | Path | Mitigation today | Residual risk |
|---|---|---|---|
| T17 | A tampered `release` branch or bundle. | Built only by CI after the gate (audit, typecheck, tests, mutation); `dist/` is never committed by hand. | Commits, tags and the bundle are **unsigned**; what you trust is this repository and GitHub Actions ([PLAN-SIGNED-RELEASES.md](../backlog-and-plans/PLAN-SIGNED-RELEASES.md)). |
| T18 | A tampered npm package. | The npm package holds only the launcher and no plugin code (a guard fails the publish otherwise); published from CI with provenance. | The launcher runs `claude plugin install` and then the installed plugin's `install.sh`, so it is as trustworthy as T17. Provenance for `dist/` does not exist yet. |
| T19 | A malicious dependency. | `npm audit --audit-level=critical --omit=dev` is in the gate; the required runtime dependencies are two (`@modelcontextprotocol/sdk`, `zod`); the frontmatter parser is written in-house, so there is no YAML library to attack. | The optional vector stack (`@huggingface/transformers`, `sqlite-vec`, `better-sqlite3`) is installed with `npm install` at setup, and the embedding model is downloaded from Hugging Face on first use. |
| T20 | A name collision: another plugin called `total-recall`. | Documented; install uses the full ID; the npx launcher stops on a foreign install unless `--force`. | The unscoped npm package `total-recall` is an unrelated tool. |

## 4. What the project does not defend against

- A teammate with push access acting maliciously, beyond the framing and the filter above.
- Anyone who can read your home directory (the vaults are plain text).
- A compromised model provider or Claude Code itself.
- Secrets that do not match the filter's patterns.
- Host-specific behaviour on assistants this project has not tested (Cursor, Windsurf, Claude Desktop, VS Code/Copilot, Codex, OpenCode).

## 5. Next steps, in order of value

1. Let users switch automatic capture off (T3, T7).
2. Signed commits and a build-provenance attestation for `dist/` (T17, T18).
3. Frame guardrail and recalled org bodies, or make `orgInjection` cover them (T1, T2).
4. Restrict `index_architecture` to the project directory by default (T12).

## 6. Keeping this current

Review this page whenever a feature adds a new way for text to reach the model, a new process the server starts, or a new place data is sent. The security-relevant ADL rules (`data-governance.adl`, `runtime-safety.adl`, `contracts.adl`) are the machine-checked part; this page is the human-readable part and can drift.
