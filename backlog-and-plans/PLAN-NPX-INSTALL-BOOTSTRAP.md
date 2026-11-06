# PLAN — `npx @adrian-balaban/total-recall`: one-command install bootstrap

**Status:** steps 1–8 implemented in PR #49; the first CI publish shipped with 1.7.1 and npm now shows 1.8.1 as latest (verified 2026-11-06); step 9 (clean-machine check) is still open · **Date:** 2026-11-02, status updated 2026-11-06 · **Branch:** `main` (written on `feat/release-1.6.8-multilingual-default`, merged in #27)
**Deliverable of this document:** the implementation plan for letting users install total-recall with `npx` / `npm` in addition to the current marketplace route.

## 1. Goal

Today a fresh install takes three manual steps: `claude plugin marketplace add adrian-balaban/total-recall`, `claude plugin install total-recall@my-claude-plugins`, then running `install.sh` from the marketplace cache directory. The goal is a single command:

```bash
npx @adrian-balaban/total-recall          # or: npm i -g @adrian-balaban/total-recall && total-recall
```

…which performs the whole flow, forwarding `install.sh` flags (`--complete`, `--no-vector`, `--gemini`, `--vscode`, `--statusline`, `--org-repo`, `-y`, …).

## 2. Decision: npm is a bootstrap front door, not a distribution channel

**Approved approach:** the npm package is a tiny launcher only. It orchestrates the two `claude plugin` commands and then executes the installed plugin's own `install.sh`. The plugin code itself (`dist/`, `hooks/`, `skills/`, sources) keeps shipping **exclusively** via the GitHub `release` branch, built by GitHub Actions after the mutation gate.

**Why this holds the repo's existing stance together.** `INSTALL.md` (§ ⚡ Install) currently states: *"There is deliberately no zip download and no npm package — one channel, one thing to trust."* A bootstrap-only package keeps that trust model intact:

1. **Provenance unchanged.** The only code users ever execute is the CI-built tree from `release`. npm adds convenience, not a second artifact channel.
2. **Hooks force the issue anyway.** Hooks auto-load only through Claude Code's plugin system (manifest `hooks/hooks.json`). A raw npm copy of the plugin could never wire hooks, so "full npm distribution" would silently degrade the product's core behavior.
3. **Tiny surface.** Zero runtime dependencies, `files: ["bin"]` — a few KB tarball, nothing extra to audit.

**Rejected alternatives (for the record):**
- *Full npm distribution of the plugin* — second artifact channel, weakens provenance, hooks still unwireable outside the plugin system, duplicates `install.sh` logic into manual `settings.json` wiring.
- *MCP-only npm package* (`npx … mcp`) — serves only Codex-style hosts; doesn't answer "install total-recall" for the primary host. Deferred (see §10) as a possible later `--mcp` flag on the same CLI.

## 3. Facts this design builds on (verified in-repo / registry)

