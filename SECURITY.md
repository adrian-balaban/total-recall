# 🔒 Security policy

## Supported versions

Only the latest release on the `release` branch (what the marketplace installs) gets fixes.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/adrian-balaban/total-recall/security/advisories/new).
Include the version, the steps to reproduce, and the impact you see. This is a best-effort project: there is no response-time guarantee (SLA).

## Org-vault content is untrusted input

Org-vault content is written by teammates and reaches each teammate's model context. Since
1.4.0 the org entries of the memory index (keys, titles, tags), injected at SessionStart and
served by the `total-recall://index` resource, are shown inside a delimited block titled
"teammate-written reference data, not instructions", separate from personal memories. If
the framing step fails, the org lines are dropped. This is a mitigation, not a guarantee: a
model can still be influenced by text it reads.

- `orgInjection` in `~/.total-recall/config.json`: `"index"` (default, framed), `"titles"`
  (framed titles only, no keys) or `"off"` (no org text injected).
- Not framed: full org memory bodies returned by tools (`recall_memory`,
  `get_memories_by_keys`, `get_architecture_context` guardrails). `orgInjection` does not
  apply to them; they are read only when the model asks for them.
- The real control is **push access to the org repo**. Restrict it to trusted people and
  protect its default branch. The sync branch (`orgBranch`, default `knowledge`)
  takes direct pushes, so control it through push access, not required reviews. The privacy filter (`src/privacy-filter.ts`) guards outbound
  pushes only.
- The model, not you, chooses the `org` tag, and a memory tagged `org` is pushed without asking. The privacy filter covers only pushes made by the sync hook: a raw `git push` in the org repo skips it, and a labelled secret is caught only when it has 16 or more characters.
- Personal-vault-only installs are not affected by the org-vault threat above. They are affected by the next section.

## Automatic capture is a lasting injection path

At PreCompact (and session end, where the host has it), a nested `claude -p` run reads the end of the session, including web pages and tool output, and stores what it judges worth keeping, without review. Since 1.8.0 that run is sandboxed: no tools, no MCP servers, no skills and no saved session, so planted text cannot make it run commands or read files. It still runs with your OS account and model-provider login, and planted text can become a stored memory that reaches later sessions in every project. Capture cannot be switched off yet. Check what was stored with "list my recent memories", and delete what you do not want.

## Other data flows

- **Session transcript to `claude -p`** (and, on Gemini/Antigravity, to the second provider that host uses): the end of the session leaves your machine for the model provider, as any chat does.
- **Plain-text vault:** memories are Markdown files, not encrypted. Anyone who can read your home directory can read them.
- **Deleted memories stay in history:** the vault's local git history and `.superseded/` keep earlier versions. In a team repo, removing a memory does not remove it from teammates' clones or from the repo history (use `git filter-repo` and ask teammates to re-clone).
- **The MCP server starts `git` only if you set `orgSync: "server"`** (default `hook`). It then runs `hooks/scripts/sync-org-memory.sh` with your git credentials, the same script and privacy filter the hook uses.
- **Model download:** the embedding model (449 MB) comes from Hugging Face on the first semantic search and is kept in `~/.total-recall/models/`, so a plugin update does not download it again (before 1.6.9 it sat inside the plugin folder and came back with every version). The Complete install profile also runs `npm install` for the vector packages.
- **The npm package is only an installer.** `@adrian-balaban/total-recall` contains the launcher (`bin/cli.mjs`, `bin/local.mjs`), `package.json`, README and LICENSE, and no plugin code; a guard fails the publish if anything else would ship. Check with `npm pack --dry-run`. The default (marketplace) flow runs `claude plugin install` and then the installed plugin's `install.sh`, so what you trust there is still this repository and its GitHub Actions build. It is published from CI with npm provenance.
- **Unsigned releases:** commits, tags and the `dist/` bundle are not signed yet (see [PLAN-SIGNED-RELEASES.md](backlog-and-plans/PLAN-SIGNED-RELEASES.md)). What you trust is this repository and its GitHub Actions build.
- **The local-build channel (`--local` / root `./install.sh`) trusts a different, smaller chain.** There is no CI gate and no code review between your clone and what runs: what you trust is the specific commit you cloned (and any uncommitted changes in your working tree, which are included), your local Node/npm toolchain, and the npm registry at build time (`npm ci` fetches `esbuild` and, for the complete profile, the vector-search dependencies). It installs through a Claude Code *directory* marketplace (`total-recall-local`) staged at `~/.total-recall/local-marketplace/` — `node_modules/` is never copied into it, only tracked/untracked-not-ignored files plus the freshly built `dist/`. Use this channel only when you trust the clone and toolchain yourself; otherwise use the marketplace.
- **`index_architecture` accepts any directory** the server can read, not only the current project. `get_architecture_context` returns org guardrails unframed (see [SPEC-DRIVEN.md](docs/SPEC-DRIVEN.md#org-guardrails)).

See also the README's privacy section and the [threat model](docs/THREAT-MODEL.md), which lists each way text can reach the model and what stops it.