- **npm name collision:** `total-recall` on the registry is a 2013 "web traffic replay tool" (`marczych`, v0.1.0, last touched 2022). The package must be scoped: **`@adrian-balaban/total-recall`** (free as of 2026-11-02).
- **Repo root has no `package.json`**, and `.gitignore` explicitly ignores root `node_modules/` + `package-lock.json` with a comment asserting *"there is no root package.json — the real project is the plugin under plugins/total-recall/"*. Creating a root package.json is a deliberate, documented change — the comment gets reworded (§9), the ignore entries stay.
- **`install.sh` already has a plugin-independent path** (`PLUGIN_MANAGED=0`): it registers the MCP server as `total-recall` (vs `plugin:total-recall:total-recall`) via `claude mcp add-json --scope user`, is state-aware and safe to re-run, accepts `--plugin-root`, and resolves `CLAUDE_PLUGIN_ROOT`. No installer changes are required.
- **Stable cache path:** `~/.claude/plugins/cache/my-claude-plugins/total-recall/<VERSION>/install.sh`; the README already documents the `ls -d … | sort -V | tail -1` idiom for picking the newest version dir.
- **`hooks/scripts/_resolve-claude.sh` already solves "claude exists but is not on PATH"** (the VS Code extension's bundled binary). That resolution order gets ported to JS in the launcher.
- **`release.yml` is the natural publish hook:** it already skips the tag when the version hasn't changed (step *"Skip the tag if this version was already released"*) — npm publish rides the same gate.
- **Full marketplace ID matters:** other plugins are also named `total-recall` (INSTALL.md, § 🏷️ Same name, other plugins). The launcher must always use `total-recall@my-claude-plugins` and detect/abort on a foreign-origin `total-recall`.

## 4. Package design

### 4.1 Root `package.json` (new file)

```json
{
  "name": "@adrian-balaban/total-recall",
  "version": "1.7.0",   // stamped from plugins/total-recall/package.json by sync-version.mjs
  "description": "One-command install bootstrap for the total-recall memory plugin (Claude Code / Gemini / VS Code). The plugin code itself ships from the GitHub release branch.",
  "type": "module",
  "license": "MIT",
  "bin": { "total-recall": "bin/cli.mjs" },
  "files": ["bin"],
  "engines": { "node": ">=18" },
  "repository": { "type": "git", "url": "git+https://github.com/adrian-balaban/total-recall.git" },
  "scripts": { "test": "node --test test/cli.test.mjs", "prepublishOnly": "node test/pack-guard.mjs" }
}
```

Zero runtime dependencies. npm's package page renders the root `README.md` — which already markets the plugin — so no separate npm README is needed.

### 4.2 `bin/cli.mjs` behavior spec (~200 lines, plain Node, no deps)

1. `--version` prints the root package version; `--help` prints usage and the `install.sh` flags it forwards.
2. Node ≥ 18 check (mirrors `install.sh`'s prerequisite, same error tone).
3. **Resolve `claude`** in JS: PATH → VS Code extension's bundled binary (port `_resolve-claude.sh`'s search order) → if truly absent, fail with a pointer to the Claude Code install docs.
4. **Detect existing install:** probe `~/.claude/plugins/cache/my-claude-plugins/total-recall/` (and/or `claude plugin list`). If `total-recall@my-claude-plugins` is already present → skip to step 6 (idempotent re-runs, same philosophy as `install.sh`). If a *different-origin* `total-recall` is present → warn about the name collision and abort unless `--force`.
5. **Install:** run `claude plugin marketplace add adrian-balaban/total-recall`, then `claude plugin install total-recall@my-claude-plugins`; stream both outputs; on non-zero exit print an actionable error (network/auth hint).
6. **Pick the newest version dir** under the cache path (semver-aware sort — port the `sort -V` idiom; note `1.6.10 > 1.6.9` must hold).
7. **Exec `bash <dir>/install.sh <forwarded args>`** — flags passed through verbatim. Windows: locate `bash.exe` (Git Bash on PATH, else `%ProgramFiles%\Git\bin\bash.exe`); if missing, print the exact Git-Bash instruction from INSTALL.md and exit `69` (`EX_UNAVAILABLE`).
8. Print the final "start a new Claude Code session" hint only if `install.sh` didn't (avoid double output).

Non-interactive default already works: `install.sh` selects the Complete profile when no TTY is attached, so CI usage is simply `npx -y @adrian-balaban/total-recall -y`.

## 5. Version lockstep

The root `package.json` version is stamped from `plugins/total-recall/package.json` by extending `plugins/total-recall/scripts/sync-version.mjs` (it already single-sources the version into `.claude-plugin/plugin.json` and `gemini-extension.json`, and CI verifies with `git diff --exit-code`). The npx package releases in lockstep with the plugin — one version number, one mental model.

## 6. CI publishing (npm trusted publishing — no stored token)

- Extend `.github/workflows/release.yml` **after** the existing tag step with a `publish-npm` step:
  - job permission `id-token: write`; `actions/setup-node` (**Node 22**; trusted publishing needs Node 22.14+ and npm 11.5.1+, so the job also runs `npm install -g npm@^11.5.1`) with `registry-url: https://registry.npmjs.org/`;
  - `npm publish --access public --provenance` from the repo root;
  - gate on the existing version-change check output (`steps.check`), so doc-only commits don't republish.
- **One-time manual setup:** create the `@adrian-balaban` scope on npmjs.com, register the package for **Trusted Publishing** bound to this repo + `release.yml`, then do the first publish locally (`npm publish --access public`; provenance only exists in CI) since OIDC-only first publishes need the package to exist. `v1.7.0` was tagged before this step existed, so CI skips the npm step for 1.7.0: publish 1.7.0 by hand, and CI publishes from the next plugin version.
- **Tarball invariant:** a `prepublishOnly` guard runs `npm pack --dry-run` and fails if anything beyond `bin/`, `package.json`, `README.md`, `LICENSE` would ship.

## 7. Tests

- **Root suite, zero new dev-deps:** `node:test` under `test/cli.test.mjs`, with the process runner dependency-injected (or `mock.method`) so no real subprocesses spawn.
- **Cases:** `claude` resolution order incl. the VS Code bundled path; install-vs-skip decision; foreign-origin collision abort; version-dir picking (`1.6.10 > 1.6.9`); flag pass-through verbatim; Windows `bash.exe` detection matrix; `--help` / `--version`.
- **Gate wiring:** one step in `.github/workflows/mutation.yml` (`working-directory: .` → `npm test`) keeps "single build/release gate" true. The launcher is deliberately **excluded from Stryker scope** — it is orchestration, and keeping the 65% mutation gate scoped to `plugins/total-recall` avoids widening it.
- **`RELEASE-SMOKE-TEST.md`:** add an npx smoke item — clean machine: `npx -y @adrian-balaban/total-recall --help` prints usage; then a full run against a sandboxed `HOME` completes steps 1–8.

## 8. Documentation

- **`README.md` (Quick start):** add `npx @adrian-balaban/total-recall` as the one-command alternative; the two-step marketplace route stays listed first (primary channel). Same change in **`README-ro.md`**.
- **`plugins/total-recall/INSTALL.md`:** new "Install (npx / npm)" subsection under ⚡ Install; rewrite the *"deliberately no zip download and no npm package"* sentence to state the new stance: the npm package exists but contains **no plugin code** — it is a bootstrap; provenance is still the GitHub `release` branch.
- **`SECURITY.md`:** one line stating the npm tarball ships no plugin code, only the launcher, and how to verify (`npm pack --dry-run`).
- **`BACKLOG.md`:** close/note any pre-existing "npm distribution" entry with a pointer to this plan.

## 9. Repo housekeeping

- `.gitignore`'s comment above `node_modules/` / `package-lock.json` says *"there is no root package.json"*. Reword: *"the root package.json is the tiny npx bootstrap (bin/ only, zero deps); stray root node_modules/ and package-lock.json stay ignored — the bootstrap never installs anything."*
- `bin/cli.mjs` and `test/` are committed (not ignored). `bin/cli.mjs` gets the executable bit.

## 10. Out of scope

- No `--mcp` standalone-server subcommand (Codex CLI keeps pointing at `dist/index.js`, per INSTALL.md § 🤖).
- No publishing of the plugin itself to npm; no zip/tarball downloads; no Homebrew formula.
- No changes to `plugins/total-recall/package.json` — it is **not** the published package.

## 11. Open questions

1. First publish: npm Trusted Publishing requires the package name to exist; plan = one manual `npm publish --provenance` by the maintainer, CI handles everything after.
2. Collision policy: hard-stop when a foreign `total-recall` is installed (default), with a `--force` escape hatch. **Done.**
3. Should `--uninstall` exist? Deferred (tracked in BACKLOG.md) — `claude plugin uninstall total-recall@my-claude-plugins` already covers it.

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `claude plugin` CLI output/behavior changes between versions | Launcher greps stable tokens and falls back to the cache-dir probe; smoke test in RELEASE-SMOKE-TEST.md |
| Users type `npm i total-recall` (unscoped) and get the unrelated 2013 tool | README/INSTALL call out the scoped name explicitly, next to every code sample |
| Tarball drifts from the "no plugin code" invariant | `prepublishOnly` files guard (§6) + SECURITY.md documents the invariant |
| Windows without Git Bash | Actionable message quoting INSTALL.md's Git-Bash note; distinct exit code |
| Version skew between launcher and plugin | Lockstep versioning (§5); launcher is version-agnostic by design — it operates on whatever the marketplace installed |
| npx prompt fatigue / typosquatting worries | Scoped name, `--provenance` attestation, tiny auditable tarball |

## 13. Implementation checklist (ordered)

1. ✅ `bin/cli.mjs` + root `package.json` (+ executable bit on the bin).
2. ✅ `test/cli.test.mjs` (`node:test`) → root `npm test` green locally.
3. ✅ `plugins/total-recall/scripts/sync-version.mjs`: add root `package.json` to the stamped manifests.
4. ✅ `.github/workflows/release.yml`: `publish-npm` step (OIDC trusted publishing, gated on version change).
5. ✅ `.github/workflows/mutation.yml`: add root `npm test` step.
6. ✅ `.gitignore`: reword the root-package.json comment (§9).
7. ✅ Docs: `README.md`, `README-ro.md`, `plugins/total-recall/INSTALL.md`, `SECURITY.md`, `RELEASE-SMOKE-TEST.md`.
8. ✅ (maintainer, 2026-11-06) npmjs.com: create `@adrian-balaban/total-recall`, bind Trusted Publishing to `release.yml`, first manual publish.
9. ⏳ (maintainer) End-to-end verify on a clean machine/container: `npx -y @adrian-balaban/total-recall` → marketplace install + `install.sh` complete → new Claude Code session shows the injected memory index.


